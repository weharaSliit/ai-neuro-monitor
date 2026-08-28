# ============================================================
# eeg_calibration_capture.py
#
# On-demand EEG calibration capture -- mirrors
# backend/physiological/calibration_capture.py's run_calibration_capture()
# shape exactly (settle, discard, capture, save), but pulling raw EEG
# samples over its own short-lived MQTT connection instead of ring HRV/GSR
# windows. Driven by backend/psychological/app.py's POST /calibrate/start,
# run in a background thread, polled via GET /calibrate/status.
#
# Opens its OWN mqtt.Client() directly, NOT
# backend.common.mqtt_bridge.connect_mqtt() -- that helper's
# _acquire_single_instance_lock() is keyed by client_id and would refuse a
# second same-id connection; mqtt_bridge.py's own long-running bridge
# already permanently holds a lock under "eeg_bridge_wearable02" as the
# standalone worker. A bare paho Client() with a unique per-call client_id
# side-steps that lock file entirely -- the same choice
# backend/physiological/calibration_capture.py already made for the
# identical reason.
# ============================================================

import threading
import time

import paho.mqtt.client as mqtt

from backend.psychological.calibration_service import (
    CalibrationFailedError, run_eeg_calibration_from_blocks,
)
from backend.psychological.mqtt_bridge import (
    BLOCK_SAMPLES, EEG_MQTT_BROKER, EEG_MQTT_CA_CERT, EEG_MQTT_PASSWORD,
    EEG_MQTT_PORT, EEG_MQTT_TOPIC, EEG_MQTT_USER, N_CALIBRATION_BLOCKS,
)
from backend.psychological.realtime.mqtt_client import parse_payload

# Electrode contact settles faster than the ring's GSR strap (whose own
# SETTLE_SEC is 30) -- 10s is enough for the amplifier/contact to stabilize
# once the headband is first put on, before the real capture starts.
EEG_SETTLE_SEC = 10


def run_eeg_calibration_capture(user_id, session_id, on_progress=None):
    """Blocking: connects to the EEG MQTT topic, settles (discarding
    whatever buffers during that time), captures N_CALIBRATION_BLOCKS raw
    blocks of BLOCK_SAMPLES each, then calls run_eeg_calibration_from_blocks()
    to save them exactly like a normal /calibrate HTTP call would.

    on_progress(status, extra) is called at:
      'settling'    extra={}
      'capturing'   extra={'block_idx', 'n_blocks'}   (once per completed block)
      'saving'      extra={}
      'done'        extra={'outcome', 'firebase_enabled', 'session_state'}
      'error'       extra={'message'}

    Blocks until done/error -- callers that need this non-blocking (the
    in-app trigger) run it in a background thread, same as
    run_calibration_capture()'s docstring.
    """
    def _notify(status, **extra):
        if on_progress:
            on_progress(status, extra)

    buf = []
    lock = threading.Lock()

    def on_connect(client, userdata, flags, rc):
        client.subscribe(EEG_MQTT_TOPIC)

    def on_message(client, userdata, msg):
        samples = parse_payload(msg.payload.decode('utf-8', errors='replace'))
        if not samples:
            return
        with lock:
            buf.extend(samples)

    def buffered_count():
        with lock:
            return len(buf)

    def drain(n):
        with lock:
            taken = buf[:n]
            del buf[:n]
            return taken

    client_id = f"eeg_calib_{user_id}_{int(time.time())}"
    client = mqtt.Client(client_id=client_id)
    client.on_connect = on_connect
    client.on_message = on_message
    if EEG_MQTT_CA_CERT:
        client.tls_set(ca_certs=EEG_MQTT_CA_CERT)
    if EEG_MQTT_USER:
        client.username_pw_set(EEG_MQTT_USER, EEG_MQTT_PASSWORD)
    try:
        client.connect(EEG_MQTT_BROKER, EEG_MQTT_PORT, 60)
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None
    client.loop_start()

    _notify('settling')
    time.sleep(EEG_SETTLE_SEC)

    # Discard whatever accumulated during settling and start the real
    # capture fresh from here.
    with lock:
        buf.clear()

    blocks_samples = []
    while len(blocks_samples) < N_CALIBRATION_BLOCKS:
        if buffered_count() < BLOCK_SAMPLES:
            time.sleep(0.5)
            continue
        blocks_samples.append(drain(BLOCK_SAMPLES))
        _notify('capturing', block_idx=len(blocks_samples), n_blocks=N_CALIBRATION_BLOCKS)

    client.loop_stop()
    client.disconnect()

    _notify('saving')
    try:
        result = run_eeg_calibration_from_blocks(user_id, session_id, blocks_samples)
    except CalibrationFailedError as e:
        _notify('error', message=str(e))
        return None
    except Exception as e:
        _notify('error', message=str(e))
        return None

    _notify('done', **result)
    return result
