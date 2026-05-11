import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.preprocessing import StandardScaler
from sklearn.svm import OneClassSVM
import glob
import os

# Create Output Folder
os.makedirs("../outputs/plots/", exist_ok=True)

def generate_research_diagrams(user_id='u59'):
    # Load processed user data
    data_path = f"../data/processed/users/{user_id}_features.csv"
    if not os.path.exists(data_path):
        print(f"❌ File not found for {user_id}")
        return
    
    df = pd.read_csv(data_path)
    X = df[['stationary_perc', 'activity_var']]
    
    # Re-calculate OC-SVM and Z-Scores for the plot
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Train on normal/stationary baseline
    baseline = X_scaled[(df['stress_label'] <= 2) & (df['stationary_perc'] > 0.8)]
    model = OneClassSVM(nu=0.1).fit(baseline)
    
    scores = model.decision_function(X_scaled)
    z_scores = np.abs((scores - np.mean(scores)) / np.std(scores))
    
    # Categorize for Visualization
    df['category'] = 'Normal'
    df.loc[(z_scores >= 1.0) & (z_scores <= 1.5) & (df['stationary_perc'] > 0.8), 'category'] = 'Pre-Stress (True Alert)'
    df.loc[(z_scores >= 1.0) & (z_scores <= 1.5) & (df['stationary_perc'] <= 0.8), 'category'] = 'Physical Noise (Rejected)'
    df.loc[z_scores > 1.5, 'category'] = 'Peak Stress (Anomaly)'

    # --- DIAGRAM 1: THE NOISE GATE (Scatter Plot) ---
    plt.figure(figsize=(10, 6))
    sns.scatterplot(data=df, x='activity_var', y='stationary_perc', hue='category', 
                    palette={'Normal': '#2ecc71', 'Pre-Stress (True Alert)': '#f1c40f', 
                             'Physical Noise (Rejected)': '#3498db', 'Peak Stress (Anomaly)': '#e74c3c'},
                    s=100, alpha=0.8, edgecolor='black')
    
    plt.axhline(0.8, color='black', linestyle='--', label='Quality Gate Threshold')
    plt.title(f"Diagram 1: Physical Noise Quality Gate (User: {user_id})")
    plt.xlabel("Activity Variance (Coarse-Grained)")
    plt.ylabel("Stationary Ratio (%)")
    plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
    plt.tight_layout()
    plt.savefig("../outputs/plots/noise_gate_logic.png")

    # --- DIAGRAM 2: TEMPORAL DRIFT (Vector users) ---
    plt.figure(figsize=(12, 5))
    plt.plot(df.index, z_scores, color='gray', alpha=0.4, label='Behavioral Drift (Z-Score)')
    
    # Highlight the Escalation Band
    plt.axhspan(1.0, 1.5, color='yellow', alpha=0.2, label='Pre-Stress Band (1.0 - 1.5)')
    
    # Plot true alerts
    alerts = df[df['category'] == 'Pre-Stress (True Alert)']
    plt.scatter(alerts.index, z_scores[alerts.index], color='gold', s=80, label='True Pre-Stress Alerts', edgecolors='black')
    
    # Plot rejections
    rejections = df[df['category'] == 'Physical Noise (Rejected)']
    plt.scatter(rejections.index, z_scores[rejections.index], color='blue', marker='x', s=80, label='Noise Rejections')

    plt.title("Diagram 2: Longitudinal Z-Score Drift & Filtering")
    plt.ylabel("Z-Score (Deviation from personal norm)")
    plt.xlabel("Temporal Sequence (Samples over 10 weeks)")
    plt.legend()
    plt.tight_layout()
    plt.savefig("../outputs/plots/temporal_drift.png")

    # --- DIAGRAM 3: THE STAR GRAPH (Radar Chart) ---
    labels = ['Stationary %', 'Walking %', 'Activity Var', 'Stress Level']
    
    def get_radar_stats(cat):
        subset = df[df['category'] == cat]
        if subset.empty: return [0,0,0,0]
        return [subset['stationary_perc'].mean(), subset['walking_perc'].mean(), 
                subset['activity_var'].mean()/df['activity_var'].max(), subset['stress_label'].mean()/5]

    normal_stats = get_radar_stats('Normal')
    stress_stats = get_radar_stats('Pre-Stress (True Alert)')
    
    # Radar logic
    angles = np.linspace(0, 2*np.pi, len(labels), endpoint=False).tolist()
    normal_stats += normal_stats[:1]
    stress_stats += stress_stats[:1]
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(6, 6), subplot_kw=dict(polar=True))
    ax.fill(angles, normal_stats, color='green', alpha=0.25, label='Normal Phenotype')
    ax.fill(angles, stress_stats, color='orange', alpha=0.4, label='Pre-Stress Phenotype')
    
    ax.set_yticklabels([])
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(labels)
    plt.title("Diagram 3: Behavioral Phenotype Signature (Star Graph)")
    plt.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1))
    plt.savefig("../outputs/plots/star_graph_comparison.png")

    print("📊 All Research Diagrams saved to ../outputs/plots/")

if __name__ == "__main__":
    generate_research_diagrams()