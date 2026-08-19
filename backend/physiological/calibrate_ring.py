# ============================================================
# calibrate_ring.py
# One-off script: collects N_BASELINE_WIN (3) windows of real
# resting sensor data over MQTT and sends them to /calibrate
# to establish a personal baseline for the real user (Wehara).
#
# Run once before mqtt_bridge.py, ring worn, sitting still,
# from backend/physiological/:
#   python calibrate_ring.py
# Takes ~N_BASELINE_WIN * WINDOW_SEC (3 * 60s = 3 minutes).
# Re-run any time to recalibrate — later runs EMA-merge into the
# existing baseline rather than overwrite it outright (same
# behavior /calibrate already has).
# ============================================================

import json
import math
import sys
import time
from pathlib import Path

import requests
import paho.mqtt.client as mqtt

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.config import N_BASELINE_WIN

MQTT_BROKER = "10.76.255.56"
MQTT_PORT   = 1883
MQTT_TOPIC  = "mindpulse/wearable01/sensors"

FLASK_URL   = "http://10.76.255.56:5000/calibrate"
USER_ID     = "Wehara"
GSR_CAL     = 2872   # keep in sync with mqtt_bridge.py

WINDOW_SEC = 60
N_WINDOWS  = N_BASELINE_WIN  # 3
SETTLE_SEC = 30  # discard this many seconds of data before capturing —
                 # GSR electrode straps take a bit to reach steady skin
                 # contact, and capturing that transient into the
                 # baseline skews it (observed directly during testing)

collected_windows = []
window_start = time.time()
ibi_buf, gsr_buf, acc_buf = [], [], []


def close_window():
    global ibi_buf, gsr_buf, acc_buf, window_start

    duration = time.time() - window_start
    if duration <= 0:
        duration = WINDOW_SEC
    actual_fs = max(1, round(len(gsr_buf) / duration))

    if len(ibi_buf) < 10 or len(gsr_buf) < 20 or len(acc_buf) < 10:
        print(f"  Window skipped — insufficient data "
              f"(ibi={len(ibi_buf)}, gsr={len(gsr_buf)}, acc={len(acc_buf)}). "
              f"Stay still, keep your finger steady on the sensor.")
    else:
        collected_windows.append({
            "ibi_array":       ibi_buf,
            "gsr_adc_array":   gsr_buf,
            "acc_array":       acc_buf,
            "gsr_calibration": GSR_CAL,
            "actual_fs":       actual_fs
        })
        print(f"  Window {len(collected_windows)}/{N_WINDOWS} captured (fs={actual_fs}Hz)")

    ibi_buf, gsr_buf, acc_buf = [], [], []
    window_start = time.time()


def on_connect(client, userdata, flags, rc):
    print("Connected to MQTT broker" if rc == 0 else f"Connect failed rc={rc}")
    client.subscribe(MQTT_TOPIC)


def on_message(client, userdata, msg):
    global window_start
    try:
        data = json.loads(msg.payload.decode())
    except Exception:
        return

    ibi_buf.extend(data.get("ibi", []))
    gsr_buf.append(data.get("gsr", 0))

    ax = data.get("acc_x", 0)
    ay = data.get("acc_y", 0)
    az = data.get("acc_z", 0)
    acc_buf.append(math.sqrt(ax * ax + ay * ay + az * az) / 9.81)

    if time.time() - window_start >= WINDOW_SEC:
        close_window()
        if len(collected_windows) >= N_WINDOWS:
            client.disconnect()


print(f"Calibration: sit comfortably and relax for ~{N_WINDOWS * WINDOW_SEC // 60} minute(s) "
      f"(plus a {SETTLE_SEC}s settling period first).")
print("Keep your finger steady on the MAX30102, don't talk or move.")
print("Starting MQTT calibration listener...\n")

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message
client.connect(MQTT_BROKER, MQTT_PORT, 60)
client.loop_start()

print(f"Letting the sensor settle for {SETTLE_SEC}s before capturing "
      f"(electrode contact needs a moment to stabilize)...")
time.sleep(SETTLE_SEC)

# Discard whatever accumulated during settling and start the real
# capture window fresh from here.
ibi_buf, gsr_buf, acc_buf = [], [], []
window_start = time.time()
print("Settling done — capturing baseline now.\n")

while len(collected_windows) < N_WINDOWS:
    time.sleep(1)

client.loop_stop()

print(f"\nCollected {len(collected_windows)} windows. Sending to {FLASK_URL}...")
resp = requests.post(
    FLASK_URL,
    json={"user_id": USER_ID, "windows": collected_windows},
    timeout=30
)
print(f"Response: {resp.status_code} {resp.json()}")
