import json
import os
import time

from backend.common.config import CALIBRATION_SOFT_AGE_DAYS, CALIBRATION_HARD_AGE_DAYS
from backend.common.firebase_config import FIREBASE_DB_URL, FUSION_EN_ROOT, RTDB_NAMESPACES
from backend.psychological.realtime.firebase_sync import (
    FirebaseSync,
    make_eeg_fusion_record,
)

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

    def push_threshold_result(self, record: dict) -> None:
        """One-shot snapshot of finalize_personal_threshold()'s outcome
        (status, personal_high_load_p, resting_mean, task_mean,
        n_task_blocks) -- {RTDB_NAMESPACE}/{user_id}/{session_id}/threshold_result,
        same latest-snapshot pattern as push_calibration_result() (.set(),
        overwritten on any re-run, no history kept). Lets the onboarding
        threshold-calibration screen watch for the /calibrate/threshold
        outcome without polling the HTTP endpoint itself -- the actual
        POST to /calibrate/threshold is made by mqtt_bridge.py once it
        sees this session's task_phase_requested flag (set by that
        screen), not by the screen directly, since raw EEG samples are
        only ever available to the bridge's live MQTT connection.
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
    """{RTDB_NAMESPACE}/{user_id}/calibration_profile -- keyed by user_id
    directly (NOT nested under a session_id like EegFirebaseSession's four
    stores), so this is the one thing about a user's calibration that
    actually survives across sessions/logins. Returns None (caller treats
    this the same as 'nothing stored yet') if Firebase isn't configured,
    same fallback EegFirebaseSession uses."""
    cred = resolve_credential()
    if cred is None:
        return None
    return FirebaseSync(cred, FIREBASE_DB_URL, session_id=user_id, root_path=RTDB_NAMESPACE,
                         extra_path="calibration_profile")


def save_user_calibration_profile(user_id: str, baseline_shift: float, thresholds_personalized: bool) -> None:
    """Persists a successful, FRESH calibration's outcome for future-session
    reuse (see load_user_calibration_profile()). Only meant to be called
    when thresholds_personalized is True -- an unpersonalized (0.0 shift)
    result shouldn't overwrite a real prior profile, or start a 7-day
    'confirmed no correction needed' clock off of what's often just one
    noisy 3-block session (see compute_baseline_shift()'s SEM check)."""
    ref = _calibration_profile_ref(user_id)
    if ref is None:
        return
    ref.set({
        'baseline_shift': baseline_shift,
        'thresholds_personalized': thresholds_personalized,
        'calibrated_at': time.time(),
    })


def save_user_personal_threshold(user_id: str, personal_high_load_p: float) -> None:
    """Merges a personal high_load_p (from
    sam40.decision.compute_personal_threshold(), derived from a deliberate
    onboarding Rest-vs-Task calibration task) into this user's existing
    calibration_profile node. .merge(), not .set() -- this is written by a
    SEPARATE, later call than save_user_calibration_profile() (baseline
    calibration finishes first, then the task phase), so .set() here would
    silently wipe the baseline_shift/thresholds_personalized fields that
    call already wrote."""
    ref = _calibration_profile_ref(user_id)
    if ref is None:
        return
    ref.merge({
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
                'is_stale_soft': False, 'is_stale_hard': False, 'personal_high_load_p': None}
    profile = ref.get()
    if not profile or 'calibrated_at' not in profile:
        return {'exists': False, 'calibrated_at': None, 'age_days': None,
                'is_stale_soft': False, 'is_stale_hard': False, 'personal_high_load_p': None}
    age_days = (time.time() - profile['calibrated_at']) / 86400.0
    return {
        'exists': True,
        'calibrated_at': profile['calibrated_at'],
        'age_days': age_days,
        'is_stale_soft': age_days > CALIBRATION_SOFT_AGE_DAYS,
        'is_stale_hard': age_days > CALIBRATION_HARD_AGE_DAYS,
        'personal_high_load_p': profile.get('personal_high_load_p'),
    }
