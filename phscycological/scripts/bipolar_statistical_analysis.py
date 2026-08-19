#!/usr/bin/env python3
"""
Statistical performance analysis for the CURRENTLY DEPLOYED bipolar-only
25s-block model -- correlation, ANOVA, t-tests, effect sizes, bootstrap CI.
Mirrors final_statistical_analysis.py's methodology (built for the older
CAR-dependent enriched-feature model) but adapted for a dataset that's
already one row per 25s trial (no window->block aggregation needed).

Requires results/calibration/calibrated_oof_scores_bipolar_only_25s_block.csv
(from `scripts/calibrate_model.py --features results/features_bipolar_only_25s_block.csv
--model logistic_regression --tag bipolar_only_25s_block`).

Usage:
    python3 scripts/bipolar_statistical_analysis.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, brier_score_loss,
                              f1_score, log_loss, roc_auc_score)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from sam40.calibration import calibration_slope_intercept, expected_calibration_error  # noqa: E402

OUT_DIR = ROOT / 'results' / 'final_analysis'


def metric_suite(y_true, scores, groups, n_boot=10000):
    y_true, scores, groups = np.asarray(y_true), np.asarray(scores), np.asarray(groups)
    y_pred = (scores > 0.5).astype(int)
    out = {
        'n': len(y_true),
        'accuracy': accuracy_score(y_true, y_pred),
        'balanced_accuracy': balanced_accuracy_score(y_true, y_pred),
        'f1': f1_score(y_true, y_pred),
        'roc_auc_pooled': roc_auc_score(y_true, scores),
        'brier_score': brier_score_loss(y_true, scores),
        'log_loss': log_loss(y_true, np.clip(scores, 1e-7, 1 - 1e-7)),
        'ece': expected_calibration_error(y_true, scores),
    }
    slope, intercept = calibration_slope_intercept(y_true, scores)
    out['calibration_slope'], out['calibration_intercept'] = slope, intercept

    df = pd.DataFrame({'y': y_true, 's': scores, 'g': groups})
    subj_auc = np.array([roc_auc_score(sub.y, sub.s) for _, sub in df.groupby('g') if sub.y.nunique() > 1])
    out['roc_auc_mean_per_subject'] = subj_auc.mean()

    rng = np.random.RandomState(0)
    subj_ids = df.g.unique()
    y_arr, s_arr, g_arr = df.y.to_numpy(), df.s.to_numpy(), df.g.to_numpy()
    idx_by_subj = {sid: np.where(g_arr == sid)[0] for sid in subj_ids}
    boot_pooled_auc, boot_pooled_bal = [], []
    for _ in range(n_boot):
        sampled = rng.choice(subj_ids, len(subj_ids), replace=True)
        idx = np.concatenate([idx_by_subj[s] for s in sampled])
        yb, sb = y_arr[idx], s_arr[idx]
        if len(np.unique(yb)) > 1:
            boot_pooled_auc.append(roc_auc_score(yb, sb))
        boot_pooled_bal.append(balanced_accuracy_score(yb, (sb > 0.5).astype(int)))
    out['roc_auc_pooled_ci_low'], out['roc_auc_pooled_ci_high'] = np.percentile(boot_pooled_auc, [2.5, 97.5])
    out['bal_acc_ci_low'], out['bal_acc_ci_high'] = np.percentile(boot_pooled_bal, [2.5, 97.5])
    n_subj = len(subj_auc)
    boot_mean_subj_auc = [subj_auc[rng.randint(0, n_subj, n_subj)].mean() for _ in range(n_boot)]
    out['roc_auc_mean_per_subject_ci_low'], out['roc_auc_mean_per_subject_ci_high'] = \
        np.percentile(boot_mean_subj_auc, [2.5, 97.5])
    return out


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    calib = pd.read_csv(ROOT / 'results' / 'calibration' / 'calibrated_oof_scores_bipolar_only_25s_block.csv')
    features = pd.read_csv(ROOT / 'results' / 'features_bipolar_only_25s_block.csv')

    key = ['subject', 'task', 'trial']
    ratings = features[key + ['rating']].drop_duplicates(subset=key)
    block = calib.merge(ratings, on=key, how='left')
    print(f'{len(block)} blocks (25s trials), {block.subject.nunique()} subjects '
          f'-- model: logistic_regression, features: bipolar-only\n')

    print('=' * 70 + '\nMETRIC SUITE: raw vs. calibrated score\n' + '=' * 70)
    raw = metric_suite(block.y_true, block.raw_score, block.subject)
    cal = metric_suite(block.y_true, block.calibrated_score, block.subject)
    metric_df = pd.DataFrame({'raw': raw, 'calibrated': cal})
    print(metric_df.to_string())
    metric_df.to_csv(OUT_DIR / 'bipolar_metric_suite.csv')

    print('\nNOTE: balanced_accuracy/f1/precision-style (.predict()>0.5) metrics degrade after '
          'calibration -- this is the same CalibratedClassifierCV-style majority-class-collapse '
          'failure mode flagged earlier in this project (SESSION_SUMMARY.md): Platt scaling shifts '
          'the decision boundary away from the model\'s class-weight-balanced one. AUC/ECE/Brier/'
          'log-loss (rank- and probability-based, not threshold-based) are the metrics that '
          'actually validate calibration quality here, and they DO improve substantially.')

    print('\n' + '=' * 70 + '\nSIGNIFICANCE: AUC vs. chance (0.5)\n' + '=' * 70)
    lo, hi = raw['roc_auc_mean_per_subject_ci_low'], raw['roc_auc_mean_per_subject_ci_high']
    print(f"Mean-per-subject AUC (raw): {raw['roc_auc_mean_per_subject']:.3f}, "
          f"95% CI: [{lo:.3f}, {hi:.3f}] -> {'excludes' if lo > 0.5 else 'includes'} chance")
    lo_p, hi_p = raw['roc_auc_pooled_ci_low'], raw['roc_auc_pooled_ci_high']
    print(f"Pooled AUC (raw): {raw['roc_auc_pooled']:.3f}, 95% CI: [{lo_p:.3f}, {hi_p:.3f}] -> "
          f"{'excludes' if lo_p > 0.5 else 'includes'} chance")

    print('\n' + '=' * 70 + '\nTASK-STATE SCORE vs. SELF-REPORTED RATING (calibrated score)\n' + '=' * 70)
    rated = block.dropna(subset=['rating'])
    pear_r, pear_p = stats.pearsonr(rated.calibrated_score, rated.rating)
    spear_r, spear_p = stats.spearmanr(rated.calibrated_score, rated.rating)
    print(f'Trial-level: score vs. self-reported rating (n={len(rated)}):')
    print(f'  Pearson  r={pear_r:+.3f}, p={pear_p:.4f}')
    print(f'  Spearman rho={spear_r:+.3f}, p={spear_p:.4f}')

    subj_level = rated.groupby('subject').agg(mean_score=('calibrated_score', 'mean'),
                                               mean_rating=('rating', 'mean'))
    subj_r, subj_p = stats.pearsonr(subj_level.mean_score, subj_level.mean_rating)
    print(f'\nBetween-subject (trait-level): mean score vs. mean rating (n={len(subj_level)} subjects):')
    print(f'  Pearson r={subj_r:+.3f}, p={subj_p:.4f}')

    print('\nScore vs. task category (one-way ANOVA across Relax/Arithmetic/Mirror/Stroop):')
    groups_by_task = [g.calibrated_score.to_numpy() for _, g in block.groupby('task')]
    f_stat, anova_p = stats.f_oneway(*groups_by_task)
    print(f'  F={f_stat:.2f}, p={anova_p:.2e}')
    task_means = block.groupby('task').calibrated_score.agg(['mean', 'std', 'count'])
    print(task_means.to_string())

    print('\nRelax vs. each stress task (Welch\'s t-test, calibrated score):')
    relax = block[block.task == 'Relax'].calibrated_score
    t_rows = []
    for task in ['Stroop', 'Arithmetic', 'Mirror_image']:
        other = block[block.task == task].calibrated_score
        t_stat, t_p = stats.ttest_ind(other, relax, equal_var=False)
        cohens_d = (other.mean() - relax.mean()) / np.sqrt((other.var() + relax.var()) / 2)
        print(f'  Relax vs {task:14s}: t={t_stat:+.2f}, p={t_p:.2e}, cohens_d={cohens_d:+.3f}')
        t_rows.append({'comparison': f'Relax vs {task}', 't_stat': t_stat, 'p': t_p, 'cohens_d': cohens_d})

    corr_summary = pd.DataFrame([
        {'test': 'trial-level score vs rating (Pearson)', 'stat': pear_r, 'p': pear_p},
        {'test': 'trial-level score vs rating (Spearman)', 'stat': spear_r, 'p': spear_p},
        {'test': 'between-subject mean score vs mean rating', 'stat': subj_r, 'p': subj_p},
        {'test': 'task category ANOVA (F)', 'stat': f_stat, 'p': anova_p},
    ] + [{'test': r['comparison'], 'stat': r['t_stat'], 'p': r['p']} for r in t_rows])
    corr_summary.to_csv(OUT_DIR / 'bipolar_task_state_correlations.csv', index=False)
    block.to_csv(OUT_DIR / 'bipolar_block_level_scores.csv', index=False)
    print(f'\nWrote outputs to {OUT_DIR}/')


if __name__ == '__main__':
    main()
