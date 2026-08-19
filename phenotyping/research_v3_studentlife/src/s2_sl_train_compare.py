#This script implements your Novelty Detection logic using OC-SVM, Isolation Forest, and Random Forest.
# It specifically flags the "Pre-Stress" phase.


import pandas as pd
import numpy as np
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score, accuracy_score
import joblib
import os

def train_and_compare():
    df = pd.read_csv("../data/processed/merged_studentlife_u00.csv")
    
    # Features: stationary_ratio, walking_ratio, activity_variance
    X = df[['stationary_ratio', 'walking_ratio', 'activity_variance']]
    y = df['label'] # 1-5 scale (1=Low stress, 5=Extreme stress)
    
    # Standardize
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Create Binary Labels for Evaluation: Stress (4,5) vs Normal (1,2,3)
    y_binary = np.where(y >= 4, -1, 1) # -1 is anomaly (stress) for OC-SVM/IF

    # 1. One-Class SVM (The Research Primary)
    oc_svm = OneClassSVM(kernel='rbf', nu=0.1, gamma='scale')
    oc_svm.fit(X_scaled[y <= 2]) # Train only on "Normal" low-stress data
    
    # 2. Isolation Forest (The Baseline)
    iso_forest = IsolationForest(contamination=0.1, random_state=42)
    iso_forest.fit(X_scaled)
    
    # 3. Random Forest (Supervised Check)
    rf = RandomForestClassifier(n_estimators=100)
    rf.fit(X_scaled, y_binary)

    # Predictions
    svm_preds = oc_svm.predict(X_scaled)
    if_preds = iso_forest.predict(X_scaled)
    rf_preds = rf.predict(X_scaled)

    # --- THE NOVELTY: Z-Score Drift Detection (Pre-Stress) ---
    scores = oc_svm.decision_function(X_scaled)
    z_scores = (scores - np.mean(scores)) / np.std(scores)
    
    # Flagging the Escalation Phase (Z-score between 1.0 and 1.5)
    df['pre_stress_flag'] = (np.abs(z_scores) > 1.0) & (np.abs(z_scores) < 1.5)
    
    print("\n📊 --- Research Model Comparison ---")
    print(f"One-Class SVM F1: {f1_score(y_binary, svm_preds, pos_label=-1):.4f}")
    print(f"Isolation Forest F1: {f1_score(y_binary, if_preds, pos_label=-1):.4f}")
    print(f"Random Forest Accuracy: {accuracy_score(y_binary, rf_preds):.4f}")
    
    pre_stress_count = df['pre_stress_flag'].sum()
    print(f"\n🚀 Pre-Stress 'Escalation' Detections: {pre_stress_count}")

    # Save Best Model
    os.makedirs("../models/", exist_ok=True)
    joblib.dump(oc_svm, "../models/sl_pre_stress_detector.joblib")
    print("\n✅ Best Model (OC-SVM) saved to ../models/")

if __name__ == "__main__":
    train_and_compare()