#!/usr/bin/env python3
"""
Percentile-based, nested, leakage-controlled decision-threshold selection
for the deployed bipolar-only model -- replaces "thresholds picked by eye
from the overall LOSO score distribution" with:

    Outer LOSO (held-out subject untouched until evaluation)
      -> Inner grouped CV, within the 39 training subjects only
      -> Inner out-of-fold raw scores -> Platt-calibrated (leakage-free
         w.r.t. the outer test subject, same machinery as
         sam40.calibration.nested_calibrated_loso)
      -> Candidate thresholds = percentiles of that inner-calibrated
         distribution (NOT arbitrary values, NOT the value 0.70/0.75/0.30
         chosen a priori)
      -> Each candidate scored against a state-specific objective
         (false-alert-rate-capped sensitivity for high_load/break;
         false-recovery-rate for cooldown) using ONLY inner data
      -> Winning threshold LOCKED
      -> Locked threshold applied, unchanged, to the outer held-out
         subject -- this is the only place outer-subject data is touched

Repeated for all 40 outer folds; reports both the per-fold locked
threshold values (stability check) and the pooled outer (truly
held-out) sensitivity/specificity/false-alert-rate for each trigger.

IMPORTANT SCOPE LIMIT: this validates the INSTANTANEOUS (single-block,
p>=threshold) trigger condition only. The persistence-duration
requirements (>=3 / >=20 / >=60 CONSECUTIVE blocks) cannot be evaluated
this way -- SAM40 has no continuous multi-block sequences per subject
(each row is an isolated 25s trial), so "sustained over N consecutive
blocks" has no meaningful realization here. Those duration requirements
are carried through unchanged as operational requirements, not validated
by this analysis -- see results/methodology/05_decision_logic.md.

Usage:
    python3 scripts/nested_threshold_selection.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.model_selection import GroupKFold, LeaveOneGroupOut

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from sam40.calibration import _fit_calibrator  # noqa: E402
from sam40.train import MODELS, feature_columns  # noqa: E402

OUT_DIR = ROOT / 'results' / 'final_analysis'
MODEL_NAME = 'logistic_regression'  # matches the deployed model


def select_threshold(cal_scores: np.ndarray, y: np.ndarray, percentile_range: tuple[float, float],
                      objective: str, rate_cap: float = 0.20) -> tuple[float, dict]:
    """Candidate thresholds = percentiles of cal_scores (inner-OOF, calibrated,
    leakage-free w.r.t. the outer test subject) within percentile_range.
    objective='high_load'/'break': maximize sensitivity (recall on task-labeled
    inner blocks) among candidates whose false-alert rate (fraction of
    Relax-labeled inner blocks incorrectly triggered) is <= rate_cap; falls
    back to the strictest (highest) candidate if none meets the cap.
    objective='cooldown_low': minimize false-recovery rate (fraction of
    task-labeled inner blocks that fall below threshold).
    """
    lo_pct, hi_pct = percentile_range
    candidates = np.unique(np.percentile(cal_scores, np.linspace(lo_pct, hi_pct, 11)))
    relax_scores, task_scores = cal_scores[y == 0], cal_scores[y == 1]

    if objective in ('high_load', 'break'):
        best = None
        for t in candidates:
            far = float((relax_scores >= t).mean()) if len(relax_scores) else 0.0
            sens = float((task_scores >= t).mean()) if len(task_scores) else 0.0
            if far <= rate_cap and (best is None or sens > best[1]):
                best = (t, sens, far)
        if best is None:
            t = candidates[-1]
            best = (t, float((task_scores >= t).mean()), float((relax_scores >= t).mean()))
        return best[0], {'inner_sensitivity': best[1], 'inner_false_alert_rate': best[2]}

    elif objective == 'cooldown_low':
        best = None
        for t in candidates:
            false_recovery = float((task_scores < t).mean()) if len(task_scores) else 0.0
            true_recovery = float((relax_scores < t).mean()) if len(relax_scores) else 0.0
            if best is None or false_recovery < best[1]:
                best = (t, false_recovery, true_recovery)
        return best[0], {'inner_false_recovery_rate': best[1], 'inner_true_recovery_rate': best[2]}

    raise ValueError(objective)


def _outer_fold(X, y, groups, train_idx, test_idx, n_inner_splits=5):
    train_groups = groups[train_idx]
    inner_splits = min(n_inner_splits, len(np.unique(train_groups)))
    inner_cv = GroupKFold(n_splits=inner_splits)

    oof_scores = np.zeros(len(train_idx))
    for inner_train, inner_val in inner_cv.split(X[train_idx], y[train_idx], groups=train_groups):
        m = MODELS[MODEL_NAME]()
        m.fit(X[train_idx][inner_train], y[train_idx][inner_train])
        oof_scores[inner_val] = m.predict_proba(X[train_idx][inner_val])[:, 1]

    calibrator = _fit_calibrator('sigmoid', oof_scores, y[train_idx])
    inner_cal = calibrator(oof_scores)  # leakage-free calibrated scores, training subjects only

    high_load_t, hl_diag = select_threshold(inner_cal, y[train_idx], (70, 80), 'high_load', rate_cap=0.20)
    break_t, br_diag = select_threshold(inner_cal, y[train_idx], (80, 90), 'break', rate_cap=0.10)
    cooldown_t, cd_diag = select_threshold(inner_cal, y[train_idx], (20, 30), 'cooldown_low')

    final_model = MODELS[MODEL_NAME]()
    final_model.fit(X[train_idx], y[train_idx])
    raw_test = final_model.predict_proba(X[test_idx])[:, 1]
    cal_test = calibrator(raw_test)  # calibrator never touched test_idx -- no leakage

    return {
        'subject': groups[test_idx][0],
        'y_true': y[test_idx], 'cal_test': cal_test,
        'high_load_t': high_load_t, 'break_t': break_t, 'cooldown_t': cooldown_t,
        **{f'hl_{k}': v for k, v in hl_diag.items()},
        **{f'br_{k}': v for k, v in br_diag.items()},
        **{f'cd_{k}': v for k, v in cd_diag.items()},
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(ROOT / 'results' / 'features_bipolar_only_25s_block.csv')
    data = df.dropna(subset=['label_task']).reset_index(drop=True)
    X = data[feature_columns(data)].to_numpy()
    y = data['label_task'].to_numpy().astype(int)
    groups = data['subject'].to_numpy()

    outer_cv = LeaveOneGroupOut()
    splits = list(outer_cv.split(X, y, groups))
    print(f'Running nested threshold selection: {len(splits)} outer folds (LOSO) x inner grouped CV '
          f'(model={MODEL_NAME})...')
    results = Parallel(n_jobs=-1)(delayed(_outer_fold)(X, y, groups, tr, te) for tr, te in splits)

    fold_summary = pd.DataFrame([{
        'subject': r['subject'], 'high_load_t': r['high_load_t'], 'break_t': r['break_t'],
        'cooldown_t': r['cooldown_t'], 'hl_inner_sensitivity': r['hl_inner_sensitivity'],
        'hl_inner_false_alert_rate': r['hl_inner_false_alert_rate'],
        'br_inner_sensitivity': r['br_inner_sensitivity'], 'br_inner_false_alert_rate': r['br_inner_false_alert_rate'],
        'cd_inner_false_recovery_rate': r['cd_inner_false_recovery_rate'],
    } for r in results])
    fold_summary.to_csv(OUT_DIR / 'nested_threshold_per_fold.csv', index=False)

    print('\n' + '=' * 70 + '\nLOCKED THRESHOLDS ACROSS 40 OUTER FOLDS (stability check)\n' + '=' * 70)
    for col in ['high_load_t', 'break_t', 'cooldown_t']:
        print(f'  {col:12s}: mean={fold_summary[col].mean():.3f}  std={fold_summary[col].std():.3f}  '
              f'min={fold_summary[col].min():.3f}  max={fold_summary[col].max():.3f}')

    # Pooled OUTER (truly held-out) evaluation of the locked-per-fold thresholds
    rows = []
    for r in results:
        y_true, cal_test = r['y_true'], r['cal_test']
        rows.append(pd.DataFrame({
            'subject': r['subject'], 'y_true': y_true, 'calibrated_score': cal_test,
            'high_load_alert': cal_test >= r['high_load_t'],
            'break_recommended': cal_test >= r['break_t'],
            'cooldown_eligible': cal_test <= r['cooldown_t'],
        }))
    outer_df = pd.concat(rows, ignore_index=True)
    outer_df.to_csv(OUT_DIR / 'nested_threshold_outer_predictions.csv', index=False)

    print('\n' + '=' * 70 + '\nOUTER (held-out subject) EVALUATION, locked thresholds applied\n' + '=' * 70)
    for trigger_col, label in [('high_load_alert', 'high_load (target: sens high, FAR<=20% inner)'),
                                ('break_recommended', 'break (target: FAR<=10% inner, stricter)')]:
        relax = outer_df[outer_df.y_true == 0]
        task = outer_df[outer_df.y_true == 1]
        far = relax[trigger_col].mean()
        sens = task[trigger_col].mean()
        print(f'  {label}:')
        print(f'    sensitivity (task blocks triggered) = {sens:.1%}')
        print(f'    false-alert rate (relax blocks triggered) = {far:.1%}')

    relax = outer_df[outer_df.y_true == 0]
    task = outer_df[outer_df.y_true == 1]
    print(f'\n  cooldown_eligible (target: low false-recovery on task blocks):')
    print(f'    true-recovery rate (relax blocks eligible)  = {relax.cooldown_eligible.mean():.1%}')
    print(f'    false-recovery rate (task blocks eligible)  = {task.cooldown_eligible.mean():.1%}')

    print(f'\nWrote {OUT_DIR}/nested_threshold_per_fold.csv, nested_threshold_outer_predictions.csv')
    print('\nSCOPE REMINDER: this validates only the instantaneous p>=threshold trigger. Persistence '
          'duration (blocks-consecutive) requirements are NOT validated here -- SAM40 has no continuous '
          'multi-block sequences per subject to test them against. See 05_decision_logic.md.')


if __name__ == '__main__':
    main()
