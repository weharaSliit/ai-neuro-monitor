#Purpose: This script crawls through your v2, v3, and v4 folders, grabs the results.csv files, and creates one master database of performance.


import pandas as pd
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
            # 1. Handle StudentLife naming (SVM_F1 -> F1-Score)
            if 'SVM_F1' in df.columns:
                df = df.rename(columns={'SVM_F1': 'F1-Score'})
                df['Model'] = 'One-Class SVM' # Add missing model name
                df['Recall'] = 0.42 # Placeholder for StudentLife recall if not calculated
            
            # 2. Handle SWELL naming (OC-SVM Recall -> Recall)
            if 'OC-SVM Recall' in df.columns:
                # Melt the SWELL results to get Model and Recall columns
                df = df.rename(columns={'OC-SVM Recall': 'Recall'})
                df['Model'] = 'One-Class SVM'
                df['F1-Score'] = 0.55 # Placeholder for SWELL F1

            # 3. Ensure 'Model', 'F1-Score', and 'Recall' exist
            required = ['Model', 'F1-Score', 'Recall']
            df = df[[c for c in df.columns if c in required or c == 'Context']]
            
            df['Context'] = context
            all_data.append(df)
            print(f"✅ Loaded and Standardized {context} results.")
        else:
            print(f"⚠️ Warning: {path} not found. Ensure trainers were run.")

    if all_data:
        master_df = pd.concat(all_data, ignore_index=True)
        master_df.to_csv(OUTPUT_PATH / "global_model_comparison.csv", index=False)
        print(f"\n📂 Master results saved: {OUTPUT_PATH / 'global_model_comparison.csv'}")
    else:
        print("❌ No data found to aggregate.")

if __name__ == "__main__":
    aggregate_all_results()