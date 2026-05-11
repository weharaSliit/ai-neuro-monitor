#Purpose: This generates the "3x3 Matrix" (3 Models vs 3 Datasets) for your final research paper.


import pandas as pd
import os

def generate_3x3_matrix():
    print("📝 [S3] Generating Research Matrix for Thesis...")
    path = "../outputs/global_model_comparison.csv"
    
    if not os.path.exists(path):
        print(f"❌ Error: {path} not found. Run s1_metric_aggregator.py first.")
        return

    try:
        df = pd.read_csv(path)
        
        # Group by Model and Context to get averages (since StudentLife is per-user)
        summary = df.groupby(['Model', 'Context'])[['F1-Score', 'Recall']].mean().reset_index()
        
        # Create the Pivot Table
        matrix = summary.pivot(index='Model', columns='Context', values=['F1-Score', 'Recall'])
        
        print("\n🏆 --- FINAL RESEARCH MATRIX (Averages) ---")
        print(matrix)
        
        out_file = "../outputs/final_thesis_table.csv"
        matrix.to_csv(out_file)
        print(f"\n✅ Success! Table saved to {out_file}")
        
    except Exception as e:
        print(f"❌ Error during pivot: {e}")
        print("Check if global_model_comparison.csv has 'Model', 'Context', 'F1-Score', and 'Recall' columns.")

if __name__ == "__main__":
    generate_3x3_matrix()