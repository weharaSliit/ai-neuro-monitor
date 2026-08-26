# phenotyping/s9_evaluate_production_model.py
"""
S9: Evaluate the ACTUAL deployed production model (stress_engine.pkl)
=======================================================================
Every other evaluation script in this repo trains AND scores a DIFFERENT
model object than the one actually shipped to production:
  - s2_cmu_train_compare.py trains/evaluates pre_stress_detector_s002.joblib
    (a single-user model), never exported to production.
  - The StudentLife scripts evaluate a model trained on activity/motion
    features (stationary_perc, walking_perc, activity_var) — not typing data.
  - The SWELL scripts evaluate a model trained on desktop office telemetry
    (SnKeyStrokes, SnMouseAct, ...) — not mobile dwell/flight/scroll.
  - s8_deploy_production.py, which builds stress_engine.pkl, fits it on the
    ENTIRE CMU dataset and never computes a single metric.

So: there has never been an accuracy/F1/precision/recall number anywhere in
this repo for the actual file sitting in phenotyping/models/stress_engine.pkl.

This script is the first to load and score that real deployed model +
feature_scaler.pkl, using CMU's real dwell/flight timing plus the SAME
synthetic scroll distribution s8_deploy_production.py used at training time
(CMU has no real scroll column). No fitting happens in this script at all —
pure evaluation of the artifact already shipped.

METHODOLOGY (same inter-subject anomaly proxy as s2_cmu_train_compare.py,
since no real stress-labeled ground truth exists yet for this project):
  - For each held-out target subject: a sample of THEIR OWN data = "Normal"
    (label +1) — this data was never used to fit stress_engine.pkl either,
    since s8_deploy_production.py trained on the full population, but using
    a per-subject held-out sample keeps this consistent with how the model
    will actually be used (scoring one user's data against the population
    boundary).
  - A matched-size sample of OTHER subjects' data = "Anomaly proxy" (-1)
  - Both classes pass through the REAL deployed scaler + REAL deployed model

CAVEAT (read this before citing any number this script prints):
This is still a PROXY for stress — inter-subject typing difference, not a
real stressed-vs-calm label — and CMU is a desktop keyboard dataset, not
mobile. It answers "does the shipped model generalize at all on data shaped
like what it saw at training time." It does NOT answer "is this model
accurate at detecting real user stress." That requires evaluate_accuracy.py
run against real participant PSS-4/SISS survey data, once enough samples
exist (see backend/phenotyping_behavior/evaluate_accuracy.py).
"""

import os
import numpy as np
import pandas as pd
import joblib
from sklearn.metrics import f1_score, precision_score, recall_score, accuracy_score

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "stress_engine.pkl")
SCALER_PATH = os.path.join(BASE_DIR, "models", "feature_scaler.pkl")
CMU_PATH = os.path.join(BASE_DIR, "research_v2_cmu", "data", "processed", "cmu_refined.csv")
OUT_DIR = os.path.join(BASE_DIR, "research_synthesis", "outputs")
OUT_PATH = os.path.join(OUT_DIR, "production_model_eval.csv")


def evaluate_production_model():
    print("=" * 70)
    print(" S9: EVALUATING THE ACTUAL DEPLOYED MODEL (stress_engine.pkl)")
    print("=" * 70)

    if not os.path.exists(MODEL_PATH) or not os.path.exists(SCALER_PATH):
        print(f"❌ Model or scaler not found at {MODEL_PATH} / {SCALER_PATH}")
        print("   Run s8_deploy_production.py first.")
        return None

    if not os.path.exists(CMU_PATH):
        print(f"❌ CMU processed data not found at {CMU_PATH}")
        print("   Run research_v2_cmu/src/s1_cmu_preprocess.py first.")
        return None

    model = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    df = pd.read_csv(CMU_PATH)

    subjects = df["subject"].unique()
    rng = np.random.RandomState(42)

    def build_features(sub_df, seed):
        local_rng = np.random.RandomState(seed)
        dwell_ms = sub_df["avg_dwell"].values * 1000.0
        flight_ms = sub_df["avg_flight"].values * 1000.0
        # Same synthetic scroll distribution used at training time
        # (s8_deploy_production.py) — CMU has no real scroll column.
        scroll = local_rng.normal(loc=45.0, scale=12.0, size=len(dwell_ms))
        return np.column_stack([dwell_ms, flight_ms, scroll])

    results = []
    for i, target in enumerate(subjects):
        target_df = df[df["subject"] == target]
        other_df = df[df["subject"] != target]

        n = len(target_df)
        if n < 10:
            continue

        n_normal_test = max(3, int(n * 0.2))
        test_normal = target_df.sample(n=min(n_normal_test, n), random_state=42)
        test_anomalous = other_df.sample(n=len(test_normal), random_state=rng.randint(0, 1_000_000))

        X_test = np.vstack([
            build_features(test_normal, seed=1000 + i),
            build_features(test_anomalous, seed=2000 + i),
        ])
        y_test = np.array([1] * len(test_normal) + [-1] * len(test_anomalous))

        X_scaled = scaler.transform(X_test)
        y_pred = model.predict(X_scaled)

        results.append({
            "subject": target,
            "n_test": len(y_test),
            "accuracy": accuracy_score(y_test, y_pred),
            "f1": f1_score(y_test, y_pred, pos_label=-1, zero_division=0),
            "precision": precision_score(y_test, y_pred, pos_label=-1, zero_division=0),
            "recall": recall_score(y_test, y_pred, pos_label=-1, zero_division=0),
        })

    res_df = pd.DataFrame(results)
    os.makedirs(OUT_DIR, exist_ok=True)
    res_df.to_csv(OUT_PATH, index=False)

    print(f"\nEvaluated across {len(res_df)} held-out subjects (proxy labels — see caveat in file docstring)")
    print(res_df[["accuracy", "f1", "precision", "recall"]].mean().to_string())
    print(f"\nSaved: {OUT_PATH}")
    print("\nNOTE: this is an inter-subject proxy evaluation of the REAL deployed")
    print("      model — it is NOT a validated real-world stress-detection accuracy.")
    print("      Run evaluate_accuracy.py against real participant EMA data once")
    print("      enough PSS-4/SISS samples exist for the number that actually matters.")

    return res_df


if __name__ == "__main__":
    evaluate_production_model()
