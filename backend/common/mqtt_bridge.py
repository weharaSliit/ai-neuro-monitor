# ============================================================
# mqtt_bridge.py -- shared scaffolding for the two wearable MQTT bridges
# (backend/physiological/mqtt_bridge.py, backend/psychological/mqtt_bridge.py).
#
# What's genuinely common between them lives here: minting an auth token
# for a local bridge script, wiring up a paho-mqtt client, and POSTing a
# window/block to Flask with consistent error handling. What's NOT here on
# purpose: payload parsing and buffering/windowing strategy. The ring
# accumulates fixed-TIME windows across three heterogeneous streams
# (ibi/gsr/acc) and posts once to /predict; the EEG wearable accumulates
# fixed-SAMPLE-COUNT blocks from one raw stream and runs a calibrate-then-
# predict state machine. Forcing those into one shared shape would obscure
# both rather than simplify either -- each bridge keeps its own on_message
# and windowing logic, built on top of the pieces below.
# ============================================================

import os
import sys
import tempfile
from pathlib import Path

import paho.mqtt.client as mqtt
import requests

from backend.common.auth import generate_token

# fcntl is POSIX-only (Mac/Linux) -- msvcrt is the Windows-native
# equivalent for the same advisory file lock, used interchangeably below.
if os.name == "nt":
    import msvcrt
else:
    import fcntl


def auth_headers(user_id: str) -> dict:
    """Mints a fresh Bearer token for user_id and returns the header dict
    every POST below needs. Local bridge scripts already run with direct
    Firebase service-account access -- no less trusted than a mobile
    client, so no interactive login is needed here."""
    token = generate_token(user_id)
    return {"Authorization": f"Bearer {token}"}


def _acquire_single_instance_lock(client_id: str):
    """Refuses to start a second bridge with the same client_id. Two
    processes both subscribed to the same MQTT topic silently double (or
    triple) every window POSTed to Flask/Firebase -- this turns that into
    a loud startup failure instead. The lock is tied to the open fd
    (flock on POSIX, msvcrt.locking on Windows), so it's released
    automatically if the process dies or is killed, no stale-pidfile
    cleanup needed. PID is written and flushed before locking on Windows
    specifically -- msvcrt.locking()'s byte range must not exceed the
    file's actual size, which is 0 right after opening in "w" mode."""
    lock_path = Path(tempfile.gettempdir()) / f"mindpulse_{client_id}.lock"
    fh = open(lock_path, "w")
    fh.write(str(os.getpid()))
    fh.flush()
    try:
        if os.name == "nt":
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print(f"[mqtt] another '{client_id}' bridge is already running "
              f"(lock held on {lock_path}) -- exiting instead of double-subscribing.")
        sys.exit(1)
    return fh


def connect_mqtt(broker: str, port: int, topic: str, on_message, client_id: str) -> mqtt.Client:
    """Connects, subscribes, and starts the network loop in a background
    thread. Caller owns calling .loop_stop()/.disconnect() on shutdown.
    Always CallbackAPIVersion.VERSION2 -- VERSION1 (paho-mqtt's implicit
    default) is deprecated and warns on every client creation."""
    # Held for the client's lifetime via the attribute below -- garbage
    # collecting the fd would release the flock.
    lock_fh = _acquire_single_instance_lock(client_id)

    def on_connect(client, userdata, flags, reason_code, properties=None):
        status = "connected" if reason_code == 0 else f"connect failed (reason_code={reason_code})"
        print(f"[mqtt] {status}, subscribing to {topic}")
        client.subscribe(topic)

    client = mqtt.Client(client_id=client_id, callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
    client._instance_lock_fh = lock_fh
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(broker, port, 60)
    client.loop_start()
    return client


def post_json(url: str, payload: dict, headers: dict, timeout: float, label: str):
    """POSTs payload, prints one status line, and returns the parsed JSON
    body on a 2xx response or None on any failure (network error or
    non-2xx) -- callers branch on None instead of each catching requests
    exceptions themselves."""
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
        data = resp.json()
        print(f"[{label}] {resp.status_code} {data}")
        return data if resp.ok else None
    except Exception as e:
        print(f"[{label}] request failed: {e}")
        return None
