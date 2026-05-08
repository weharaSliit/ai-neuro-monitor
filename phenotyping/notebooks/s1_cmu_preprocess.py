# s1_cmu_preprocess.py
# CHANGES FROM BEFORE:
#   ← NEW: Step 2 — IQR outlier removal per user
#           (Stress Classification 2024: IQR 25%-75%)
#   Everything else: UNCHANGED
# ─────────────────────────────────────────────────────────
import pandas as pd
import numpy as np
import os
os.makedirs("../data/processed", exist_ok=True)

RAW = "../data/raw/DSL-StrongPasswordData.csv"
OUT = "../data/processed/cmu_processed.csv"

print("=" * 60)
print("  S1 — CMU KEYSTROKE PREPROCESSING")
print("  Literature: Killourhy & Maxion 2009")
print("              Brain Sciences 2023 (valid ranges)")
print("              Stress Classification 2024 (IQR) ← NEW")
print("              Idiographic ML 2023 (per-user norm)")
print("=" * 60)

df = pd.read_csv(RAW)
print(f"Raw data: {df.shape[0]} rows × {df.shape[1]} columns")

h_cols  = [c for c in df.columns if c.startswith("H.")]
ud_cols = [c for c in df.columns if c.startswith("UD.")]
print(f"Dwell columns (H.*): {len(h_cols)}")
print(f"Flight columns (UD.*): {len(ud_cols)}")

# ── STEP 1: VALID RANGE FILTER ─────────────────────────────
# Brain Sciences 2023: dwell 5ms-2000ms, flight ±3000ms
print("\n[Step 1] Valid range filter (Brain Sciences 2023)...")
before = len(df)
for col in h_cols:
    df[col] = pd.to_numeric(df[col], errors="coerce")
for col in ud_cols:
    df[col] = pd.to_numeric(df[col], errors="coerce")
df = df[(df[h_cols]  > 0.005).all(axis=1)]
df = df[(df[h_cols]  < 2.0).all(axis=1)]
df = df.dropna(subset=h_cols + ud_cols)
print(f"  Removed {before - len(df)} invalid rows → {len(df)} kept")

# ── STEP 2: IQR OUTLIER REMOVAL ← NEW ──────────────────────
# Stress Classification 2024: IQR 25%-75% improves robustness
print("\n[Step 2] IQR outlier removal per user ← NEW")
print("  Literature: Stress Classification 2024 — IQR 25%-75%")
df["subject"] = df["subject"].astype(str)
for uid in df["subject"].unique():
    umask = df["subject"] == uid
    for col in h_cols + ud_cols:
        vals = df.loc[umask, col].dropna()
        if len(vals) < 4:
            continue
        Q1, Q3 = vals.quantile(0.25), vals.quantile(0.75)
        IQR    = Q3 - Q1
        lo, hi = Q1 - 1.5 * IQR, Q3 + 1.5 * IQR
        bad    = umask & ((df[col] < lo) | (df[col] > hi))
        df.loc[bad, col] = np.nan
df = df.dropna(subset=h_cols + ud_cols)
print(f"  After IQR: {len(df)} rows")

# ── STEP 3: CORE FEATURES ─────────────────────────────────
# Killourhy & Maxion 2009: mean and std are primary descriptors
print("\n[Step 3] Core feature extraction...")
df["avg_dwell"]  = df[h_cols].mean(axis=1)
df["dwell_std"]  = df[h_cols].std(axis=1)
df["avg_flight"] = df[ud_cols].mean(axis=1)
df["flight_std"] = df[ud_cols].std(axis=1)

# ── STEP 4: COEFFICIENT OF VARIATION ← UNCHANGED ──────────
# Paper 20 2020: CV captures relative variability
df["dwell_cv"]  = df["dwell_std"]  / (df["avg_dwell"].abs()  + 1e-6)
df["flight_cv"] = df["flight_std"] / (df["avg_flight"].abs() + 1e-6)

# ── STEP 5: TEMPORAL SLOPE FEATURES ← UNCHANGED ───────────
# Online Anomaly Detection 2022: rate of change detects drift
df = df.sort_values("subject").reset_index(drop=True)
df["dwell_delta"]  = df.groupby("subject")["avg_dwell"].diff().fillna(0)
df["flight_delta"] = df.groupby("subject")["avg_flight"].diff().fillna(0)

# ── STEP 6: ROLLING WINDOW FEATURES ← UNCHANGED ───────────
# Paper 20 2020: 5/10/20-row windows
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

# ── STEP 7: PER-USER NORMALIZATION ← UNCHANGED ────────────
# Idiographic ML 2023: normalize relative to own baseline
print("[Step 7] Per-user Z-score normalization...")
core_features = ["avg_dwell","dwell_std","avg_flight","flight_std",
                 "dwell_cv","flight_cv"]
for col in core_features:
    user_mean = df.groupby("subject")[col].transform("mean")
    user_std  = df.groupby("subject")[col].transform("std").replace(0, 1e-6)
    df[f"{col}_norm"] = (df[col] - user_mean) / user_std

# ── FINAL OUTPUT ───────────────────────────────────────────
df = df.rename(columns={"subject": "user_id"})
drop_cols = h_cols + ud_cols
keep_cols = [c for c in df.columns if c not in drop_cols]
out_df    = df[keep_cols].dropna()

print(f"\nFinal: {out_df.shape[0]} rows × {out_df.shape[1]} columns")
print(f"Users: {out_df['user_id'].nunique()}")
out_df.to_csv(OUT, index=False)
print(f"\n✅ Saved: {OUT}")
print("Next: python s2_cmu_train.py")