# phenotyping/research_v1_kaggle_mobile/src/s1_kaggle_preprocess.py
"""
STEP 1: Preprocessing for Kaggle Mobile Behavioral Biometrics Dataset
======================================================================
HOW TO USE:
  1. Download the CSV from Kaggle:
     https://www.kaggle.com/datasets/aryaanyaadav/mobile-behavioral-biometrics-dataset
  2. Place the CSV file inside:
     phenotyping/research_v1_kaggle_mobile/data/raw/behavioral_biometrics.csv
  3. Run this script: python s1_kaggle_preprocess.py

WHAT THIS SCRIPT DOES:
  - Auto-detects column names (Kaggle CSV naming is not guaranteed)
  - Verifies units (seconds vs milliseconds) from data statistics
  - Engineers consistent features matching CMU/SWELL pipeline style
  - Per-user Z-normalization (idiographic/personalized)
  - Saves processed CSV for s2_kaggle_train_compare.py
"""

import pandas as pd
import numpy as np
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT      = Path(__file__).resolve().parents[1]
RAW_DIR   = ROOT / "data" / "raw"
OUT_DIR   = ROOT / "data" / "processed"
OUT_FILE  = OUT_DIR / "kaggle_mobile_processed.csv"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Try to find the CSV automatically ─────────────────────────────────────────
def find_csv(raw_dir):
    candidates = list(raw_dir.glob("*.csv"))
    if len(candidates) == 0:
        print("❌ No CSV file found in data/raw/")
        print("   Please download from Kaggle and place it in:")
        print(f"   {raw_dir}/behavioral_biometrics.csv")
        return None
    if len(candidates) > 1:
        print(f"⚠️  Multiple CSVs found: {[c.name for c in candidates]}")
        print(f"   Using: {candidates[0].name}")
    return candidates[0]

# ── Column auto-detection ──────────────────────────────────────────────────────
COLUMN_MAP = {
    # Kaggle column name variants → our standard name
    "dwell time":        "dwell_raw",
    "dwelltime":         "dwell_raw",
    "dwell":             "dwell_raw",
    "dwell_avg":         "dwell_raw",
    "hold time":         "dwell_raw",

    "flight time":       "flight_raw",
    "flighttime":        "flight_raw",
    "flight":            "flight_raw",
    "flight_avg":        "flight_raw",
    "inter-key time":    "flight_raw",

    "characters per minute": "cpm_raw",
    "cpm":               "cpm_raw",
    "typing speed":      "cpm_raw",

    "error rate":        "error_raw",
    "error_rate":        "error_raw",
    "errorrate":         "error_raw",

    "touch pressure":    "pressure_raw",
    "touchpressure":     "pressure_raw",
    "pressure_touch":    "pressure_raw",
    "pressure":          "pressure_raw",

    "scroll x":          "scroll_x_raw",
    "scrollx":           "scroll_x_raw",
    "scroll_x":          "scroll_x_raw",

    "scroll y":          "scroll_y_raw",
    "scrolly":           "scroll_y_raw",
    "scroll_y":          "scroll_y_raw",

    "tilt axis":         "tilt_raw",
    "tiltaxis":          "tilt_raw",
    "tilt_angle_avg":    "tilt_raw",
    "tilt":              "tilt_raw",

    "user id":           "user_id",
    "userid":            "user_id",
    "user":              "user_id",
    "participant":       "user_id",
    "subject":           "user_id",
}

def detect_and_rename(df):
    """Rename columns to standard names regardless of Kaggle's exact naming."""
    rename = {}
    for col in df.columns:
        key = col.strip().lower()
        if key in COLUMN_MAP:
            rename[col] = COLUMN_MAP[key]
    df = df.rename(columns=rename)
    print(f"✅ Detected and renamed columns: {rename}")
    return df

def detect_units(df, col, name):
    """
    Auto-detect if a timing column is in seconds or milliseconds.
    Desktop dwell typical: 0.05–0.30s  → if mean < 2.0 → seconds
    Mobile dwell typical:  50–300ms    → if mean > 2.0 → milliseconds
    """
    if col not in df.columns:
        return
    mean_val = df[col].dropna().mean()
    if mean_val > 2.0:
        print(f"  📐 {name}: mean={mean_val:.1f} → detected as MILLISECONDS → converting to seconds")
        df[col] = df[col] / 1000.0
    else:
        print(f"  📐 {name}: mean={mean_val:.4f} → detected as SECONDS → no conversion needed")

def main():
    print("=" * 60)
    print("  🚀 S1: Kaggle Mobile Biometrics Preprocessing")
    print("=" * 60)

    # ── 1. Load CSV ────────────────────────────────────────────────
    csv_path = find_csv(RAW_DIR)
    if csv_path is None:
        return
    print(f"\n📂 Loading: {csv_path.name}")
    df = pd.read_csv(csv_path)
    print(f"   Raw shape: {df.shape}")
    print(f"   Raw columns: {list(df.columns)}")

    # ── 2. Rename columns to standard names ───────────────────────
    df = detect_and_rename(df)

    # ── 3. Check required columns ─────────────────────────────────
    required = ["user_id", "dwell_raw", "flight_raw"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"\n❌ MISSING required columns after rename: {missing}")
        print("   Check that your CSV has 'User ID', 'Dwell Time', 'Flight Time' columns.")
        print(f"   Actual columns found: {list(df.columns)}")
        return

    # ── 4. Unit auto-detection and correction ─────────────────────
    print("\n🔍 Unit Detection:")
    detect_units(df, "dwell_raw",  "Dwell Time")
    detect_units(df, "flight_raw", "Flight Time")

    # ── 5. Drop rows with missing values in core features ─────────
    core = ["user_id", "dwell_raw", "flight_raw"]
    before = len(df)
    df = df.dropna(subset=core)
    print(f"\n🧹 Dropped {before - len(df)} rows with missing core values. Remaining: {len(df)}")

    # ── 6. Convert feature columns to numeric ─────────────────────
    feature_cols_raw = ["dwell_raw", "flight_raw", "scroll_x_raw", "scroll_y_raw",
                        "pressure_raw", "tilt_raw", "cpm_raw", "error_raw"]
    for col in feature_cols_raw:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Physical bounds filter: Dwell between 1ms (0.001s) and 2.0s for mobile touch
    mask = (df["dwell_raw"] > 0.001) & (df["dwell_raw"] < 2.0)
    df = df[mask]
    print(f"   After physical bounds filter: {len(df)} rows")

    # ── 7. User statistics ────────────────────────────────────────
    user_counts = df["user_id"].value_counts()
    print(f"\n👥 Users found: {len(user_counts)}")
    print(f"   Records per user: min={user_counts.min()}, max={user_counts.max()}, mean={user_counts.mean():.0f}")

    # Drop users with < 10 records (too few for OC-SVM training)
    valid_users = user_counts[user_counts >= 10].index
    df = df[df["user_id"].isin(valid_users)]
    print(f"   Users with ≥10 records: {len(valid_users)} (dropped {len(user_counts) - len(valid_users)} users)")

    # ── 8. Feature Engineering ────────────────────────────────────
    print("\n⚙️  Engineering Features...")

    # Core timing features (always present)
    df["avg_dwell"]   = df["dwell_raw"]
    df["avg_flight"]  = df["flight_raw"]

    # Scroll magnitude (combine X and Y into one speed vector)
    if "scroll_x_raw" in df.columns and "scroll_y_raw" in df.columns:
        df["scroll_magnitude"] = np.sqrt(df["scroll_x_raw"]**2 + df["scroll_y_raw"]**2)
        print("  ✅ scroll_magnitude engineered from Scroll X + Y")
    elif "scroll_x_raw" in df.columns:
        df["scroll_magnitude"] = df["scroll_x_raw"].abs()
    elif "scroll_y_raw" in df.columns:
        df["scroll_magnitude"] = df["scroll_y_raw"].abs()
    else:
        df["scroll_magnitude"] = np.nan

    # Touch pressure (mobile unique signal)
    if "pressure_raw" in df.columns:
        df["touch_pressure"] = df["pressure_raw"]
        print("  ✅ touch_pressure available")
    else:
        df["touch_pressure"] = np.nan

    # Tilt axis
    if "tilt_raw" in df.columns:
        df["tilt_axis"] = df["tilt_raw"]
        print("  ✅ tilt_axis available")
    else:
        df["tilt_axis"] = np.nan

    # CPM and error rate
    if "cpm_raw" in df.columns:
        df["typing_speed"] = df["cpm_raw"]
        print("  ✅ typing_speed (CPM) available")
    else:
        df["typing_speed"] = np.nan

    if "error_raw" in df.columns:
        df["error_rate"] = df["error_raw"]
        print("  ✅ error_rate available")
    else:
        df["error_rate"] = np.nan

    # ── 9. Per-User Z-Normalization (Idiographic / Personalized) ──
    print("\n📊 Per-User Z-Normalization...")
    feature_cols = ["avg_dwell", "avg_flight", "scroll_magnitude",
                    "touch_pressure", "tilt_axis", "typing_speed", "error_rate"]

    for col in feature_cols:
        if col in df.columns and df[col].notna().sum() > 0:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            u_mean = df.groupby("user_id")[col].transform("mean")
            u_std  = df.groupby("user_id")[col].transform("std").replace(0, 1e-6)
            df[f"{col}_z"] = (df[col] - u_mean) / u_std

    z_cols = [c for c in df.columns if c.endswith("_z")]
    print(f"   Z-normalized features: {z_cols}")

    # ── 10. Save ──────────────────────────────────────────────────
    df.to_csv(OUT_FILE, index=False)
    print(f"\n✅ Preprocessing Complete!")
    print(f"   Output: {OUT_FILE}")
    print(f"   Shape: {df.shape}")
    print(f"   Label distribution: NO STRESS LABELS — using inter-user proxy in S2")
    print(f"\n📋 Feature summary:")
    for col in z_cols:
        non_null = df[col].notna().sum()
        print(f"   {col}: {non_null} valid rows ({100*non_null/len(df):.1f}%)")

if __name__ == "__main__":
    main()
