# ============================================================
# eeg_calibration_capture.py
#
# On-demand EEG capture -- mirrors backend/physiological/
# calibration_capture.py's run_calibration_capture() shape exactly
# (settle, discard, capture, save), but pulling raw EEG samples from a
# shared live MQTT connection instead of ring HRV/GSR windows. Two
# capture flows, same underlying pattern:
#   - run_eeg_calibration_capture()  -- baseline, driven by POST
#     /calibrate/start, polled via GET /calibrate/status.
#   - run_eeg_threshold_capture()    -- personal-threshold task phase,
#     driven by POST /calibrate/threshold/start, polled via GET
#     /calibrate/threshold/status. No settle delay -- baseline calibration
#     (run moments earlier) already confirmed good electrode contact.
#
# ONE shared, process-lifetime MQTT client (see _get_shared_client() below)
# -- NOT backend.common.mqtt_bridge.connect_mqtt() (that helper's
# _acquire_single_instance_lock() is keyed by client_id and would refuse a
# second same-id connection; mqtt_bridge.py's own long-running bridge
# already permanently holds a lock under "eeg_bridge_wearable02" as the
# standalone worker), and NOT a fresh mqtt.Client() per capture call
# either. An earlier version of this file opened a brand-new,
# uniquely-named client (client_id including the calling user_id and a
# timestamp) for every single /calibrate/start or /calibrate/threshold/start
# call, then tore it down again at the end -- functionally fine, but every
# call showed up as its own connected client in EMQX's dashboard/client
# list, and repeated attempts (retries after a stuck capture, multiple
# onboarding runs) meant that list only ever grew. This module now opens
# ONE client, lazily, the first time any capture function needs it, and
# keeps it connected for the lifetime of this process -- every capture
# after the first reuses that same live connection instead of registering
# a new one with the broker. Nothing here changes whether baseline values
# get saved to Firebase -- that was already save_baseline()'s job (via
# save_calibration_windows()/run_eeg_calibration_from_blocks()) and is
# untouched by this refactor; only where the raw samples come from changed.
#
# Bipolar-only (parse_bipolar_payload / BipolarRawSample) -- wearable02
# publishes ONE T7-T8 differential channel per sample ("millis,code;"),
# not the two-field-per-sample ch1/ch2 shape parse_payload() expects. An
# earlier version of this file used parse_payload(), which silently
# dropped every real wearable02 MQTT message (parse_payload() requires 3
# comma-separated fields per record; wearable02 sends 2), so the capture
# buffer never filled and this hung forever against real hardware -- see
# mqtt_client.py's module docstring for the full history of that mismatch.
# ============================================================

import os
import threading
import time

import paho.mqtt.client as mqtt

from backend.psychological.firebase_service import EegFirebaseSession, save_eeg_device_heartbeat
from backend.psychological.calibration_service import (
    CalibrationFailedError, run_eeg_calibration_from_blocks, run_eeg_threshold_from_blocks,
)
from backend.psychological.mqtt_bridge import (
    BLOCK_SAMPLES, BLOCK_SEC, EEG_MQTT_BROKER, EEG_MQTT_CA_CERT, EEG_MQTT_PASSWORD,
    CALIBRATION_SETTLE_SEC, EEG_MQTT_PORT, EEG_MQTT_TOPIC, EEG_MQTT_USER, N_CALIBRATION_BLOCKS,
    N_RECOVERY_BLOCKS, N_THRESHOLD_TASK_BLOCKS,
)
from backend.psychological.realtime.mqtt_client import parse_bipolar_payload
from backend.psychological.realtime.raw_cleaning import start_after_last_gap

# Electrode contact settles faster than the ring's GSR strap (whose own
# SETTLE_SEC is 30) -- 10s is enough for the amplifier/contact to stabilize
# once the headband is first put on, before the real capture starts.
EEG_SETTLE_SEC = CALIBRATION_SETTLE_SEC   # protocol phase 1: 2 min, discarded (was 10 s)

# Hard wall-clock ceiling on both block-capture loops below. Both loops
# only ever advance when buffered_count() >= BLOCK_SAMPLES, which needs
# real incoming MQTT samples -- a headband that shifts or goes out of
# range mid-capture (plausible during the threshold task specifically,
# since the user's hands are busy on the phone answering the arithmetic
# problems, not holding the headband steady) leaves that count frozen and
# the "while len(blocks) < N: sleep(0.5)" loop blocked forever, with
# on_progress never firing again. Worse, that stuck 'capturing' status
# also blocks every retry -- /calibrate(/threshold)/start's own
# in-progress check refuses a new attempt until the status actually
# changes. This timeout is what breaks that deadlock: generous margin
# over the real data volume needed (N_CALIBRATION_BLOCKS/
# N_THRESHOLD_TASK_BLOCKS blocks * BLOCK_SEC, at full rate). On timeout
# the SHARED client is left connected (see module docstring) -- only this
# one capture attempt aborts, so a retry reuses the live connection
# immediately instead of registering yet another one with EMQX.

# run_eeg_threshold_capture() below needs its own, much larger ceiling now
# that N_THRESHOLD_TASK_BLOCKS is 14 (~350s of real data needed) instead
# of 2 -- reusing CAPTURE_TIMEOUT_SEC=120 (sized for N_CALIBRATION_BLOCKS=3,
# ~75s) would fail every threshold capture partway through by design.
# EXTRA_RETRY_BLOCKS gives the same kind of rejected-block tolerance
# margin physiological's EXTRA_RETRY_WINDOWS does.
EXTRA_RETRY_BLOCKS = 4
CAPTURE_TIMEOUT_SEC = (N_CALIBRATION_BLOCKS + EXTRA_RETRY_BLOCKS) * BLOCK_SEC     # resting baseline
THRESHOLD_CAPTURE_TIMEOUT_SEC = (N_THRESHOLD_TASK_BLOCKS + EXTRA_RETRY_BLOCKS) * BLOCK_SEC
RECOVERY_CAPTURE_TIMEOUT_SEC = (N_RECOVERY_BLOCKS + EXTRA_RETRY_BLOCKS) * BLOCK_SEC

# Fail-fast companion to CAPTURE_TIMEOUT_SEC above: rather than always
# waiting out the full ceiling, abort as soon as no new MQTT sample has
# arrived for this long -- 15s matches the "still connected" freshness
# window this project already uses elsewhere for the exact same signal
# (StressApp/modules/shared/CalibrationGate.js's EEG_LIVE_RAW_FRESH_SEC,
# backend/physiological/firebase_service.py's get_device_status()
# offline_after_sec) rather than inventing a tighter, untested bound that
# risks false-failing a capture on ordinary MQTT/network jitter.
# CAPTURE_TIMEOUT_SEC is kept as a backstop in case last-sample tracking
# itself never resets (e.g. a steady trickle just under this bound).
INACTIVITY_TIMEOUT_SEC = 15

# ---------------------------------------------------------------------
# Shared, process-lifetime MQTT connection -- see module docstring for
# why this replaced a fresh client per capture call. One fixed client_id
# per OS process (not per-call, not per-user) so a restart or a second
# worker process doesn't collide with a still-connected previous
# instance's id, but a given running process only ever registers once.
# ---------------------------------------------------------------------
_shared_client_lock = threading.Lock()
_shared_client: mqtt.Client | None = None
_shared_buf: list = []
_shared_buf_lock = threading.Lock()
_shared_last_sample_time = [None]  # None until the shared client has ever seen a real sample
_shared_last_heartbeat = [0.0]


def _shared_on_message(client, userdata, msg):
    samples = parse_bipolar_payload(msg.payload.decode('utf-8', errors='replace'))
    if not samples:
        return
    with _shared_buf_lock:
        _shared_buf.extend(samples)
        _shared_last_sample_time[0] = time.time()
    # Headband heartbeat (throttled to once per 5 s) -- keeps 'Headband on'
    # true during on-demand calibration even if the always-on bridge is down.
    now = time.time()
    if now - _shared_last_heartbeat[0] >= 5:
        _shared_last_heartbeat[0] = now
        save_eeg_device_heartbeat()


def _get_shared_client() -> mqtt.Client:
    """Returns the one shared, already-connected EEG MQTT client for this
    process, creating and connecting it on first use. Never disconnected
    by capture functions below (even on their own timeout/error) -- only
    ever built once per process, so repeated calibration attempts (retries
    included) reuse the same live connection instead of registering a new
    one with EMQX each time."""
    global _shared_client
    with _shared_client_lock:
        if _shared_client is not None:
            return _shared_client

        def on_connect(client, userdata, flags, rc):
            client.subscribe(EEG_MQTT_TOPIC)

        client = mqtt.Client(client_id=f"eeg_calib_shared_{os.getpid()}")
        if EEG_MQTT_CA_CERT:
            client.tls_set(ca_certs=EEG_MQTT_CA_CERT)
        if EEG_MQTT_USER:
            client.username_pw_set(EEG_MQTT_USER, EEG_MQTT_PASSWORD)
        client.on_connect = on_connect
        client.on_message = _shared_on_message
        client.connect(EEG_MQTT_BROKER, EEG_MQTT_PORT, 60)
        client.loop_start()
        _shared_client = client
        return client


def _shared_buffered_count() -> int:
    with _shared_buf_lock:
        return len(_shared_buf)


def _shared_drain(n: int) -> list:
    with _shared_buf_lock:
        taken = _shared_buf[:n]
        del _shared_buf[:n]
        return taken


def _shared_discard_before_gap(n: int) -> tuple[int, float]:
    """Same as RawSampleBuffer.discard_before_gap(), for the shared list."""
    with _shared_buf_lock:
        idx, gap = start_after_last_gap([s.millis for s in _shared_buf[:n]])
        del _shared_buf[:idx]
        return idx, gap


def _shared_clear() -> None:
    with _shared_buf_lock:
        _shared_buf.clear()
        _shared_last_sample_time[0] = time.time()


def _shared_last_sample_age() -> float:
    """Seconds since the shared client last saw a real sample, or 0.0 if
    it hasn't seen one yet this capture (treated as 'just reset', not
    'stale', so a capture that starts before the very first sample of a
    fresh connection arrives doesn't immediately trip the inactivity
    watchdog)."""
    last = _shared_last_sample_time[0]
    return 0.0 if last is None else time.time() - last


def _live_eeg_point():
    """Signal amplitude (RMS of the last second, mean removed, in uV) of what
    the headband is streaming right now -- one number a second, processed,
    used only for the calibration screens' moving wave. None until a second
    of samples has arrived."""
    from backend.psychological.realtime.adc import bipolar_code_to_microvolts
    import numpy as np
    with _shared_buf_lock:
        tail = _shared_buf[-250:]
    if len(tail) < 125:
        return None
    uv = np.asarray(bipolar_code_to_microvolts(np.array([s.code for s in tail])), dtype=float)
    uv = uv - uv.mean()
    return round(float(np.sqrt(np.mean(uv ** 2))), 1)


def _new_live_engine():
    """A throwaway engine used only to show per-block scores on the live
    calibration graph while blocks are still being captured. It is never
    saved, never used for /predict, and the real calibration below still runs
    from the raw blocks exactly as before. Returns None if it cannot be built."""
    try:
        from backend.psychological.calibration_service import MODEL_DIR
        from backend.psychological.realtime.pipeline import RealtimeInference
        return RealtimeInference(MODEL_DIR)
    except Exception:
        return None


def _live_baseline_score(engine, samples):
    """Score of one just-captured resting block (None if the block was not
    usable) using the display-only engine."""
    if engine is None:
        return None
    try:
        before = len(engine._calibration_scores)
        engine.calibrate_bipolar_block(samples)
        if len(engine._calibration_scores) > before:
            return round(float(engine._calibration_scores[-1]), 3)
    except Exception:
        pass
    return None


def _live_task_score(engine, samples):
    if engine is None:
        return None
    try:
        q = engine.score_threshold_task_block(samples)
        sc = q.get('score')
        return None if sc is None else round(float(sc), 3)
    except Exception:
        return None


def run_eeg_calibration_capture(user_id, session_id, on_progress=None, on_live=None):
    """Blocking: settles (discarding whatever buffered while settling),
    captures N_CALIBRATION_BLOCKS raw bipolar blocks of BLOCK_SAMPLES each
    from the shared MQTT connection (see _get_shared_client()), then calls
    run_eeg_calibration_from_blocks() to save them exactly like a normal
    /calibrate HTTP call would.

    on_progress(status, extra) is called at:
      'settling'    extra={}
      'capturing'   extra={'block_idx', 'n_blocks'}   (once per completed block)
      'saving'      extra={}
      'done'        extra={'outcome', 'firebase_enabled', 'session_state'}
      'error'       extra={'message'}

    Blocks until done/error -- callers that need this non-blocking (the
    in-app trigger) run it in a background thread.
    """
    # Constructed here, not just inside run_eeg_calibration_from_blocks()
    # further down -- this covers the real ~10s settle + up to ~75s of
    # per-block capture BELOW, the actual span useDeviceStatus()
    # (CalibrationGate.js) had no liveness signal for at all before: it only
    # ever saw the device as "online" once a scored /predict block existed,
    # so every EEG-related screen showed "Offline" for this entire capture,
    # even though the headband was live and streaming the whole time.
    firebase = EegFirebaseSession(session_id, user_id)

    def _notify(status, **extra):
        # 'done' is skipped here -- run_eeg_calibration_from_blocks() (via
        # run_eeg_calibration_capture()'s call below) already wrote the
        # real, authoritative final outcome to this same Firebase node
        # BEFORE this notification ever fires, and 'done's own extra
        # (outcome/firebase_enabled/session_state -- session_state holds
        # live engine/firebase/csv_logger objects) isn't JSON-serializable
        # anyway. Everything else (settling/capturing/saving/error) only
        # ever carries small primitives (block_idx, n_blocks, message), so
        # writing extra as-is is safe for those. Best-effort -- a Firebase
        # hiccup here shouldn't abort a capture that's otherwise working.
        if status != 'done':
            try:
                firebase.push_calibration_result({'status': status, 'updated_at': time.time(), **extra})
            except Exception:
                pass
        if on_progress:
            on_progress(status, extra)

    try:
        _get_shared_client()
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None

    _notify('settling')
    time.sleep(EEG_SETTLE_SEC)

    # Discard whatever accumulated during settling and start the real
    # capture fresh from here.
    _shared_clear()

    blocks_samples = []
    live_scores = []
    _live_series, _live_last = [], [0.0]
    live_engine = _new_live_engine()
    capture_deadline = time.time() + CAPTURE_TIMEOUT_SEC
    while len(blocks_samples) < N_CALIBRATION_BLOCKS:
        if time.time() > capture_deadline:
            _notify('error', message=(
                f'No EEG data received within {CAPTURE_TIMEOUT_SEC:.0f}s -- '
                f'check the headband is powered on, worn, and in range, then try again.'
            ))
            return None
        if _shared_last_sample_age() > INACTIVITY_TIMEOUT_SEC:
            _notify('error', message=(
                f'EEG signal lost -- no data for {INACTIVITY_TIMEOUT_SEC:.0f}s. '
                f'Check the headband is still on and in range, then try again.'
            ))
            return None
        if _shared_buffered_count() >= BLOCK_SAMPLES and _shared_discard_before_gap(BLOCK_SAMPLES)[0]:
            continue  # stream break inside the next block -- start after it
        if on_live is not None and time.time() - _live_last[0] >= 1.0:
            _live_last[0] = time.time()
            pt = _live_eeg_point()
            if pt is not None:
                _live_series.append(pt)
                del _live_series[:-60]
                try:
                    on_live({'rms_uv': list(_live_series), 'ts': time.time()})
                except Exception:
                    pass
        if _shared_buffered_count() < BLOCK_SAMPLES:
            time.sleep(0.5)
            continue
        blocks_samples.append(_shared_drain(BLOCK_SAMPLES))
        live_scores.append(_live_baseline_score(live_engine, blocks_samples[-1]))
        _notify('capturing', block_idx=len(blocks_samples), n_blocks=N_CALIBRATION_BLOCKS,
                scores=list(live_scores))

    _notify('saving')
    try:
        # allow_degraded=True -- same backstop as mqtt_bridge.py's always-on
        # flow: falls back to the single best-scoring block if none clear
        # the QUESTIONABLE bar, flagged baseline_degraded=True throughout,
        # rather than failing outright and leaving onboarding stuck retrying
        # forever with no baseline at all.
        result = run_eeg_calibration_from_blocks(user_id, session_id, blocks_samples, allow_degraded=True)
    except CalibrationFailedError as e:
        _notify('error', message=str(e))
        return None
    except Exception as e:
        _notify('error', message=str(e))
        return None

    _notify('done', **result)
    return result


def run_eeg_threshold_capture(session_state: dict, on_progress=None, on_live=None):
    """Blocking: captures N_THRESHOLD_TASK_BLOCKS raw bipolar blocks from
    the shared MQTT connection (see _get_shared_client() -- NO settle
    delay, baseline calibration run moments earlier already confirmed
    good electrode contact), then calls run_eeg_threshold_from_blocks()
    against the ALREADY-CALIBRATED engine in session_state (app.py's
    eeg_sessions[session_id], the same dict /predict already reads) to
    compute and save this user's personal high_load_p.

    on_progress(status, extra) is called at:
      'capturing'  extra={'block_idx', 'n_blocks'}
      'saving'     extra={}
      'done'       extra=<run_eeg_threshold_from_blocks() outcome dict>
      'error'      extra={'message'}

    Blocks until done/error -- callers that need this non-blocking (the
    in-app trigger) run it in a background thread.
    """
    def _notify(status, **extra):
        if on_progress:
            on_progress(status, extra)

    try:
        _get_shared_client()
    except Exception as e:
        _notify('error', message=f'Could not connect to MQTT broker: {e}')
        return None

    _shared_clear()

    blocks_samples = []
    live_scores = []
    _live_series, _live_last = [], [0.0]
    live_engine = _new_live_engine()
    try:
        resting_scores = [round(float(v), 3) for v in session_state['engine']._calibration_scores]
    except Exception:
        resting_scores = []
    capture_deadline = time.time() + THRESHOLD_CAPTURE_TIMEOUT_SEC
    while len(blocks_samples) < N_THRESHOLD_TASK_BLOCKS:
        if time.time() > capture_deadline:
            _notify('error', message=(
                f'No EEG data received within {THRESHOLD_CAPTURE_TIMEOUT_SEC:.0f}s -- '
                f'check the headband is powered on, worn, and in range, then try again.'
            ))
            return None
        if _shared_last_sample_age() > INACTIVITY_TIMEOUT_SEC:
            _notify('error', message=(
                f'EEG signal lost -- no data for {INACTIVITY_TIMEOUT_SEC:.0f}s. '
                f'Check the headband is still on and in range, then try again.'
            ))
            return None
        if _shared_buffered_count() >= BLOCK_SAMPLES and _shared_discard_before_gap(BLOCK_SAMPLES)[0]:
            continue  # stream break inside the next block -- start after it
        if on_live is not None and time.time() - _live_last[0] >= 1.0:
            _live_last[0] = time.time()
            pt = _live_eeg_point()
            if pt is not None:
                _live_series.append(pt)
                del _live_series[:-60]
                try:
                    on_live({'rms_uv': list(_live_series), 'ts': time.time()})
                except Exception:
                    pass
        if _shared_buffered_count() < BLOCK_SAMPLES:
            time.sleep(0.5)
            continue
        blocks_samples.append(_shared_drain(BLOCK_SAMPLES))
        live_scores.append(_live_task_score(live_engine, blocks_samples[-1]))
        _notify('capturing', block_idx=len(blocks_samples), n_blocks=N_THRESHOLD_TASK_BLOCKS,
                scores=list(live_scores), resting_scores=resting_scores)

    # Protocol phase 4: recovery rest. The task is over; the user sits still
    # and relaxes while N_RECOVERY_BLOCKS more blocks are recorded. A
    # problem here doesn't lose the threshold -- the task blocks are scored
    # either way, recovery is reported only if it completed.
    recovery_samples = []
    recovery_scores = []
    _notify('recovery', block_idx=0, n_blocks=N_RECOVERY_BLOCKS, scores=list(live_scores), resting_scores=resting_scores)
    recovery_deadline = time.time() + RECOVERY_CAPTURE_TIMEOUT_SEC
    while len(recovery_samples) < N_RECOVERY_BLOCKS:
        if time.time() > recovery_deadline or _shared_last_sample_age() > INACTIVITY_TIMEOUT_SEC:
            print(f"[threshold] recovery rest incomplete ({len(recovery_samples)}/{N_RECOVERY_BLOCKS} blocks) "
                  f"-- saving the threshold without it")
            break
        if _shared_buffered_count() >= BLOCK_SAMPLES and _shared_discard_before_gap(BLOCK_SAMPLES)[0]:
            continue
        if _shared_buffered_count() < BLOCK_SAMPLES:
            time.sleep(0.5)
            continue
        recovery_samples.append(_shared_drain(BLOCK_SAMPLES))
        recovery_scores.append(_live_task_score(live_engine, recovery_samples[-1]))
        _notify('recovery', block_idx=len(recovery_samples), n_blocks=N_RECOVERY_BLOCKS,
                scores=list(live_scores), recovery_scores=list(recovery_scores), resting_scores=resting_scores)

    _notify('saving')
    try:
        result = run_eeg_threshold_from_blocks(session_state, blocks_samples, recovery_samples)
    except Exception as e:
        _notify('error', message=str(e))
        return None

    _notify('done', **result)
    return result
