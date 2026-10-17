"""Live validation of the deployed system on real hardware (wearable02 EEG
headband + wearable01 ring), the evidence the offline SAM40/WESAD results
cannot give: does the live EEG score, the live HRV/GSR score and the fused
output separate rest from a mental task for the people wearing them?

Two steps, both read-only against Firebase (nothing is written there):

  1. protocol  -- run once per participant session, next to the person.
                 Waits for the session's EEG calibration, then times
                 rest -> task -> rest, and asks for a 1-9 self-rating after
                 each phase. Saves phase times to live_sessions/*.json.
  2. analyse   -- after all sessions: labels every EEG block and fusion
                 window by phase (by CAPTURE time) and reports, per person
                 and as a mean with a person-level bootstrap CI:
                   AUC task vs rest for the EEG score, HRV/GSR p and fused p,
                   balanced accuracy at the deployed decision rules,
                   how often both signals were present, and why EEG was
                   left out of fusion.

  python paper/analysis/live_validation.py protocol --participant P01
  python paper/analysis/live_validation.py analyse

Blocks/windows that straddle a phase boundary are dropped, as is the first
block of every phase (the response needs time to change).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stats_utils import subject_bootstrap  # noqa: E402

DB = "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app"
SESSIONS_DIR = Path(__file__).resolve().parent / "live_sessions"
OUT = Path(__file__).resolve().parent / "results"
BLOCK_SEC = 25.0


def _get(path: str):
    with urllib.request.urlopen(f"{DB}/{path}.json", timeout=60) as r:
        return json.load(r)


def _fusion_key_to_sec(key: int) -> tuple[float, float]:
    """(start, end) of a fusion grid cell -- 25 s cells (60 s before the
    grid change; see web/src/lib/levels.js::fusionKeyToMs)."""
    width = 25.0 if key >= 5e7 else 60.0
    return key * width, key * width + width


# ── 1. protocol ───────────────────────────────────────────────────────
def _countdown(label: str, seconds: int) -> tuple[float, float]:
    start = time.time()
    end = start + seconds
    while (left := end - time.time()) > 0:
        print(f"\r  {label}: {int(left) // 60:02d}:{int(left) % 60:02d} left ", end="", flush=True)
        time.sleep(min(1.0, left))
    print(f"\r  {label}: done{' ' * 20}")
    return start, time.time()


def _rating(question: str) -> int | None:
    while True:
        ans = input(f"  {question} (1-9, Enter to skip): ").strip()
        if not ans:
            return None
        if ans.isdigit() and 1 <= int(ans) <= 9:
            return int(ans)


def run_protocol(args) -> None:
    user = args.user or _get("psychological/current_user_id")
    session = args.session or _get("psychological/current_session_id")
    if not user or not session:
        sys.exit("No live session -- log in on the app/web first (or pass --user/--session).")
    print(f"Participant {args.participant}: user {user}, session {session}")

    print("Waiting for this session's EEG calibration (headband on, sitting still)...")
    while True:
        cal = _get(f"psychological/{user}/{session}/calibration_result") or {}
        status = cal.get("status")
        if status in ("ok", "degraded", "failed"):
            break
        print(f"\r  calibration: {status or 'not started'} ", end="", flush=True)
        time.sleep(5)
    print(f"\n  calibration: {status}  mu_rest={cal.get('mu_rest')}  "
          f"threshold={cal.get('personal_high_load_p')}  responsive={cal.get('eeg_responsive')}")
    if status == "failed" or cal.get("mu_rest") is None:
        print("  WARNING: no usable EEG rest baseline -- EEG will be left out of fusion this session.\n"
              "  Re-seat the electrodes and restart the session if you want EEG in this run.")

    phases = [("rest", args.rest_sec), ("task", args.task_sec), ("rest", args.rest_sec)]
    record = {"participant": args.participant, "user_id": user, "session_id": session,
              "task_description": args.task, "calibration": cal, "phases": []}
    for i, (name, sec) in enumerate(phases, 1):
        what = ("Sit still, eyes open, relax." if name == "rest" else f"Do the task now: {args.task}")
        input(f"\nPhase {i}/{len(phases)} [{name}, {sec // 60} min] -- {what}  Press Enter to start.")
        start, end = _countdown(name, sec)
        record["phases"].append({
            "name": name, "start": start, "end": end,
            "stress_1to9": _rating("How stressed did you feel?"),
            "effort_1to9": _rating("How mentally demanding was it?"),
        })

    SESSIONS_DIR.mkdir(exist_ok=True)
    path = SESSIONS_DIR / f"{args.participant}_{datetime.now():%Y%m%dT%H%M%S}.json"
    path.write_text(json.dumps(record, indent=1))
    print(f"\nSaved {path}. Run `analyse` after the last participant.")


# ── 2. analyse ────────────────────────────────────────────────────────
def _phase_of(t0: float, t1: float, phases: list[dict]) -> tuple[str | None, int | None]:
    """Phase containing [t0, t1] entirely, and the index of this unit
    within it (0 = first), or (None, None) if it straddles a boundary."""
    for i, ph in enumerate(phases):
        if ph["start"] <= t0 and t1 <= ph["end"]:
            return ph["name"], int((t0 - ph["start"]) // BLOCK_SEC)
    return None, None


def _load_session(rec: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    user, sid, phases = rec["user_id"], rec["session_id"], rec["phases"]
    eeg_node = _get(f"psychological/{user}/{sid}") or {}
    fus_node = _get(f"fusion_en/{user}/{sid}") or {}

    eeg = []
    for k, b in eeg_node.items():
        if not (str(k).isdigit() and isinstance(b, dict)) or b.get("timestamp_end") is None:
            continue
        t1 = float(b["timestamp_end"]); t0 = t1 - BLOCK_SEC
        phase, idx = _phase_of(t0, t1, phases)
        eeg.append({"phase": phase, "idx": idx, "skipped": bool(b.get("skipped")),
                    "score": b.get("task_state_score"), "z": b.get("task_state_z"),
                    "threshold": b.get("effective_high_load_p"),
                    "timestamp_source": b.get("timestamp_source", "server")})

    fus = []
    for k, w in fus_node.items():
        if not (str(k).isdigit() and isinstance(w, dict)):
            continue
        t0, t1 = _fusion_key_to_sec(int(k))
        phase, idx = _phase_of(t0, t1, phases)
        fus.append({"phase": phase, "idx": idx,
                    "p_eeg": w.get("prob_eeg"), "p_hrv": w.get("prob_hrv_gsr"),
                    "thr_hrv": w.get("threshold_hrv_gsr"),
                    "p_fused": w.get("fused_probability"), "label_fused": w.get("fused_label"),
                    "eeg_excluded": w.get("eeg_excluded_reason")})
    return pd.DataFrame(eeg), pd.DataFrame(fus)


def _auc(y: np.ndarray, s: np.ndarray) -> float:
    ok = ~pd.isna(s)
    y, s = y[ok], s[ok].astype(float)
    return float(roc_auc_score(y, s)) if len(np.unique(y)) == 2 else np.nan


def _bal_acc(y: np.ndarray, flag: np.ndarray) -> float:
    ok = ~pd.isna(flag)
    y, f = y[ok], flag[ok].astype(bool)
    if len(np.unique(y)) < 2:
        return np.nan
    return float(0.5 * (f[y == 1].mean() + (1 - f[y == 0].mean())))


def run_analyse(args) -> None:
    files = sorted(SESSIONS_DIR.glob("*.json"))
    if not files:
        sys.exit(f"No sessions in {SESSIONS_DIR} -- run `protocol` first.")
    rows, coverage = [], []
    for f in files:
        rec = json.loads(f.read_text())
        eeg, fus = _load_session(rec)
        person = rec["participant"]
        e = eeg[(eeg.phase.notna()) & (eeg.idx >= 1) & (~eeg.skipped)] if len(eeg) else eeg
        w = fus[(fus.phase.notna()) & (fus.idx >= 1)] if len(fus) else fus
        ye = (e.phase == "task").to_numpy(int) if len(e) else np.array([])
        yw = (w.phase == "task").to_numpy(int) if len(w) else np.array([])
        ratings = {ph["name"] + str(i): ph.get("stress_1to9") for i, ph in enumerate(rec["phases"])}
        rows.append({
            "participant": person, "session_id": rec["session_id"],
            "eeg_responsive": rec["calibration"].get("eeg_responsive"),
            "eeg_baseline": rec["calibration"].get("mu_rest") is not None,
            "n_eeg_blocks": len(e), "n_windows": len(w),
            # AUC on the raw score = AUC on z (monotone within a session),
            # and works for sessions recorded before z was stored.
            "auc_eeg": _auc(ye, e.score.to_numpy()) if len(e) else np.nan,
            "auc_hrv": _auc(yw, w.p_hrv.to_numpy()) if len(w) else np.nan,
            "auc_fused": _auc(yw, w.p_fused.to_numpy()) if len(w) else np.nan,
            # The block's own effective threshold = mu_rest + K*sigma (z >= K)
            # under the personal score.
            "balacc_eeg": _bal_acc(ye, (e.score >= e.threshold).where(e.score.notna() & e.threshold.notna()))
                          if len(e) else np.nan,
            "balacc_hrv": _bal_acc(yw, (w.p_hrv >= w.thr_hrv).where(w.p_hrv.notna())) if len(w) else np.nan,
            "balacc_fused": _bal_acc(yw, w.label_fused.where(w.label_fused.notna()).eq(1).where(w.label_fused.notna()))
                            if len(w) else np.nan,
            "stress_rest1": ratings.get("rest0"), "stress_task": ratings.get("task1"),
            "stress_rest2": ratings.get("rest2"),
        })
        if len(w):
            coverage.append({
                "participant": person,
                "both_signals": float((w.p_eeg.notna() & w.p_hrv.notna()).mean()),
                "eeg_only": float((w.p_eeg.notna() & w.p_hrv.isna()).mean()),
                "hrv_only": float((w.p_eeg.isna() & w.p_hrv.notna()).mean()),
                **{f"eeg_excluded_{k}": int(v) for k, v in w.eeg_excluded.value_counts().items()},
            })
        if len(e) and (e.timestamp_source != "capture").any():
            print(f"  note: {person}: some EEG blocks use server time, not capture time "
                  f"(bridge/API not yet updated) -- phase labels may be shifted by up to a block.")

    per = pd.DataFrame(rows)
    cov = pd.DataFrame(coverage)
    OUT.mkdir(exist_ok=True)
    per.to_csv(OUT / "L1_live_per_person.csv", index=False)
    cov.to_csv(OUT / "L2_live_signal_coverage.csv", index=False)

    print(f"\n{len(per)} session(s), {per.participant.nunique()} people\n")
    summary = []
    for col in ["auc_eeg", "auc_hrv", "auc_fused", "balacc_eeg", "balacc_hrv", "balacc_fused"]:
        v = per[col].dropna()
        if len(v) >= 2:
            m, lo, hi = subject_bootstrap(per.groupby("participant")[col].mean().dropna())
            summary.append({"metric": col, "n_people": len(v), "mean": m, "ci_lo": lo, "ci_hi": hi})
        else:
            summary.append({"metric": col, "n_people": len(v), "mean": v.mean() if len(v) else np.nan,
                            "ci_lo": np.nan, "ci_hi": np.nan})
    summ = pd.DataFrame(summary)
    summ.to_csv(OUT / "L3_live_summary.csv", index=False)
    with pd.option_context("display.width", 140, "display.max_columns", 20):
        print(per.round(3).to_string(index=False), "\n")
        print(summ.round(3).to_string(index=False), "\n")
        if len(cov):
            print(cov.round(3).to_string(index=False))
    print(f"\nWritten: {OUT / 'L1_live_per_person.csv'}, L2_live_signal_coverage.csv, L3_live_summary.csv")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("protocol", help="guide one participant session")
    p.add_argument("--participant", required=True, help="anonymous id, e.g. P01")
    p.add_argument("--user", help="Firebase user id (default: the live session's)")
    p.add_argument("--session", help="session id (default: the live session's)")
    p.add_argument("--rest-sec", type=int, default=300)
    p.add_argument("--task-sec", type=int, default=300)
    p.add_argument("--task", default="the app's task battery (serial subtraction, maths quiz, Stroop)")
    p.set_defaults(fn=run_protocol)
    a = sub.add_parser("analyse", help="analyse all recorded sessions")
    a.set_defaults(fn=run_analyse)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
