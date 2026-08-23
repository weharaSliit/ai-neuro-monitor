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

import math
import json
import os
import sys
import time
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.physiological.firebase_service import (
    init_firebase, save_device_heartbeat
)
from backend.common.mqtt_bridge import auth_headers, connect_mqtt, post_json
from backend.common.config import (
    MQTT_BROKER, MQTT_PORT, MQTT_TOPIC, GSR_CAL,
    WINDOW_SEC, SETTLE_SEC
)
from backend.common.firebase_config import (
    CURRENT_SESSION_ID_FIELD, CURRENT_USER_ID_FIELD, FUSION_EN_ROOT
)

# Flask's host/port is independent of MQTT_BROKER (the ring's broker address
# can be anywhere; this script and Flask are co-located on this machine) --
# was hardcoded as f"http://{MQTT_BROKER}:5000/predict", which silently
# broke when Flask moved off port 5000 (macOS ControlCenter/AirPlay
# Receiver claims that port by default) to 5050. PHYSIOLOGICAL_PORT lets it
# track app.py's actual port without another hardcoded literal.
FLASK_HOST = os.environ.get("PHYSIOLOGICAL_FLASK_HOST", "127.0.0.1")
FLASK_PORT = os.environ.get("PHYSIOLOGICAL_PORT", "5050")
# No "Wehara" fallback -- attributing data to a specific person by default
# is wrong once a teammate runs this same bridge for their own ring.
# USER_ID starts unset and stays that way until either RING_USER_ID is
# explicitly set (manual override/pin, same idea as RING_SESSION_ID) or
# the app-driven current_user_id pointer resolves a real logged-in user
# (see the polling loop below) -- send_window() skips posting entirely
# while USER_ID is None rather than guessing.
FLASK_URL  = f"http://{FLASK_HOST}:{FLASK_PORT}/predict"
USER_ID    = os.environ.get("RING_USER_ID") or None

AUTH_HEADERS = auth_headers(USER_ID) if USER_ID else None

HEARTBEAT_MIN_GAP_SEC = 5   # don't hammer Firebase at ~5 msgs/sec
POINTER_POLL_INTERVAL_SEC = 10  # how often to check for a new app-driven session

# StressApp (App.js) is the authority on the current session_id -- written
# to {FUSION_EN_ROOT}/current_session_id when the app opens/reuses a
# session, polled here (see the bottom while-loop) since this is a
# long-running process with no other way to learn a new app session
# started. Lives inside fusion_en/ itself (a root this bridge already
# writes to via save_fusion_en_rtdb()), not a separate shared "pointer"
# store -- see backend/common/firebase_config.py's
# CURRENT_SESSION_ID_FIELD docstring. This was a bare "live_session_1"
# string literal directly in send_window()'s payload before; no
# calibration/baseline state needs resetting on rotation here (the ring's
# personal baseline is per-user, not per-session, see
# firebase_service.py's load_baseline()) -- rotation just means stamping
# the new id on outgoing windows from here on.
# `or`, not .get(key, default) -- start_all.sh passes RING_SESSION_ID="" (an
# empty, PRESENT string) when it wants this bridge to follow the app-driven
# pointer instead of a manual pin; .get()'s default only kicks in when the
# key is ABSENT, not empty, so it would silently accept "" as a real session
# id without this.
SESSION_ID = os.environ.get("RING_SESSION_ID") or "wearable01_" + time.strftime("%Y%m%dT%H%M%S")


def _poll_session_pointer():
    """GET {FUSION_EN_ROOT}/current_session_id via the already-initialized
    firebase_admin app (this process calls init_firebase() at import time
    for firebase_service.py already) rather than adding a second, redundant
    REST-based path."""
    from firebase_admin import db
    try:
        value = db.reference(f"{FUSION_EN_ROOT}/{CURRENT_SESSION_ID_FIELD}").get()
        return value if isinstance(value, str) and value else None
    except Exception:
        return None


def _poll_user_pointer():
    """Same app-driven-pointer pattern as _poll_session_pointer(), but for
    current_user_id -- lets this bridge attribute incoming ring data to
    whoever is actually logged into the app right now, instead of the
    RING_USER_ID set once at this process's own launch time."""
    from firebase_admin import db
    try:
        value = db.reference(f"{FUSION_EN_ROOT}/{CURRENT_USER_ID_FIELD}").get()
        return value if isinstance(value, str) and value else None
    except Exception:
        return None
# SETTLE_SEC discards this many seconds of data right after startup —
# GSR electrode straps take a bit to reach steady skin contact, and
# capturing that transient into the first live window skews it (same
# reasoning as calibration_capture.py's settle period).

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

    if USER_ID is None:
        print(f"[Window {window_idx}] skipped — no user logged in yet "
              f"(waiting for the app's current_user_id pointer)")
    elif len(ibi_buf) < 10 or len(gsr_buf) < 20 or len(acc_buf) < 10:
        print(f"[Window {window_idx}] skipped — insufficient data "
              f"(ibi={len(ibi_buf)}, gsr={len(gsr_buf)}, acc={len(acc_buf)})")
    else:
        payload = {
            "user_id":         USER_ID,
            "session_id":      SESSION_ID,
            "window_idx":      window_idx,
            "ibi_array":       ibi_buf,
            "gsr_adc_array":   gsr_buf,
            "acc_array":       acc_buf,
            "gsr_calibration": GSR_CAL,
            "actual_fs":       actual_fs
        }
        post_json(FLASK_URL, payload, AUTH_HEADERS, timeout=10, label=f"Window {window_idx}")

    window_idx += 1
    ibi_buf, gsr_buf, acc_buf = [], [], []
    window_start = time.time()


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


print("Starting MQTT -> Flask bridge...")
# Already connected + looping -- see backend/common/mqtt_bridge.py::connect_mqtt().
client = connect_mqtt(MQTT_BROKER, MQTT_PORT, MQTT_TOPIC, on_message, client_id="physio_bridge_wearable01")

print(f"Letting the sensor settle for {SETTLE_SEC}s before the first "
      f"window starts (electrode contact needs a moment to stabilize)...")
time.sleep(SETTLE_SEC)

# Discard whatever accumulated during settling and start window 0 fresh.
ibi_buf, gsr_buf, acc_buf = [], [], []
window_start = time.time()
window_idx   = 0
print("Settling done — live predictions starting now.\n")

try:
    last_pointer_poll = 0.0
    while True:
        time.sleep(1)
        now = time.time()
        if now - last_pointer_poll >= POINTER_POLL_INTERVAL_SEC:
            pointer_session_id = _poll_session_pointer()
            if pointer_session_id and pointer_session_id != SESSION_ID:
                print(f"[session] rotating {SESSION_ID!r} -> {pointer_session_id!r} "
                      f"(app started a new session)")
                SESSION_ID = pointer_session_id

            pointer_user_id = _poll_user_pointer()
            if pointer_user_id and pointer_user_id != USER_ID:
                print(f"[user] rotating {USER_ID!r} -> {pointer_user_id!r} "
                      f"(app is now logged in as a different user)")
                USER_ID = pointer_user_id
                AUTH_HEADERS = auth_headers(USER_ID)

            last_pointer_poll = now
except KeyboardInterrupt:
    print("\nStopping bridge...")
    client.loop_stop()
    client.disconnect()
