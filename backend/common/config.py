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
# v3 is trained on baseline-normalised features (physiological_signals/
# retrain_personalised.py), i.e. on the same kind of input that
# predictor.predict_window() feeds it live. v2 was trained on raw features
# and is kept only for predict_raw(), the no-baseline path.
MODEL_FILE    = os.path.join(MODELS_PATH, "best_model_obj1_v3.pkl")
SCALER_FILE   = os.path.join(MODELS_PATH, "scaler_obj1_v3.pkl")
FEATURES_FILE = os.path.join(MODELS_PATH, "feature_cols_obj1_v3.pkl")
RAW_MODEL_FILE    = os.path.join(MODELS_PATH, "best_model_obj1_v2.pkl")
RAW_SCALER_FILE   = os.path.join(MODELS_PATH, "scaler_obj1_v2.pkl")
RAW_FEATURES_FILE = os.path.join(MODELS_PATH, "feature_cols_obj1_v2.pkl")

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
N_BASELINE_WIN    = 3    # windows for personal baseline -- SETTLE_SEC(30s) +
                          # 3*WINDOW_SEC(60s) = 210s (3.5min). Was briefly
                          # dropped to 2 (2.5min) this session, then reverted
                          # -- the real lever for tolerating skipped/rejected
                          # windows turned out to be EXTRA_RETRY_WINDOWS
                          # (calibration_capture.py), not this count; a lower
                          # N_BASELINE_WIN doesn't meaningfully help with
                          # rejected-window failures and does cost baseline
                          # stability (fewer independent samples).
EMA_ALPHA         = 0.2  # EMA learning rate

# Ring / MQTT — single source of truth. Previously duplicated as literals
# across calibrate_ring.py and mqtt_bridge.py, which meant every network
# change (switching WiFi networks, re-measuring GSR_CAL) required editing
# multiple files and kept getting missed in one of them. Update here only.
#
# EMQX Cloud Serverless (mindpulse-broker, Asia-Pacific) — replaces the
# local-IP broker this used to point at. Requires TLS on 8883 with
# username/password auth, unlike the old local Mosquitto's plain-TCP/
# allow_anonymous setup — see MQTT_CA_CERT/MQTT_USER/MQTT_PASSWORD below
# and backend/common/mqtt_bridge.py's connect_mqtt(), which now does the
# tls_set()/username_pw_set() calls this requires.
MQTT_BROKER   = os.environ.get("STRESSAPP_MQTT_BROKER", "ob1f0f10.ala.asia-southeast1.emqxsl.com")
MQTT_PORT     = 8883
MQTT_USER     = os.environ.get("RING_MQTT_USER", "wearable01")
MQTT_PASSWORD = os.environ.get("RING_MQTT_PASSWORD", "wearable01")
MQTT_CA_CERT  = os.path.join(BASE_PATH, "iot_firmware", "emqxsl-ca.crt")
MQTT_TOPIC    = "mindpulse/wearable01/sensors"
GSR_CAL       = 2872   # measured: electrodes off, raw analogRead(GSR_PIN)

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

# Normal/Stress decision cutoff on the model's P(Stress) output. Previously
# an unvalidated implicit 0.5 (XGBoost's own default predict() cutoff, never
# checked against real data -- no ROC analysis existed anywhere in this
# repo). Derived from physiological_signals/notebooks/05_model_training.ipynb
# Cell 2.5: pooled out-of-fold LOSO predict_proba() scores across all 15
# WESAD subjects (n=913), AUC=0.9382, threshold chosen via Youden's J
# (argmax TPR-FPR) at J=0.7287 (TPR=0.850, FPR=0.121) vs. J=0.7069 at the
# old 0.5 cutoff (TPR=0.862, FPR=0.155) -- trades a small amount of Stress
# recall for a meaningfully lower false-Stress-alarm rate. Re-run that
# notebook cell and update this value whenever the model is retrained.
STRESS_DECISION_THRESHOLD = 0.6447
# Youden threshold of the v3 (baseline-normalised) model, from pooled LOSO
# out-of-fold probabilities (AUC 0.9863, J = 0.8688, TPR 0.893, FPR 0.024);
# see physiological_signals/results/objective1/personalised_v3_metrics.json.
# The figures in the paragraph above describe the earlier raw-feature model
# (v2), whose threshold 0.7141 now applies only to predict_raw().
RAW_DECISION_THRESHOLD = 0.7141

# Shared calibration-renewal windows -- used by both physiological's
# baseline (backend/physiological/firebase_service.py::load_baseline_meta)
# and psychological's calibration_profile
# (backend/psychological/firebase_service.py::load_user_calibration_profile)
# so both modalities present the same renewal cadence to the frontend's
# CalibrationGate: not compulsory before CALIBRATION_SOFT_AGE_DAYS, a
# dismissible renewal nudge between soft and hard, compulsory again past
# CALIBRATION_HARD_AGE_DAYS. No measured decay curve exists for either
# modality's drift over time (yet) to derive these from data -- 7/30 days
# is a reasonable renewal cadence chosen to match this project's existing
# 7-day precedent (phenotyping_behavior's calibration protocol) while not
# demanding a fresh calibration every week.
CALIBRATION_SOFT_AGE_DAYS = 7.0
CALIBRATION_HARD_AGE_DAYS = 30.0
