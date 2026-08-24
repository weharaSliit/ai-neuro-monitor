import pandas as pd
import numpy as np
import joblib
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score, precision_score, recall_score
import os
import warnings

# Suppress unnecessary warnings
warnings.filterwarnings("ignore")

# Configuration
PROCESSED_DATA = "../data/processed/cmu_refined.csv"
MODEL_DIR = "../models/"
os.makedirs(MODEL_DIR, exist_ok=True)

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
    
    results = []

    # --- MODEL 1: One-Class SVM (The Sensitivity Specialist) ---
    # Good for detecting the "Drift" into Pre-Stress
    ocsvm = OneClassSVM(kernel="rbf", nu=0.1, gamma='scale')
    ocsvm.fit(X_train_normal)
    y_pred_oc = ocsvm.predict(X_test)
    results.append({
        "Model": "One-Class SVM",
        "F1-Score": f1_score(y_test, y_pred_oc, pos_label=-1),
        "Recall": recall_score(y_test, y_pred_oc, pos_label=-1)
    })

    # --- MODEL 2: Isolation Forest (The Outlier Specialist) ---
    # Good for detecting sudden "Bursts" of stress
    iso = IsolationForest(contamination=0.1, random_state=42)
    iso.fit(X_train_normal)
    y_pred_iso = iso.predict(X_test)
    results.append({
        "Model": "Isolation Forest",
        "F1-Score": f1_score(y_test, y_pred_iso, pos_label=-1),
        "Recall": recall_score(y_test, y_pred_iso, pos_label=-1)
    })

    # --- MODEL 3: Random Forest (The Benchmark) ---
    # We create a balanced training set for RF (User vs Others)
    rf_others = other_df.iloc[train_size : train_size + train_size].values
    X_rf_train = np.vstack([X_train_normal, rf_others])
    y_rf_train = [1]*len(X_train_normal) + [-1]*len(rf_others)
    
    rf = RandomForestClassifier(n_estimators=100, random_state=42)
    rf.fit(X_rf_train, y_rf_train)
    y_pred_rf = rf.predict(X_test)
    results.append({
        "Model": "Random Forest",
        "F1-Score": f1_score(y_test, y_pred_rf, pos_label=-1),
        "Recall": recall_score(y_test, y_pred_rf, pos_label=-1)
    })

    # Save the One-Class SVM as the production model 
    # (It is best for personalized pre-stress drift)
    model_path = f"{MODEL_DIR}pre_stress_detector_s002.joblib"
    joblib.dump(ocsvm, model_path)
    
    report = pd.DataFrame(results)
    
    # Save results for cross-dataset synthesis (s1_metric_aggregator.py)
    os.makedirs("../outputs/", exist_ok=True)
    report.to_csv("../outputs/cmu_results.csv", index=False)
    
    print(f"\nResults for User {target_user} ({n_samples} total samples):")
    print(report.to_string(index=False))
    print(f"\n✅ Final Model Saved: {model_path}")
    print(f"📊 Results saved to ../outputs/cmu_results.csv")

run_robust_experiment()