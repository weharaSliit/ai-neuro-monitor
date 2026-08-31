import os
import re
import sys
import time
from pathlib import Path
import requests

sys.stdout.reconfigure(line_buffering=True)

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.firebase_config import (
    CURRENT_SESSION_ID_FIELD, CURRENT_USER_ID_FIELD, FIREBASE_DB_URL, RTDB_NAMESPACES
)
from backend.common.mqtt_bridge import auth_headers, post_json
from backend.psychological.realtime.csv_logger import CsvLogger, RAW_FIELDS_BIPOLAR, log_raw_block_bipolar
from backend.psychological.realtime.mqtt_client import RawSampleBuffer, make_bipolar_client
from backend.psychological.realtime.resample import SOURCE_FS

BLOCK_SEC = 25.0
BLOCK_SAMPLES = int(BLOCK_SEC * SOURCE_FS)
N_CALIBRATION_BLOCKS = 3
EMPTY_BUFFER_WARN_INTERVAL_SEC = 5.0

# Personal high_load_p threshold task block count (see
# backend/psychological/sam40/decision.py::compute_personal_threshold()).
# NOT used by this always-on bridge -- kept here only because
# eeg_calibration_capture.py::run_eeg_threshold_capture() imports it. That
# module captures its own short-lived MQTT connection on demand (driven by
# EegThresholdTaskScreen.js's POST /calibrate/threshold/start), independent
# of whether this bridge process is even running.
#
# Was 2 blocks (~50s), then 14 (~350s) -- now 19 (~475s, matching
# StressApp/modules/eeg/screens/EegThresholdTaskScreen.js's onboarding
# task now running 8 minutes: serial subtraction -> maths quiz ->
# sequence-recall puzzle -> ticking-clock sorter -> Stroop).
# finalize_personal_threshold() (realtime/pipeline.py) already averages
# ALL scored blocks in self._task_scores, not just the first, so raising
# this directly gives a sustained-load mean instead of one early,
# ramp-up-diluted block -- same reasoning as physiological's N_TASK_WIN.
N_THRESHOLD_TASK_BLOCKS = 19

# Concise feature subset for the console log -- same 5 band powers + 3
# highest-|coefficient| non-band features EegSummaryScreen.js's Feature
# Trends card charts (FEATURE_TREND_CONFIG, EegSummaryScreen.js), not the
# full ~29-feature bipolar dict -- that's legible per-block, this isn't.
FEATURE_LOG_KEYS = (
    "delta_rel_power", "theta_rel_power", "alpha_rel_power",
    "beta_rel_power", "gamma_rel_power",
    "ptp", "theta_beta_ratio", "spectral_entropy",
)

# A block already drained from the buffer is gone from it either way -- a
# transient failure (Render cold start, a network blip) shouldn't mean it's
# gone from EVERYWHERE. A couple of short retries covers that; only once
# they're exhausted does a /predict block fall back to the local CSV below,
# and a /calibrate attempt get discarded outright.
RETRY_DELAYS_SEC = (2.0, 5.0)  # 3 total attempts: initial + these 2 retries

# Isolates the bridge process from a single unexpected exception (a bad
# packet, a transient library error) -- without this, one such exception
# kills the whole `while True` loop and nothing brings it back.
RECONNECT_DELAY_SEC = 5.0

FALLBACK_LOG_DIR = Path(__file__).resolve().parent / "logs"
_UNSAFE_FILENAME_CHARS = re.compile(r'[^A-Za-z0-9_-]')
_fallback_csv_loggers: dict[str, CsvLogger] = {}
EEG_MQTT_BROKER = os.environ.get("EEG_MQTT_BROKER", "ob1f0f10.ala.asia-southeast1.emqxsl.com")
EEG_MQTT_PORT = int(os.environ.get("EEG_MQTT_PORT", "8883"))
# No env-var override here, unlike the other EEG_MQTT_* settings above --
# deliberate, matching physiological's MQTT_TOPIC (backend/common/config.py),
# the one setting on that side with no override either. This code's own
# default drifted out of sync with the firmware's real topic for a while
# (firmware moved to "mindpulse/wearable02/eeg", this stayed on the old
# ".../sensors" default) -- an override would only add a SECOND place that
# value could silently diverge from the firmware's, with no trace of it in
# the codebase. Change the literal below if the firmware's topic ever
# changes again; don't reintroduce an override.
EEG_MQTT_TOPIC = "mindpulse/wearable02/eeg"
EEG_MQTT_USER = os.environ.get("EEG_MQTT_USER", "wearable02")
EEG_MQTT_PASSWORD = os.environ.get("EEG_MQTT_PASSWORD", "wearable02")
EEG_MQTT_CA_CERT = os.path.join(
    Path(__file__).resolve().parents[2], "iot_firmware", "emqxsl-ca.crt"
)

os.environ.setdefault("PSYCHOLOGICAL_FLASK_URL", "https://mindpulse-eeg.onrender.com")

FLASK_URL = os.environ.get("PSYCHOLOGICAL_FLASK_URL") or \
    f"http://127.0.0.1:{os.environ.get('PSYCHOLOGICAL_PORT', '5001')}"
USER_ID = os.environ.get("EEG_BRIDGE_USER_ID") or None
SESSION_ID = os.environ.get("EEG_SESSION_ID") or "wearable02_" + time.strftime("%Y%m%dT%H%M%S")
POINTER_POLL_INTERVAL_SEC = 10.0

AUTH_HEADERS = auth_headers(USER_ID) if USER_ID else None


def _poll_session_pointer() -> str | None:
    try:
        resp = requests.get(
            f"{FIREBASE_DB_URL}{RTDB_NAMESPACES['psychological']}/{CURRENT_SESSION_ID_FIELD}.json", timeout=5
        )
        value = resp.json()
        return value if isinstance(value, str) and value else None
    except Exception:
        return None


def _poll_user_pointer() -> str | None:
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
        "code": [s.code for s in samples],
    }


def _post_json_retrying(url: str, payload: dict, headers, timeout: float, label: str):
    """post_json() (backend/common/mqtt_bridge.py), retried a couple of
    times on failure before giving up -- see RETRY_DELAYS_SEC's comment.
    Left in this caller rather than post_json() itself since it's shared
    with the physiological bridge, which has its own retry needs (or lack
    of them)."""
    data = post_json(url, payload, headers, timeout, label=label)
    for attempt, delay in enumerate(RETRY_DELAYS_SEC, start=1):
        if data is not None:
            return data
        print(f"[{label}] attempt {attempt} failed -- retrying in {delay:.0f}s")
        time.sleep(delay)
        data = post_json(url, payload, headers, timeout, label=label)
    return data


def _get_fallback_logger(session_id: str) -> CsvLogger:
    """Lazily opens (once per session_id, kept open/appended-to for the
    rest of that session) a local CSV that /predict blocks fall back to
    once retries are exhausted -- so a block that never reached the
    server is still recoverable instead of vanishing with no trace
    anywhere (the server's own CsvLogger, backend/psychological/app.py,
    never runs for a request that never landed)."""
    logger = _fallback_csv_loggers.get(session_id)
    if logger is None:
        FALLBACK_LOG_DIR.mkdir(exist_ok=True)
        safe_id = _UNSAFE_FILENAME_CHARS.sub('_', session_id)
        path = FALLBACK_LOG_DIR / f"{safe_id}_failed_blocks.csv"
        logger = CsvLogger(str(path), RAW_FIELDS_BIPOLAR)
        _fallback_csv_loggers[session_id] = logger
        print(f"[predict] opened fallback CSV for dropped blocks: {path}")
    return logger


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
    client = make_bipolar_client(EEG_MQTT_BROKER, EEG_MQTT_PORT, EEG_MQTT_TOPIC, buffer,
                                  client_id="eeg_bridge_wearable02", username=EEG_MQTT_USER,
                                  password=EEG_MQTT_PASSWORD, ca_cert=EEG_MQTT_CA_CERT)

    calibration_blocks = []
    calibrated = False
    block_idx = 0
    last_pointer_poll = 0.0
    last_empty_buffer_warn = 0.0

    try:
        while True:
            # One unexpected exception anywhere in this iteration (a bad
            # packet, a transient library error) used to kill the whole
            # bridge with nothing to bring it back -- caught here instead
            # so it logs, reconnects MQTT, and the loop keeps going.
            # KeyboardInterrupt is a BaseException, not Exception, so it
            # still propagates straight to the outer handler below.
            try:
                # Rotation check: has StressApp started a new session since we
                # last looked? Throttled to POINTER_POLL_INTERVAL_SEC -- this is
                # a cheap read, but no reason to hit Firebase every 0.5s loop
                # iteration.
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

                # Local-only liveness check -- no raw data leaves this process
                # for this (see module docstring: raw samples only ever go out
                # over the already-required /predict call, once a full block is
                # ready, never as a standalone preview). Just a periodic log so
                # "nothing arriving from wearable02" is still diagnosable from
                # this process's own output, minus any Render/Firebase round-trip.
                if buffer.peek_count() == 0 and now - last_empty_buffer_warn >= EMPTY_BUFFER_WARN_INTERVAL_SEC:
                    print("[bridge] no raw samples buffered -- nothing arriving from wearable02 over MQTT")
                    last_empty_buffer_warn = now

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
                        #
                        # allow_degraded=True -- backstop for the rare case
                        # none of the N_CALIBRATION_BLOCKS clear even the
                        # QUESTIONABLE bar (see RealtimeInference's
                        # calibration_min_rating docstring): falls back to
                        # whichever single block scored best instead of
                        # failing outright and looping forever. Result is
                        # explicitly flagged baseline_degraded=True
                        # throughout (dashboard, decision confidence) --
                        # never silently treated as a clean calibration.
                        data = _post_json_retrying(
                            f"{FLASK_URL}/calibrate",
                            {"session_id": SESSION_ID, "blocks": calibration_blocks, "allow_degraded": True},
                            AUTH_HEADERS, timeout=45, label="calibrate",
                        )
                        calibrated = bool(data and data.get("success"))
                        if calibrated:
                            print(f"[calibrate] calibrated_baseline(resting_calibrated_p)="
                                  f"{data.get('resting_calibrated_p')} "
                                  f"personal_threshold={data.get('personal_high_load_p')} "
                                  f"degraded={data.get('baseline_degraded')}")
                        else:
                            print("[calibrate] failed after retries -- discarding these "
                                  "blocks, retrying with a fresh set")
                            calibration_blocks = []
                    continue

                # Personal threshold task (compute_personal_threshold(),
                # sam40/decision.py) is captured on-demand now -- the
                # onboarding screen (EegThresholdTaskScreen.js) calls
                # POST /calibrate/threshold/start directly against a
                # short-lived MQTT connection of its own (see
                # eeg_calibration_capture.py::run_eeg_threshold_capture()),
                # not by flagging this always-on bridge to intercept the
                # next few live blocks. Every calibrated block just goes
                # straight to /predict below.
                data = _post_json_retrying(
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
                              f"personal_threshold={data.get('personal_threshold')} "
                              f"high_load_alert={data.get('high_load_alert')}")
                        bipolar = ((data.get("features_eeg") or {}).get("bipolar")) or {}
                        feat_str = ", ".join(
                            f"{k}={bipolar[k]:.3f}" for k in FEATURE_LOG_KEYS if bipolar.get(k) is not None
                        )
                        if feat_str:
                            print(f"[predict] block {block_idx} features: {feat_str}")
                else:
                    print(f"[predict] block {block_idx} FAILED after retries -- "
                          f"saving to fallback CSV instead of losing it")
                    log_raw_block_bipolar(_get_fallback_logger(SESSION_ID), samples)
                block_idx += 1

            except Exception as e:
                print(f"[bridge] unexpected error: {e!r} -- reconnecting MQTT in "
                      f"{RECONNECT_DELAY_SEC:.0f}s")
                old_lock_fh = getattr(client, "_instance_lock_fh", None)
                try:
                    client.loop_stop()
                    client.disconnect()
                except Exception:
                    pass
                if old_lock_fh is not None:
                    old_lock_fh.close()  # release the single-instance lock before re-acquiring it below
                time.sleep(RECONNECT_DELAY_SEC)
                client = make_bipolar_client(EEG_MQTT_BROKER, EEG_MQTT_PORT, EEG_MQTT_TOPIC, buffer,
                                              client_id="eeg_bridge_wearable02", username=EEG_MQTT_USER,
                                              password=EEG_MQTT_PASSWORD, ca_cert=EEG_MQTT_CA_CERT)

    except KeyboardInterrupt:
        print("\nStopping bridge...")
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    run()
