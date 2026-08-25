#This trains 60 models and gives you the Final Research Metric (the average accuracy of your theory).
#This script implements your Pre-Stress (Z-Score) logic across the whole group and compares the three models.


import pandas as pd
import numpy as np
from sklearn.svm import OneClassSVM
from sklearn.metrics import f1_score, recall_score
from sklearn.preprocessing import StandardScaler
import glob
import os

def run_group_study_with_quality_gate():
    files = glob.glob("../data/processed/users/*.csv")
    population_results = []
    rng = np.random.RandomState(42)

    print("🔍 Running Analysis with Physical Noise Quality Gate...")

    for f in files:
        df = pd.read_csv(f)
        if len(df) < 15: continue

        features = ['stationary_perc', 'walking_perc', 'activity_var']
        X = df[features]
        y_true_all = np.where(df['stress_label'] >= 4, -1, 1)

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Eligible baseline rows: calm (stress_label<=2) AND stationary
        baseline_mask = (df['stress_label'] <= 2) & (df['stationary_perc'] > 0.8)
        baseline_idx = np.where(baseline_mask.values)[0]
        if len(baseline_idx) < 5: continue

        # --- FIX: held-out split ---
        # PREVIOUSLY: oc_svm.fit(baseline_data) trained on the eligible rows,
        # then scores = oc_svm.decision_function(X_scaled) and
        # svm_preds = oc_svm.predict(X_scaled) evaluated on the FULL dataset
        # — which contains every one of those same baseline_data rows.
        # That's leakage: the reported SVM_F1/SVM_Recall per user were partly
        # measuring memorization, not generalization.
        #
        # Fix: split the eligible baseline rows 80/20. Train only on the 80%
        # training portion. Evaluate on everything the model never trained
        # on: the held-out 20% of baseline rows, PLUS every non-baseline row
        # (moving/non-stationary or non-calm windows).
        rng.shuffle(baseline_idx)
        split = int(len(baseline_idx) * 0.8)
        train_idx = baseline_idx[:split]
        held_out_baseline_idx = baseline_idx[split:]
        if len(train_idx) < 5: continue

        all_idx = np.arange(len(df))
        non_baseline_idx = np.setdiff1d(all_idx, baseline_idx)
        test_idx = np.concatenate([held_out_baseline_idx, non_baseline_idx])
        if len(test_idx) < 3: continue

        # Train OC-SVM on the 80% training slice of 'Normal/Stationary' instances
        oc_svm = OneClassSVM(kernel='rbf', nu=0.1).fit(X_scaled[train_idx])

        X_test = X_scaled[test_idx]
        y_true = y_true_all[test_idx]
        test_df = df.iloc[test_idx]

        # Calculate Z-Scores (Distance from personal baseline) — test set only
        scores = oc_svm.decision_function(X_test)
        z_scores = np.abs((scores - np.mean(scores)) / np.std(scores))

        # --- THE RESEARCH LOGIC: PHYSICAL NOISE GATE ---
        # 1. Potential Drift: Z-score is in the 1.0 - 1.5 band
        is_drifting = (z_scores >= 1.0) & (z_scores <= 1.5)

        # 2. Context Check: Is the user stationary?
        is_stationary = test_df['stationary_perc'].values > 0.8

        # 3. Categorization
        # True Pre-Stress = Drifting AND Stationary
        # Physical Noise = Drifting AND NOT Stationary
        pre_stress_mask = is_drifting & is_stationary
        physical_noise_mask = is_drifting & (~is_stationary)

        svm_preds = oc_svm.predict(X_test)

        population_results.append({
            'user': df['user_id'].iloc[0],
            'SVM_F1': f1_score(y_true, svm_preds, pos_label=-1, zero_division=0),
            'SVM_Recall': recall_score(y_true, svm_preds, pos_label=-1, zero_division=0),
            'true_pre_stress_alerts': pre_stress_mask.sum(),
            'physical_noise_rejections': physical_noise_mask.sum(),
            'train_n': len(train_idx),
            'test_n': len(test_idx),
        })

    res_df = pd.DataFrame(population_results)
    os.makedirs("../outputs/", exist_ok=True)
    res_df.to_csv("../outputs/quality_gate_results.csv", index=False)

    print("\n🏆 --- RESEARCH VALIDATION RESULTS (held-out test set, no leakage) ---")
    print(f"Users evaluated: {len(res_df)}")
    print(f"Total True Pre-Stress Alerts (Mental): {res_df['true_pre_stress_alerts'].sum()}")
    print(f"Total Physical Noise Rejections (Walking/Running): {res_df['physical_noise_rejections'].sum()}")
    print(f"\nAverage System F1 (held-out): {res_df['SVM_F1'].mean():.4f}")
    print(f"Average System Recall (held-out): {res_df['SVM_Recall'].mean():.4f}")

if __name__ == "__main__":
    run_group_study_with_quality_gate()
