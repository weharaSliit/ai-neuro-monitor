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
    "physiological":        "physiological",   # backend/physiological/ -- HRV/GSR ring
    "phenotyping_behavior": "phenotyping",      # backend/phenotyping_behavior/ -- keystroke/app-usage
    "psychological":        "psychological",    # psychological/ -- EEG (reference only, see module docstring above)
}

def init_firebase_app():
    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        cred = credentials.Certificate(resolve_credential())
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
    return firebase_admin.get_app()
