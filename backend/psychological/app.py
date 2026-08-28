# ============================================================
# app.py -- EEG (psychological) task-state API server.
#
# Mirrors backend/physiological/app.py's shape (calibrate-then-predict,
# per-session state kept warm) but for T7/T8 EEG blocks instead of
# ring HRV/GSR windows.
#
# IMPORTANT -- naming honesty (see phscycological/results/CURRENT_SYSTEM.md
# Section 1): this model outputs task_state_score (cognitive load), NOT a
# validated subjective-stress probability -- self-report-based stress
# labels are near-chance for this EEG regardless of channel count. Fuse
# with an HRV/GSR stress probability via fushion engin/fusion_engin.py to
# get an actual stress estimate; do not read task_state_score alone as
# "how stressed is this person".
#
# Deployed model: the bipolar-only (T7-T8 differential) variant, NOT the
# higher-offline-AUC CAR-referenced one -- see
# backend/psychological/realtime/pipeline.py's module docstring for why
# (the CAR model's reference can't be reproduced by this 2-electrode
# hardware; the bipolar model is reference-agnostic by construction).
# ============================================================

import os
import re
import time
from pathlib import Path

import numpy as np
from flask import jsonify, request, g

from backend.common.app_factory import create_app
from backend.common.auth import require_auth
from backend.psychological.firebase_service import (
    EegFirebaseSession,
    load_user_calibration_profile,
    save_user_calibration_profile,
)
from backend.psychological.realtime.adc import bipolar_code_to_microvolts
from backend.psychological.realtime.csv_logger import CsvLogger, RAW_FIELDS_BIPOLAR, log_raw_block_bipolar
from backend.psychological.realtime.firebase_sync import make_eeg_output_record
from backend.psychological.realtime.mqtt_client import BipolarRawSample
from backend.psychological.realtime.pipeline import BLOCK_SEC, RealtimeInference

app = create_app(__name__)

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_VERSION = "bipolar_only_v1"

# TEMPORARY: set EEG_DISABLE_QUALITY_GATE=1 to let every block through
# regardless of signal quality -- see RealtimeInference's disable_quality_gate
# docstring (pipeline.py) for why. Turn back off once electrode contact is
# fixed; task_state_score with this on is not trustworthy.
DISABLE_QUALITY_GATE = os.environ.get("EEG_DISABLE_QUALITY_GATE", "0") == "1"
if DISABLE_QUALITY_GATE:
    print("[WARNING] EEG_DISABLE_QUALITY_GATE=1 -- signal-quality gate is bypassed, "
          "every block will be scored regardless of quality. task_state_score is "
          "NOT trustworthy while this is on.")

# Raw EEG samples are logged here per session, independent of Firebase --
# EegFirebaseSession.push_raw() no-ops without $FIREBASE_CRED_JSON/
# $FIREBASE_CREDENTIALS (see firebase_service.py's resolve_credential()),
# so this is the one raw-data path that's guaranteed to work
# even with cloud sync off entirely. Same RAW_FIELDS shape as the standalone
# phscycological/scripts/realtime_inference.py CLI's --log-raw-csv, via the
# same CsvLogger/log_raw_block (realtime/csv_logger.py) -- not a second copy.
RAW_CSV_DIR = Path(__file__).resolve().parent / "logs"
RAW_CSV_DIR.mkdir(exist_ok=True)
_UNSAFE_FILENAME_CHARS = re.compile(r'[^A-Za-z0-9_-]')


def _raw_csv_path(session_id: str) -> Path:
    safe_id = _UNSAFE_FILENAME_CHARS.sub('_', session_id)
    return RAW_CSV_DIR / f"{safe_id}_raw.csv"


eeg_sessions = {}  # session_id -> {'engine': RealtimeInference, 'firebase': EegFirebaseSession,
                   #                'csv_logger': CsvLogger, 'score_history': [...]}

# Deliberately separate from eeg_sessions: a live raw-signal preview is
# useful WHILE positioning electrodes too (before /calibrate has ever
# succeeded, or even been called), so it can't depend on calibration having
# completed. Lazily created per session_id on first /live_raw call, reused
# thereafter -- constructing EegFirebaseSession on every call would open a
# fresh set of Firebase refs per push instead of once per session.
live_raw_sessions: dict[str, EegFirebaseSession] = {}


def _samples_from_payload(data: dict) -> list[BipolarRawSample]:
    """Parses {'millis': [...], 'code': [...]} into BipolarRawSample rows --
    same shape wearable02's real MQTT payload parses into (see
    realtime/mqtt_client.py::parse_bipolar_payload), just delivered over
    HTTP instead of MQTT here. ONE hardware T7-T8 differential channel per
    sample, not two separate ch1/ch2 codes -- see mqtt_client.py's module
    docstring for why the old ch1_code/ch2_code shape never matched what
    this device actually sends."""
    millis = data.get("millis", [])
    code = data.get("code", [])
    if len(millis) != len(code):
        raise ValueError(
            f"millis/code must be the same length (got {len(millis)}, {len(code)})"
        )
    if len(millis) == 0:
        raise ValueError("empty block -- millis/code must be non-empty")
    return [
        BipolarRawSample(millis=int(m), code=int(c))
        for m, c in zip(millis, code)
    ]


def _raw_signal_record(window: int, samples: list[BipolarRawSample]) -> dict:
    """One record per block: raw ADC codes + decoded uV, same RAW_FIELDS_BIPOLAR
    shape as realtime/csv_logger.py's local CSV logging -- see
    EegFirebaseSession.push_raw()'s docstring for why this is a sibling
    RTDB path rather than nested into the derived-output record."""
    return {
        "window": window,
        "millis": [s.millis for s in samples],
        "code": [s.code for s in samples],
        "uv": [round(bipolar_code_to_microvolts(s.code), 3) for s in samples],
    }


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "running",
            "model": f"sam40_t7t8_state_model ({MODEL_VERSION})",
            "output": "task_state_score (cognitive load) -- NOT a validated stress probability",
            "block_sec": BLOCK_SEC,
            "active_sessions": list(eeg_sessions.keys()),
        }
    )


# -- /calibrate -- baseline capture from Relax-period blocks ----------
#
# REQUEST FORMAT:
#   {
#     "session_id": "live_session_1",
#     "allow_degraded": false,
#     "blocks": [
#       {"millis": [...], "code": [...]},
#       ...
#     ]
#   }
@app.route("/calibrate", methods=["POST"])
@require_auth
def calibrate():
    data = request.json or {}
    session_id = data.get("session_id", "session_001")
    blocks = data.get("blocks", [])

    if not blocks:
        return jsonify({"error": "No blocks provided"}), 400

    # Re-calibrating an already-active session_id would otherwise leak the
    # previous attempt's open CSV file handle -- close it before replacing.
    existing = eeg_sessions.get(session_id)
    if existing is not None:
        existing["csv_logger"].close()

    # Created here (not after calibration succeeds) so raw signal from
    # calibration blocks is stored too -- signal storage shouldn't depend on
    # whether calibration happened to pass; reused below as this session's
    # firebase/csv handles rather than constructing second instances.
    firebase = EegFirebaseSession(session_id, g.user_id)
    csv_logger = CsvLogger(str(_raw_csv_path(session_id)), RAW_FIELDS_BIPOLAR)

    engine = RealtimeInference(MODEL_DIR, disable_quality_gate=DISABLE_QUALITY_GATE)
    for i, block in enumerate(blocks):
        try:
            samples = _samples_from_payload(block)
        except ValueError as e:
            return jsonify({"error": f"block {i}: {e}"}), 400
        firebase.push_raw(_raw_signal_record(i, samples))
        log_raw_block_bipolar(csv_logger, samples)
        engine.calibrate_bipolar_block(samples)

    outcome = engine.finalize_calibration_bipolar(allow_degraded=bool(data.get("allow_degraded", False)))

    # "You've done this before, skip ahead": a returning user (g.user_id
    # already has a recent calibration on file) reuses that baseline_shift
    # instead of this session's own fresh 3-block estimate -- the stored
    # one typically rests on more/less-noisy history than a single 3-block
    # SEM check can achieve (see compute_baseline_shift()'s docstring).
    # Only the probability-correction offset is restored, not the
    # feature-level UserBaseline or Itakura signal reference -- those still
    # come from THIS session's real blocks, captured normally above,
    # because the deployed bipolar-only model doesn't read baseline-relative
    # features anyway (see pipeline.py's AdaptiveBaselineTracker docstring)
    # and the Itakura check specifically needs a same-session clean
    # reference (electrode placement isn't stable across sessions).
    if outcome["status"] == "ok":
        stored_profile = load_user_calibration_profile(g.user_id)
        if stored_profile is not None:
            engine.baseline_shift = stored_profile["baseline_shift"]
            engine.thresholds_personalized = stored_profile["thresholds_personalized"]
            outcome["baseline_shift"] = engine.baseline_shift
            outcome["thresholds_personalized"] = engine.thresholds_personalized
            outcome["skip_ahead_used"] = True
        else:
            # New user, or this user's stored profile is now too stale to
            # trust -- this session's own fresh result (already in outcome/
            # engine from finalize_calibration() above) becomes the new
            # baseline. Only persisted when a real shift was actually
            # computed (thresholds_personalized) -- saving a 0.0-shift
            # result here would let one noisy session lock out
            # personalization for CALIBRATION_PROFILE_MAX_AGE_DAYS.
            outcome["skip_ahead_used"] = False
            if engine.thresholds_personalized:
                save_user_calibration_profile(
                    g.user_id, engine.baseline_shift, engine.thresholds_personalized
                )

    # Written regardless of status (including "failed") -- BaselineCalibrationScreen.js
    # and EegSessionScreen.js have no other path to this outcome, since
    # calibration is driven server-side by mqtt_bridge.py, not called by
    # those screens directly. See push_calibration_result()'s docstring.
    firebase.push_calibration_result(outcome)
    if outcome["status"] == "failed":
        # Never stored into eeg_sessions, so nothing else will ever close this --
        # close it here or the file handle (and its partial CSV) just leaks.
        csv_logger.close()
        return (
            jsonify(
                {
                    "success": False,
                    "status": "failed",
                    "message": "No calibration block reached the required quality bar "
                    "(GOOD by default) -- check electrode contact, or retry with "
                    "allow_degraded=true to proceed with a flagged degraded baseline.",
                }
            ),
            400,
        )

    eeg_sessions[session_id] = {
        "engine": engine,
        "firebase": firebase,
        "csv_logger": csv_logger,
        "score_history": [],
    }
    # firebase.enabled is False whenever neither FIREBASE_CRED_JSON nor
    # FIREBASE_CREDENTIALS is set on THIS service -- calibration still
    # succeeds and predictions still work
    # either way, but nothing gets written to Firebase, which otherwise
    # looks identical to a healthy deploy from the bridge/caller's side
    # (success: True either way). Surfaced here so that's visible without
    # cross-referencing this service's own startup logs.
    return jsonify({"success": True, "session_id": session_id, "firebase_enabled": firebase.enabled, **outcome})


# -- /predict -- one 25s block -> task_state_score --------------------
#
# REQUEST FORMAT:
#   {
#     "session_id": "live_session_1",
#     "millis": [...], "code": [...]
#   }
@app.route("/predict", methods=["POST"])
@require_auth
def predict():
    data = request.json or {}
    session_id = data.get("session_id", "session_001")

    if session_id not in eeg_sessions:
        return jsonify({"error": f"Session {session_id!r} not calibrated -- call /calibrate first"}), 400

    try:
        samples = _samples_from_payload(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    state = eeg_sessions[session_id]
    result = state["engine"].infer_bipolar_block(samples)
    state["score_history"].append(result.get("calibrated_p") if not result.get("skipped") else None)
    state["firebase"].push_raw(_raw_signal_record(result.get("window"), samples))
    log_raw_block_bipolar(state["csv_logger"], samples)

    record = make_eeg_output_record(
        result,
        window_sec=BLOCK_SEC,
        model_version=MODEL_VERSION,
        feature_set=MODEL_VERSION,
        history_scores=state["score_history"],
    )
    state["firebase"].push(record)

    return jsonify(
        {
            "session_id": session_id,
            "window": record.get("window"),
            "skipped": record.get("skipped"),
            "task_state_score": record.get("task_state_score"),
            "task_state_label": record.get("task_state_label"),
            "task_state_trend": record.get("task_state_trend"),
            "eeg_quality_score": record.get("eeg_quality_score"),
            "eeg_quality_flag": record.get("eeg_quality_flag"),
            "baseline_degraded": record.get("baseline_degraded"),
            "high_load_alert": record.get("high_load_alert"),
            "micro_break_recommended": record.get("micro_break_recommended"),
            "fatigue_warning": record.get("fatigue_warning"),
            # See /calibrate's identical field -- same session's Firebase
            # handle, so this can only ever match what /calibrate reported.
            "firebase_enabled": state["firebase"].enabled,
        }
    )


# -- /live_raw -- ~1s raw preview -> Firebase, for a genuinely live -------
# dashboard waveform. Independent of /calibrate and /predict's 25s-block/
# quality-gate cycle -- works before calibration even starts (useful while
# positioning electrodes), and every call OVERWRITES the same
# {session_id}/live_raw node rather than accumulating history there.
#
# REQUEST FORMAT: same shape as /predict, just a much smaller batch
#   {"session_id": "live_session_1", "millis": [...], "code": [...]}
@app.route("/live_raw", methods=["POST"])
@require_auth
def live_raw():
    data = request.json or {}
    session_id = data.get("session_id", "session_001")

    try:
        samples = _samples_from_payload(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    firebase = live_raw_sessions.get(session_id)
    if firebase is None:
        firebase = EegFirebaseSession(session_id, g.user_id)
        live_raw_sessions[session_id] = firebase

    # Deliberately NOT clamped, unlike pipeline.py's preprocess_block: this
    # feeds the raw-signal preview chart, whose whole point is showing what
    # wearable02 is ACTUALLY outputting right now (e.g. while positioning
    # electrodes) -- clamping here would hide the real (possibly railed/
    # faulty) reading behind a flat, artificial line. The model-facing clamp
    # in preprocess_block stays; this display path shows the true value.
    firebase.push_live_raw({
        "timestamp": time.time(),
        "millis": [s.millis for s in samples],
        "uv": [round(v, 3) for v in bipolar_code_to_microvolts(np.array([s.code for s in samples]))],
    })

    return jsonify({
        "success": True, "session_id": session_id, "n_samples": len(samples),
        "firebase_enabled": firebase.enabled,
    })


@app.route("/sessions/<session_id>", methods=["DELETE"])
@require_auth
def end_session(session_id):
    state = eeg_sessions.pop(session_id, None)
    if state is not None:
        state["csv_logger"].close()
    return jsonify({"success": True, "session_id": session_id, "existed": state is not None})


if __name__ == "__main__":
    print("=" * 50)
    print("EEG (PSYCHOLOGICAL) TASK-STATE API SERVER")
    print("=" * 50)
    print(f"Model: sam40_t7t8_state_model ({MODEL_VERSION})")
    print("Output: task_state_score (cognitive load) -- NOT validated stress.")
    print("Fuse with HRV/GSR via fushion engin/fusion_engin.py for a stress estimate.")
    print("Endpoints:")
    print("  GET    /health")
    print("  POST   /calibrate          <- baseline capture (Relax-period blocks)")
    print("  POST   /predict            <- one 25s block -> task_state_score")
    print("  POST   /live_raw           <- ~1s raw preview -> live dashboard waveform")
    print("  DELETE /sessions/<id>      <- drop session state")
    print("=" * 50)
    # use_reloader=False -- werkzeug's default reloader watches every file
    # under the CWD (repo root), not just this app's imported modules, so
    # ANY save anywhere in the repo (an editor autosave, git touching
    # mtimes, another backend's own file) restarts this process mid-request.
    # Confirmed live: killed an in-flight /calibrate POST from real
    # wearable02 hardware mid-request when an unrelated file
    # (fushion engin/fusion_engin.py) changed during a 25s+ calibration
    # capture. debug=True's error pages are still useful, just not the
    # auto-restart-on-any-repo-change behavior.
    # Render.com injects $PORT -- use it in production; default to 5001
    # locally (see backend/phenotyping_behavior/app.py's identical pattern).
    port = int(os.environ.get('PORT', 5001))
    app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False)
