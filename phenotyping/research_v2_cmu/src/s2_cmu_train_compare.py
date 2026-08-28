import pandas as pd
import numpy as np
import joblib
import os
import sys
import warnings
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    f1_score, precision_score, recall_score,
    accuracy_score, balanced_accuracy_score, roc_auc_score
)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Suppress unnecessary warnings
warnings.filterwarnings("ignore")

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PROCESSED_DATA = os.path.join(ROOT_DIR, "..", "data", "processed", "cmu_refined.csv")
MODEL_DIR = os.path.join(ROOT_DIR, "..", "models")
OUTPUT_DIR = os.path.join(ROOT_DIR, "..", "outputs")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

print("="*60)
print(" 🔬 S2: DYNAMIC MULTI-MODEL COMPARISON (FIXED)")
print("="*60)

if not os.path.exists(PROCESSED_DATA):
    print(f"❌ Error: {PROCESSED_DATA} not found. Run s1 first.")
    exit()

df = pd.read_csv(PROCESSED_DATA)
# We only use the Z-normalized behavioral features we engineered in S1
features = [c for c in df.columns if "_z" in c]

def run_robust_experiment():
    target_user = "s002"
    
    # 1. Prepare User Data (Normal)
    user_df = df[df["subject"] == target_user][features]
    n_samples = len(user_df)
    
    if n_samples < 50:
        print(f"❌ Not enough data for user {target_user} after cleaning.")
        return
    
    # 2. Prepare Other Data (Anomalies/Stress Proxy)
    # We sample exactly the same amount of 'other' data to keep the test balanced
    other_df = df[df["subject"] != target_user][features].sample(n_samples, random_state=42)
    
    # 3. Dynamic Splitting (80% for Baseline training, 20% for testing)
    train_size = int(n_samples * 0.8)
    
    # Training Set (Only Normal data)
    X_train_normal = user_df.iloc[:train_size].values
    
    # Testing Set (Mix of Normal and Anomalous)
    test_normal = user_df.iloc[train_size:].values
    test_anomalous = other_df.iloc[:len(test_normal)].values
    
    X_test = np.vstack([test_normal, test_anomalous])
    y_test = [1]*len(test_normal) + [-1]*len(test_anomalous)
    
    y_test_binary = (np.array(y_test) == -1).astype(int)
    results = []

    # --- MODEL 1: One-Class SVM (The Sensitivity Specialist) ---
    ocsvm = OneClassSVM(kernel="rbf", nu=0.1, gamma='scale')
    ocsvm.fit(X_train_normal)
    y_pred_oc = ocsvm.predict(X_test)
    oc_scores = -ocsvm.decision_function(X_test)
    results.append({
        "Model": "One-Class SVM",
        "Accuracy": accuracy_score(y_test, y_pred_oc),
        "Balanced_Accuracy": balanced_accuracy_score(y_test, y_pred_oc),
        "F1-Score": f1_score(y_test, y_pred_oc, pos_label=-1, zero_division=0),
        "Precision": precision_score(y_test, y_pred_oc, pos_label=-1, zero_division=0),
        "Recall": recall_score(y_test, y_pred_oc, pos_label=-1, zero_division=0),
        "ROC_AUC": roc_auc_score(y_test_binary, oc_scores)
    })

    # --- MODEL 2: Isolation Forest (The Outlier Specialist) ---
    iso = IsolationForest(contamination=0.1, random_state=42)
    iso.fit(X_train_normal)
    y_pred_iso = iso.predict(X_test)
    iso_scores = -iso.decision_function(X_test)
    results.append({
        "Model": "Isolation Forest",
        "Accuracy": accuracy_score(y_test, y_pred_iso),
        "Balanced_Accuracy": balanced_accuracy_score(y_test, y_pred_iso),
        "F1-Score": f1_score(y_test, y_pred_iso, pos_label=-1, zero_division=0),
        "Precision": precision_score(y_test, y_pred_iso, pos_label=-1, zero_division=0),
        "Recall": recall_score(y_test, y_pred_iso, pos_label=-1, zero_division=0),
        "ROC_AUC": roc_auc_score(y_test_binary, iso_scores)
    })

    # --- MODEL 3: Random Forest (The Benchmark) ---
    rf_others = other_df.iloc[train_size : train_size + train_size].values
    X_rf_train = np.vstack([X_train_normal, rf_others])
    y_rf_train = [1]*len(X_train_normal) + [-1]*len(rf_others)
    
    rf = RandomForestClassifier(n_estimators=100, random_state=42)
    rf.fit(X_rf_train, y_rf_train)
    y_pred_rf = rf.predict(X_test)
    rf_probs = rf.predict_proba(X_test)
    pos_idx = np.where(rf.classes_ == -1)[0]
    rf_anomaly_prob = rf_probs[:, pos_idx[0]] if len(pos_idx) > 0 else np.zeros(len(X_test))

    results.append({
        "Model": "Random Forest",
        "Accuracy": accuracy_score(y_test, y_pred_rf),
        "Balanced_Accuracy": balanced_accuracy_score(y_test, y_pred_rf),
        "F1-Score": f1_score(y_test, y_pred_rf, pos_label=-1, zero_division=0),
        "Precision": precision_score(y_test, y_pred_rf, pos_label=-1, zero_division=0),
        "Recall": recall_score(y_test, y_pred_rf, pos_label=-1, zero_division=0),
        "ROC_AUC": roc_auc_score(y_test_binary, rf_anomaly_prob)
    })

    # Save the One-Class SVM as the production model 
    model_path = os.path.join(MODEL_DIR, "pre_stress_detector_s002.joblib")
    joblib.dump(ocsvm, model_path)
    
    report = pd.DataFrame(results)
    
    # Save results for cross-dataset synthesis (s1_metric_aggregator.py)
    out_csv = os.path.join(OUTPUT_DIR, "cmu_results.csv")
    report.to_csv(out_csv, index=False)
    
    print(f"\nResults for User {target_user} ({n_samples} total samples):")
    print(report.round(4).to_string(index=False))
    print(f"\n✅ Final Model Saved: {model_path}")
    print(f"📊 Results saved to {out_csv}")

run_robust_experiment()