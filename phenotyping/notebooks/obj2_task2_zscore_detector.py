# obj2_task2_zscore_detector.py — FIXED
# Closes Research Gap 4: No pre-stress real-time detection
# Literature: Gjoreski 2017 — Z=2.0 threshold optimal
#             Online Anomaly Detection 2022 — real-time scoring
# FIXES:
#   ← Z_CAP = 10.0 added (prevents infinity from corrupting averages)
#   ← MIN_STD = 0.01 (skip near-zero std features like SnRightClicked)
import pandas as pd
import numpy as np
import os
os.makedirs("../outputs", exist_ok=True)

PROCESSED = "../data/processed/swell_processed.csv"
BASELINES = "../outputs/user_baselines.csv"
OUT       = "../outputs/anomaly_scores.csv"

Z_THRESHOLD            = 2.0   # Gjoreski 2017: optimal for behavioral data
MIN_FEATURES_ANOMALOUS = 2     # require 2+ features to flag anomaly
Z_CAP                  = 10.0  # cap: any Z>10 = extreme, treat as Z=10
MIN_STD                = 0.01  # skip features with near-zero variance

print("=" * 60)
print("  TASK 2 — Z-SCORE DEVIATION DETECTOR")
print(f"  Threshold: Z > {Z_THRESHOLD} (Gjoreski et al. 2017)")
print(f"  Cap:       Z max = {Z_CAP} (prevents infinity)")
print(f"  Min std:   {MIN_STD} (skips zero-variance features)")
print("  Closes Research Gap 4: Real-time pre-stress detection")
print("=" * 60)

df        = pd.read_csv(PROCESSED)
baselines = pd.read_csv(BASELINES)
merged    = df.merge(baselines, on="user_id", how="inner")
print(f"Loaded: {len(merged)} windows from {merged['user_id'].nunique()} users")

EXCLUDE   = ["user_id", "label"]
feat_cols = [c for c in df.columns if c not in EXCLUDE
             and df[c].dtype in [float, int, np.float64, np.int64]]

results       = []
skipped_feats = set()

for _, row in merged.iterrows():
    record = {
        "user_id":      row["user_id"],
        "label":        row["label"],
        "anomaly_flag": 0
    }

    z_scores    = []
    n_anomalous = 0

    for feat in feat_cols:
        mean_key = f"{feat}_mean"
        std_key  = f"{feat}_std"
        if mean_key not in row.index or std_key not in row.index:
            continue

        current   = row[feat]
        base_mean = row[mean_key]
        base_std  = row[std_key]

        if pd.isna(current) or pd.isna(base_mean) or pd.isna(base_std):
            continue

        # Skip zero-variance features — Z-score meaningless
        if base_std < MIN_STD:
            skipped_feats.add(feat)
            continue

        # Compute Z and CAP at Z_CAP to prevent infinity
        z = abs((current - base_mean) / base_std)
        z = min(z, Z_CAP)

        z_scores.append(z)
        record[f"z_{feat}"] = round(z, 4)
        if z > Z_THRESHOLD:
            n_anomalous += 1

    if not z_scores:
        continue

    record["n_features_anomalous"] = n_anomalous
    record["n_features_used"]      = len(z_scores)
    record["max_z"]                = round(max(z_scores), 4)
    record["mean_z"]               = round(float(np.mean(z_scores)), 4)
    record["anomaly_flag"]         = (
        1 if n_anomalous >= MIN_FEATURES_ANOMALOUS else 0)
    results.append(record)

results_df = pd.DataFrame(results)

print(f"\nFeatures skipped (std < {MIN_STD}): {len(skipped_feats)}")
print(f"Features used per window (avg):    "
      f"{results_df['n_features_used'].mean():.1f}")

normal_w    = results_df[results_df["label"] == "normal"]
prestress_w = results_df[results_df["label"] == "pre_stress"]
stressed_w  = results_df[results_df["label"] == "stressed"]

print(f"\n{'='*55}")
print(f"  Z-SCORE DETECTION RESULTS (Z capped at {Z_CAP})")
print(f"{'='*55}")
print(f"\n  Anomaly flag rate by label:")
print(f"  Normal:     {normal_w['anomaly_flag'].mean()*100:5.1f}%"
      f"  ← false alarm rate (target < 40%)")
if len(prestress_w) > 0:
    print(f"  Pre-stress: {prestress_w['anomaly_flag'].mean()*100:5.1f}%"
          f"  ← pre-stress detection rate (target > 40%)")
print(f"  Stressed:   {stressed_w['anomaly_flag'].mean()*100:5.1f}%"
      f"  ← stress detection rate (target > 60%)")

print(f"\n  Mean Z-score by label (capped at {Z_CAP}):")
print(f"  Normal:     {normal_w['mean_z'].mean():.4f}")
if len(prestress_w) > 0:
    print(f"  Pre-stress: {prestress_w['mean_z'].mean():.4f}"
          f"  ← should be higher than normal")
print(f"  Stressed:   {stressed_w['mean_z'].mean():.4f}"
      f"  ← should be highest")

n_mean  = normal_w["mean_z"].mean()
s_mean  = stressed_w["mean_z"].mean()
ps_mean = prestress_w["mean_z"].mean() if len(prestress_w) > 0 else 0

if s_mean > n_mean:
    print(f"\n  ✅ Z-scores correctly ordered:")
    print(f"     normal ({n_mean:.3f}) < stressed ({s_mean:.3f})")
    if ps_mean > n_mean:
        print(f"     pre_stress ({ps_mean:.3f}) above normal"
              f" ← pre-stress elevation confirmed")
else:
    print(f"\n  ⚠️  Z-scores not ordered — check feature quality")

results_df.to_csv(OUT, index=False)
print(f"\n✅ Saved: {OUT}")
print("Next: python obj2_task3_stress_decision.py")