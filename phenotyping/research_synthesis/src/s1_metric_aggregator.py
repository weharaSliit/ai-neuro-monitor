# phenotyping/research_synthesis/src/s1_metric_aggregator.py
"""
S1: Master Performance Metric Aggregator (5 Academic Metrics Edition)
======================================================================
Crawls through v1 (Kaggle), v2 (CMU), v3 (StudentLife), and v4 (SWELL),
standardizes all 5 key metrics:
  1. Accuracy
  2. Balanced Accuracy
  3. F1-Score
  4. Precision
  5. Recall
  6. ROC-AUC Value
"""

import pandas as pd
import numpy as np
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Setup Paths
ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / "research_synthesis" / "outputs"
os.makedirs(OUTPUT_PATH, exist_ok=True)

def aggregate_all_results():
    print("=" * 70)
    print("📊 [S1] Aggregating 5 Metrics from all 4 Research Modules...")
    print("=" * 70)

    sources = {
        "Micro (CMU)":         ROOT / "research_v2_cmu"           / "outputs" / "cmu_results.csv",
        "Mobile (Kaggle)":     ROOT / "research_v1_kaggle_mobile" / "outputs" / "kaggle_results.csv",
        "Macro (StudentLife)": ROOT / "research_v3_studentlife"    / "outputs" / "quality_gate_results.csv",
        "Temporal (SWELL)":    ROOT / "research_v4_swell"          / "outputs" / "swell_results.csv",
    }

    all_data = []

    for context, path in sources.items():
        if not os.path.exists(path):
            print(f"⚠️ Warning: {path} not found. Run trainer for {context} first.")
            continue

        df = pd.read_csv(path)
        standardized_rows = []

        # --- Case A: CMU Format (Model, Accuracy, Balanced_Accuracy, F1-Score, Precision, Recall, ROC_AUC) ---
        if 'Model' in df.columns:
            for _, row in df.iterrows():
                standardized_rows.append({
                    'Context': context,
                    'Model': row['Model'],
                    'Accuracy': row.get('Accuracy', np.nan),
                    'Balanced_Accuracy': row.get('Balanced_Accuracy', np.nan),
                    'F1-Score': row.get('F1-Score', np.nan),
                    'Precision': row.get('Precision', np.nan),
                    'Recall': row.get('Recall', np.nan),
                    'ROC_AUC': row.get('ROC_AUC', np.nan)
                })

        # --- Case B: StudentLife Format (SVM_Accuracy, SVM_F1, etc.) ---
        elif 'SVM_F1' in df.columns:
            for _, row in df.iterrows():
                standardized_rows.append({
                    'Context': context,
                    'Model': 'One-Class SVM',
                    'Accuracy': row.get('SVM_Accuracy', np.nan),
                    'Balanced_Accuracy': row.get('SVM_Balanced_Accuracy', np.nan),
                    'F1-Score': row.get('SVM_F1', np.nan),
                    'Precision': row.get('SVM_Precision', np.nan),
                    'Recall': row.get('SVM_Recall', np.nan),
                    'ROC_AUC': row.get('SVM_ROC_AUC', np.nan)
                })

        # --- Case C: Kaggle / SWELL Format (OC-SVM ..., IF ..., RF ...) ---
        elif 'OC-SVM F1' in df.columns:
            for _, row in df.iterrows():
                # 1. One-Class SVM
                standardized_rows.append({
                    'Context': context,
                    'Model': 'One-Class SVM',
                    'Accuracy': row.get('OC-SVM Accuracy', np.nan),
                    'Balanced_Accuracy': row.get('OC-SVM Balanced_Accuracy', np.nan),
                    'F1-Score': row.get('OC-SVM F1', np.nan),
                    'Precision': row.get('OC-SVM Precision', np.nan),
                    'Recall': row.get('OC-SVM Recall', np.nan),
                    'ROC_AUC': row.get('OC-SVM ROC_AUC', np.nan)
                })
                # 2. Isolation Forest
                if 'IF F1' in row:
                    standardized_rows.append({
                        'Context': context,
                        'Model': 'Isolation Forest',
                        'Accuracy': row.get('IF Accuracy', np.nan),
                        'Balanced_Accuracy': row.get('IF Balanced_Accuracy', np.nan),
                        'F1-Score': row.get('IF F1', np.nan),
                        'Precision': row.get('IF Precision', np.nan),
                        'Recall': row.get('IF Recall', np.nan),
                        'ROC_AUC': row.get('IF ROC_AUC', np.nan)
                    })
                # 3. Random Forest
                if 'RF F1' in row and pd.notna(row['RF F1']):
                    standardized_rows.append({
                        'Context': context,
                        'Model': 'Random Forest',
                        'Accuracy': row.get('RF Accuracy', np.nan),
                        'Balanced_Accuracy': row.get('RF Balanced_Accuracy', np.nan),
                        'F1-Score': row.get('RF F1', np.nan),
                        'Precision': row.get('RF Precision', np.nan),
                        'Recall': row.get('RF Recall', np.nan),
                        'ROC_AUC': row.get('RF ROC_AUC', np.nan)
                    })

        context_df = pd.DataFrame(standardized_rows)
        all_data.append(context_df)
        print(f"✅ Loaded and Standardized {context} results ({len(context_df)} rows).")

    if all_data:
        master_df = pd.concat(all_data, ignore_index=True)
        master_df.to_csv(OUTPUT_PATH / "global_model_comparison.csv", index=False)
        print(f"\n📂 Master results saved: {OUTPUT_PATH / 'global_model_comparison.csv'} ({len(master_df)} rows)")
    else:
        print("❌ No data found to aggregate.")

if __name__ == "__main__":
    aggregate_all_results()
