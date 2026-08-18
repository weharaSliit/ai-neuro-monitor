#!/usr/bin/env python3
"""
Grouped, nested post-hoc calibration for the official T7/T8 model.

Fits Platt scaling (default) via subject-grouped nested LOSO -- the
calibrator never sees a test subject's data, at any level -- and reports
before/after calibration metrics, a reliability table, and calibration
quality broken down by subject and by task.

Usage:
    python3 scripts/calibrate_model.py [--method sigmoid|isotonic] [--inner-splits 5]
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from sam40.calibration import nested_calibrated_loso, summarize_calibration  # noqa: E402

OUT_DIR = ROOT / 'results' / 'calibration'


def reliability_table(y_true: np.ndarray, scores: np.ndarray, n_bins: int = 10) -> pd.DataFrame:
    bins = np.linspace(0, 1, n_bins + 1)
    df = pd.DataFrame({'y': y_true, 'p': scores})
    df['bin'] = pd.cut(df.p, bins, include_lowest=True)
    table = df.groupby('bin', observed=True).agg(n=('y', 'count'), mean_predicted=('p', 'mean'),
                                                   actual_rate=('y', 'mean'))
    table['gap'] = table.actual_rate - table.mean_predicted
    return table


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--features', default=str(ROOT / 'results' / 'features_T7-T8_4.0s_rich.csv'))
    parser.add_argument('--model', default='mlp')
    parser.add_argument('--method', default='sigmoid', choices=['sigmoid', 'isotonic'])
    parser.add_argument('--inner-splits', type=int, default=5)
    parser.add_argument('--label', default='label_task')
    parser.add_argument('--tag', default=None,
                         help='Suffix for output filenames (default: derived from --features + --model, '
                              'e.g. "T7-T8_4.0s_rich_mlp") -- prevents different runs silently overwriting '
                              'each other\'s results (this collided once already: a 25s-block run clobbered '
                              'the window-level run\'s calibrated_oof_scores.csv until this fix).')
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tag = args.tag or f'{Path(args.features).stem}_{args.model}'
    df_features = pd.read_csv(args.features)
    print(f'Model: {args.model}, calibration method: {args.method}, inner splits: {args.inner_splits}, tag: {tag}')
    print('Running grouped nested-calibration LOSO (this fits the base model '
          f'{args.inner_splits}+1 times per outer fold x 40 outer folds)...')

    result = nested_calibrated_loso(df_features, label_col=args.label, model_name=args.model,
                                     method=args.method, n_inner_splits=args.inner_splits)
    result.to_csv(OUT_DIR / f'calibrated_oof_scores_{tag}.csv', index=False)

    y = result.y_true.to_numpy()
    raw = result.raw_score.to_numpy()
    calibrated = result.calibrated_score.to_numpy()

    before = summarize_calibration(y, raw)
    after = summarize_calibration(y, calibrated)

    print('\n=== Global metrics: before vs. after calibration ===')
    cmp = pd.DataFrame({'before': before, 'after': after})
    cmp['delta'] = cmp['after'] - cmp['before']
    print(cmp.to_string())
    cmp.to_csv(OUT_DIR / f'before_after_metrics_{tag}.csv')

    print('\n=== Reliability table: BEFORE calibration ===')
    rel_before = reliability_table(y, raw)
    print(rel_before.to_string())
    rel_before.to_csv(OUT_DIR / f'reliability_before_{tag}.csv')

    print('\n=== Reliability table: AFTER calibration ===')
    rel_after = reliability_table(y, calibrated)
    print(rel_after.to_string())
    rel_after.to_csv(OUT_DIR / f'reliability_after_{tag}.csv')

    # Per-subject calibration (ECE per subject, before vs after)
    per_subject = []
    for subj, g in result.groupby('subject'):
        b = summarize_calibration(g.y_true.to_numpy(), g.raw_score.to_numpy())
        a = summarize_calibration(g.y_true.to_numpy(), g.calibrated_score.to_numpy())
        per_subject.append({'subject': subj, 'n': len(g), 'ece_before': b['ece'], 'ece_after': a['ece'],
                             'auc_before': b['roc_auc'], 'auc_after': a['roc_auc']})
    per_subject_df = pd.DataFrame(per_subject)
    per_subject_df.to_csv(OUT_DIR / f'per_subject_calibration_{tag}.csv', index=False)
    print(f'\nPer-subject ECE: before mean={per_subject_df.ece_before.mean():.3f}, '
          f'after mean={per_subject_df.ece_after.mean():.3f}')

    # Per-task calibration (nested_calibrated_loso carries 'task' through per-row).
    per_task = []
    for task, g in result.groupby('task'):
        b = summarize_calibration(g.y_true.to_numpy(), g.raw_score.to_numpy())
        a = summarize_calibration(g.y_true.to_numpy(), g.calibrated_score.to_numpy())
        per_task.append({'task': task, 'n': len(g), 'ece_before': b['ece'], 'ece_after': a['ece'],
                          'auc_before': b['roc_auc'], 'auc_after': a['roc_auc']})
    per_task_df = pd.DataFrame(per_task)
    per_task_df.to_csv(OUT_DIR / f'per_task_calibration_{tag}.csv', index=False)
    print('\n=== Per-task calibration (before vs. after) ===')
    print(per_task_df.to_string(index=False))

    print(f'\nWrote outputs to {OUT_DIR}/')


if __name__ == '__main__':
    main()
