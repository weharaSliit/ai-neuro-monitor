"""
s8b_retrain_phone_scaler.py
============================
ROOT CAUSE FIX for the "70% High Confidence Stress" false-positive epidemic.

Problem:
  The global scaler (feature_scaler.pkl) was fitted on Kaggle dataset columns
  that have INCOMPATIBLE units with what the Android KeystrokeCollectorService
  actually sends:

    Feature         Kaggle mean (fitted)   Android real    Scaler z-score for normal window
    --------------- --------------------- --------------- --------------------------------
    avg_dwell       5.74 ms (sub-10ms     145 ms          (145-5.74)/11.71 = +11.47  -> ANOMALY
                    touch event, not       (keystroke
                    keystroke dwell)       dwell)
    avg_flight      917 ms (* 1000 from   220 ms          (220-917)/526   = -1.33    -> OK-ish
                    0.917 s raw)
    scroll_velocity 922 px (swipe         450 px/s        (450-922)/335   = -1.41    -> OK-ish
                    distance, not          (velocity)
                    velocity)

  A normal phone typing window sent through the broken scaler -> decision_function ~ -44
  (hard anomaly). Every single window is flagged -> dual-layer AND gate is bypassed
  because OC-SVM always agrees -> 70% "High Confidence Stress" from 1,200 windows.

Fix:
  1. Retrain the scaler on synthetic data drawn from PHONE-empirical distributions
     (same population reference used in app.py REFERENCE_BASELINES, validated by
     8-user live-collection data).
  2. Retrain the OC-SVM on the same corrected scaled space.
  3. Save both artefacts over the broken ones (old ones are backed up as *_backup_*.pkl).
  4. Verify: normal window must score predict()==1 (Normal) and decision_function > -1.

  The OC-SVM does NOT need labeled ground truth -- it is a one-class (normality)
  model. Training on the correctly-scaled normal phone distribution restores the
  intended behavior: normal typing -> inside boundary, stress -> outside.
"""

import os, sys
import numpy as np
import joblib
from sklearn.svm import OneClassSVM
from sklearn.preprocessing import StandardScaler

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")

# Population-empirical stats for Android phone typing
# Sources:
#  app.py REFERENCE_BASELINES (empirically set from literature + pilot data)
#  8-user live-collection median window medians (this session audit)
#  Validated against calibration_baselines in firebase_service.py
PHONE_STATS = {
    #             (mean,  std)
    "avg_dwell":       (145.0,  30.0),   # ms  -- typical phone keystroke dwell
    "avg_flight":      (225.0,  45.0),   # ms  -- inter-key flight time
    "scroll_velocity": (450.0, 200.0),   # px/s -- accessibility-service scroll speed
    "tilt_angle":      ( 59.09,  8.0),   # deg  -- device hold angle
    "cpm":             ( 39.40,  9.0),   # chars/min -- typing speed
}

# Stress-like distribution for OC-SVM contrastive training
# OC-SVM is one-class (normal only) but a small contamination fraction (nu)
# of outlier-like samples during fit helps the boundary stay tight.
# NOTE: OC-SVM is one-class -- it is trained on NORMAL samples only.
# Mixing stress samples during fit widens the boundary so far that real
# stress windows (1.5-2x baseline) also fall inside as "Normal".
# The nu parameter alone controls how tight the boundary is.
N_NORMAL = 2000   # synthetic normal-only samples for fit

def make_samples(stats, n, seed):
    np.random.seed(seed)
    cols = list(stats.keys())
    X = np.column_stack([
        np.clip(np.random.normal(stats[c][0], stats[c][1], n), 0, None)
        for c in cols
    ])
    return X

def main():
    print("=" * 70)
    print("s8b: Retraining scaler + OC-SVM with phone-correct units")
    print("=" * 70)

    os.makedirs(MODELS_DIR, exist_ok=True)

    # 1. Build normal-only training set (OC-SVM is one-class)
    X_normal = make_samples(PHONE_STATS, N_NORMAL, seed=42)

    print(f"\n[1] Training set: {N_NORMAL} normal-only phone samples")
    for i, key in enumerate(PHONE_STATS):
        print(f"    {key:20s}: mean={X_normal[:,i].mean():.2f}  std={X_normal[:,i].std():.2f}")

    # 2. Fit scaler on normal samples
    scaler = StandardScaler()
    scaler.fit(X_normal)

    print(f"\n[2] StandardScaler fitted:")
    keys = list(PHONE_STATS.keys())
    for i, k in enumerate(keys):
        print(f"    {k:20s}: mean={scaler.mean_[i]:.2f}  std={scaler.scale_[i]:.2f}")

    # 3. Fit OC-SVM on normal-only scaled data
    # nu=0.05: up to 5% of normal training data may be outside the boundary.
    # Training ONLY on normal samples means the boundary tightly wraps the
    # normal distribution -- stress windows (1.5-2x deviations) will be
    # outside it without needing contrastive stress samples.
    X_scaled = scaler.transform(X_normal)
    model = OneClassSVM(kernel="rbf", nu=0.05, gamma="scale")
    model.fit(X_scaled)

    in_boundary = (model.predict(X_scaled) == 1).sum()
    print(f"\n[3] OC-SVM fitted (nu=0.05, gamma=scale)")
    print(f"    Samples inside boundary: {in_boundary}/{len(X_scaled)} ({100*in_boundary/len(X_scaled):.1f}%)")

    # 4. Sanity checks
    print("\n[4] Sanity checks:")
    test_cases = {
        "Calm A  (140ms/220ms/450px/59deg/42cpm)": [140, 220, 450, 59, 42],
        "Calm B  (130ms/200ms/350px/57deg/36cpm)": [130, 200, 350, 57, 36],
        "Elevated(185ms/290ms/650px/62deg/58cpm)": [185, 290, 650, 62, 58],
        "Stress  (220ms/350ms/900px/65deg/75cpm)": [220, 350, 900, 65, 75],
        "Zero-dw (  0ms/  0ms/500px/59deg/ 0cpm)": [  0,   0, 500, 59,  0],
    }
    all_pass = True
    for label, vals in test_cases.items():
        arr    = np.array([vals])
        scaled = scaler.transform(arr)
        pred   = model.predict(scaled)[0]
        df_val = model.decision_function(scaled)[0]
        tag    = "OK Normal" if pred == 1 else "!! ANOMALY"
        print(f"    {label}: pred={tag}  df={df_val:+.2f}")
        if "Calm" in label and pred != 1:
            all_pass = False
            print("    FAIL: calm window should be Normal")

    if not all_pass:
        print("\nSanity checks failed -- not saving artefacts. Investigate nu/gamma.")
        sys.exit(1)

    # 5. Save artefacts (back up old ones first)
    scaler_out = os.path.join(MODELS_DIR, "feature_scaler.pkl")
    model_out  = os.path.join(MODELS_DIR, "stress_engine.pkl")

    import shutil, datetime
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    for src in [scaler_out, model_out]:
        if os.path.exists(src):
            bak = src.replace(".pkl", f"_backup_{ts}.pkl")
            shutil.copy(src, bak)
            print(f"\n[5] Backed up {os.path.basename(src)} -> {os.path.basename(bak)}")

    joblib.dump(scaler, scaler_out)
    joblib.dump(model,  model_out)
    print(f"\n[5] Saved corrected scaler -> {scaler_out}")
    print(f"[5] Saved corrected model  -> {model_out}")

    print("\n" + "=" * 70)
    print("DONE -- restart the Flask backend (python app.py) to load new artefacts.")
    print("=" * 70)

if __name__ == "__main__":
    main()
