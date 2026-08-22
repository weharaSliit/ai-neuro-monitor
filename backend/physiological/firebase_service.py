# ============================================================
# firebase_service.py
# All Firebase read/write operations
# ============================================================

import firebase_admin
from firebase_admin import credentials, db
import numpy as np
from datetime import datetime
from backend.common.config import (
    FIREBASE_CRED_FILE,
    FIREBASE_DB_URL,
    FIREBASE_NAMESPACE,
    MIN_CONFIDENCE_FOR_RETRAIN,
    MIN_SIGNAL_QUALITY_FOR_RETRAIN,
)

def _ref(path):
    """Return a Firebase reference under the configured namespace."""
    clean_path = str(path).lstrip('/')
    if not FIREBASE_NAMESPACE:
        return db.reference(clean_path)
    return db.reference(f"{FIREBASE_NAMESPACE}/{clean_path}")


def _global_ref(path):
    """Return a Firebase reference NOT nested under FIREBASE_NAMESPACE —
    for data shared across modalities (e.g. fusion_engine/), which must
    sit outside the physiological-only namespace so other modules can
    read/write it too."""
    return db.reference(str(path).lstrip('/'))


#  Initialize Firebase 
def init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_FILE)
        firebase_admin.initialize_app(cred, {
            'databaseURL': FIREBASE_DB_URL
        })
    print("Firebase initialized ✓")


# User operations
def create_user(user_id, name):
    ref = _ref(f'users/{user_id}')
    ref.set({
        'name':       name,
        'created_at': datetime.now().isoformat(),
        'session_count': 0
    })
    return user_id


def create_user_with_password(user_id, name, password_hash):
    """Brand-new account, password included from creation."""
    ref = _ref(f'users/{user_id}')
    ref.set({
        'name':          name,
        'created_at':    datetime.now().isoformat(),
        'session_count': 0,
        'password_hash': password_hash
    })
    return user_id


def set_password_hash(user_id, password_hash):
    """
    Attach/replace ONLY password_hash on an existing user record, via
    update() rather than set() — never touches name/created_at/
    session_count, and never touches sibling paths (baselines/,
    sessions/, predictions/, pss4/, ema_history/ for this user_id).
    Used both by /register's "claim a legacy passwordless account"
    path and by migrate_wehara_password.py.
    """
    ref = _ref(f'users/{user_id}')
    ref.update({'password_hash': password_hash})


def get_user(user_id):
    ref = _ref(f'users/{user_id}')
    return ref.get()


def list_users():
    ref = _ref('users')
    return ref.get() or {}


# Baseline operations 
def save_baseline(user_id, baseline_mean,
                  baseline_std, feature_cols):
    ref = _ref(f'baselines/{user_id}')
    data = {}
    for i, feat in enumerate(feature_cols):
        data[feat] = {
            'mean': float(baseline_mean[i]),
            'std':  float(baseline_std[i])
        }
    data['updated_at']    = datetime.now().isoformat()
    data['session_count'] = get_session_count(user_id)
    ref.set(data)


def load_baseline(user_id, feature_cols):
    ref  = _ref(f'baselines/{user_id}')
    data = ref.get()

    if data is None:
        return None, None

    baseline_mean = np.array([
        data[feat]['mean']
        for feat in feature_cols
        if feat in data
    ])
    baseline_std = np.array([
        data[feat]['std']
        for feat in feature_cols
        if feat in data
    ])

    return baseline_mean, baseline_std


def baseline_exists(user_id):
    ref = _ref(f'baselines/{user_id}')
    return ref.get() is not None


# Session operations 
def start_session(user_id):
    sessions_ref = _ref(f'sessions/{user_id}')
    new_session  = sessions_ref.push({
        'start_time': datetime.now().isoformat(),
        'end_time':   None,
        'pss4_score': None,
        'stress_label': None,
        'window_count': 0
    })
    return new_session.key


def end_session(user_id, session_id,
                pss4_score=None):
    ref = _ref(f'sessions/{user_id}/{session_id}')
    update = {'end_time': datetime.now().isoformat()}

    if pss4_score is not None:
        update['pss4_score'] = pss4_score
        if pss4_score <= 6:
            update['stress_label'] = 'Normal'
        elif pss4_score <= 12:
            update['stress_label'] = 'Stress'
        else:
            update['stress_label'] = 'High Stress'

    ref.update(update)

    # Increment session count
    user_ref = _ref(f'users/{user_id}/session_count')
    count = user_ref.get() or 0
    user_ref.set(count + 1)


def get_session_count(user_id):
    ref = _ref(f'users/{user_id}/session_count')
    return ref.get() or 0


#  Prediction operations (binary: Normal/Stress)
def save_prediction(user_id, session_id, window_idx,
                    prediction, label,
                    prob_normal, prob_stress,
                    trending_toward_stress,
                    features_dict):
    ref = _ref(f'predictions/{user_id}/{session_id}')
    new_ref = ref.push({
        'window_idx':             window_idx,
        'timestamp':               datetime.now().isoformat(),
        'prediction':              int(prediction),
        'label':                   label,
        'prob_normal':             float(prob_normal),
        'prob_stress':             float(prob_stress),
        'trending_toward_stress':  bool(trending_toward_stress),
        'features': {
            k: float(v) for k, v in features_dict.items()
        }
    })

    session_ref = _ref(f'sessions/{user_id}/{session_id}/window_count')
    count = session_ref.get() or 0
    session_ref.set(count + 1)

    return new_ref.key


def save_prediction_quality(user_id, session_id, window_idx,
                            confidence, signal_quality,
                            prob_normal, prob_stress,
                            trending_toward_stress):
    """
    Separate structured table — probability/confidence/signal
    quality only. Never contains raw sensor arrays or features;
    those live in predictions/ (features) — raw sensor arrays
    never reach Firebase at all, only this request's derived numbers.
    """
    ref = _ref(f'prediction_quality/{user_id}/{session_id}')
    ref.push({
        'window_idx':              window_idx,
        'timestamp':                datetime.now().isoformat(),
        'confidence':                float(confidence),
        'signal_quality':            float(signal_quality),
        'prob_normal':               float(prob_normal),
        'prob_stress':               float(prob_stress),
        'trending_toward_stress':    bool(trending_toward_stress),
        'eligible_for_retrain': bool(
            confidence >= MIN_CONFIDENCE_FOR_RETRAIN and
            signal_quality >= MIN_SIGNAL_QUALITY_FOR_RETRAIN
        )
    })


def save_fusion_signal(user_id, session_id, window_idx,
                       confidence, signal_quality,
                       prob_normal, prob_stress,
                       label, trending_toward_stress):
    """
    Cross-modality feed for the fusion engine — lives OUTSIDE the
    'physiological' namespace (unlike everything else in this file)
    so other modalities can write to the same root-level collection
    later. Kept minimal — confidence/probability/signal quality plus
    the binary label and trend flag a fusion layer actually needs to
    combine with other modalities — no raw features or retrain
    metadata, those stay physiological-module-internal in
    prediction_quality/.
    """
    ref = _global_ref(f'fusion_engine/{user_id}/{session_id}')
    ref.push({
        'modality':                'physiological',
        'window_idx':              window_idx,
        'timestamp':               datetime.now().isoformat(),
        'confidence':              float(confidence),
        'signal_quality':          float(signal_quality),
        'prob_normal':             float(prob_normal),
        'prob_stress':             float(prob_stress),
        'label':                   label,
        'trending_toward_stress':  bool(trending_toward_stress),
    })


# Device connectivity (written by mqtt_bridge.py on every message,
# read by Flask's /devices/<id>/status for the mobile app)
def save_device_heartbeat(device_id, extra=None):
    ref  = _ref(f'devices/{device_id}')
    data = {'status': 'online', 'last_seen': datetime.now().isoformat()}
    if extra:
        data.update(extra)
    ref.update(data)


def get_device_status(device_id, offline_after_sec=15):
    ref  = _ref(f'devices/{device_id}')
    data = ref.get()
    if not data:
        return {'status': 'offline', 'last_seen': None}
    try:
        last_seen = datetime.fromisoformat(data['last_seen'])
        if (datetime.now() - last_seen).total_seconds() > offline_after_sec:
            data = dict(data)
            data['status'] = 'offline'
    except Exception:
        pass
    return data


def get_session_predictions(user_id, session_id):
    ref = _ref(f'predictions/{user_id}/{session_id}')
    return ref.get() or {}


def get_recent_sessions(user_id, limit=10):
    ref = _ref(f'sessions/{user_id}')
    return ref.order_by_key().limit_to_last(
        limit
    ).get() or {}


# PSS-4 operations
def save_pss4(user_id, session_id,
              q1, q2, q3, q4):
    score = q1 + q2 + q3 + q4
    ref   = _ref(f'pss4/{user_id}/{session_id}')
    ref.set({
        'q1':        q1,
        'q2':        q2,
        'q3':        q3,
        'q4':        q4,
        'score':     score,
        'timestamp': datetime.now().isoformat()
    })

    end_session(user_id, session_id, score)
    return score


def get_pss4_history(user_id):
    ref = _ref(f'pss4/{user_id}')
    return ref.get() or {}


# EMA history 
def save_ema_update(user_id, session_id,
                    old_mean, new_mean,
                    feature_cols, alpha):
    ref = _ref(f'ema_history/{user_id}/{session_id}')
    ref.set({
        'timestamp': datetime.now().isoformat(),
        'alpha':     alpha,
        'changes':   {
            feat: {
                'old': float(old_mean[i]),
                'new': float(new_mean[i]),
                'delta': float(new_mean[i] - old_mean[i])
            }
            for i, feat in enumerate(feature_cols)
        }
    })