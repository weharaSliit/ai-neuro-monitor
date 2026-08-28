# phenotyping/research_v4_swell/src/s2_swell_trainer.py
"""
S2: SWELL Work Stress Trainer & Multi-Model Evaluator (Calibrated 5 Metrics Edition)
=====================================================================================
Includes:
  1. Multi-Feature Fusion (Keystrokes, Characters, Error Ratio, Mouse, App Switching)
  2. Per-User Automated Hyperparameter Tuning (optimal nu & gamma per participant)
  3. Evaluates all 5 academic metrics (Accuracy, Balanced Accuracy, F1, Precision, Recall, ROC-AUC)
"""

import pandas as pd
import numpy as np
import sys
from pathlib import Path
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    recall_score, f1_score, precision_score,
    accuracy_score, balanced_accuracy_score, roc_auc_score
)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "processed" / "swell_v4_processed.csv"

def run_personalized_test():
    print("=" * 75)
    print("🧠 [S2] SWELL Work Stress: Calibrated Multi-Model Evaluation (5 Metrics)")
    print("=" * 75)
    
    if not DATA.exists():
        print(f"❌ Error: {DATA} not found. Run s1_swell_preprocess.py first.")
        return

    df = pd.read_csv(DATA)
    features = ["SnKeyStrokes", "SnChars", "ErrorKeyRatio", "CharactersRatio", "SnMouseAct", "SnAppChange"]
    rng = np.random.RandomState(42)

    user_results = []
    for uid, u_df in df.groupby("PP"):
        scaler = StandardScaler()
        X = scaler.fit_transform(u_df[features])
        y = u_df["label"].values

        normal_idx = np.where(y == "normal")[0]
        stress_idx = np.where(y != "normal")[0]
        if len(normal_idx) < 5 or len(stress_idx) < 1:
            continue

        rng.shuffle(normal_idx)
        split = int(len(normal_idx) * 0.8)
        train_idx = normal_idx[:split]
        test_normal_idx = normal_idx[split:]
        if len(train_idx) < 5:
            continue

        X_train = X[train_idx]
        test_idx = np.concatenate([test_normal_idx, stress_idx])
        X_test = X[test_idx]
        y_test = np.where(np.isin(test_idx, stress_idx), -1, 1)
        y_test_binary = (y_test == -1).astype(int)

        # ── 1. One-Class SVM with Automated Hyperparameter Tuning ─────
        best_nu = 0.05
        best_gamma = 'scale'
        for nu_c in [0.01, 0.03, 0.05, 0.08, 0.10, 0.15]:
            for gamma_c in ['scale', 'auto', 0.05, 0.1]:
                m = OneClassSVM(kernel='rbf', nu=nu_c, gamma=gamma_c).fit(X_train)
                if (m.predict(X_train) == 1).mean() >= (1.0 - nu_c * 1.5):
                    best_nu = nu_c
                    best_gamma = gamma_c
                    break

        ocsvm = OneClassSVM(kernel='rbf', nu=best_nu, gamma=best_gamma).fit(X_train)
        ocsvm_preds = ocsvm.predict(X_test)
        oc_scores = -ocsvm.decision_function(X_test)

        # ── 2. Isolation Forest ──────────────────────────────────────
        iso = IsolationForest(contamination=best_nu, random_state=42).fit(X_train)
        iso_preds = iso.predict(X_test)
        iso_scores = -iso.decision_function(X_test)

        # ── 3. Random Forest (Supervised Benchmark) ──────────────────
        rf_train_idx = np.concatenate([train_idx, stress_idx[:len(train_idx)]])
        X_rf_train = X[rf_train_idx]
        y_rf_train = np.where(np.isin(rf_train_idx, stress_idx), -1, 1)
        rf = RandomForestClassifier(n_estimators=100, random_state=42).fit(X_rf_train, y_rf_train)
        rf_preds = rf.predict(X_test)
        rf_probs = rf.predict_proba(X_test)
        pos_idx = np.where(rf.classes_ == -1)[0]
        rf_anomaly_prob = rf_probs[:, pos_idx[0]] if len(pos_idx) > 0 else np.zeros(len(X_test))

        user_results.append({
            "User": uid,
            "OC-SVM Accuracy": accuracy_score(y_test, ocsvm_preds),
            "OC-SVM Balanced_Accuracy": balanced_accuracy_score(y_test, ocsvm_preds),
            "OC-SVM F1": f1_score(y_test, ocsvm_preds, pos_label=-1, zero_division=0),
            "OC-SVM Precision": precision_score(y_test, ocsvm_preds, pos_label=-1, zero_division=0),
            "OC-SVM Recall": recall_score(y_test, ocsvm_preds, pos_label=-1, zero_division=0),
            "OC-SVM ROC_AUC": roc_auc_score(y_test_binary, oc_scores),

            "IF Accuracy": accuracy_score(y_test, iso_preds),
            "IF Balanced_Accuracy": balanced_accuracy_score(y_test, iso_preds),
            "IF F1": f1_score(y_test, iso_preds, pos_label=-1, zero_division=0),
            "IF Precision": precision_score(y_test, iso_preds, pos_label=-1, zero_division=0),
            "IF Recall": recall_score(y_test, iso_preds, pos_label=-1, zero_division=0),
            "IF ROC_AUC": roc_auc_score(y_test_binary, iso_scores),

            "RF Accuracy": accuracy_score(y_test, rf_preds),
            "RF Balanced_Accuracy": balanced_accuracy_score(y_test, rf_preds),
            "RF F1": f1_score(y_test, rf_preds, pos_label=-1, zero_division=0),
            "RF Precision": precision_score(y_test, rf_preds, pos_label=-1, zero_division=0),
            "RF Recall": recall_score(y_test, rf_preds, pos_label=-1, zero_division=0),
            "RF ROC_AUC": roc_auc_score(y_test_binary, rf_anomaly_prob),

            "test_normal_n": len(test_normal_idx),
            "test_stress_n": len(stress_idx),
        })

    res_df = pd.DataFrame(user_results)

    # Save results for cross-dataset synthesis (s1_metric_aggregator.py)
    out_dir = ROOT / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    res_df.to_csv(out_dir / "swell_results.csv", index=False)

    print("\n🏆 PERSONALIZED RESULTS (MEAN ACROSS ALL USERS)")
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
    print(f"\n📊 Results saved to outputs/swell_results.csv")

if __name__ == "__main__":
    run_personalized_test()
