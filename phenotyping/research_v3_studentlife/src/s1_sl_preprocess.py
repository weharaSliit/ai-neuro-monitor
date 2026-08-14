import pandas as pd
import json
import os

# --- PATH FIXES ---
# If your data is in research_v3_studentlife/data
RAW_STRESS = "../data/raw/stress/stress_u00.json"  # Added /stress/ and lowercase
RAW_ACTIVITY = "../data/raw/activity/activity_u00.csv" # Added /activity/
PROCESSED_DATA = "../data/processed/merged_studentlife_u00.csv"

def preprocess_sl():
    print("🚀 Starting StudentLife Preprocessing...")
    
    # Check if files exist before opening
    if not os.path.exists(RAW_STRESS):
        print(f"❌ Error: Cannot find {RAW_STRESS}")
        print("Check if you have a 'stress' folder inside 'data/raw/'")
        return

    # 1. Load Stress EMA (JSON)
    with open(RAW_STRESS, 'r') as f:
        stress_raw = json.load(f)
    
    stress_list = []
    for entry in stress_raw:
        level = entry.get('level') or entry.get('null')
        if level and str(level).isdigit():
            stress_list.append({
                'timestamp': entry['resp_time'],
                'stress_level': int(level)
            })
    
    df_stress = pd.DataFrame(stress_list)
    
    # 2. Load Activity Sensing (CSV)
    if not os.path.exists(RAW_ACTIVITY):
        print(f"❌ Error: Cannot find {RAW_ACTIVITY}")
        return

    df_act = pd.read_csv(RAW_ACTIVITY)
    df_act.columns = ['timestamp', 'activity_type']
    
    # 3. Time-Window Merging (Contextual Fusion)
    WINDOW = 2 * 3600 
    merged_features = []
    
    for _, report in df_stress.iterrows():
        t_end = report['timestamp']
        t_start = t_end - WINDOW
        mask = (df_act['timestamp'] >= t_start) & (df_act['timestamp'] <= t_end)
        window_data = df_act.loc[mask]
        
        if not window_data.empty:
            activity_counts = window_data['activity_type'].value_counts(normalize=True)
            merged_features.append({
                'timestamp': t_end,
                'stationary_ratio': activity_counts.get(0, 0),
                'walking_ratio': activity_counts.get(1, 0),
                'activity_variance': window_data['activity_type'].var(),
                'label': report['stress_level']
            })

    df_final = pd.DataFrame(merged_features).dropna()
    os.makedirs("../data/processed/", exist_ok=True)
    df_final.to_csv(PROCESSED_DATA, index=False)
    print(f"✅ Successfully saved merged data to {PROCESSED_DATA}")

if __name__ == "__main__":
    preprocess_sl()