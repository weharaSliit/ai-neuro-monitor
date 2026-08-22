"""Leave-one-subject-out (LOSO) evaluation for stress classifiers (SAM40 T7/T8, or neurostress FT7/8 & C5/6)."""

import warnings

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, f1_score,
                              roc_auc_score)
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from .balance import BalancedWrapper

NON_FEATURE_COLS = {
    'subject', 'task', 'trial', 'window', 'window_start_sec', 'rating', 'label_task', 'label_rating',
    # neurostress dataset (StressResilience_Dataset) columns:
    'phase', 'label_stress',
    # STEW dataset columns:
    'class_012', 'label_workload',
}

# SVC(probability=True)'s .predict() uses the (class-weight-adjusted) decision
# function, not the Platt-scaled probabilities -- that mismatch is intentional
# upstream, not a bug here, so silence the deprecation nudge toward
# CalibratedClassifierCV (which changes .predict() behavior, see loso_evaluate).
warnings.filterwarnings('ignore', message='The `probability` parameter was deprecated')

MODELS = {
    'svm': lambda: make_pipeline(StandardScaler(), SVC(kernel='rbf', probability=True, class_weight='balanced')),
    'random_forest': lambda: RandomForestClassifier(n_estimators=300, class_weight='balanced', random_state=0),
    'logistic_regression': lambda: make_pipeline(
        StandardScaler(), LogisticRegression(class_weight='balanced', max_iter=2000)),
    # HistGradientBoostingClassifier and MLPClassifier have no class_weight
    # support (and MLPClassifier's fit() doesn't take sample_weight either),
    # so both go through BalancedWrapper to avoid the majority-class collapse.
    'hist_gb': lambda: BalancedWrapper(
        lambda: HistGradientBoostingClassifier(max_iter=200, random_state=0)),
    'mlp': lambda: make_pipeline(
        StandardScaler(),
        BalancedWrapper(lambda: MLPClassifier(
            hidden_layer_sizes=(64, 32), max_iter=500, random_state=0, early_stopping=True)),
    ),
}


def feature_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in NON_FEATURE_COLS]


def _fit_one_fold(model_name, X, y, groups, train_idx, test_idx):
    held_out = groups[test_idx][0]
    model = MODELS[model_name]()
    model.fit(X[train_idx], y[train_idx])

    y_pred = model.predict(X[test_idx])
    y_true = y[test_idx]

    row = {
        'subject': held_out,
        'n_test': len(test_idx),
        'accuracy': accuracy_score(y_true, y_pred),
        'balanced_accuracy': balanced_accuracy_score(y_true, y_pred),
        'f1': f1_score(y_true, y_pred, zero_division=0),
    }
    if hasattr(model, 'predict_proba') and len(np.unique(y_true)) > 1:
        y_proba = model.predict_proba(X[test_idx])[:, 1]
        row['roc_auc'] = roc_auc_score(y_true, y_proba)
    return row


def loso_evaluate(df: pd.DataFrame, label_col: str = 'label_task',
                   model_name: str = 'svm', n_jobs: int = -1) -> pd.DataFrame:
    """Leave-one-subject-out CV. Returns per-fold metrics, one row per held-out subject.

    IMPORTANT: fits scaling/model per fold, on the training subjects only --
    never on data that includes the held-out subject. Folds are independent,
    so they're run in parallel processes (n_jobs=-1 -> all cores) -- LOSO with
    an RBF SVM on this feature count is slow enough per-fold (tens of seconds)
    that serial execution dominates runtime otherwise.
    """
    data = df.dropna(subset=[label_col]).reset_index(drop=True)
    X = data[feature_columns(data)].to_numpy()
    y = data[label_col].to_numpy().astype(int)
    groups = data['subject'].to_numpy()

    logo = LeaveOneGroupOut()
    splits = list(logo.split(X, y, groups))
    rows = Parallel(n_jobs=n_jobs)(
        delayed(_fit_one_fold)(model_name, X, y, groups, train_idx, test_idx)
        for train_idx, test_idx in splits
    )

    return pd.DataFrame(rows)


def summarize(results: pd.DataFrame) -> pd.Series:
    metric_cols = [c for c in results.columns if c not in ('subject', 'n_test')]
    return results[metric_cols].mean()


def _fit_one_fold_oof(model_name, X, y, train_idx, test_idx):
    model = MODELS[model_name]()
    model.fit(X[train_idx], y[train_idx])
    return test_idx, model.predict_proba(X[test_idx])[:, 1]


def loso_oof_scores(df: pd.DataFrame, label_col: str = 'label_task',
                     model_name: str = 'svm', n_jobs: int = -1) -> pd.DataFrame:
    """Out-of-fold predicted stress probability for every row, via LOSO.

    Each row's score comes from a model that never saw that row's subject
    during training -- safe to use for trend/plotting analysis without leakage.
    Returns the input rows (label_col non-null only) with an added 'task_state_score' column.
    """
    data = df.dropna(subset=[label_col]).reset_index(drop=True)
    X = data[feature_columns(data)].to_numpy()
    y = data[label_col].to_numpy().astype(int)
    groups = data['subject'].to_numpy()

    logo = LeaveOneGroupOut()
    splits = list(logo.split(X, y, groups))
    fold_results = Parallel(n_jobs=n_jobs)(
        delayed(_fit_one_fold_oof)(model_name, X, y, train_idx, test_idx)
        for train_idx, test_idx in splits
    )

    scores = np.full(len(data), np.nan)
    for test_idx, proba in fold_results:
        scores[test_idx] = proba

    data = data.copy()
    data['task_state_score'] = scores
    return data
