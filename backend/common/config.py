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

# Model files — binary (Normal/Stress), trained on WESAD data
# relabeled to match the ring's real task (see
# physiological_signals/notebooks/05_binary_relabel_retrain.ipynb
# and 04_feature_selection.ipynb for the 23-feature set). This is
# the only model the backend loads — WESAD simulation mode has been
# removed, the real ring is the only deployment target.
MODEL_FILE    = os.path.join(MODELS_PATH, "best_model_obj1_v2.pkl")
SCALER_FILE   = os.path.join(MODELS_PATH, "scaler_obj1_v2.pkl")
FEATURES_FILE = os.path.join(MODELS_PATH, "feature_cols_obj1_v2.pkl")

# Firebase
_CONFIG_DIR = os.path.dirname(os.path.abspath(__file__))
FIREBASE_CRED_FILE = os.path.join(_CONFIG_DIR, "serviceAccountKey.json")

# Support for cloud hosting: load credentials from environment variable if it exists
FIREBASE_CRED_DICT = None
if "FIREBASE_CRED_JSON" in os.environ:
    try:
        FIREBASE_CRED_DICT = json.loads(os.environ["FIREBASE_CRED_JSON"])
    except Exception as e:
        print(f"Warning: Failed to parse FIREBASE_CRED_JSON env var: {e}")

FIREBASE_DB_URL = "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/"

# Prefix all Firebase Realtime Database paths under this namespace
# (e.g. physiological/users, physiological/sessions, ...).
FIREBASE_NAMESPACE = "physiological"


#  App settings
N_BASELINE_WIN    = 3    # windows for personal baseline
EMA_ALPHA         = 0.2  # EMA learning rate

# Stress labels — binary (Normal/Stress). WESAD's old "pre-stress"
# was a synthetic transition-window label with no real ground truth
# (~29 windows, F1 0.14-0.29 no matter what was tried), so it was
# dropped entirely rather than carried forward.
# "Trending toward stress" is a separate runtime indicator (see
# TREND_RISING_THRESHOLD below), not a trained class — it never
# overrides the Normal/Stress label.
STRESS_LABELS = {
    0: "Normal",
    1: "Stress"
}

STRESS_COLORS = {
    0: "#22c55e",
    1: "#ef4444"
}

# Only pool a real-ring prediction for future retraining if the model was
# this confident AND the input signal was this clean.
MIN_CONFIDENCE_FOR_RETRAIN     = 0.75
MIN_SIGNAL_QUALITY_FOR_RETRAIN = 0.70

# Fraction of state-machine "rising" votes needed to flag trending_toward_stress
TREND_RISING_THRESHOLD = 0.35
