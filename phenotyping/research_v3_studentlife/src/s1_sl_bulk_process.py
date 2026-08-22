#This script iterates through every user ID (u00 to u59) and performs the context fusion.
#This script performs "Temporal Context Fusion." It looks at the 2 hours of sensor data leading up to every single stress report for all 60 students.


import pandas as pd
import json
import os
import glob

# Configuration
STRESS_DIR = "../data/raw/stress/"
ACTIVITY_DIR = "../data/raw/activity/"
OUTPUT_DIR = "../data/processed/users/"

def extract_features():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stress_files = sorted(glob.glob(os.path.join(STRESS_DIR, "*.json")))
    
    print(f"📂 Found {len(stress_files)} stress files. Starting bulk processing...")

    for s_path in stress_files:
        user_id = os.path.basename(s_path).split('_')[1].split('.')[0] # Extracts 'u00'
        a_path = os.path.join(ACTIVITY_DIR, f"activity_{user_id}.csv")
        
        if not os.path.exists(a_path):
            continue

        # Load Data
        with open(s_path, 'r') as f:
            stress_data = json.load(f)
        df_act = pd.read_csv(a_path)
        df_act.columns = ['timestamp', 'activity']

        user_records = []
        for entry in stress_data:
            # StudentLife JSON uses 'level' or 'null' for the stress score
            score = entry.get('level') or entry.get('null')
            if score and str(score).isdigit():
                t_end = entry['resp_time']
                t_start = t_end - (2 * 3600) # 2-hour behavioral window
                
                # Filter activity in that window
                window = df_act[(df_act['timestamp'] >= t_start) & (df_act['timestamp'] <= t_end)]
                
                if len(window) > 5: # Ensure enough data points
                    counts = window['activity'].value_counts(normalize=True)
                    user_records.append({
                        'user_id': user_id,
                        'timestamp': t_end,
                        'stationary_perc': counts.get(0, 0),
                        'walking_perc': counts.get(1, 0),
                        'running_perc': counts.get(2, 0),
                        'activity_var': window['activity'].var(),
                        'stress_label': int(score)
                    })

        if user_records:
            pd.DataFrame(user_records).to_csv(f"{OUTPUT_DIR}/{user_id}_features.csv", index=False)
            print(f"✅ Processed {user_id}: {len(user_records)} samples.")

if __name__ == "__main__":
    extract_features()