# ============================================================
# mqtt_bridge.py
#
# Subscribes to the wearable02 EEG firmware's batched MQTT stream
# (mindpulse/wearable02/sensors, see
# iot_firmware/wearable02/wearable02.ino::publishBatch()), accumulates raw
# ADC samples into 25s/6250-sample blocks (BLOCK_SEC @
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

import requests

# Python block-buffers stdout by default whenever it isn't attached to a
# real terminal -- exactly the case for a Render worker's log collector.
# Without this, every print() below can sit invisible for a long time
# (looking identical to "nothing is happening") even while the process is
# actually running fine, until the buffer happens to fill. Forcing line
# buffering here makes logs show up immediately regardless of whether
# whoever deploys this remembers `python -u` / PYTHONUNBUFFERED=1.
sys.stdout.reconfigure(line_buffering=True)

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.firebase_config import (
    CURRENT_SESSION_ID_FIELD, CURRENT_USER_ID_FIELD, FIREBASE_DB_URL, RTDB_NAMESPACES
)
from backend.common.mqtt_bridge import auth_headers, post_json
from backend.psychological.realtime.mqtt_client import RawSampleBuffer, make_client
from backend.psychological.realtime.resample import SOURCE_FS

BLOCK_SEC = 25.0
BLOCK_SAMPLES = int(BLOCK_SEC * SOURCE_FS)  # 6250 raw samples per block @ 250 SPS
N_CALIBRATION_BLOCKS = 3  # Relax-period blocks before live prediction starts

# Raw-preview push to /live_raw, independent of the 25s block cycle above --
# gives the dashboard waveform a genuinely live feel (updates ~1x/sec) instead
# of only refreshing once per 25s block. LIVE_RAW_SAMPLES is deliberately
# small (~1s of data): enough for a smooth-looking sparkline update, far
# short of a full inference block.
LIVE_RAW_SAMPLES = 250  # ~1s @ 250 SPS
LIVE_RAW_INTERVAL_SEC = 1.0
EMPTY_BUFFER_WARN_INTERVAL_SEC = 5.0

# This device's own broker/topic -- independent of the ring's MQTT_BROKER/
# MQTT_TOPIC in backend/common/config.py (different hardware, different
# topic: mindpulse/wearable02/sensors vs the ring's mindpulse/wearable01/sensors).
# Same EMQX Cloud Serverless deployment (mindpulse-broker) as the ring,
# just a different device credential -- see wearable02.ino's identical
# MQTT_BROKER/MQTT_USER/MQTT_PASS.
EEG_MQTT_BROKER = os.environ.get("EEG_MQTT_BROKER", "ob1f0f10.ala.asia-southeast1.emqxsl.com")
EEG_MQTT_PORT = int(os.environ.get("EEG_MQTT_PORT", "8883"))
EEG_MQTT_TOPIC = os.environ.get("EEG_MQTT_TOPIC", "mindpulse/wearable02/sensors")
EEG_MQTT_USER = os.environ.get("EEG_MQTT_USER", "wearable02")
EEG_MQTT_PASSWORD = os.environ.get("EEG_MQTT_PASSWORD", "wearable02")
EEG_MQTT_CA_CERT = os.path.join(
    Path(__file__).resolve().parents[2], "iot_firmware", "emqxsl-ca.crt"
)

# PSYCHOLOGICAL_FLASK_URL is a full-URL override for a deployed target
# (e.g. Render's public HTTPS URL, no explicit port) -- see
# backend/physiological/mqtt_bridge.py's identical PHYSIOLOGICAL_FLASK_URL
# comment. Takes precedence over the localhost:port construction, which
# stays the default for local dev where this script and Flask are
# co-located.
FLASK_URL = os.environ.get("PSYCHOLOGICAL_FLASK_URL") or \
    f"http://127.0.0.1:{os.environ.get('PSYCHOLOGICAL_PORT', '5001')}"
# No "Wehara" fallback -- see backend/physiological/mqtt_bridge.py's
# identical USER_ID comment. Unset until EEG_BRIDGE_USER_ID is explicitly
# pinned or the app-driven current_user_id pointer resolves a real user
# (see _poll_user_pointer() and run()'s main loop below); calibration and
# predict posting are both skipped while USER_ID is None.
USER_ID = os.environ.get("EEG_BRIDGE_USER_ID") or None
# Mutable, not a one-time-read constant: StressApp (App.js) is the actual
# authority on the current session_id now, written to
# {psychological}/current_session_id when the app opens/reuses a session --
# this process polls that field (see run()'s main loop,
# POINTER_POLL_INTERVAL_SEC) and rotates onto whatever it says, since a
# long-running MQTT bridge process has no other way to learn a new app
# session started. Lives inside the psychological/ root itself (this
# bridge's own namespace), not a separate shared "pointer" store -- see
# backend/common/firebase_config.py's CURRENT_SESSION_ID_FIELD docstring.
# EEG_SESSION_ID (if set) is a manual override/fallback for standalone
# debugging without the app -- the field still wins once it's ever set to
# something different. `or`, not .get(key, default): see
# backend/physiological/mqtt_bridge.py's identical SESSION_ID line for why
# an empty (but present) env var must also fall through to the default.
SESSION_ID = os.environ.get("EEG_SESSION_ID") or "wearable02_" + time.strftime("%Y%m%dT%H%M%S")
POINTER_POLL_INTERVAL_SEC = 10.0

AUTH_HEADERS = auth_headers(USER_ID) if USER_ID else None


def _poll_session_pointer() -> str | None:
    """GET {psychological}/current_session_id -- plain REST, not
    firebase_admin: this bridge has no firebase_admin dependency anywhere
    else in its import graph (it only ever talks to its own Flask API via
    requests), so REST keeps that true instead of adding a new, heavier
    dependency just for this one read."""
    try:
        resp = requests.get(
            f"{FIREBASE_DB_URL}{RTDB_NAMESPACES['psychological']}/{CURRENT_SESSION_ID_FIELD}.json", timeout=5
        )
        value = resp.json()
        return value if isinstance(value, str) and value else None
    except Exception:
        return None


def _poll_user_pointer() -> str | None:
    """REST equivalent of _poll_session_pointer(), for current_user_id --
    lets this bridge attribute EEG data to whoever is actually logged into
    the app right now, same as backend/physiological/mqtt_bridge.py."""
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
        "ch1_code": [s.ch1_code for s in samples],
        "ch2_code": [s.ch2_code for s in samples],
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
            headers=AUTH_HEADERS, timeout=5,
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
    client = make_client(EEG_MQTT_BROKER, EEG_MQTT_PORT, EEG_MQTT_TOPIC, buffer, client_id="eeg_bridge_wearable02",
                          username=EEG_MQTT_USER, password=EEG_MQTT_PASSWORD, ca_cert=EEG_MQTT_CA_CERT)

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
