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
from dataclasses import replace as replace_thresholds
from pathlib import Path

from backend.psychological.firebase_service import (
    EegFirebaseSession, load_user_calibration_profile, save_user_calibration_profile,
    save_user_personal_threshold,
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
    so later /predict and /calibrate/threshold(/start) calls on this
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

    # "You've done this before, skip ahead": a returning user (already has a
    # recent calibration on file) reuses that baseline_shift instead of this
    # session's own fresh 3-block estimate -- see app.py's original comment
    # (unchanged reasoning, just relocated here).
    if outcome["status"] == "ok":
        stored_profile = load_user_calibration_profile(user_id)
        if stored_profile is not None:
            engine.baseline_shift = stored_profile["baseline_shift"]
            engine.thresholds_personalized = stored_profile["thresholds_personalized"]
            outcome["baseline_shift"] = engine.baseline_shift
            outcome["thresholds_personalized"] = engine.thresholds_personalized
            outcome["skip_ahead_used"] = True
            # A previously-computed personal high_load_p (see
            # run_eeg_threshold_from_blocks() below) also carries forward
            # here -- same skip-ahead spirit as baseline_shift just above.
            personal_high_load_p = stored_profile.get("personal_high_load_p")
            if personal_high_load_p is not None:
                engine.personal_high_load_p = personal_high_load_p
                engine.thresholds = replace_thresholds(
                    engine.thresholds, high_load_p=personal_high_load_p, cooldown_high_p=personal_high_load_p
                )
                outcome["personal_high_load_p"] = personal_high_load_p
        else:
            outcome["skip_ahead_used"] = False
            if engine.thresholds_personalized:
                save_user_calibration_profile(user_id, engine.baseline_shift, engine.thresholds_personalized)

    # Written regardless of status (including "failed") -- see app.py's
    # original comment on push_calibration_result()'s docstring.
    firebase.push_calibration_result(outcome)
    if outcome["status"] == "failed":
        csv_logger.close()
        raise CalibrationFailedError(
            "No calibration block reached the required quality bar (GOOD by default) -- "
            "check electrode contact, or retry with allow_degraded=true to proceed with a "
            "flagged degraded baseline."
        )

    return {
        "outcome": outcome,
        "firebase_enabled": firebase.enabled,
        "session_state": {"engine": engine, "firebase": firebase, "csv_logger": csv_logger, "score_history": []},
    }


def run_eeg_threshold_from_blocks(session_state: dict, blocks_samples: list[list[BipolarRawSample]]) -> dict:
    """Scores deliberate high-load task blocks against the ALREADY-
    CALIBRATED engine from this session's session_state (see
    run_eeg_calibration_from_blocks()'s return shape / app.py's
    eeg_sessions dict) and computes/saves this user's personal
    high_load_p -- same body as app.py's synchronous /calibrate/threshold
    route, factored out here so eeg_calibration_capture.py's on-demand
    run_eeg_threshold_capture() can reuse it exactly."""
    engine = session_state["engine"]
    firebase = session_state["firebase"]

    for samples in blocks_samples:
        engine.score_threshold_task_block(samples)

    outcome = engine.finalize_personal_threshold()
    if outcome["status"] == "ok":
        save_user_personal_threshold(firebase.user_id, outcome["personal_high_load_p"])

    # Written regardless of status (including "not_separated") -- see
    # push_threshold_result()'s docstring (firebase_service.py).
    firebase.push_threshold_result(outcome)
    return outcome
