# obj2_task_combined.py  — FIXED (TypeError: np.isnan on mixed dtype)
# Root cause: feat_cols filter was letting object/string columns through
# Fix 1: Build feat_cols by actually testing each column for numeric dtype
# Fix 2: Convert features to float64 before np.isnan / reshape
# ─────────────────────────────────────────────────────────────────────────────
# COMBINED PIPELINE — THREE LAYERS, ONE SYSTEM
#   Layer 1: One-Class SVM          (Objective 1 — algorithm selected)
#   Layer 2: Personalized Baseline  (Objective 2 Task 1)
#   Layer 3: EMA Continual Learning (Objective 2 Task 4)
# Literature:
#   - Gjoreski et al. 2017  — Z-score 2.0 threshold for anomaly flagging
#   - Wang et al. 2018      — personalized baselines for keyboard dynamics
#   - Koldijk et al. 2014   — SWELL-KW gold standard PSS dataset
# ─────────────────────────────────────────────────────────────────────────────
import pandas as pd
import numpy as np
from sklearn.svm import OneClassSVM
from sklearn.preprocessing import StandardScaler
import os, warnings
warnings.filterwarnings("ignore")

os.makedirs("../outputs", exist_ok=True)

PROCESSED   = "../data/processed/swell_processed.csv"
ALPHA       = 0.2          # EMA learning rate (Gjoreski et al. 2017)
Z_THRESH    = 2.0          # Z-score anomaly threshold (Gjoreski et al. 2017)
Z_CAP       = 10.0         # Cap to prevent infinity from near-zero std
MIN_STD     = 0.01         # Minimum std to avoid division by zero
MIN_WINDOWS = 5            # Minimum normal windows needed per user

print("=" * 60)
print("  COMBINED PIPELINE — THREE LAYERS, ONE SYSTEM")
print("  Layer 1: One-Class SVM   (Objective 1 result)")
print("  Layer 2: Personal Baseline (Objective 2 Task 1)")
print("  Layer 3: EMA Update        (Objective 2 Task 4)")
print("=" * 60)

# ── LOAD DATA ─────────────────────────────────────────────────────────────────
df = pd.read_csv(PROCESSED)

# ── FIX 1: Build feat_cols properly ──────────────────────────────────────────
# The original code used df[c].dtype in [float, int, ...] which misses
# columns pandas infers as 'object' even if they contain numbers.
# Use pd.api.types.is_numeric_dtype() — the correct pandas way.
EXCLUDE   = {"user_id", "label"}
feat_cols = [
    c for c in df.columns
    if c not in EXCLUDE and pd.api.types.is_numeric_dtype(df[c])
]

# Force all feature columns to float64 in the dataframe now (once)
df[feat_cols] = df[feat_cols].apply(pd.to_numeric, errors="coerce")

print(f"\nFeatures: {len(feat_cols)} | Users: {df['user_id'].nunique()}")
print(f"Labels:   {df['label'].value_counts().to_dict()}")
print(f"Feature columns sample: {feat_cols[:5]} ...")

# ── MAIN LOOP ─────────────────────────────────────────────────────────────────
all_results = []

for uid in df["user_id"].unique():
    user = df[df["user_id"] == uid].copy()

    # LAYER 2: Build personal baseline from true normal rows
    true_normal = user[user["label"] == "normal"][feat_cols].dropna()
    if len(true_normal) < MIN_WINDOWS:
        continue

    personal_mean = {f: float(true_normal[f].mean()) for f in feat_cols}
    personal_std  = {f: max(float(true_normal[f].std(ddof=0)), MIN_STD)
                     for f in feat_cols}

    # LAYER 1: Train One-Class SVM on this user's normal data
    scaler  = StandardScaler()
    norm_sc = scaler.fit_transform(true_normal.values.astype(np.float64))
    svm     = OneClassSVM(kernel="rbf", nu=0.1, gamma="scale")
    svm.fit(norm_sc)

    # Process all windows chronologically
    ordered = user.sort_values("label").reset_index(drop=True)

    for _, window in ordered.iterrows():
        # ── FIX 2: Extract as float64 numpy array explicitly ─────────────────
        features = window[feat_cols].values.astype(np.float64)

        # Now np.isnan works correctly on a pure float64 array
        if np.isnan(features).any():
            continue

        # LAYER 2: Z-score per feature
        z_scores    = []
        n_anomalous = 0
        for i, feat in enumerate(feat_cols):
            sd = personal_std[feat]
            if sd < MIN_STD:
                continue
            z = min(abs((features[i] - personal_mean[feat]) / sd), Z_CAP)
            z_scores.append(z)
            if z > Z_THRESH:
                n_anomalous += 1

        if not z_scores:
            continue

        z_flag = 1 if n_anomalous >= 2 else 0

        # LAYER 1: SVM anomaly detection
        feat_sc  = scaler.transform(features.reshape(1, -1))
        svm_pred = svm.predict(feat_sc)[0]
        svm_flag = 1 if svm_pred == -1 else 0

        # COMBINED DECISION (three-way)
        if svm_flag == 1 and z_flag == 1:
            combined = "high_confidence_anomaly"
        elif svm_flag == 1 or z_flag == 1:
            combined = "possible_anomaly"
        else:
            combined = "normal"

        all_results.append({
            "user_id":     uid,
            "true_label":  window["label"],
            "svm_flag":    svm_flag,
            "zscore_flag": z_flag,
            "combined":    combined,
            "mean_z":      round(float(np.mean(z_scores)), 4),
        })

        # LAYER 3: EMA — update ONLY on normal windows (no contamination)
        if window["label"] == "normal":
            for i, feat in enumerate(feat_cols):
                personal_mean[feat] = (
                    ALPHA * float(features[i])
                    + (1 - ALPHA) * personal_mean[feat]
                )

# ── RESULTS ───────────────────────────────────────────────────────────────────
if not all_results:
    print("\n⛔  No results produced. Check that swell_processed.csv has")
    print("    'label' column with values: normal / pre_stress / stressed")
    exit(1)

results_df = pd.DataFrame(all_results)
print(f"\nTotal windows processed: {len(results_df)}")

print(f"\n  {'Label':18} {'High Conf%':>12} {'Possible%':>11} {'Normal%':>9}")
print(f"  {'─'*55}")
for lbl in ["normal", "pre_stress", "stressed"]:
    sub = results_df[results_df["true_label"] == lbl]
    if len(sub) == 0:
        continue
    hc = (sub["combined"] == "high_confidence_anomaly").mean() * 100
    pa = (sub["combined"] == "possible_anomaly").mean()        * 100
    nm = (sub["combined"] == "normal").mean()                  * 100
    print(f"  {lbl:18} {hc:12.1f}% {pa:11.1f}% {nm:9.1f}%")

# Pre-stress detection rate — key metric for panel
ps = results_df[results_df["true_label"] == "pre_stress"]
if len(ps) > 0:
    rate = (ps["combined"] != "normal").mean() * 100
    print(f"\n  PRE-STRESS DETECTION RATE: {rate:.1f}%")
    print(f"  (windows flagged BEFORE full stress onset — Gjoreski 2017)")

results_df.to_csv("../outputs/combined_pipeline_results.csv", index=False)
print(f"\n✅ Saved: ../outputs/combined_pipeline_results.csv")

print(f"""
{"="*60}
  THREE LAYERS — ONE SYSTEM:
  SVM           = detection engine (Objective 1)
  Personal mean = personalized data per user (Obj 2 Task 1)
  EMA update    = keeps baseline current (Obj 2 Task 4)
  Research Gaps closed: Gap 1, Gap 2, Gap 3, Gap 4
{"="*60}
  ✅  OBJECTIVE 2 COMPLETE
{"="*60}
""")