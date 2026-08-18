"""Grouped, nested post-hoc calibration for the T7/T8 task-state model.

Fixes the miscalibration found in results/FULL_PERFORMANCE_ANALYSIS.md
(ECE=0.237): the balanced-class-weight correction shifts the decision
function so ranking (AUC) stays valid but raw probabilities don't match
observed event rates.

Procedure, matching sklearn's CalibratedClassifierCV(ensemble=False)
semantics but implemented explicitly for clarity and to guarantee subject
grouping is respected at every level:

  Outer loop (LeaveOneGroupOut by subject, the usual LOSO):
    train_subjects (39) -> test_subject (1, held out, untouched until the end)
    Inner loop (GroupKFold by subject, within train_subjects only):
      fit the base model on inner-train, predict on inner-val
      -> pooled inner out-of-fold raw scores, used ONLY to fit the calibrator
    Fit calibrator (Platt=logistic-on-raw-score, or isotonic) on those OOF scores
    Fit the FINAL base model on all 39 train_subjects (not just inner-train)
    Apply: final_model -> raw score on test_subject; calibrator -> calibrated score
    (the calibrator never sees test_subject's data, at any level)
"""

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (balanced_accuracy_score, brier_score_loss, f1_score, log_loss,
                              precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GroupKFold, LeaveOneGroupOut

from .train import MODELS, feature_columns

EPS = 1e-7


def expected_calibration_error(y_true: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float:
    bins = np.linspace(0, 1, n_bins + 1)
    bin_idx = np.clip(np.digitize(p, bins) - 1, 0, n_bins - 1)
    ece = 0.0
    for b in range(n_bins):
        mask = bin_idx == b
        if mask.sum() == 0:
            continue
        ece += (mask.sum() / len(p)) * abs(y_true[mask].mean() - p[mask].mean())
    return float(ece)


def calibration_slope_intercept(y_true: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """Fit y ~ logit(p) via logistic regression; ideal calibration is slope=1, intercept=0.

    Undefined (NaN) when y_true has only one class present, e.g. a subset
    that's 100% one label (SAM40's Relax windows are always label_task=0) --
    logistic regression needs both classes to fit a slope at all.
    """
    if len(np.unique(y_true)) < 2:
        return float('nan'), float('nan')
    p_clip = np.clip(p, EPS, 1 - EPS)
    logit_p = np.log(p_clip / (1 - p_clip)).reshape(-1, 1)
    lr = LogisticRegression()
    lr.fit(logit_p, y_true)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def _fit_calibrator(method: str, raw_scores: np.ndarray, y: np.ndarray):
    if method == 'sigmoid':
        cal = LogisticRegression()
        cal.fit(raw_scores.reshape(-1, 1), y)
        return lambda s: cal.predict_proba(s.reshape(-1, 1))[:, 1]
    elif method == 'isotonic':
        cal = IsotonicRegression(out_of_bounds='clip', y_min=0, y_max=1)
        cal.fit(raw_scores, y)
        return lambda s: cal.predict(s)
    raise ValueError(f'unknown calibration method: {method}')


def _outer_fold(model_name, method, n_inner_splits, X, y, groups, train_idx, test_idx):
    train_groups = groups[train_idx]
    n_unique_train_groups = len(np.unique(train_groups))
    inner_splits = min(n_inner_splits, n_unique_train_groups)
    inner_cv = GroupKFold(n_splits=inner_splits)

    oof_scores = np.zeros(len(train_idx))
    for inner_train, inner_val in inner_cv.split(X[train_idx], y[train_idx], groups=train_groups):
        m = MODELS[model_name]()
        m.fit(X[train_idx][inner_train], y[train_idx][inner_train])
        oof_scores[inner_val] = m.predict_proba(X[train_idx][inner_val])[:, 1]

    calibrator = _fit_calibrator(method, oof_scores, y[train_idx])

    final_model = MODELS[model_name]()
    final_model.fit(X[train_idx], y[train_idx])
    raw_test = final_model.predict_proba(X[test_idx])[:, 1]
    calibrated_test = calibrator(raw_test)

    return {
        'subject': groups[test_idx][0],
        'test_idx': test_idx,
        'y_true': y[test_idx],
        'raw': raw_test,
        'calibrated': calibrated_test,
    }


def nested_calibrated_loso(df: pd.DataFrame, label_col: str = 'label_task', model_name: str = 'mlp',
                            method: str = 'sigmoid', n_inner_splits: int = 5, n_jobs: int = -1,
                            carry_cols: tuple = ('task', 'trial', 'window', 'window_start_sec')) -> pd.DataFrame:
    """Full grouped nested-calibration LOSO. Returns one row per window with
    columns: subject, y_true, raw_score, calibrated_score, plus any columns
    named in carry_cols (present in df) for downstream breakdowns (e.g. per-task).
    """
    data = df.dropna(subset=[label_col]).reset_index(drop=True)
    cols = feature_columns(data)
    X = data[cols].to_numpy()
    y = data[label_col].to_numpy().astype(int)
    groups = data['subject'].to_numpy()
    carry_cols = [c for c in carry_cols if c in data.columns]

    outer_cv = LeaveOneGroupOut()
    splits = list(outer_cv.split(X, y, groups))
    fold_results = Parallel(n_jobs=n_jobs)(
        delayed(_outer_fold)(model_name, method, n_inner_splits, X, y, groups, train_idx, test_idx)
        for train_idx, test_idx in splits
    )

    rows = []
    for fr in fold_results:
        test_idx = fr['test_idx']
        for i in range(len(test_idx)):
            row = {'subject': fr['subject'], 'y_true': fr['y_true'][i],
                   'raw_score': fr['raw'][i], 'calibrated_score': fr['calibrated'][i]}
            for c in carry_cols:
                row[c] = data.iloc[test_idx[i]][c]
            rows.append(row)
    return pd.DataFrame(rows)


def summarize_calibration(y_true: np.ndarray, scores: np.ndarray) -> dict:
    y_pred = (scores > 0.5).astype(int)
    slope, intercept = calibration_slope_intercept(y_true, scores)
    single_class = len(np.unique(y_true)) < 2
    return {
        # NaN (not 0.5/crash) when y_true is single-class (e.g. an all-Relax subset) --
        # AUC/log-loss are undefined there, not just hard to compute.
        'roc_auc': float('nan') if single_class else roc_auc_score(y_true, scores),
        'balanced_accuracy': balanced_accuracy_score(y_true, y_pred),
        'f1': f1_score(y_true, y_pred, zero_division=0),
        'precision': precision_score(y_true, y_pred, zero_division=0),
        'recall': recall_score(y_true, y_pred, zero_division=0),
        'brier_score': brier_score_loss(y_true, scores),
        'log_loss': float('nan') if single_class else log_loss(y_true, np.clip(scores, EPS, 1 - EPS)),
        'ece': expected_calibration_error(y_true, scores),
        'calibration_slope': slope,
        'calibration_intercept': intercept,
    }
