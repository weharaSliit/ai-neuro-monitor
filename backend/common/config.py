# ============================================================
# config.py — paths and settings
# ============================================================

import os

# Paths 
BASE_PATH = r"C:\Users\weha1\OneDrive\Documents\ResearchCode\ai-neuro-monitor"

MODELS_PATH = os.path.join(
    BASE_PATH,
    "physiological_signals",
    "saved_models"
)

WESAD_PATH = r"C:\Users\weha1\datasets\WESAD"

RESULTS_PATH = os.path.join(
    BASE_PATH,
    "physiological_signals",
    "results"
)

# Model files 
MODEL_FILE    = os.path.join(MODELS_PATH, "best_model_obj1.pkl")
SCALER_FILE   = os.path.join(MODELS_PATH, "scaler_obj1.pkl")
FEATURES_FILE = os.path.join(MODELS_PATH, "feature_cols_obj1.pkl")

# Firebase 
_CONFIG_DIR = os.path.dirname(os.path.abspath(__file__))
FIREBASE_CRED_FILE = os.path.join(_CONFIG_DIR, "serviceAccountKey.json")
FIREBASE_DB_URL = "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/"

# Prefix all Firebase Realtime Database paths under this namespace
# (e.g. physiological/users, physiological/sessions, ...).
FIREBASE_NAMESPACE = "physiological"


#  App settings 
WESAD_SUBJECTS    = [2,3,4,5,6,7,8,9,10,11,13,14,15,16,17]
WINDOW_STEP_SEC   = 2    # seconds between simulation windows
N_BASELINE_WIN    = 3    # windows for personal baseline
EMA_ALPHA         = 0.2  # EMA learning rate

#  Stress labels 
STRESS_LABELS = {
    0: "Normal",
    1: "Pre-stress",
    2: "Stress"
}

STRESS_COLORS = {
    0: "#22c55e",   # green
    1: "#f59e0b",   # amber
    2: "#ef4444"    # red
}