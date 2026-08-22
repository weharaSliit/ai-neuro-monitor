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
from flask import Flask, jsonify, request
from flask_cors import CORS

from backend.common.auth import require_auth
from backend.psychological.firebase_service import EegFirebaseSession
from backend.psychological.realtime.adc import code_to_microvolts
from backend.psychological.realtime.csv_logger import CsvLogger, RAW_FIELDS, log_raw_block
from backend.psychological.realtime.firebase_sync import make_eeg_output_record
from backend.psychological.realtime.mqtt_client import RawSample
from backend.psychological.realtime.pipeline import BLOCK_SEC, RealtimeInference

app = Flask(__name__)
CORS(app)

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
# EegFirebaseSession.push_raw() no-ops without $FIREBASE_CREDENTIALS (see its
# docstring), so this is the one raw-data path that's guaranteed to work
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


def _samples_from_payload(data: dict) -> list[RawSample]:
    """Parses {'millis': [...], 'ch1_code': [...], 'ch2_code': [...]} into
    RawSample rows -- same shape the MQTT firmware payload parses into
    (see realtime/mqtt_client.py::parse_payload), just delivered over HTTP
    instead of MQTT here."""
    millis = data.get("millis", [])
    ch1 = data.get("ch1_code", [])
    ch2 = data.get("ch2_code", [])
    if not (len(millis) == len(ch1) == len(ch2)):
        raise ValueError(
            f"millis/ch1_code/ch2_code must be the same length "
            f"(got {len(millis)}, {len(ch1)}, {len(ch2)})"
        )
    if len(millis) == 0:
        raise ValueError("empty block -- millis/ch1_code/ch2_code must be non-empty")
    return [
        RawSample(millis=int(m), ch1_code=int(c1), ch2_code=int(c2))
        for m, c1, c2 in zip(millis, ch1, ch2)
    ]


def _raw_signal_record(window: int, samples: list[RawSample]) -> dict:
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
#       {"millis": [...], "ch1_code": [...], "ch2_code": [...]},
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
    firebase = EegFirebaseSession(session_id)
    csv_logger = CsvLogger(str(_raw_csv_path(session_id)), RAW_FIELDS)

    engine = RealtimeInference(MODEL_DIR, disable_quality_gate=DISABLE_QUALITY_GATE)
    for i, block in enumerate(blocks):
        try:
            samples = _samples_from_payload(block)
        except ValueError as e:
            return jsonify({"error": f"block {i}: {e}"}), 400
        firebase.push_raw(_raw_signal_record(i, samples))
        log_raw_block(csv_logger, samples)
        engine.calibrate_block(samples)

    outcome = engine.finalize_calibration(allow_degraded=bool(data.get("allow_degraded", False)))
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
    firebase.mark_session_started()
    return jsonify({"success": True, "session_id": session_id, **outcome})


# -- /predict -- one 25s block -> task_state_score --------------------
#
# REQUEST FORMAT:
#   {
#     "session_id": "live_session_1",
#     "millis": [...], "ch1_code": [...], "ch2_code": [...]
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
    result = state["engine"].infer_block(samples)
    state["score_history"].append(result.get("calibrated_p") if not result.get("skipped") else None)
    state["firebase"].push_raw(_raw_signal_record(result.get("window"), samples))
    log_raw_block(state["csv_logger"], samples)

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
        }
    )


# -- /live_raw -- ~1s raw preview -> Firebase, for a genuinely live -------
# dashboard waveform. Independent of /calibrate and /predict's 25s-block/
# quality-gate cycle -- works before calibration even starts (useful while
# positioning electrodes), and every call OVERWRITES the same
# {session_id}/live_raw node rather than accumulating history there.
#
# REQUEST FORMAT: same shape as /predict, just a much smaller batch
#   {"session_id": "live_session_1", "millis": [...], "ch1_code": [...], "ch2_code": [...]}
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
        firebase = EegFirebaseSession(session_id)
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
        "ch1_uv": [round(v, 3) for v in code_to_microvolts(np.array([s.ch1_code for s in samples]))],
        "ch2_uv": [round(v, 3) for v in code_to_microvolts(np.array([s.ch2_code for s in samples]))],
    })

    return jsonify({"success": True, "session_id": session_id, "n_samples": len(samples)})


@app.route("/sessions/<session_id>", methods=["DELETE"])
@require_auth
def end_session(session_id):
    state = eeg_sessions.pop(session_id, None)
    if state is not None:
        state["csv_logger"].close()
        state["firebase"].mark_session_ended()
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
    app.run(host="0.0.0.0", port=5001, debug=True, use_reloader=False)
