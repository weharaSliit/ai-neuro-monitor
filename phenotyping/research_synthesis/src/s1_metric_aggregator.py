#Purpose: This script crawls through your v2, v3, and v4 folders, grabs the results.csv files, and creates one master database of performance.


import pandas as pd
import numpy as np
import os
from pathlib import Path

# Setup Paths
ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / "research_synthesis" / "outputs"
os.makedirs(OUTPUT_PATH, exist_ok=True)

def aggregate_all_results():
    print("📊 [S1] Aggregating Metrics from all Research Modules...")

    # Paths to your output files from v2, v3, v4
    sources = {
        "Micro (CMU)": ROOT / "research_v2_cmu" / "outputs" / "cmu_results.csv",
        "Macro (StudentLife)": ROOT / "research_v3_studentlife" / "outputs" / "quality_gate_results.csv",
        "Temporal (SWELL)": ROOT / "research_v4_swell" / "outputs" / "swell_results.csv"
    }

    all_data = []

    for context, path in sources.items():
        if os.path.exists(path):
            df = pd.read_csv(path)

            # --- STANDARDIZATION LOGIC ---
            # 1. Handle StudentLife format (SVM_F1, SVM_Recall per user)
            if 'SVM_F1' in df.columns:
                rename_map = {'SVM_F1': 'F1-Score'}
                if 'SVM_Recall' in df.columns:
                    rename_map['SVM_Recall'] = 'Recall'
                df = df.rename(columns=rename_map)
                df['Model'] = 'One-Class SVM'
                if 'Recall' not in df.columns:
                    # PREVIOUSLY: df['Recall'] = 0.42 — a fabricated constant
                    # silently inserted whenever this column was missing,
                    # indistinguishable from a real per-user measurement once
                    # blended into global_model_comparison.csv. Use NaN and
                    # drop it below instead of manufacturing a number.
                    print(f"⚠️  {context}: no Recall column found — rows will "
                          f"be dropped instead of filled with a fabricated placeholder.")
                    df['Recall'] = np.nan

            # 2. Handle SWELL format (per-user OC-SVM and IF metrics)
            elif 'OC-SVM Recall' in df.columns:
                if 'OC-SVM F1' not in df.columns or 'IF F1' not in df.columns:
                    print(f"⚠️  {context}: expected F1 column(s) missing — "
                          f"affected rows will be dropped instead of filled "
                          f"with fabricated placeholders (previously 0.55/0.50).")
                svm_rows = pd.DataFrame({
                    'Model': 'One-Class SVM',
                    'F1-Score': df['OC-SVM F1'] if 'OC-SVM F1' in df.columns else np.nan,
                    'Recall': df['OC-SVM Recall']
                })
                if_rows = pd.DataFrame({
                    'Model': 'Isolation Forest',
                    'F1-Score': df['IF F1'] if 'IF F1' in df.columns else np.nan,
                    'Recall': df['IF Recall']
                })
                df = pd.concat([svm_rows, if_rows], ignore_index=True)

            # 3. Keep only standardized columns
            required = ['Model', 'F1-Score', 'Recall']
            df = df[[c for c in required if c in df.columns]]

            df['Context'] = context
            all_data.append(df)
            print(f"✅ Loaded and Standardized {context} results.")
        else:
            print(f"⚠️ Warning: {path} not found. Ensure trainers were run.")

    if all_data:
        master_df = pd.concat(all_data, ignore_index=True)

        # Drop any row missing a real F1-Score or Recall value instead of
        # ever silently substituting a fabricated constant (see above).
        n_before = len(master_df)
        master_df = master_df.dropna(subset=['F1-Score', 'Recall'])
        n_dropped = n_before - len(master_df)
        if n_dropped:
            print(f"⚠️  Dropped {n_dropped} row(s) with missing F1-Score/Recall "
                  f"instead of inserting fabricated placeholder values.")

        master_df.to_csv(OUTPUT_PATH / "global_model_comparison.csv", index=False)
        print(f"\n📂 Master results saved: {OUTPUT_PATH / 'global_model_comparison.csv'} "
              f"({len(master_df)} real rows)")
    else:
        print("❌ No data found to aggregate.")

if __name__ == "__main__":
    aggregate_all_results()
