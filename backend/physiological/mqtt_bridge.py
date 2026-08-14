# ============================================================
# mqtt_bridge.py
# Subscribes to Mosquitto, buffers ~60s of ESP32 sensor messages
# into a window, POSTs it to Flask's /predict, and writes a
# throttled device-online heartbeat straight to Firebase (so the
# mobile app's "device connected" status doesn't depend on a
# 60s-window prediction having happened yet).
#
# Run from backend/physiological/:
#   python mqtt_bridge.py
# (also runnable as a module from repo root:
#   python -m backend.physiological.mqtt_bridge)
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

from backend.physiological.firebase_service import (
    init_firebase, save_device_heartbeat
)

MQTT_BROKER = "192.168.8.100"
MQTT_PORT   = 1883
MQTT_TOPIC  = "mindpulse/wearable01/sensors"

FLASK_URL   = "http://192.168.8.100:5000/predict"
USER_ID     = "Wehara"
GSR_CAL     = 2872   # measured: electrodes off, raw analogRead(GSR_PIN)

WINDOW_SEC           = 60
HEARTBEAT_MIN_GAP_SEC = 5   # don't hammer Firebase at ~5 msgs/sec

init_firebase()

window_start = time.time()
window_idx   = 0
ibi_buf, gsr_buf, acc_buf = [], [], []
last_heartbeat_write = 0.0


def send_window():
    global window_idx, ibi_buf, gsr_buf, acc_buf, window_start

    duration = time.time() - window_start
    if duration <= 0:
        duration = WINDOW_SEC
    actual_fs = max(1, round(len(gsr_buf) / duration))

    if len(ibi_buf) < 4 or len(gsr_buf) < 20 or len(acc_buf) < 10:
        print(f"[Window {window_idx}] skipped — insufficient data "
              f"(ibi={len(ibi_buf)}, gsr={len(gsr_buf)}, acc={len(acc_buf)})")
    else:
        payload = {
            "user_id":         USER_ID,
            "session_id":      "live_session_1",
            "window_idx":      window_idx,
            "ibi_array":       ibi_buf,
            "gsr_adc_array":   gsr_buf,
            "acc_array":       acc_buf,
            "gsr_calibration": GSR_CAL,
            "actual_fs":       actual_fs
        }
        try:
            resp = requests.post(FLASK_URL, json=payload, timeout=10)
            print(f"[Window {window_idx}] fs={actual_fs}Hz -> "
                  f"{resp.status_code} {resp.json()}")
        except Exception as e:
            print(f"[Window {window_idx}] request failed: {e}")

    window_idx += 1
    ibi_buf, gsr_buf, acc_buf = [], [], []
    window_start = time.time()


def on_connect(client, userdata, flags, rc):
    print("Connected to MQTT broker" if rc == 0 else f"Connect failed rc={rc}")
    client.subscribe(MQTT_TOPIC)


def on_message(client, userdata, msg):
    global ibi_buf, gsr_buf, acc_buf, window_start, last_heartbeat_write

    try:
        data = json.loads(msg.payload.decode())
    except Exception:
        return

    device_id = data.get("device_id", "wearable01")

    # Throttled heartbeat — proves the device is alive right now,
    # independent of whether a full 60s window has completed yet.
    now = time.time()
    if now - last_heartbeat_write >= HEARTBEAT_MIN_GAP_SEC:
        save_device_heartbeat(device_id, extra={
            'finger_detected': bool(data.get('finger', False))
        })
        last_heartbeat_write = now

    ibi_buf.extend(data.get("ibi", []))
    gsr_buf.append(data.get("gsr", 0))

    ax = data.get("acc_x", 0)
    ay = data.get("acc_y", 0)
    az = data.get("acc_z", 0)
    magnitude = math.sqrt(ax * ax + ay * ay + az * az)
    acc_buf.append(magnitude / 9.81)

    if time.time() - window_start >= WINDOW_SEC:
        send_window()


client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

print("Starting MQTT -> Flask bridge...")
client.connect(MQTT_BROKER, MQTT_PORT, 60)
client.loop_forever()
