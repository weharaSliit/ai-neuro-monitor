import pandas as pd
import joblib
import os  # Added for directory management
from sklearn.svm import OneClassSVM

print("==============================================================")
print("  S8 — FINAL PRODUCTION MODEL DEPLOYMENT")
print("  Target: Objective 1 Winner (OC-SVM) + Gold Standard (SWELL)")
print("==============================================================")

# 1. Load the SWELL-KW processed data
data = pd.read_csv('../data/processed/swell_processed.csv')

# Check which label column exists
label_col = 'label' if 'label' in data.columns else 'Label'

# 2. Filter for "Normal" behavior only
normal_data = data[data[label_col] == 'normal']

# 3. Select the features identified in Step 6
features = ['SnKeyStrokes', 'SnChars', 'ErrorKeyRatio']
X = normal_data[features]

print(f"Training on {len(X)} 'Normal' samples using features: {features}")

# 4. Train the Winner: One-Class SVM
model = OneClassSVM(kernel='rbf', gamma='auto', nu=0.05)
model.fit(X)

# --- 5. SAFETY CHECK: Create the directory if it's missing ---
model_dir = '../outputs/models/'
if not os.path.exists(model_dir):
    os.makedirs(model_dir)
    print(f"📁 Created missing directory: {model_dir}")

# 6. Save the FINAL deployment model
model_path = os.path.join(model_dir, 'final_stress_model_s002.joblib')
joblib.dump(model, model_path)

print(f"✅ FINAL RESEARCH MODEL SAVED: {model_path}")
print("==============================================================")