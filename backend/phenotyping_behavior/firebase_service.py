from firebase_admin import db
from datetime import datetime, timezone

# Single source of truth for every module's RTDB namespace / credential /
# Firestore collection name -- see backend/common/firebase_config.py.
# Imported as backend.common.* (not a bare `common.*`/sys.path hack) so this
# resolves to the SAME module object physiological/ and psychological/ use --
# a separate top-level `common` package would double-import the file under a
# different identity and silently diverge (e.g. two firebase_admin app
# singletons instead of one shared one).
from backend.common.firebase_config import (
    RTDB_NAMESPACES, init_firebase_app,
    FUSION_EN_ROOT, FUSION_EN_SESSIONS_ROOT,
    CURRENT_SESSION_ID_FIELD, CURRENT_USER_ID_FIELD,
)
from backend.common.fusion import fusion_window_key

# --- RESEARCH NAMESPACE ---
# This ensures your data is stored under 'phenotyping/' in the database --
# read from the shared registry (was a locally hardcoded literal) so this
# stays in sync if the registry's key for this module ever changes.
NAMESPACE = RTDB_NAMESPACES["phenotyping_behavior"]

def _ref(path):
    """Helper to return a Firebase reference under your namespace."""
    clean_path = str(path).lstrip('/')
    return db.reference(f"{NAMESPACE}/{clean_path}")


def _global_ref(path):
    """Return a Firebase reference NOT nested under NAMESPACE -- for data
    shared across modalities (fusion_en/), matching
    backend/physiological/firebase_service.py's _global_ref()."""
    return db.reference(str(path).lstrip('/'))

def init_firebase():
    """Initializes Firebase using the shared group credentials."""
    init_firebase_app()
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


# --- FUSION ENGINE INTEGRATION ---
# Writes behavioral phenotyping output to the shared fusion_engine table
# so other group members' components (neuroadaptive, physiological, EEG)
# can read our stress predictions in a standardised format.
#
# Firebase path: fusion_engine/{display_name}/live_session_{YYYYMMDD}/{push-key}
# This mirrors the format used by: Wehara (physiological) and Hiruni (EEG).

# Known accuracy of the One-Class SVM behavioral model (update after validation)
BEHAVIORAL_MODEL_ACCURACY = 0.78

def get_user_display_name(user_id):
    """
    Looks up the human-readable display_name for a user from their Firebase profile.
    Returns the display_name if found, otherwise returns a shortened form of the UUID.
    Used to key the fusion_engine table entry (e.g. 'Chathurika') like other components.
    """
    try:
        profile = _ref(f'users/{user_id}').get()
        if profile and isinstance(profile, dict):
            name = profile.get('display_name') or profile.get('name')
            if name and name != 'Participant':
                return name
    except Exception:
        pass
    # Fallback: first 8 chars of UUID so it's still readable
    return str(user_id)[:8]

def save_to_fusion_engine(user_id, result, window_features, is_valid=True):
    """
    Writes one behavioral prediction window to the shared fusion_engine table.

    Fields written (matches the group's standard format):
      label                 - 'Stress', 'Pre-Stress', or 'Normal'
      modality              - 'behavioral'  (keyboard + scroll + app switching)
      prob_stress           - stress score from the AI model (0.0 - 1.0)
      prob_normal           - 1 - prob_stress
      confidence            - certainty of prediction, derived from composite Z-score
      signal_quality        - data completeness score (typing + scroll + app data)
      model_accuracy        - known accuracy of the underlying One-Class SVM model
      composite_z           - raw multi-feature Z-score deviation from personal baseline
      is_anomaly            - True when OC-SVM flagged an anomaly
      trending_toward_stress- True when prob_stress > 0.5
      timestamp             - ISO 8601 timestamp of this window
      user_id               - UUID of the participant (for cross-referencing)
    """
    display_name = get_user_display_name(user_id)
    session_date = datetime.now().strftime("%Y%m%d")
    session_key  = f"live_session_{session_date}"

    stress_score = float(result.get('score',       0.1))
    composite_z  = float(result.get('composite_z', 0.0))
    is_anomaly   = bool(result.get('is_anomaly',   False))

    # -- Signal quality --
    # How complete is this window's data? (0.0 = no data, 1.0 = all three sensors)
    has_typing = window_features.get('avg_dwell', 0) > 0
    has_scroll = window_features.get('scroll_velocity', 0) > 0
    has_apps   = window_features.get('interaction_rate', 0) > 0
    signal_quality = round(
        (int(has_typing) * 0.50) +
        (int(has_scroll) * 0.30) +
        (int(has_apps)   * 0.20), 2
    )
    # Reduce quality if context filter marked data as invalid (walking/gaming)
    if not is_valid:
        signal_quality = round(signal_quality * 0.5, 2)

    # -- Confidence --
    # When stressed: how far above threshold is the Z-score? (0.5 - 1.0)
    # When normal:   how firmly below threshold?             (0.5 - 1.0)
    if is_anomaly:
        confidence = round(min(1.0, 0.5 + (composite_z / 6.0)), 4)
    else:
        confidence = round(max(0.5, 1.0 - (composite_z / 4.0)), 4)

    record = {
        'label':                result.get('label', 'Normal'),
        'modality':             'behavioral',
        'prob_stress':          round(stress_score, 4),
        'prob_normal':          round(1.0 - stress_score, 4),
        'confidence':           confidence,
        'signal_quality':       signal_quality,
        'model_accuracy':       BEHAVIORAL_MODEL_ACCURACY,
        'composite_z':          round(composite_z, 4),
        'is_anomaly':           is_anomaly,
        'trending_toward_stress': stress_score > 0.5,
        'timestamp':            datetime.now().isoformat(),
        'user_id':              user_id,
    }

    db.reference(f'fusion_engine/{display_name}/{session_key}').push(record)
    print(f"[fusion_engine] Written: {display_name}/{session_key} "
          f"-> {record['label']} (p_stress={record['prob_stress']}, "
          f"confidence={record['confidence']}, quality={record['signal_quality']})")


# ═══════════════════════════════════════════════════════════════════
#  RTDB `fusion_en` INTEGRATION -- the live cross-modality fusion table
#  fushion engin/fusion_live_session.py actually reads (fusion_engine/
#  above is a separate, legacy per-modality table nothing else in the
#  repo reads any more -- physiological/psychological both moved off it
#  the same way; see backend/physiological/firebase_service.py's own
#  "RTDB fusion_en MIRROR" section for the EEG/HRV-GSR precedent this
#  mirrors).
#
#  Path: fusion_en/{user_id}/{session_id}/{window} -- user-scoped because
#  a "session" is a login-to-logout span belonging to exactly one user
#  (StressApp's AuthContext.js), matching every other fusion_en writer.
#  update() (not set()) so EEG/HRV-GSR writes to the SAME window key merge
#  with this modality's fields instead of clobbering them.
# ═══════════════════════════════════════════════════════════════════

MODEL_ACC_BEHAV = BEHAVIORAL_MODEL_ACCURACY  # same constant, fusion-schema name


def get_current_session():
    """Reads the app-driven current_session_id / current_user_id pointer
    (written by StressApp's AuthContext.js at login, cleared at logout --
    see fusion_en_sessions/current_session_id) so a phenotyping prediction
    -- which, unlike EEG/HRV-GSR, has no session_id of its own -- can still
    attach to whichever session is live right now.

    Returns (session_id, user_id), either of which may be None if nobody
    is currently logged in (or the pointer read fails).
    """
    try:
        session_id = _global_ref(f'{FUSION_EN_SESSIONS_ROOT}/{CURRENT_SESSION_ID_FIELD}').get()
        user_id = _global_ref(f'{FUSION_EN_SESSIONS_ROOT}/{CURRENT_USER_ID_FIELD}').get()
        session_id = session_id if isinstance(session_id, str) and session_id else None
        user_id = user_id if isinstance(user_id, str) and user_id else None
        return session_id, user_id
    except Exception as e:
        print(f"[WARN] fusion_en session-pointer read failed: {e}")
        return None, None


def _behav_fusion_fields(user_id, result, window_features, is_valid=True):
    """Field-mapping for the phenotyping/behavioral side of the fusion
    schema, mirroring backend/physiological/firebase_service.py's
    _hrv_gsr_fusion_fields(). `prob_stress` (not prob_normal) maps to
    prob_behav, matching fusion_engin.py's prob_{modality} = P(stress)
    convention.

    UTC, not naive local time -- see _hrv_gsr_fusion_fields()'s docstring
    for why a naive timestamp here would misalign with
    fusion_engin.py's synchronize_timestamps()/flag_stale_predictions().

    Signal-quality/confidence formulas duplicated (not imported) from
    save_to_fusion_engine() above -- same reasoning as physiological's own
    per-modality helper: this is this modality's own field-mapping, not a
    shared one two callers must stay in lockstep on.
    """
    stress_score = float(result.get('score', 0.1))
    composite_z = float(result.get('composite_z', 0.0))
    is_anomaly = bool(result.get('is_anomaly', False))

    has_typing = window_features.get('avg_dwell', 0) > 0
    has_scroll = window_features.get('scroll_velocity', 0) > 0
    has_apps = window_features.get('interaction_rate', 0) > 0
    signal_quality = round(
        (int(has_typing) * 0.50) + (int(has_scroll) * 0.30) + (int(has_apps) * 0.20), 2
    )
    if not is_valid:
        signal_quality = round(signal_quality * 0.5, 2)

    if is_anomaly:
        confidence = round(min(1.0, 0.5 + (composite_z / 6.0)), 4)
    else:
        confidence = round(max(0.5, 1.0 - (composite_z / 4.0)), 4)

    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        'user_id':                     user_id,
        'timestamp':                   now_iso,
        'timestamp_behav':             now_iso,
        'prob_behav':                  round(stress_score, 4),
        'conf_behav':                  confidence,
        'model_acc_behav':             MODEL_ACC_BEHAV,
        'signal_quality_behav':        signal_quality,
        'stress_label_behav':          result.get('label', 'Normal'),
        'trending_toward_stress_behav': stress_score > 0.5,
        'features_behav': {
            'avg_dwell':         float(window_features.get('avg_dwell', 0)),
            'avg_flight':        float(window_features.get('avg_flight', 0)),
            'scroll_velocity':   float(window_features.get('scroll_velocity', 0)),
            'composite_z':       composite_z,
        },
    }


def save_fusion_en_rtdb(user_id, session_id, result, window_features, is_valid=True):
    """Writes this window's behavioral fusion fields to
    fusion_en/{user_id}/{session_id}/{key}, key = the shared wall-clock
    bucket from backend/common/fusion.py's fusion_window_key() -- the same
    bucket EEG/HRV-GSR independently compute at their own write time, so
    all three modalities land as siblings under one window key without
    coordinating directly.
    """
    fields = _behav_fusion_fields(user_id, result, window_features, is_valid)
    key = fusion_window_key()
    try:
        _global_ref(f'{FUSION_EN_ROOT}/{user_id}/{session_id}/{key}').update(fields)
    except Exception as e:  # noqa: BLE001 -- one failed write shouldn't break /behavior/predict
        print(f'[firebase] WARNING: fusion_en write failed for {user_id}/{session_id}/{key}: {e}')