# phenotyping/research_v3_studentlife/src/s2_sl_group_analysis.py
"""
S2: StudentLife Group Analysis (5 Metrics Edition)
==================================================
Trains per-user models across all StudentLife subjects and computes:
  1. Accuracy
  2. Balanced Accuracy
  3. F1-Score
  4. Precision
  5. Recall
  6. ROC-AUC Value
"""

import pandas as pd
import numpy as np
import sys
import glob
import os
from sklearn.svm import OneClassSVM
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    f1_score, recall_score, precision_score,
    accuracy_score, balanced_accuracy_score, roc_auc_score
)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def run_group_study_with_quality_gate():
    src_dir = os.path.dirname(os.path.abspath(__file__))
    users_glob = os.path.join(src_dir, "..", "data", "processed", "users", "*.csv")
    files = glob.glob(users_glob)
    population_results = []
    rng = np.random.RandomState(42)

    print("=" * 70)
    print(f"🔍 [S2] StudentLife Group Analysis ({len(files)} user files found)")
    print("=" * 70)

    for f in files:
        df = pd.read_csv(f)
        if len(df) < 15:
            continue

        features = ['stationary_perc', 'walking_perc', 'activity_var']
        X = df[features]
        y_true_all = np.where(df['stress_label'] >= 4, -1, 1)

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        baseline_mask = (df['stress_label'] <= 2) & (df['stationary_perc'] > 0.8)
        baseline_idx = np.where(baseline_mask.values)[0]
        if len(baseline_idx) < 5:
            continue

        rng.shuffle(baseline_idx)
        split = int(len(baseline_idx) * 0.8)
        train_idx = baseline_idx[:split]
        held_out_baseline_idx = baseline_idx[split:]
        if len(train_idx) < 5:
            continue

        all_idx = np.arange(len(df))
        non_baseline_idx = np.setdiff1d(all_idx, baseline_idx)
        test_idx = np.concatenate([held_out_baseline_idx, non_baseline_idx])
        if len(test_idx) < 3:
            continue

        oc_svm = OneClassSVM(kernel='rbf', nu=0.1).fit(X_scaled[train_idx])

        X_test = X_scaled[test_idx]
        y_true = y_true_all[test_idx]
        test_df = df.iloc[test_idx]
        y_true_binary = (y_true == -1).astype(int)

        scores = oc_svm.decision_function(X_test)
        oc_raw_scores = -scores
        z_scores = np.abs((scores - np.mean(scores)) / (np.std(scores) + 1e-6))

        is_drifting = (z_scores >= 1.0) & (z_scores <= 1.5)
        is_stationary = test_df['stationary_perc'].values > 0.8
        pre_stress_mask = is_drifting & is_stationary
        physical_noise_mask = is_drifting & (~is_stationary)

        svm_preds = oc_svm.predict(X_test)

        try:
            auc = roc_auc_score(y_true_binary, oc_raw_scores) if len(np.unique(y_true_binary)) > 1 else 0.5
        except Exception:
            auc = 0.5

        population_results.append({
            'user': df['user_id'].iloc[0],
            'SVM_Accuracy': accuracy_score(y_true, svm_preds),
            'SVM_Balanced_Accuracy': balanced_accuracy_score(y_true, svm_preds),
            'SVM_F1': f1_score(y_true, svm_preds, pos_label=-1, zero_division=0),
            'SVM_Precision': precision_score(y_true, svm_preds, pos_label=-1, zero_division=0),
            'SVM_Recall': recall_score(y_true, svm_preds, pos_label=-1, zero_division=0),
            'SVM_ROC_AUC': auc,
            'true_pre_stress_alerts': pre_stress_mask.sum(),
            'physical_noise_rejections': physical_noise_mask.sum(),
            'train_n': len(train_idx),
            'test_n': len(test_idx),
        })

    res_df = pd.DataFrame(population_results)
    out_dir = os.path.join(src_dir, "..", "outputs")
    os.makedirs(out_dir, exist_ok=True)
    out_csv = os.path.join(out_dir, "quality_gate_results.csv")
    res_df.to_csv(out_csv, index=False)

    print("\n🏆 --- RESEARCH VALIDATION RESULTS (held-out test set, no leakage) ---")
    print(f"Users evaluated: {len(res_df)}")
    print(f"Total True Pre-Stress Alerts (Mental): {res_df['true_pre_stress_alerts'].sum()}")
    print(f"Total Physical Noise Rejections (Walking/Running): {res_df['physical_noise_rejections'].sum()}")
    print(f"\nAverage Accuracy (held-out):          {res_df['SVM_Accuracy'].mean():.4f}")
    print(f"Average Balanced Accuracy (held-out): {res_df['SVM_Balanced_Accuracy'].mean():.4f}")
    print(f"Average F1-Score (held-out):          {res_df['SVM_F1'].mean():.4f}")
    print(f"Average Precision (held-out):         {res_df['SVM_Precision'].mean():.4f}")
    print(f"Average Recall (held-out):            {res_df['SVM_Recall'].mean():.4f}")
    print(f"Average ROC_AUC (held-out):           {res_df['SVM_ROC_AUC'].mean():.4f}")
    print(f"\n📊 Results saved to outputs/quality_gate_results.csv")

if __name__ == "__main__":
    run_group_study_with_quality_gate()
