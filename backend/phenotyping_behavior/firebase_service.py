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
    print(f"Firebase initialized for {NAMESPACE} ✓")

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