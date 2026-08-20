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

from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

from backend.psychological.firebase_service import EegFirebaseSession
from backend.psychological.realtime.firebase_sync import make_eeg_output_record
from backend.psychological.realtime.mqtt_client import RawSample
from backend.psychological.realtime.pipeline import BLOCK_SEC, RealtimeInference

app = Flask(__name__)
CORS(app)

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_VERSION = "bipolar_only_v1"

eeg_sessions = {}  # session_id -> {'engine': RealtimeInference, 'firebase': EegFirebaseSession, 'score_history': [...]}


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
def calibrate():
    data = request.json or {}
    session_id = data.get("session_id", "session_001")
    blocks = data.get("blocks", [])

    if not blocks:
        return jsonify({"error": "No blocks provided"}), 400

    engine = RealtimeInference(MODEL_DIR)
    for i, block in enumerate(blocks):
        try:
            samples = _samples_from_payload(block)
        except ValueError as e:
            return jsonify({"error": f"block {i}: {e}"}), 400
        engine.calibrate_block(samples)

    outcome = engine.finalize_calibration(allow_degraded=bool(data.get("allow_degraded", False)))
    if outcome["status"] == "failed":
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
        "firebase": EegFirebaseSession(session_id),
        "score_history": [],
    }
    return jsonify({"success": True, "session_id": session_id, **outcome})


# -- /predict -- one 25s block -> task_state_score --------------------
#
# REQUEST FORMAT:
#   {
#     "session_id": "live_session_1",
#     "millis": [...], "ch1_code": [...], "ch2_code": [...]
#   }
@app.route("/predict", methods=["POST"])
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


@app.route("/sessions/<session_id>", methods=["DELETE"])
def end_session(session_id):
    existed = eeg_sessions.pop(session_id, None) is not None
    return jsonify({"success": True, "session_id": session_id, "existed": existed})


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
    print("  DELETE /sessions/<id>      <- drop session state")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5001, debug=True)
