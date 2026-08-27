import os
import sys
import time
from pathlib import Path
import requests

sys.stdout.reconfigure(line_buffering=True)

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.firebase_config import (
    CURRENT_SESSION_ID_FIELD, CURRENT_USER_ID_FIELD, FIREBASE_DB_URL, RTDB_NAMESPACES
)
from backend.common.mqtt_bridge import auth_headers, post_json
from backend.psychological.realtime.mqtt_client import RawSampleBuffer, make_bipolar_client
from backend.psychological.realtime.resample import SOURCE_FS

BLOCK_SEC = 25.0
BLOCK_SAMPLES = int(BLOCK_SEC * SOURCE_FS)  
N_CALIBRATION_BLOCKS = 3 
LIVE_RAW_SAMPLES = 250
LIVE_RAW_INTERVAL_SEC = 1.0
EMPTY_BUFFER_WARN_INTERVAL_SEC = 5.0
EEG_MQTT_BROKER = os.environ.get("EEG_MQTT_BROKER", "ob1f0f10.ala.asia-southeast1.emqxsl.com")
EEG_MQTT_PORT = int(os.environ.get("EEG_MQTT_PORT", "8883"))
EEG_MQTT_TOPIC = os.environ.get("EEG_MQTT_TOPIC", "mindpulse/wearable02/sensors")
EEG_MQTT_USER = os.environ.get("EEG_MQTT_USER", "wearable02")
EEG_MQTT_PASSWORD = os.environ.get("EEG_MQTT_PASSWORD", "wearable02")
EEG_MQTT_CA_CERT = os.path.join(
    Path(__file__).resolve().parents[2], "iot_firmware", "emqxsl-ca.crt"
)

os.environ.setdefault("PSYCHOLOGICAL_FLASK_URL", "https://mindpulse-eeg.onrender.com")

FLASK_URL = os.environ.get("PSYCHOLOGICAL_FLASK_URL") or \
    f"http://127.0.0.1:{os.environ.get('PSYCHOLOGICAL_PORT', '5001')}"
USER_ID = os.environ.get("EEG_BRIDGE_USER_ID") or None
SESSION_ID = os.environ.get("EEG_SESSION_ID") or "wearable02_" + time.strftime("%Y%m%dT%H%M%S")
POINTER_POLL_INTERVAL_SEC = 10.0

AUTH_HEADERS = auth_headers(USER_ID) if USER_ID else None


def _poll_session_pointer() -> str | None:
    try:
        resp = requests.get(
            f"{FIREBASE_DB_URL}{RTDB_NAMESPACES['psychological']}/{CURRENT_SESSION_ID_FIELD}.json", timeout=5
        )
        value = resp.json()
        return value if isinstance(value, str) and value else None
    except Exception:
        return None


def _poll_user_pointer() -> str | None:
    try:
        resp = requests.get(
            f"{FIREBASE_DB_URL}{RTDB_NAMESPACES['psychological']}/{CURRENT_USER_ID_FIELD}.json", timeout=5
        )
        value = resp.json()
        return value if isinstance(value, str) and value else None
    except Exception:
        return None


def block_payload(samples) -> dict:
    return {
        "millis": [s.millis for s in samples],
        "code": [s.code for s in samples],
    }


def _post_live_raw(samples) -> None:
    """Best-effort -- fires every ~1s, and losing an occasional preview
    frame to a dropped request doesn't matter the way losing a /predict
    result would; the next one lands a second later regardless. Still
    logs failures (just not every success, to avoid spamming once/sec):
    silently swallowing every outcome made "is the raw preview even
    reaching Firebase" unanswerable from these logs alone."""
    try:
        resp = requests.post(
            f"{FLASK_URL}/live_raw",
            json={"session_id": SESSION_ID, **block_payload(samples)},
            headers=AUTH_HEADERS, timeout=15,
        )
        if not resp.ok:
            print(f"[live_raw] {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"[live_raw] request failed: {e}")


def run():
    global SESSION_ID, USER_ID, AUTH_HEADERS
    print("=" * 60)
    print("EEG (wearable02) MQTT -> Flask bridge")
    print("=" * 60)
    print(f"MQTT broker: {EEG_MQTT_BROKER}:{EEG_MQTT_PORT}  topic: {EEG_MQTT_TOPIC}")
    print(f"Flask target: {FLASK_URL}")
    print(f"Session id:   {SESSION_ID}")
    print("  (enter this exact session id in the StressApp EEG screen to watch it live)")
    print(f"Calibration:  {N_CALIBRATION_BLOCKS} Relax-period blocks "
          f"({N_CALIBRATION_BLOCKS * BLOCK_SEC:.0f}s) -- stay still and relaxed until this completes.")
    print("=" * 60)

    buffer = RawSampleBuffer()
    # Already connected + looping -- see backend/common/mqtt_bridge.py::connect_mqtt().
    client = make_bipolar_client(EEG_MQTT_BROKER, EEG_MQTT_PORT, EEG_MQTT_TOPIC, buffer,
                                  client_id="eeg_bridge_wearable02", username=EEG_MQTT_USER,
                                  password=EEG_MQTT_PASSWORD, ca_cert=EEG_MQTT_CA_CERT)

    calibration_blocks = []
    calibrated = False
    block_idx = 0
    last_live_raw_push = 0.0
    last_pointer_poll = 0.0
    last_empty_buffer_warn = 0.0

    try:
        while True:
            # Rotation check: has StressApp started a new session since we
            # last looked? Throttled the same way LIVE_RAW_INTERVAL_SEC
            # throttles the preview push below -- this is a cheap read, but
            # no reason to hit Firebase every 0.5s loop iteration.
            now = time.time()
            if now - last_pointer_poll >= POINTER_POLL_INTERVAL_SEC:
                pointer_session_id = _poll_session_pointer()
                if pointer_session_id and pointer_session_id != SESSION_ID:
                    print(f"[session] rotating {SESSION_ID!r} -> {pointer_session_id!r} "
                          f"(app started a new session) -- recalibrating")
                    SESSION_ID = pointer_session_id
                    calibrated = False
                    calibration_blocks = []
                    block_idx = 0

                pointer_user_id = _poll_user_pointer()
                if pointer_user_id and pointer_user_id != USER_ID:
                    print(f"[user] rotating {USER_ID!r} -> {pointer_user_id!r} "
                          f"(app is now logged in as a different user)")
                    USER_ID = pointer_user_id
                    AUTH_HEADERS = auth_headers(USER_ID)

                last_pointer_poll = now

            # Independent of the block-accumulation cycle below -- runs every
            # loop iteration (both while waiting for a full block and right
            # after processing one), throttled to LIVE_RAW_INTERVAL_SEC.
            # Works during calibration too, so the dashboard can show signal
            # while electrodes are still being positioned.
            if now - last_live_raw_push >= LIVE_RAW_INTERVAL_SEC:
                recent = buffer.peek_recent(LIVE_RAW_SAMPLES)
                if recent:
                    _post_live_raw(recent)
                elif now - last_empty_buffer_warn >= EMPTY_BUFFER_WARN_INTERVAL_SEC:
                    # Distinguishes "no MQTT samples arrived at all" (an
                    # EMQX/firmware-side problem) from "samples arrived but
                    # the /live_raw POST failed" (logged in _post_live_raw
                    # itself) -- both look identical from the dashboard.
                    print("[live_raw] no raw samples buffered -- nothing arriving from wearable02 over MQTT")
                    last_empty_buffer_warn = now
                last_live_raw_push = now

            if buffer.peek_count() < BLOCK_SAMPLES:
                time.sleep(0.5)
                continue

            samples = buffer.drain(BLOCK_SAMPLES)

            if USER_ID is None:
                print(f"[block {block_idx}] skipped — no user logged in yet "
                      f"(waiting for the app's current_user_id pointer)")
                continue

            if not calibrated:
                calibration_blocks.append(block_payload(samples))
                print(f"[calibrate] captured block {len(calibration_blocks)}/{N_CALIBRATION_BLOCKS}")
                if len(calibration_blocks) >= N_CALIBRATION_BLOCKS:
                    # 45s, not 30s -- see the identical comment in
                    # backend/physiological/mqtt_bridge.py: Render's
                    # free-tier Flask can take 30s+ to wake from a cold
                    # start, and 30s was cutting it too close.
                    data = post_json(
                        f"{FLASK_URL}/calibrate",
                        {"session_id": SESSION_ID, "blocks": calibration_blocks},
                        AUTH_HEADERS, timeout=45, label="calibrate",
                    )
                    calibrated = bool(data and data.get("success"))
                    if not calibrated:
                        print("[calibrate] failed -- retrying with a fresh set of blocks")
                        calibration_blocks = []
                continue

            data = post_json(
                f"{FLASK_URL}/predict",
                {"session_id": SESSION_ID, **block_payload(samples)},
                AUTH_HEADERS, timeout=45, label="predict",
            )
            if data:
                if data.get("skipped"):
                    print(f"[predict] block {block_idx} SKIPPED (quality gate)")
                else:
                    print(f"[predict] block {block_idx} task_state_score="
                          f"{data.get('task_state_score')} label={data.get('task_state_label')} "
                          f"high_load_alert={data.get('high_load_alert')}")
            block_idx += 1

    except KeyboardInterrupt:
        print("\nStopping bridge...")
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    run()
