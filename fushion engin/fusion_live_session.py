import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import fusion_engin
from backend.common.firebase_config import (
    CURRENT_SESSION_ID_FIELD, FIREBASE_DB_URL, FUSION_EN_ROOT, FUSION_EN_SESSIONS_ROOT,
)
from backend.psychological.realtime.firebase_sync import _trend_direction  # noqa: E402

BASELINE_N = 3 


def _init_firebase(cred_path: str, db_url: str):
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
    data = session_ref.get() or {}
    return {k: v for k, v in data.items() if str(k).isdigit() and isinstance(v, dict)}


def poll_once(session_ref, eeg_session_ref) -> dict:
    # Both modalities now write their own raw contribution DIRECTLY into
    # fusion_en/{session_id}/{window} -- the ring via save_fusion_en_rtdb(),
    # EEG via EegFirebaseSession.push()/make_eeg_fusion_record() -- so a
    # single read here already has whichever side(s) have reported, with no
    # separate merge step (or dependency on eeg_session_ref for the raw
    # fields) needed. eeg_session_ref is still used below purely to write
    # this poll's fused SUMMARY (fused_stress_label/fused_stress_probability)
    # into fusion_en_sessions.
    windows = load_session_windows(session_ref)
    if not windows:
        return {"windows_fused": [], "baseline_ready": False}

    fusable_keys = [
        k for k, v in windows.items()
        if v.get("prob_eeg") is not None or v.get("prob_hrv_gsr") is not None
    ]
    fusable_keys.sort(key=lambda k: int(k))
    fused_by_key = {}
    if fusable_keys:
        fused_rows = fusion_engin.compute_fusion_for_records([windows[k] for k in fusable_keys])
        for k, fused in zip(fusable_keys, fused_rows):
            fused_by_key[k] = fused
            windows[k]["fused_probability"] = fused["fused_probability"]
            windows[k]["fused_label"] = fused["fused_label"]

    ordered_keys = sorted(windows.keys(), key=lambda k: int(k))
    fused_history = [windows[k].get("fused_probability") for k in ordered_keys]
    valid_fused = [v for v in fused_history if v is not None]
    baseline_mean = float(np.mean(valid_fused[:BASELINE_N])) if len(valid_fused) >= BASELINE_N else None

    updated = []
    for i, k in enumerate(ordered_keys):
        if windows[k].get("fused_probability") is None:
            continue
        trend = _trend_direction(fused_history[: i + 1])
        fused = fused_by_key[k]
        write = {
            "fused_probability": windows[k]["fused_probability"],
            "fused_label": windows[k]["fused_label"],
            "stress_trend": trend,
            "eeg_weight": fused.get("eeg_reliability_weight_norm"),
            "hrv_gsr_weight": fused.get("hrv_gsr_reliability_weight_norm"),
        }

        if not fused.get("eeg_missing"):
            write["prob_eeg"] = fused.get("prob_eeg")
        if not fused.get("hrv_gsr_missing"):
            write["prob_hrv_gsr"] = fused.get("prob_hrv_gsr")

        write["stress_deviation"] = (
            windows[k]["fused_probability"] - baseline_mean
            if baseline_mean is not None
            else None
        )
        session_ref.child(k).update(write)

        eeg_session_ref.child(k).update({
            "fused_stress_label": "high_stress" if windows[k]["fused_label"] == 1 else "low_stress",
            "fused_stress_probability": windows[k]["fused_probability"],
        })
        updated.append(k)

    return {"windows_fused": updated, "baseline_ready": baseline_mean is not None}


def _session_refs(db_mod, session_id: str) -> dict:
    return {
        "session_ref": db_mod.reference(f"{FUSION_EN_ROOT}/{session_id}"),
        "eeg_session_ref": db_mod.reference(f"{FUSION_EN_SESSIONS_ROOT}/{session_id}"),
        "started_at_ref": db_mod.reference(f"{FUSION_EN_SESSIONS_ROOT}/{session_id}/started_at"),
        "ended_at_ref": db_mod.reference(f"{FUSION_EN_SESSIONS_ROOT}/{session_id}/ended_at"),
    }


def run(session_id: str | None, poll_interval_sec: float, cred_path: str, db_url: str):
    """session_id: a manual pin/override for standalone debugging -- when
    None (the normal case), this process instead follows whatever
    StressApp (App.js) has published at
    {FUSION_EN_SESSIONS_ROOT}/current_session_id, polling it every
    poll_interval_sec and rotating onto a new id the moment the app opens
    (or reuses) one -- see backend/common/firebase_config.py's
    CURRENT_SESSION_ID_FIELD docstring. Rotation writes ended_at onto the
    OLD session (it just, by definition, ended) and started_at onto the
    new one, replacing the old ended-flag pause/resume mechanism entirely:
    that existed to stop a SHARED, eternally-reused session_id from being
    fused into while nobody watched, which is no longer a real risk once
    every app-open mints its own genuinely new id."""
    db_mod = _init_firebase(cred_path, db_url)
    manual_override = session_id is not None
    pointer_ref = db_mod.reference(f"{FUSION_EN_SESSIONS_ROOT}/{CURRENT_SESSION_ID_FIELD}")

    current_session_id = session_id or pointer_ref.get()
    refs = None

    def _switch_to(new_session_id: str, *, is_rotation: bool):
        nonlocal current_session_id, refs
        if is_rotation and refs is not None:
            refs["ended_at_ref"].set(datetime.now(timezone.utc).isoformat())
            print(f"[fusion_live_session] session {current_session_id} ended "
                  f"(app started a new session)")
        current_session_id = new_session_id
        refs = _session_refs(db_mod, current_session_id)
        if refs["started_at_ref"].get() is None:
            refs["started_at_ref"].set(datetime.now(timezone.utc).isoformat())
        print(
            f"[fusion_live_session] watching fusion_en/{current_session_id} "
            f"+ fusion_en_sessions/{current_session_id} (EEG) "
            f"(poll every {poll_interval_sec}s) -- Ctrl+C to stop early"
        )

    if current_session_id:
        _switch_to(current_session_id, is_rotation=False)
    else:
        print(f"[fusion_live_session] no session_id yet -- waiting for the app to open "
              f"(polling {FUSION_EN_SESSIONS_ROOT}/{CURRENT_SESSION_ID_FIELD} every {poll_interval_sec}s)")

    try:
        while True:
            if not manual_override:
                try:
                    pointer_session_id = pointer_ref.get()
                    if pointer_session_id and pointer_session_id != current_session_id:
                        _switch_to(pointer_session_id, is_rotation=True)
                except Exception as e:
                    print(f"[fusion_live_session] session-pointer poll failed ({e}) -- "
                          f"retrying in {poll_interval_sec}s")
                    time.sleep(poll_interval_sec)
                    continue

            if refs is None:
                time.sleep(poll_interval_sec)
                continue

            try:
                result = poll_once(refs["session_ref"], refs["eeg_session_ref"])
            except Exception as e:
                print(f"[fusion_live_session] poll failed ({e}) -- retrying in {poll_interval_sec}s")
                time.sleep(poll_interval_sec)
                continue

            n = len(result.get("windows_fused", []))
            baseline_note = "" if result.get("baseline_ready") else " (establishing baseline...)"
            print(f"[fusion_live_session] fused {n} window(s){baseline_note}")
            time.sleep(poll_interval_sec)
    except KeyboardInterrupt:
        print("\n[fusion_live_session] stopped (Ctrl+C)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--session-id",
        default=None,
        help="Pin to this session id and IGNORE the live app-driven pointer -- for standalone "
        "debugging only. Normal runs should omit this: the process follows "
        "{FUSION_EN_SESSIONS_ROOT}/current_session_id (written by StressApp's App.js) instead.",
    )
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
