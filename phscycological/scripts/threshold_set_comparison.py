#!/usr/bin/env python3
"""
Compares candidate DecisionThresholds sets WITHOUT touching the model or
retraining anything -- per the architecture:

    Model -> calibrated_p -> Threshold configuration -> Persistence logic -> State

Three parts:
  A. Distribution: percentiles of calibrated_p (from the deployed bipolar-
     only model's SAM40 LOSO scores).
  B. State behavior: for each candidate threshold set, run the REAL
     persistence-gated state machine (sam40.decision.compute_states) over
     continuous score sequences and report alerts/session, high-load
     duration, micro-break events, cooldown events, %time high-load,
     %time cooldown.
  C. Temporal sanity: does the resulting state sequence look like
     normal -> high load -> sustained high load -> recovery, or does it
     flip-flop (high load -> cooldown -> high load -> cooldown every few
     blocks)?

DATA FOR B/C: originally attempted with STEW (one genuinely continuous
150s/6-block recording per subject) via the SAM40-trained bipolar-only
model applied to STEW's T7/T8 channels -- ABANDONED after discovering it
produces a scale-mismatch artifact, not a real test: STEW's absolute
feature scale (different hardware/montage entirely) is so far outside
what the model's StandardScaler+LogisticRegression was fit on that raw
scores collapse to numerically ~0 for nearly every block (median raw
score ~3.5e-28), which the calibrator then maps to a near-constant floor
value regardless of the real underlying signal -- an out-of-domain
extrapolation failure, not evidence about state-machine behavior. Using
it would have silently reported "0 alerts, 0 flips" as if that were a
clean result, when it's actually a degenerate artifact.

Uses SAM40's OWN in-domain calibrated LOSO scores instead (no scale
mismatch -- same hardware/features/processing the model was built for),
arranged per subject in a plausible narrative order (Relax x3 -> Stroop
x3 -> Arithmetic x3 -> Mirror-image x3 = 12-block "session"). This is
still a SYNTHETIC ordering, not a literal continuous recording (each
block is a separately-recorded 25s trial) -- explicitly not a claim of
real multi-minute temporal dynamics, only "given a plausible sequence of
this model's own real, valid scores, does persistence gating behave
sensibly." Persistence requirements longer than 12 blocks (micro_break
>=20, fatigue >=60) structurally cannot fire at this scale -- reported as
a limitation, not tuned around.

Usage:
    python3 scripts/threshold_set_comparison.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from sam40.decision import DecisionThresholds, compute_states  # noqa: E402

OUT_DIR = ROOT / 'results' / 'final_analysis'

TASK_ORDER = ['Relax', 'Stroop', 'Arithmetic', 'Mirror_image']


def build_sam40_synthetic_sessions() -> pd.DataFrame:
    """Per-subject 12-block synthetic session: Relax x3 -> Stroop x3 ->
    Arithmetic x3 -> Mirror-image x3, using the model's own real, in-domain
    calibrated LOSO scores (no scale-mismatch risk -- see module docstring
    for why STEW was tried and abandoned for this purpose). Also pulls
    theta_ratio/spectral_slope from the same feature table so
    fatigue_warning's inputs are populated (still can't fire at 12 blocks,
    but the columns need to exist for compute_states to run).
    """
    calib = pd.read_csv(ROOT / 'results' / 'calibration' / 'calibrated_oof_scores_bipolar_only_25s_block.csv')
    # bipolar_only features has no T7_*/T8_* columns (bipolar-only by design) -- pull
    # theta_ratio/spectral_slope from the T7-T8 block-level feature table instead (same
    # subject/task/trial keys, just the per-channel columns this specific pair of derived
    # summary fields needs; not used by the deployed model itself, only by compute_states).
    feats = pd.read_csv(ROOT / 'results' / 'features_T7-T8_25s_block.csv')
    merged = calib.merge(feats[['subject', 'task', 'trial', 'T7_theta_alpha_ratio', 'T8_theta_alpha_ratio',
                                 'T7_spectral_slope', 'T8_spectral_slope']],
                          on=['subject', 'task', 'trial'], how='left')
    merged['theta_ratio'] = merged[['T7_theta_alpha_ratio', 'T8_theta_alpha_ratio']].mean(axis=1)
    merged['spectral_slope'] = merged[['T7_spectral_slope', 'T8_spectral_slope']].mean(axis=1)

    rows = []
    for subj, g in merged.groupby('subject'):
        block_idx = 0
        for task in TASK_ORDER:
            task_rows = g[g.task == task].sort_values('trial')
            for _, r in task_rows.iterrows():
                rows.append({'subject': subj, 'block': block_idx, 'task': task,
                             'calibrated_p': r.calibrated_score, 'theta_ratio': r.theta_ratio,
                             'spectral_slope': r.spectral_slope})
                block_idx += 1
    return pd.DataFrame(rows)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # ---- Part A: distribution of calibrated_p (deployed model, SAM40 LOSO) ----
    print('=' * 70 + '\nPART A: DISTRIBUTION OF calibrated_p (SAM40 LOSO, bipolar-only model)\n' + '=' * 70)
    calib = pd.read_csv(ROOT / 'results' / 'calibration' / 'calibrated_oof_scores_bipolar_only_25s_block.csv')
    pcts = [5, 10, 25, 50, 75, 80, 85, 90, 95]
    dist = {f'P{p}': np.percentile(calib.calibrated_score, p) for p in pcts}
    dist_df = pd.DataFrame([dist])
    print(dist_df.to_string(index=False))
    dist_df.to_csv(OUT_DIR / 'calibrated_p_percentiles.csv', index=False)

    # ---- Build SAM40-based synthetic continuous sessions (in-domain, see module docstring) ----
    print('\nBuilding per-subject synthetic 12-block sessions from SAM40\'s own in-domain calibrated scores...')
    session_feats = build_sam40_synthetic_sessions()

    # ---- Threshold sets ----
    # NOTE: set_A is the ORIGINAL hand-picked baseline (0.70/0.75/0.30), kept explicit here for
    # comparison -- decision.py's own DecisionThresholds() default no longer equals this; it was
    # updated to set_C (sensitivity-optimized) after this analysis. See decision.py's docstring.
    # cooldown_high_p is explicitly set (mirroring each set's own high_load_p) in EVERY set below --
    # never left to the DecisionThresholds dataclass default, which is not a fixed reference point
    # (it's whatever decision.py's own default currently is, which this project has changed at least
    # once already; leaving it implicit made an earlier run of this script silently non-reproducible).
    set_A = DecisionThresholds(high_load_p=0.70, break_p=0.75, cooldown_high_p=0.70, cooldown_low_p=0.30)
    set_B = DecisionThresholds(high_load_p=0.794, break_p=0.810, cooldown_high_p=0.794, cooldown_low_p=0.696)  # nested-selected
    # sensitivity-optimized: looser percentile band + higher false-alert tolerance,
    # same select_threshold() methodology as nested_threshold_selection.py, fit on ALL
    # of SAM40's calibrated scores (single global selection, not per-fold nested).
    from nested_threshold_selection import select_threshold  # noqa: E402
    y_all = calib.y_true.to_numpy()
    cal_all = calib.calibrated_score.to_numpy()
    sens_high_t, _ = select_threshold(cal_all, y_all, (50, 60), 'high_load', rate_cap=0.40)
    sens_break_t, _ = select_threshold(cal_all, y_all, (60, 70), 'break', rate_cap=0.30)
    sens_cooldown_t, _ = select_threshold(cal_all, y_all, (30, 40), 'cooldown_low')
    set_C = DecisionThresholds(high_load_p=sens_high_t, break_p=sens_break_t,
                                cooldown_high_p=sens_high_t, cooldown_low_p=sens_cooldown_t)

    threshold_sets = {
        'A_current': set_A,
        'B_nested_selected': set_B,
        'C_sensitivity_optimized': set_C,
    }
    print('\nThreshold sets under test:')
    for name, t in threshold_sets.items():
        print(f'  {name}: high_load_p={t.high_load_p:.3f}  break_p={t.break_p:.3f}  cooldown_low_p={t.cooldown_low_p:.3f}')

    # ---- Part B: state behavior per threshold set, per synthetic 12-block session ----
    print('\n' + '=' * 70 + '\nPART B: STATE BEHAVIOR (40 synthetic 12-block SAM40 sessions)\n' + '=' * 70)
    behavior_rows = []
    sanity_examples = {}
    for set_name, thresholds in threshold_sets.items():
        per_session = []
        flip_counts = []
        for subj, g in session_feats.groupby('subject'):
            g = g.sort_values('block').reset_index(drop=True)
            g_in = g[['calibrated_p', 'theta_ratio', 'spectral_slope']].copy()
            states = compute_states(g_in, thresholds)
            per_session.append({
                'subject': subj,
                'high_load_alerts': int(states.high_load_alert.sum()),
                'micro_break_events': int(states.micro_break_recommended.sum()),
                'cooldown_events': int(states.cooldown_logged.sum()),
                'pct_time_high_load': float((g_in.calibrated_p >= thresholds.high_load_p).mean()),
                'pct_time_cooldown_eligible': float((g_in.calibrated_p <= thresholds.cooldown_low_p).mean()),
            })
            flips = int((states.high_load_alert.astype(int).diff().abs() > 0).sum())
            flip_counts.append(flips)
            if subj == 1:  # SAM40 subject IDs are 1-40, not 0-indexed
                sanity_examples[set_name] = list(zip(g_in.calibrated_p.round(3), states.high_load_alert.tolist()))

        sess_df = pd.DataFrame(per_session)
        summary = {
            'threshold_set': set_name,
            'high_load_p': thresholds.high_load_p, 'break_p': thresholds.break_p,
            'cooldown_low_p': thresholds.cooldown_low_p,
            'mean_alerts_per_session': sess_df.high_load_alerts.mean(),
            'sessions_with_alert_pct': (sess_df.high_load_alerts > 0).mean() * 100,
            'mean_micro_break_events': sess_df.micro_break_events.mean(),
            'mean_cooldown_events': sess_df.cooldown_events.mean(),
            'mean_pct_time_high_load': sess_df.pct_time_high_load.mean() * 100,
            'mean_pct_time_cooldown_eligible': sess_df.pct_time_cooldown_eligible.mean() * 100,
            'mean_state_flips_per_session': np.mean(flip_counts),
        }
        behavior_rows.append(summary)
        sess_df.to_csv(OUT_DIR / f'session_behavior_{set_name}.csv', index=False)

    behavior_df = pd.DataFrame(behavior_rows)
    print(behavior_df.to_string(index=False))
    behavior_df.to_csv(OUT_DIR / 'threshold_set_behavior_summary.csv', index=False)

    # ---- Part C: temporal sanity ----
    print('\n' + '=' * 70 + '\nPART C: TEMPORAL SANITY (mean state-flips/session; example subject-0 sequence)\n' + '=' * 70)
    print('NOTE: micro_break_recommended needs >=20 consecutive blocks, fatigue_warning >=60 -- '
          'these synthetic sessions are only 12 blocks long, so those two states structurally '
          'cannot fire regardless of threshold choice. Only high_load_alert (>=3 blocks) and '
          'cooldown_logged (single-block transition) are meaningfully testable at this scale.\n')
    for set_name in threshold_sets:
        row = behavior_df[behavior_df.threshold_set == set_name].iloc[0]
        print(f'{set_name}: mean_state_flips_per_session={row.mean_state_flips_per_session:.2f} '
              f'(0 = clean monotonic-ish transitions; higher = flip-flopping)')
        seq = sanity_examples[set_name]
        print(f'  subject 0 example sequence (calibrated_p, high_load_alert): {seq}')

    print(f'\nWrote outputs to {OUT_DIR}/')


if __name__ == '__main__':
    main()
