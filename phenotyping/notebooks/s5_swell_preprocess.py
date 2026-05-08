# s5_swell_preprocess.py — COMPLETE REBUILD
# ─────────────────────────────────────────────────────────
# CHANGES FROM BEFORE (all 10 steps):
#   Step 1:  UNCHANGED — condition mapping R/N→normal, T/I→stressed
#   Step 2:  ← NEW — IQR outlier removal per user (Stress 2024)
#   Step 3:  MODIFIED — HR+RMSSD pre-stress labels (was: last-8-rows)
#   Step 4:  UNCHANGED — NaN fill with per-user median
#   Step 5:  ← NEW — sliding window (size=5, step=2, 4 stats per feat)
#   Step 6:  ← NEW — min-max scaling per user (Stress 2024)
#   Step 7:  UNCHANGED — Z-score per user vs own true-normal
#   Step 8:  ← NEW — Pearson correlation feature selection (HRV 2025)
#   Step 9:  UNCHANGED — Welch t-test statistical significance
#   Step 10: ← NEW — audit trail saved to CSV
# ─────────────────────────────────────────────────────────
import pandas as pd
import numpy as np
from scipy import stats
from scipy.stats import pearsonr
import os, warnings
warnings.filterwarnings("ignore")
os.makedirs("../data/processed", exist_ok=True)
os.makedirs("../outputs", exist_ok=True)

RAW       = "../data/raw/Behavioral-features_per_minute.xlsx"
OUT       = "../data/processed/swell_processed.csv"
STAT_OUT  = "../outputs/swell_feature_significance.csv"
AUDIT_OUT = "../outputs/swell_preprocessing_audit.csv"  # ← NEW

print("=" * 65)
print("  S5 — SWELL-KW PREPROCESSING — COMPLETE REBUILD")
print("  10 Steps — all literature-grounded")
print("=" * 65)

df = pd.read_excel(RAW, engine="openpyxl")
print(f"Loaded: {df.shape}")

def find_col(keywords, cols):
    for kw in keywords:
        for c in cols:
            if kw.lower() == c.lower():
                return c
    for kw in keywords:
        for c in cols:
            if kw.lower() in c.lower():
                return c
    return None

PARTICIPANT = find_col(["PP","pp","participant","subject"], df.columns)
CONDITION   = find_col(["Condition","condition","cond"], df.columns)
HR_COL      = find_col(["HR"], df.columns)
RMSSD_COL   = find_col(["RMSSD","rmssd"], df.columns)

print(f"Participant: {PARTICIPANT} | Condition: {CONDITION}")
print(f"HR: {HR_COL} | RMSSD: {RMSSD_COL}")
print(f"Conditions: {df[CONDITION].unique()}")

# Audit trail ← NEW
audit = {"step":[],"rows_before":[],"rows_after":[],
         "feat_before":[],"feat_after":[],"action":[]}
def log(step, rb, ra, fb, fa, action):
    audit["step"].append(step); audit["rows_before"].append(rb)
    audit["rows_after"].append(ra); audit["feat_before"].append(fb)
    audit["feat_after"].append(fa); audit["action"].append(action)
    print(f"\n  [{step}] {action}")
    print(f"    Rows: {rb} → {ra}  |  Features: {fb} → {fa}")

# ── STEP 1: CONDITION MAPPING — UNCHANGED ─────────────────
NORMAL_CONDS = ["r","n"]
STRESS_CONDS = ["t","i"]
r0 = len(df)
df["base_condition"] = df[CONDITION].apply(
    lambda x: "normal"   if str(x).strip().lower() in NORMAL_CONDS else
             ("stressed" if str(x).strip().lower() in STRESS_CONDS else "skip")
)
df = df[df["base_condition"] != "skip"].copy()

EXCLUDE_BASE = [c for c in [
    PARTICIPANT, CONDITION, "base_condition", HR_COL, RMSSD_COL,
    "Valence_rc","Arousal_rc","Dominance","Stress","MentalEffort",
    "MentalDemand","PhysicalDemand","TemporalDemand","Effort",
    "Performance_rc","Frustration","NasaTLX","Squality",
    "Sneutral","Shappy","Ssad","Sangry","Ssurprised","Sscared",
    "Sdisgusted","Svalence","Blok","timestamp"
] if c is not None and c in df.columns]

beh_kws  = ["key","mouse","click","scroll","char","app","tab",
             "dragg","wheel","stroke","error","ratio"]
beh_cols = [c for c in df.columns
            if c not in EXCLUDE_BASE
            and df[c].dtype in [float,int,np.float64,np.int64]
            and any(k in c.lower() for k in beh_kws)]

if len(beh_cols) < 4:
    num_cols = [c for c in df.columns
                if c not in EXCLUDE_BASE
                and df[c].dtype in [float,int,np.float64,np.int64]]
    compl    = {c: df[c].notna().mean() for c in num_cols}
    beh_cols = sorted(compl, key=compl.get, reverse=True)[:12]

print(f"\nBehavioral columns ({len(beh_cols)}): {beh_cols}")
for col in beh_cols + ([HR_COL,RMSSD_COL] if HR_COL else []):
    if col and col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

log("1-Conditions", r0, len(df), len(df.columns), len(beh_cols),
    "R/N → normal, T/I → stressed, skip others")

# ── STEP 2: IQR OUTLIER REMOVAL ← NEW ────────────────────
# Stress Classification 2024: IQR 25%-75% per user per feature
print("\n[Step 2] IQR outlier removal per user ← NEW")
r2 = len(df)
for uid in df[PARTICIPANT].unique():
    umask = df[PARTICIPANT] == uid
    for col in beh_cols:
        vals = df.loc[umask, col].dropna()
        if len(vals) < 4:
            continue
        Q1, Q3 = vals.quantile(0.25), vals.quantile(0.75)
        IQR    = Q3 - Q1
        lo, hi = Q1 - 1.5*IQR, Q3 + 1.5*IQR
        bad    = umask & ((df[col] < lo) | (df[col] > hi))
        df.loc[bad, col] = np.nan
log("2-IQR", r2, len(df), len(beh_cols), len(beh_cols),
    "IQR 25%-75% outlier → NaN (Stress Classification 2024)")

# ── STEP 3: PRE-STRESS LABELS — MODIFIED (HR+RMSSD) ───────
# Before: arbitrary last-8 rows
# Now: HR elevation + RMSSD suppression within neutral condition
print(f"\n[Step 3] Pre-stress labels using HR+RMSSD [MODIFIED]")
print("  Before: last-8 neutral rows (arbitrary)")
print("  Now:    HR > mean+0.5σ OR RMSSD < mean-0.5σ (physiological)")
df["label"]  = df["base_condition"]
pre_count    = 0
hr_ok    = HR_COL    and df[HR_COL].notna().sum()    > 50
rmssd_ok = RMSSD_COL and df[RMSSD_COL].notna().sum() > 50

if hr_ok or rmssd_ok:
    for uid in df[PARTICIPANT].unique():
        umask    = df[PARTICIPANT] == uid
        normm    = umask & (df["base_condition"] == "normal")
        pre_mask = pd.Series(False, index=df.index)

        if hr_ok and df.loc[normm, HR_COL].notna().sum() > 3:
            hr_vals = df.loc[normm, HR_COL].dropna()
            thr     = hr_vals.mean() + 0.5 * max(hr_vals.std(), 0.1)
            pre_mask |= (normm & (df[HR_COL] > thr) & df[HR_COL].notna())

        if rmssd_ok and df.loc[normm, RMSSD_COL].notna().sum() > 3:
            rv      = df.loc[normm, RMSSD_COL].dropna()
            thr     = rv.mean() - 0.5 * max(rv.std(), 0.001)
            pre_mask |= (normm & (df[RMSSD_COL] < thr) & df[RMSSD_COL].notna())

        df.loc[pre_mask, "label"] = "pre_stress"
        pre_count += pre_mask.sum()
    print(f"  Pre-stress rows: {pre_count}")
else:
    PRE_N = 6
    for uid in df[PARTICIPANT].unique():
        umask = df[PARTICIPANT] == uid
        nidx  = df[umask & (df["base_condition"]=="normal")].index
        if len(nidx) > PRE_N:
            df.loc[nidx[-PRE_N:], "label"] = "pre_stress"
            pre_count += PRE_N
    print(f"  Fallback temporal: {pre_count} pre-stress rows")

print(f"  Labels: {df['label'].value_counts().to_dict()}")
if "pre_stress" not in df["label"].values:
    print("⛔ No pre-stress labels. Check HR/RMSSD columns.")
    exit()

# ── STEP 4: NaN FILL — UNCHANGED ──────────────────────────
for col in beh_cols:
    df[col] = df.groupby(PARTICIPANT)[col].transform(
        lambda x: x.fillna(x.median()))
    df[col] = df[col].fillna(df[col].median())

# ── STEP 5: SLIDING WINDOW SEGMENTATION ← NEW ─────────────
# HRV 2025: fixed-length windows for consistency
# 5 rows per window, step=2 (50% overlap)
# 4 statistics per feature: mean, std, iqr, range
print(f"\n[Step 5] Sliding window segmentation ← NEW")
print("  Literature: HRV 2025 — fixed-length windows")
print("  Window=5 rows, Step=2, Stats: mean/std/iqr/range")
WINDOW_SIZE = 5
STEP        = 2

windows = []
for uid in df[PARTICIPANT].unique():
    for lbl in df["label"].unique():
        subset = df[(df[PARTICIPANT]==uid) &
                    (df["label"]==lbl)][beh_cols].reset_index(drop=True)
        if len(subset) < WINDOW_SIZE:
            continue
        i = 0
        while i + WINDOW_SIZE <= len(subset):
            w   = subset.iloc[i:i+WINDOW_SIZE]
            rec = {"user_id": uid, "label": lbl}
            for col in beh_cols:
                vals = w[col].dropna()
                if len(vals) < 2:
                    rec[f"{col}_mean"]  = 0.0
                    rec[f"{col}_std"]   = 0.01
                    rec[f"{col}_iqr"]   = 0.0
                    rec[f"{col}_range"] = 0.0
                else:
                    rec[f"{col}_mean"]  = float(vals.mean())
                    rec[f"{col}_std"]   = float(max(vals.std(), 0.01))
                    rec[f"{col}_iqr"]   = float(vals.quantile(0.75)
                                                - vals.quantile(0.25))
                    rec[f"{col}_range"] = float(vals.max() - vals.min())
            windows.append(rec)
            i += STEP

win_df    = pd.DataFrame(windows)
feat_cols = [c for c in win_df.columns if c not in ["user_id","label"]]
log("5-Windows", len(df), len(win_df), len(beh_cols), len(feat_cols),
    f"Window={WINDOW_SIZE}, step={STEP}, 4 stats → {len(feat_cols)} features")

# ── STEP 6: MIN-MAX SCALING PER USER ← NEW ───────────────
# Stress Classification 2024: features 0-1 range per user
print("\n[Step 6] Min-max scaling per user ← NEW")
print("  Literature: Stress Classification 2024 — 0-1 range")
for uid in win_df["user_id"].unique():
    umask = win_df["user_id"] == uid
    for col in feat_cols:
        vals  = win_df.loc[umask, col]
        mn,mx = vals.min(), vals.max()
        rng   = mx - mn
        win_df.loc[umask, col] = (
            (vals - mn) / rng) if rng > 1e-6 else 0.0
log("6-MinMax", len(win_df), len(win_df), len(feat_cols), len(feat_cols),
    "Scale 0-1 per user per feature (Stress Classification 2024)")

# ── STEP 7: Z-SCORE PER USER — UNCHANGED ─────────────────
# Idiographic ML 2023: normalize vs own true-normal baseline
print("\n[Step 7] Z-score per user vs true-normal baseline...")
z_new = []
for col in feat_cols:
    zcol = f"{col}_z"
    win_df[zcol] = np.nan
    for uid in win_df["user_id"].unique():
        umask      = win_df["user_id"] == uid
        true_norm  = win_df[umask & (win_df["label"]=="normal")][col]
        if len(true_norm) < 2:
            continue
        mu  = true_norm.mean()
        sd  = max(true_norm.std(), 1e-6)
        win_df.loc[umask, zcol] = (win_df.loc[umask, col] - mu) / sd
    z_new.append(zcol)

win_df[z_new] = win_df[z_new].fillna(0)
all_feats     = feat_cols + z_new
log("7-ZScore", len(win_df), len(win_df), len(feat_cols), len(all_feats),
    "Z-score per user vs own true-normal (Idiographic ML 2023)")

# ── STEP 8: PEARSON CORRELATION FILTER ← NEW ─────────────
# HRV 2025: Pearson correlation matrix for feature selection
print("\n[Step 8] Pearson correlation feature selection ← NEW")
print("  Literature: HRV 2025 — correlation matrix heatmap")
label_num = win_df["label"].map(
    {"normal":0,"pre_stress":1,"stressed":2}).fillna(0)

correlations = {}
for col in all_feats:
    try:
        r, _ = pearsonr(win_df[col].fillna(0), label_num)
        correlations[col] = abs(r)
    except:
        correlations[col] = 0

corr_matrix = win_df[all_feats].fillna(0).corr().abs()
upper   = corr_matrix.where(
    np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
to_drop = {c for c in upper.columns if any(upper[c] > 0.95)}
selected = [c for c in all_feats
            if c not in to_drop and correlations.get(c, 0) > 0.01]

print(f"  Top 5 features by label correlation:")
for f in sorted(correlations, key=correlations.get, reverse=True)[:5]:
    print(f"    {f:45} r={correlations[f]:.4f}")
log("8-Pearson", len(win_df), len(win_df), len(all_feats), len(selected),
    f"Removed {len(to_drop)} redundant (r>0.95), kept {len(selected)}")

# ── STEP 9: STATISTICAL SIGNIFICANCE — UNCHANGED ─────────
# IJCA 2023: t-test per feature between normal and pre_stress
print(f"\n[Step 9] Welch t-test: which features distinguish pre_stress?")
sig_results = []
nw  = win_df[win_df["label"]=="normal"]
psw = win_df[win_df["label"]=="pre_stress"]
sw  = win_df[win_df["label"]=="stressed"]
for col in selected:
    try:
        _, p_pre = stats.ttest_ind(
            nw[col].dropna(), psw[col].dropna(), equal_var=False)
        _, p_str = stats.ttest_ind(
            nw[col].dropna(), sw[col].dropna(),  equal_var=False)
        flag = "✅" if p_pre < 0.05 else "⚠️"
        sig_results.append({"feature":col,
            "p_prestress":round(p_pre,4),
            "p_stressed":round(p_str,4),
            "pre_sig": p_pre < 0.05})
    except:
        pass

sig_df    = pd.DataFrame(sig_results)
sig_df.to_csv(STAT_OUT, index=False)
sig_feats = sig_df[sig_df["pre_sig"]]["feature"].tolist()
print(f"  Significant for pre-stress (p<0.05): {len(sig_feats)}")

final_feats = sig_feats if len(sig_feats) >= 4 else selected
keep_cols   = ["user_id","label"] + final_feats
out_df      = win_df[keep_cols].fillna(0)

# ── STEP 10: SAVE WITH AUDIT TRAIL ← NEW ─────────────────
log("10-Final", len(win_df), len(out_df), len(all_feats), len(final_feats),
    "Final preprocessed dataset")
pd.DataFrame(audit).to_csv(AUDIT_OUT, index=False)
out_df.to_csv(OUT, index=False)

print(f"\n{'='*65}")
print(f"  FINAL OUTPUT")
print(f"{'='*65}")
print(f"  Rows:     {len(out_df)}")
print(f"  Features: {len(final_feats)}")
print(f"  Users:    {out_df['user_id'].nunique()}")
print(f"  Labels:")
for lbl, cnt in out_df["label"].value_counts().items():
    print(f"    {lbl:15}: {cnt}")
print(f"\n  Audit: {AUDIT_OUT}")
print(f"  Data:  {OUT}")
print("Next: python s6_swell_train.py")