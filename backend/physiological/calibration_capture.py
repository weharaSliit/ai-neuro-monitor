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
    MQTT_BROKER, MQTT_PORT, MQTT_TOPIC, MQTT_USER, MQTT_PASSWORD, MQTT_CA_CERT,
    GSR_CAL, WINDOW_SEC, SETTLE_SEC, N_BASELINE_WIN
)
from backend.common.config import EMA_ALPHA
from backend.physiological.extract_features import extract_features
from backend.physiological.ema_service import build_ema_summary, interpret_ema_change
from backend.physiological.predictor import (
    compute_baseline, compute_personal_stress_threshold, feature_cols, predict_window,
    update_baseline_ema,
)
from backend.physiological.firebase_service import (
    baseline_exists, load_baseline, load_resting_scores, save_baseline,
    save_baseline_adaptation, save_personal_stress_threshold, save_resting_scores,
)

# Task-calibration capture size: 1 window (WINDOW_SEC=60) is what this
# scoring path needs regardless of how long the onboarding quiz UI runs
# for -- StressApp/modules/eeg/screens/EegThresholdTaskScreen.js's own
# TASK_DURATION_SEC (75s, deliberately longer than this 60s + EEG's own
# ~53s worst case, so the quiz's countdown absorbs the capture time
# instead of the user seeing a post-quiz wait) is independent of this
# constant -- no extra constant needed here beyond WINDOW_SEC itself.
N_TASK_WIN = 1


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
        features_2d, motion_rejected, feat_dict, hrv_is_fallback = extract_features(
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
        if hrv_is_fallback:
            # A baseline built on fabricated HRV placeholders (see
            # extract_hrv_features()'s docstring) would be worse than no
            # baseline at all -- same rejection treatment as motion.
            raise ValueError(
                f'Window {i} rejected — insufficient clean heart-rate data '
                f'(check ring contact/fit and retry)'
            )
        feature_rows.append(features_2d[0])

    windows_array = np.array(feature_rows)
    b_mean, b_std = compute_baseline(windows_array)

    if baseline_exists(user_id):
        old_mean, old_std = load_baseline(user_id, feature_cols)
        if old_mean is not None:
            new_mean, b_std = update_baseline_ema(old_mean, old_std, b_mean, b_std)
            # This IS "continual adaptation over time" for this project --
            # a real, controlled recalibration blended into the existing
            # baseline (not a guess from noisy everyday session data, see
            # ema_service.py's header). Logged here, once per recalibration
            # that actually had a prior baseline to blend against, for the
            # "Continual Learning" screen (StressApp/modules/physiological/
            # screens/EMAScreen.js) to display -- build_ema_summary gives the
            # real per-feature formula (actual numbers, not a template
            # string) and interpret_ema_change gives a physiological reading
            # of what changed, both computed once here rather than
            # reconstructed client-side from raw numbers.
            summary = build_ema_summary(old_mean, new_mean, feature_cols)
            interpretation = interpret_ema_change(old_mean, new_mean, feature_cols)
            save_baseline_adaptation(user_id, summary['features'], interpretation, EMA_ALPHA)
            b_mean = new_mean

    save_baseline(user_id, b_mean, b_std, feature_cols)

    # Resting prob_stress per window, via predict_window() -- the SAME
    # baseline-normalized scoring path /predict actually uses (not
    # predict_raw(), which the deployed pipeline never calls) -- saved for
    # run_task_calibration_capture() below to compare against later, a
    # separate/later request. Best-effort: model artifacts can be absent on
    # a given deploy (see predictor.py's own startup warning) without that
    # breaking baseline calibration itself, which doesn't need the model.
    try:
        resting_scores = [
            predict_window(windows_array[i:i + 1], b_mean, b_std)['prob_stress']
            for i in range(len(windows_array))
        ]
        save_resting_scores(user_id, resting_scores)
    except Exception:
        pass

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
    if MQTT_CA_CERT:
        client.tls_set(ca_certs=MQTT_CA_CERT)
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
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


def run_task_calibration_capture(user_id, on_progress=None):
    """Personal-threshold task-phase capture: connects to MQTT (no settle
    delay -- baseline calibration, run moments earlier via
    run_calibration_capture(), already confirmed good ring contact),
    captures exactly N_TASK_WIN=1 window (WINDOW_SEC=60, the shared task
    duration this project settled on -- see EEG's mirror,
    backend/psychological/mqtt_bridge.py's N_THRESHOLD_TASK_BLOCKS /
    THRESHOLD_TASK_POLL_INTERVAL_SEC), scores it the same way
    save_calibration_windows() scores resting windows (predict_window(),
    baseline-normalized), and computes this user's personal
    STRESS_DECISION_THRESHOLD against the resting scores that capture
    already saved (see compute_personal_stress_threshold(), predictor.py).

    on_progress(status, extra) is called at:
      'capturing'      extra={}
      'window_skipped' extra={'ibi', 'gsr', 'acc'}
      'saving'         extra={}
      'done'           extra={'status': 'ok'|'not_separated',
                               'personal_stress_threshold': float|None,
                               'resting_mean': float, 'task_mean': float}
      'error'          extra={'message'}

    Blocks until done/error, same as run_calibration_capture() -- callers
    needing non-blocking (the in-app trigger) run it in a background thread.
    """
    def _notify(status, **extra):
        if on_progress:
            on_progress(status, extra)

    resting_scores = load_resting_scores(user_id)
    if not resting_scores:
        _notify('error', message='No resting baseline scores on file -- run baseline calibration first')
        return None

    baseline_mean, baseline_std = load_baseline(user_id, feature_cols)
    if baseline_mean is None:
        _notify('error', message='No baseline on file -- run baseline calibration first')
        return None

    collected_windows = []
    state = {'window_start': time.time(), 'ibi_buf': [], 'gsr_buf': [], 'acc_buf': []}

    def close_window():
        duration = time.time() - state['window_start']
        if duration <= 0:
            duration = WINDOW_SEC
        actual_fs = max(1, round(len(state['gsr_buf']) / duration))
        if (len(state['ibi_buf']) < 10 or len(state['gsr_buf']) < 20 or len(state['acc_buf']) < 10):
            _notify('window_skipped', ibi=len(state['ibi_buf']), gsr=len(state['gsr_buf']), acc=len(state['acc_buf']))
        else:
            collected_windows.append({
                "ibi_array": state['ibi_buf'], "gsr_adc_array": state['gsr_buf'],
                "acc_array": state['acc_buf'], "gsr_calibration": GSR_CAL, "actual_fs": actual_fs,
            })
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
        ax, ay, az = data.get("acc_x", 0), data.get("acc_y", 0), data.get("acc_z", 0)
        state['acc_buf'].append(math.sqrt(ax * ax + ay * ay + az * az) / 9.81)
        if time.time() - state['window_start'] >= WINDOW_SEC:
            close_window()
            if len(collected_windows) >= N_TASK_WIN:
                client.disconnect()

    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    if MQTT_CA_CERT:
        client.tls_set(ca_certs=MQTT_CA_CERT)
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None
    client.loop_start()

    _notify('capturing')
    while len(collected_windows) < N_TASK_WIN:
        time.sleep(1)

    client.loop_stop()
    client.disconnect()

    _notify('saving')
    try:
        w = collected_windows[0]
        features_2d, motion_rejected, feat_dict, hrv_is_fallback = extract_features(
            w['ibi_array'], w['gsr_adc_array'], w['acc_array'], w['gsr_calibration'], actual_fs=w['actual_fs'],
        )
        if motion_rejected or hrv_is_fallback:
            _notify('error', message='Task window rejected (movement or insufficient heart-rate data)')
            return None
        task_score = float(predict_window(features_2d, baseline_mean, baseline_std)['prob_stress'])
        threshold = compute_personal_stress_threshold(resting_scores, [task_score])
        result = {
            'status': 'ok' if threshold is not None else 'not_separated',
            'personal_stress_threshold': threshold,
            'resting_mean': float(np.mean(resting_scores)),
            'task_mean': task_score,
        }
        if threshold is not None:
            save_personal_stress_threshold(user_id, threshold)
    except Exception as e:
        _notify('error', message=str(e))
        return None

    _notify('done', **result)
    return result
