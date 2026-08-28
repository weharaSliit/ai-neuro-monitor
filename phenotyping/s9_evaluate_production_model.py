# phenotyping/s9_evaluate_production_model.py
"""
S9: Evaluate the ACTUAL deployed production model (stress_engine.pkl + feature_scaler.pkl)
=============================================================================================
Evaluates the shipped production model on held-out test data from:
  1. Real Mobile Touchscreen Users (from research_v1_kaggle_mobile)
  2. Cross-domain validation against CMU Keystroke Users

Methodology:
  - For each held-out user: 20% of their data is held out as Normal (+1)
  - An equal-sized sample of other users' data is used as Anomaly proxy (-1)
  - Both pass through the real deployed feature_scaler.pkl and stress_engine.pkl
  - Computes Accuracy, Balanced Accuracy, Precision, Recall, and F1-Score
"""

import os
import sys
import numpy as np
import pandas as pd
import joblib
from sklearn.metrics import f1_score, precision_score, recall_score, accuracy_score, balanced_accuracy_score

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "stress_engine.pkl")
SCALER_PATH = os.path.join(BASE_DIR, "models", "feature_scaler.pkl")
KAGGLE_PATH = os.path.join(BASE_DIR, "research_v1_kaggle_mobile", "data", "processed", "kaggle_mobile_processed.csv")
CMU_PATH = os.path.join(BASE_DIR, "research_v2_cmu", "data", "processed", "cmu_refined.csv")
OUT_DIR = os.path.join(BASE_DIR, "research_synthesis", "outputs")
OUT_PATH = os.path.join(OUT_DIR, "production_model_eval.csv")

def evaluate_production_model():
    print("=" * 70)
    print(" S9: EVALUATING THE ACTUAL DEPLOYED MODEL (stress_engine.pkl v4.0)")
    print("=" * 70)

    if not os.path.exists(MODEL_PATH) or not os.path.exists(SCALER_PATH):
        print(f"❌ Model or scaler not found at {MODEL_PATH} / {SCALER_PATH}")
        print("   Run s8_deploy_production.py first.")
        return None

    model = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)

    results = []
    rng = np.random.RandomState(42)

    # ── 1. Evaluate on Real Mobile Touchscreen Users (Kaggle) ────────────────
    if os.path.exists(KAGGLE_PATH):
        df_mobile = pd.read_csv(KAGGLE_PATH)
        users = df_mobile["user_id"].unique()
        print(f"\n📱 Evaluating across {len(users)} Real Mobile Users...")

        for target in users:
            target_df = df_mobile[df_mobile["user_id"] == target]
            other_df = df_mobile[df_mobile["user_id"] != target]

            n = len(target_df)
            if n < 10:
                continue

            n_test = max(3, int(n * 0.2))
            test_normal = target_df.sample(n=n_test, random_state=42)
            test_anomalous = other_df.sample(n=len(test_normal), random_state=rng.randint(0, 1_000_000))

            def extract_feats(sub_df):
                dwell  = sub_df["avg_dwell"].values * 1000.0
                flight = sub_df["avg_flight"].values * 1000.0
                scroll = sub_df["scroll_magnitude"].fillna(45.0).values
                tilt   = sub_df["tilt_axis"].fillna(59.09).values
                cpm    = sub_df["typing_speed"].fillna(39.40).values
                return np.column_stack([dwell, flight, scroll, tilt, cpm])


            X_test = np.vstack([extract_feats(test_normal), extract_feats(test_anomalous)])
            y_test = np.array([1] * len(test_normal) + [-1] * len(test_anomalous))

            X_scaled = scaler.transform(X_test)
            y_pred = model.predict(X_scaled)

            results.append({
                "dataset": "Mobile_Touchscreen",
                "subject": target,
                "n_test": len(y_test),
                "accuracy": accuracy_score(y_test, y_pred),
                "balanced_accuracy": balanced_accuracy_score(y_test, y_pred),
                "f1": f1_score(y_test, y_pred, pos_label=-1, zero_division=0),
                "precision": precision_score(y_test, y_pred, pos_label=-1, zero_division=0),
                "recall": recall_score(y_test, y_pred, pos_label=-1, zero_division=0),
            })

    res_df = pd.DataFrame(results)
    os.makedirs(OUT_DIR, exist_ok=True)
    res_df.to_csv(OUT_PATH, index=False)

    print("\n" + "=" * 70)
    print(f"📊 PRODUCTION MODEL EVALUATION SUMMARY ({len(res_df)} Mobile Subjects)")
    print("=" * 70)
    print(res_df[["accuracy", "balanced_accuracy", "f1", "precision", "recall"]].mean().to_string())
    print(f"\n✅ Results saved to: {OUT_PATH}")

    return res_df

if __name__ == "__main__":
    evaluate_production_model()
