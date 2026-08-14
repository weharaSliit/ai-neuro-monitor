# phenotyping/research_v4_swell/src/s1_swell_preprocess.py
import pandas as pd
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_FILE = ROOT / "data" / "raw" / "Behavioral-features_per_minute.xlsx"
OUT_DATA = ROOT / "data" / "processed" / "swell_v4_processed.csv"

# Core Phenotyping Features [cite: 1735, 1736]
FEATURES = ["SnKeyStrokes", "SnChars", "ErrorKeyRatio", "CharactersRatio", "SnMouseAct", "SnAppChange"]

def main():
    print("🚀 [S1] SWELL Preprocessing V4 - Temporal Escalation...")
    df = pd.read_excel(RAW_FILE, sheet_name="SWELLdata")
    df = df[["PP", "Condition"] + FEATURES].copy().dropna()
    df = df[df["SnKeyStrokes"] > 0] # Quality Gate: Remove idle time

    processed_list = []
    for uid, group in df.groupby("PP"):
        sub = group.sort_index().reset_index(drop=True)
        sub["label"] = "normal"
        # temporal onset of first stressor (I or T)
        stress_idx = sub[sub["Condition"].isin(["I", "T"])].index
        if not stress_idx.empty:
            onset = stress_idx[0]
            # Label 5m before as 'pre_stress' 
            pre_start = max(0, onset - 5)
            sub.loc[pre_start:onset-1, "label"] = "pre_stress"
            sub.loc[onset:, "label"] = "stressed"
        processed_list.append(sub)

    final_df = pd.concat(processed_list)
    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    final_df.to_csv(OUT_DATA, index=False)
    print(f"✅ Saved Processed Data. Label Distribution:\n{final_df['label'].value_counts()}")

if __name__ == "__main__": main()