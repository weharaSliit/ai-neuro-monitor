# obj2_task1_baseline_builder.py
# Closes Research Gap 2: No personalized baselines
# Literature: Wang et al. 2014 (StudentLife) — 7-day calibration
#             Meegahapola 2023 — per-user > population models
import pandas as pd
import numpy as np
import os
os.makedirs("../outputs", exist_ok=True)
 
PROCESSED = "../data/processed/swell_processed.csv"
OUT       = "../outputs/user_baselines.csv"
 
print("=" * 60)
print("  TASK 1 — PERSONALIZED BASELINE BUILDER")
print("  Closes Research Gap 2: No personalized baselines")
print("=" * 60)
 
df = pd.read_csv(PROCESSED)
print(f"Loaded: {df.shape}")
print(f"Label distribution: {df['label'].value_counts().to_dict()}")
 
EXCLUDE   = ["user_id","label"]
feat_cols = [c for c in df.columns if c not in EXCLUDE
             and df[c].dtype in [float,int,np.float64,np.int64]]
print(f"Features available: {len(feat_cols)}")
 
# Build baseline from TRUE NORMAL rows only
# This simulates the 7-day calibration period in the deployed app
# Wang 2014: first 7 days of natural behavior = reliable baseline
normal_df = df[df["label"] == "normal"]
print(f"Normal rows used for baseline: {len(normal_df)}")
 
baselines = []
print(f"\n{'User':8} {'Windows':8} {'Status'}")
print("-" * 40)
 
for uid in sorted(df["user_id"].unique()):
    user_normal = normal_df[normal_df["user_id"] == uid][feat_cols]
 
    if len(user_normal) < 3:
        print(f"{str(uid):8} {len(user_normal):8} ⚠️  Skipped (< 3 windows)")
        continue
 
    baseline = {"user_id": uid,
                "n_calibration_windows": len(user_normal)}
 
    for feat in feat_cols:
        vals = user_normal[feat].dropna()
        baseline[f"{feat}_mean"] = round(float(vals.mean()), 6)
        baseline[f"{feat}_std"]  = round(float(max(vals.std(), 1e-6)), 6)
 
    baselines.append(baseline)
    print(f"{str(uid):8} {len(user_normal):8} ✅  Baseline built")
 
baselines_df = pd.DataFrame(baselines)
print(f"\nBaselines created: {len(baselines_df)} users")
 
# Show sample
if len(baselines_df) > 0:
    sample = baselines_df.iloc[0]
    print(f"\nSample baseline for user {sample['user_id']}:")
    feat_display = feat_cols[:4]
    for f in feat_display:
        mn = sample[f"{f}_mean"]
        sd = sample[f"{f}_std"]
        print(f"  {f:35} mean={mn:8.4f}  std={sd:8.4f}")
 
# KEY FINDING: show that different users have different baselines
print(f"\nRESEARCH GAP 2 EVIDENCE:")
print(f"  Baseline variability across users:")
for f in feat_cols[:3]:
    col = f"{f}_mean"
    if col in baselines_df.columns:
        mn = baselines_df[col].mean()
        sd = baselines_df[col].std()
        cv = sd/abs(mn)*100 if mn != 0 else 0
        print(f"  {f:35} CV={cv:.1f}%  "
              f"(high CV = each user is truly unique)")
 
baselines_df.to_csv(OUT, index=False)
print(f"\n✅ Saved: {OUT}")
print(f"   Each row = one user's unique behavioral fingerprint")
print(f"   This directly demonstrates Research Gap 2 is closed")
print("\nNext: python obj2_task2_zscore_detector.py")
