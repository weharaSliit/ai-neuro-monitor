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
#
# ONE shared, process-lifetime MQTT client (see _get_shared_client()
# below) -- an earlier version of this file opened a brand-new
# mqtt.Client() for every single capture call (baseline AND task-phase,
# every retry included) and disconnected it again at the end. Functionally
# fine, but every call registered as its own connected client in EMQX's
# dashboard/client list, and that list only ever grew with repeated
# attempts. Both capture functions below now share one connection, opened
# lazily on first use and kept alive for the lifetime of this process --
# only where the raw samples come from changed; save_baseline() /
# save_calibration_windows() still write the resulting baseline to
# Firebase exactly as before.
# ============================================================

import json
import math
import os
import threading
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

# Hard wall-clock ceiling on both capture loops below. Both are entirely
# message-driven (close_window() only ever runs from inside on_message()),
# so a ring that loses finger contact mid-capture -- plausible here
# specifically, since the user's hands are busy on the phone answering the
# arithmetic task -- leaves on_message() never firing again, and the
# "while len(...) < N: sleep()" loop blocks forever with no other exit.
# Worse, that stuck 'capturing' status also blocks every future retry --
# /calibrate(/threshold)/start's own in-progress check refuses to start a
# new attempt until the status actually changes. This timeout is what
# breaks that deadlock: generous margin over the real data volume needed
# (N_BASELINE_WIN/N_TASK_WIN windows * WINDOW_SEC, at full rate). On
# timeout the SHARED client (below) is left connected -- only this one
# capture attempt aborts, so a retry reuses the live connection instantly
# instead of registering yet another one with EMQX.
CAPTURE_TIMEOUT_SEC = 120

# Fail-fast companion to CAPTURE_TIMEOUT_SEC above: rather than always
# waiting out the full ceiling, abort as soon as no new MQTT message has
# arrived for this long -- 15s matches the "still connected" freshness
# window this project already uses elsewhere for this same device
# (firebase_service.py's own get_device_status() offline_after_sec, and
# CalibrationGate.js's useDeviceStatus polling on the frontend) rather
# than inventing a tighter, untested bound that risks false-failing a
# capture on ordinary MQTT/network jitter. CAPTURE_TIMEOUT_SEC is kept as
# a backstop in case last-sample tracking itself never resets.
INACTIVITY_TIMEOUT_SEC = 15

# ---------------------------------------------------------------------
# Shared, process-lifetime MQTT connection -- see module docstring for
# why this replaced a fresh client per capture call. One fixed client_id
# per OS process (not per-call) so a restart or a second worker process
# doesn't collide with a still-connected previous instance's id, but a
# given running process only ever registers once with EMQX. Capture
# functions below reassign client.on_message to their own closure for the
# duration of their own capture (only one capture ever runs at a time in
# this app's single-session model, same assumption app.py's global
# eeg_sessions/_threshold_sessions dicts already make) and never call
# client.disconnect() themselves -- only this helper ever tears the
# connection down, and nothing in this file currently does.
# ---------------------------------------------------------------------
_shared_client_lock = threading.Lock()
_shared_client: mqtt.Client | None = None


def _get_shared_client() -> mqtt.Client:
    """Returns the one shared, already-connected ring MQTT client for this
    process, creating and connecting it on first use.

    Re-connects if the cached client has silently dropped -- this used to
    return _shared_client unconditionally once created, so a single
    connection drop (network blip, broker-side session timeout) anywhere
    in this process's lifetime would leave every future calibration
    attempt silently handed a dead client -- looking exactly like
    "No ring data received within {CAPTURE_TIMEOUT_SEC}s" with no way to
    tell that from the ring genuinely being offline. The always-on bridge
    (backend/common/mqtt_bridge.py) is a separate process/connection, so
    it keeps working fine even while this one is stuck -- that mismatch
    (live predictions still flowing, calibration still timing out) is
    what actually points at this function rather than the device."""
    global _shared_client
    with _shared_client_lock:
        if _shared_client is not None and _shared_client.is_connected():
            return _shared_client

        # Also VERSION2 -- matches backend/common/mqtt_bridge.py's
        # connect_mqtt(), the confirmed-working pattern elsewhere in this
        # codebase. The old on_connect(client, userdata, flags, rc) form
        # here previously ignored the connection result entirely --
        # subscribed unconditionally even on a rejected connect, so a
        # failed connect and a successful one looked identical from here.
        def on_connect(client, userdata, flags, reason_code, properties=None):
            print(f"[calib-mqtt] {'connected' if reason_code == 0 else f'connect failed (reason_code={reason_code})'}, "
                  f"subscribing to {MQTT_TOPIC}")
            client.subscribe(MQTT_TOPIC)

        client = mqtt.Client(client_id=f"ring_calib_shared_{os.getpid()}",
                              callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        if MQTT_CA_CERT:
            client.tls_set(ca_certs=MQTT_CA_CERT)
        if MQTT_USER:
            client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
        client.on_connect = on_connect
        # connect_async(), not connect() -- connect() blocks synchronously
        # on the TCP handshake with no application-level timeout of its
        # own; if the network hangs (routing issue, broker briefly
        # unreachable) rather than cleanly failing, this call can sit for
        # minutes -- well past CAPTURE_TIMEOUT_SEC/INACTIVITY_TIMEOUT_SEC
        # below, because the code that enforces those never even gets to
        # run while stuck here. connect_async() returns immediately and
        # hands the actual connect attempt (with retries) to the
        # background thread loop_start() starts, so this function itself
        # can never hang -- a stuck connection now correctly surfaces via
        # the 120s/15s checks in run_calibration_capture() instead of
        # hanging silently before those checks are ever reached.
        client.connect_async(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_start()
        _shared_client = client
        return client


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
    """Settles, captures N_BASELINE_WIN windows of raw sensor data from the
    shared MQTT connection (see _get_shared_client()), then saves them as
    user_id's personal baseline.

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
        # Printed here (not just handed to on_progress) so calibration
        # progress shows up in Render's log viewer -- on_progress alone
        # only updates app.py's in-memory _calibration_sessions dict for
        # the app's own /calibrate/status polling, which is invisible from
        # the server logs someone's actually watching during a capture --
        # a rejected/failed calibration used to be completely silent here.
        if status == 'settling':
            print(f"[calibrate {user_id}] settling for {SETTLE_SEC}s...")
        elif status == 'window_captured':
            print(f"[calibrate {user_id}] window {extra['window_idx']}/{N_BASELINE_WIN} "
                  f"captured (fs={extra['fs']}Hz)")
        elif status == 'window_skipped':
            print(f"[calibrate {user_id}] window skipped — insufficient data "
                  f"(ibi={extra['ibi']}, gsr={extra['gsr']}, acc={extra['acc']}) "
                  f"-- capturing a replacement window instead")
        elif status == 'saving':
            print(f"[calibrate {user_id}] {N_BASELINE_WIN}/{N_BASELINE_WIN} windows captured "
                  f"-- extracting features and saving baseline...")
        elif status == 'done':
            print(f"[calibrate {user_id}] baseline saved successfully")
        elif status == 'error':
            print(f"[calibrate {user_id}] FAILED -- {extra.get('message')}")
        if on_progress:
            on_progress(status, extra)

    collected_windows = []
    state = {
        'window_start': time.time(),
        'ibi_buf': [], 'gsr_buf': [], 'acc_buf': [],
        'last_sample_time': time.time(),
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

    def on_message(client, userdata, msg):
        # Guards against a real race: this callback runs on the shared
        # client's own background network thread, independent of the main
        # thread's `while len(collected_windows) < N_BASELINE_WIN` loop
        # below -- that loop only stops WAITING once enough windows exist,
        # it never stops THIS callback from continuing to close and append
        # more windows to the same list if messages keep arriving. Without
        # this guard, a capture could overshoot to 3, 4, 5+ windows in the
        # background (window_idx > n_windows on screen, e.g. "3/2"), and
        # save_calibration_windows() could end up reading collected_windows
        # while it's still being mutated concurrently.
        if len(collected_windows) >= N_BASELINE_WIN:
            return

        try:
            data = json.loads(msg.payload.decode())
        except Exception:
            return

        state['last_sample_time'] = time.time()
        state['ibi_buf'].extend(data.get("ibi", []))
        state['gsr_buf'].append(data.get("gsr", 0))

        ax = data.get("acc_x", 0)
        ay = data.get("acc_y", 0)
        az = data.get("acc_z", 0)
        state['acc_buf'].append(math.sqrt(ax * ax + ay * ay + az * az) / 9.81)

        if time.time() - state['window_start'] >= WINDOW_SEC:
            close_window()
            # No client.disconnect() here -- this is the shared,
            # process-lifetime connection now (see _get_shared_client()),
            # not a per-call one; the while-loop below is what actually
            # ends this capture, by simply stopping reading from it.

    try:
        client = _get_shared_client()
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None
    client.on_message = on_message

    _notify('settling')
    time.sleep(SETTLE_SEC)

    # Discard whatever accumulated during settling and start the real
    # capture window fresh from here.
    state['ibi_buf'], state['gsr_buf'], state['acc_buf'] = [], [], []
    state['window_start'] = time.time()
    state['last_sample_time'] = time.time()

    capture_deadline = time.time() + CAPTURE_TIMEOUT_SEC
    while len(collected_windows) < N_BASELINE_WIN:
        if time.time() > capture_deadline:
            _notify('error', message=(
                f'No ring data received within {CAPTURE_TIMEOUT_SEC:.0f}s -- '
                f'check the ring is worn and connected, then try again.'
            ))
            return None
        if time.time() - state['last_sample_time'] > INACTIVITY_TIMEOUT_SEC:
            _notify('error', message=(
                f'Ring signal lost -- no data for {INACTIVITY_TIMEOUT_SEC:.0f}s. '
                f'Check the ring is still worn and connected, then try again.'
            ))
            return None
        time.sleep(1)

    _notify('saving')
    try:
        result = save_calibration_windows(user_id, collected_windows)
    except Exception as e:
        _notify('error', message=str(e))
        return None

    _notify('done', **result)
    return result


def run_task_calibration_capture(user_id, on_progress=None):
    """Personal-threshold task-phase capture: captures exactly N_TASK_WIN=1
    window (WINDOW_SEC=60, the shared task duration this project settled
    on -- see EEG's mirror, backend/psychological/mqtt_bridge.py's
    N_THRESHOLD_TASK_BLOCKS / THRESHOLD_TASK_POLL_INTERVAL_SEC) from the
    shared MQTT connection (see _get_shared_client() -- no settle delay,
    baseline calibration run moments earlier already confirmed good ring
    contact), scores it the same way save_calibration_windows() scores
    resting windows (predict_window(), baseline-normalized), and computes
    this user's personal STRESS_DECISION_THRESHOLD against the resting
    scores that capture already saved (see
    compute_personal_stress_threshold(), predictor.py).

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
    state = {
        'window_start': time.time(), 'ibi_buf': [], 'gsr_buf': [], 'acc_buf': [],
        'last_sample_time': time.time(),
    }

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

    def on_message(client, userdata, msg):
        # Same overshoot guard as run_calibration_capture()'s identical
        # fix -- this callback runs on the shared client's background
        # thread and would otherwise keep closing/appending windows past
        # N_TASK_WIN for as long as messages keep arriving.
        if len(collected_windows) >= N_TASK_WIN:
            return

        try:
            data = json.loads(msg.payload.decode())
        except Exception:
            return
        state['last_sample_time'] = time.time()
        state['ibi_buf'].extend(data.get("ibi", []))
        state['gsr_buf'].append(data.get("gsr", 0))
        ax, ay, az = data.get("acc_x", 0), data.get("acc_y", 0), data.get("acc_z", 0)
        state['acc_buf'].append(math.sqrt(ax * ax + ay * ay + az * az) / 9.81)
        if time.time() - state['window_start'] >= WINDOW_SEC:
            close_window()
            # No client.disconnect() here -- shared connection, see
            # run_calibration_capture()'s identical comment above.

    try:
        client = _get_shared_client()
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None
    client.on_message = on_message

    _notify('capturing')
    capture_deadline = time.time() + CAPTURE_TIMEOUT_SEC
    while len(collected_windows) < N_TASK_WIN:
        if time.time() > capture_deadline:
            _notify('error', message=(
                f'No ring data received within {CAPTURE_TIMEOUT_SEC:.0f}s -- '
                f'check the ring is worn and connected, then try again.'
            ))
            return None
        if time.time() - state['last_sample_time'] > INACTIVITY_TIMEOUT_SEC:
            _notify('error', message=(
                f'Ring signal lost -- no data for {INACTIVITY_TIMEOUT_SEC:.0f}s. '
                f'Check the ring is still worn and connected, then try again.'
            ))
            return None
        time.sleep(1)

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
