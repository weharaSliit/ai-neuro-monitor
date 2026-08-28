# phenotyping/research_synthesis/src/s3_final_research_table.py
"""
S3: Generate Multi-Metric Research Matrix for Thesis / Presentation Panel
==========================================================================
Pivots and formats all 5 metrics across all 4 research datasets.
"""

import pandas as pd
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[2]
IN_PATH = ROOT / "research_synthesis" / "outputs" / "global_model_comparison.csv"
OUT_CSV = ROOT / "research_synthesis" / "outputs" / "final_thesis_5_metrics_table.csv"

def generate_panel_matrix():
    print("=" * 75)
    print("📝 [S3] Generating Full 5-Metric Research Matrix for Thesis...")
    print("=" * 75)
    
    if not IN_PATH.exists():
        print(f"❌ Error: {IN_PATH} not found. Run s1_metric_aggregator.py first.")
        return

    try:
        df = pd.read_csv(IN_PATH)
        metrics = ['Accuracy', 'Balanced_Accuracy', 'F1-Score', 'Precision', 'Recall', 'ROC_AUC']
        
        # Group by Context and Model
        summary = df.groupby(['Context', 'Model'])[metrics].mean().round(4)
        
        print("\n🏆 --- FINAL 5-METRIC RESEARCH TABLE (PANEL DISPLAY) ---")
        print(summary.to_string())
        
        summary.to_csv(OUT_CSV)
        print(f"\n✅ Success! Full 5-metric table saved to:\n   {OUT_CSV}")
        
    except Exception as e:
        print(f"❌ Error during pivot: {e}")

if __name__ == "__main__":
    generate_panel_matrix()