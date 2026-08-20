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
from backend.common.firebase_config import FIRESTORE_FUSION_COLLECTION, init_firebase_app

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
        'created_at': datetime.now().isoformat(),
        'session_count': 0
    })
    return user_id


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

    NOTE: this writes to Realtime Database (fusion_engine/{user_id}/
    {session_id}, auto-keyed push()), a DIFFERENT product from Cloud
    Firestore's `fusion_engine` collection that
    `fushion engin/fusion_engin.py::load_fusion_records()` actually
    reads (db.collection("fusion_engine"), via firebase_admin.firestore)
    -- kept as-is for whatever already reads this RTDB path; see
    save_fusion_engine_firestore() below for the Firestore-side bridge.
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


# ═══════════════════════════════════════════════════════════════════
#  CLOUD FIRESTORE `fusion_engine` COLLECTION BRIDGE
#  (separate product from save_fusion_signal()'s RTDB write above --
#  this is what fushion engin/fusion_engin.py actually reads. Mirrors
#  the EEG-side bridge added in
#  psychological/src/realtime/firebase_sync.py::FusionEngineSync,
#  using the SAME deterministic doc id convention -- {session_id}_
#  {window} via .set(doc, merge=True) -- so an EEG and an HRV/GSR
#  window sharing the same session_id and window index merge into ONE
#  Firestore document instead of two separate rows. This only actually
#  happens if both sides are run with a shared session_id convention,
#  which is a cross-module coordination detail neither side enforces
#  today -- if session ids differ, this still works correctly on its
#  own (each side's rows just carry only that modality's columns, and
#  fusion_engin.py's handle_missing_values() already treats a missing
#  modality as "unknown", not as an error).
# ═══════════════════════════════════════════════════════════════════

# LOSO accuracy of the deployed binary (Normal/Stress) XGBoost model,
# from physiological_signals/notebooks/05_model_training.ipynb's own
# reported run (913 WESAD windows, Normal=587/Stress=326) -- fixed
# per-model context written on every row, NOT computed per-window
# (same rationale as psychological/'s MODEL_ACCURACY_AUC: no live
# ground truth to score each individual window's accuracy against).
MODEL_ACC_HRV_GSR = 0.851

_firestore_client_cache = None


def _firestore_client():
    """Lazily creates a Cloud Firestore client on the already-initialized
    firebase_admin app (init_firebase() sets that app up for Realtime
    Database; the same service-account credential covers Firestore too,
    no separate init needed)."""
    global _firestore_client_cache
    if _firestore_client_cache is None:
        from firebase_admin import firestore
        _firestore_client_cache = firestore.client()
    return _firestore_client_cache


def _hrv_gsr_fusion_fields(user_id, session_id, window_idx,
                           confidence, signal_quality,
                           prob_normal, prob_stress,
                           label, trending_toward_stress):
    """Shared field-mapping for the HRV/GSR side of the fusion schema --
    used by BOTH save_fusion_engine_firestore() (Cloud Firestore) and
    save_fusion_en_rtdb() (Realtime Database) below, so the two storage
    backends can never drift apart on field names/values. `prob_stress`
    (not prob_normal) maps to prob_hrv_gsr, matching fusion_engin.py's
    convention of prob_{modality} = P(stress) per modality.

    UTC, not naive local time -- fusion_engin.py's synchronize_timestamps()
    parses timestamps with utc=True, which silently treats a naive
    timestamp as if it already were UTC. On a UTC+5:30 machine (verified
    during this integration's testing) that mislabeled every HRV/GSR row's
    timestamp ~5.5h ahead of the EEG side's correctly-UTC one, which
    flag_stale_predictions' row_max reference then read as the EEG row
    being stale.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
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
    }


def save_fusion_engine_firestore(user_id, session_id, window_idx,
                                 confidence, signal_quality,
                                 prob_normal, prob_stress,
                                 label, trending_toward_stress):
    """Writes one document to Firestore's fusion_engine collection using
    fusion_engin.py's expected column names for the "hrv_gsr" modality --
    see _hrv_gsr_fusion_fields() for the field mapping.

    Failure here is logged and swallowed, not raised -- a Firestore
    hiccup must never break the live /predict response the ring is
    waiting on.
    """
    doc_id = f'{session_id}_{window_idx}'
    doc = _hrv_gsr_fusion_fields(user_id, session_id, window_idx, confidence, signal_quality,
                                 prob_normal, prob_stress, label, trending_toward_stress)
    try:
        _firestore_client().collection(FIRESTORE_FUSION_COLLECTION).document(doc_id).set(doc, merge=True)
    except Exception as e:  # noqa: BLE001 -- one failed write shouldn't break /predict
        print(f'[firestore] WARNING: fusion_engine write failed for {doc_id}: {e}')


def label_session_ground_truth_firestore(session_id, pss4_score):
    """Back-fills `ground_truth_stress` onto every already-written
    Firestore fusion_engine document for this session, from the
    session's real PSS-4 (Perceived Stress Scale, 4-item) self-report --
    a genuine, validated ground-truth instrument, not another
    modality's own prediction. This is the label
    fusion_engin.py::fit_logistic_meta_model() has been refusing to fit
    without (it explicitly rejects fitting against stress_label_{m}
    columns because those are each modality's OWN prediction).

    Binary split matches end_session()'s existing PSS-4 banding
    (score<=6 Normal, >6 Stress/High Stress) collapsed to 0/1 --
    session-level, applied to every window in the session since PSS-4
    is only collected once, at session end, not per-window.

    Only reachable once a session actually has fusion_engine rows for
    this session_id (i.e. at least one /predict call happened first);
    a PSS-4 submitted for a session with no prior predictions simply
    updates zero documents, which is expected, not an error.
    """
    ground_truth_stress = int(pss4_score > 6)
    try:
        docs = _firestore_client().collection(FIRESTORE_FUSION_COLLECTION) \
            .where('session_id', '==', session_id).stream()
        n_updated = 0
        for doc in docs:
            doc.reference.set({
                'ground_truth_stress': ground_truth_stress,
                'ground_truth_pss4_score': pss4_score,
            }, merge=True)
            n_updated += 1
        print(f'[firestore] ground_truth_stress={ground_truth_stress} '
              f'(PSS-4={pss4_score}) backfilled onto {n_updated} fusion_engine row(s) '
              f'for session_id={session_id}')
    except Exception as e:  # noqa: BLE001 -- one failed backfill shouldn't break /pss4
        print(f'[firestore] WARNING: ground-truth backfill failed for session_id={session_id}: {e}')


# ═══════════════════════════════════════════════════════════════════
#  RTDB `fusion_en` MIRROR
#  Same merged fusion schema as the Firestore bridge above, written to
#  Realtime Database instead -- for RTDB-only readers (StressApp's
#  mobile client uses `firebase/database`, not Firestore, and has no
#  path to read the Firestore collection today). Path:
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
                        label, trending_toward_stress):
    """RTDB counterpart to save_fusion_engine_firestore() -- same fields
    (via the shared _hrv_gsr_fusion_fields() helper), written to
    fusion_en/{session_id}/{window_idx} instead of a Firestore document.
    update() (not set()) so an EEG write to the same path (see
    psychological/src/realtime/firebase_sync.py's FirebaseSync pushing to
    root_path='fusion_en') merges into the same child rather than
    clobbering it -- RTDB's analogue of Firestore's set(doc, merge=True).
    """
    fields = _hrv_gsr_fusion_fields(user_id, session_id, window_idx, confidence, signal_quality,
                                    prob_normal, prob_stress, label, trending_toward_stress)
    try:
        _global_ref(f'fusion_en/{session_id}/{window_idx}').update(fields)
    except Exception as e:  # noqa: BLE001 -- one failed write shouldn't break /predict
        print(f'[firebase] WARNING: fusion_en write failed for {session_id}/{window_idx}: {e}')


def label_session_ground_truth_rtdb(session_id, pss4_score):
    """RTDB counterpart to label_session_ground_truth_firestore() --
    backfills ground_truth_stress onto every already-written
    fusion_en/{session_id}/* child for this session."""
    ground_truth_stress = int(pss4_score > 6)
    try:
        children = _global_ref(f'fusion_en/{session_id}').get() or {}
        for window_key in children:
            _global_ref(f'fusion_en/{session_id}/{window_key}').update({
                'ground_truth_stress': ground_truth_stress,
                'ground_truth_pss4_score': pss4_score,
            })
        print(f'[firebase] ground_truth_stress={ground_truth_stress} '
              f'(PSS-4={pss4_score}) backfilled onto {len(children)} fusion_en row(s) '
              f'for session_id={session_id}')
    except Exception as e:  # noqa: BLE001 -- one failed backfill shouldn't break /pss4
        print(f'[firebase] WARNING: fusion_en ground-truth backfill failed for session_id={session_id}: {e}')


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