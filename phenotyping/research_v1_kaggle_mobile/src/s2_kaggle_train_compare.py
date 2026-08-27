# phenotyping/research_v1_kaggle_mobile/src/s2_kaggle_train_compare.py
"""
STEP 2: Train & Compare Models on Kaggle Mobile Biometrics (Calibrated 5 Metrics Edition)
==========================================================================================
1. Multi-Feature Fusion: Fuses Touch Dwell, Flight Time, Scroll Velocity, Tilt Angle, CPM
2. Automated Hyperparameter Calibration: Grid search for optimal nu & gamma per user
3. Computes: Accuracy, Balanced Accuracy, F1-Score, Precision, Recall, ROC-AUC
"""

import pandas as pd
import numpy as np
import joblib
import warnings
import sys
from pathlib import Path
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import (
    f1_score, precision_score, recall_score,
    accuracy_score, balanced_accuracy_score, roc_auc_score
)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

warnings.filterwarnings("ignore")

ROOT      = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "processed" / "kaggle_mobile_processed.csv"
MODEL_DIR = ROOT / "models"
OUT_DIR   = ROOT / "outputs"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

print("=" * 75)
print("  🔬 S2: Kaggle Mobile — Multi-Model Comparison (Calibrated 5 Metrics)")
print("=" * 75)

if not DATA_PATH.exists():
    print(f"❌ Processed data not found at {DATA_PATH}")
    print("   Run s1_kaggle_preprocess.py first.")
    exit()

df = pd.read_csv(DATA_PATH)

# Multi-Feature Fusion: include all high-signal mobile features
z_cols = ['avg_dwell_z', 'avg_flight_z', 'scroll_magnitude_z', 'tilt_axis_z', 'typing_speed_z']
for col in z_cols:
    if col in df.columns:
        df[col] = df[col].fillna(0)
print(f"\n📊 Fused Mobile Z-features ({len(z_cols)}): {z_cols}")

users = df["user_id"].unique()
print(f"👥 Total users: {len(users)}")

rng = np.random.RandomState(42)
all_results = []

for target_user in users:
    user_df    = df[df["user_id"] == target_user][z_cols].dropna()
    other_df   = df[df["user_id"] != target_user][z_cols].dropna()
    n_samples  = len(user_df)

    if n_samples < 20:
        continue

    n_other = min(n_samples, len(other_df))
    other_sample = other_df.sample(n=n_other, random_state=rng.randint(0, 9999))

    train_size    = int(n_samples * 0.8)
    X_train       = user_df.iloc[:train_size].values
    test_normal   = user_df.iloc[train_size:].values
    test_anomalous = other_sample.iloc[:len(test_normal)].values

    if len(test_normal) < 3 or len(test_anomalous) < 3:
        continue

    X_test = np.vstack([test_normal, test_anomalous])
    y_test = np.array([1] * len(test_normal) + [-1] * len(test_anomalous))
    y_test_binary = (y_test == -1).astype(int)

    result = {"user_id": target_user, "n_train": train_size,
              "n_test_normal": len(test_normal), "n_test_anomaly": len(test_anomalous)}

    # ── MODEL 1: One-Class SVM with Hyperparameter Tuning ────────
    best_nu = 0.05
    best_gamma = 'scale'
    for nu_cand in [0.01, 0.03, 0.05, 0.08, 0.10, 0.15]:
        for gamma_cand in ['scale', 'auto', 0.01, 0.05, 0.1]:
            clf = OneClassSVM(kernel='rbf', nu=nu_cand, gamma=gamma_cand).fit(X_train)
            if (clf.predict(X_train) == 1).mean() >= (1.0 - nu_cand * 1.5):
                best_nu = nu_cand
                best_gamma = gamma_cand
                break

    ocsvm = OneClassSVM(kernel="rbf", nu=best_nu, gamma=best_gamma)
    ocsvm.fit(X_train)
    y_pred_oc = ocsvm.predict(X_test)
    oc_scores = -ocsvm.decision_function(X_test)

    result["OC-SVM Accuracy"]          = accuracy_score(y_test, y_pred_oc)
    result["OC-SVM Balanced_Accuracy"] = balanced_accuracy_score(y_test, y_pred_oc)
    result["OC-SVM F1"]                = f1_score(y_test, y_pred_oc, pos_label=-1, zero_division=0)
    result["OC-SVM Precision"]         = precision_score(y_test, y_pred_oc, pos_label=-1, zero_division=0)
    result["OC-SVM Recall"]            = recall_score(y_test, y_pred_oc, pos_label=-1, zero_division=0)
    try:
        result["OC-SVM ROC_AUC"]       = roc_auc_score(y_test_binary, oc_scores)
    except Exception:
        result["OC-SVM ROC_AUC"]       = 0.5

    # ── MODEL 2: Isolation Forest ────────────────────────────────
    iso = IsolationForest(contamination=best_nu, random_state=42)
    iso.fit(X_train)
    y_pred_iso = iso.predict(X_test)
    iso_scores = -iso.decision_function(X_test)

    result["IF Accuracy"]          = accuracy_score(y_test, y_pred_iso)
    result["IF Balanced_Accuracy"] = balanced_accuracy_score(y_test, y_pred_iso)
    result["IF F1"]                = f1_score(y_test, y_pred_iso, pos_label=-1, zero_division=0)
    result["IF Precision"]         = precision_score(y_test, y_pred_iso, pos_label=-1, zero_division=0)
    result["IF Recall"]            = recall_score(y_test, y_pred_iso, pos_label=-1, zero_division=0)
    try:
        result["IF ROC_AUC"]       = roc_auc_score(y_test_binary, iso_scores)
    except Exception:
        result["IF ROC_AUC"]       = 0.5

    # ── MODEL 3: Random Forest (Supervised Benchmark) ────────────
    rf_others_size = min(train_size, len(other_df))
    rf_others_x    = other_df.sample(n=rf_others_size,
                                     random_state=rng.randint(0, 9999)).values
    X_rf_train = np.vstack([X_train, rf_others_x])
    y_rf_train = np.array([1] * train_size + [-1] * rf_others_size)
    rf = RandomForestClassifier(n_estimators=100, random_state=42)
    rf.fit(X_rf_train, y_rf_train)
    y_pred_rf = rf.predict(X_test)
    rf_probs = rf.predict_proba(X_test)
    pos_idx = np.where(rf.classes_ == -1)[0]
    rf_anomaly_prob = rf_probs[:, pos_idx[0]] if len(pos_idx) > 0 else np.zeros(len(X_test))

    result["RF Accuracy"]          = accuracy_score(y_test, y_pred_rf)
    result["RF Balanced_Accuracy"] = balanced_accuracy_score(y_test, y_pred_rf)
    result["RF F1"]                = f1_score(y_test, y_pred_rf, pos_label=-1, zero_division=0)
    result["RF Precision"]         = precision_score(y_test, y_pred_rf, pos_label=-1, zero_division=0)
    result["RF Recall"]            = recall_score(y_test, y_pred_rf, pos_label=-1, zero_division=0)
    try:
        result["RF ROC_AUC"]       = roc_auc_score(y_test_binary, rf_anomaly_prob)
    except Exception:
        result["RF ROC_AUC"]       = 0.5

    all_results.append(result)

# ── Summary ───────────────────────────────────────────────────────────
res_df = pd.DataFrame(all_results)
res_df.to_csv(OUT_DIR / "kaggle_results.csv", index=False)

print("\n" + "=" * 75)
print("  🏆 MEAN RESULTS ACROSS ALL USERS (5 Metrics)")
print("=" * 75)

summary_table = pd.DataFrame({
    "Accuracy": [
        res_df["OC-SVM Accuracy"].mean(),
        res_df["IF Accuracy"].mean(),
        res_df["RF Accuracy"].mean()
    ],
    "Balanced_Accuracy": [
        res_df["OC-SVM Balanced_Accuracy"].mean(),
        res_df["IF Balanced_Accuracy"].mean(),
        res_df["RF Balanced_Accuracy"].mean()
    ],
    "F1-Score": [
        res_df["OC-SVM F1"].mean(),
        res_df["IF F1"].mean(),
        res_df["RF F1"].mean()
    ],
    "Precision": [
        res_df["OC-SVM Precision"].mean(),
        res_df["IF Precision"].mean(),
        res_df["RF Precision"].mean()
    ],
    "Recall": [
        res_df["OC-SVM Recall"].mean(),
        res_df["IF Recall"].mean(),
        res_df["RF Recall"].mean()
    ],
    "ROC_AUC": [
        res_df["OC-SVM ROC_AUC"].mean(),
        res_df["IF ROC_AUC"].mean(),
        res_df["RF ROC_AUC"].mean()
    ]
}, index=["One-Class SVM", "Isolation Forest", "Random Forest"])

print(summary_table.round(4).to_string())

if len(res_df) > 0:
    best_user = res_df.loc[res_df["OC-SVM F1"].idxmax(), "user_id"]
    best_user_df  = df[df["user_id"] == best_user][z_cols].dropna()
    train_size    = int(len(best_user_df) * 0.8)
    X_best_train  = best_user_df.iloc[:train_size].values
    best_model    = OneClassSVM(kernel="rbf", nu=0.05, gamma="scale").fit(X_best_train)
    joblib.dump(best_model, MODEL_DIR / f"kaggle_ocsvm_{best_user}.joblib")

print(f"\n📊 Results saved to: {OUT_DIR / 'kaggle_results.csv'}")
