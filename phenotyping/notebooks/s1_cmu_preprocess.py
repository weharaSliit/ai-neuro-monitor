# s1_cmu_preprocess.py
# ─────────────────────────────────────────────────────────
# PURPOSE: Extract and engineer features from CMU keystroke data
# WHAT CMU PROVES: Personalized anomaly detection works on typing data
# LITERATURE:
#   Killourhy & Maxion 2009 — dwell(H.*) + flight(UD.*) are core features
#   Brain Sciences 2023    — valid range: dwell 10-2000ms, flight ±3000ms
#   Paper 20 (2020)        — multiple time windows, 112 features approach
#   Idiographic ML 2023    — per-user normalization essential
# ─────────────────────────────────────────────────────────
import pandas as pd
import numpy as np
import os
os.makedirs("../data/processed", exist_ok=True)

RAW = "../data/raw/DSL-StrongPasswordData.csv"
OUT = "../data/processed/cmu_processed.csv"

print("=" * 60)
print("  S1 — CMU KEYSTROKE PREPROCESSING")
print("=" * 60)
print("Literature basis:")
print("  Killourhy & Maxion 2009 — H.* dwell, UD.* flight columns")
print("  Brain Sciences 2023    — valid range filtering")
print("  Paper 20 2020          — multiple window features")
print("  Idiographic ML 2023    — per-user normalization")
print()

df = pd.read_csv(RAW)
print(f"Raw data loaded: {df.shape[0]} rows × {df.shape[1]} columns")

# ── STEP 1: IDENTIFY COLUMNS ──────────────────────────────────
h_cols  = [c for c in df.columns if c.startswith("H.")]   # dwell
ud_cols = [c for c in df.columns if c.startswith("UD.")]  # flight
print(f"Dwell columns (H.*):   {len(h_cols)}")
print(f"Flight columns (UD.*): {len(ud_cols)}")

# ── STEP 2: VALID RANGE FILTER ────────────────────────────────
# Brain Sciences 2023: physiologically valid keystroke timing
# Human typing: dwell 10-2000ms, flight can be negative (overlap)
print("\n[Step 2] Valid range filter (Brain Sciences 2023)...")
before = len(df)
for col in h_cols:
    df[col] = pd.to_numeric(df[col], errors="coerce")
for col in ud_cols:
    df[col] = pd.to_numeric(df[col], errors="coerce")

# Remove rows where dwell times are impossible
df = df[(df[h_cols] > 0.005).all(axis=1)]   # > 5ms
df = df[(df[h_cols] < 2.0).all(axis=1)]     # < 2 seconds
df = df.dropna(subset=h_cols + ud_cols)
print(f"  Removed {before - len(df)} invalid rows, kept {len(df)}")

# ── STEP 3: CORE FEATURES ─────────────────────────────────────
# Killourhy & Maxion 2009: mean and std are primary descriptors
print("\n[Step 3] Core feature extraction...")
df["avg_dwell"]  = df[h_cols].mean(axis=1)
df["dwell_std"]  = df[h_cols].std(axis=1)
df["avg_flight"] = df[ud_cols].mean(axis=1)
df["flight_std"] = df[ud_cols].std(axis=1)

# ── STEP 4: COEFFICIENT OF VARIATION ─────────────────────────
# Paper 20 2020: CV = std/mean captures relative variability
# Stress increases typing inconsistency (higher CV)
df["dwell_cv"]  = df["dwell_std"]  / (df["avg_dwell"].abs()  + 1e-6)
df["flight_cv"] = df["flight_std"] / (df["avg_flight"].abs() + 1e-6)

# ── STEP 5: TEMPORAL/TREND FEATURES ──────────────────────────
# Online Anomaly Detection 2022: rate of change detects drift onset
# IJCA 2023: slope features improve pre-stress detection
df = df.sort_values("subject").reset_index(drop=True)
df["dwell_delta"]  = df.groupby("subject")["avg_dwell"].diff().fillna(0)
df["flight_delta"] = df.groupby("subject")["avg_flight"].diff().fillna(0)

# ── STEP 6: ROLLING WINDOW FEATURES ──────────────────────────
# Paper 20 2020: 5s / 10s / 15s windows (we use 5/10/20 rows)
# Multiple window sizes capture short-term and medium-term patterns
print("[Step 6] Rolling window features (3 window sizes)...")
for w in [5, 10, 20]:
    df[f"dwell_roll_mean_{w}"] = (
        df.groupby("subject")["avg_dwell"]
          .transform(lambda x: x.rolling(w, min_periods=1).mean()))
    df[f"dwell_roll_std_{w}"] = (
        df.groupby("subject")["avg_dwell"]
          .transform(lambda x: x.rolling(w, min_periods=1).std().fillna(0)))
    df[f"flight_roll_mean_{w}"] = (
        df.groupby("subject")["avg_flight"]
          .transform(lambda x: x.rolling(w, min_periods=1).mean()))

# ── STEP 7: PER-USER NORMALIZATION ───────────────────────────
# Idiographic ML 2023: CRITICAL — normalize relative to own baseline
# Without this: fast typists appear anomalous vs slow typists
# With this: each person's deviation is measured against THEMSELVES
print("[Step 7] Per-user Z-score normalization (Idiographic ML 2023)...")
core_features = ["avg_dwell","dwell_std","avg_flight","flight_std",
                 "dwell_cv","flight_cv"]
for col in core_features:
    user_mean = df.groupby("subject")[col].transform("mean")
    user_std  = df.groupby("subject")[col].transform("std").replace(0, 1e-6)
    df[f"{col}_norm"] = (df[col] - user_mean) / user_std

# ── FINAL OUTPUT ──────────────────────────────────────────────
df = df.rename(columns={"subject": "user_id"})
drop_cols = h_cols + ud_cols  # remove raw columns, keep features
keep_cols = [c for c in df.columns if c not in drop_cols]
out_df = df[keep_cols].dropna()

print(f"\nFinal dataset: {out_df.shape[0]} rows × {out_df.shape[1]} columns")
print(f"Users: {out_df['user_id'].nunique()}")
print(f"\nFeatures generated:")
feat_cols = [c for c in out_df.columns if c != "user_id"]
for c in feat_cols:
    print(f"  {c}")

out_df.to_csv(OUT, index=False)
print(f"\n✅ Saved: {OUT}")
print("Next: python s2_cmu_train.py")