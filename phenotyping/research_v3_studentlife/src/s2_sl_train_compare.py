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

    # --- FIX: real held-out split ---
    # PREVIOUSLY: oc_svm.fit(X_scaled[y <= 2]) trained on the "normal" rows,
    # then svm_preds = oc_svm.predict(X_scaled) scored the FULL dataset —
    # which includes every one of those same training rows. Isolation Forest
    # and Random Forest had the identical bug (fit on everything, then
    # "tested" on everything). That's textbook train/test leakage: every
    # metric below was partly measuring how well each model memorized its
    # own training data, not how it generalizes.
    #
    # Fix: split BOTH the "normal" (y<=2) and "stress" (y>=4) rows 80/20 with
    # a fixed seed. Every model trains only on the 80% training portion, and
    # is scored only on the untouched 20% held-out portion. Expect these
    # numbers to be lower than before — that's the leakage being removed,
    # not a new problem.
    rng = np.random.RandomState(42)
    normal_idx = np.where(y.values <= 2)[0]
    stress_idx = np.where(y.values >= 4)[0]
    rng.shuffle(normal_idx)
    rng.shuffle(stress_idx)

    n_split = int(len(normal_idx) * 0.8)
    s_split = int(len(stress_idx) * 0.8)
    train_normal, test_normal = normal_idx[:n_split], normal_idx[n_split:]
    train_stress, test_stress = stress_idx[:s_split], stress_idx[s_split:]

    if len(train_normal) < 5 or (len(test_normal) + len(test_stress)) < 5:
        print("❌ Not enough data for a held-out split (need more samples).")
        return

    test_idx = np.concatenate([test_normal, test_stress])
    X_test, y_test = X_scaled[test_idx], y_binary[test_idx]

    # 1. One-Class SVM (The Research Primary) — trains ONLY on the held-out-
    #    excluded 80% of normal data
    oc_svm = OneClassSVM(kernel='rbf', nu=0.1, gamma='scale')
    oc_svm.fit(X_scaled[train_normal])

    # 2. Isolation Forest (The Baseline) — same train-only-on-normal protocol
    #    for a fair, apples-to-apples comparison with the OC-SVM
    iso_forest = IsolationForest(contamination=0.1, random_state=42)
    iso_forest.fit(X_scaled[train_normal])

    # 3. Random Forest (Supervised Check) — trains on the combined 80% of
    #    both classes, evaluated on the same held-out test_idx as the others
    rf_train_idx = np.concatenate([train_normal, train_stress])
    rf = RandomForestClassifier(n_estimators=100, random_state=42)
    rf.fit(X_scaled[rf_train_idx], y_binary[rf_train_idx])

    # Predictions — all on the held-out test set only
    svm_preds = oc_svm.predict(X_test)
    if_preds = iso_forest.predict(X_test)
    rf_preds = rf.predict(X_test)

    # --- THE NOVELTY: Z-Score Drift Detection (Pre-Stress) ---
    # Computed on the held-out test set only, same reasoning as above.
    scores = oc_svm.decision_function(X_test)
    z_scores = (scores - np.mean(scores)) / np.std(scores)

    test_df = df.iloc[test_idx].copy()
    # Flagging the Escalation Phase (Z-score between 1.0 and 1.5)
    test_df['pre_stress_flag'] = (np.abs(z_scores) > 1.0) & (np.abs(z_scores) < 1.5)

    print("\n📊 --- Research Model Comparison (held-out test set, no leakage) ---")
    print(f"Train: {len(train_normal)} normal (OC-SVM/IF) | "
          f"{len(rf_train_idx)} total (RF)")
    print(f"Test:  {len(test_normal)} normal + {len(test_stress)} stress "
          f"({len(test_idx)} samples, never seen during training)")
    print(f"One-Class SVM F1: {f1_score(y_test, svm_preds, pos_label=-1, zero_division=0):.4f}")
    print(f"Isolation Forest F1: {f1_score(y_test, if_preds, pos_label=-1, zero_division=0):.4f}")
    print(f"Random Forest Accuracy: {accuracy_score(y_test, rf_preds):.4f}")

    pre_stress_count = test_df['pre_stress_flag'].sum()
    print(f"\n🚀 Pre-Stress 'Escalation' Detections (test set): {pre_stress_count}")

    # Save Best Model
    os.makedirs("../models/", exist_ok=True)
    joblib.dump(oc_svm, "../models/sl_pre_stress_detector.joblib")
    print("\n✅ Best Model (OC-SVM) saved to ../models/")

if __name__ == "__main__":
    train_and_compare()
