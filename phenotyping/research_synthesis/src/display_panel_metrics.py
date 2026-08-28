# phenotyping/research_synthesis/src/display_panel_metrics.py
"""
Display Academic Evaluation Matrix for Thesis / Defense Panel
=============================================================
Displays the 5 key metrics requested by defense panels:
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

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "research_synthesis" / "outputs" / "global_model_comparison.csv"
OUT_CSV = ROOT / "research_synthesis" / "outputs" / "final_thesis_5_metrics_table.csv"

def display_metrics():
    if not DATA_PATH.exists():
        print(f"❌ Error: {DATA_PATH} not found. Run s1_metric_aggregator.py first.")
        return

    df = pd.read_csv(DATA_PATH)
    metrics = ["Accuracy", "Balanced_Accuracy", "F1-Score", "Precision", "Recall", "ROC_AUC"]

    # Group by Context and Model
    summary = df.groupby(["Context", "Model"])[metrics].mean().round(4)
    
    print("\n" + "=" * 98)
    print(" 🎓 DIGITAL PHENOTYPING: ACADEMIC MODEL EVALUATION MATRIX (DEFENSE PANEL)")
    print("=" * 98)
    print(summary.to_string())
    print("=" * 98)

    summary.to_csv(OUT_CSV)
    print(f"\n✅ Summary table saved to: {OUT_CSV}")

if __name__ == "__main__":
    display_metrics()
