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

import csv
import math
import json
import os
import sys
import time
from pathlib import Path

# Forces line buffering regardless of `python -u`/PYTHONUNBUFFERED being set
# on whatever deploys this -- see backend/psychological/mqtt_bridge.py's
# identical line for why (stdout block-buffers by default off a real
# terminal, which can make a live process look silent/dead in a log viewer).
sys.stdout.reconfigure(line_buffering=True)

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.physiological.firebase_service import (
    init_firebase, save_device_heartbeat, baseline_exists
)
from backend.common.mqtt_bridge import auth_headers, connect_mqtt, post_json
from backend.common.config import (
    MQTT_BROKER, MQTT_PORT, MQTT_TOPIC, MQTT_USER, MQTT_PASSWORD, MQTT_CA_CERT,
    GSR_CAL, WINDOW_SEC, SETTLE_SEC
)
from backend.common.firebase_config import (
    CURRENT_SESSION_ID_FIELD, CURRENT_USER_ID_FIELD, FUSION_EN_ROOT
)

# Flask's host/port is independent of MQTT_BROKER (the ring's broker address
# can be anywhere; this script and Flask needn't be co-located at all once
# both run on Render) -- was hardcoded as f"http://{MQTT_BROKER}:5000/predict",
# which silently broke when Flask moved off port 5000 (macOS ControlCenter/
# AirPlay Receiver claims that port by default) to 5050.
#
# PHYSIOLOGICAL_FLASK_URL is a full-URL override for a deployed target
# (e.g. Render's public HTTPS URL, which has no explicit port) -- takes
# precedence over PHYSIOLOGICAL_FLASK_HOST/PHYSIOLOGICAL_PORT's
# http://host:port construction, which stays the default for local dev
# where this script and Flask are co-located.
FLASK_HOST = os.environ.get("PHYSIOLOGICAL_FLASK_HOST", "127.0.0.1")
FLASK_PORT = os.environ.get("PHYSIOLOGICAL_PORT", "5050")
# No "Wehara" fallback -- attributing data to a specific person by default
# is wrong once a teammate runs this same bridge for their own ring.
# USER_ID starts unset and stays that way until either RING_USER_ID is
# explicitly set (manual override/pin, same idea as RING_SESSION_ID) or
# the app-driven current_user_id pointer resolves a real logged-in user
# (see the polling loop below) -- send_window() skips posting entirely
# while USER_ID is None rather than guessing.
FLASK_URL  = os.environ.get("PHYSIOLOGICAL_FLASK_URL") or f"http://{FLASK_HOST}:{FLASK_PORT}/predict"
USER_ID    = os.environ.get("RING_USER_ID") or None

AUTH_HEADERS = auth_headers(USER_ID) if USER_ID else None

HEARTBEAT_MIN_GAP_SEC = 5   # don't hammer Firebase at ~5 msgs/sec
POINTER_POLL_INTERVAL_SEC = 10  # how often to check for a new app-driven session

# Sliding window: still analyzes a full WINDOW_SEC (60s) span each time --
# HRV feature quality is unchanged -- but re-emits a prediction every
# SLIDE_INTERVAL_SEC instead of waiting a full fresh WINDOW_SEC between
# predictions. Two real benefits over the old tumbling (reset-to-empty)
# window: the live chart gets a new point every ~20s instead of ~60-70s,
# and a window is no longer all-or-nothing against a contact dropout --
# recovery only needs SLIDE_INTERVAL_SEC of renewed good contact within
# the trailing 60s, not a whole fresh cycle.
SLIDE_INTERVAL_SEC = 20

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

# Optional local-only raw sample log -- OFF by default (RAW_LOG_PATH is
# None, _raw_writer stays None, log_raw_sample() below is then a no-op).
# Set RING_RAW_LOG_PATH to a local file path (only makes sense running
# this bridge locally, not the deployed always-on Render instance, which
# has no persistent/downloadable filesystem) to additionally write one
# row per incoming MQTT message -- raw ir (PPG-ish), raw gsr ADC, raw
# acc_x/y/z, and any IBI beats detected in that message -- for building a
# WESAD-style raw multi-panel plot from this ring's own data. Deliberately
# a LOCAL FILE ONLY: raw sensor samples are never written to Firebase
# anywhere in this pipeline (only the derived per-window features are --
# see extract_features.py's module docstring), and this doesn't change
# that; it's a separate, opt-in, local-machine-only capture path.
RAW_LOG_PATH = os.environ.get("RING_RAW_LOG_PATH") or None
RAW_LOG_FIELDS = ['timestamp', 'ir', 'gsr_adc', 'acc_x', 'acc_y', 'acc_z', 'ibi_beats']
_raw_log_file = open(RAW_LOG_PATH, 'w', newline='') if RAW_LOG_PATH else None
_raw_writer = csv.DictWriter(_raw_log_file, fieldnames=RAW_LOG_FIELDS) if _raw_log_file else None
if _raw_writer:
    _raw_writer.writeheader()
    _raw_log_file.flush()
    print(f"[raw-log] Logging raw samples locally to {RAW_LOG_PATH} (never sent to Firebase)")


def log_raw_sample(data: dict, now: float) -> None:
    if not _raw_writer:
        return
    _raw_writer.writerow({
        'timestamp': f'{now:.3f}',
        'ir': data.get('ir', ''),
        'gsr_adc': data.get('gsr', ''),
        'acc_x': data.get('acc_x', ''),
        'acc_y': data.get('acc_y', ''),
        'acc_z': data.get('acc_z', ''),
        # A message can carry zero or several beats detected since the
        # last publish (PUBLISH_INTERVAL=200ms on the firmware) -- joined
        # so this stays one row per message, matching gsr_adc/acc's own
        # one-value-per-message rate; a plotting script can explode this
        # back out with its own timestamps if it wants individual beats.
        'ibi_beats': ';'.join(str(b) for b in data.get('ibi', [])),
    })
    _raw_log_file.flush()


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

window_idx   = 0
# Each buffer holds (timestamp, value) pairs so send_window() can trim off
# anything older than WINDOW_SEC instead of wiping the buffer wholesale --
# that's the entire difference between this and the old tumbling window.
ibi_buf, gsr_buf, acc_buf = [], [], []
last_heartbeat_write = 0.0
last_window_emit = 0.0


def send_window():
    global window_idx, ibi_buf, gsr_buf, acc_buf

    now = time.time()
    cutoff = now - WINDOW_SEC
    ibi_buf[:] = [(t, v) for t, v in ibi_buf if t >= cutoff]
    gsr_buf[:] = [(t, v) for t, v in gsr_buf if t >= cutoff]
    acc_buf[:] = [(t, v) for t, v in acc_buf if t >= cutoff]

    # Actual span covered by what's left after trimming -- ramps up from 0
    # toward WINDOW_SEC as history accumulates, rather than assuming a full
    # 60s is already there (matters for the first ~60s after startup/a
    # contact dropout, when the buffer is still filling back up).
    duration = (now - gsr_buf[0][0]) if gsr_buf else WINDOW_SEC
    if duration <= 0:
        duration = WINDOW_SEC
    actual_fs = max(1, round(len(gsr_buf) / duration))

    if USER_ID is None:
        print(f"[Window {window_idx}] skipped — no user logged in yet "
              f"(waiting for the app's current_user_id pointer)")
    elif not baseline_exists(USER_ID):
        # Never posted to /predict at all pre-calibration -- app.py's
        # predict_raw() fallback (used when load_baseline() returns None)
        # is a real, working prediction, just not personalized, and
        # showing/storing it as if it were a normal reading is misleading
        # for a brand-new user. Re-enabled 2026-08-30 after confirming
        # (with this gate briefly disabled) that the live MQTT->/predict->
        # Firebase pipeline itself is healthy -- the earlier diagnostic
        # gap was calibration_capture.py's connection handling, since
        # fixed (fresh-per-call MQTT connection, no more shared/cached
        # client).
        print(f"[Window {window_idx}] skipped — {USER_ID} has no baseline yet "
              f"(calibrate first; predict_raw() fallback not used here)")
    elif len(ibi_buf) < 10 or len(gsr_buf) < 20 or len(acc_buf) < 10:
        print(f"[Window {window_idx}] skipped — insufficient data "
              f"(ibi={len(ibi_buf)}, gsr={len(gsr_buf)}, acc={len(acc_buf)})")
    else:
        payload = {
            "user_id":         USER_ID,
            "session_id":      SESSION_ID,
            "window_idx":      window_idx,
            "ibi_array":       [v for _, v in ibi_buf],
            "gsr_adc_array":   [v for _, v in gsr_buf],
            "acc_array":       [v for _, v in acc_buf],
            "gsr_calibration": GSR_CAL,
            "actual_fs":       actual_fs
        }
        # 45s, not 10s -- Render's free-tier Flask service can take 30s+ to
        # wake from a cold start after ~15min idle; a short timeout here
        # silently drops the window (and its prediction) every time that
        # happens instead of just waiting it out.
        post_json(FLASK_URL, payload, AUTH_HEADERS, timeout=45, label=f"Window {window_idx}")

    # No buffer reset here -- that's what makes this a sliding window
    # instead of a tumbling one. The next send_window() call trims from
    # this same retained history rather than starting over from empty.
    window_idx += 1


def on_message(client, userdata, msg):
    global ibi_buf, gsr_buf, acc_buf, last_heartbeat_write, last_window_emit

    try:
        data = json.loads(msg.payload.decode())
    except Exception:
        return

    device_id = data.get("device_id", "wearable01")
    now = time.time()
    log_raw_sample(data, now)

    # Throttled heartbeat — proves the device is alive right now,
    # independent of whether a window has been emitted yet.
    if now - last_heartbeat_write >= HEARTBEAT_MIN_GAP_SEC:
        save_device_heartbeat(device_id, extra={
            'finger_detected': bool(data.get('finger', False))
        })
        last_heartbeat_write = now

    # IBI entries aren't individually timestamped by the device -- this
    # message's arrival time is accurate enough for a 60s trim window
    # (published every ~200ms, so at most that much error per beat).
    for beat in data.get("ibi", []):
        ibi_buf.append((now, beat))
    gsr_buf.append((now, data.get("gsr", 0)))

    ax = data.get("acc_x", 0)
    ay = data.get("acc_y", 0)
    az = data.get("acc_z", 0)
    magnitude = math.sqrt(ax * ax + ay * ay + az * az)
    acc_buf.append((now, magnitude / 9.81))

    if now - last_window_emit >= SLIDE_INTERVAL_SEC:
        send_window()
        last_window_emit = now


print("Starting MQTT -> Flask bridge...")
# Already connected + looping -- see backend/common/mqtt_bridge.py::connect_mqtt().
client = connect_mqtt(MQTT_BROKER, MQTT_PORT, MQTT_TOPIC, on_message, client_id="physio_bridge_wearable01",
                       username=MQTT_USER, password=MQTT_PASSWORD, ca_cert=MQTT_CA_CERT)

print(f"Letting the sensor settle for {SETTLE_SEC}s before the first "
      f"window starts (electrode contact needs a moment to stabilize)...")
time.sleep(SETTLE_SEC)

# Discard whatever accumulated during settling and start window 0 fresh.
ibi_buf, gsr_buf, acc_buf = [], [], []
window_idx   = 0
last_window_emit = time.time()
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
