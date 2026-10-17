"""
Firebase Service Module for Relaxation Guide.
Handles all Firebase Realtime Database read/write operations matching teammate's schema:
- User operations: users/{user_id}
- Baseline calibration check: baselines/{user_id}
- Predictions & Fusion ingestion: fusion_en_sessions, fusion_en, fusion_engine, predictions
"""

import os
import sys
import time
import re
import numpy as np
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import firebase_admin
from firebase_admin import credentials, db
from backend.relaxation_guide.config import FIREBASE_CRED_FILE, FIREBASE_DB_URL, FIREBASE_NAMESPACE


def _ref(path: str):
    """Returns a Firebase Realtime DB reference under the configured namespace."""
    clean_path = str(path).lstrip('/')
    if not FIREBASE_NAMESPACE:
        return db.reference(clean_path)
    return db.reference(f"{FIREBASE_NAMESPACE}/{clean_path}")


def init_firebase():
    """Initializes Firebase Admin SDK if not already initialized."""
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


# --- User operations ---
def _users_ref(path: str = ""):
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
        print(f"[Firebase Warning] get_user failed ({e}). Falling back to local.")
    return None


def list_users() -> Dict[str, Any]:
    try:
        ref = _users_ref()
        users = ref.get() or {}
        if 'ojani' not in users:
            users = {
                'ojani': {
                    'name': 'Ojani (Admin)',
                    'role': 'admin',
                    'is_admin': True,
                    'session_count': 0
                },
                **users
            }
        return users
    except Exception as e:
        print(f"[Firebase Warning] list_users failed ({e}). Falling back to local.")
        return {
            'ojani': {
                'name': 'Ojani (Admin)',
                'role': 'admin',
                'is_admin': True,
                'session_count': 0
            }
        }


# --- Intervention System operations ---
def _intervention_ref(path: str = ""):
    clean_path = str(path).lstrip('/')
    if not clean_path:
        return db.reference('intervention_system')
    return db.reference(f'intervention_system/{clean_path}')


def _intervention_sessions_ref(path: str = ""):
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


def get_baseline(user_id: str, session_id: Optional[str] = None) -> Optional[float]:
    """
    PRIMARY PATH TO GET BASELINE:
    fusion_en_sessions -> {user_id} -> {session_id} -> baseline

    Returns normalized float value [0.0 - 1.0].
    """
    try:
        target_uid = str(user_id).strip()
        target_uid_clean = target_uid.lower()
        keys_to_check = ['baseline', 'user_baseline', 'baseline_val', 'baseline_score', 'target_baseline']

        # 1. PRIMARY DIRECT PATH: fusion_en_sessions -> {user_id} -> {session_id} -> baseline
        if session_id:
            try:
                ref_direct = db.reference(f'fusion_en_sessions/{target_uid}/{session_id}')
                session_dict = ref_direct.get()
                if isinstance(session_dict, dict):
                    for k in keys_to_check:
                        val = session_dict.get(k)
                        if isinstance(val, (int, float)):
                            fval = float(val)
                            return fval / 100.0 if fval > 1.0 else fval
            except Exception:
                pass

        # 2. PRIMARY USER SESSIONS SCAN: fusion_en_sessions -> {user_id} -> latest session -> baseline
        try:
            ref_user_sessions = db.reference(f'fusion_en_sessions/{target_uid}')
            user_sessions_dict = ref_user_sessions.get()
            if isinstance(user_sessions_dict, dict) and user_sessions_dict:
                sorted_sessions = sorted(user_sessions_dict.keys(), key=_sort_key, reverse=True)
                latest_session_key = sorted_sessions[0]
                latest_session = user_sessions_dict[latest_session_key]
                if isinstance(latest_session, dict):
                    for k in keys_to_check:
                        val = latest_session.get(k)
                        if isinstance(val, (int, float)):
                            fval = float(val)
                            return fval / 100.0 if fval > 1.0 else fval
        except Exception:
            pass

        # 3. ROOT SESSION FALLBACK: fusion_en_sessions -> {session_id} -> baseline
        try:
            root_data = db.reference('fusion_en_sessions').get() or {}
            if isinstance(root_data, dict):
                sorted_root_keys = sorted(root_data.keys(), key=_sort_key, reverse=True)
                for rkey in sorted_root_keys:
                    rval = root_data[rkey]
                    if isinstance(rval, dict):
                        val_uid = str(rval.get('user_id', '')).strip().lower()
                        if not val_uid or val_uid == target_uid_clean or target_uid_clean in rkey.lower():
                            for k in keys_to_check:
                                val = rval.get(k)
                                if isinstance(val, (int, float)):
                                    fval = float(val)
                                    return fval / 100.0 if fval > 1.0 else fval
        except Exception:
            pass

        # 4. SECONDARY FALLBACK: baselines/{user_id}
        try:
            ref2 = db.reference(f'baselines/{target_uid}')
            data2 = ref2.get()
            if isinstance(data2, dict):
                for k in keys_to_check:
                    val = data2.get(k)
                    if isinstance(val, (int, float)):
                        fval = float(val)
                        return fval / 100.0 if fval > 1.0 else fval
        except Exception:
            pass

    except Exception as e:
        print(f"[Firebase Warning] get_baseline failed ({e}).")
    return None


# --- Helper to extract latest packet from nested nodes ---
def _sort_key(k: str):
    """Sort helper to handle window_1, window_2, window_10, timestamps, and push keys chronologically."""
    nums = re.findall(r'\d+', str(k))
    if nums:
        return (1, int(''.join(nums)))
    return (0, str(k))


def _packet_timestamp(p: Dict[str, Any]) -> float:
    """Extracts numeric timestamp if available for chronological sorting."""
    for ts_key in ['timestamp', 'created_at', 'time', 'ts', 'updated_at']:
        v = p.get(ts_key)
        if isinstance(v, (int, float)):
            return float(v)
        elif isinstance(v, str):
            try:
                dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
                return dt.timestamp()
            except Exception:
                pass
    return 0.0


def _extract_latest_packet(node: Any, target_uid_clean: str = "") -> Dict[str, Any]:
    """Traverses a dict or nested dict to extract the latest telemetry packet record."""
    if not isinstance(node, dict):
        return {}

    TARGET_KEYS = [
        'fused_stress_label', 'fused_stress_probability', 'fused_probability', 'fused_label',
        'stress_label', 'probability', 'stress_probability', 'label', 'probability_vector', 'confidence'
    ]

    if any(k in node for k in TARGET_KEYS):
        return node

    latest_packet = {}
    latest_ts = 0.0

    sorted_keys = sorted(node.keys(), key=_sort_key)
    for key in sorted_keys:
        if key in ['current_session_id', 'current_user_id', 'session_started', 'session_ended']:
            continue
        val = node[key]
        if isinstance(val, dict):
            val_uid = str(val.get('user_id', '')).strip().lower()
            if target_uid_clean and val_uid and val_uid != target_uid_clean:
                continue

            if any(k in val for k in TARGET_KEYS):
                ts = _packet_timestamp(val)
                if ts > 0:
                    if ts >= latest_ts:
                        latest_packet = val
                        latest_ts = ts
                else:
                    latest_packet = val
            else:
                inner_keys = sorted(val.keys(), key=_sort_key)
                for inner_key in inner_keys:
                    if inner_key in ['session_started', 'session_ended']:
                        continue
                    inner_val = val[inner_key]
                    if isinstance(inner_val, dict) and any(k in inner_val for k in TARGET_KEYS):
                        ts = _packet_timestamp(inner_val)
                        if ts > 0:
                            if ts >= latest_ts:
                                latest_packet = inner_val
                                latest_ts = ts
                        else:
                            latest_packet = inner_val

    return latest_packet


# --- Prediction & Telemetry Ingestion operations ---
def get_latest_prediction(user_id: str, session_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetches latest live fusion prediction inputs strictly from the active session path:
    fusion_en_sessions -> {user_id} -> {latest_session_id}
    """
    target_uid = str(user_id).strip()
    target_uid_clean = target_uid.lower()
    PREFIXES = ['fusion_en_sessions', 'fusion_en', 'fusion_engine', 'fusion_output', 'predictions']

    # 1. If explicit session_id is provided, check that specific session node
    if session_id:
        for prefix in PREFIXES:
            try:
                ref_session = db.reference(f'{prefix}/{target_uid}/{session_id}')
                s_data = ref_session.get()
                if isinstance(s_data, dict):
                    packet = _extract_latest_packet(s_data, target_uid_clean)
                    if packet:
                        packet['has_live_packet'] = True
                        packet['active_session_id'] = session_id
                        return packet
            except Exception as e:
                pass
        return {'has_live_packet': False, 'active_session_id': session_id}

    # 2. If no session_id is passed, target latest active session key under user_id
    for prefix in PREFIXES:
        try:
            ref_user = db.reference(f'{prefix}/{target_uid}')
            u_data = ref_user.get()
            if isinstance(u_data, dict) and u_data:
                sorted_sessions = sorted(u_data.keys(), key=_sort_key, reverse=True)
                latest_session_key = sorted_sessions[0]
                latest_session_data = u_data[latest_session_key]

                if isinstance(latest_session_data, dict):
                    packet = _extract_latest_packet(latest_session_data, target_uid_clean)
                    if packet:
                        packet['has_live_packet'] = True
                        packet['active_session_id'] = latest_session_key
                        return packet
                    else:
                        # Active session exists but has not received any telemetry reading packet yet!
                        return {
                            'has_live_packet': False,
                            'active_session_id': latest_session_key,
                            'message': f"Awaiting first reading in active session '{latest_session_key}'"
                        }
        except Exception as e:
            pass

    return {'has_live_packet': False}


def get_latest_phenotyping_prediction(user_id: str) -> Dict[str, Any]:
    """Read the latest prediction from phenotyping/predictions/{user_id}."""
    target_uid = str(user_id).strip()
    if not target_uid:
        return {'has_live_packet': False}

    try:
        user_predictions = db.reference(f'phenotyping/predictions/{target_uid}').get()
    except Exception as e:
        print(f"[Firebase Warning] get_latest_phenotyping_prediction failed ({e}).")
        return {'has_live_packet': False}

    if not isinstance(user_predictions, dict):
        return {'has_live_packet': False}

    prediction_keys = {
        'label',
        'stress_score',
        ' stress_score',
        'stress_probability',
        'probability'
    }

    def find_latest(node: Any, path: Tuple[str, ...] = ()) -> Optional[Tuple[Dict[str, Any], Tuple[str, ...]]]:
        if not isinstance(node, dict):
            return None
        if prediction_keys.intersection(node):
            return node, path

        latest = None
        latest_order = None
        for key, value in node.items():
            if key in {'current_session_id', 'current_user_id', 'session_started', 'session_ended'}:
                continue
            candidate = find_latest(value, path + (str(key),))
            if candidate is None:
                continue
            packet, candidate_path = candidate
            timestamp = _packet_timestamp(packet)
            order = (timestamp, tuple(_sort_key(part) for part in candidate_path))
            if latest_order is None or order > latest_order:
                latest = candidate
                latest_order = order
        return latest

    latest = find_latest(user_predictions)
    if latest is None:
        return {'has_live_packet': False}

    packet, path = latest
    result = dict(packet)
    result['has_live_packet'] = True
    if path:
        result['active_session_id'] = path[0]
    return result


def save_intervention_session(user_id: str, session_id: str, session_data: Dict[str, Any]):
    try:
        ref = _intervention_sessions_ref(f'{user_id}/{session_id}')
        ref.set(session_data)
    except Exception as e:
        print(f"[Firebase Warning] save_intervention_session failed ({e}).")


_local_relaxation_interventions: Dict[str, Dict[str, Dict[str, Any]]] = {}

def save_relaxation_intervention(user_id: str, session_id: str, session_data: Dict[str, Any]):
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

    if user_id in _user_recovery_cache:
        del _user_recovery_cache[user_id]


def get_relaxation_interventions(user_id: str) -> List[Dict[str, Any]]:
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


_user_recovery_cache: Dict[str, Tuple[float, Dict[str, float]]] = {}

def get_fastest_recovery_technique_history(user_id: str) -> Dict[str, float]:
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
            speed = (rec_pct / dur_sec) * 10.0
            tech_stats[tech_id].append(speed)

    boosts = {}
    for t_id, speeds in tech_stats.items():
        avg_speed = sum(speeds) / len(speeds)
        boosts[t_id] = min(0.5, avg_speed / 20.0)

    _user_recovery_cache[user_id] = (now, boosts)
    return boosts


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
        print(f"[Firebase Warning] save_rating failed ({e}).")


def get_ratings(user_id: str) -> List[Dict[str, Any]]:
    try:
        ref = _intervention_ref(f'ratings/{user_id}')
        data = ref.get() or {}
        if isinstance(data, dict):
            return list(data.values())
    except Exception as e:
        print(f"[Firebase Warning] get_ratings failed ({e}).")
    return []


def save_bandit_distribution(user_id: str, cluster_id: int, technique_id: str, alpha: float, beta: float):
    try:
        ref = _intervention_ref(f'bandit_distributions/{user_id}/{cluster_id}/{technique_id}')
        ref.set({
            'alpha': float(alpha),
            'beta': float(beta)
        })
    except Exception as e:
        print(f"[Firebase Warning] save_bandit_distribution failed ({e}).")


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
        print(f"[Firebase Warning] get_bandit_distributions failed ({e}).")
        return {}


def save_closed_loop_state(user_id: str, loop_state: Dict[str, Any]):
    try:
        _intervention_ref(f'closed_loop_state/{user_id}').set(loop_state)
    except Exception as e:
        print(f"[Firebase Warning] save_closed_loop_state failed ({e}).")


def get_closed_loop_state(user_id: str) -> Optional[Dict[str, Any]]:
    try:
        data = _intervention_ref(f'closed_loop_state/{user_id}').get()
        return data if isinstance(data, dict) else None
    except Exception as e:
        print(f"[Firebase Warning] get_closed_loop_state failed ({e}).")
        return None
