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
import threading
import time

import numpy as np
from flask import jsonify, request, g

from backend.common.app_factory import create_app
from backend.common.auth import require_auth
from backend.psychological.calibration_service import (
    CalibrationFailedError,
    MODEL_VERSION,
    raw_signal_record,
    run_eeg_calibration_from_blocks,
)
from backend.psychological.eeg_calibration_capture import run_eeg_calibration_capture
from backend.psychological.firebase_service import EegFirebaseSession, get_calibration_status
from backend.psychological.mqtt_bridge import N_CALIBRATION_BLOCKS
from backend.psychological.realtime.adc import code_to_microvolts
from backend.psychological.realtime.csv_logger import log_raw_block
from backend.psychological.realtime.firebase_sync import make_eeg_output_record
from backend.psychological.realtime.mqtt_client import RawSample
from backend.psychological.realtime.pipeline import BLOCK_SEC

app = create_app(__name__)

# TEMPORARY: set EEG_DISABLE_QUALITY_GATE=1 to let every block through
# regardless of signal quality -- see RealtimeInference's disable_quality_gate
# docstring (pipeline.py) for why. Turn back off once electrode contact is
# fixed; task_state_score with this on is not trustworthy.
DISABLE_QUALITY_GATE = os.environ.get("EEG_DISABLE_QUALITY_GATE", "0") == "1"
if DISABLE_QUALITY_GATE:
    print("[WARNING] EEG_DISABLE_QUALITY_GATE=1 -- signal-quality gate is bypassed, "
          "every block will be scored regardless of quality. task_state_score is "
          "NOT trustworthy while this is on.")

eeg_sessions = {}  # session_id -> {'engine': RealtimeInference, 'firebase': EegFirebaseSession,
                   #                'csv_logger': CsvLogger, 'score_history': [...]}

# On-demand calibration progress, mirrors backend/physiological/app.py's
# _calibration_sessions exactly -- module-level, keyed by user_id, no
# locking (single Flask worker process, same as Ring's).
_eeg_calibration_sessions = {}

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

    try:
        blocks_samples = [_samples_from_payload(b) for b in blocks]
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Re-calibrating an already-active session_id would otherwise leak the
    # previous attempt's open CSV file handle -- close it before replacing.
    existing = eeg_sessions.get(session_id)
    if existing is not None:
        existing["csv_logger"].close()

    try:
        result = run_eeg_calibration_from_blocks(
            g.user_id, session_id, blocks_samples,
            disable_quality_gate=DISABLE_QUALITY_GATE,
            allow_degraded=bool(data.get("allow_degraded", False)),
        )
    except CalibrationFailedError as e:
        return jsonify({"success": False, "status": "failed", "message": str(e)}), 400

    eeg_sessions[session_id] = result["session_state"]
    # firebase_enabled is False whenever neither FIREBASE_CRED_JSON nor
    # FIREBASE_CREDENTIALS is set on THIS service -- calibration still
    # succeeds and predictions still work either way, but nothing gets
    # written to Firebase, which otherwise looks identical to a healthy
    # deploy from the bridge/caller's side (success: True either way).
    # Surfaced here so that's visible without cross-referencing this
    # service's own startup logs.
    return jsonify({
        "success": True, "session_id": session_id,
        "firebase_enabled": result["firebase_enabled"], **result["outcome"],
    })


# -- /calibrate/start, /calibrate/status -- on-demand in-app calibration --
# trigger, exact mirror of backend/physiological/app.py's routes of the
# same name (same in-memory progress dict shape, same background-thread
# pattern, same 409-if-in-progress guard). Separate Flask deployment from
# Ring's (mindpulse-eeg vs mindpulse-physiological), so the identical route
# names never collide.
#
# REQUEST FORMAT: {"session_id": "live_session_1"} -- MUST be the app's live
# current_session_id (StressApp/context/AuthContext.js), not a freshly
# minted one, or mqtt_bridge.py's prediction loop (tracking that same id)
# will never see this session as calibrated.
@app.route('/calibrate/start', methods=['POST'])
@require_auth
def eeg_calibrate_start():
    user_id = g.user_id
    data = request.json or {}
    session_id = data.get("session_id", "session_001")

    current = _eeg_calibration_sessions.get(user_id)
    if current and current.get('status') in ('settling', 'capturing', 'saving'):
        return jsonify({'error': 'Calibration already in progress'}), 409

    _eeg_calibration_sessions[user_id] = {
        'status': 'settling', 'block_idx': 0, 'n_blocks': N_CALIBRATION_BLOCKS
    }

    def on_progress(status, extra):
        entry = dict(_eeg_calibration_sessions.get(user_id, {}))
        if status == 'capturing':
            entry['status'] = 'capturing'
            entry['block_idx'] = extra.get('block_idx')
            entry['n_blocks'] = extra.get('n_blocks')
        elif status == 'error':
            entry['status'] = 'error'
            entry['message'] = extra.get('message')
        elif status == 'done':
            # Registers this session into eeg_sessions here (not inside
            # calibration_service/eeg_calibration_capture) so a later
            # /predict call on this session_id works -- eeg_sessions lives
            # in this module.
            eeg_sessions[session_id] = extra['session_state']
            entry['status'] = 'done'
            entry['firebase_enabled'] = extra.get('firebase_enabled')
            entry.update(extra.get('outcome', {}))
        else:
            entry['status'] = status
        _eeg_calibration_sessions[user_id] = entry

    def worker():
        run_eeg_calibration_capture(user_id, session_id, on_progress=on_progress)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({'status': 'started'})


@app.route('/calibrate/status', methods=['GET'])
@require_auth
def eeg_calibrate_status():
    state = _eeg_calibration_sessions.get(g.user_id, {'status': 'idle'})
    return jsonify(state)


@app.route("/calibration/status", methods=["GET"])
@require_auth
def calibration_status():
    """{exists, calibrated_at, age_days, is_stale_soft, is_stale_hard} for
    this user's stored calibration_profile -- lets
    StressApp/modules/shared/CalibrationGate.js check EEG's calibration
    freshness without running a full 3-block calibration, mirroring
    physiological's GET /baseline/<user_id> response shape."""
    return jsonify(get_calibration_status(g.user_id))


@app.route("/admin/calibration/<user_id>", methods=["GET"])
@require_auth
def admin_calibration_status(user_id):
    """Same shape as GET /calibration/status, but for any user_id -- unlike
    that route (hardcoded to g.user_id, no user_id param exists on it),
    this takes the target user explicitly. No ownership check, only
    @require_auth (a valid token still required) -- see
    backend/physiological/app.py's /admin/... routes for why (StressApp's
    Admin App, no role/permission concept exists in this backend by
    design)."""
    return jsonify(get_calibration_status(user_id))


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
    state["firebase"].push_raw(raw_signal_record(result.get("window"), samples))
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
        "ch1_uv": [round(v, 3) for v in code_to_microvolts(np.array([s.ch1_code for s in samples]))],
        "ch2_uv": [round(v, 3) for v in code_to_microvolts(np.array([s.ch2_code for s in samples]))],
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
