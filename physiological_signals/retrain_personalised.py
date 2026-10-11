"""Retrain the ring model on baseline-normalised features (fixes train-serve mismatch V1).

The live path (backend/physiological/predictor.py::predict_window) scores
features that were first normalised by the user's own calm baseline
(EDA features divided by the baseline mean, all others z-scored). The
original model (best_model_obj1_v2.pkl) was fitted on raw features, so the
live inputs were of a kind it never saw. This script fits the model on the
same normalisation, using the notebook 06 protocol:

  - each subject's baseline = mean/std of their first 3 Normal windows
    (backend N_BASELINE_WIN = 3), with the same minimum-std floor;
  - the same XGBoost parameters and balanced sample weights as notebook 06;
  - LOSO out-of-fold probabilities give the Youden-optimal decision threshold;
  - the final model is fitted on all 15 subjects.

Outputs (saved_models/, the v2 files are left untouched for rollback):
  best_model_obj1_v3.pkl, scaler_obj1_v3.pkl, feature_cols_obj1_v3.pkl,
  and results/objective1/personalised_v3_metrics.json
"""
import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import roc_auc_score, roc_curve, confusion_matrix, f1_score
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))
from utils.config import RESULTS_PATH, MODELS_PATH  # noqa: E402

N_BASELINE_WINDOWS = 3
EDA_FEATURES = {
    'SCL_mean', 'SCL_slope', 'SCL_std', 'EDA_mean', 'EDA_std', 'EDA_range',
    'EDA_slope', 'SCR_count', 'SCR_amp_mean', 'SCR_width_mean', 'EDA_q10',
    'EDA_q25', 'EDA_q75', 'EDA_q90', 'deriv1_mean', 'deriv1_std',
    'deriv2_mean', 'wavelet_approx_mean', 'wavelet_approx_energy',
    'wavelet_d1_energy', 'wavelet_d2_energy', 'wavelet_d3_energy',
}
XGB_PARAMS = dict(n_estimators=300, max_depth=6, learning_rate=0.1,
                  eval_metric='logloss', random_state=42, n_jobs=-1, verbosity=0)


def personal_baseline(X, y):
    """Same as predictor.compute_baseline(X, y, n_windows=3)."""
    normal = X[y == 0]
    if len(normal) == 0:
        normal = X[:N_BASELINE_WINDOWS]
    normal = normal[:N_BASELINE_WINDOWS]
    mean, std = normal.mean(axis=0), normal.std(axis=0)
    floor = np.where(np.abs(mean) * 0.10 < 0.01, 0.01, np.abs(mean) * 0.10)
    return mean, np.where(std < floor, floor, std)


def normalise(X, mean, std, cols):
    """Same as predictor.normalize_features()."""
    out = X.astype(np.float64).copy()
    for i, c in enumerate(cols):
        if c in EDA_FEATURES:
            out[:, i] = X[:, i] / mean[i] if abs(mean[i]) > 0.001 else X[:, i] - mean[i]
        else:
            out[:, i] = (X[:, i] - mean[i]) / std[i]
    return out


def normalise_all(X, y, subjects, cols):
    out = np.zeros_like(X, dtype=np.float64)
    for s in np.unique(subjects):
        m = subjects == s
        bm, bs = personal_baseline(X[m], y[m])
        out[m] = normalise(X[m], bm, bs, cols)
    return out


def fit(Xn, y):
    scaler = StandardScaler()
    Xs = scaler.fit_transform(Xn)
    model = xgb.XGBClassifier(**XGB_PARAMS)
    model.fit(Xs, y, sample_weight=compute_sample_weight('balanced', y))
    return model, scaler


def main():
    df = pd.read_csv(os.path.join(RESULTS_PATH, "objective1", "wesad_features_selected.csv"))
    cols = joblib.load(os.path.join(MODELS_PATH, "feature_cols_obj1_v2.pkl"))
    assert [c for c in df.columns if c not in ('label', 'subject_id')] == list(cols)
    X, y, subj = df[cols].values, df['label'].values, df['subject_id'].values
    Xn = normalise_all(X, y, subj, cols)

    oof = np.zeros(len(y))
    for s in np.unique(subj):
        te = subj == s
        model, scaler = fit(Xn[~te], y[~te])
        oof[te] = model.predict_proba(scaler.transform(Xn[te]))[:, 1]
        print(f"  fold S{s} done", flush=True)

    fpr, tpr, thr = roc_curve(y, oof)
    j = tpr - fpr
    k = int(np.argmax(j))
    threshold = float(thr[k])

    def report(t):
        p = (oof > t).astype(int)
        cm = confusion_matrix(y, p)
        return dict(threshold=float(t), accuracy=float((p == y).mean()),
                    f1_macro=float(f1_score(y, p, average='macro')),
                    f1_stress=float(f1_score(y, p, pos_label=1)),
                    recall_normal=float(cm[0, 0] / cm[0].sum()),
                    recall_stress=float(cm[1, 1] / cm[1].sum()),
                    confusion=cm.tolist())

    metrics = dict(auc=float(roc_auc_score(y, oof)), youden_j=float(j[k]),
                   tpr=float(tpr[k]), fpr=float(fpr[k]),
                   at_youden=report(threshold), at_0_5=report(0.5),
                   n_windows=int(len(y)), n_subjects=int(len(np.unique(subj))))
    print(json.dumps(metrics, indent=2))

    model, scaler = fit(Xn, y)
    joblib.dump(model, os.path.join(MODELS_PATH, "best_model_obj1_v3.pkl"))
    joblib.dump(scaler, os.path.join(MODELS_PATH, "scaler_obj1_v3.pkl"))
    joblib.dump(list(cols), os.path.join(MODELS_PATH, "feature_cols_obj1_v3.pkl"))
    with open(os.path.join(RESULTS_PATH, "objective1", "personalised_v3_metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    print("saved v3 artefacts")


if __name__ == "__main__":
    main()
