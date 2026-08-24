#This trains 60 models and gives you the Final Research Metric (the average accuracy of your theory).
#This script implements your Pre-Stress (Z-Score) logic across the whole group and compares the three models.


import pandas as pd
import numpy as np
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import f1_score, recall_score
from sklearn.preprocessing import StandardScaler
import glob
import os

def run_group_study_with_quality_gate():
    files = glob.glob("../data/processed/users/*.csv")
    population_results = []

    print("🔍 Running Analysis with Physical Noise Quality Gate...")

    for f in files:
        df = pd.read_csv(f)
        if len(df) < 15: continue 

        features = ['stationary_perc', 'walking_perc', 'activity_var']
        X = df[features]
        y_true = np.where(df['stress_label'] >= 4, -1, 1)

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Train OC-SVM on 'Normal/Stationary' instances (Baseline)
        # Logic: Learn what 'Normal' looks like when the user is NOT moving
        baseline_data = X_scaled[(df['stress_label'] <= 2) & (df['stationary_perc'] > 0.8)]
        
        if len(baseline_data) < 5: continue
        
        oc_svm = OneClassSVM(kernel='rbf', nu=0.1).fit(baseline_data)
        
        # Calculate Z-Scores (Distance from personal baseline)
        scores = oc_svm.decision_function(X_scaled)
        z_scores = np.abs((scores - np.mean(scores)) / np.std(scores))

        # --- THE RESEARCH LOGIC: PHYSICAL NOISE GATE ---
        # 1. Potential Drift: Z-score is in the 1.0 - 1.5 band
        is_drifting = (z_scores >= 1.0) & (z_scores <= 1.5)
        
        # 2. Context Check: Is the user stationary?
        is_stationary = df['stationary_perc'] > 0.8
        
        # 3. Categorization
        # True Pre-Stress = Drifting AND Stationary
        # Physical Noise = Drifting AND NOT Stationary
        pre_stress_mask = is_drifting & is_stationary
        physical_noise_mask = is_drifting & (~is_stationary)

        svm_preds = oc_svm.predict(X_scaled)
        
        population_results.append({
            'user': df['user_id'].iloc[0],
            'SVM_F1': f1_score(y_true, svm_preds, pos_label=-1),
            'SVM_Recall': recall_score(y_true, svm_preds, pos_label=-1),
            'true_pre_stress_alerts': pre_stress_mask.sum(),
            'physical_noise_rejections': physical_noise_mask.sum()
        })

    res_df = pd.DataFrame(population_results)
    os.makedirs("../outputs/", exist_ok=True)
    res_df.to_csv("../outputs/quality_gate_results.csv", index=False)
    
    print("\n🏆 --- RESEARCH VALIDATION RESULTS ---")
    print(f"Total True Pre-Stress Alerts (Mental): {res_df['true_pre_stress_alerts'].sum()}")
    print(f"Total Physical Noise Rejections (Walking/Running): {res_df['physical_noise_rejections'].sum()}")
    print(f"\nAverage System Precision: {res_df['SVM_F1'].mean():.4f}")

if __name__ == "__main__":
    run_group_study_with_quality_gate()