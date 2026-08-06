import firebase_admin
from firebase_admin import credentials, db
from datetime import datetime
import os
import sys

# Ensure the backend root is in the path so we can import from common
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.abspath(os.path.join(_CURRENT_DIR, ".."))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# Import the group's shared credentials and URL
from common.config import FIREBASE_CRED_FILE, FIREBASE_DB_URL

# --- RESEARCH NAMESPACE ---
# This ensures your data is stored under 'phenotyping/' in the database
NAMESPACE = "phenotyping"

def _ref(path):
    """Helper to return a Firebase reference under your namespace."""
    clean_path = str(path).lstrip('/')
    return db.reference(f"{NAMESPACE}/{clean_path}")

def init_firebase():
    """Initializes Firebase using the shared group credentials."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_FILE)
        firebase_admin.initialize_app(cred, {
            'databaseURL': FIREBASE_DB_URL
        })
    print(f"[OK] Firebase initialized for {NAMESPACE}")

# --- USER & BASELINE OPERATIONS (Objective 2) ---

def create_user_profile(user_id, name, initial_baselines):
    """
    Saves a new user and their 7-day calibration baseline.
    initial_baselines: dict { 'avg_dwell': {'mean': 0.12, 'std': 0.02}, ... }
    """
    ref = _ref(f'users/{user_id}')
    ref.set({
        'name': name,
        'created_at': datetime.now().isoformat(),
        'baselines': initial_baselines,
        'is_calibrated': True
    })

def get_user_baselines(user_id):
    """Retrieves the personalized mean/std for a specific user."""
    return _ref(f'users/{user_id}/baselines').get()

def update_user_baselines(user_id, updated_baselines):
    """Saves the EMA-updated baselines back to Firebase."""
    _ref(f'users/{user_id}/baselines').update(updated_baselines)

def get_calibration_windows(user_id):
    """
    Retrieves all stored behavioral windows for a user from data_logs.
    Used by /behavior/calibrate to compute the initial 7-day baseline.
    Returns a list of window feature dicts (only data_valid=True windows).
    """
    raw = _ref(f'data_logs/{user_id}').get()
    if not raw:
        return []
    # Filter: only include windows where data_valid was True (user was stationary)
    valid_windows = [
        window for window in raw.values()
        if isinstance(window, dict) and window.get('data_valid', True)
    ]
    return valid_windows

def set_user_calibration_status(user_id, is_calibrated, window_count=0):
    """
    Updates the calibration status flag for a user profile.
    Called after the 7-day baseline has been successfully computed.
    """
    _ref(f'users/{user_id}').update({
        'is_calibrated': is_calibrated,
        'calibration_window_count': window_count,
        'calibrated_at': datetime.now().isoformat()
    })

# --- DATA INGESTION (Objective 3) ---

def save_behavioral_window(user_id, window_data):
    """
    Stores the 30-minute aggregated feature window.
    window_data: dict containing all Category A features (dwell, flight, interaction)
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    ref = _ref(f'data_logs/{user_id}/{timestamp}')
    ref.set(window_data)
    return timestamp

# --- STRESS PREDICTIONS & LABELS ---

def save_stress_prediction(user_id, result):
    """
    Saves the model's decision: Normal, Pre-Stress, or High Stress.
    """
    ref = _ref(f'predictions/{user_id}')
    ref.push({
        'timestamp': datetime.now().isoformat(),
        'label': result['label'],
        'stress_score': result['score'],
        'is_anomaly': result['is_anomaly']
    })

def get_latest_stress_prediction(user_id):
    """
    T7-B: Returns the most recent stress prediction for a user.
    Used by the /behavior/stress-summary endpoint so the neuroadaptive
    guidance module can query the current behavioral stress state.

    Returns a dict like:
        { 'label': 'Pre-Stress (Digital Phenotype detected)',
          'stress_score': 0.6,
          'is_anomaly': True,
          'timestamp': '2026-08-02T14:30:00' }
    Returns None if no predictions exist yet for this user.
    """
    raw = _ref(f'predictions/{user_id}').get()
    if not raw:
        return None
    # Firebase push-keys are lexicographically ordered by time,
    # so the last entry when sorted by key is the most recent.
    sorted_entries = sorted(raw.items(), key=lambda kv: kv[0])
    _, latest = sorted_entries[-1]
    return latest

def save_validation_label(user_id, label_type, score):
    """
    Saves user self-reports (PSS-4 or SISS) for research validation.
    label_type: 'pss4' (weekly) or 'siss' (daily)
    """
    ref = _ref(f'validation_labels/{user_id}/{label_type}')
    ref.push({
        'timestamp': datetime.now().isoformat(),
        'score': score
    })