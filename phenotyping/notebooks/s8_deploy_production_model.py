import pandas as pd
import joblib
from sklearn.svm import OneClassSVM
from sklearn.preprocessing import StandardScaler

print("==============================================================")
print("  S8 — FINAL PRODUCTION MODEL DEPLOYMENT")
print("  Target: Objective 1 Winner (OC-SVM) + Gold Standard (SWELL)")
print("==============================================================")

# 1. Load the SWELL-KW processed data
data = pd.read_csv('../data/processed/swell_processed.csv')

# Check which label column exists (Label vs label)
label_col = 'label' if 'label' in data.columns else 'Label'

if label_col not in data.columns:
    print(f"❌ Error: Could not find a label column. Available columns: {list(data.columns)}")
    exit()

# 2. Filter for "Normal" behavior only
# We train the OC-SVM only on normal data so it can detect deviations (stress)
normal_data = data[data[label_col] == 'normal']

# 3. Select the features identified in Step 6
# These are the "Phenotypes" we track in the Android App
features = ['SnKeyStrokes', 'SnChars', 'ErrorKeyRatio']
X = normal_data[features]

print(f"Training on {len(X)} 'Normal' samples using features: {features}")

# 4. Train the Winner: One-Class SVM
# RBF kernel is best for non-linear behavioral patterns
model = OneClassSVM(kernel='rbf', gamma='auto', nu=0.05)
model.fit(X)

# 5. Save the FINAL deployment model
# This is the "Brain" you will show the 80% panel
model_path = '../outputs/models/final_stress_model_s002.joblib'
joblib.dump(model, model_path)

print(f"✅ FINAL RESEARCH MODEL SAVED: {model_path}")
print("==============================================================")