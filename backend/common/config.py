# ============================================================
# config.py — paths and settings
# ============================================================

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Paths
# Was hardcoded to a teammate's Windows machine (C:\Users\weha1\...) --
# broke model loading on every other machine (/predict, /calibrate return
# 503 "model artifacts not available" whenever this path doesn't exist
# locally, even though the actual .pkl files are checked into the repo at
# physiological_signals/saved_models/). Resolved relative to this file's
# own location (backend/common/ -> repo root) instead, so it's correct on
# whichever machine actually has this checkout.
BASE_PATH = str(Path(__file__).resolve().parents[2])

MODELS_PATH = os.path.join(
    BASE_PATH,
    "physiological_signals",
    "saved_models"
)

WESAD_PATH = os.environ.get("WESAD_PATH", r"C:\Users\weha1\datasets\WESAD")

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

# Firebase -- see backend/common/firebase_config.py for the full,
# documented single source of truth (every module's RTDB namespace, the
# Firestore collection name, credential resolution). Re-exported here
# under their original names so existing `from backend.common.config
# import FIREBASE_...` / `from common.config import FIREBASE_...` calls
# across physiological/ and phenotyping_behavior/ keep working unchanged.
from .firebase_config import (  # noqa: E402
    FIREBASE_CRED_DICT,
    FIREBASE_CRED_FILE,
    FIREBASE_DB_URL,
    RTDB_NAMESPACES,
)

# Prefix all Firebase Realtime Database paths under this namespace
# (e.g. physiological/users, physiological/sessions, ...).
FIREBASE_NAMESPACE = RTDB_NAMESPACES["physiological"]

# Auth — signs/verifies login tokens (backend/common/auth.py). Set
# STRESSAPP_SECRET_KEY in backend/.env (gitignored) for anything beyond
# local dev; the fallback below is intentionally obvious/insecure so it's
# never mistaken for a real deployment secret.
SECRET_KEY = os.environ.get(
    "STRESSAPP_SECRET_KEY", "dev-only-insecure-key-change-me"
)
AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days


#  App settings
N_BASELINE_WIN    = 3    # windows for personal baseline
EMA_ALPHA         = 0.2  # EMA learning rate

# Ring / MQTT — single source of truth. Previously duplicated as literals
# across calibrate_ring.py and mqtt_bridge.py, which meant every network
# change (switching WiFi networks, re-measuring GSR_CAL) required editing
# multiple files and kept getting missed in one of them. Update here only.
MQTT_BROKER = os.environ.get("STRESSAPP_MQTT_BROKER", "10.180.48.56")
MQTT_PORT   = 1883
MQTT_TOPIC  = "mindpulse/wearable01/sensors"
GSR_CAL     = 2872   # measured: electrodes off, raw analogRead(GSR_PIN)

WINDOW_SEC = 60
SETTLE_SEC = 30  # discard this many seconds of data right after startup/
                 # before calibration capture — GSR electrode straps take
                 # a bit to reach steady skin contact, and capturing that
                 # transient skews whatever uses the data (observed
                 # directly during testing)

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
