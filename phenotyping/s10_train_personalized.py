# phenotyping/s10_train_personalized.py
"""
S10: Train & Deploy Personalized (Idiographic) Models for All Users
=============================================================================
Trains separate One-Class SVM models and StandardScaler artifacts for each 
individual user using their 5 mobile phenotyping features:
  - Dwell Time (ms)
  - Flight Time (ms)
  - Scroll Velocity (px/s)
  - Tilt Angle (deg)
  - Typing Speed (CPM)

Saves all personalized models directly to:
  phenotyping/models/personalized/{user_id}_model.pkl
  phenotyping/models/personalized/{user_id}_scaler.pkl
"""

import os
import sys
import numpy as np
import pandas as pd
import joblib
from sklearn.svm import OneClassSVM
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KAGGLE_PATH = os.path.join(BASE_DIR, "research_v1_kaggle_mobile", "data", "processed", "kaggle_mobile_processed.csv")
MODELS_DIR = os.path.join(BASE_DIR, "models", "personalized")
OUTPUTS_DIR = os.path.join(BASE_DIR, "research_synthesis", "outputs")

def train_personalized_models():
    print("=" * 75)
    print("🚀 [S10] Training Personalized (Idiographic) Models for All Users")
    print("=" * 75)

    if not os.path.exists(KAGGLE_PATH):
        print(f"❌ Error: Processed Kaggle dataset not found at:\n   {KAGGLE_PATH}")
        return

    os.makedirs(MODELS_DIR, exist_ok=True)
    os.makedirs(OUTPUTS_DIR, exist_ok=True)

    df = pd.read_csv(KAGGLE_PATH)
    users = df["user_id"].unique()
    print(f"👥 Found {len(users)} users in dataset.\n")

    def extract_features(sub_df):
        dwell  = sub_df["avg_dwell"].values * 1000.0
        flight = sub_df["avg_flight"].values * 1000.0
        scroll = sub_df["scroll_magnitude"].fillna(45.0).values
        tilt   = sub_df["tilt_axis"].fillna(59.09).values
        cpm    = sub_df["typing_speed"].fillna(39.40).values
        return np.column_stack([dwell, flight, scroll, tilt, cpm])

    results = []
    rng = np.random.RandomState(42)

    for user in users:
        user_df = df[df["user_id"] == user]
        other_df = df[df["user_id"] != user]
        n = len(user_df)

        if n < 15:
            continue

        # Split 80% train (baseline calibration) / 20% test
        n_train = int(n * 0.8)
        n_test = n - n_train

        train_df = user_df.iloc[:n_train]
        test_normal = user_df.iloc[n_train:]
        test_anomalous = other_df.sample(n=n_test, random_state=rng.randint(0, 1_000_000))

        X_train = extract_features(train_df)
        X_test = np.vstack([extract_features(test_normal), extract_features(test_anomalous)])
        y_test = np.array([1] * n_test + [-1] * n_test)

        # 1. Fit Personalized StandardScaler
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        # 2. Hyperparameter Grid Search for this specific user
        best_nu = 0.05
        best_gamma = 'scale'
        for nu in [0.01, 0.03, 0.05, 0.08, 0.10, 0.15]:
            for g in ['scale', 'auto', 0.01, 0.05, 0.1]:
                clf = OneClassSVM(kernel='rbf', nu=nu, gamma=g).fit(X_train_scaled)
                if (clf.predict(X_train_scaled) == 1).mean() >= (1.0 - nu * 1.5):
                    best_nu, best_gamma = nu, g
                    break

        # 3. Fit Final Personalized Model
        personal_model = OneClassSVM(kernel='rbf', nu=best_nu, gamma=best_gamma)
        personal_model.fit(X_train_scaled)

        # 4. Evaluate Accuracy
        y_pred = personal_model.predict(X_test_scaled)
        acc = accuracy_score(y_test, y_pred)
        f1 = f1_score(y_test, y_pred, pos_label=-1, zero_division=0)
        prec = precision_score(y_test, y_pred, pos_label=-1, zero_division=0)
        rec = recall_score(y_test, y_pred, pos_label=-1, zero_division=0)

        # 5. Save Model and Scaler Artifacts
        model_file = os.path.join(MODELS_DIR, f"{user}_model.pkl")
        scaler_file = os.path.join(MODELS_DIR, f"{user}_scaler.pkl")
        joblib.dump(personal_model, model_file)
        joblib.dump(scaler, scaler_file)

        results.append({
            "user_id": user,
            "train_samples": n_train,
            "test_samples": len(y_test),
            "nu": best_nu,
            "gamma": best_gamma,
            "accuracy": acc,
            "f1": f1,
            "precision": prec,
            "recall": rec
        })

        print(f"  ✅ [{user:<8}] Trained on {n_train:>3} samples -> Acc: {acc:.2f} | F1: {f1:.2f} | Saved: {user}_model.pkl")

    res_df = pd.DataFrame(results)
    eval_csv = os.path.join(OUTPUTS_DIR, "personalized_models_eval.csv")
    res_df.to_csv(eval_csv, index=False)

    print("\n" + "=" * 75)
    print(f"📊 PERSONALIZED MODELS SUMMARY ({len(res_df)} Users Trained & Deployed)")
    print("=" * 75)
    print(f"   Mean Accuracy:  {res_df['accuracy'].mean():.4f} (vs Global ~0.4943)")
    print(f"   Mean F1-Score:  {res_df['f1'].mean():.4f} (vs Global ~0.2010)")
    print(f"   Mean Precision: {res_df['precision'].mean():.4f}")
    print(f"   Mean Recall:    {res_df['recall'].mean():.4f}")
    print(f"\n🎉 Models saved to: {MODELS_DIR}")
    print(f"📄 Detailed CSV saved to: {eval_csv}")

if __name__ == "__main__":
    train_personalized_models()
