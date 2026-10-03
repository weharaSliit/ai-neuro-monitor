import firebase_admin
from firebase_admin import credentials, db
from datetime import datetime, timezone, timedelta
import csv
import os
import sys

# Ensure the backend root is in the path so we can import from common
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.abspath(os.path.join(_CURRENT_DIR, ".."))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# Import the group's shared credentials and URL
from common.config import FIREBASE_CRED_FILE, FIREBASE_DB_URL, FIREBASE_CRED_DICT
# FUSION_EN_ROOT/fusion_window_key: the newer fusion_en/ convention (see
# save_fusion_en_rtdb() below) -- separate module from common.config above,
# both coexist under backend/common/.
from backend.common.firebase_config import FUSION_EN_ROOT, FUSION_EN_SESSIONS_ROOT, CURRENT_SESSION_ID_FIELD
from backend.common.fusion import fusion_window_key

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
        if FIREBASE_CRED_DICT:
            cred = credentials.Certificate(FIREBASE_CRED_DICT)
        else:
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
    lk_tz = timezone(timedelta(hours=5, minutes=30))
    ref = _ref(f'users/{user_id}')
    ref.set({
        'name': name,
        'created_at': datetime.now(lk_tz).isoformat(),
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
    lk_tz = timezone(timedelta(hours=5, minutes=30))
    _ref(f'users/{user_id}').update({
        'is_calibrated': is_calibrated,
        'calibration_window_count': window_count,
        'calibrated_at': datetime.now(lk_tz).isoformat()
    })

# --- DATA INGESTION (Objective 3) ---

def save_behavioral_window(user_id, window_data):
    """
    Stores the 30-minute aggregated feature window.
    window_data: dict containing all Category A features (dwell, flight, interaction)
    """
    lk_tz = timezone(timedelta(hours=5, minutes=30))
    timestamp = datetime.now(lk_tz).strftime("%Y%m%d_%H%M%S")
    ref = _ref(f'data_logs/{user_id}/{timestamp}')
    ref.set(window_data)
    return timestamp

# --- STRESS PREDICTIONS & LABELS ---

def save_stress_prediction(user_id, result, session_id=None):
    """
    Saves the model's decision: Normal, Pre-Stress, or High Stress.
    v4.1: Also persists all 5 z-score fields and composite_z so the
    PhenotypingAnalysisScreen can display the full signal breakdown
    directly from Firebase without recomputing on the client.
    """
    ref = _ref(f'predictions/{user_id}')
    # Sri Lanka local time, matching save_behavioral_window()'s data_logs
    # timestamps -- datetime.now() (naive) previously wrote the server's
    # bare UTC wall-clock with no timezone marker, which the app's
    # `new Date(p.timestamp)` then parsed as if it were ALREADY local
    # (UTC+5:30) time, making every reading appear ~5.5 hours older than
    # it actually was (e.g. a reading from moments ago showing "5h ago").
    lk_tz = timezone(timedelta(hours=5, minutes=30))
    pred_data = {
        'timestamp':   datetime.now(lk_tz).isoformat(),
        'label':       result['label'],
        'stress_score': result['score'],
        'confidence':  result.get('confidence', 0.5),
        'signal_quality': result.get('signal_quality', 1.0),
        'is_anomaly':  result['is_anomaly'],
        'composite_z': result.get('composite_z', 0),
        'z_dwell':     result.get('z_dwell', 0),
        'z_flight':    result.get('z_flight', 0),
        'z_scroll':    result.get('z_scroll', 0),
        'z_tilt':      result.get('z_tilt', 0),
        'z_cpm':       result.get('z_cpm', 0),
        'raw_dwell':   result.get('raw_dwell', 0),
        'raw_flight':  result.get('raw_flight', 0),
        'raw_scroll':  result.get('raw_scroll', 0),
        'raw_tilt':    result.get('raw_tilt', 0),
        'raw_cpm':     result.get('raw_cpm', 0),
        'model_type':  result.get('model_type', 'global'),
    }
    if session_id:
        pred_data['session_id'] = session_id
    ref.push(pred_data)

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
    Sri Lanka local time (see save_stress_prediction) -- must stay
    consistent with predictions' timestamps since the Validation screen
    matches self-reports to nearby predictions by timestamp proximity.
    """
    lk_tz = timezone(timedelta(hours=5, minutes=30))
    ref = _ref(f'validation_labels/{user_id}/{label_type}')
    ref.push({
        'timestamp': datetime.now(lk_tz).isoformat(),
        'score': score
    })

def list_all_user_ids():
    """
    Discovers all real participant user IDs stored in Firebase.
    Returns a list of user_id strings found under phenotyping/users/.
    Used by evaluate_accuracy.py to avoid hardcoding IDs.
    """
    raw = _ref('users').get()
    if not raw or not isinstance(raw, dict):
        return []
    return list(raw.keys())

def get_all_stress_predictions(user_id):
    """Retrieves all digital phenotyping predictions for a user."""
    raw = _ref(f'predictions/{user_id}').get()
    return raw if isinstance(raw, dict) else {}

def get_validation_labels(user_id):
    """Retrieves all PSS-4 and SISS EMA validation labels for a user."""
    raw = _ref(f'validation_labels/{user_id}').get()
    return raw if isinstance(raw, dict) else {}

def get_physiological_predictions(user_id):
    """
    Reads physiological stress predictions from the shared fusion_engine table.

    The physiological component writes under:
        fusion_engine/{display_name}/{session_key}/{push-key}

    How it works:
      1. Resolve user_id -> display_name (e.g. UUID -> "Chathurika")
      2. Read ALL sessions under fusion_engine/{display_name}/
      3. Flatten all push-key records across all sessions into one dict
      4. Keep ONLY records where modality == 'physiological'
         (filtering out our own 'behavioral' records written by this component)

    Field normalisation (handles both Wehara and Hiruni naming styles):
      - Score:     uses 'prob_stress'  OR 'stress_score'  OR 'confidence'
      - Timestamp: uses ISO string     OR Unix epoch float (timestamp_center)
    """
    try:
        display_name = get_user_display_name(user_id)
        raw_sessions = db.reference(f'fusion_engine/{display_name}').get()
        if not raw_sessions or not isinstance(raw_sessions, dict):
            return {}

        all_physio = {}
        for session_key, session_data in raw_sessions.items():
            if not isinstance(session_data, dict):
                continue
            for push_key, record in session_data.items():
                if not isinstance(record, dict):
                    continue
                # Only keep physiological records — skip our own behavioral ones
                if record.get('modality', '') != 'physiological':
                    continue

                # Normalise score field: prob_stress / stress_score / confidence
                score = (
                    record.get('prob_stress') or
                    record.get('stress_score') or
                    record.get('confidence') or
                    0.1
                )

                # Normalise timestamp: ISO string OR Unix epoch (timestamp_center)
                ts = record.get('timestamp')
                if not ts:
                    epoch = record.get('timestamp_center') or record.get('timestamp_end')
                    if epoch:
                        from datetime import datetime, timezone
                        ts = datetime.fromtimestamp(float(epoch), tz=timezone.utc).isoformat()

                normalised = {
                    'timestamp':  ts,
                    'stress_score': float(score),
                    'label':      record.get('label', 'Unknown'),
                    'confidence': float(record.get('confidence', 0.0)),
                    'modality':   'physiological',
                }
                all_physio[f"{session_key}__{push_key}"] = normalised

        return all_physio

    except Exception as e:
        print(f"[WARN] fusion_engine physiological read failed: {e}")
        return {}

def save_controlled_experiment(user_id, experiment_type, calm_metrics, stress_metrics, metadata=None):
    """
    Method 3: Saves a controlled laboratory/in-app stress experiment.
    Includes calm baseline metrics vs induced cognitive stress metrics.
    """
    lk_tz = timezone(timedelta(hours=5, minutes=30))
    ref = _ref(f'controlled_experiments/{user_id}')
    record = {
        'experiment_type': experiment_type,
        'timestamp': datetime.now(lk_tz).isoformat(),
        'calm_metrics': calm_metrics,
        'stress_metrics': stress_metrics,
        'metadata': metadata or {}
    }
    ref.push(record)
    return record

def get_controlled_experiments(user_id):
    """Retrieves all controlled stress induction tests for a user."""
    raw = _ref(f'controlled_experiments/{user_id}').get()
    return raw if isinstance(raw, dict) else {}

def save_user_feedback(user_id, feedback_data):
    """
    Saves app usability and experience feedback from participants.
    Path: phenotyping/feedback/{user_id}/{push-key}
    """
    lk_tz = timezone(timedelta(hours=5, minutes=30))
    ref = _ref(f'feedback/{user_id}')
    record = {
        'timestamp': feedback_data.get('timestamp') or datetime.now(lk_tz).isoformat(),
        'answers': feedback_data.get('answers', {}),
        'subscales': feedback_data.get('subscales', {}),
        'overall_score': float(feedback_data.get('overall_score', 0.0)),
        'comment': str(feedback_data.get('comment', '')),
        'user_id': user_id,
    }
    ref.push(record)
    return record


# --- FUSION ENGINE INTEGRATION ---
# Writes behavioral phenotyping output to the shared fusion_engine table
# so other group members' components (neuroadaptive, physiological, EEG)
# can read our stress predictions in a standardised format.
#
# Firebase path: fusion_engine/{display_name}/live_session_{YYYYMMDD}/{push-key}
# This mirrors the format used by: Wehara (physiological) and Hiruni (EEG).

# Accuracy of the One-Class SVM behavioral model, read live from the last
# real evaluation of the deployed artifact (stress_engine.pkl +
# feature_scaler.pkl) instead of a hand-typed constant.
#
# HISTORY: this used to be a hardcoded number, updated by manually re-running
# phenotyping/s9_evaluate_production_model.py, reading the mean accuracy off
# its printed summary or research_synthesis/outputs/production_model_eval.csv,
# and pasting it in here. That number went stale every time s9 was re-run
# without someone remembering to also edit this file, and there was no way to
# tell from Firebase alone whether the constant still matched the model
# actually running in production.
#
# Note this is still measured via an inter-subject anomaly proxy (this user's
# held-out samples vs. a random other user's, since the Kaggle Mobile dataset
# used to train stress_engine.pkl has no real participant stress labels) —
# not accuracy against real stress ground truth. See evaluate_accuaracy.py for
# the one script in this repo that scores against real PSS-4/SISS survey data.
#
# TODO: once evaluate_accuaracy.py has enough PSS-4/SISS samples per user
# (MIN_SAMPLES_VALID=30+) to produce a trustworthy number against real (not
# proxy) ground truth, prefer that over this proxy figure — and consider
# whether stress_engine.pkl should be retrained per-user rather than on the
# pooled population, since personalized OC-SVMs score materially higher
# elsewhere in the research pipeline (e.g. SWELL personalized: F1≈0.72).
_PROD_EVAL_CSV = os.path.abspath(os.path.join(
    _BACKEND_ROOT, "..", "phenotyping", "research_synthesis", "outputs",
    "production_model_eval.csv"
))

def _load_behavioral_model_accuracy():
    """
    Mean 'accuracy' column across all evaluated users in the most recent
    phenotyping/s9_evaluate_production_model.py run. Returns None (rather
    than a guessed fallback number) if that run hasn't happened yet or its
    output can't be read, so a missing evaluation is visible instead of
    silently reporting a fabricated accuracy.
    """
    try:
        with open(_PROD_EVAL_CSV, newline='', encoding='utf-8') as f:
            scores = [float(row['accuracy']) for row in csv.DictReader(f) if row.get('accuracy')]
        if not scores:
            raise ValueError("no 'accuracy' rows found in production_model_eval.csv")
        return round(sum(scores) / len(scores), 4)
    except (OSError, ValueError, KeyError) as e:
        print(f"[WARN] Could not load behavioral model accuracy from {_PROD_EVAL_CSV} ({e}). "
              f"model_accuracy will be reported as null until "
              f"phenotyping/s9_evaluate_production_model.py is run.")
        return None

BEHAVIORAL_MODEL_ACCURACY = _load_behavioral_model_accuracy()


def get_user_display_name(user_id):
    """
    Builds the collision-safe key used to identify this user in the shared
    fusion_engine table, e.g. 'Chathurika_3f2504e0'.

    FIX: PREVIOUSLY returned the raw typed display_name alone (e.g. just
    'Chathurika'). BaselineSurvey.jsx's name field has no uniqueness check —
    it's free text, only required to be non-empty. Two real participants who
    both typed the same name (e.g. two people named "Sam") would have their
    behavioral windows written to the SAME fusion_engine/{name}/... path and
    comingled, with no way to separate them afterward. Appending the first 8
    hex characters of the user's UUID guarantees uniqueness while keeping the
    key human-readable for anyone browsing the Firebase console.

    NOTE: this changes the fusion_engine key format going forward. Any
    records written before this fix used the bare name as the key and won't
    be found under the new key — since no other component currently writes
    to fusion_engine yet (see conversation history), this is safe to change
    now, before other teams start integrating against this table.
    """
    try:
        profile = _ref(f'users/{user_id}').get()
        if profile and isinstance(profile, dict):
            name = profile.get('display_name') or profile.get('name')
            if name and name != 'Participant':
                return f"{name}_{str(user_id)[:8]}"
    except Exception:
        pass
    # Fallback: no usable display name — just the UUID prefix (already unique)
    return str(user_id)[:8]

def _compute_signal_quality(window_features, is_valid):
    """Completeness of the 3 features the OC-SVM model actually reads
    (avg_dwell, avg_flight, scroll_velocity -- see predictor.py step 1),
    equally weighted, halved if the context filter marked this window
    invalid (walking/gaming). Shared by save_to_fusion_engine() (legacy
    table) and save_fusion_en_rtdb() (fusion_en) so both report the exact
    same number for the exact same window, rather than two independently
    maintained copies of this logic silently drifting apart.
    """
    has_dwell  = window_features.get('avg_dwell', 0) > 0
    has_flight = window_features.get('avg_flight', 0) > 0
    has_scroll = window_features.get('scroll_velocity', 0) > 0
    signal_quality = round(
        (int(has_dwell) + int(has_flight) + int(has_scroll)) / 3.0, 2
    )
    if not is_valid:
        signal_quality = round(signal_quality * 0.5, 2)
    return signal_quality


# ═══════════════════════════════════════════════════════════════════
#  RTDB `fusion_en` -- the live fusion store fusion_engin.py's
#  MODALITIES=["eeg", "hrv_gsr", "behav"] and fusion_live_session.py's
#  poll loop actually read (see backend/physiological/firebase_service.py's
#  _hrv_gsr_fusion_fields()/save_fusion_en_rtdb() for the sibling
#  implementation this mirrors field-for-field). save_to_fusion_engine()
#  below writes to a DIFFERENT, older path (fusion_engine/{display_name}/...)
#  that predates this convention and that live fusion never reads -- kept
#  running alongside this for now since other things may still read it,
#  not because both are needed going forward.
# ═══════════════════════════════════════════════════════════════════

def _behav_fusion_fields(confidence, signal_quality, stress_score, label):
    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        'window':               fusion_window_key(),
        'timestamp_behav':      now_iso,
        'prob_behav':           float(stress_score),
        'conf_behav':           float(confidence),
        'model_acc_behav':      BEHAVIORAL_MODEL_ACCURACY,
        'signal_quality_behav': float(signal_quality),
        'stress_label_behav':   label,
    }


def save_fusion_en_rtdb(user_id, session_id, result, window_features, is_valid=True):
    """Writes this window's behavioral fusion fields to
    fusion_en/{user_id}/{session_id}/{window} -- the path fusion_engin.py
    and fusion_live_session.py actually poll for the "behav" modality.
    update() (not set()), same reasoning as the HRV/GSR and EEG writers:
    another modality's write to this same window key must merge, not be
    clobbered. If session_id is missing from the payload, attempts fallback
    lookup via RTDB active session pointers.
    """
    if not session_id or not str(session_id).strip():
        try:
            ptr = db.reference(f'{FUSION_EN_ROOT}/{CURRENT_SESSION_ID_FIELD}').get()
            if not ptr:
                ptr = db.reference(f'{FUSION_EN_SESSIONS_ROOT}/{CURRENT_SESSION_ID_FIELD}').get()
            if ptr and isinstance(ptr, str) and ptr.strip():
                session_id = ptr.strip()
                print(f"[fusion_en] session_id missing from payload; resolved via RTDB pointer: {session_id}")
        except Exception as e:
            print(f"[fusion_en] Pointer resolution failed: {e}")

    if not session_id:
        print("[fusion_en] WARNING: no session_id provided or discoverable in RTDB -- skipping fusion_en write "
              "(user_id={}); this window still reaches the legacy fusion_engine table "
              "via save_to_fusion_engine().".format(user_id))
        return
    confidence = round(float(result.get('confidence', 0.5)), 4)
    signal_quality = _compute_signal_quality(window_features, is_valid)
    fields = _behav_fusion_fields(
        confidence=confidence,
        signal_quality=signal_quality,
        stress_score=float(result.get('score', 0.1)),
        label=result.get('label', 'Normal'),
    )
    key = fields['window']
    try:
        db.reference(f'{FUSION_EN_ROOT}/{user_id}/{session_id}/{key}').update(fields)
    except Exception as e:  # noqa: BLE001 -- one failed write shouldn't break /behavior/predict
        print(f'[fusion_en] WARNING: write failed for {user_id}/{session_id}/{key}: {e}')


def save_to_fusion_engine(user_id, result, window_features, is_valid=True):
    """
    Writes one behavioral prediction window to the shared fusion_engine table.

    Fields written (matches the group's standard format):
      label                 - 'Stress', 'Pre-Stress', or 'Normal'
      modality              - 'behavioral'  (keyboard + scroll + app switching)
      prob_stress           - continuous probability from predictor.py (OC-SVM
                              decision_function blended with personal Z-score)
      prob_normal           - 1 - prob_stress
      confidence            - certainty of prediction, derived from how far
                              prob_stress sits from 0.5 (see predictor.py)
      signal_quality        - completeness of the 3 features the model reads
                              (dwell, flight, scroll), equally weighted
      model_accuracy        - accuracy from the first real evaluation of the
                              actual deployed model (see BEHAVIORAL_MODEL_ACCURACY
                              and phenotyping/s9_evaluate_production_model.py)
      composite_z           - raw multi-feature Z-score deviation from personal baseline
      is_anomaly            - True when OC-SVM flagged an anomaly
      trending_toward_stress- True when prob_stress > 0.5
      timestamp             - ISO 8601 timestamp of this window
      user_id               - UUID of the participant (for cross-referencing)
    """
    display_name = get_user_display_name(user_id)
    lk_tz = timezone(timedelta(hours=5, minutes=30))
    session_date = datetime.now(lk_tz).strftime("%Y%m%d")
    session_key  = f"live_session_{session_date}"

    stress_score = float(result.get('score',       0.1))
    composite_z  = float(result.get('composite_z', 0.0))
    is_anomaly   = bool(result.get('is_anomaly',   False))

    # -- Signal quality -- (see _compute_signal_quality()'s docstring for
    # what this measures and why; shared with save_fusion_en_rtdb() so both
    # tables report the same number for the same window).
    signal_quality = _compute_signal_quality(window_features, is_valid)

    # -- Confidence --
    # PREVIOUSLY recomputed here from composite_z alone via hardcoded divisors
    # (/6.0, /4.0) that duplicated information the score already carries and
    # ignored the OC-SVM signal. Now sourced directly from predictor.py,
    # which derives it from how far `score` itself sits from 0.5 (maximum
    # uncertainty) — one consistent signal instead of two independently
    # hand-tuned formulas. Falls back to a neutral 0.5 only if a caller
    # passes a result dict without it (e.g. an older/unpatched predictor).
    confidence = round(float(result.get('confidence', 0.5)), 4)

    record = {
        'label':                result.get('label', 'Normal'),
        'modality':             'behavioral',
        'prob_stress':          round(stress_score, 4),
        'prob_normal':          round(1.0 - stress_score, 4),
        'confidence':           confidence,
        'signal_quality':       signal_quality,
        'model_accuracy':       BEHAVIORAL_MODEL_ACCURACY,
        
        # Behavioral specific phenotyping data
        'composite_z':          round(composite_z, 4),
        'z_dwell':              result.get('z_dwell', 0),
        'z_flight':             result.get('z_flight', 0),
        'z_scroll':             result.get('z_scroll', 0),
        'z_tilt':               result.get('z_tilt', 0),
        'z_cpm':                result.get('z_cpm', 0),
        'raw_dwell':            result.get('raw_dwell', 0),
        'raw_flight':           result.get('raw_flight', 0),
        'raw_scroll':           result.get('raw_scroll', 0),
        'raw_tilt':             result.get('raw_tilt', 0),
        'raw_cpm':              result.get('raw_cpm', 0),
        
        'is_anomaly':           is_anomaly,
        'trending_toward_stress': stress_score > 0.5,
        'timestamp':            datetime.now(lk_tz).isoformat(),
        'user_id':              user_id,
    }

    db.reference(f'fusion_engine/{display_name}/{session_key}').push(record)
    print(f"[fusion_engine] Written: {display_name}/{session_key} "
          f"-> {record['label']} (p_stress={record['prob_stress']}, "
          f"confidence={record['confidence']}, quality={record['signal_quality']})")