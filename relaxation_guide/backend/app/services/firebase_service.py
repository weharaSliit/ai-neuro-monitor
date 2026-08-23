"""
Firebase Service Module.
Handles all Firebase Realtime Database read/write operations matching teammate's schema:
- User operations: users/{user_id}
- Baseline calibration check: baselines/{user_id}
- Predictions ingestion: predictions/{user_id}/{session_id}

Includes bulletproof try-except error handling to fall back smoothly on network disconnections.
"""

import os
import time
import numpy as np
from datetime import datetime
from typing import Dict, Any, Optional, List
import firebase_admin
from firebase_admin import credentials, db
from app.config import FIREBASE_CRED_FILE, FIREBASE_DB_URL, FIREBASE_NAMESPACE

def _ref(path: str):
    """Returns a Firebase Realtime DB reference under the configured namespace."""
    clean_path = str(path).lstrip('/')
    if not FIREBASE_NAMESPACE:
        return db.reference(clean_path)
    return db.reference(f"{FIREBASE_NAMESPACE}/{clean_path}")

def init_firebase():
    """Initializes Firebase Admin SDK if not already initialized."""
    if not firebase_admin._apps:
        cred_path = FIREBASE_CRED_FILE
        if os.path.exists(cred_path):
            try:
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred, {
                    'databaseURL': FIREBASE_DB_URL
                })
                print("Firebase initialized [OK]")
            except Exception as e:
                print(f"Warning: Firebase init error ({e}). Will fallback gracefully.")
        else:
            print(f"Warning: Firebase credentials file '{cred_path}' not found. Will fallback gracefully.")

# Initialize upon import
init_firebase()

# --- User operations (Root 'users' path in Firebase) ---
def _users_ref(path: str = ""):
    """Returns a direct reference under the root 'users' node in Firebase Realtime DB."""
    clean_path = str(path).lstrip('/')
    if not clean_path:
        return db.reference('users')
    return db.reference(f'users/{clean_path}')

def create_user(user_id: str, name: str, email: str = "", password: str = "") -> Optional[str]:
    try:
        ref = _users_ref(user_id)
        data = {
            'user_id': user_id,
            'name': name,
            'full_name': name,
            'email': email,
            'password': password,
            'created_at': datetime.now().isoformat(),
            'is_email_verified': True,
            'session_count': 0
        }
        ref.set(data)
        return user_id
    except Exception as e:
        print(f"[Firebase Warning] create_user failed ({e}). Falling back to SQLite.")
        return None

def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    try:
        ref = _users_ref(user_id)
        data = ref.get()
        if isinstance(data, dict):
            data['user_id'] = data.get('user_id') or user_id
            data['full_name'] = data.get('full_name') or data.get('name') or data.get('username') or 'Participant'
            return data
    except Exception as e:
        print(f"[Firebase Warning] get_user failed ({e}). Falling back to SQLite.")
    return None

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    try:
        ref = _users_ref()
        all_users = ref.get() or {}
        clean_email = email.strip().lower()
        if isinstance(all_users, dict):
            for uid, user_data in all_users.items():
                if isinstance(user_data, dict):
                    user_email = str(user_data.get('email', '')).strip().lower()
                    if user_email == clean_email:
                        user_data['user_id'] = user_data.get('user_id') or uid
                        user_data['full_name'] = user_data.get('full_name') or user_data.get('name') or user_data.get('username') or 'Participant'
                        return user_data
    except Exception as e:
        print(f"[Firebase Warning] get_user_by_email failed ({e}). Falling back to SQLite.")
    return None

def list_users() -> Dict[str, Any]:
    try:
        ref = _users_ref()
        return ref.get() or {}
    except Exception as e:
        print(f"[Firebase Warning] list_users failed ({e}). Falling back to SQLite.")
        return {}

# --- Intervention System operations (Root 'intervention_system' & 'intervention_system_sessions' paths) ---
def _intervention_ref(path: str = ""):
    """Returns a direct reference under the root 'intervention_system' node in Firebase Realtime DB."""
    clean_path = str(path).lstrip('/')
    if not clean_path:
        return db.reference('intervention_system')
    return db.reference(f'intervention_system/{clean_path}')

def _intervention_sessions_ref(path: str = ""):
    """Returns a direct reference under the root 'intervention_system_sessions' node in Firebase Realtime DB."""
    clean_path = str(path).lstrip('/')
    if not clean_path:
        return db.reference('intervention_system_sessions')
    return db.reference(f'intervention_system_sessions/{clean_path}')

# --- Baseline operations ---
def save_baseline(user_id: str, duration_seconds: int = 120, baseline_data: Optional[Dict[str, Any]] = None) -> bool:
    try:
        data = {
            'user_id': user_id,
            'duration_seconds': duration_seconds,
            'is_calibrated': True,
            'created_at': datetime.now().isoformat(),
            'baseline_data': baseline_data or {'hrv_rmssd': 42.5, 'gsr_microsiemens': 3.2, 'eeg_alpha_beta_ratio': 1.8}
        }
        _intervention_ref(f'baselines/{user_id}').set(data)
        db.reference(f'baselines/{user_id}').set(data)
        return True
    except Exception as e:
        print(f"[Firebase Warning] save_baseline failed ({e}). Defaulting to local.")
        return False

def baseline_exists(user_id: str) -> bool:
    try:
        ref1 = _intervention_ref(f'baselines/{user_id}')
        if ref1.get() is not None:
            return True
        ref2 = db.reference(f'baselines/{user_id}')
        return ref2.get() is not None
    except Exception as e:
        print(f"[Firebase Warning] baseline_exists failed ({e}). Defaulting to False.")
        return False

# --- Helper to extract latest packet from nested nodes ---
def _extract_latest_packet(node: Any, target_uid_clean: str = "") -> Dict[str, Any]:
    """Traverses a dict or nested dict to extract the latest telemetry packet record."""
    if not isinstance(node, dict):
        return {}

    # Case 1: Node itself contains direct telemetry keys
    if any(k in node for k in ['fused_stress_label', 'fused_stress_probability', 'stress_label', 'probability', 'stress_probability', 'label']):
        return node

    latest_packet = {}
    for key in sorted(node.keys()):
        if key in ['current_session_id', 'current_user_id']:
            continue
        val = node[key]
        if isinstance(val, dict):
            val_uid = str(val.get('user_id', '')).strip().lower()
            if target_uid_clean and target_uid_clean not in ['user_default', 'user_calm_ai', 'wehara', 'hiruni'] and val_uid and val_uid != target_uid_clean:
                continue

            if any(k in val for k in ['fused_stress_label', 'fused_stress_probability', 'stress_label', 'probability', 'stress_probability', 'label']):
                latest_packet = val
            else:
                for inner_key in sorted(val.keys()):
                    inner_val = val[inner_key]
                    if isinstance(inner_val, dict) and any(k in inner_val for k in ['fused_stress_label', 'fused_stress_probability', 'stress_label', 'probability', 'stress_probability', 'label']):
                        latest_packet = inner_val

    return latest_packet

# --- Prediction & Telemetry Ingestion operations ---
def get_latest_prediction(user_id: str, session_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetches latest fusion prediction inputs from path: fusion_en_sessions
    Reads inputs: fused_stress_label ("low_stress"/"high_stress") and fused_stress_probability.
    Supports user sub-nodes (e.g. fusion_en_sessions/Wehara/session_...) and active current_session_id.
    """
    try:
        ref_fusion = db.reference('fusion_en_sessions')
        root_data = ref_fusion.get() or {}

        if not root_data:
            ref_fusion = _ref('fusion_en_sessions')
            root_data = ref_fusion.get() or {}

        if isinstance(root_data, dict):
            curr_sid = root_data.get('current_session_id') or session_id
            curr_uid = root_data.get('current_user_id')

            target_uid_clean = str(user_id).strip().lower()

            # 1. Check direct session node under current_session_id
            if curr_sid and curr_sid in root_data:
                packet = _extract_latest_packet(root_data[curr_sid])
                if packet:
                    return packet

            # 2. Check user sub-folder (e.g. fusion_en_sessions/Wehara or fusion_en_sessions/Hiruni)
            for k in [user_id, user_id.capitalize(), user_id.lower(), curr_uid]:
                if k and k in root_data and isinstance(root_data[k], dict):
                    packet = _extract_latest_packet(root_data[k])
                    if packet:
                        return packet

            # 3. Global scan across all keys in fusion_en_sessions
            packet = _extract_latest_packet(root_data, target_uid_clean)
            if packet:
                return packet

    except Exception as e:
        print(f"[Firebase Warning] Read fusion_en_sessions failed ({e}).")

    return {}

# --- Intervention System Session Operations ---
def save_intervention_session(user_id: str, session_id: str, session_data: Dict[str, Any]):
    """
    Saves closed-loop session outcomes to root path: intervention_system_sessions/{user_id}/{session_id}
    """
    try:
        ref = _intervention_sessions_ref(f'{user_id}/{session_id}')
        ref.set(session_data)
    except Exception as e:
        print(f"[Firebase Warning] save_intervention_session failed ({e}).")

# --- Ratings Operations ---
def save_rating(user_id: str, technique_id: str, sub_option_id: str, stars: int, timestamp: float):
    try:
        ref = _intervention_ref(f'ratings/{user_id}')
        ref.push({
            'technique_id': technique_id,
            'sub_option_id': sub_option_id,
            'stars': stars,
            'timestamp': timestamp
        })
    except Exception as e:
        print(f"[Firebase Warning] save_rating failed ({e}). Falling back to SQLite.")

def get_ratings(user_id: str) -> List[Dict[str, Any]]:
    try:
        ref = _intervention_ref(f'ratings/{user_id}')
        data = ref.get() or {}
        if isinstance(data, dict):
            return list(data.values())
    except Exception as e:
        print(f"[Firebase Warning] get_ratings failed ({e}). Falling back to SQLite.")
    return []

# --- Bandit Distribution Operations ---
def save_bandit_distribution(user_id: str, cluster_id: int, technique_id: str, alpha: float, beta: float):
    try:
        ref = _intervention_ref(f'bandit_distributions/{user_id}/{cluster_id}/{technique_id}')
        ref.set({
            'alpha': float(alpha),
            'beta': float(beta)
        })
    except Exception as e:
        print(f"[Firebase Warning] save_bandit_distribution failed ({e}). Falling back to SQLite.")

def get_bandit_distributions(user_id: str) -> Dict[int, Dict[str, Dict[str, float]]]:
    try:
        ref = _intervention_ref(f'bandit_distributions/{user_id}')
        data = ref.get() or {}
        user_dists = {}
        if isinstance(data, dict):
            for c_id_str, tech_map in data.items():
                try:
                    c_id = int(c_id_str)
                    user_dists[c_id] = {}
                    if isinstance(tech_map, dict):
                        for t_id, params in tech_map.items():
                            if isinstance(params, dict):
                                user_dists[c_id][t_id] = {
                                    "alpha": float(params.get("alpha", 1.0)),
                                    "beta": float(params.get("beta", 1.0))
                                }
                except ValueError:
                    continue
        elif isinstance(data, list):
            for c_id, tech_map in enumerate(data):
                if isinstance(tech_map, dict):
                    user_dists[c_id] = {}
                    for t_id, params in tech_map.items():
                        if isinstance(params, dict):
                            user_dists[c_id][t_id] = {
                                "alpha": float(params.get("alpha", 1.0)),
                                "beta": float(params.get("beta", 1.0))
                            }
        return user_dists
    except Exception as e:
        print(f"[Firebase Warning] get_bandit_distributions failed ({e}). Falling back to SQLite.")
        return {}
