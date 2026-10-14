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
# FRESH MQTT CONNECTION PER CAPTURE CALL (see _connect_capture_client()
# below) -- reverted from an earlier "one shared, process-lifetime
# client" design (2026-08-29/30) after that design accumulated three
# separate bugs in one debugging session: a cached-but-silently-dead
# connection that every future attempt kept reusing without ever
# checking, a blocking connect() with no timeout that could hang an
# attempt indefinitely, and a background on_message callback that kept
# appending windows past the target count once a NEW capture reused the
# same long-lived client object (observed live as window counts reading
# "3/2", "4/2"). None of those bug classes exist for a connection that's
# fully torn down at the end of every single call -- this is also the
# exact pattern the always-on live bridge (backend/physiological/
# mqtt_bridge.py) and EEG's current on-demand calibration flow
# (backend/psychological/app.py) already use successfully. The cost --
# one more row in EMQX's client list per attempt, the reason the shared
# design existed in the first place -- is a cosmetic tradeoff, not a
# functional one; correctness wins.
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
from backend.physiological.extract_features import extract_features, adc_to_conductance
from backend.physiological.ema_service import build_ema_summary, interpret_ema_change
from backend.physiological.predictor import (
    compute_baseline, compute_personal_stress_threshold, feature_cols, predict_window,
    update_baseline_ema,
)
from backend.physiological.firebase_service import (
    baseline_exists, load_baseline, load_resting_scores, save_baseline,
    save_baseline_adaptation, save_personal_stress_threshold, save_resting_scores,
)

LIVE_GSR_POINTS = 100   # about the last 20 s at the ring's ~5 Hz
LIVE_IBI_BEATS = 20
LIVE_EMIT_GAP_SEC = 1.0


def _live_tail(state):
    """What has arrived so far in the window being captured, as processed
    values only (skin conductance in uS, recent beat intervals). Handed to the
    status route in memory so the calibration screens can draw a moving wave
    between the one-per-minute block points. Never saved anywhere."""
    gsr = state['gsr_buf'][-LIVE_GSR_POINTS:]
    ibi = [float(v) for v in state['ibi_buf'][-LIVE_IBI_BEATS:] if 300 <= v <= 2000]
    elapsed = max(0.001, time.time() - state['window_start'])
    hz = max(1.0, min(50.0, len(state['gsr_buf']) / elapsed)) if state['gsr_buf'] else 5.0
    us = [round(float(c), 3) for c in adc_to_conductance(gsr, GSR_CAL)] if gsr else []
    return {'gsr_us': us, 'gsr_hz': round(hz, 1), 'ibi_ms': [round(v, 1) for v in ibi],
            'elapsed': round(elapsed, 1), 'ts': time.time()}


def _live_block(window, baseline_mean=None, baseline_std=None):
    """Display-only summary of one just-captured window for the live
    calibration graphs: heart variability (SD1, ms), heart rate, skin
    conductance (uS) and, when a baseline is known (the limit test), the
    window's stress score. Never saved and never fed to the model beyond
    the same extract_features()/predict_window() calls the save step makes
    anyway; any failure just returns an unusable marker."""
    try:
        features_2d, motion_rejected, feat_dict, hrv_is_fallback, _wave = extract_features(
            window['ibi_array'], window['gsr_adc_array'], window['acc_array'],
            window['gsr_calibration'], actual_fs=window['actual_fs'],
        )
        if motion_rejected or hrv_is_fallback:
            return {'valid': False}
        block = {
            'valid': True,
            'hrv': round(float(feat_dict.get('SD1', 0.0)), 2),
            'hr': round(float(feat_dict.get('MeanHR', 0.0)), 1),
            'gsr': round(float(feat_dict.get('SCL_mean', 0.0)), 3),
        }
        if baseline_mean is not None:
            block['score'] = round(float(predict_window(features_2d, baseline_mean, baseline_std)['prob_stress']), 3)
        return block
    except Exception:
        return {'valid': False}


# Task-calibration capture size, in WINDOW_SEC=60 windows. Was 1 (only
# ~1 minute of task data), then 6 (6 minutes) -- now 8 (8 minutes) to
# match StressApp/modules/eeg/screens/EegThresholdTaskScreen.js's
# onboarding task, now a 5-activity sequence (serial subtraction -> maths
# quiz -> sequence-recall puzzle -> ticking-clock sorter -> Stroop)
# chosen specifically because a single short window's mean was coming out
# well below the population decision threshold (~0.4 vs ~0.71) -- the
# model needs SUSTAINED elevated load to register confidently, and a
# 1-2 minute task mostly just captures physiological ramp-up (HRV/GSR
# response lags the stressor by tens of seconds), not the sustained state
# itself. run_task_calibration_capture() below now averages prob_stress
# across all N_TASK_WIN windows (dropping individually-rejected ones)
# rather than using only the first, so the extra windows actually get
# used, not just requested.
N_TASK_WIN = 8

# Hard wall-clock ceiling on both capture loops below. Both are entirely
# message-driven (close_window() only ever runs from inside on_message()),
# so a ring that loses finger contact mid-capture -- plausible here
# specifically, since the user's hands are busy on the phone answering the
# arithmetic task -- leaves on_message() never firing again, and the
# "while len(...) < N: sleep()" loop blocks forever with no other exit.
# Worse, that stuck 'capturing' status also blocks every future retry --
# /calibrate(/threshold)/start's own in-progress check refuses to start a
# new attempt until the status actually changes. This timeout is what
# breaks that deadlock.
#
# NOT a flat 120s -- that used to equal exactly N_BASELINE_WIN*WINDOW_SEC
# (2*60=120) with ZERO margin for even a single skipped/replacement
# window, which close_window() explicitly supports (see "capturing a
# replacement window instead"). A flat ceiling that size meant literally
# any one bad window anywhere in the attempt made the whole thing
# unrecoverable, no matter how good conditions got afterward -- observed
# live as calibration that neither finishes nor fails cleanly within its
# own nominal duration, just runs past it. EXTRA_RETRY_WINDOWS below adds
# real headroom: enough time for several replacement windows, not zero.
# Raised 4 -> 6 alongside N_BASELINE_WIN going back to 3 -- keeps the
# retry margin generous (not just the total ceiling longer) specifically
# because "too many windows rejected" is the actual failure mode being
# tolerated here, not raw capture duration.
EXTRA_RETRY_WINDOWS = 6


def _capture_timeout_sec(n_windows_needed: int) -> float:
    """Real ceiling for one capture attempt -- the strict minimum
    (n_windows_needed * WINDOW_SEC) plus room for EXTRA_RETRY_WINDOWS
    skipped/replacement windows, not the bare minimum itself."""
    return (n_windows_needed + EXTRA_RETRY_WINDOWS) * WINDOW_SEC

# Fail-fast companion to _capture_timeout_sec() above: rather than always
# waiting out the full ceiling, abort as soon as no new MQTT message has
# arrived for this long -- 15s matches the "still connected" freshness
# window this project already uses elsewhere for this same device
# (firebase_service.py's own get_device_status() offline_after_sec, and
# CalibrationGate.js's useDeviceStatus polling on the frontend) rather
# than inventing a tighter, untested bound that risks false-failing a
# capture on ordinary MQTT/network jitter. _capture_timeout_sec() is kept
# as a backstop in case last-sample tracking itself never resets.
INACTIVITY_TIMEOUT_SEC = 15

# ---------------------------------------------------------------------
# Fresh, per-call MQTT connection -- see module docstring for why this
# replaced the earlier shared/cached client. A small counter (not just
# os.getpid()) keeps each attempt's client_id unique even across several
# retries within the same process run, so a still-draining disconnect
# from a just-finished attempt can never collide with the next one's
# fresh connect.
# ---------------------------------------------------------------------
_client_counter_lock = threading.Lock()
_client_counter = 0


def _connect_capture_client(on_message) -> mqtt.Client:
    """Opens and returns a brand-new, dedicated MQTT connection for one
    capture attempt, with on_message already wired up. Caller MUST call
    _disconnect_capture_client() on every exit path (success, error, or
    exception -- via try/finally) so this one-off connection doesn't
    linger."""
    global _client_counter
    with _client_counter_lock:
        _client_counter += 1
        client_id = f"ring_calib_{os.getpid()}_{_client_counter}"

    def on_connect(client, userdata, flags, reason_code, properties=None):
        print(f"[calib-mqtt] {'connected' if reason_code == 0 else f'connect failed (reason_code={reason_code})'}, "
              f"subscribing to {MQTT_TOPIC} (client_id={client_id})")
        client.subscribe(MQTT_TOPIC)

    client = mqtt.Client(client_id=client_id, callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
    if MQTT_CA_CERT:
        client.tls_set(ca_certs=MQTT_CA_CERT)
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.on_connect = on_connect
    client.on_message = on_message
    # connect_async(), not connect() -- connect() blocks synchronously on
    # the TCP handshake with no application-level timeout of its own; if
    # the network hangs (routing issue, broker briefly unreachable) rather
    # than cleanly failing, this call can sit for minutes -- well past
    # this call's timeout/INACTIVITY_TIMEOUT_SEC below, because the code
    # that enforces those never even gets to run while stuck here.
    # connect_async() returns immediately and hands the actual connect
    # attempt to the background thread loop_start() starts, so this
    # function itself can never hang.
    client.connect_async(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()
    return client


def _disconnect_capture_client(client: mqtt.Client):
    """Always call this when a capture attempt ends, on every exit path --
    tears down this one-off connection so it never lingers into the next
    attempt."""
    try:
        client.loop_stop()
        client.disconnect()
    except Exception:
        pass


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

    # Step-by-step prints -- this function does several Firebase Admin SDK
    # calls (baseline_exists, load_baseline, save_baseline_adaptation,
    # save_baseline, save_resting_scores below), none of which have an
    # application-level timeout; a network hiccup reaching Firebase
    # specifically (as opposed to MQTT/EMQX, a completely separate service)
    # could hang any one of them indefinitely with nothing to show for it.
    # These markers turn "stuck at 2/2, no idea why" into "stuck exactly
    # here" from whatever gets pasted next, instead of needing a precise
    # log search for one specific line.
    print(f"[calibrate {user_id}] save: extracting features from {len(raw_windows)} window(s)...")
    feature_rows = []
    for i, w in enumerate(raw_windows):
        features_2d, motion_rejected, feat_dict, hrv_is_fallback, _wave_dict = extract_features(
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
    print(f"[calibrate {user_id}] save: features extracted, computing baseline mean/std...")

    windows_array = np.array(feature_rows)
    b_mean, b_std = compute_baseline(windows_array)
    print(f"[calibrate {user_id}] save: baseline computed, checking for an existing one (Firebase read)...")

    if baseline_exists(user_id):
        print(f"[calibrate {user_id}] save: existing baseline found, loading it for EMA blend (Firebase read)...")
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
            print(f"[calibrate {user_id}] save: writing EMA adaptation record (Firebase write)...")
            save_baseline_adaptation(user_id, summary['features'], interpretation, EMA_ALPHA)
            b_mean = new_mean

    print(f"[calibrate {user_id}] save: writing baseline to Firebase (save_baseline)...")
    save_baseline(user_id, b_mean, b_std, feature_cols)
    print(f"[calibrate {user_id}] save: baseline write done.")

    # Resting prob_stress per window, via predict_window() -- the SAME
    # baseline-normalized scoring path /predict actually uses (not
    # predict_raw(), which the deployed pipeline never calls) -- saved for
    # run_task_calibration_capture() below to compare against later, a
    # separate/later request. Best-effort: model artifacts can be absent on
    # a given deploy (see predictor.py's own startup warning) without that
    # breaking baseline calibration itself, which doesn't need the model.
    try:
        print(f"[calibrate {user_id}] save: scoring resting windows for the personal-threshold task...")
        resting_scores = [
            predict_window(windows_array[i:i + 1], b_mean, b_std)['prob_stress']
            for i in range(len(windows_array))
        ]
        save_resting_scores(user_id, resting_scores)
        print(f"[calibrate {user_id}] save: resting scores saved.")
    except Exception as e:
        print(f"[calibrate {user_id}] save: resting-score scoring failed (non-fatal, baseline already saved): {e}")

    print(f"[calibrate {user_id}] save: complete.")
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


def run_calibration_capture(user_id, on_progress=None, on_live=None):
    """Settles, captures N_BASELINE_WIN windows of raw sensor data from a
    fresh MQTT connection dedicated to this one call (see
    _connect_capture_client()), then saves them as user_id's personal
    baseline.

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
    live_blocks = []
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
            live_blocks.append(_live_block(collected_windows[-1]))
            _notify('window_captured',
                    window_idx=len(collected_windows), fs=actual_fs, blocks=list(live_blocks))

        state['ibi_buf'], state['gsr_buf'], state['acc_buf'] = [], [], []
        state['window_start'] = time.time()

    def on_message(client, userdata, msg):
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

        if on_live is not None and time.time() - state.get('last_live', 0) >= LIVE_EMIT_GAP_SEC:
            state['last_live'] = time.time()
            try:
                on_live(_live_tail(state))
            except Exception:
                pass

        if time.time() - state['window_start'] >= WINDOW_SEC:
            close_window()

    try:
        client = _connect_capture_client(on_message)
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None

    try:
        _notify('settling')
        time.sleep(SETTLE_SEC)

        # Discard whatever accumulated during settling and start the real
        # capture window fresh from here.
        state['ibi_buf'], state['gsr_buf'], state['acc_buf'] = [], [], []
        state['window_start'] = time.time()
        state['last_sample_time'] = time.time()

        # Real ceiling, not the bare minimum -- see _capture_timeout_sec()'s
        # docstring for why a flat 120s (== N_BASELINE_WIN*WINDOW_SEC
        # exactly) gave zero room for even one retried window.
        capture_deadline = time.time() + _capture_timeout_sec(N_BASELINE_WIN)
        while len(collected_windows) < N_BASELINE_WIN:
            if time.time() > capture_deadline:
                # NOT "no data received" -- messages may well have been
                # arriving the whole time (see window_skipped above); this
                # fires when too many windows got skipped to finish within
                # the ceiling, which is a different, more specific problem
                # than the ring being silent (that's INACTIVITY_TIMEOUT_SEC
                # below, a real "no messages at all" case).
                _notify('error', message=(
                    f'Took too long to capture {N_BASELINE_WIN} clean window(s) -- '
                    f'too many were rejected for insufficient heart-rate signal '
                    f'or movement. Check ring fit/contact and try again.'
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
    finally:
        _disconnect_capture_client(client)


def run_task_calibration_capture(user_id, on_progress=None, on_live=None):
    """Personal-threshold task-phase capture: captures N_TASK_WIN
    consecutive windows (WINDOW_SEC=60 each -- see EEG's mirror,
    backend/psychological/mqtt_bridge.py's N_THRESHOLD_TASK_BLOCKS /
    BLOCK_SEC) from a fresh MQTT connection dedicated to this one call
    (see _connect_capture_client() -- no settle delay, baseline
    calibration run moments earlier already confirmed good ring contact),
    scores EACH window the same way save_calibration_windows() scores
    resting windows (predict_window(), baseline-normalized), and computes
    this user's personal STRESS_DECISION_THRESHOLD from the MEAN of all
    successfully-scored task windows against the resting scores that
    capture already saved (see compute_personal_stress_threshold(),
    predictor.py).

    N_TASK_WIN > 1 matters here specifically: a single 60s window's
    average is heavily diluted by the first ~15-20s of physiological
    ramp-up (autonomic/HRV response has real latency) before the task's
    own difficulty has had time to build any sustained load -- averaging
    across the whole multi-minute task (StressApp/modules/eeg/screens/
    EegThresholdTaskScreen.js's serial-subtraction + maths + n-back +
    Stroop sequence) instead of just its first minute is what actually
    lets a real, sustained response come through instead of being
    swamped by that one early window's ramp-up.

    on_progress(status, extra) is called at:
      'capturing'      extra={'window_idx', 'n_windows'}
      'window_skipped' extra={'ibi', 'gsr', 'acc', 'window_idx', 'n_windows'}
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
    live_blocks = []
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
            _notify('window_skipped', ibi=len(state['ibi_buf']), gsr=len(state['gsr_buf']), acc=len(state['acc_buf']),
                    window_idx=len(collected_windows), n_windows=N_TASK_WIN)
        else:
            collected_windows.append({
                "ibi_array": state['ibi_buf'], "gsr_adc_array": state['gsr_buf'],
                "acc_array": state['acc_buf'], "gsr_calibration": GSR_CAL, "actual_fs": actual_fs,
            })
            live_blocks.append(_live_block(collected_windows[-1], baseline_mean, baseline_std))
            _notify('capturing', window_idx=len(collected_windows), n_windows=N_TASK_WIN,
                    blocks=list(live_blocks), resting_scores=[round(float(r), 3) for r in resting_scores])
        state['ibi_buf'], state['gsr_buf'], state['acc_buf'] = [], [], []
        state['window_start'] = time.time()

    def on_message(client, userdata, msg):
        # Same overshoot guard as run_calibration_capture()'s identical
        # fix -- this callback runs on the dedicated connection's own
        # background thread and would otherwise keep closing/appending
        # windows past N_TASK_WIN for as long as messages keep arriving.
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
        if on_live is not None and time.time() - state.get('last_live', 0) >= LIVE_EMIT_GAP_SEC:
            state['last_live'] = time.time()
            try:
                on_live(_live_tail(state))
            except Exception:
                pass
        if time.time() - state['window_start'] >= WINDOW_SEC:
            close_window()

    try:
        client = _connect_capture_client(on_message)
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None

    try:
        _notify('capturing', window_idx=0, n_windows=N_TASK_WIN)
        capture_deadline = time.time() + _capture_timeout_sec(N_TASK_WIN)
        while len(collected_windows) < N_TASK_WIN:
            if time.time() > capture_deadline:
                _notify('error', message=(
                    f'Took too long to capture {N_TASK_WIN} clean window(s) -- '
                    f'too many were rejected for insufficient heart-rate signal '
                    f'or movement. Check ring fit/contact and try again.'
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
            # Score every collected window individually and drop only the
            # individual ones that fail (movement/insufficient heart-rate
            # signal) rather than aborting the whole capture over one bad
            # window out of N_TASK_WIN -- with several minutes of task
            # data now, the user's hands being busy typing during any
            # single window is expected, not fatal.
            task_scores = []
            for w in collected_windows:
                features_2d, motion_rejected, feat_dict, hrv_is_fallback, _wave_dict = extract_features(
                    w['ibi_array'], w['gsr_adc_array'], w['acc_array'], w['gsr_calibration'], actual_fs=w['actual_fs'],
                )
                if motion_rejected or hrv_is_fallback:
                    continue
                task_scores.append(float(predict_window(features_2d, baseline_mean, baseline_std)['prob_stress']))

            if not task_scores:
                _notify('error', message='Every task window was rejected (movement or insufficient heart-rate data)')
                return None

            threshold = compute_personal_stress_threshold(resting_scores, task_scores)
            result = {
                'status': 'ok' if threshold is not None else 'not_separated',
                'personal_stress_threshold': threshold,
                'resting_mean': float(np.mean(resting_scores)),
                'task_mean': float(np.mean(task_scores)),
                'n_task_windows': len(task_scores),
            }
            if threshold is not None:
                save_personal_stress_threshold(user_id, threshold)
        except Exception as e:
            _notify('error', message=str(e))
            return None

        _notify('done', **result)
        return result
    finally:
        _disconnect_capture_client(client)
