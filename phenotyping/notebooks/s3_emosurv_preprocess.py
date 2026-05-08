# s3_emosurv_preprocess.py
# ─────────────────────────────────────────────────────────
# PURPOSE: Extract features from EmoSurv keystroke + emotion data
# What this proves: Typing changes with stress-related emotional states
# Dataset: semicolon-separated CSV with raw keystroke events
# Literature:
#   EmoSurv paper 2020 — dwell(D1U1) + flight(U1D2) columns
#   IJCA 2023 — per-session aggregation
#   Idiographic ML 2023 — per-user normalization
# ─────────────────────────────────────────────────────────
import pandas as pd
import numpy as np
import os
os.makedirs("../data/processed", exist_ok=True)

RAW = "../data/raw/Free_Text_Typing_Dataset.csv"
OUT = "../data/processed/emosurv_processed.csv"

print("=" * 60)
print("  S3 — EMOSURV PREPROCESSING")
print("=" * 60)

# EmoSurv uses semicolon separator
df = pd.read_csv(RAW, sep=";", on_bad_lines="skip", engine="python")
print(f"Loaded: {df.shape}")
print(f"\nAll columns ({len(df.columns)}):")
for i, c in enumerate(df.columns):
    print(f"  [{i:2d}] {c}  ({df[c].dtype})")

print(f"\nFirst 3 rows:")
print(df.head(3).to_string())

# ── AUTO-DETECT COLUMNS ───────────────────────────────────────
EMOTION_COL = None
USER_COL    = None
for c in df.columns:
    cl = c.lower()
    if any(k in cl for k in ["emotion","emotionindex"]) and EMOTION_COL is None:
        EMOTION_COL = c
    if any(k in cl for k in ["user","userid"]) and USER_COL is None:
        USER_COL = c

print(f"\nDetected emotion column: {EMOTION_COL}")
print(f"Detected user column:    {USER_COL}")
print(f"Emotion values: {df[EMOTION_COL].unique() if EMOTION_COL else 'NOT FOUND'}")

if not EMOTION_COL or not USER_COL:
    print("⛔ Cannot detect columns. Check file format.")
    exit()

# ── TIMING FEATURE COLUMNS ───────────────────────────────────
# EmoSurv paper: D1U1 = dwell(key down to up), U1D2 = flight (key up to next down)
timing_keywords = ["d1u1","u1d2","d1d2","dwell","press","release",
                   "down","up","latency","inter","flight","hold"]
num_cols    = df.select_dtypes(include=[np.number]).columns.tolist()
timing_cols = [c for c in num_cols
               if any(k in c.lower() for k in timing_keywords)
               and c not in [USER_COL, EMOTION_COL]]

print(f"\nTiming columns found: {timing_cols}")

if len(timing_cols) < 2:
    # Use all numeric columns
    timing_cols = [c for c in num_cols if c not in [USER_COL, EMOTION_COL]]
    print(f"Using all numeric columns: {timing_cols}")

# ── VALID RANGE FILTER ────────────────────────────────────────
# Brain Sciences 2023: valid dwell 5-2000ms, flight ±3000ms
print(f"\n[Step 2] Valid range filter...")
before = len(df)
for col in timing_cols[:4]:  # filter on timing cols
    df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df[df[col].notna()]
    df = df[(df[col] > -5000) & (df[col] < 5000)]
print(f"  Kept {len(df)} rows from {before}")

# ── IQR OUTLIER REMOVAL ──────────────────────────────────────
# IQR outlier removal per user ← MISSING from current s3
# Literature: Stress Classification 2024
print("\n[Step IQR] Outlier removal per user...")
for uid in df[USER_COL].unique():
    umask = df[USER_COL] == uid
    for col in timing_cols[:6]:
        vals = df.loc[umask, col].dropna()
        if len(vals) < 4:
            continue
        Q1, Q3 = vals.quantile(0.25), vals.quantile(0.75)
        IQR    = Q3 - Q1
        lo, hi = Q1 - 1.5*IQR, Q3 + 1.5*IQR
        bad    = umask & ((df[col] < lo) | (df[col] > hi))
        df.loc[bad, col] = np.nan
df = df.dropna(subset=timing_cols[:4])
print(f"  After IQR filter: {len(df)} rows")

# ── PER-SESSION AGGREGATION ───────────────────────────────────
# IJCA 2023: aggregate raw keystrokes into per-session features
# One session = one (user, emotion) combination
print(f"\n[Step 3] Aggregating per user-emotion session...")

agg = {}
for col in timing_cols[:6]:
    agg[col] = ["mean", "std", "median"]

sessions = df.groupby([USER_COL, EMOTION_COL]).agg(agg).reset_index()

# Flatten column names
sessions.columns = [USER_COL, EMOTION_COL] + [
    f"{c}_{s}" for c, s in [(col, stat)
    for col in timing_cols[:6]
    for stat in ["mean","std","median"]]
]
sessions = sessions.dropna()
print(f"Sessions created: {len(sessions)} from {sessions[USER_COL].nunique()} users")

# ── LABEL SESSIONS ────────────────────────────────────────────
# EmoSurv: N=Neutral, H=Happy, C=Calm, A=Anger, S=Sadness
# Normal states: N, H, C (calm/positive)
# Stress-related: A (anger), S (sadness) — most stress-correlated
NORMAL_EMOTIONS = ["n", "h", "c", "neutral","calm","happy","happiness","relax"]
STRESS_EMOTIONS = ["a", "s", "anger","angry","sadness","sad","fear","stress"]

sessions["stress_label"] = sessions[EMOTION_COL].apply(
    lambda x: "normal"   if str(x).strip().lower() in NORMAL_EMOTIONS else
             ("stressed" if str(x).strip().lower() in STRESS_EMOTIONS else None)
)
sessions = sessions.dropna(subset=["stress_label"])

print(f"Normal sessions:   {(sessions['stress_label']=='normal').sum()}")
print(f"Stressed sessions: {(sessions['stress_label']=='stressed').sum()}")

if len(sessions) < 10:
    print(f"\n⛔ Too few sessions.")
    print(f"Actual emotion values: {df[EMOTION_COL].unique()}")
    print("Update NORMAL_EMOTIONS and STRESS_EMOTIONS lists above.")
    exit()

# ── PER-USER NORMALIZATION ────────────────────────────────────
# Idiographic ML 2023: normalize relative to each person's normal
print(f"\n[Step 5] Per-user Z-score normalization...")
feat_cols = [c for c in sessions.columns
             if c not in [USER_COL, EMOTION_COL, "stress_label"]]

for col in feat_cols:
    for uid in sessions[USER_COL].unique():
        mask   = sessions[USER_COL] == uid
        norm_m = sessions[mask & (sessions["stress_label"]=="normal")][col]
        if len(norm_m) < 1:
            continue
        mu = norm_m.mean()
        sd = norm_m.std() if norm_m.std() > 1e-6 else 1e-6
        sessions.loc[mask, f"{col}_norm"] = (sessions.loc[mask, col] - mu) / sd

out = sessions.rename(columns={USER_COL: "user_id"})
out.to_csv(OUT, index=False)
print(f"\n✅ Saved: {OUT}")
print(f"   Shape: {out.shape}")
print("Next: python s4_emosurv_train.py")