"""
Live fusion session loop -- watches one active session's RTDB fusion_en/
data, computes fused_probability/fused_label/stress_trend/stress_deviation
per window as new EEG/HRV-GSR predictions arrive, and writes the result
back until the session ends.

Does NOT start or stop the EEG (backend/psychological/app.py) or HRV/GSR
(backend/physiological/app.py) processes -- those already run
independently and each write prob_eeg/prob_hrv_gsr into
fusion_en/{session_id}/{window} per prediction (verified this session to
merge correctly into one node per window across both independently-
written sides). This loop only watches ONE session_id's data and adds the
fused result on top -- whoever operates the EEG/HRV-GSR processes is
responsible for pointing them at the same session_id (EEG's
realtime_inference.py already takes --firebase-session-id; HRV/GSR's
/predict already takes session_id per request).

Usage:
    python3 "fushion engin/fusion_live_session.py" --session-id S1 \\
        --firebase-cred ~/.secrets/stress-monitor-firebase.json \\
        --firebase-db-url https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/

Session end: the mobile client (or anything else with write access) sets
fusion_en_sessions/{session_id}/ended = true directly in RTDB -- a
SIBLING path to fusion_en/{session_id}, not a child of it, specifically so
it's never mistaken for a window row by this loop or by
backend/physiological/firebase_service.py::label_session_ground_truth_rtdb()
(which iterates every child under fusion_en/{session_id} assuming each one
is a window). This loop polls for that flag every cycle and exits cleanly
once it appears.
"""

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import fusion_engin  # noqa: E402 -- same directory as this script (sys.path[0])
from backend.common.firebase_config import FIREBASE_DB_URL  # noqa: E402
from backend.psychological.realtime.firebase_sync import _trend_direction  # noqa: E402

BASELINE_N = 3  # "mean of the first 3 fused readings" -- see module docstring / plan


def _init_firebase(cred_path: str, db_url: str):
    """Same get_app()-or-initialize_app() pattern as FirebaseSync.__init__
    (backend/psychological/realtime/firebase_sync.py) -- reuses an
    already-initialized app (e.g. if this process later also imports
    something that inits firebase_admin) rather than crashing on a second
    init."""
    import firebase_admin
    from firebase_admin import credentials, db

    cred_file = Path(cred_path).expanduser().resolve()
    if not cred_file.is_file():
        raise FileNotFoundError(
            f"Firebase credential not found at {cred_file}. Must be a path OUTSIDE this "
            f"repository -- set it via --firebase-cred or $FIREBASE_CREDENTIALS."
        )
    try:
        firebase_admin.get_app()
    except ValueError:
        cred = credentials.Certificate(str(cred_file))
        firebase_admin.initialize_app(cred, {"databaseURL": db_url})
    return db


def load_session_windows(session_ref) -> dict:
    """session_ref.get() -> {window_key: row_dict}, filtered to keys that
    look like window indices (digits only) and whose value is itself a
    dict -- defensive against any future non-window child appearing under
    fusion_en/{session_id}/ (the session-end flag lives at a SIBLING path
    specifically so it never needs this filter, but this stays as a second
    line of defense)."""
    data = session_ref.get() or {}
    return {k: v for k, v in data.items() if str(k).isdigit() and isinstance(v, dict)}


def poll_once(session_id: str, session_ref, ended_ref) -> dict:
    """One fetch/compute/write cycle. Stateless across calls -- re-reads
    the whole session's windows every time (cheap at research-session
    scale: tens to low-hundreds of 25s windows) rather than tracking
    per-window fusion state, so a late-arriving modality for an
    already-seen window just gets picked up and re-fused on the next poll
    with no bookkeeping needed.

    Returns {'ended': True} if the session-end flag is set (nothing else
    is touched in that case), otherwise
    {'ended': False, 'windows_fused': [...], 'baseline_ready': bool}.
    """
    if ended_ref.get():
        return {"ended": True}

    windows = load_session_windows(session_ref)
    if not windows:
        return {"ended": False, "windows_fused": [], "baseline_ready": False}

    # Fuse every window with at least one real modality -- unconditionally,
    # every poll (idempotent; see module docstring for why this beats
    # tracking "already fused" state per window).
    fusable_keys = [
        k for k, v in windows.items()
        if v.get("prob_eeg") is not None or v.get("prob_hrv_gsr") is not None
    ]
    fusable_keys.sort(key=lambda k: int(k))
    if fusable_keys:
        fused_rows = fusion_engin.compute_fusion_for_records([windows[k] for k in fusable_keys])
        for k, fused in zip(fusable_keys, fused_rows):
            windows[k]["fused_probability"] = fused["fused_probability"]
            windows[k]["fused_label"] = fused["fused_label"]

    # Trend + deviation need ascending window order and the full fused
    # history (not just this poll's newly-fused windows).
    ordered_keys = sorted(windows.keys(), key=lambda k: int(k))
    fused_history = [windows[k].get("fused_probability") for k in ordered_keys]
    valid_fused = [v for v in fused_history if v is not None]
    baseline_mean = float(np.mean(valid_fused[:BASELINE_N])) if len(valid_fused) >= BASELINE_N else None

    updated = []
    for i, k in enumerate(ordered_keys):
        if windows[k].get("fused_probability") is None:
            continue
        trend = _trend_direction(fused_history[: i + 1])
        write = {
            "fused_probability": windows[k]["fused_probability"],
            "fused_label": windows[k]["fused_label"],
            "stress_trend": trend,
        }
        # Retroactively backfills stress_deviation onto earlier windows once
        # baseline_mean becomes available (the 3rd fused reading arrives) --
        # satisfies "mean of the first 3" exactly rather than approximating it.
        write["stress_deviation"] = (
            windows[k]["fused_probability"] - baseline_mean
            if baseline_mean is not None
            else None
        )
        session_ref.child(k).update(write)
        updated.append(k)

    return {"ended": False, "windows_fused": updated, "baseline_ready": baseline_mean is not None}


def run(session_id: str, poll_interval_sec: float, cred_path: str, db_url: str):
    db_mod = _init_firebase(cred_path, db_url)
    session_ref = db_mod.reference(f"fusion_en/{session_id}")
    ended_ref = db_mod.reference(f"fusion_en_sessions/{session_id}/ended")

    print(
        f"[fusion_live_session] watching fusion_en/{session_id} "
        f"(poll every {poll_interval_sec}s) -- Ctrl+C to stop early"
    )
    try:
        while True:
            result = poll_once(session_id, session_ref, ended_ref)
            if result["ended"]:
                print(f"[fusion_live_session] session {session_id} ended -- exiting")
                break
            n = len(result.get("windows_fused", []))
            baseline_note = "" if result.get("baseline_ready") else " (establishing baseline...)"
            print(f"[fusion_live_session] fused {n} window(s){baseline_note}")
            time.sleep(poll_interval_sec)
    except KeyboardInterrupt:
        print("\n[fusion_live_session] stopped (Ctrl+C)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--session-id", required=True)
    ap.add_argument("--poll-interval-sec", type=float, default=5.0)
    ap.add_argument(
        "--firebase-cred",
        default=os.environ.get("FIREBASE_CREDENTIALS"),
        help="Path to a Firebase service-account JSON, OUTSIDE this repo. Defaults to $FIREBASE_CREDENTIALS.",
    )
    ap.add_argument(
        "--firebase-db-url",
        default=os.environ.get("FIREBASE_DB_URL", FIREBASE_DB_URL),
        help="Firebase Realtime Database URL. Defaults to $FIREBASE_DB_URL, or the shared "
        "project URL in backend/common/firebase_config.py.",
    )
    args = ap.parse_args()

    if not args.firebase_cred:
        raise SystemExit("--firebase-cred (or $FIREBASE_CREDENTIALS) is required.")

    run(args.session_id, args.poll_interval_sec, args.firebase_cred, args.firebase_db_url)


if __name__ == "__main__":
    main()
