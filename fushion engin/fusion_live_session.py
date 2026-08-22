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
from backend.common.firebase_config import FIREBASE_DB_URL  
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


# Fields EEG writes at fusion_en_sessions/{session_id}/{window} -- see
# backend/psychological/realtime/firebase_sync.py::make_eeg_fusion_session_record().
_EEG_FUSION_FIELDS = (
    "prob_eeg", "conf_eeg", "model_acc_eeg", "signal_quality_eeg",
    "stress_label_eeg", "timestamp_eeg",
)


def merge_eeg_into_windows(windows: dict, eeg_windows: dict) -> dict:
    """Merges EEG's fusion_en_sessions/{session_id}/{window} fields into the
    ring's fusion_en/{session_id}/{window} dict this function otherwise
    works from. Both sides key by the SAME fusion_window_key() 60s
    wall-clock bucket (backend/common/fusion.py) -- NOT either modality's
    own local window/block index, which don't align across the ring's
    window length and EEG's 25s blocks -- so matching keys here is what
    actually pairs a ring reading with a same-ish-time EEG reading. A key
    present on only one side still comes through (with the other
    modality's fields simply absent), same as it always could when only
    one modality had reported for a window."""
    merged = {k: dict(v) for k, v in windows.items()}
    for k, eeg_row in eeg_windows.items():
        target = merged.setdefault(k, {})
        for field in _EEG_FUSION_FIELDS:
            if field in eeg_row:
                target[field] = eeg_row[field]
    return merged


def poll_once(session_id: str, session_ref, ended_ref, eeg_session_ref) -> dict:
    if ended_ref.get():
        return {"ended": True}

    windows = load_session_windows(session_ref)
    eeg_windows = load_session_windows(eeg_session_ref)
    windows = merge_eeg_into_windows(windows, eeg_windows)
    if not windows:
        return {"ended": False, "windows_fused": [], "baseline_ready": False}

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
        # fused_by_key[k] carries fusion_engin.py's full per-modality
        # breakdown (handle_missing_values/compute_reliability_weight's
        # {m}_missing, prob_{m}, {m}_reliability_weight_norm) -- surfaced
        # here so the dashboard can show WHICH modality actually produced
        # this fused reading (and how much each was trusted), not just the
        # single blended number. {m}_missing correctly distinguishes "this
        # modality read 0.0" from "this modality wasn't present at all"
        # (handle_missing_values fills missing prob_* with 0.0, so prob_*
        # alone can't tell the two apart).
        fused = fused_by_key[k]
        write = {
            "fused_probability": windows[k]["fused_probability"],
            "fused_label": windows[k]["fused_label"],
            "stress_trend": trend,
            "eeg_weight": fused.get("eeg_reliability_weight_norm"),
            "hrv_gsr_weight": fused.get("hrv_gsr_reliability_weight_norm"),
        }
        # Each modality writes its OWN raw prob_{m}/conf_{m} directly into
        # this same fusion_en/{session}/{window} node exactly once, when its
        # writer first creates that wall-clock bucket (see
        # save_fusion_en_rtdb() / make_eeg_fusion_session_record()) -- it
        # never revisits that key again afterward. This poll runs every few
        # seconds and won't always see both sides landed yet (EEG's ~25s
        # blocks and the ring's own window cadence aren't in lockstep), so
        # explicitly writing `prob_eeg: None` / `prob_hrv_gsr: None` here
        # whenever THIS read found one missing used to permanently delete
        # the other writer's already-valid value (Firebase's .update()
        # treats null as "delete this field") -- a one-time race then showed
        # as that modality "not reporting" forever, not just for one poll.
        # Only write these keys when there's a real value, so an update()
        # simply leaves whatever's already there untouched instead of
        # erasing it.
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

        # Mirrors the fused (not per-modality) result onto the SAME window
        # key in fusion_en_sessions/{session_id} -- that store previously
        # only ever held EEG's own raw contribution (prob_eeg/stress_label_eeg/
        # etc, see make_eeg_fusion_session_record()), never the actual
        # combined stress reading. .update(), not .set() -- a window may not
        # have an EEG entry there yet (an HRV/GSR-only window still fuses
        # and deserves a record here too), and EEG's own writer now also
        # uses FirebaseSync.merge()/.update() on this same key specifically
        # so the two don't clobber each other regardless of write order.
        eeg_session_ref.child(k).update({
            "fused_stress_label": "high_stress" if windows[k]["fused_label"] == 1 else "low_stress",
            "fused_stress_probability": windows[k]["fused_probability"],
        })
        updated.append(k)

    return {"ended": False, "windows_fused": updated, "baseline_ready": baseline_mean is not None}


def run(session_id: str, poll_interval_sec: float, cred_path: str, db_url: str):
    db_mod = _init_firebase(cred_path, db_url)
    session_ref = db_mod.reference(f"fusion_en/{session_id}")
    eeg_session_ref = db_mod.reference(f"fusion_en_sessions/{session_id}")
    ended_ref = db_mod.reference(f"fusion_en_sessions/{session_id}/ended")
    started_at_ref = db_mod.reference(f"fusion_en_sessions/{session_id}/started_at")
    ended_at_ref = db_mod.reference(f"fusion_en_sessions/{session_id}/ended_at")

    # Written once, the first time this session_id is ever seen live --
    # NOT on every process restart/reconnect, so started_at keeps meaning
    # "when this session first went live" across this script being killed
    # and relaunched (e.g. after the DNS-hiccup crash this now guards
    # against above) rather than resetting on every restart.
    if started_at_ref.get() is None:
        started_at_ref.set(datetime.now(timezone.utc).isoformat())

    print(
        f"[fusion_live_session] watching fusion_en/{session_id} "
        f"+ fusion_en_sessions/{session_id} (EEG) "
        f"(poll every {poll_interval_sec}s) -- Ctrl+C to stop early"
    )
    # PAUSES on ended=True, does not exit -- both dashboard screens now
    # auto-watch this same fixed session_id on every mount (no manual
    # Start/Stop lifecycle anymore, see EegSessionScreen.js/
    # FusionSessionScreen.js's auto-watch useEffect), so "ended" no longer
    # means "this session is genuinely over", just "nobody was watching
    # briefly". Exiting here used to mean the NEXT screen open couldn't get
    # a fused reading again until someone noticed the dashboard had gone
    # stale and manually relaunched this process -- happened twice in one
    # session already. Only Ctrl+C stops the process now.
    was_ended = False
    try:
        while True:
            try:
                result = poll_once(session_id, session_ref, ended_ref, eeg_session_ref)
            except Exception as e:  # noqa: BLE001 -- a transient network/Firebase
                # blip (e.g. DNS hiccup during a WiFi switch, one dropped
                # connection) used to kill this ENTIRE process -- there was no
                # retry loop around poll_once() at all, only a bare
                # `except KeyboardInterrupt` around the whole while loop. That
                # meant one bad iteration silently stopped ALL live fusion
                # merging (both EEG and HRV/GSR keep writing their own raw
                # data fine independently either way) until someone noticed
                # the dashboard had gone stale and manually relaunched this
                # script -- confirmed happening in practice. Log and keep
                # going instead; a single failed poll just means one cycle's
                # worth of merging is delayed, not lost forever.
                print(f"[fusion_live_session] poll failed ({e}) -- retrying in {poll_interval_sec}s")
                time.sleep(poll_interval_sec)
                continue
            if result["ended"]:
                if not was_ended:
                    print(f"[fusion_live_session] session {session_id} marked ended -- "
                          f"pausing (still running) until a screen re-opens and clears it")
                    was_ended = True
                    ended_at_ref.set(datetime.now(timezone.utc).isoformat())
                time.sleep(poll_interval_sec)
                continue
            if was_ended:
                print(f"[fusion_live_session] session {session_id} resumed")
                was_ended = False
                ended_at_ref.delete()
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
