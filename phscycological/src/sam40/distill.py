"""Knowledge distillation: a teacher (richer channel set) guides a T7/T8 student.

The student minimizes a loss blended between the true label and the
teacher's soft probability:

    L = (1 - alpha) * loss(y_hard, p_student) + alpha * loss(p_teacher, p_student)

alpha=0 reduces to plain supervised training (no distillation) -- the
baseline every distilled run is compared against.

Two student families are supported:
  - 'logistic': DistilledLogisticStudent, a hand-rolled logistic regression
    fit by gradient descent directly on the blended BCE loss above.
  - anything else in STUDENT_MODEL_NAMES ('svm', 'random_forest', 'hist_gb',
    'mlp'): DistilledRegressionStudent, which reframes KD as regression --
    fit a regressor to predict the blended target
    t_i = (1-alpha)*y_hard_i + alpha*p_teacher_i (a continuous value in
    [0, 1]), then use the regressor's output as the probability. This is
    the standard way to extend soft-label KD to model families that don't
    expose a differentiable loss.

Both paths apply class-balanced weighting (see balance.py) -- label_task is
~75/25 imbalanced, and without this every model family here collapses to
predicting the majority class for everyone.
"""

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from scipy.optimize import minimize
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import balanced_accuracy_score, roc_auc_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR
from sklearn.utils.class_weight import compute_sample_weight

from .train import MODELS, feature_columns

EPS = 1e-7

STUDENT_MODEL_NAMES = ['logistic', 'svm', 'random_forest', 'hist_gb', 'mlp']


def _sigmoid(z):
    return 1 / (1 + np.exp(-z))


def _balanced_sample_weight(y_hard: np.ndarray) -> np.ndarray:
    return compute_sample_weight('balanced', y_hard)


class DistilledLogisticStudent:
    """Logistic regression fit with a hard-label + teacher-soft-label blended BCE loss."""

    def __init__(self, alpha: float = 0.5, l2: float = 1.0):
        self.alpha = alpha
        self.l2 = l2
        self.w_ = None
        self.b_ = 0.0

    def _loss_and_grad(self, params, X, y_hard, p_teacher, sample_weight):
        w, b = params[:-1], params[-1]
        z = X @ w + b
        p = _sigmoid(z)
        p_clip = np.clip(p, EPS, 1 - EPS)

        bce_hard = -(y_hard * np.log(p_clip) + (1 - y_hard) * np.log(1 - p_clip))
        bce_soft = -(p_teacher * np.log(p_clip) + (1 - p_teacher) * np.log(1 - p_clip))
        per_sample = (1 - self.alpha) * bce_hard + self.alpha * bce_soft
        loss = np.mean(sample_weight * per_sample)
        loss += self.l2 * np.sum(w ** 2) / (2 * len(y_hard))

        target_blend = (1 - self.alpha) * y_hard + self.alpha * p_teacher
        grad_z = sample_weight * (p - target_blend) / len(y_hard)
        grad_w = X.T @ grad_z + self.l2 * w / len(y_hard)
        grad_b = grad_z.sum()
        return loss, np.concatenate([grad_w, [grad_b]])

    def fit(self, X: np.ndarray, y_hard: np.ndarray, p_teacher: np.ndarray):
        n_features = X.shape[1]
        x0 = np.zeros(n_features + 1)
        sample_weight = _balanced_sample_weight(y_hard)
        result = minimize(
            self._loss_and_grad, x0, args=(X, y_hard, p_teacher, sample_weight),
            jac=True, method='L-BFGS-B',
        )
        self.w_, self.b_ = result.x[:-1], result.x[-1]
        return self

    def predict_proba1(self, X: np.ndarray) -> np.ndarray:
        return _sigmoid(X @ self.w_ + self.b_)


def _fit_regressor_weighted(model, X, target, sample_weight):
    try:
        model.fit(X, target, sample_weight=sample_weight)
    except TypeError:
        counts = np.maximum(1, np.round(sample_weight / sample_weight.min()).astype(int))
        idx = np.repeat(np.arange(len(X)), counts)
        model.fit(X[idx], target[idx])
    return model


_REGRESSOR_FACTORIES = {
    'svm': lambda: SVR(kernel='rbf'),
    'random_forest': lambda: RandomForestRegressor(n_estimators=300, random_state=0),
    'hist_gb': lambda: HistGradientBoostingRegressor(max_iter=200, random_state=0),
    'mlp': lambda: MLPRegressor(hidden_layer_sizes=(64, 32), max_iter=500, random_state=0,
                                 early_stopping=True),
}


class DistilledRegressionStudent:
    """KD-as-regression: fit a regressor to the alpha-blended continuous target."""

    def __init__(self, model_name: str, alpha: float = 0.5):
        self.model_name = model_name
        self.alpha = alpha
        self.model_ = None

    def fit(self, X: np.ndarray, y_hard: np.ndarray, p_teacher: np.ndarray):
        target = (1 - self.alpha) * y_hard + self.alpha * p_teacher
        sample_weight = _balanced_sample_weight(y_hard)
        self.model_ = _REGRESSOR_FACTORIES[self.model_name]()
        _fit_regressor_weighted(self.model_, X, target, sample_weight)
        return self

    def predict_proba1(self, X: np.ndarray) -> np.ndarray:
        return np.clip(self.model_.predict(X), 0.0, 1.0)


def make_student(model_name: str, alpha: float):
    if model_name == 'logistic':
        return DistilledLogisticStudent(alpha=alpha)
    return DistilledRegressionStudent(model_name, alpha=alpha)


def prepare_merged_arrays(student_df: pd.DataFrame, teacher_df: pd.DataFrame,
                           label_col: str = 'label_task', return_frame: bool = False):
    """Join student/teacher feature frames on their shared window identity.

    return_frame=True additionally returns the merged dataframe (with
    subject/task/trial/window intact) -- needed for block-level (per-trial)
    aggregation of window-level predictions, since the plain array outputs
    lose that identity.
    """
    key = ['subject', 'task', 'trial', 'window']
    merged = student_df.merge(teacher_df, on=key, suffixes=('_student', '_teacher'))
    label = f'{label_col}_student' if f'{label_col}_student' in merged.columns else label_col
    merged = merged.dropna(subset=[label]).reset_index(drop=True)

    student_cols = [c if c in merged.columns else f'{c}_student' for c in feature_columns(student_df)]
    teacher_cols = [c if c in merged.columns else f'{c}_teacher' for c in feature_columns(teacher_df)]

    X_student_all = merged[student_cols].to_numpy()
    X_teacher_all = merged[teacher_cols].to_numpy()
    y = merged[label].to_numpy().astype(int)
    groups = merged['subject'].to_numpy()
    if return_frame:
        return X_student_all, X_teacher_all, y, groups, merged[key]
    return X_student_all, X_teacher_all, y, groups


def _fit_teacher_fold(teacher_model_name, X_teacher_all, y, train_idx, test_idx):
    teacher = MODELS[teacher_model_name]()
    teacher.fit(X_teacher_all[train_idx], y[train_idx])
    p_train = teacher.predict_proba(X_teacher_all[train_idx])[:, 1]
    p_test = teacher.predict_proba(X_teacher_all[test_idx])[:, 1]
    return train_idx, test_idx, p_train, p_test


def compute_teacher_folds(X_teacher_all: np.ndarray, y: np.ndarray, groups: np.ndarray,
                           teacher_model_name: str = 'svm', n_jobs: int = -1) -> list:
    """Fit the teacher once per LOSO fold and cache its soft predictions."""
    logo = LeaveOneGroupOut()
    splits = list(logo.split(X_teacher_all, y, groups))
    return Parallel(n_jobs=n_jobs)(
        delayed(_fit_teacher_fold)(teacher_model_name, X_teacher_all, y, train_idx, test_idx)
        for train_idx, test_idx in splits
    )


def _fit_student_fold(student_model_name, alpha, X_student_all, y, groups,
                       train_idx, test_idx, p_teacher_train, p_teacher_test):
    held_out = groups[test_idx][0]

    scaler = StandardScaler().fit(X_student_all[train_idx])
    X_train = scaler.transform(X_student_all[train_idx])
    X_test = scaler.transform(X_student_all[test_idx])

    baseline = make_student(student_model_name, alpha=0.0).fit(X_train, y[train_idx], p_teacher_train)
    p_base = baseline.predict_proba1(X_test)

    distilled = make_student(student_model_name, alpha=alpha).fit(X_train, y[train_idx], p_teacher_train)
    p_dist = distilled.predict_proba1(X_test)

    y_true = y[test_idx]
    y_base_pred = (p_base > 0.5).astype(int)
    y_dist_pred = (p_dist > 0.5).astype(int)
    return {
        'subject': held_out,
        'n_test': len(test_idx),
        'teacher_roc_auc': _safe_auc(y_true, p_teacher_test),
        'baseline_acc': (y_base_pred == y_true).mean(),
        'distilled_acc': (y_dist_pred == y_true).mean(),
        'baseline_balanced_acc': balanced_accuracy_score(y_true, y_base_pred),
        'distilled_balanced_acc': balanced_accuracy_score(y_true, y_dist_pred),
        'baseline_roc_auc': _safe_auc(y_true, p_base),
        'distilled_roc_auc': _safe_auc(y_true, p_dist),
    }


def evaluate_student_with_teacher_cache(X_student_all: np.ndarray, y: np.ndarray, groups: np.ndarray,
                                         teacher_folds: list, student_model_name: str, alpha: float,
                                         n_jobs: int = -1) -> pd.DataFrame:
    """Evaluate one student model type/alpha against a precomputed teacher-fold cache."""
    rows = Parallel(n_jobs=n_jobs)(
        delayed(_fit_student_fold)(student_model_name, alpha, X_student_all, y, groups,
                                    train_idx, test_idx, p_train, p_test)
        for train_idx, test_idx, p_train, p_test in teacher_folds
    )
    return pd.DataFrame(rows)


def _fit_student_fold_oof(student_model_name, alpha, X_student_all, train_idx, test_idx,
                           p_teacher_train, y_train):
    scaler = StandardScaler().fit(X_student_all[train_idx])
    X_train = scaler.transform(X_student_all[train_idx])
    X_test = scaler.transform(X_student_all[test_idx])
    student = make_student(student_model_name, alpha=alpha).fit(X_train, y_train, p_teacher_train)
    return test_idx, student.predict_proba1(X_test)


def oof_student_scores(X_student_all: np.ndarray, y: np.ndarray, groups: np.ndarray,
                        teacher_folds: list, student_model_name: str, alpha: float,
                        n_jobs: int = -1) -> np.ndarray:
    """Out-of-fold predicted probability for every row, for one student config.

    Same shape/semantics as train.loso_oof_scores but for a distilled student --
    each row's score comes from a student whose training fold never included
    that row's subject (nor did the cached teacher fold it was distilled from).
    """
    fold_results = Parallel(n_jobs=n_jobs)(
        delayed(_fit_student_fold_oof)(student_model_name, alpha, X_student_all,
                                        train_idx, test_idx, p_train, y[train_idx])
        for train_idx, test_idx, p_train, p_test in teacher_folds
    )
    scores = np.full(len(y), np.nan)
    for test_idx, proba in fold_results:
        scores[test_idx] = proba
    return scores


def loso_distillation(
    student_df: pd.DataFrame,
    teacher_df: pd.DataFrame,
    label_col: str = 'label_task',
    teacher_model_name: str = 'svm',
    student_model_name: str = 'logistic',
    alpha: float = 0.5,
    n_jobs: int = -1,
) -> pd.DataFrame:
    """One-shot LOSO comparison of plain-supervised vs. distilled students.

    For sweeping multiple student models/alphas against the same teacher,
    call compute_teacher_folds once and reuse it directly instead.
    """
    X_student_all, X_teacher_all, y, groups = prepare_merged_arrays(student_df, teacher_df, label_col)
    teacher_folds = compute_teacher_folds(X_teacher_all, y, groups, teacher_model_name, n_jobs=n_jobs)
    return evaluate_student_with_teacher_cache(
        X_student_all, y, groups, teacher_folds, student_model_name, alpha, n_jobs=n_jobs)


def _safe_auc(y_true, p):
    if len(np.unique(y_true)) < 2:
        return np.nan
    return roc_auc_score(y_true, p)
