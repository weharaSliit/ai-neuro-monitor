"""
validate_trend_detector.py
--------------------------
Empirical check of the Ring's `trending_toward_stress` flag
(backend/physiological/predictor.py :: StressStateMachine), which until
now had no accuracy number behind it.

Uses the EXACT production class and the exact production gating from
predict_window(): history capped at window_size+3, vote only once
>= window_size windows exist, flag = votes_for / total >= TREND_RISING_THRESHOLD.
The model itself is not involved -- the flag is computed from features only.

Two tests:
 1. Real WESAD transition. Each subject's windows are in time order:
    ~39 calm baseline windows, then ~19 TSST stress windows. We measure
      - false-alarm rate: share of calm-baseline windows that get flagged
      - detection: was the flag raised within the first K stress windows,
        and how many windows after onset
    and compare detection against what a random flag firing at the same
    false-alarm rate would achieve (1 - (1-FA)^K) -- i.e. is the detector
    actually responding to stress onset, or just firing at random?
 2. Synthetic scenarios per subject (stable / rising / noisy), built from
    that subject's own baseline mean and std.

Plus a sweep of the vote threshold to show where the deployed 0.35 sits.

Run from the repo root:
    python physiological_signals/validate_trend_detector.py
"""
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from backend.common.config import TREND_RISING_THRESHOLD, N_BASELINE_WIN  # noqa: E402
from backend.physiological.predictor import (  # noqa: E402
    StressStateMachine, compute_baseline, MONOTONIC_UP, PHASIC_PEAK, TROUGH,
)

DATA = os.path.join(ROOT, 'physiological_signals', 'results', 'objective1', 'wesad_features_binary.csv')
OUT_DIR = os.path.join(ROOT, 'physiological_signals', 'results', 'objective2')
WINDOW_SIZE = 5          # StressStateMachine default, as deployed
K_DETECT = 6             # stress-onset detection horizon (windows)
SWEEP = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60]
RNG = np.random.default_rng(42)


def run_stream(rows, feature_cols, baseline_mean, threshold, baseline_std=None):
    """Replays predict_window()'s trend logic over a window sequence.
    Returns a list of flags (None while < window_size windows of history)."""
    sm = StressStateMachine(feature_cols, baseline_mean=baseline_mean,
                            window_size=WINDOW_SIZE, trend_threshold=threshold,
                            baseline_std=baseline_std)
    flags = []
    for feat_dict in rows:
        sm.history.append(feat_dict)
        if len(sm.history) > sm.window_size + 3:
            sm.history.pop(0)
        if len(sm.history) >= sm.window_size:
            votes_for, _, total = sm._trend_votes(feat_dict)
            conf = votes_for / total if total > 0 else 0
            flags.append(conf >= threshold)
        else:
            flags.append(None)
    return flags


def real_transition(df, feature_cols, threshold):
    per_subject = []
    for sid, g in df.groupby('subject_id', sort=False):
        X = g[feature_cols].to_numpy(dtype=float)
        y = g['label'].to_numpy()
        onset = int(np.argmax(y == 1))
        b_mean, b_std = compute_baseline(X, n_windows=N_BASELINE_WIN)  # first 3 windows, as deployed
        rows = [dict(zip(feature_cols, r)) for r in X]
        flags = run_stream(rows, feature_cols, b_mean, threshold, b_std)

        calm = [f for f in flags[:onset] if f is not None]
        fa = float(np.mean(calm)) if calm else np.nan
        window = flags[onset:onset + K_DETECT]
        hits = [i for i, f in enumerate(window) if f]
        stress_all = [f for f in flags[onset:] if f is not None]
        per_subject.append({
            'subject': sid,
            'calm_windows': len(calm),
            'false_alarm_rate': fa,
            'detected': bool(hits),
            'latency_windows': hits[0] if hits else np.nan,
            'flag_rate_during_stress': float(np.mean(stress_all)) if stress_all else np.nan,
            'chance_detection': 1 - (1 - fa) ** K_DETECT if not np.isnan(fa) else np.nan,
        })
    return pd.DataFrame(per_subject)


def synthetic(df, feature_cols, threshold, n_windows=30, ramp_start=12, ramp_len=6):
    """Stable / rising / noisy streams from each subject's own calm stats."""
    up = set(MONOTONIC_UP) | set(PHASIC_PEAK)
    down = set(TROUGH)
    res = {'stable_fa': [], 'noisy_fa': [], 'rising_detected': []}
    for _, g in df.groupby('subject_id', sort=False):
        calm = g[g['label'] == 0][feature_cols].to_numpy(dtype=float)
        mu, sd = calm.mean(axis=0), calm.std(axis=0) + 1e-9
        b_mean, b_std = compute_baseline(calm, n_windows=N_BASELINE_WIN)

        def stream(noise_mult, ramp):
            rows = []
            for t in range(n_windows):
                v = mu + RNG.normal(0, sd * noise_mult)
                if ramp and t >= ramp_start:
                    step = min(t - ramp_start + 1, ramp_len) / ramp_len  # 0 -> 1 over ramp_len windows
                    for i, f in enumerate(feature_cols):
                        if f in up:
                            v[i] += 2.0 * sd[i] * step
                        elif f in down:
                            v[i] -= 2.0 * sd[i] * step
                rows.append(dict(zip(feature_cols, v)))
            return run_stream(rows, feature_cols, b_mean, threshold, b_std)

        s = [f for f in stream(1.0, False) if f is not None]
        n = [f for f in stream(3.0, False) if f is not None]
        r = stream(1.0, True)
        res['stable_fa'].append(np.mean(s))
        res['noisy_fa'].append(np.mean(n))
        res['rising_detected'].append(any(f for f in r[ramp_start:ramp_start + K_DETECT] if f))
    return {k: float(np.mean(v)) for k, v in res.items()}


def main():
    df = pd.read_csv(DATA)
    feature_cols = [c for c in df.columns if c not in ('label', 'subject_id')]
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f'Trend detector validation -- {df.subject_id.nunique()} WESAD subjects, '
          f'deployed threshold {TREND_RISING_THRESHOLD}, window_size {WINDOW_SIZE}, '
          f'detection horizon {K_DETECT} windows\n')

    per = real_transition(df, feature_cols, TREND_RISING_THRESHOLD)
    per.to_csv(os.path.join(OUT_DIR, 'trend_validation_per_subject.csv'), index=False)
    print('1) REAL calm -> stress transition (deployed settings)')
    print(per.round(3).to_string(index=False))
    print(f"\n   mean false-alarm rate (calm):       {per.false_alarm_rate.mean():.3f}")
    print(f"   onset detected within {K_DETECT} windows:     {per.detected.mean():.3f} "
          f"({int(per.detected.sum())}/{len(per)} subjects)")
    print(f"   chance detection at same FA rate:   {per.chance_detection.mean():.3f}")
    print(f"   median latency (windows):           {per.latency_windows.median()}")
    print(f"   flag rate during whole stress block: {per.flag_rate_during_stress.mean():.3f}\n")

    rows = []
    for th in SWEEP:
        p = real_transition(df, feature_cols, th)
        syn = synthetic(df, feature_cols, th)
        rows.append({
            'threshold': th,
            'real_false_alarm': p.false_alarm_rate.mean(),
            'real_detection': p.detected.mean(),
            'real_chance_detection': p.chance_detection.mean(),
            'real_lift_over_chance': p.detected.mean() - p.chance_detection.mean(),
            'syn_stable_fa': syn['stable_fa'],
            'syn_noisy_fa': syn['noisy_fa'],
            'syn_rising_detection': syn['rising_detected'],
        })
    sweep = pd.DataFrame(rows)
    sweep.to_csv(os.path.join(OUT_DIR, 'trend_validation_sweep.csv'), index=False)
    print('2) Threshold sweep (real transition + synthetic scenarios)')
    print(sweep.round(3).to_string(index=False))

    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(7.5, 4.6))
        ax.plot(sweep.threshold, sweep.real_detection, 'o-', color='#E56B4E', label='Onset detected (real WESAD)')
        ax.plot(sweep.threshold, sweep.real_chance_detection, 'o--', color='#989294', label='Random flag, same false-alarm rate')
        ax.plot(sweep.threshold, sweep.real_false_alarm, 's-', color='#5E935A', label='False alarms during calm')
        ax.axvline(TREND_RISING_THRESHOLD, color='#6E68B2', ls=':', lw=1.5)
        ax.text(TREND_RISING_THRESHOLD + 0.005, 0.97, f'deployed {TREND_RISING_THRESHOLD}', color='#6E68B2',
                fontsize=9, va='top')
        ax.set_xlabel('Vote threshold (share of features voting "rising")')
        ax.set_ylabel('Rate')
        ax.set_ylim(0, 1.02)
        ax.set_title('Ring trend detector — calm→stress validation (WESAD, 15 subjects)')
        ax.legend(loc='lower left', fontsize=8.5)
        ax.grid(alpha=0.25)
        fig.tight_layout()
        path = os.path.join(OUT_DIR, 'trend_validation.png')
        fig.savefig(path, dpi=160)
        print(f'\nSaved {path}')
    except Exception as e:  # plotting is optional
        print('plot skipped:', e)


if __name__ == '__main__':
    main()
