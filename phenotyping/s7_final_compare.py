import pandas as pd
import os

def run_objective_1_closing():
    print("🏁 [S7] Finalizing Objective 1: Model Selection & Evaluation")
    
    results_path = "research_synthesis/outputs/global_model_comparison.csv"
    
    if not os.path.exists(results_path):
        print("❌ Aggregate results not found. Run research_synthesis/src/s1 first.")
        return

    results = pd.read_csv(results_path)
    
    # Calculate global performance to pick the ultimate winner
    performance = results.groupby('Model')[['F1-Score', 'Recall']].mean()
    winner = performance['F1-Score'].idxmax()
    
    print(f"\n👑 WINNING ARCHITECTURE: {winner}")
    print(f"Mean F1 across contexts: {performance.loc[winner, 'F1-Score']:.4f}")
    
    # Create the Status File
    os.makedirs("outputs", exist_ok=True)
    status = pd.DataFrame([{"Objective": 1, "Status": "COMPLETE", "Winner": winner}])
    status.to_csv("outputs/objective_1_status.csv", index=False)
    print("✅ Objective 1 Status saved to outputs/objective_1_status.csv")

if __name__ == "__main__":
    run_objective_1_closing()