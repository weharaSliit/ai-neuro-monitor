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
from backend.psychological.firebase_service import save_eeg_device_heartbeat
from backend.psychological.realtime.csv_logger import CsvLogger, RAW_FIELDS_BIPOLAR, log_raw_block_bipolar
from backend.psychological.realtime.mqtt_client import RawSampleBuffer, make_bipolar_client
from backend.psychological.realtime.resample import SOURCE_FS

BLOCK_SEC = 25.0
BLOCK_SAMPLES = int(BLOCK_SEC * SOURCE_FS)
N_CALIBRATION_BLOCKS = 3
EMPTY_BUFFER_WARN_INTERVAL_SEC = 5.0

# EEG_BRIDGE_VERBOSE=1 prints every full /predict and /calibrate JSON body;
# by default only the one-line summaries below (and any error responses).
VERBOSE = os.environ.get("EEG_BRIDGE_VERBOSE", "0") == "1"

# After wearable02 restarts, the ADS1292R and its bias (RLD) drive need time
# to settle: the first blocks after a manual restart were 38-48% out of range.
# The server's own settling window only covers the start of a session, not a
# mid-session device restart, so the bridge discards everything for this
# long after one -- and drops a half-built calibration, so rest blocks from
# before and after the restart are never mixed into one baseline.
REBOOT_SETTLE_SEC = 30.0

# Calibration keeps collecting rest blocks until the server accepts a
# STRICT (non-degraded) calibration with at least MIN_TRUSTED_REST_BLOCKS
# usable blocks -- the Personal Scale's two rest blocks (paper Sect.
# "Personal EEG Threshold"). Before, the bridge sent its first 3 blocks with
# allow_degraded=True, so a session could be calibrated on a block the
# quality gate scored 0.0 (seen live: session_20261012T214937). Each attempt
# sends the most recent MAX_CALIBRATION_WINDOW_BLOCKS (the first block of
# every request is the server's settling block). Only after
# DEGRADED_FALLBACK_AFTER_BLOCKS blocks (~3.5 min) without success does it
# accept a degraded baseline -- which the Personal Scale then keeps out of
# fusion (firebase_sync.py::eeg_fusion_exclusion()).
MIN_TRUSTED_REST_BLOCKS = 2
MAX_CALIBRATION_WINDOW_BLOCKS = 6
DEGRADED_FALLBACK_AFTER_BLOCKS = 8

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

# The broker keeps this bridge's MQTT session (and queues the headband's
# messages) for this long after a disconnect, so a reconnect -- Render
# network blips, a restart -- delays samples instead of punching a hole in
# the stream that costs a whole 25 s block. Kept short: a backlog older
# than this is stale for live use anyway. 0 = no session (old behaviour).
MQTT_SESSION_EXPIRY_SEC = int(os.environ.get("EEG_MQTT_SESSION_EXPIRY_SEC", "120"))

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
    data = post_json(url, payload, headers, timeout, label=label, verbose=VERBOSE)
    for attempt, delay in enumerate(RETRY_DELAYS_SEC, start=1):
        if data is not None:
            return data
        print(f"[{label}] attempt {attempt} failed -- retrying in {delay:.0f}s")
        time.sleep(delay)
        data = post_json(url, payload, headers, timeout, label=label, verbose=VERBOSE)
    return data


def _latest_block_reason(data: dict | None) -> str:
    """The newest rest block's verdict from /calibrate's block_reports --
    what to fix right now (electrode off, out of range, artefact...)."""
    reports = (data or {}).get("block_reports") or []
    if not reports:
        return ""
    r = reports[-1]
    if r.get("trusted"):
        return " | newest block: passed"
    parts = [r.get("reason") or f"rated {r.get('gate_rating')} ({r.get('quality_score')})"]
    if r.get("std_uV_unclamped") is not None:
        parts.append(f"RMS {r['std_uV_unclamped']} uV")
    return " | newest block: " + ", ".join(parts)


def _post_calibrate(blocks: list[dict], allow_degraded: bool) -> tuple[str, dict | None]:
    """One /calibrate attempt -> ('ok', body) on success, ('rejected', body)
    when the server answered but no block met the quality bar (a 400 --
    deterministic, so NOT retried), or ('error', None) after retrying
    network/5xx failures like _post_json_retrying() does."""
    payload = {"session_id": SESSION_ID, "blocks": blocks, "allow_degraded": allow_degraded}
    for attempt, delay in enumerate((0.0, *RETRY_DELAYS_SEC)):
        if delay:
            print(f"[calibrate] attempt {attempt} failed -- retrying in {delay:.0f}s")
            time.sleep(delay)
        try:
            # 45s: Render's free tier can take 30s+ to wake from a cold start.
            resp = requests.post(f"{FLASK_URL}/calibrate", json=payload, headers=AUTH_HEADERS, timeout=45)
        except requests.RequestException as e:
            print(f"[calibrate] request failed: {e}")
            continue
        try:
            body = resp.json()
        except ValueError:
            body = None
        if resp.ok and body and body.get("success"):
            return "ok", body
        if resp.status_code == 400:
            return "rejected", body
        print(f"[calibrate] HTTP {resp.status_code}: {resp.text[:200]!r}")
    return "error", None


def _server_lost_session(session_id: str) -> bool:
    """True only when the Flask server is reachable AND no longer holds
    session_id in its in-memory eeg_sessions (app.py) -- i.e. it restarted
    (Render redeploy/cold start, local Ctrl-C) since this bridge calibrated.
    Without this the bridge keeps calibrated=True forever and every block
    400s with "not calibrated -- call /calibrate first". Uses /health's
    active_sessions (no auth needed) rather than parsing /predict's error,
    since post_json() returns None for any non-2xx. A network failure here
    returns False -- an unreachable server isn't evidence the session is
    gone, so don't throw away a valid calibration over a blip."""
    try:
        resp = requests.get(f"{FLASK_URL}/health", timeout=45)
        resp.raise_for_status()
        return session_id not in (resp.json().get("active_sessions") or [])
    except Exception:
        return False


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
                                  password=EEG_MQTT_PASSWORD, ca_cert=EEG_MQTT_CA_CERT,
                                  session_expiry_sec=MQTT_SESSION_EXPIRY_SEC)

    calibration_blocks = []
    calibration_blocks_seen = 0
    seen_reboots = buffer.reboot_count
    settle_until = 0.0
    calibrated = False
    block_idx = 0
    last_pointer_poll = 0.0
    last_empty_buffer_warn = 0.0
    last_heartbeat = 0.0

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
                        calibration_blocks_seen = 0
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
                # Device restart (its millis counter went backwards -- detected
                # per packet in RawSampleBuffer, so even after a long outage that
                # emptied the buffer): settle, then start calibration afresh if
                # it was still being built. See REBOOT_SETTLE_SEC.
                if buffer.reboot_count != seen_reboots:
                    seen_reboots = buffer.reboot_count
                    settle_until = now + REBOOT_SETTLE_SEC
                    print(f"[bridge] wearable02 restarted -- ignoring its data for {REBOOT_SETTLE_SEC:.0f}s "
                          f"while the amplifier and bias settle")
                    if not calibrated and calibration_blocks_seen:
                        print(f"[calibrate] discarding {calibration_blocks_seen} rest block(s) from before the "
                              f"restart -- calibration starts again after settling")
                        calibration_blocks = []
                        calibration_blocks_seen = 0
                if now < settle_until:
                    buffer.clear()
                    time.sleep(0.5)
                    continue
                # Headband heartbeat: every 5 s while samples are really arriving.
                last_sample_at = getattr(buffer, 'last_append', None)
                if (last_sample_at is not None and now - last_sample_at < 8
                        and now - last_heartbeat >= 5):
                    save_eeg_device_heartbeat()
                    last_heartbeat = now

                if buffer.peek_count() == 0 and now - last_empty_buffer_warn >= EMPTY_BUFFER_WARN_INTERVAL_SEC:
                    print("[bridge] no raw samples buffered -- nothing arriving from wearable02 over MQTT")
                    last_empty_buffer_warn = now

                if buffer.peek_count() < BLOCK_SAMPLES:
                    time.sleep(0.5)
                    continue

                # A block must be one continuous 25 s run: if the stream broke
                # (Wi-Fi drop, device reboot) inside the next 25 s, drop the
                # samples before the break and wait for a full block after it,
                # instead of sending a block the server rejects whole.
                dropped, gap = buffer.discard_before_gap(BLOCK_SAMPLES)
                if dropped:
                    what = "device reboot" if gap < 0 else f"{gap:.1f}s gap (Wi-Fi drop?)"
                    print(f"[bridge] stream break: {what} -- discarded {dropped / SOURCE_FS:.1f}s "
                          f"before it, starting a fresh block")
                    continue

                samples = buffer.drain(BLOCK_SAMPLES)

                if USER_ID is None:
                    print(f"[block {block_idx}] skipped — no user logged in yet "
                          f"(waiting for the app's current_user_id pointer)")
                    continue

                if not calibrated:
                    calibration_blocks.append(block_payload(samples))
                    calibration_blocks_seen += 1
                    # Rolling window -- old blocks age out instead of the
                    # request growing without bound.
                    calibration_blocks = calibration_blocks[-MAX_CALIBRATION_WINDOW_BLOCKS:]
                    print(f"[calibrate] captured rest block {calibration_blocks_seen} "
                          f"(sit still and relax until calibration completes)")
                    if len(calibration_blocks) >= N_CALIBRATION_BLOCKS:
                        fallback = calibration_blocks_seen >= DEGRADED_FALLBACK_AFTER_BLOCKS
                        outcome, data = _post_calibrate(calibration_blocks, allow_degraded=fallback)
                        n_trusted = (data or {}).get("n_blocks") or 0
                        if outcome == "ok" and (fallback or n_trusted >= MIN_TRUSTED_REST_BLOCKS):
                            calibrated = True
                            calibration_blocks_seen = 0
                            print(f"[calibrate] done: status={data.get('status')} usable_blocks={n_trusted} "
                                  f"mu_rest={data.get('mu_rest')} personal_threshold={data.get('personal_high_load_p')} "
                                  f"degraded={data.get('baseline_degraded')}")
                            if data.get("baseline_degraded"):
                                print("[calibrate] WARNING: no rest block passed the quality gate in "
                                      f"{DEGRADED_FALLBACK_AFTER_BLOCKS} blocks -- degraded baseline: EEG is fused at "
                                      "half weight (EEG_FUSION_POLICY=lenient) or not at all (strict), and blocks "
                                      "the quality gate rejects still aren't fused. Check electrode/bias contact "
                                      "and restart the session.")
                        elif outcome == "ok":
                            print(f"[calibrate] only {n_trusted} usable rest block(s) so far "
                                  f"(need {MIN_TRUSTED_REST_BLOCKS}) -- collecting more{_latest_block_reason(data)}")
                        elif outcome == "rejected":
                            print(f"[calibrate] no rest block passed the quality gate yet "
                                  f"({calibration_blocks_seen}/{DEGRADED_FALLBACK_AFTER_BLOCKS} before fallback) "
                                  f"-- check electrode and bias contact; collecting more{_latest_block_reason(data)}")
                        else:
                            print("[calibrate] server unreachable after retries -- will try again with the next block")
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
                # When this block's LAST sample was actually recorded (host
                # wall clock, via the device-millis anchor in RawSampleBuffer)
                # -- the server stamps the block and buckets it into the
                # fusion grid by this instead of its own processing time,
                # which lags capture by bridge queueing + Render latency +
                # retries (often a full 25s grid cell or more).
                capture_end_ts = buffer.wall_time_for(samples[-1].millis)
                data = _post_json_retrying(
                    f"{FLASK_URL}/predict",
                    {"session_id": SESSION_ID, "capture_end_ts": capture_end_ts, **block_payload(samples)},
                    AUTH_HEADERS, timeout=45, label="predict",
                )
                if data:
                    if data.get("skipped"):
                        oor = data.get("eeg_out_of_range_fraction")
                        print(f"[predict] block {block_idx} SKIPPED (quality gate): "
                              f"{data.get('eeg_quality_reason') or 'see server log'}"
                              + (f" | real RMS={data.get('eeg_std_uv_unclamped')} uV "
                                 f"ptp={data.get('eeg_ptp_uv_unclamped')} uV, "
                                 f"{oor * 100:.2f}% beyond +-100 uV" if oor is not None else "")
                              # .3g: these scores can be ~1e-6 on this headband
                              + (f" | provisional score {data['provisional_task_state_score']:.3g} "
                                 f"(quality {data.get('provisional_quality')}/100)"
                                 if data.get("provisional_task_state_score") is not None else ""))
                    else:
                        fmt = lambda v, spec: "None" if v is None else format(v, spec)  # noqa: E731
                        z = data.get("task_state_z")
                        print(f"[predict] block {block_idx} "
                              f"task_state_score={fmt(data.get('task_state_score'), '.3g')} "
                              + (f"(z={z:+.2f} vs own rest; alert at z>=0.84) " if z is not None else "")
                              + f"label={data.get('task_state_label')} "
                              f"personal_threshold={fmt(data.get('personal_threshold'), '.3g')} "
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
                    if _server_lost_session(SESSION_ID):
                        print(f"[session] server no longer has {SESSION_ID!r} calibrated "
                              f"(Flask restarted?) -- recalibrating with the next "
                              f"{N_CALIBRATION_BLOCKS} blocks")
                        calibrated = False
                        calibration_blocks = []
                        calibration_blocks_seen = 0
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
                                              password=EEG_MQTT_PASSWORD, ca_cert=EEG_MQTT_CA_CERT,
                                              session_expiry_sec=MQTT_SESSION_EXPIRY_SEC, resume=True)

    except KeyboardInterrupt:
        print("\nStopping bridge...")
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    run()
