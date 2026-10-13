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
import threading
import time
from dataclasses import replace as replace_thresholds
from pathlib import Path

from flask import jsonify, request, g

from backend.common.app_factory import create_app
from backend.common.auth import require_auth
from backend.psychological.eeg_calibration_capture import run_eeg_calibration_capture, run_eeg_threshold_capture
from backend.psychological.firebase_service import (
    EegFirebaseSession,
    get_calibration_status,
    compute_eeg_baseline_drift_history,
)
from backend.psychological.calibration_service import finish_personal_calibration
from backend.psychological.mqtt_bridge import N_CALIBRATION_BLOCKS, N_THRESHOLD_TASK_BLOCKS
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

# Raw EEG samples are logged HERE ONLY (local disk), never to Firebase --
# same RAW_FIELDS shape as the standalone phscycological/scripts/
# realtime_inference.py CLI's --log-raw-csv, via the same CsvLogger/
# log_raw_block (realtime/csv_logger.py) -- not a second copy. What DOES
# land in Firebase per block is the model's derived output (preprocessed
# features + task_state_score/label, via make_eeg_output_record() in
# /predict below) -- raw ADC code/millis get processed here (that's the
# whole point of the bridge posting them to this API in the first place)
# but are never themselves persisted to the shared database.
RAW_CSV_DIR = Path(__file__).resolve().parent / "logs"
RAW_CSV_DIR.mkdir(exist_ok=True)
_UNSAFE_FILENAME_CHARS = re.compile(r'[^A-Za-z0-9_-]')


def _raw_csv_path(session_id: str) -> Path:
    safe_id = _UNSAFE_FILENAME_CHARS.sub('_', session_id)
    return RAW_CSV_DIR / f"{safe_id}_raw.csv"


eeg_sessions = {}  # session_id -> {'engine': RealtimeInference, 'firebase': EegFirebaseSession,
                   #                'csv_logger': CsvLogger, 'score_history': [...]}

# user_id -> {'status': ..., ...} -- on-demand /calibrate/start capture
# progress, mirroring backend/physiological/app.py's _calibration_sessions
# exactly (same 'settling'/'capturing'/'saving'/'done'/'error' shape --
# see eeg_calibration_capture.py's run_eeg_calibration_capture() docstring).
# Keyed by user_id, not session_id -- a capture doesn't have a session_id
# to key by until run_eeg_calibration_from_blocks() finishes (it mints/uses
# whatever session_id the caller passed to /calibrate/start).
_calibration_sessions: dict[str, dict] = {}

# user_id -> {'status': ..., ...} -- on-demand /calibrate/threshold/start
# capture progress, separate from _calibration_sessions above so a
# threshold-task capture in progress never overwrites/gets overwritten by
# a concurrent baseline capture's own status polling. Mirrors
# backend/physiological/app.py's identical split.
_threshold_sessions: dict[str, dict] = {}


# A bridge-supplied capture time outside this window (relative to this
# server's clock) is treated as a host-clock fault and ignored: the bridge
# buffers at most 60s and retries a block for a few minutes at most, so a
# genuine capture time is never far in the past, and never in the future
# beyond normal clock skew.
CAPTURE_TS_MAX_AGE_SEC = 900
CAPTURE_TS_MAX_AHEAD_SEC = 60


def _capture_end_ts(data: dict) -> float | None:
    """Validated capture_end_ts from mqtt_bridge.py's /predict payload, or
    None (-> make_eeg_output_record() falls back to processing time)."""
    raw = data.get("capture_end_ts")
    if raw is None:
        return None
    try:
        ts = float(raw)
    except (TypeError, ValueError):
        return None
    now = time.time()
    if not (now - CAPTURE_TS_MAX_AGE_SEC <= ts <= now + CAPTURE_TS_MAX_AHEAD_SEC):
        print(f"[predict] ignoring implausible capture_end_ts={ts} ({ts - now:+.0f}s vs server clock) "
              f"-- check the bridge host's clock; using processing time instead")
        return None
    return ts


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

    # Immediate "device is alive, calibrating" signal -- written BEFORE block
    # processing below, not after. useDeviceStatus() (CalibrationGate.js)
    # used to only ever see the device as "online" once the first scored
    # /predict block landed, so a user actively calibrating (mqtt_bridge.py
    # already streaming this session's raw blocks for up to ~75s before this
    # bundled POST even arrives) saw every EEG-related screen -- the
    # Calibrate card, the EEG dashboard, Fusion's Hardware & Sensor Stream
    # row -- show "Offline"/"Not connected" the entire time. This gets
    # overwritten by the real outcome (below) once calibration actually
    # finishes; see push_calibration_result()'s .set() semantics (a full
    # overwrite, not a merge) for why that's safe.
    firebase.push_calibration_result({"status": "capturing", "updated_at": time.time()})

    engine = RealtimeInference(MODEL_DIR, disable_quality_gate=DISABLE_QUALITY_GATE)
    block_reports = []
    for i, block in enumerate(blocks):
        try:
            samples = _samples_from_payload(block)
        except ValueError as e:
            return jsonify({"error": f"block {i}: {e}"}), 400
        log_raw_block_bipolar(csv_logger, samples)
        q = engine.calibrate_bipolar_block(samples)
        # Why each rest block was (not) accepted -- returned so the bridge
        # can say what to fix instead of only "no block passed".
        block_reports.append({
            "block": i, "trusted": bool(q.get("is_trusted")), "gate_rating": q.get("gate_rating"),
            "quality_score": q.get("quality_score"), "reason": q.get("reason"),
            "ptp_uV_unclamped": q.get("ptp_uV_unclamped"), "std_uV_unclamped": q.get("std_uV_unclamped"),
            "out_of_range_fraction": q.get("out_of_range_fraction"),
        })

    outcome = engine.finalize_calibration_bipolar(allow_degraded=bool(data.get("allow_degraded", False)))
    outcome["block_reports"] = block_reports

    # Personal Scale: this session's own rest blocks set mu_rest (never
    # reused across sessions); only the user's onboarding responsiveness
    # carries over -- see finish_personal_calibration().
    finish_personal_calibration(engine, g.user_id, outcome)

    # updated_at so useDeviceStatus() can treat a fresh calibration outcome
    # (not just a fresh /predict window) as evidence the device is alive --
    # same field name as the "capturing" stub above, so the frontend doesn't
    # need to special-case which phase wrote it.
    outcome["updated_at"] = time.time()

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
                    "-- check electrode contact, or retry with "
                    "allow_degraded=true to proceed with a flagged degraded baseline.",
                    "block_reports": block_reports,
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


# -- /calibrate/start + /calibrate/status -- on-demand baseline capture ---
#
# Mirrors backend/physiological/app.py's /calibrate/start + /calibrate/status
# exactly (same phase names, same polling shape) -- this is what
# StressApp/modules/shared/CalibrateBreathingCard.js already calls for
# EEG's side of the combined Ring+EEG calibration widget. The actual
# capture (settle 10s, grab N_CALIBRATION_BLOCKS live blocks over its own
# short-lived MQTT connection) is run_eeg_calibration_capture()
# (eeg_calibration_capture.py), already written; this just runs it in a
# background thread and exposes its progress for polling, same as the
# synchronous /calibrate above but without the caller needing to capture
# raw blocks itself first.
#
# REQUEST FORMAT: {"session_id": "live_session_1"}
@app.route("/calibrate/start", methods=["POST"])
@require_auth
def calibrate_start():
    data = request.json or {}
    session_id = data.get("session_id", "session_001")
    user_id = g.user_id

    current = _calibration_sessions.get(user_id)
    if current and current.get("status") in ("settling", "capturing", "saving"):
        return jsonify({"error": "Calibration already in progress"}), 409

    _calibration_sessions[user_id] = {
        "status": "settling", "session_id": session_id,
        "block_idx": 0, "n_blocks": N_CALIBRATION_BLOCKS,
    }

    def on_progress(status, extra):
        if status == "capturing":
            entry = {"status": "capturing", "session_id": session_id, "n_blocks": N_CALIBRATION_BLOCKS, **extra}
        elif status == "error":
            entry = {"status": "error", "session_id": session_id, "error": extra.get("message", "Unknown error")}
        elif status == "done":
            # extra also carries session_state (live engine/firebase/
            # csv_logger objects, not JSON-serializable) -- registered into
            # eeg_sessions here (same shape /calibrate already populates
            # it with) so /predict and /calibrate/threshold/start can find
            # this session afterward; only the JSON-safe outcome/
            # firebase_enabled go into _calibration_sessions for polling.
            eeg_sessions[session_id] = extra["session_state"]
            entry = {
                "status": "done", "session_id": session_id,
                "outcome": extra.get("outcome"), "firebase_enabled": extra.get("firebase_enabled"),
            }
        else:  # 'settling' / 'saving'
            entry = {"status": status, "session_id": session_id, "n_blocks": N_CALIBRATION_BLOCKS}
        _calibration_sessions[user_id] = entry

    def worker():
        run_eeg_calibration_capture(user_id, session_id, on_progress=on_progress)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"status": "started"})


@app.route("/calibrate/status", methods=["GET"])
@require_auth
def calibrate_status():
    state = _calibration_sessions.get(g.user_id, {"status": "idle"})
    return jsonify(state)


# -- /calibration/status -- freshness check, no capture triggered ---------
# {exists, calibrated_at, age_days, is_stale_soft, is_stale_hard} -- same
# shape physiological's GET /baseline/<user_id> reports, so
# CalibrationGate.js's useCalibrationSummary can treat both modalities the
# same way. Reuses get_calibration_status() (firebase_service.py), already
# written for exactly this.
@app.route("/calibration/status", methods=["GET"])
@require_auth
def calibration_status():
    return jsonify(get_calibration_status(g.user_id))


# -- /admin/calibration/<user_id> -- same data as /calibration/status, but ---
# for ANY user_id -- no ownership check, only @require_auth (a valid token,
# still required). Mirrors backend/physiological/app.py's /admin/baseline/
# <user_id> (same "no admin/role concept, any logged-in account can view any
# other account's data" reasoning documented there) -- this is what
# StressApp/modules/admin/screens/AdminUserDetailScreen.js actually calls
# (GET /admin/calibration/<user_id>) to show a user's EEG calibration
# freshness/personal-threshold state; it was never wired up on this side
# even though the frontend has called it since that screen was built.
@app.route("/admin/calibration/<user_id>", methods=["GET"])
@require_auth
def admin_calibration_status(user_id):
    return jsonify(get_calibration_status(user_id))


# -- /calibration/<user_id>/drift-history -- weekly-bucketed drift trend, --
# for EegSummaryScreen.js's chart. Separate from /calibration/status above
# (which already carries the single current drift verdict for
# CalibrationBanner) since this one does more work (scans up to 200 recent
# sessions) and isn't needed on every poll the way the banner's check is.
# Mirrors physiological's GET /baseline/<user_id>/drift-history exactly.
@app.route("/calibration/<user_id>/drift-history", methods=["GET"])
@require_auth
def calibration_drift_history(user_id):
    if user_id != g.user_id:
        return jsonify({"error": "Forbidden — token does not match requested user"}), 403
    return jsonify({"user_id": user_id, "weeks": compute_eeg_baseline_drift_history(user_id)})


# -- /calibrate/threshold/start + /status -- on-demand personal-threshold -
# task capture. Mirrors backend/physiological/app.py's
# /calibrate/threshold/start + /calibrate/threshold/status exactly (same
# phase names, same polling shape, same naming) -- opens its own
# short-lived MQTT connection on demand, the same way /calibrate/start
# does for baseline -- no dependency on mqtt_bridge.py running as a
# separate process. This is the route StressApp's ThresholdCalibration
# screen calls now (see EegThresholdTaskScreen.js). An earlier synchronous
# /calibrate/threshold route (pre-captured blocks submitted by
# mqtt_bridge.py's always-on flow, triggered by a task_phase_requested
# Firebase flag the frontend set) was removed -- nothing set that flag
# anymore once this on-demand path replaced it, leaving the route
# unreachable.
#
# REQUEST FORMAT: {"session_id": "live_session_1"}
@app.route("/calibrate/threshold/start", methods=["POST"])
@require_auth
def calibrate_threshold_start():
    data = request.json or {}
    session_id = data.get("session_id", "session_001")
    user_id = g.user_id

    if session_id not in eeg_sessions:
        return jsonify({"error": f"Session {session_id!r} not calibrated -- call /calibrate first"}), 400

    current = _threshold_sessions.get(user_id)
    if current and current.get("status") in ("capturing", "saving"):
        return jsonify({"error": "Threshold calibration already in progress"}), 409

    session_state = eeg_sessions[session_id]
    _threshold_sessions[user_id] = {"status": "capturing", "session_id": session_id, "n_blocks": N_THRESHOLD_TASK_BLOCKS}

    def on_progress(status, extra):
        if status == "capturing":
            entry = {"status": "capturing", "session_id": session_id, "n_blocks": N_THRESHOLD_TASK_BLOCKS, **extra}
        elif status == "error":
            entry = {"status": "error", "session_id": session_id, "error": extra.get("message", "Unknown error")}
        elif status == "done":
            entry = {"status": "done", "session_id": session_id, **extra}
        else:  # 'saving'
            entry = {"status": status, "session_id": session_id}
        _threshold_sessions[user_id] = entry

    def worker():
        run_eeg_threshold_capture(session_state, on_progress=on_progress)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"status": "started"})


@app.route("/calibrate/threshold/status", methods=["GET"])
@require_auth
def calibrate_threshold_status():
    state = _threshold_sessions.get(g.user_id, {"status": "idle"})
    return jsonify(state)


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
    log_raw_block_bipolar(state["csv_logger"], samples)

    record = make_eeg_output_record(
        result,
        window_sec=BLOCK_SEC,
        model_version=MODEL_VERSION,
        feature_set=MODEL_VERSION,
        history_scores=state["score_history"],
        # engine.thresholds.high_load_p is ALREADY the effective value --
        # personal if finalize_personal_threshold() succeeded for this
        # user (it replaces this in-place), else whatever population
        # default the engine was constructed with. See
        # make_eeg_output_record()'s 'effective_high_load_p' docstring.
        high_load_p=state["engine"].thresholds.high_load_p,
        capture_end_ts=_capture_end_ts(data),
    )
    state["firebase"].push(record)

    return jsonify(
        {
            "session_id": session_id,
            "window": record.get("window"),
            "timestamp_source": record.get("timestamp_source"),
            "skipped": record.get("skipped"),
            "task_state_score": record.get("task_state_score"),
            "task_state_label": record.get("task_state_label"),
            "task_state_trend": record.get("task_state_trend"),
            "eeg_quality_score": record.get("eeg_quality_score"),
            "eeg_quality_flag": record.get("eeg_quality_flag"),
            "eeg_quality_reason": record.get("eeg_quality_reason"),
            "eeg_out_of_range_fraction": record.get("eeg_out_of_range_fraction"),
            "eeg_ptp_uv_unclamped": record.get("eeg_ptp_uv_unclamped"),
            "eeg_std_uv_unclamped": record.get("eeg_std_uv_unclamped"),
            "eeg_quality_checks": record.get("eeg_quality_checks"),
            # Soft-rejected blocks only: flagged, untrusted score (see
            # pipeline.py PROVISIONAL_MAX_OUT_OF_RANGE).
            "provisional_task_state_score": record.get("provisional_task_state_score"),
            "provisional_quality": record.get("provisional_quality"),
            "baseline_degraded": record.get("baseline_degraded"),
            "high_load_alert": record.get("high_load_alert"),
            "micro_break_recommended": record.get("micro_break_recommended"),
            "fatigue_warning": record.get("fatigue_warning"),
            # Same effective value make_eeg_output_record() stored as
            # 'effective_high_load_p' (personal if finalize_personal_threshold()
            # succeeded for this user, else the population default) -- not
            # previously echoed back to the caller, so mqtt_bridge.py's console
            # log had no way to show what threshold a block was actually judged
            # against.
            "personal_threshold": state["engine"].thresholds.high_load_p,
            # Extracted per-block signal features (band powers, Hjorth params,
            # etc. -- see BIPOLAR_FEATURE_SUFFIXES, firebase_sync.py) that were
            # already being pushed to Firebase for EegSummaryScreen.js's
            # Feature Trends card, but never returned from this route itself.
            "features_eeg": record.get("features_eeg"),
            # See /calibrate's identical field -- same session's Firebase
            # handle, so this can only ever match what /calibrate reported.
            "firebase_enabled": state["firebase"].enabled,
        }
    )


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
    print("  POST   /calibrate/start     <- on-demand baseline capture (background)")
    print("  GET    /calibrate/status    <- poll /calibrate/start progress")
    print("  GET    /calibration/status  <- calibration freshness, no capture triggered")
    print("  GET    /admin/calibration/<user_id> <- same, for any user_id (admin)")
    print("  POST   /calibrate/threshold/start   <- on-demand personal high_load_p task capture")
    print("  GET    /calibrate/threshold/status  <- poll /calibrate/threshold/start progress")
    print("  POST   /predict            <- one 25s block -> task_state_score")
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
