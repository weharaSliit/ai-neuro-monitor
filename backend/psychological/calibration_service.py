# ============================================================
# calibration_service.py -- EEG calibration logic shared by TWO callers:
#   1. app.py's POST /calibrate -- blocks arrive pre-recorded over HTTP
#      (mqtt_bridge.py's always-on flow, or any other HTTP caller).
#   2. eeg_calibration_capture.py's run_eeg_calibration_capture()/
#      run_eeg_threshold_capture() -- blocks captured live from a
#      short-lived MQTT connection, driven by the on-demand
#      POST /calibrate/start and /calibrate/threshold/start. Mirrors the
#      split already used for the ring (backend/physiological/
#      calibration_capture.py, imported by backend/physiological/app.py,
#      never the reverse) -- needed here too since
#      eeg_calibration_capture.py must reach this same save logic without
#      circularly importing app.py.
#
# Bipolar-only throughout (BipolarRawSample / calibrate_bipolar_block() /
# finalize_calibration_bipolar()) -- matching the deployed
# sam40_t7t8_state_model (bipolar-only) and wearable02's actual hardware
# output (ONE T7-T8 differential channel, not two separate ch1/ch2 codes;
# see mqtt_client.py's module docstring). An earlier version of this file
# used the legacy 2-channel RawSample/calibrate_block() path, which never
# actually matched what real wearable02 hardware sends -- caught while
# building the on-demand threshold-capture flow below, which reuses this
# same module and would have inherited the same mismatch.
#
# Also owns the CSV-path helper app.py's /calibrate route reuses -- kept
# here (not duplicated) since calibration is what first defined its shape.
#
# Raw EEG samples are NOT written to Firebase from here (or anywhere else
# in this service) -- only the local CSV log (see raw_csv_path() below).
# What DOES land in Firebase per block is the model's derived output
# (preprocessed features + task_state_score/label, via
# make_eeg_output_record() -- app.py's /predict route) -- raw ADC
# code/millis never leave this process except over the already-required
# bridge->API call that's what actually gets it processed in the first
# place.
# ============================================================

import re
import time
from dataclasses import replace as replace_thresholds
from pathlib import Path

from backend.psychological.firebase_service import (
    ADC_SCALE_TAG, EegFirebaseSession, load_user_calibration_profile, save_user_calibration_profile,
    save_user_responsiveness,
)
from backend.psychological.realtime.csv_logger import CsvLogger, RAW_FIELDS_BIPOLAR, log_raw_block_bipolar
from backend.psychological.realtime.mqtt_client import BipolarRawSample
from backend.psychological.realtime.pipeline import RealtimeInference

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_VERSION = "bipolar_only_v1"

# Raw EEG samples are logged here per session, independent of Firebase -- see
# app.py's original comment on this (still true, just relocated here).
RAW_CSV_DIR = Path(__file__).resolve().parent / "logs"
RAW_CSV_DIR.mkdir(exist_ok=True)
_UNSAFE_FILENAME_CHARS = re.compile(r'[^A-Za-z0-9_-]')


class CalibrationFailedError(Exception):
    """No calibration block reached the required quality bar -- see
    finalize_calibration_bipolar()'s 'failed' status. Callers translate this
    to their own error-reporting mechanism (HTTP 400 vs on_progress('error'))."""


def raw_csv_path(session_id: str) -> Path:
    safe_id = _UNSAFE_FILENAME_CHARS.sub('_', session_id)
    return RAW_CSV_DIR / f"{safe_id}_raw.csv"


def finish_personal_calibration(engine: RealtimeInference, user_id: str, outcome: dict) -> None:
    """Personal Scale bookkeeping after finalize_calibration_bipolar(),
    shared by app.py's /calibrate and run_eeg_calibration_from_blocks().

    mu_rest is NEVER reused from an earlier session: electrode contact
    changes every time the device is worn, so the rest part of onboarding
    is repeated each session (paper Sect. "Personal EEG Threshold"). This
    replaces the old "skip ahead" that restored a stored baseline_shift and
    personal_high_load_p for up to 30 days. What IS carried over is the
    user's last onboarding responsiveness (task z), so a non-responsive
    user's EEG stays out of fusion until they redo the task."""
    outcome["skip_ahead_used"] = False
    if outcome["status"] not in ("ok", "degraded"):
        return
    stored = load_user_calibration_profile(user_id)
    # Only reuse an onboarding result computed under the CURRENT uV scale --
    # untagged results predate the gain-8 fix and are ignored, so the user
    # simply redoes the task (see firebase_service.ADC_SCALE_TAG).
    if (stored is not None and stored.get("eeg_responsive") is not None
            and stored.get("adc_uv_per_count") == ADC_SCALE_TAG):
        engine.eeg_responsive = bool(stored["eeg_responsive"])
        engine.task_response_z = stored.get("task_response_z")
        # The person's load direction carries over (a property of how their
        # signal responds, not of today's electrode contact); the limit's
        # position is re-derived from this session's own rest (0.84 spreads,
        # provisional) until the task is redone.
        if engine.eeg_responsive and stored.get("eeg_direction") in (1, -1):
            engine.direction = int(stored["eeg_direction"])
    elif stored is not None and stored.get("eeg_responsive") is not None:
        outcome["stale_onboarding_ignored"] = True
    outcome["eeg_responsive"] = engine.eeg_responsive
    outcome["task_response_z"] = engine.task_response_z
    outcome["personal_direction"] = engine.direction
    if engine.thresholds_personalized:
        save_user_calibration_profile(user_id, engine.baseline_shift, engine.thresholds_personalized,
                                      mu_rest=engine.mu_rest, personal_high_load_p=engine.personal_high_load_p)


def run_eeg_calibration_from_blocks(user_id: str, session_id: str, blocks_samples: list[list[BipolarRawSample]],
                                     disable_quality_gate: bool = False, allow_degraded: bool = False) -> dict:
    """Runs a full calibrate_bipolar_block()/finalize_calibration_bipolar()
    pass over already-parsed blocks and persists the result -- same body as
    app.py's /calibrate route (kept in sync deliberately; that route still
    runs this inline rather than calling here, since mqtt_bridge.py's
    always-on flow depends on its exact current behavior and this was
    factored out for the NEW on-demand capture path instead of risking
    that one).

    Returns on success:
      {'outcome': <finalize_calibration_bipolar() dict, skip-ahead-augmented>,
       'firebase_enabled': bool,
       'session_state': {'engine', 'firebase', 'csv_logger', 'score_history'}}
    session_state is what the caller stores into app.py's eeg_sessions dict
    so later /predict and /calibrate/threshold/start calls on this
    session_id work.

    Raises CalibrationFailedError (message already user-facing) if no block
    reached the required quality bar -- the csv_logger is already closed by
    the time this raises, since nothing else will ever close it otherwise.
    """
    firebase = EegFirebaseSession(session_id, user_id)
    csv_logger = CsvLogger(str(raw_csv_path(session_id)), RAW_FIELDS_BIPOLAR)

    engine = RealtimeInference(MODEL_DIR, disable_quality_gate=disable_quality_gate)
    for i, samples in enumerate(blocks_samples):
        log_raw_block_bipolar(csv_logger, samples)
        engine.calibrate_bipolar_block(samples)

    outcome = engine.finalize_calibration_bipolar(allow_degraded=allow_degraded)

    finish_personal_calibration(engine, user_id, outcome)

    # updated_at so useDeviceStatus() (CalibrationGate.js) can treat a fresh
    # calibration outcome as evidence the device is alive, not just a fresh
    # /predict window -- see run_eeg_calibration_capture()'s own earlier
    # writes (eeg_calibration_capture.py) for the "still settling/capturing"
    # signal that covers the real ~75s+ this function's caller spends
    # gathering blocks_samples BEFORE this function (and this write) ever
    # runs.
    outcome["updated_at"] = time.time()

    # Written regardless of status (including "failed") -- see app.py's
    # original comment on push_calibration_result()'s docstring.
    firebase.push_calibration_result(outcome)
    if outcome["status"] == "failed":
        csv_logger.close()
        # With the degraded-fallback pool now actually populated (see
        # calibrate_bipolar_block()'s comment), reaching "failed" even with
        # allow_degraded=True means EVERY block hit an unambiguous hardware
        # fault (raw-magnitude or timing) -- not just low quality.
        raise CalibrationFailedError(
            f"No usable EEG data in any calibration block (required quality bar: "
            f"{engine.calibration_min_rating}) -- every block failed an unambiguous "
            f"hardware check (raw signal out of range, or dropped-packet gaps). "
            f"Check the headband is worn and the electrodes are making contact, then try again."
        )

    return {
        "outcome": outcome,
        "firebase_enabled": firebase.enabled,
        "session_state": {"engine": engine, "firebase": firebase, "csv_logger": csv_logger, "score_history": []},
    }


def run_eeg_threshold_from_blocks(session_state: dict, blocks_samples: list[list[BipolarRawSample]],
                                  recovery_samples: list[list[BipolarRawSample]] | None = None) -> dict:
    """Scores deliberate high-load task blocks against the ALREADY-
    CALIBRATED engine from this session's session_state (see
    run_eeg_calibration_from_blocks()'s return shape / app.py's
    eeg_sessions dict) and computes/saves this user's personal
    high_load_p -- called by eeg_calibration_capture.py's on-demand
    run_eeg_threshold_capture(), the only caller (POST
    /calibrate/threshold/start's background worker)."""
    engine = session_state["engine"]
    firebase = session_state["firebase"]

    for samples in blocks_samples:
        engine.score_threshold_task_block(samples)
    # Recovery rest (protocol phase 4) is scored BEFORE the decision: the ABA
    # check needs it to tell a real task response (recovery comes back
    # towards rest) from slow drift (it doesn't) -- see
    # sam40/decision.py midpoint_threshold_logit().
    for samples in recovery_samples or []:
        engine.score_recovery_block(samples)

    outcome = engine.finalize_personal_threshold()
    outcome.update(engine.recovery_outcome())
    # When this threshold was set -- lets a viewer tell whether it belongs to
    # the current calibration (a later recalibration supersedes it).
    outcome["updated_at"] = time.time()
    # Saved whether or not the user was responsive -- a 'not_separated'
    # (non-responsive) result must also persist, so later sessions keep EEG
    # out of fusion until the task is redone.
    if outcome.get("task_response_z") is not None:
        save_user_responsiveness(firebase.user_id, outcome["task_response_z"], outcome["responsive"],
                                 direction=outcome.get("personal_direction"), z_alert=outcome.get("z_alert"))

    # Written regardless of status (including "not_separated") -- see
    # push_threshold_result()'s docstring (firebase_service.py).
    firebase.push_threshold_result(outcome)
    return outcome
