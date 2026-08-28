# ============================================================
# calibration_service.py -- EEG calibration logic shared by TWO callers:
#   1. app.py's POST /calibrate -- blocks arrive pre-recorded over HTTP
#      (mqtt_bridge.py's old always-on flow, or any other HTTP caller).
#   2. eeg_calibration_capture.py's run_eeg_calibration_capture() -- blocks
#      captured live from a short-lived MQTT connection, driven by the new
#      on-demand POST /calibrate/start. Mirrors the split already used for
#      the ring (backend/physiological/calibration_capture.py, imported by
#      backend/physiological/app.py, never the reverse) -- needed here too
#      since eeg_calibration_capture.py must reach this same save logic
#      without circularly importing app.py.
#
# Also owns the raw-signal-record/CSV-path helpers app.py's /predict and
# /live_raw routes reuse -- kept here (not duplicated) since calibration is
# what first defined their shape.
# ============================================================

import re
from pathlib import Path

from backend.psychological.firebase_service import (
    EegFirebaseSession, load_user_calibration_profile, save_user_calibration_profile,
)
from backend.psychological.realtime.adc import code_to_microvolts
from backend.psychological.realtime.csv_logger import CsvLogger, RAW_FIELDS, log_raw_block
from backend.psychological.realtime.mqtt_client import RawSample
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
    finalize_calibration()'s 'failed' status. Callers translate this to
    their own error-reporting mechanism (HTTP 400 vs on_progress('error'))."""


def raw_csv_path(session_id: str) -> Path:
    safe_id = _UNSAFE_FILENAME_CHARS.sub('_', session_id)
    return RAW_CSV_DIR / f"{safe_id}_raw.csv"


def raw_signal_record(window: int, samples: list[RawSample]) -> dict:
    """One record per block: raw ADC codes + decoded uV, same RAW_FIELDS
    shape as realtime/csv_logger.py's local CSV logging -- see
    EegFirebaseSession.push_raw()'s docstring for why this is a sibling
    RTDB path rather than nested into the derived-output record."""
    return {
        "window": window,
        "millis": [s.millis for s in samples],
        "ch1_code": [s.ch1_code for s in samples],
        "ch2_code": [s.ch2_code for s in samples],
        "ch1_uv": [round(code_to_microvolts(s.ch1_code), 3) for s in samples],
        "ch2_uv": [round(code_to_microvolts(s.ch2_code), 3) for s in samples],
    }


def run_eeg_calibration_from_blocks(user_id: str, session_id: str, blocks_samples: list[list[RawSample]],
                                     disable_quality_gate: bool = False, allow_degraded: bool = False) -> dict:
    """Runs a full calibrate_block()/finalize_calibration() pass over
    already-parsed blocks and persists the result -- this is the exact body
    app.py's /calibrate route used to run inline.

    Returns on success:
      {'outcome': <finalize_calibration() dict, skip-ahead-augmented>,
       'firebase_enabled': bool,
       'session_state': {'engine', 'firebase', 'csv_logger', 'score_history'}}
    session_state is what the caller stores into app.py's eeg_sessions dict
    so a later /predict call on this session_id works.

    Raises CalibrationFailedError (message already user-facing) if no block
    reached the required quality bar -- the csv_logger is already closed by
    the time this raises, since nothing else will ever close it otherwise.
    """
    firebase = EegFirebaseSession(session_id, user_id)
    csv_logger = CsvLogger(str(raw_csv_path(session_id)), RAW_FIELDS)

    engine = RealtimeInference(MODEL_DIR, disable_quality_gate=disable_quality_gate)
    for i, samples in enumerate(blocks_samples):
        firebase.push_raw(raw_signal_record(i, samples))
        log_raw_block(csv_logger, samples)
        engine.calibrate_block(samples)

    outcome = engine.finalize_calibration(allow_degraded=allow_degraded)

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
