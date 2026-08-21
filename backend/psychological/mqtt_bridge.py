# ============================================================
# mqtt_bridge.py
#
# Subscribes to the wearable02 EEG firmware's batched MQTT stream
# (eeg/t7t8/raw, see iot_firmware/wearable02/wearable02.ino::publishBatch()),
# accumulates raw ADC samples into 25s/6250-sample blocks (BLOCK_SEC @
# SOURCE_FS, matching backend/psychological/realtime/pipeline.py), and
# POSTs them to this module's own Flask API (/calibrate then /predict) --
# same shape as backend/physiological/mqtt_bridge.py's MQTT-to-Flask
# bridge, adapted for EEG's block-based (not fixed-window) contract.
#
# Run from repo root:
#   python -m backend.psychological.mqtt_bridge
# ============================================================

import os
import sys
import time
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.mqtt_bridge import auth_headers, post_json
from backend.psychological.realtime.mqtt_client import RawSampleBuffer, make_client
from backend.psychological.realtime.resample import SOURCE_FS

BLOCK_SEC = 25.0
BLOCK_SAMPLES = int(BLOCK_SEC * SOURCE_FS)  # 6250 raw samples per block @ 250 SPS
N_CALIBRATION_BLOCKS = 3  # Relax-period blocks before live prediction starts

# This device's own broker/topic -- independent of the ring's MQTT_BROKER/
# MQTT_TOPIC in backend/common/config.py (different hardware, different
# topic: eeg/t7t8/raw vs the ring's mindpulse/wearable01/sensors).
EEG_MQTT_BROKER = os.environ.get("EEG_MQTT_BROKER", "172.28.6.169")
EEG_MQTT_PORT = int(os.environ.get("EEG_MQTT_PORT", "1883"))
EEG_MQTT_TOPIC = os.environ.get("EEG_MQTT_TOPIC", "eeg/t7t8/raw")

FLASK_URL = f"http://127.0.0.1:{os.environ.get('PSYCHOLOGICAL_PORT', '5001')}"
USER_ID = os.environ.get("EEG_BRIDGE_USER_ID", "Wehara")
SESSION_ID = os.environ.get(
    "EEG_SESSION_ID", "wearable02_" + time.strftime("%Y%m%dT%H%M%S")
)

AUTH_HEADERS = auth_headers(USER_ID)


def block_payload(samples) -> dict:
    return {
        "millis": [s.millis for s in samples],
        "ch1_code": [s.ch1_code for s in samples],
        "ch2_code": [s.ch2_code for s in samples],
    }


def run():
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
    client = make_client(EEG_MQTT_BROKER, EEG_MQTT_PORT, EEG_MQTT_TOPIC, buffer, client_id="eeg_bridge_wearable02")

    calibration_blocks = []
    calibrated = False
    block_idx = 0

    try:
        while True:
            if buffer.peek_count() < BLOCK_SAMPLES:
                time.sleep(0.5)
                continue

            samples = buffer.drain(BLOCK_SAMPLES)

            if not calibrated:
                calibration_blocks.append(block_payload(samples))
                print(f"[calibrate] captured block {len(calibration_blocks)}/{N_CALIBRATION_BLOCKS}")
                if len(calibration_blocks) >= N_CALIBRATION_BLOCKS:
                    data = post_json(
                        f"{FLASK_URL}/calibrate",
                        {"session_id": SESSION_ID, "blocks": calibration_blocks},
                        AUTH_HEADERS, timeout=30, label="calibrate",
                    )
                    calibrated = bool(data and data.get("success"))
                    if not calibrated:
                        print("[calibrate] failed -- retrying with a fresh set of blocks")
                        calibration_blocks = []
                continue

            data = post_json(
                f"{FLASK_URL}/predict",
                {"session_id": SESSION_ID, **block_payload(samples)},
                AUTH_HEADERS, timeout=30, label="predict",
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
