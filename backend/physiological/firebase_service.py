# ============================================================
# firebase_service.py
# All Firebase read/write operations
# ============================================================

import firebase_admin
from firebase_admin import db
import numpy as np
from datetime import datetime, timezone
from backend.common.config import (
    FIREBASE_NAMESPACE,
    MIN_CONFIDENCE_FOR_RETRAIN,
    MIN_SIGNAL_QUALITY_FOR_RETRAIN,
)
from backend.common.firebase_config import FUSION_EN_ROOT, init_firebase_app
from backend.common.fusion import fusion_window_key

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
    # Shared helper (backend/common/firebase_config.py) -- also handles the
    # FIREBASE_CRED_JSON env-var path (cloud hosting) this module's own
    # inline init previously skipped.
    init_firebase_app()
    print("Firebase initialized ✓")


# User operations
def create_user(user_id, name):
    ref = _ref(f'users/{user_id}')
    ref.set({
        'name':       name,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'session_count': 0
    })
    return user_id


def create_user_with_password(user_id, name, password_hash):
    """Brand-new account, password included from creation."""
    ref = _ref(f'users/{user_id}')
    ref.set({
        'name':          name,
        'created_at':    datetime.now(timezone.utc).isoformat(),
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
    data['updated_at']    = datetime.now(timezone.utc).isoformat()
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


def load_baseline_meta(user_id):
    """Returns {'exists', 'updated_at', 'age_days'} without needing the full
    feature mean/std arrays -- used by GET /baseline/<user_id> to expose
    calibration freshness to the frontend's calibration-renewal gate. Mirrors
    psychological's calibration_profile age check
    (backend/psychological/firebase_service.py::load_user_calibration_profile),
    kept here instead of a shared module since each service owns its own
    Firebase schema."""
    ref = _ref(f'baselines/{user_id}')
    data = ref.get()
    if data is None or 'updated_at' not in data:
        return {'exists': False, 'updated_at': None, 'age_days': None}
    updated_at = data['updated_at']
    try:
        parsed = datetime.fromisoformat(updated_at)
        # Pre-fix records were written with a naive datetime.now() (local
        # server time, no tzinfo) -- see save_baseline()'s history. Treat a
        # naive timestamp as UTC rather than raising: this is a freshness
        # heuristic for a 7/30-day gate, not a precision clock, so a few
        # hours of server-timezone skew on old records is an acceptable
        # tradeoff against crashing the whole /baseline endpoint.
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        age_days = (datetime.now(timezone.utc) - parsed).total_seconds() / 86400.0
    except ValueError:
        age_days = None
    return {'exists': True, 'updated_at': updated_at, 'age_days': age_days}


# -- Personal stress-decision threshold (deliberate onboarding task) ------
# Deliberately a SEPARATE node from baselines/{user_id} above, not a few
# more keys mixed into it -- save_baseline() above does a full .set() on
# that whole node every time the Ring is recalibrated, which would wipe
# out resting_scores/personal_stress_threshold if they lived there too.
# This node is owned exclusively by this feature, so .update() here is
# always safe (nothing else ever .set()s over it).
def save_resting_scores(user_id, resting_scores: list) -> None:
    """Persists this baseline capture's per-window prob_stress scores (via
    predictor.predict_window(), the SAME scoring path /predict actually
    uses -- not predict_raw(), which the deployed pipeline never calls for
    physiological, since it always baseline-normalizes first) -- read back
    by run_task_calibration_capture() once the task phase runs, which may
    be a separate later request/process from the one that captured these."""
    ref = _ref(f'personal_thresholds/{user_id}')
    ref.set({
        'resting_scores': [float(s) for s in resting_scores],
        'resting_scores_updated_at': datetime.now(timezone.utc).isoformat(),
    })


def load_resting_scores(user_id):
    data = _ref(f'personal_thresholds/{user_id}').get()
    if not data or 'resting_scores' not in data:
        return None
    return [float(s) for s in data['resting_scores']]


def save_personal_stress_threshold(user_id, threshold: float) -> None:
    """.update(), not .set() -- merges alongside resting_scores (written
    moments earlier by save_resting_scores() above) without clobbering it."""
    ref = _ref(f'personal_thresholds/{user_id}')
    ref.update({
        'personal_stress_threshold': float(threshold),
        'threshold_updated_at': datetime.now(timezone.utc).isoformat(),
    })


def load_personal_stress_threshold(user_id):
    data = _ref(f'personal_thresholds/{user_id}').get()
    if not data or 'personal_stress_threshold' not in data:
        return None
    return float(data['personal_stress_threshold'])


# Session operations
def start_session(user_id):
    sessions_ref = _ref(f'sessions/{user_id}')
    new_session  = sessions_ref.push({
        'start_time': datetime.now(timezone.utc).isoformat(),
        'end_time':   None,
        'pss4_score': None,
        'stress_label': None,
        'window_count': 0
    })
    return new_session.key


def end_session(user_id, session_id,
                pss4_score=None):
    ref = _ref(f'sessions/{user_id}/{session_id}')
    update = {'end_time': datetime.now(timezone.utc).isoformat()}

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
        'timestamp':               datetime.now(timezone.utc).isoformat(),
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
        'timestamp':                datetime.now(timezone.utc).isoformat(),
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


# LOSO accuracy of the deployed binary (Normal/Stress) XGBoost model,
# from physiological_signals/notebooks/05_model_training.ipynb's own
# reported run (913 WESAD windows, Normal=587/Stress=326) -- fixed
# per-model context written on every row, NOT computed per-window
# (same rationale as psychological/'s MODEL_ACCURACY_AUC: no live
# ground truth to score each individual window's accuracy against).
MODEL_ACC_HRV_GSR = 0.851


def _hrv_gsr_fusion_fields(user_id, session_id, window_idx,
                           confidence, signal_quality,
                           prob_normal, prob_stress,
                           label, trending_toward_stress,
                           feat_dict=None, threshold=None):
    """Field-mapping for the HRV/GSR side of the fusion schema, used by
    save_fusion_en_rtdb() (Realtime Database) below. `prob_stress`
    (not prob_normal) maps to prob_hrv_gsr, matching fusion_engin.py's
    convention of prob_{modality} = P(stress) per modality.

    UTC, not naive local time -- fusion_engin.py's synchronize_timestamps()
    parses timestamps with utc=True, which silently treats a naive
    timestamp as if it already were UTC. On a UTC+5:30 machine (verified
    during this integration's testing) that mislabeled every HRV/GSR row's
    timestamp ~5.5h ahead of the EEG side's correctly-UTC one, which
    flag_stale_predictions' row_max reference then read as the EEG row
    being stale.

    `window` here stays this call's own local window_idx (the ring's
    per-session counter, unrelated to fusion_window_key() below) -- kept
    as a plain diagnostic field, not the fusion storage key; see
    save_fusion_en_rtdb() for the key itself.

    features_hrv_gsr is a NAMESPACED key (not a shared 'features' key EEG
    also writes into) -- RTDB's update() only merges at the top level of
    the fields it's given, so a shared 'features' key would have each
    modality's write silently overwrite the other's, not merge with it.
    AVNN/SD1/SCL_mean are the actual feature
    names this pipeline computes (backend/physiological/extract_features.py
    FEATURE_COLS) -- there is no separate RMSSD feature; SD1 is this
    pipeline's short-term HRV variability measure.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    feat_dict = feat_dict or {}
    return {
        'user_id':                 user_id,
        'session_id':              session_id,
        'window':                  window_idx,
        'timestamp':               now_iso,
        'timestamp_hrv_gsr':       now_iso,
        'prob_hrv_gsr':            float(prob_stress),
        'conf_hrv_gsr':            float(confidence),
        'model_acc_hrv_gsr':       MODEL_ACC_HRV_GSR,
        'signal_quality_hrv_gsr':  float(signal_quality),
        'stress_label_hrv_gsr':    label,
        'trending_toward_stress_hrv_gsr': bool(trending_toward_stress),
        # This user's own effective STRESS_DECISION_THRESHOLD -- personal if
        # load_personal_stress_threshold() found one, else the population
        # default (app.py's /predict passes whichever applied to THIS
        # prediction). Consumed by fusion_engin.py's weighted-threshold
        # combination alongside threshold_eeg.
        'threshold_hrv_gsr':       float(threshold) if threshold is not None else None,
        'features_hrv_gsr': {
            'avnn':     float(feat_dict.get('AVNN', 0)),
            'sd1':      float(feat_dict.get('SD1', 0)),
            'scl_mean': float(feat_dict.get('SCL_mean', 0)),
        },
    }


# ═══════════════════════════════════════════════════════════════════
#  RTDB `fusion_en` MIRROR
#  The one live fusion store now (the Cloud Firestore fusion_engine
#  collection this used to also write to, via save_fusion_engine_firestore()/
#  label_session_ground_truth_firestore(), was removed as a duplicate --
#  fushion engin/fusion_engin.py's offline batch-analysis code that reads
#  Firestore is untouched, it just has nothing new to load going forward).
#  For RTDB-only readers (StressApp's mobile client uses `firebase/database`,
#  not Firestore). Path:
#  fusion_en/{session_id}/{window_idx}, matching the EEG side's
#  FirebaseSync convention (root_path/{session_id}/{window}), NOT
#  namespaced under 'physiological' -- _global_ref, same reasoning as
#  save_fusion_signal()'s existing fusion_engine/ RTDB write.
#
#  NO CHANGE NEEDED HERE once the ring hardware is available -- this is
#  called from the same /predict codepath real hardware already hits
#  (see app.py); only the request source (curl/synthetic vs. a real
#  MQTT-fed ring) differs.
# ═══════════════════════════════════════════════════════════════════

def save_fusion_en_rtdb(user_id, session_id, window_idx,
                        confidence, signal_quality,
                        prob_normal, prob_stress,
                        label, trending_toward_stress,
                        feat_dict=None, threshold=None):
    """Writes this session's HRV/GSR fusion fields (via the shared
    _hrv_gsr_fusion_fields() helper) to fusion_en/{user_id}/{session_id}/{key}
    -- user-scoped like every other per-session store, since a "session" is
    now a login-to-logout span that belongs to exactly one user (see
    StressApp's AuthContext.js). Path key is the shared wall-clock bucket
    (see backend/common/fusion.py), NOT window_idx -- this call's own local
    per-session counter, which only coincidentally lined up with the EEG
    side's write near session start (see fusion_window_key()'s docstring).
    update() (not set()) so an EEG write to the same path (see
    backend/psychological/realtime/firebase_sync.py's FirebaseSync pushing
    to root_path='fusion_en') merges into the same child rather than
    clobbering it -- RTDB's analogue of Firestore's set(doc, merge=True).
    """
    fields = _hrv_gsr_fusion_fields(user_id, session_id, window_idx, confidence, signal_quality,
                                    prob_normal, prob_stress, label, trending_toward_stress, feat_dict,
                                    threshold)
    key = fusion_window_key()
    try:
        _global_ref(f'{FUSION_EN_ROOT}/{user_id}/{session_id}/{key}').update(fields)
    except Exception as e:  # noqa: BLE001 -- one failed write shouldn't break /predict
        print(f'[firebase] WARNING: fusion_en write failed for {user_id}/{session_id}/{key}: {e}')


def label_session_ground_truth_rtdb(user_id, session_id, pss4_score):
    """Backfills ground_truth_stress onto every already-written
    fusion_en/{user_id}/{session_id}/* child for this session."""
    ground_truth_stress = int(pss4_score > 6)
    try:
        children = _global_ref(f'{FUSION_EN_ROOT}/{user_id}/{session_id}').get() or {}
        for window_key in children:
            _global_ref(f'{FUSION_EN_ROOT}/{user_id}/{session_id}/{window_key}').update({
                'ground_truth_stress': ground_truth_stress,
                'ground_truth_pss4_score': pss4_score,
            })
        print(f'[firebase] ground_truth_stress={ground_truth_stress} '
              f'(PSS-4={pss4_score}) backfilled onto {len(children)} fusion_en row(s) '
              f'for {user_id}/{session_id}')
    except Exception as e:  # noqa: BLE001 -- one failed backfill shouldn't break /pss4
        print(f'[firebase] WARNING: fusion_en ground-truth backfill failed for {user_id}/{session_id}: {e}')


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
              q1, q2, q3, q4,
              ring_prob_stress=None, eeg_prob_stress=None):
    score = q1 + q2 + q3 + q4
    ref   = _ref(f'pss4/{user_id}/{session_id}')
    data = {
        'q1':        q1,
        'q2':        q2,
        'q3':        q3,
        'q4':        q4,
        'score':     score,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    # Combined EMA check-in tagging: whichever objective reading(s) were
    # available at submission time (Ring and/or EEG's latest prob_stress) --
    # either, both, or neither, per the "unified check-in" design. Omitted
    # entirely (not written as null) when a modality had no reading, so a
    # PSS-4 record's own shape tells you which modality was live at the time.
    if ring_prob_stress is not None:
        data['ring_prob_stress'] = ring_prob_stress
    if eeg_prob_stress is not None:
        data['eeg_prob_stress'] = eeg_prob_stress
    ref.set(data)

    end_session(user_id, session_id, score)
    return score


def get_pss4_history(user_id):
    ref = _ref(f'pss4/{user_id}')
    return ref.get() or {}


# Baseline adaptation history -- one entry per recalibration that actually
# blended into an existing baseline (see calibration_capture.py's
# save_calibration_windows()), not per session. No natural session_id
# exists for a recalibration event, so this pushes an auto-generated key
# instead of the old fixed-per-session path -- ema_history/{user_id} was
# confirmed empty for every real account before this changed, so there's no
# existing data in the old shape to migrate.
def save_baseline_adaptation(user_id, changes, interpretation, alpha):
    """changes/interpretation are ema_service.py's build_ema_summary()['features']
    and interpret_ema_change()'s output -- built by the caller (calibration_capture.py)
    so this stays a plain Firebase write, same division of responsibility as
    the rest of this file."""
    ref = _ref(f'ema_history/{user_id}')
    ref.push({
        'timestamp':      datetime.now(timezone.utc).isoformat(),
        'alpha':          alpha,
        'changes':        changes,
        'interpretation': interpretation,
    })