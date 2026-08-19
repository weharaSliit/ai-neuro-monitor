import pandas as pd
import numpy as np
import os

# Setup Paths
RAW_DATA = "../data/raw/DSL-StrongPasswordData (1).csv"
PROCESSED_DATA = "../data/processed/cmu_refined.csv"
os.makedirs("../data/processed", exist_ok=True)

print("🚀 Starting S1: Refined Preprocessing...")

df = pd.read_csv(RAW_DATA)

# Identify Timing Columns
h_cols = [c for c in df.columns if c.startswith("H.")]
ud_cols = [c for c in df.columns if c.startswith("UD.")]

# 1. Brain Sciences 2023 Filter (Physical Bounds)
# Dwell: 5ms - 1s | Flight: -3s to 3s
mask = (df[h_cols] > 0.005).all(axis=1) & (df[h_cols] < 1.0).all(axis=1)
df = df[mask]

# 2. IQR Outlier Removal (Stress Classification 2024 Logic)
def remove_outliers(group):
    for col in h_cols + ud_cols:
        Q1, Q3 = group[col].quantile(0.25), group[col].quantile(0.75)
        IQR = Q3 - Q1
        group = group[(group[col] >= Q1 - 1.5 * IQR) & (group[col] <= Q3 + 1.5 * IQR)]
    return group

df = df.groupby("subject").apply(remove_outliers).reset_index(drop=True)

# 3. Behavioral Feature Engineering
df["avg_dwell"] = df[h_cols].mean(axis=1)
df["dwell_cv"] = df[h_cols].std(axis=1) / (df["avg_dwell"] + 1e-6)
df["avg_flight"] = df[ud_cols].mean(axis=1)
df["flight_stability"] = df[ud_cols].std(axis=1)

# 4. Temporal Drift (The Pre-Stress Signal)
df["dwell_drift"] = df.groupby("subject")["avg_dwell"].diff().fillna(0)

# 5. Idiographic Normalization (Per-User Z-Scaling)
core_feats = ["avg_dwell", "dwell_cv", "avg_flight", "flight_stability"]
for col in core_feats:
    u_mean = df.groupby("subject")[col].transform("mean")
    u_std = df.groupby("subject")[col].transform("std").replace(0, 1e-6)
    df[f"{col}_z"] = (df[col] - u_mean) / u_std

df.to_csv(PROCESSED_DATA, index=False)
print(f"✅ Preprocessing Complete. Processed rows: {len(df)}")