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
    CURRENT_SESSION_ID_FIELD, CURRENT_USER_ID_FIELD, FIREBASE_DB_URL,
    FUSION_EN_ROOT, FUSION_EN_SESSIONS_ROOT,
)
from backend.psychological.realtime.firebase_sync import _trend_direction  # noqa: E402

BASELINE_N = 3 


def _init_firebase(cred_path: str, db_url: str):
    import json
    import firebase_admin
    from firebase_admin import credentials, db

    # Prefer $FIREBASE_CRED_JSON (credential content directly) over a file
    # path -- a deployed target like Render has no persistent file for
    # cred_path to point at (see backend/common/firebase_config.py's
    # identical FIREBASE_CRED_JSON handling). Falls back to the file-path
    # behavior for local dev, where --firebase-cred/$FIREBASE_CREDENTIALS
    # already works.
    cred_json = os.environ.get("FIREBASE_CRED_JSON")
    if cred_json:
        try:
            cert_source = json.loads(cred_json)
        except Exception as e:
            raise ValueError(f"Failed to parse $FIREBASE_CRED_JSON: {e}")
    else:
        cred_file = Path(cred_path).expanduser().resolve()
        if not cred_file.is_file():
            raise FileNotFoundError(
                f"Firebase credential not found at {cred_file}. Must be a path OUTSIDE this "
                f"repository -- set it via --firebase-cred or $FIREBASE_CREDENTIALS, or set "
                f"$FIREBASE_CRED_JSON with the credential content directly (e.g. on Render)."
            )
        cert_source = str(cred_file)

    try:
        firebase_admin.get_app()
    except ValueError:
        cred = credentials.Certificate(cert_source)
        firebase_admin.initialize_app(cred, {"databaseURL": db_url})
    return db


def load_session_windows(session_ref) -> dict:
    data = session_ref.get() or {}
    return {k: v for k, v in data.items() if str(k).isdigit() and isinstance(v, dict)}


def _modality_input(window: dict, m: str) -> dict:
    return {
        "prob": window.get(f"prob_{m}"),
        "confidence": window.get(f"conf_{m}"),
        "signal_quality": window.get(f"signal_quality_{m}"),
        "model_acc": window.get(f"model_acc_{m}"),
        "threshold": window.get(f"threshold_{m}"),
    }


def poll_once(session_ref, session_meta_ref) -> dict:
    windows = load_session_windows(session_ref)
    if not windows:
        return {"windows_fused": [], "baseline_ready": False}

    fusable_keys = [
        k for k, v in windows.items()
        if v.get("prob_eeg") is not None or v.get("prob_hrv_gsr") is not None
    ]
    fusable_keys.sort(key=lambda k: int(k))
    fused_by_key = {}
    for k in fusable_keys:
        w = windows[k]
        # compute_realtime_multimodal_fusion(): reliability-weighted fusion
        # with each modality's signal_quality correctly normalized to 0-1
        # before weighting (signal_quality_eeg is 0-100, the other two are
        # already 0-1 -- see that function's docstring for the scale-
        # mismatch bug this replaces compute_fusion_for_records() to fix).
        fused = fusion_engin.compute_realtime_multimodal_fusion({
            "eeg": _modality_input(w, "eeg"),
            "hrv_gsr": _modality_input(w, "hrv_gsr"),
        })
        fused_by_key[k] = fused
        if fused["fused_stress_probability"] is not None:
            windows[k]["fused_probability"] = fused["fused_stress_probability"]
            windows[k]["fused_threshold"] = fused["fused_stress_threshold"]
            # Weighted combination of each modality's OWN threshold (see
            # compute_realtime_multimodal_fusion()'s docstring) -- was a
            # flat >= 0.5, unrelated to either modality's real decision
            # boundary.
            windows[k]["fused_label"] = int(fused["fused_stress_probability"] >= fused["fused_stress_threshold"])

    ordered_keys = sorted(windows.keys(), key=lambda k: int(k))
    fused_history = [windows[k].get("fused_probability") for k in ordered_keys]
    valid_fused = [v for v in fused_history if v is not None]
    baseline_mean = float(np.mean(valid_fused[:BASELINE_N])) if len(valid_fused) >= BASELINE_N else None

    if baseline_mean is not None:
        session_meta_ref.update({"baseline": baseline_mean})

    updated = []
    for i, k in enumerate(ordered_keys):
        if windows[k].get("fused_probability") is None:
            continue
        # Trend stays _trend_direction()'s existing increasing/decreasing/
        # stable vocabulary (StressApp/modules/fusion/config/config.js's
        # FUSION_TREND_LABELS is keyed on exactly this) -- NOT
        # recomputed by a second, differently-vocabularied trend calc.
        trend = _trend_direction(fused_history[: i + 1])
        fused = fused_by_key[k]
        weights = fused["modality_weights"]
        # fusion_en/{user}/{session}/{window} keeps its EXISTING field
        # names (StressApp/modules/fusion/screens/FusionSessionScreen.js
        # reads this path directly) -- only the VALUES now come from the
        # corrected weighting, not a new schema here.
        write = {
            "fused_probability": windows[k]["fused_probability"],
            "fused_threshold": windows[k]["fused_threshold"],
            "fused_label": windows[k]["fused_label"],
            "stress_trend": trend,
            "eeg_weight": weights.get("eeg"),
            "hrv_gsr_weight": weights.get("hrv_gsr"),
            # 'concordant'/'discordant'/'insufficient_data' -- see
            # compute_realtime_multimodal_fusion()'s own docstring
            # (fusion_engin.py) for the shared-response-vs-independent-
            # effects rationale. Purely observational -- doesn't feed back
            # into fused_probability/fused_threshold above.
            "modality_concordance": fused["modality_concordance"],
            "modality_elevated": fused["modality_elevated"],
            # Which modalities reported a real prob this window but got
            # excluded by compute_realtime_multimodal_fusion()'s
            # plausibility gate (EXTREME_PROB_EPS) -- distinct from simply
            # not reporting, which active_modalities' absence already
            # covers. Empty list is the normal case; a non-empty one flags
            # a domain-shift-style artifact worth investigating, not a
            # silent exclusion.
            "implausible_modalities": fused["implausible_modalities"],
        }

        if "eeg" in fused["active_modalities"]:
            write["prob_eeg"] = windows[k].get("prob_eeg")
        if "hrv_gsr" in fused["active_modalities"]:
            write["prob_hrv_gsr"] = windows[k].get("prob_hrv_gsr")

        write["stress_deviation"] = (
            windows[k]["fused_probability"] - baseline_mean
            if baseline_mean is not None
            else None
        )
        session_ref.child(k).update(write)

        # Per-window summary mirrored into fusion_en_sessions/{user}/{session}.
        # fused_stress_label/fused_stress_probability are the PRIMARY keys
        # relaxation_guide/backend/app/services/firebase_service.py's
        # get_latest_prediction() already looks for first (see its own
        # docstring: "Reads inputs: fused_stress_label ('low_stress'/
        # 'high_stress') and fused_stress_probability") -- stress_label/
        # probability_vector are kept alongside, unchanged, as its
        # documented fallback for any other reader still on the old keys.
        stress_label = "high_stress" if windows[k]["fused_label"] == 1 else "low_stress"
        session_meta_ref.child(k).update({
            "stress_label": stress_label,
            "fused_stress_label": stress_label,
            "fused_stress_probability": windows[k]["fused_probability"],
            "probability_vector": {
                "eeg": windows[k].get("prob_eeg"),
                "hrv_gsr": windows[k].get("prob_hrv_gsr"),
                "fused": windows[k]["fused_probability"],
            },
            "modality_concordance": fused["modality_concordance"],
        })
        updated.append(k)

    return {"windows_fused": updated, "baseline_ready": baseline_mean is not None}


def _session_refs(db_mod, user_id: str, session_id: str) -> dict:
    return {
        "session_ref": db_mod.reference(f"{FUSION_EN_ROOT}/{user_id}/{session_id}"),
        "session_meta_ref": db_mod.reference(f"{FUSION_EN_SESSIONS_ROOT}/{user_id}/{session_id}"),
    }


def run(session_id: str | None, user_id: str | None, poll_interval_sec: float,
        cred_path: str, db_url: str):
    db_mod = _init_firebase(cred_path, db_url)
    manual_override = session_id is not None
    pointer_ref = db_mod.reference(f"{FUSION_EN_SESSIONS_ROOT}/{CURRENT_SESSION_ID_FIELD}")
    user_pointer_ref = db_mod.reference(f"{FUSION_EN_SESSIONS_ROOT}/{CURRENT_USER_ID_FIELD}")

    current_session_id = session_id
    current_user_id = user_id
    if not manual_override:
        current_session_id = pointer_ref.get()
        current_user_id = user_pointer_ref.get()
    refs = None

    # A "session" is a login-to-logout span belonging to one user (see
    # StressApp's AuthContext.js) -- fusion_en/fusion_en_sessions are
    # therefore nested under user_id, so BOTH pointers must resolve before
    # there's a path to watch at all.
    def _switch_to(new_session_id: str, new_user_id: str, *, is_rotation: bool):
        nonlocal current_session_id, current_user_id, refs
        if is_rotation and refs is not None:
            refs["session_meta_ref"].update({"session_ended": datetime.now(timezone.utc).isoformat()})
            print(f"[fusion_live_session] session {current_user_id}/{current_session_id} ended")
        current_session_id = new_session_id
        current_user_id = new_user_id
        refs = _session_refs(db_mod, current_user_id, current_session_id)
        # StressApp's AuthContext.js already writes session_started at login
        # (the authoritative moment a session begins); this is only a
        # fallback for a session this process discovers mid-flight without
        # ever having seen that write (e.g. process restarted).
        if refs["session_meta_ref"].child("session_started").get() is None:
            refs["session_meta_ref"].update({"session_started": datetime.now(timezone.utc).isoformat()})
        print(
            f"[fusion_live_session] watching fusion_en/{current_user_id}/{current_session_id} "
            f"+ fusion_en_sessions/{current_user_id}/{current_session_id} "
            f"(poll every {poll_interval_sec}s) -- Ctrl+C to stop early"
        )

    if current_session_id and current_user_id:
        _switch_to(current_session_id, current_user_id, is_rotation=False)
    else:
        print(f"[fusion_live_session] no live session yet -- waiting for a login "
              f"(polling {FUSION_EN_SESSIONS_ROOT}/{CURRENT_SESSION_ID_FIELD}"
              f"/{CURRENT_USER_ID_FIELD} every {poll_interval_sec}s)")

    try:
        while True:
            if not manual_override:
                try:
                    pointer_session_id = pointer_ref.get()
                    pointer_user_id = user_pointer_ref.get()
                    if (pointer_session_id and pointer_user_id
                            and (pointer_session_id, pointer_user_id) != (current_session_id, current_user_id)):
                        _switch_to(pointer_session_id, pointer_user_id, is_rotation=True)
                    elif not pointer_session_id and refs is not None:
                        # Logged out -- AuthContext.js's logout() already wrote
                        # session_ended directly, and cleared the pointer.
                        # Stop polling until the next login.
                        print(f"[fusion_live_session] {current_user_id}/{current_session_id} "
                              f"logged out -- pausing until next login")
                        refs = None
                except Exception as e:
                    print(f"[fusion_live_session] session-pointer poll failed ({e}) -- "
                          f"retrying in {poll_interval_sec}s")
                    time.sleep(poll_interval_sec)
                    continue

            if refs is None:
                time.sleep(poll_interval_sec)
                continue

            try:
                result = poll_once(refs["session_ref"], refs["session_meta_ref"])
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
        "debugging only. Requires --user-id too (fusion_en/fusion_en_sessions are user-scoped). "
        "Normal runs should omit both: the process follows "
        "{FUSION_EN_SESSIONS_ROOT}/current_session_id + current_user_id (written by StressApp's "
        "AuthContext.js at login) instead.",
    )
    ap.add_argument(
        "--user-id",
        default=None,
        help="Required alongside --session-id for a manual pin -- ignored otherwise.",
    )
    ap.add_argument("--poll-interval-sec", type=float, default=3.0,
                     help="How often the live session's fusion_en window is recomputed and "
                          "rewritten -- kept within a 2-5s real-time range regardless of "
                          "FUSION_WINDOW_BUCKET_SEC (backend/common/fusion.py, 60s), which "
                          "aligns modalities' differing write cadences (EEG reports once per "
                          "25s block) onto a shared window and is NOT this value -- shrinking "
                          "the bucket itself would make EEG miss most windows outright.")
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

    if not args.firebase_cred and not os.environ.get("FIREBASE_CRED_JSON"):
        raise SystemExit(
            "--firebase-cred (or $FIREBASE_CREDENTIALS) is required, unless "
            "$FIREBASE_CRED_JSON (credential content directly) is set instead."
        )
    if args.session_id and not args.user_id:
        raise SystemExit("--session-id requires --user-id too (fusion_en is user-scoped).")

    run(args.session_id, args.user_id, args.poll_interval_sec, args.firebase_cred, args.firebase_db_url)


if __name__ == "__main__":
    main()
