import json
import os
import time
from datetime import datetime, timezone

import numpy as np

from backend.common.config import CALIBRATION_SOFT_AGE_DAYS, CALIBRATION_HARD_AGE_DAYS
from backend.common.firebase_config import FIREBASE_DB_URL, FUSION_EN_ROOT, RTDB_NAMESPACES
from backend.psychological.realtime.firebase_sync import (
    FirebaseSync,
    make_eeg_fusion_record,
)
from backend.psychological.realtime.adc import BIPOLAR_UV_PER_COUNT
from backend.psychological.sam40.decision import DecisionThresholds

# Every stored EEG calibration result is tagged with the uV-per-count scale
# it was computed under. Model scores depend on that scale (features are in
# uV), so a result from a different scale -- e.g. before the gain-8 fix --
# must not be reused. Rounded so float noise can't cause false mismatches.
ADC_SCALE_TAG = round(BIPOLAR_UV_PER_COUNT, 7)

# The real population default, read once from its single source of truth
# (DecisionThresholds) -- exposed via get_calibration_status() below so
# frontend fallbacks use this actual value instead of a hardcoded/duplicated
# constant that could drift out of sync if threshold_set_B is ever re-tuned.
POPULATION_HIGH_LOAD_P = DecisionThresholds().high_load_p

RTDB_NAMESPACE = RTDB_NAMESPACES["psychological"]  # "psychological"

# How long a stored per-user calibration profile stays eligible for
# skip-ahead reuse (see save_user_calibration_profile()/
# load_user_calibration_profile()) before a fresh 3-block calibration is
# required again, same as a brand-new user. EEG electrode placement/skin
# contact varies enough session to session that trusting an old shift
# indefinitely isn't safe -- but a hard cutoff at CALIBRATION_SOFT_AGE_DAYS
# (7 days) forced a fresh 3-block calibration every week with no dismissible
# in-between state, which is stricter than the app-wide calibration-renewal
# UX (see StressApp/modules/shared/CalibrationGate.js): not compulsory until
# CALIBRATION_HARD_AGE_DAYS (30 days), just nudged starting at
# CALIBRATION_SOFT_AGE_DAYS. load_user_calibration_profile() below now keeps
# returning (and letting /calibrate skip ahead on) a profile up to the hard
# age, same shared constants physiological's baseline freshness check uses
# (backend/common/config.py) so both modalities present one renewal cadence
# to the frontend.
CALIBRATION_PROFILE_MAX_AGE_DAYS = CALIBRATION_HARD_AGE_DAYS


def resolve_credential():
    """Prefers FIREBASE_CRED_JSON (the full service-account JSON as an env
    var value -- what a Render deploy needs, since there's no real
    filesystem to point a file path at; same pattern as
    backend/common/firebase_config.py::resolve_credential()) over
    FIREBASE_CREDENTIALS (a real file path, for local dev outside the repo).
    Returns None if neither is set -- this service still never falls back
    to a checked-in key, see the module docstring below."""
    cred_json = os.environ.get("FIREBASE_CRED_JSON")
    if cred_json:
        try:
            return json.loads(cred_json)
        except Exception as e:
            print(f"[firebase] Failed to parse FIREBASE_CRED_JSON: {e}")
    return os.environ.get("FIREBASE_CREDENTIALS")


class EegFirebaseSession:
    """Per-session Firebase writer. Raw ADC codes/millis are never written
    to Firebase from here -- only the derived, per-block model output
    (preprocessed features + task_state_score/label, see push() below);
    raw signal only ever exists in this process's memory (to get
    processed) and in the local CSV log (realtime/csv_logger.py), never in
    the shared database. Two RTDB stores:
      - {RTDB_NAMESPACE}/{user_id}/{session_id}/{window}        derived output -- preprocessed
                                                        features + task_state_score/label for
                                                        this 25s block (see push())
      - {FUSION_EN_ROOT}/{user_id}/{session_id}/{window}   EEG's raw contribution to live
                                                        fusion -- user-scoped like the three
                                                        stores above (a "session" now means one
                                                        login-to-logout span, not a bare
                                                        cross-app-boundary id, so the fusion table
                                                        is nested under whoever it belongs to, same
                                                        as everything else here; see
                                                        save_fusion_en_rtdb() for the ring's side
                                                        of this same path)
                                                        (prob_eeg/conf_eeg/etc, keyed by the
                                                        shared fusion_window_key() wall-clock
                                                        bucket -- see push() and
                                                        make_eeg_fusion_record()), written
                                                        DIRECTLY here so fusion_en holds both
                                                        modalities' data as soon as EITHER one
                                                        reports, not only once
                                                        fusion_live_session.py's separate merge
                                                        loop gets to it. That script still reads
                                                        this same path to compute and write back
                                                        the FUSED probability/label, and mirrors
                                                        its own summary (stress_label/
                                                        probability_vector, session_started/
                                                        session_ended) into
                                                        fusion_en_sessions/{user_id}/{session_id}
                                                        -- see backend/common/firebase_config.py
                                                        for the full schema.
    (fusion_en_sessions/{user_id}/{session_id}/session_ended is written
    directly by StressApp's AuthContext.logout() the moment the user logs
    out -- a session now means "logged in until logged out", not "however
    long the app happened to stay open" -- with fusion_live_session.py's own
    rotation logic as a fallback for the unclean-exit case (app killed
    without a logout). session_started/the rest of fusion_en_sessions is
    written by fusion_live_session.py itself, not this class.)
    """

    def __init__(self, session_id: str, user_id: str):
        self.session_id = session_id
        self.user_id = user_id
        self._cred = resolve_credential()
        self.enabled = self._cred is not None
        if not self.enabled:
            print(
                f"[firebase] Neither FIREBASE_CRED_JSON nor FIREBASE_CREDENTIALS is set -- "
                f"Firebase sync disabled for session={session_id} (predictions still work; "
                f"nothing is written to Firebase). This service never falls back to a "
                f"checked-in key -- see firebase_service.py's module docstring."
            )
            return
        # FirebaseSync joins root_path + session_id verbatim -- passing the
        # composite "{user_id}/{session_id}" here (not a new FirebaseSync
        # param) is what nests all four stores, including fusion_en, under
        # the logged-in user.
        user_session_id = f"{user_id}/{session_id}"
        self._rtdb = FirebaseSync(self._cred, FIREBASE_DB_URL, session_id=user_session_id, root_path=RTDB_NAMESPACE)
        self._fusion_en_rtdb = FirebaseSync(
            self._cred, FIREBASE_DB_URL, session_id=user_session_id, root_path=FUSION_EN_ROOT
        )
        self._calibration_result_rtdb = FirebaseSync(
            self._cred, FIREBASE_DB_URL, session_id=user_session_id, root_path=RTDB_NAMESPACE,
            extra_path="calibration_result"
        )
        self._threshold_result_rtdb = FirebaseSync(
            self._cred, FIREBASE_DB_URL, session_id=user_session_id, root_path=RTDB_NAMESPACE,
            extra_path="threshold_result"
        )

    def push(self, record: dict) -> None:
        if not self.enabled:
            return
        self._rtdb.push(record)
        # merge(), not push() -- the ring writes its own fields into this
        # SAME fusion_en/{session}/{window} key (save_fusion_en_rtdb()), and
        # fusion_live_session.py later writes the fused result back onto it
        # too; two set()s racing on one key would let whichever landed
        # second silently erase the other's fields, .update() merges
        # instead regardless of write order. See FirebaseSync.merge()'s
        # docstring.
        self._fusion_en_rtdb.merge(make_eeg_fusion_record(record))

    def next_block_number(self) -> int:
        """First free block key for this session in Firebase (0 for a new
        session) -- so an engine created after an API restart doesn't
        overwrite the session's earlier blocks."""
        if not self.enabled:
            return 0
        top = self._rtdb.max_window_key()
        return 0 if top is None else top + 1

    def push_threshold_result(self, record: dict) -> None:
        """One-shot snapshot of finalize_personal_threshold()'s outcome
        (status, personal_high_load_p, resting_mean, task_mean,
        n_task_blocks) -- {RTDB_NAMESPACE}/{user_id}/{session_id}/threshold_result,
        same latest-snapshot pattern as push_calibration_result() (.set(),
        overwritten on any re-run, no history kept). Written by
        run_eeg_threshold_from_blocks() (calibration_service.py) once
        POST /calibrate/threshold/start's on-demand capture
        (eeg_calibration_capture.py::run_eeg_threshold_capture()) finishes
        -- the onboarding threshold screen also gets this same outcome
        directly in that route's own HTTP response, so this Firebase copy
        mainly serves other viewers (e.g. an admin screen) watching the
        same session.
        """
        if not self.enabled:
            return
        self._threshold_result_rtdb.set(record)

    def push_calibration_result(self, record: dict) -> None:
        """One-shot snapshot of finalize_calibration()'s outcome (status,
        thresholds_personalized, baseline_shift, resting_calibrated_p,
        n_blocks) -- {RTDB_NAMESPACE}/{user_id}/{session_id}/calibration_result,
        same latest-snapshot pattern as push_threshold_result() (.set(),
        overwritten on any recalibration, no history kept). Lets the frontend (
        BaselineCalibrationScreen.js, EegSessionScreen.js) show whether/how
        this user's own resting EEG shifted their thresholds, without
        needing the /calibrate HTTP response itself -- calibration is driven
        server-side by mqtt_bridge.py, not by these screens directly, so
        this is the only path they have to that outcome.
        """
        if not self.enabled:
            return
        self._calibration_result_rtdb.set(record)


def _calibration_profile_ref(user_id: str) -> FirebaseSync | None:
    """user_profiles/{user_id}/eeg -- keyed by user_id directly (NOT nested
    under a session_id like EegFirebaseSession's four stores, and NOT
    nested under the psychological/ service namespace either), so this is
    the one thing about a user's calibration that actually survives across
    sessions/logins. Lives under the same top-level user_profiles/ root
    Ring's own personal calibration data uses (baselines/{user_id},
    personal_thresholds/{user_id} -- backend/physiological/
    firebase_service.py), so both modalities' personal calibration data
    is reachable the same way instead of EEG's living one level deeper
    inside a service-specific namespace. Returns None (caller treats this
    the same as 'nothing stored yet') if Firebase isn't configured, same
    fallback EegFirebaseSession uses."""
    cred = resolve_credential()
    if cred is None:
        return None
    return FirebaseSync(cred, FIREBASE_DB_URL, session_id=user_id, root_path="user_profiles",
                         extra_path="eeg")


def save_user_calibration_profile(user_id: str, baseline_shift: float, thresholds_personalized: bool,
                                  mu_rest: float | None = None,
                                  personal_high_load_p: float | None = None) -> None:
    """Records this session's fresh rest calibration (Personal Scale:
    mu_rest is re-measured every session, so calibrated_at is "last rest
    calibration", and personal_high_load_p the latest personal threshold
    for apps that show it outside a live session). .update(), not .set(),
    so the onboarding responsiveness saved by save_user_responsiveness()
    survives -- that is the one part carried across sessions."""
    ref = _calibration_profile_ref(user_id)
    if ref is None:
        return
    ref.update({
        'baseline_shift': baseline_shift,
        'thresholds_personalized': thresholds_personalized,
        'mu_rest': mu_rest,
        'personal_high_load_p': personal_high_load_p,
        'calibrated_at': time.time(),
    })


def save_user_responsiveness(user_id: str, task_response_z: float | None, responsive: bool | None) -> None:
    """Onboarding task outcome on the Personal Scale -- the only per-user
    calibration fact reused across sessions (a non-responsive user keeps EEG
    out of fusion until they redo the task with re-seated electrodes)."""
    ref = _calibration_profile_ref(user_id)
    if ref is None:
        return
    ref.update({
        'task_response_z': task_response_z,
        'eeg_responsive': responsive,
        'personal_threshold_calibrated_at': time.time(),
        'adc_uv_per_count': ADC_SCALE_TAG,
    })


def save_user_personal_threshold(user_id: str, personal_high_load_p: float) -> None:
    """Merges a personal high_load_p (from
    sam40.decision.compute_personal_threshold(), derived from a deliberate
    onboarding Rest-vs-Task calibration task) into this user's existing
    calibration_profile node. .update(), not .set() -- this is written by a
    SEPARATE, later call than save_user_calibration_profile() (baseline
    calibration finishes first, then the task phase), so .set() here would
    silently wipe the baseline_shift/thresholds_personalized fields that
    call already wrote. (Previously called the window-keyed .merge() here,
    which unconditionally requires record['window'] and doesn't apply to
    this per-user profile node at all -- every call raised ValueError,
    silently crashing the background thread this runs in and preventing
    personal_high_load_p from ever actually being persisted. Fixed.)"""
    ref = _calibration_profile_ref(user_id)
    if ref is None:
        return
    ref.update({
        'personal_high_load_p': personal_high_load_p,
        'personal_threshold_calibrated_at': time.time(),
    })


def load_user_calibration_profile(user_id: str,
                                   max_age_days: float = CALIBRATION_PROFILE_MAX_AGE_DAYS) -> dict | None:
    """Returns this user's last saved calibration profile (baseline_shift +
    thresholds_personalized) if one exists and is within max_age_days, else
    None. None means the caller should run this session's own fresh
    3-block calibration and treat the result as authoritative, exactly as
    if this user_id had never been seen before -- covers both a genuinely
    new user (nothing ever stored) and a returning user whose last
    calibration is now too stale to trust (see
    CALIBRATION_PROFILE_MAX_AGE_DAYS)."""
    ref = _calibration_profile_ref(user_id)
    if ref is None:
        return None
    profile = ref.get()
    if not profile or 'calibrated_at' not in profile or 'baseline_shift' not in profile:
        return None
    age_days = (time.time() - profile['calibrated_at']) / 86400.0
    if age_days > max_age_days:
        return None
    # age_days/is_stale_soft let /calibrate's skip-ahead caller (app.py)
    # and GET /calibration/status distinguish "confidently fresh" from
    # "still valid but due for a renewal nudge" -- profile itself is
    # otherwise unchanged so existing callers that only read
    # baseline_shift/thresholds_personalized are unaffected.
    profile = dict(profile)
    profile['age_days'] = age_days
    profile['is_stale_soft'] = age_days > CALIBRATION_SOFT_AGE_DAYS
    return profile


def get_calibration_status(user_id: str) -> dict:
    """{exists, calibrated_at, age_days, is_stale_soft, is_stale_hard,
    personal_high_load_p} for StressApp/modules/shared/CalibrationGate.js --
    the only place today that exposes calibration freshness without
    actually running a calibration. Mirrors physiological's
    load_baseline_meta() (backend/physiological/firebase_service.py) so the
    frontend gate can treat both modalities the same way.

    personal_high_load_p is None until the onboarding threshold task
    (finalize_personal_threshold() / save_user_personal_threshold() above)
    has actually separated Rest from Task for this user -- same node,
    just merged in later than baseline_shift/thresholds_personalized, so
    it's naturally absent for a user who's only done baseline calibration
    so far. Exposed here (not just written) so the Fusion dashboard can
    display what this user's threshold actually got personalized to.
    """
    ref = _calibration_profile_ref(user_id)
    if ref is None:
        return {'exists': False, 'calibrated_at': None, 'age_days': None,
                'is_stale_soft': False, 'is_stale_hard': False, 'personal_high_load_p': None,
                'population_high_load_p': POPULATION_HIGH_LOAD_P}
    profile = ref.get()
    if not profile or 'calibrated_at' not in profile:
        return {'exists': False, 'calibrated_at': None, 'age_days': None,
                'is_stale_soft': False, 'is_stale_hard': False, 'personal_high_load_p': None,
                'population_high_load_p': POPULATION_HIGH_LOAD_P}
    age_days = (time.time() - profile['calibrated_at']) / 86400.0
    return {
        'exists': True,
        'calibrated_at': profile['calibrated_at'],
        'age_days': age_days,
        'is_stale_soft': age_days > CALIBRATION_SOFT_AGE_DAYS,
        'is_stale_hard': age_days > CALIBRATION_HARD_AGE_DAYS,
        'personal_high_load_p': profile.get('personal_high_load_p'),
        'population_high_load_p': POPULATION_HIGH_LOAD_P,
        # Personal Scale onboarding result (None = task not done yet).
        # Hidden when computed under a different uV scale (ADC_SCALE_TAG) --
        # the same rule finish_personal_calibration() applies.
        'eeg_responsive': (profile.get('eeg_responsive')
                           if profile.get('adc_uv_per_count') == ADC_SCALE_TAG else None),
        'task_response_z': (profile.get('task_response_z')
                            if profile.get('adc_uv_per_count') == ADC_SCALE_TAG else None),
        # Piggybacks on this same call (not a separate endpoint/round-trip)
        # since CalibrationGate.js's useCalibrationSummary already fetches
        # this response on every poll -- see compute_eeg_baseline_drift()'s
        # docstring above for what this measures and its real limitation.
        'drift': compute_eeg_baseline_drift(user_id),
    }


# ═══════════════════════════════════════════════════════════════════
#  DRIFT DETECTION -- EEG analogue of backend/physiological/
#  firebase_service.py's compute_baseline_drift()/compute_baseline_drift_history()
#  (see those docstrings for the same "heuristic, not a certainty" caveat:
#  recent predictions include genuine real-world high-load moments, not
#  just rest, so this can't distinguish "calibration went stale" from
#  "this person has genuinely been under load lately").
#
#  EEG calibration doesn't persist a resting-state probability SAMPLE LIST
#  the way Ring's baseline calibration does -- engine.baseline_shift
#  (calibration_service.py) is a raw-signal offset, not a probability, so
#  there's no stored "original resting mean" to anchor against here.
#  Instead this anchors to this user's own EARLIEST available live
#  task_state_score samples (right after calibration) and compares them to
#  their most recent ones -- same "has this shifted" question, just
#  answered from this user's own live history instead of a stored
#  calibration artifact.
# ═══════════════════════════════════════════════════════════════════

EEG_DRIFT_THRESHOLD = 0.15
EEG_DRIFT_LOOKBACK_DAYS = 7
EEG_DRIFT_MIN_SAMPLES = 10

# The only fixed (non-session-id) children ever written directly under
# {RTDB_NAMESPACE}/{user_id} -- see _calibration_profile_ref()'s
# extra_path values and EegFirebaseSession's four stores above. Session
# ids are ISO timestamps (StressApp/context/AuthContext.js), which sort
# lexicographically before any of these (digits < lowercase letters in
# ASCII), so a plain order_by_key().limit_to_last() would otherwise pull
# these three in ahead of genuinely recent sessions once a user has fewer
# real sessions than the query limit.
_EEG_NON_SESSION_KEYS = {'calibration_profile', 'calibration_result', 'threshold_result'}


def _eeg_db_ref(path: str):
    """Raw Firebase Admin ref for reads that don't fit FirebaseSync's fixed
    root_path+session_id shape (e.g. scanning ALL of a user's sessions
    below) -- reuses whatever app resolve_credential()/EegFirebaseSession
    already initialized this process, or initializes it fresh on first
    touch. Returns None if Firebase isn't configured, same fallback every
    other read/write in this module uses."""
    cred = resolve_credential()
    if cred is None:
        return None
    import firebase_admin
    from firebase_admin import credentials, db
    try:
        app = firebase_admin.get_app()
    except ValueError:
        app = firebase_admin.initialize_app(credentials.Certificate(cred), {'databaseURL': FIREBASE_DB_URL})
    return db.reference(path, app=app)


def save_eeg_device_heartbeat(device_id='wearable02'):
    """Marks the headband as online right now: one small node, overwritten in
    place, so every client can show 'Headband on' the same way the ring
    does -- from the device itself, not from whether a block happened to
    pass the quality check. Lives in its own root (eeg_devices/) so it never
    appears as a user under psychological/. Best-effort: a Firebase hiccup
    must never interrupt EEG capture."""
    try:
        ref = _eeg_db_ref(f'eeg_devices/{device_id}')
        if ref is None:
            return
        ref.update({'status': 'online', 'last_seen': time.time()})
    except Exception:
        pass


def get_recalibration_request(session_id: str) -> dict | None:
    """A recalibration request for this session, written by psy_web's
    Recalibrate button to eeg_recalibration/{session_id} (its own root, like
    eeg_devices/, so it never shows up as a user under psychological/).
    Best-effort: None on any Firebase problem."""
    try:
        ref = _eeg_db_ref(f'eeg_recalibration/{session_id}')
        value = ref.get() if ref is not None else None
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def update_recalibration_request(session_id: str, fields: dict) -> None:
    """Reports the bridge's progress on a recalibration request back to the
    same node (status capturing -> done/failed). Best-effort."""
    try:
        ref = _eeg_db_ref(f'eeg_recalibration/{session_id}')
        if ref is not None:
            ref.update({**fields, 'updated_at': time.time()})
    except Exception:
        pass


def _eeg_recent_sessions(user_id, limit=30):
    ref = _eeg_db_ref(f'{RTDB_NAMESPACE}/{user_id}')
    if ref is None:
        return {}
    children = ref.order_by_key().limit_to_last(limit).get() or {}
    return {k: v for k, v in children.items() if k not in _EEG_NON_SESSION_KEYS}


def _eeg_window_scores(sessions):
    """Flattens {session_id: {window: record}} (see EegFirebaseSession.push()
    / make_eeg_output_record()) into a chronological list of
    (timestamp_end, task_state_score) pairs, skipped/unscored windows
    dropped."""
    out = []
    for session in sessions.values():
        if not isinstance(session, dict):
            continue
        for rec in session.values():
            if not isinstance(rec, dict) or rec.get('skipped'):
                continue
            score = rec.get('task_state_score')
            ts = rec.get('timestamp_end')
            if score is None or ts is None:
                continue
            out.append((float(ts), float(score)))
    out.sort(key=lambda pair: pair[0])
    return out


def compute_eeg_baseline_drift(user_id):
    """See this section's module-level docstring above for why EEG's
    reference point is its own earliest live samples rather than a stored
    resting-calibration mean. checked=False (not enough history yet, on
    either end) means the caller should show nothing rather than a shaky
    verdict."""
    sessions = _eeg_recent_sessions(user_id, limit=30)
    scores = _eeg_window_scores(sessions)
    if len(scores) < EEG_DRIFT_MIN_SAMPLES * 2:
        return {'checked': False}

    original_mean = float(np.mean([s for _, s in scores[:EEG_DRIFT_MIN_SAMPLES]]))

    cutoff = datetime.now(timezone.utc).timestamp() - EEG_DRIFT_LOOKBACK_DAYS * 86400
    recent = [s for ts, s in scores if ts >= cutoff]
    if len(recent) < EEG_DRIFT_MIN_SAMPLES:
        return {'checked': False}

    recent_mean = float(np.mean(recent))
    drift = recent_mean - original_mean
    return {
        'checked': True,
        'original_resting_mean': original_mean,
        'recent_mean': recent_mean,
        'drift': drift,
        'drift_detected': abs(drift) > EEG_DRIFT_THRESHOLD,
        'n_recent_samples': len(recent),
    }


def compute_eeg_baseline_drift_history(user_id, n_weeks=8):
    """Same comparison as compute_eeg_baseline_drift(), bucketed into the
    last n_weeks separately -- feeds the EEG summary screen's drift-trend
    chart. A week with fewer than EEG_DRIFT_MIN_SAMPLES windows gets
    mean_task_state_score=None/drift=None (chart skips it) rather than a
    misleadingly precise number from too little data."""
    sessions = _eeg_recent_sessions(user_id, limit=200)
    scores = _eeg_window_scores(sessions)
    if len(scores) < EEG_DRIFT_MIN_SAMPLES * 2:
        return []
    original_mean = float(np.mean([s for _, s in scores[:EEG_DRIFT_MIN_SAMPLES]]))

    now = datetime.now(timezone.utc).timestamp()
    weeks = []
    for i in range(n_weeks - 1, -1, -1):
        week_end = now - i * 7 * 86400
        week_start = week_end - 7 * 86400
        bucket = [s for ts, s in scores if week_start <= ts < week_end]
        enough = len(bucket) >= EEG_DRIFT_MIN_SAMPLES
        weeks.append({
            'week_start': datetime.fromtimestamp(week_start, tz=timezone.utc).isoformat(),
            'n_samples': len(bucket),
            'mean_task_state_score': float(np.mean(bucket)) if enough else None,
            'drift': (float(np.mean(bucket)) - original_mean) if enough else None,
        })
    return weeks
