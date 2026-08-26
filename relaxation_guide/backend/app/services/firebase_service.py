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
from typing import Dict, Any, Optional, List, Tuple
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
    """Initializes Firebase Admin SDK if not already initialized.

    Prefers $FIREBASE_CRED_JSON (credential content directly) over
    FIREBASE_CRED_FILE's path -- a deployed target like Render has no
    persistent file for that path to point at (see
    backend/common/firebase_config.py's identical FIREBASE_CRED_JSON
    handling). Falls back to the file-path behavior for local dev.
    """
    if not firebase_admin._apps:
        cred_json = os.environ.get("FIREBASE_CRED_JSON")
        cred_path = FIREBASE_CRED_FILE
        if cred_json:
            try:
                import json
                cred = credentials.Certificate(json.loads(cred_json))
                firebase_admin.initialize_app(cred, {
                    'databaseURL': FIREBASE_DB_URL
                })
                print("Firebase initialized [OK]")
            except Exception as e:
                print(f"Warning: Firebase init error from $FIREBASE_CRED_JSON ({e}). Will fallback gracefully.")
        elif os.path.exists(cred_path):
            try:
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred, {
                    'databaseURL': FIREBASE_DB_URL
                })
                print("Firebase initialized [OK]")
            except Exception as e:
                print(f"Warning: Firebase init error ({e}). Will fallback gracefully.")
        else:
            print(f"Warning: Firebase credentials file '{cred_path}' not found, and no "
                  f"$FIREBASE_CRED_JSON set. Will fallback gracefully.")

# Initialize upon import
init_firebase()

# --- User operations (Root 'users' path in Firebase) ---
def _users_ref(path: str = ""):
    """Returns a direct reference under the root 'users' node in Firebase DB."""
    clean_path = str(path).lstrip('/')
    if not clean_path:
        return db.reference('users')
    return db.reference(f'users/{clean_path}')

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
def _sort_key(k: str):
    """Sort helper to handle window_1, window_2, window_10, timestamps, and push keys chronologically."""
    import re
    nums = re.findall(r'\d+', str(k))
    if nums:
        return (1, int(nums[-1]))
    return (0, str(k))

def _extract_latest_packet(node: Any, target_uid_clean: str = "") -> Dict[str, Any]:
    """Traverses a dict or nested dict to extract the latest telemetry packet record."""
    if not isinstance(node, dict):
        return {}

    # Case 1: Node itself contains direct telemetry keys
    if any(k in node for k in ['fused_stress_label', 'fused_stress_probability', 'stress_label', 'probability', 'stress_probability', 'label', 'probability_vector']):
        return node

    latest_packet = {}
    # Sort keys chronologically using _sort_key
    sorted_keys = sorted(node.keys(), key=_sort_key)
    for key in sorted_keys:
        if key in ['current_session_id', 'current_user_id', 'session_started', 'session_ended']:
            continue
        val = node[key]
        if isinstance(val, dict):
            val_uid = str(val.get('user_id', '')).strip().lower()
            if target_uid_clean and val_uid and val_uid != target_uid_clean:
                continue

            if any(k in val for k in ['fused_stress_label', 'fused_stress_probability', 'stress_label', 'probability', 'stress_probability', 'label', 'probability_vector']):
                latest_packet = val
            else:
                inner_keys = sorted(val.keys(), key=_sort_key)
                for inner_key in inner_keys:
                    if inner_key in ['session_started', 'session_ended']:
                        continue
                    inner_val = val[inner_key]
                    if isinstance(inner_val, dict) and any(k in inner_val for k in ['fused_stress_label', 'fused_stress_probability', 'stress_label', 'probability', 'stress_probability', 'label', 'probability_vector']):
                        latest_packet = inner_val

    return latest_packet

# --- Prediction & Telemetry Ingestion operations ---
def get_latest_prediction(user_id: str, session_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetches latest fusion prediction inputs from path: fusion_en_sessions -> user_id -> session
    Reads inputs: fused_stress_label ("low_stress"/"high_stress") and fused_stress_probability.
    Directly queries user node fusion_en_sessions/{user_id}/{session_id} for user-wise real-time adaptation.
    """
    target_uid = str(user_id).strip()
    target_uid_clean = target_uid.lower()

    # 1. Direct fetch for fusion_en_sessions/{user_id}/{session_id}
    if session_id:
        try:
            ref_session = db.reference(f'fusion_en_sessions/{target_uid}/{session_id}')
            s_data = ref_session.get()
            if isinstance(s_data, dict):
                packet = _extract_latest_packet(s_data, target_uid_clean)
                if packet:
                    return packet
        except Exception as e:
            print(f"[Firebase Warning] Read fusion_en_sessions/{target_uid}/{session_id} failed: {e}")

    # 2. Direct fetch for fusion_en_sessions/{user_id}
    try:
        ref_user = db.reference(f'fusion_en_sessions/{target_uid}')
        u_data = ref_user.get()
        if isinstance(u_data, dict):
            packet = _extract_latest_packet(u_data, target_uid_clean)
            if packet:
                return packet
    except Exception as e:
        print(f"[Firebase Warning] Read fusion_en_sessions/{target_uid} failed: {e}")

    # 3. Fallback: Read full fusion_en_sessions root data
    try:
        ref_fusion = db.reference('fusion_en_sessions')
        root_data = ref_fusion.get() or {}

        if not root_data:
            ref_fusion = _ref('fusion_en_sessions')
            root_data = ref_fusion.get() or {}

        if isinstance(root_data, dict):
            curr_sid = root_data.get('current_session_id') or session_id
            curr_uid = root_data.get('current_user_id')

            # Check case variations of user_id or active pointer
            for k in [target_uid, target_uid.capitalize(), target_uid.lower(), curr_uid]:
                if k and k in root_data and isinstance(root_data[k], dict):
                    packet = _extract_latest_packet(root_data[k], target_uid_clean)
                    if packet:
                        return packet

            # Check active session pointer
            if curr_sid and curr_sid in root_data:
                packet = _extract_latest_packet(root_data[curr_sid], target_uid_clean)
                if packet:
                    return packet

            # Global scan across root_data
            packet = _extract_latest_packet(root_data, target_uid_clean)
            if packet:
                return packet

    except Exception as e:
        print(f"[Firebase Warning] Read fusion_en_sessions root failed ({e}).")

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

# Local fallback store when offline
_local_relaxation_interventions: Dict[str, Dict[str, Dict[str, Any]]] = {}

def save_relaxation_intervention(user_id: str, session_id: str, session_data: Dict[str, Any]):
    """
    Saves intervention session recommendations & outcomes to root folder: relaxation_intervention/{user_id}/{session_id}
    """
    try:
        ref = db.reference(f'relaxation_intervention/{user_id}/{session_id}')
        ref.update(session_data)
    except Exception as e:
        print(f"[Firebase Warning] save_relaxation_intervention failed ({e}).")

    if user_id not in _local_relaxation_interventions:
        _local_relaxation_interventions[user_id] = {}
    if session_id not in _local_relaxation_interventions[user_id]:
        _local_relaxation_interventions[user_id][session_id] = {}
    _local_relaxation_interventions[user_id][session_id].update(session_data)

    # Invalidate recovery cache on write
    if user_id in _user_recovery_cache:
        del _user_recovery_cache[user_id]

def get_relaxation_interventions(user_id: str) -> List[Dict[str, Any]]:
    """
    Retrieves all past intervention records for THIS user from root folder: relaxation_intervention/{user_id}
    """
    try:
        ref = db.reference(f'relaxation_intervention/{user_id}')
        data = ref.get() or {}
        if isinstance(data, dict) and data:
            return list(data.values())
    except Exception as e:
        print(f"[Firebase Warning] get_relaxation_interventions failed ({e}).")

    if user_id in _local_relaxation_interventions:
        return list(_local_relaxation_interventions[user_id].values())
    return []

# Cache for user recovery history
_user_recovery_cache: Dict[str, Tuple[float, Dict[str, float]]] = {}

def get_fastest_recovery_technique_history(user_id: str) -> Dict[str, float]:
    """
    Analyzes past relaxation_intervention/{user_id} history to calculate stress reduction speed per technique.
    Returns dict mapping technique_id -> recovery_speed_boost.
    Uses 30-second TTL cache to guarantee Thompson Sampling execution < 200ms.
    """
    now = time.time()
    if user_id in _user_recovery_cache:
        cache_time, cache_data = _user_recovery_cache[user_id]
        if now - cache_time < 30.0:
            return cache_data

    records = get_relaxation_interventions(user_id)
    tech_stats = {}
    for r in records:
        tech_id = r.get("technique_id") or r.get("recommended_technique_id")
        rec_pct = float(r.get("recovery_percentage", 0.0))
        dur_sec = float(r.get("recovery_duration_seconds", r.get("duration_seconds", 30.0)))
        dur_sec = max(5.0, dur_sec)

        if tech_id and rec_pct > 0:
            if tech_id not in tech_stats:
                tech_stats[tech_id] = []
            # Speed ratio: recovery percentage per 10 seconds
            speed = (rec_pct / dur_sec) * 10.0
            tech_stats[tech_id].append(speed)

    boosts = {}
    for t_id, speeds in tech_stats.items():
        avg_speed = sum(speeds) / len(speeds)
        # Convert average speed to a prior boost factor (0.1 to 0.5)
        boosts[t_id] = min(0.5, avg_speed / 20.0)

    _user_recovery_cache[user_id] = (now, boosts)
    return boosts

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
