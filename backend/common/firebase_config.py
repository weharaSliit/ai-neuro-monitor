import json
import os
from pathlib import Path

# ── Shared project identity ──────────────────────────────────
FIREBASE_PROJECT_ID = "stress-monitor-c39ee"
FIREBASE_DB_URL = "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/"
_CONFIG_DIR = Path(__file__).resolve().parent
FIREBASE_CRED_FILE = str(_CONFIG_DIR / "serviceAccountKey.json")


FIREBASE_CRED_DICT = None
if "FIREBASE_CRED_JSON" in os.environ:
    try:
        FIREBASE_CRED_DICT = json.loads(os.environ["FIREBASE_CRED_JSON"])
    except Exception as e:
        print(f"Warning: Failed to parse FIREBASE_CRED_JSON env var: {e}")


def resolve_credential():
    return FIREBASE_CRED_DICT if FIREBASE_CRED_DICT else FIREBASE_CRED_FILE


RTDB_NAMESPACES = {
    "physiological":        "physiological",   # backend/physiological/ -- HRV/GSR ring, raw readings
    "phenotyping_behavior": "phenotyping",      # backend/phenotyping_behavior/ -- keystroke/app-usage, raw readings
    "psychological":        "psychological",    # backend/psychological/ -- EEG, raw readings
    "intervention":         "intervention",     # reserved -- no writer/reader yet, see this dict's own docstring below
}

FUSION_EN_ROOT = "fusion_en"
FUSION_EN_SESSIONS_ROOT = "fusion_en_sessions"
CURRENT_SESSION_ID_FIELD = "current_session_id"
# Companion to CURRENT_SESSION_ID_FIELD -- written by App.js alongside the
# session id so a device bridge can attribute incoming data to whichever
# user is actually logged into the app right now, instead of a user_id
# fixed at bridge-launch time (see RING_USER_ID in
# backend/physiological/mqtt_bridge.py).
CURRENT_USER_ID_FIELD = "current_user_id"

def init_firebase_app():
    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        cred = credentials.Certificate(resolve_credential())
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
    return firebase_admin.get_app()
