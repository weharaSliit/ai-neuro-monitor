"""
================================================================
S5 - SWELL-KW PREPROCESSING (PURE DIGITAL PHENOTYPING)
================================================================
Pipeline (Option B - Temporal pre-stress, NO physiology):

  1. Load raw SWELL-KW workbook
  2. Keep ONLY 6 behavioural features + PP + Condition
     (NO HR, NO RMSSD, NO face, NO body)
  3. Drop NaN rows and idle minutes (SnKeyStrokes == 0)
  4. Sort each participant by row order (preserves time)
  5. Create THREE temporal labels:
       - 'stressed'   = T or I rows
       - 'pre_stress' = last 5 N rows BEFORE first T or I
       - 'normal'     = remaining N rows
  6. Save audit trail + clean CSV

Pre-stress definition:
  The 5 minutes of Neutral condition immediately preceding the
  first Time-pressure or Interruption block. Behavior may
  already deviate before the formal stressor begins -- this
  is the novel signal we measure.

Author : AI-Neuro-Monitor team
Output : data/processed/swell_processed.csv
         outputs/swell_preprocessing_audit.csv
================================================================
"""
from pathlib import Path
import sys
import pandas as pd
import numpy as np

# --------------------------------------------------------------
# CONFIG
# --------------------------------------------------------------
ROOT       = Path(__file__).resolve().parents[1]
RAW_FILE   = ROOT / "data" / "raw" / "Behavioral-features_per_minute.xlsx"
OUT_DATA   = ROOT / "data" / "processed" / "swell_processed.csv"
OUT_AUDIT  = ROOT / "outputs" / "swell_preprocessing_audit.csv"
SHEET      = "SWELLdata"

# 6 behavioural features  (NO physiology, NO face, NO body)
FEATURES = [
    "SnKeyStrokes",
    "SnChars",
    "ErrorKeyRatio",
    "CharactersRatio",
    "SnMouseAct",
    "SnAppChange",
]

KEEP = ["PP", "Condition"] + FEATURES

PRE_STRESS_WINDOW = 5     # last 5 Neutral rows before T/I = pre_stress
NORMAL_CONDS  = ["N"]
STRESS_CONDS  = ["T", "I"]
DROP_CONDS    = ["R"]     # Relaxation -> not used


# --------------------------------------------------------------
def main():
    print("=" * 65)
    print("  S5 - SWELL-KW PREPROCESSING (PURE DIGITAL PHENOTYPING)")
    print("  Temporal pre-stress | NO physiology")
    print("=" * 65)

    if not RAW_FILE.exists():
        print(f"\n[ERROR] Raw file not found: {RAW_FILE}")
        sys.exit(1)

    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    OUT_AUDIT.parent.mkdir(parents=True, exist_ok=True)

    # --------------------------------------------------------
    audit_rows = []
    def step(name, before, after, action):
        audit_rows.append({"step": name,
                           "rows_before": before,
                           "rows_after":  after,
                           "action":      action})
        print(f"\n  [{name}]  {action}")
        print(f"      rows: {before}  ->  {after}")

    # 1. LOAD ------------------------------------------------
    print(f"\n[1/6] Loading workbook: {RAW_FILE.name}")
    try:
        df = pd.read_excel(RAW_FILE, sheet_name=SHEET, engine="openpyxl")
    except ValueError:
        print(f"      [WARN] Sheet '{SHEET}' not found, using first sheet.")
        df = pd.read_excel(RAW_FILE, sheet_name=0, engine="openpyxl")
    n0 = len(df)
    print(f"      Loaded {df.shape[0]} rows x {df.shape[1]} cols")

    # 2. CHECK COLUMNS ---------------------------------------
    print(f"\n[2/6] Verifying required columns ...")
    missing = [c for c in KEEP if c not in df.columns]
    if missing:
        print(f"      [ERROR] Missing columns: {missing}")
        sys.exit(1)
    print(f"      All required columns present.")

    # 3. KEEP RELEVANT COLS, DROP R --------------------------
    df = df[KEEP].copy()
    df = df[df["Condition"].isin(NORMAL_CONDS + STRESS_CONDS)].copy()
    step("3-Filter", n0, len(df), "Kept 8 cols, dropped R rows")

    # 4. NaN + idle removal ----------------------------------
    n1 = len(df)
    df = df.dropna(subset=FEATURES).copy()
    df = df[df["SnKeyStrokes"] > 0].copy()
    step("4-Clean", n1, len(df), "Dropped NaN + idle (SnKeyStrokes==0) rows")

    # 5. TEMPORAL PRE-STRESS LABELS  -------------------------
    # Per participant:
    #   - sort by original row order (time order in SWELL recordings)
    #   - find the FIRST occurrence of T or I  -> that is the stress onset
    #   - the 5 N rows immediately BEFORE that index = pre_stress
    #   - all other N rows = normal
    #   - all T or I rows = stressed
    print(f"\n[5/6] Assigning temporal labels per participant ...")
    df = df.sort_values(["PP"]).reset_index(drop=False)   # keeps original row index
    df.rename(columns={"index": "orig_idx"}, inplace=True)

    df["label"] = "normal"          # default
    n_pre_per_user = []
    for pp, sub in df.groupby("PP", sort=False):
        sub_sorted = sub.sort_values("orig_idx")
        # first stress row index (in sub_sorted)
        stress_mask = sub_sorted["Condition"].isin(STRESS_CONDS)
        if not stress_mask.any():
            # no stress condition for this user -- mark all N as normal
            n_pre_per_user.append((pp, 0))
            continue
        first_stress_pos = stress_mask.values.argmax()    # row index inside sub_sorted

        # candidates for pre_stress: N rows BEFORE first stress, take last 5
        before = sub_sorted.iloc[:first_stress_pos]
        n_before = before[before["Condition"].isin(NORMAL_CONDS)]
        pre_idx = n_before.tail(PRE_STRESS_WINDOW)["orig_idx"].values
        df.loc[df["orig_idx"].isin(pre_idx), "label"] = "pre_stress"
        n_pre_per_user.append((pp, len(pre_idx)))

    # all stressed rows
    df.loc[df["Condition"].isin(STRESS_CONDS), "label"] = "stressed"

    label_counts = df["label"].value_counts().to_dict()
    step("5-Labels", len(df), len(df),
         f"Labels assigned (window={PRE_STRESS_WINDOW}): {label_counts}")

    # diagnostic: pre_stress per user
    pre_summary = pd.DataFrame(n_pre_per_user,
                               columns=["PP", "n_pre_stress"])
    print(f"\n      Pre-stress rows per participant (mean): "
          f"{pre_summary['n_pre_stress'].mean():.2f}")
    print(f"      Participants with 0 pre_stress rows  : "
          f"{(pre_summary['n_pre_stress']==0).sum()} / {len(pre_summary)}")

    # 6. SAVE ------------------------------------------------
    final = df[["PP", "Condition", "label"] + FEATURES].rename(
        columns={"PP": "user_id"})
    final.to_csv(OUT_DATA, index=False)
    pd.DataFrame(audit_rows).to_csv(OUT_AUDIT, index=False)

    print("\n" + "=" * 65)
    print("  FINAL OUTPUT")
    print("=" * 65)
    print(f"  Rows               : {len(final)}")
    print(f"  Users              : {final['user_id'].nunique()}")
    print(f"  Features (no phys) : {FEATURES}")
    print(f"  Labels             :")
    for lbl, n in final["label"].value_counts().items():
        print(f"      {lbl:11s} : {n}")
    print(f"\n  Saved data  -> {OUT_DATA.relative_to(ROOT)}")
    print(f"  Saved audit -> {OUT_AUDIT.relative_to(ROOT)}")
    print(f"\n  Next: python s6_swell_train.py")
    print("=" * 65)


if __name__ == "__main__":
    main()