# ============================================================
# calibration_capture.py
# Shared calibration logic used by TWO callers:
#   1. calibrate_ring.py — CLI script, run_calibration_capture()
#      directly, blocking, prints progress.
#   2. app.py's POST /calibrate/start — runs run_calibration_capture()
#      in a background thread, polled via GET /calibrate/status
#      (the live in-app calibration trigger).
#
# Both need the identical MQTT settle+N_BASELINE_WIN-window capture
# logic — previously only existed inline in calibrate_ring.py, which
# would have meant duplicating it (and its various edge-case fixes:
# settling period, min-sample thresholds) a second time for the
# in-app trigger. Kept here once instead.
# ============================================================

import json
import math
import time

import numpy as np
import paho.mqtt.client as mqtt

from backend.common.config import (
    MQTT_BROKER, MQTT_PORT, MQTT_TOPIC, GSR_CAL,
    WINDOW_SEC, SETTLE_SEC, N_BASELINE_WIN
)
from backend.physiological.extract_features import extract_features
from backend.physiological.predictor import (
    compute_baseline, update_baseline_ema, feature_cols
)
from backend.physiological.firebase_service import (
    save_baseline, load_baseline, baseline_exists
)


def save_calibration_windows(user_id, raw_windows):
    """Extract features from each raw window, compute/EMA-merge/save the
    personal baseline. Shared by app.py's /calibrate route (HTTP) and
    run_calibration_capture() below (in-process, no HTTP round-trip).

    Raises ValueError on bad input (empty windows list, a
    motion-contaminated window) — callers translate that to whatever
    their own error-reporting mechanism is (HTTP 400 vs on_progress).
    """
    if len(raw_windows) == 0:
        raise ValueError('No windows provided')

    feature_rows = []
    for i, w in enumerate(raw_windows):
        features_2d, motion_rejected, feat_dict = extract_features(
            w.get('ibi_array', []),
            w.get('gsr_adc_array', []),
            w.get('acc_array', []),
            w.get('gsr_calibration', GSR_CAL),
            actual_fs=w.get('actual_fs', 50)
        )
        if motion_rejected:
            raise ValueError(
                f'Window {i} rejected for movement — '
                f'sit still for the whole calibration period'
            )
        feature_rows.append(features_2d[0])

    windows_array = np.array(feature_rows)
    b_mean, b_std = compute_baseline(windows_array)

    if baseline_exists(user_id):
        old_mean, old_std = load_baseline(user_id, feature_cols)
        if old_mean is not None:
            b_mean, b_std = update_baseline_ema(old_mean, old_std, b_mean, b_std)

    save_baseline(user_id, b_mean, b_std, feature_cols)

    return {
        'success':      True,
        'user_id':      user_id,
        'baseline_set': True,
        'n_windows':    len(windows_array),
        'sample_values': {
            'AVNN_mean':     float(b_mean[0]),
            'SCL_mean_mean': float(b_mean[feature_cols.index('SCL_mean')])
        }
    }


def run_calibration_capture(user_id, on_progress=None):
    """Connects to MQTT, settles, captures N_BASELINE_WIN windows of raw
    sensor data, then saves them as user_id's personal baseline.

    on_progress(status, extra) is called at:
      'settling'         extra={}
      'window_skipped'   extra={'ibi', 'gsr', 'acc'}  (sample counts)
      'window_captured'  extra={'window_idx', 'fs'}
      'saving'           extra={}
      'done'             extra=<save_calibration_windows() result dict>
      'error'            extra={'message'}

    Blocks until done/error — callers that need this non-blocking (the
    in-app trigger) run it in a background thread.
    """
    def _notify(status, **extra):
        if on_progress:
            on_progress(status, extra)

    collected_windows = []
    state = {
        'window_start': time.time(),
        'ibi_buf': [], 'gsr_buf': [], 'acc_buf': []
    }

    def close_window():
        duration = time.time() - state['window_start']
        if duration <= 0:
            duration = WINDOW_SEC
        actual_fs = max(1, round(len(state['gsr_buf']) / duration))

        if (len(state['ibi_buf']) < 10 or len(state['gsr_buf']) < 20
                or len(state['acc_buf']) < 10):
            _notify('window_skipped',
                    ibi=len(state['ibi_buf']),
                    gsr=len(state['gsr_buf']),
                    acc=len(state['acc_buf']))
        else:
            collected_windows.append({
                "ibi_array":       state['ibi_buf'],
                "gsr_adc_array":   state['gsr_buf'],
                "acc_array":       state['acc_buf'],
                "gsr_calibration": GSR_CAL,
                "actual_fs":       actual_fs
            })
            _notify('window_captured',
                    window_idx=len(collected_windows), fs=actual_fs)

        state['ibi_buf'], state['gsr_buf'], state['acc_buf'] = [], [], []
        state['window_start'] = time.time()

    def on_connect(client, userdata, flags, rc):
        client.subscribe(MQTT_TOPIC)

    def on_message(client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode())
        except Exception:
            return

        state['ibi_buf'].extend(data.get("ibi", []))
        state['gsr_buf'].append(data.get("gsr", 0))

        ax = data.get("acc_x", 0)
        ay = data.get("acc_y", 0)
        az = data.get("acc_z", 0)
        state['acc_buf'].append(math.sqrt(ax * ax + ay * ay + az * az) / 9.81)

        if time.time() - state['window_start'] >= WINDOW_SEC:
            close_window()
            if len(collected_windows) >= N_BASELINE_WIN:
                client.disconnect()

    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None
    client.loop_start()

    _notify('settling')
    time.sleep(SETTLE_SEC)

    # Discard whatever accumulated during settling and start the real
    # capture window fresh from here.
    state['ibi_buf'], state['gsr_buf'], state['acc_buf'] = [], [], []
    state['window_start'] = time.time()

    while len(collected_windows) < N_BASELINE_WIN:
        time.sleep(1)

    client.loop_stop()
    client.disconnect()

    _notify('saving')
    try:
        result = save_calibration_windows(user_id, collected_windows)
    except Exception as e:
        _notify('error', message=str(e))
        return None

    _notify('done', **result)
    return result
