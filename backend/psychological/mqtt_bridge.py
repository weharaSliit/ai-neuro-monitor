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
from backend.psychological.firebase_service import (
    get_recalibration_request, save_eeg_device_heartbeat, update_recalibration_request,
)
from backend.psychological.realtime.csv_logger import CsvLogger, RAW_FIELDS_BIPOLAR, log_raw_block_bipolar
from backend.psychological.realtime.mqtt_client import RawSampleBuffer, make_bipolar_client
from backend.psychological.realtime.resample import SOURCE_FS

BLOCK_SEC = 25.0
BLOCK_SAMPLES = int(BLOCK_SEC * SOURCE_FS)
# Calibration protocol (shared with the ring -- backend/common/config.py):
# 2 min settle (discarded) -> resting baseline 10 x 25 s blocks (~4 min,
# natural breathing, eyes open; the server also drops each request's first
# block as its settling block, so 9 are scored and >= 8 must be usable) ->
# high-load task 19 blocks (8 min) -> recovery rest 7 blocks (~3 min).
N_CALIBRATION_BLOCKS = 10
CALIBRATION_SETTLE_SEC = 120.0
N_RECOVERY_BLOCKS = 7
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
MIN_TRUSTED_REST_BLOCKS = 8          # of the 9 scored per request (protocol: 8 minimum usable)
MAX_CALIBRATION_WINDOW_BLOCKS = 12   # a couple of rejected blocks can be replaced before falling back
DEGRADED_FALLBACK_AFTER_BLOCKS = 20  # ~8 min of rest without 8 usable blocks -> degraded baseline

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


def _post_threshold(blocks: list[dict], recovery_blocks: list[dict] | None = None) -> dict | None:
    """POST the live task blocks (and recovery-rest blocks) to
    /calibrate/threshold (same method as the onboarding task). Returns the
    outcome, or None if the server failed."""
    for attempt, delay in enumerate((0.0, *RETRY_DELAYS_SEC)):
        if delay:
            time.sleep(delay)
        try:
            resp = requests.post(f"{FLASK_URL}/calibrate/threshold", headers=AUTH_HEADERS, timeout=120,
                                 json={"session_id": SESSION_ID, "blocks": blocks,
                                       "recovery_blocks": recovery_blocks or []})
            body = resp.json() if resp.content else None
            if resp.ok and body:
                return body
            print(f"[calibrate] threshold HTTP {resp.status_code}: {resp.text[:200]!r}")
            if resp.status_code == 400:
                return body
        except (requests.RequestException, ValueError) as e:
            print(f"[calibrate] threshold request failed: {e}")
    return None


def _post_live_point(samples, phase: str, n: int) -> None:
    """Live calibration graph (psy_web): score this block (stateless
    /calibrate/preview) and append it to eeg_recalibration/{sid}/live/{n}.
    One attempt, best-effort -- a missed point only leaves a gap in the
    graph; the calibration itself still uses the batch calls."""
    try:
        resp = requests.post(f"{FLASK_URL}/calibrate/preview", headers=AUTH_HEADERS, timeout=20,
                             json={"session_id": SESSION_ID, "phase": phase, **block_payload(samples)})
        body = resp.json() if resp.ok and resp.content else {}
    except (requests.RequestException, ValueError):
        body = {}
    update_recalibration_request(SESSION_ID, {f"live/{n}": {
        "phase": phase, "t": time.time(), "score": body.get("score"), "trusted": body.get("trusted")}})


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


# A new session started within this long of a finished recalibration
# inherits it (same rest/task/recovery blocks, re-posted for the new
# session id) instead of settling and calibrating from scratch.
RECAL_CARRY_MAX_AGE_SEC = 30 * 60


def _carry_recalibration(carry: dict, old_session_id: str) -> bool:
    """Calibrates the (new) SESSION_ID from a just-finished recalibration's
    blocks. True if the resting baseline was set."""
    outcome, data = _post_calibrate(carry["rest"], allow_degraded=True)
    if outcome != "ok":
        print(f"[calibrate] couldn't carry the recalibration over ({outcome}) -- calibrating afresh")
        return False
    print(f"[calibrate] new session inherits the recalibration from {old_session_id!r} "
          f"({len(carry['rest'])} rest, {len(carry['task'])} task, {len(carry['recovery'])} recovery blocks)")
    fields = {"status": "done", "phase": "done", "carried_from": old_session_id, "user_id": USER_ID,
              "mu_rest": (data or {}).get("mu_rest"), "usable_blocks": (data or {}).get("n_blocks")}
    if carry["task"]:
        thr = _post_threshold(carry["task"], carry["recovery"]) or {}
        fields["threshold"] = {k: thr.get(k) for k in ("status", "responsive", "calibration_status", "personal_direction",
                                                        "separation_sd", "reversal_sd", "threshold_method")}
    update_recalibration_request(SESSION_ID, fields)
    return True


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
    # Protocol phase 1: discard the first CALIBRATION_SETTLE_SEC before any
    # resting baseline (at startup, on a new session, on a recalibration).
    settle_until = time.time() + CALIBRATION_SETTLE_SEC
    print(f"[calibrate] settling for {CALIBRATION_SETTLE_SEC:.0f}s before the resting baseline "
          f"(data discarded) -- headband on, sit comfortably")
    calibrated = False
    # True while a psy_web recalibration request is being served -- its
    # progress is reported back to eeg_recalibration/{session}.
    recal_active = False
    # Task phase of a recalibration that also asked for the high-load
    # threshold (request "include_threshold"): live blocks collected while
    # the user does the task, sent to /calibrate/threshold when complete.
    recal_task_needed = 0
    recal_task_blocks: list[dict] = []
    recal_rest_result: dict = {}
    recal_recovery_needed = 0          # recovery-rest blocks still to record (protocol phase 4)
    recal_recovery_blocks: list[dict] = []
    recal_live_n = 0                   # next eeg_recalibration/{sid}/live/{n} point
    # A finished recalibration's blocks, kept so a new session the app
    # starts right afterwards inherits it instead of starting over.
    recal_carry: dict | None = None
    recal_rest_blocks: list[dict] = []
    deferred_rotation_to: str | None = None
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
                    pointer_user_id = _poll_user_pointer()
                    # A recalibration in progress for the SAME user isn't
                    # thrown away when the app opens a new session (reopen,
                    # re-login, device takeover): the switch waits until it
                    # finishes, then the new session inherits it (below).
                    # Two runs were lost this way, one 11 blocks into the task.
                    same_user = pointer_user_id in (None, USER_ID)
                    if (pointer_session_id and pointer_session_id != SESSION_ID and same_user
                            and (recal_active or recal_task_needed or recal_recovery_needed)):
                        if deferred_rotation_to != pointer_session_id:
                            print(f"[session] app started {pointer_session_id!r} -- switching after the "
                                  f"recalibration in progress on {SESSION_ID!r} finishes")
                            update_recalibration_request(SESSION_ID, {"deferred_session": pointer_session_id})
                            deferred_rotation_to = pointer_session_id
                        pointer_session_id = None
                    if pointer_session_id and pointer_session_id != SESSION_ID:
                        print(f"[session] rotating {SESSION_ID!r} -> {pointer_session_id!r} "
                              f"(app started a new session) -- recalibrating")
                        deferred_rotation_to = None
                        old_session_id = SESSION_ID
                        if recal_active or recal_task_needed or recal_recovery_needed:
                            update_recalibration_request(SESSION_ID, {"status": "superseded"})
                            recal_active = False
                            recal_task_needed = 0
                            recal_task_blocks = []
                            recal_recovery_needed = 0
                            recal_recovery_blocks = []
                        SESSION_ID = pointer_session_id
                        settle_until = now + CALIBRATION_SETTLE_SEC
                        calibrated = False
                        calibration_blocks = []
                        calibration_blocks_seen = 0
                        block_idx = 0
                        carry = recal_carry
                        recal_carry = None
                        if (carry and same_user and carry["user"] == USER_ID
                                and now - carry["at"] <= RECAL_CARRY_MAX_AGE_SEC):
                            if _carry_recalibration(carry, old_session_id):
                                settle_until = now
                                calibrated = True
                        if not calibrated:
                            print(f"[calibrate] settling for {CALIBRATION_SETTLE_SEC:.0f}s before the resting baseline")

                    if pointer_user_id and pointer_user_id != USER_ID:
                        print(f"[user] rotating {USER_ID!r} -> {pointer_user_id!r} "
                              f"(app is now logged in as a different user)")
                        USER_ID = pointer_user_id
                        AUTH_HEADERS = auth_headers(USER_ID)

                    # Recalibration request (psy_web's Recalibrate button):
                    # drop this session's baseline and capture fresh rest
                    # blocks, exactly like a new session would. Handled once:
                    # the status moves on from "requested" straight away.
                    req = get_recalibration_request(SESSION_ID)
                    if req and req.get("status") == "requested":
                        print(f"[calibrate] recalibration requested from {req.get('source') or 'psy_web'} -- "
                              f"discarding this session's baseline: {CALIBRATION_SETTLE_SEC:.0f}s settle, then "
                              f"{N_CALIBRATION_BLOCKS} rest blocks ({N_CALIBRATION_BLOCKS * 25}s)")
                        calibrated = False
                        calibration_blocks = []
                        calibration_blocks_seen = 0
                        buffer.clear()   # the block in progress may not be rest
                        recal_active = True
                        settle_until = now + CALIBRATION_SETTLE_SEC
                        recal_recovery_needed = 0
                        recal_recovery_blocks = []
                        recal_task_blocks = []
                        recal_live_n = 0
                        recal_task_needed = (int(req.get("task_blocks") or N_THRESHOLD_TASK_BLOCKS)
                                             if req.get("include_threshold") else 0)
                        update_recalibration_request(SESSION_ID, {
                            "status": "capturing", "phase": "settle", "blocks_captured": 0, "live": None,
                            "settle_sec": CALIBRATION_SETTLE_SEC, "settle_until": settle_until,
                            "blocks_needed": N_CALIBRATION_BLOCKS, "handled_at": now,
                            "task_blocks_needed": recal_task_needed,
                            "recovery_blocks_needed": N_RECOVERY_BLOCKS if recal_task_needed else 0,
                        })

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
                # Headband heartbeat: every 5 s while samples are really
                # arriving -- also while settling, so the device shows online.
                last_sample_at = getattr(buffer, 'last_append', None)
                if (last_sample_at is not None and now - last_sample_at < 8
                        and now - last_heartbeat >= 5):
                    save_eeg_device_heartbeat()
                    last_heartbeat = now
                if now < settle_until:
                    buffer.clear()
                    time.sleep(0.5)
                    continue

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
                    if recal_active:
                        update_recalibration_request(SESSION_ID, {"status": "capturing", "phase": "rest",
                                                                  "blocks_captured": calibration_blocks_seen})
                        _post_live_point(samples, "rest", recal_live_n)
                        recal_live_n += 1
                    if len(calibration_blocks) >= N_CALIBRATION_BLOCKS:
                        fallback = calibration_blocks_seen >= DEGRADED_FALLBACK_AFTER_BLOCKS
                        outcome, data = _post_calibrate(calibration_blocks, allow_degraded=fallback)
                        n_trusted = (data or {}).get("n_blocks") or 0
                        if outcome == "ok" and (fallback or n_trusted >= MIN_TRUSTED_REST_BLOCKS):
                            calibrated = True
                            calibration_blocks_seen = 0
                            if recal_active:
                                recal_active = False
                                recal_rest_blocks = list(calibration_blocks)
                                recal_rest_result = {
                                    "outcome": data.get("status"),
                                    "usable_blocks": n_trusted, "mu_rest": data.get("mu_rest"),
                                    "personal_high_load_p": data.get("personal_high_load_p"),
                                    "baseline_degraded": bool(data.get("baseline_degraded")),
                                    "amplitude_gain": data.get("amplitude_gain"),
                                }
                                if recal_task_needed and data.get("mu_rest") is not None:
                                    # Phase 2: the next live blocks are the task.
                                    recal_task_blocks = []
                                    update_recalibration_request(SESSION_ID, {
                                        "status": "capturing", "phase": "task", "rest": recal_rest_result,
                                        "blocks_captured": 0, "blocks_needed": recal_task_needed,
                                    })
                                    print(f"[calibrate] resting baseline set -- now the high-load task: "
                                          f"{recal_task_needed} blocks ({recal_task_needed * 25}s) of mental arithmetic")
                                else:
                                    skipped = bool(recal_task_needed)   # task wanted, but no usable mu_rest
                                    if skipped:
                                        print("[calibrate] no usable resting level -- high-load task skipped")
                                    recal_task_needed = 0
                                    update_recalibration_request(SESSION_ID, {
                                        "status": "done", "phase": "done", **recal_rest_result,
                                        **({"task_skipped": "no usable resting level"} if skipped else {}),
                                    })
                                    recal_carry = {"user": USER_ID, "at": time.time(), "rest": list(calibration_blocks),
                                                   "task": [], "recovery": []}
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
                            if recal_active:
                                update_recalibration_request(SESSION_ID, {
                                    "status": "capturing", "last_reason": (data or {}).get("message")
                                    or "no rest block passed the quality gate yet"})
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
                # Recalibration task phase: this live block is also a
                # high-load task block. It is still scored by /predict below,
                # so the live view keeps running during the task.
                if recal_recovery_needed:
                    # Protocol phase 4: recovery rest after the task.
                    recal_recovery_blocks.append(block_payload(samples))
                    n_rec = len(recal_recovery_blocks)
                    print(f"[calibrate] captured recovery block {n_rec}/{recal_recovery_needed}")
                    _post_live_point(samples, "recovery", recal_live_n)
                    recal_live_n += 1
                    update_recalibration_request(SESSION_ID, {"status": "capturing", "phase": "recovery",
                                                              "blocks_captured": n_rec,
                                                              "blocks_needed": recal_recovery_needed})
                    if n_rec >= recal_recovery_needed:
                        update_recalibration_request(SESSION_ID, {"status": "saving", "phase": "recovery"})
                        thr = _post_threshold(recal_task_blocks, recal_recovery_blocks)
                        recal_carry = {"user": USER_ID, "at": time.time(), "rest": list(recal_rest_blocks),
                                       "task": list(recal_task_blocks), "recovery": list(recal_recovery_blocks)}
                        recal_recovery_needed = 0
                        recal_task_blocks = []
                        recal_recovery_blocks = []
                        if thr and thr.get("status"):
                            print(f"[calibrate] high-load threshold: status={thr.get('status')} "
                                  f"task_response_z={thr.get('task_response_z')} limit={thr.get('personal_high_load_p')} "
                                  f"| recovery z={thr.get('recovery_z')} recovered={thr.get('recovered')}")
                            update_recalibration_request(SESSION_ID, {
                                "status": "done", "phase": "done", **recal_rest_result,
                                "threshold": {k: thr.get(k) for k in (
                                    "status", "responsive", "task_response_z", "personal_high_load_p",
                                    "resting_mean", "task_mean", "n_task_blocks", "calibration_status",
                                    "personal_direction", "separation_sd", "reversal_sd", "aba_confirmed",
                                    "threshold_method")},
                                "recovery": {k: thr.get(k) for k in (
                                    "recovery_mean", "recovery_z", "recovered", "n_recovery_blocks")},
                            })
                        else:
                            update_recalibration_request(SESSION_ID, {
                                "status": "done", "phase": "done", **recal_rest_result,
                                "threshold_error": (thr or {}).get("error") or "server unreachable"})
                elif recal_task_needed:
                    # Protocol phase 3: this live block is also a high-load
                    # task block. It is still scored by /predict below, so
                    # the live view keeps running during the task.
                    recal_task_blocks.append(block_payload(samples))
                    n_task = len(recal_task_blocks)
                    print(f"[calibrate] captured task block {n_task}/{recal_task_needed}")
                    _post_live_point(samples, "task", recal_live_n)
                    recal_live_n += 1
                    update_recalibration_request(SESSION_ID, {"status": "capturing", "phase": "task",
                                                              "blocks_captured": n_task})
                    if n_task >= recal_task_needed:
                        recal_task_needed = 0
                        recal_recovery_needed = N_RECOVERY_BLOCKS
                        recal_recovery_blocks = []
                        print(f"[calibrate] task done -- recovery rest: {N_RECOVERY_BLOCKS} blocks "
                              f"({N_RECOVERY_BLOCKS * 25}s), sit still and relax")
                        update_recalibration_request(SESSION_ID, {"status": "capturing", "phase": "recovery",
                                                                  "blocks_captured": 0,
                                                                  "blocks_needed": N_RECOVERY_BLOCKS})

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
                        # No word "alert" here: Render's log viewer reads it as a
                        # log level and marks every normal block as an error.
                        print(f"[predict] block {block_idx} "
                              f"task_state_score={fmt(data.get('task_state_score'), '.3g')} "
                              + (f"(z={z:+.2f} vs own rest; high load at z>=0.84) " if z is not None else "")
                              + f"label={data.get('task_state_label')} "
                              f"personal_threshold={fmt(data.get('personal_threshold'), '.3g')} "
                              f"high_load={'YES' if data.get('high_load_alert') else 'no'}")
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
