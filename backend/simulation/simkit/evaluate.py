"""Multi-seed evaluation (SIMULATED -- software-in-the-loop).

Each virtual user runs the protocol below; its device data go through the
SAME backend functions the deployed services run (imported read-only):

  EEG   bridge: rest blocks posted to /calibrate in a rolling window of <=12
        until >=8 are trusted (fallback after 20) -> RealtimeInference.
        calibrate_bipolar_block / finalize_calibration_bipolar; task and
        recovery blocks -> score_threshold_task_block / score_recovery_block ->
        finalize_personal_threshold (direction-aware ABA rule); live blocks ->
        infer_bipolar_block -> make_eeg_output_record -> make_eeg_fusion_record.
        A block with a packet gap is dropped, as the bridge does.
  Ring  calibration_capture: consecutive 60 s windows, too-little-data windows
        replaced; rest windows -> extract_features / compute_baseline (a moving
        or HRV-fallback rest window fails the calibration -> retried, as a user
        would) -> resting scores; task + recovery windows -> predict_window ->
        midpoint_stress_threshold (with the recovery check). Live: the bridge's
        60 s window every 20 s -> extract_features -> predict_window (motion /
        fallback windows rejected).
  Fused fusion_engin.compute_realtime_multimodal_fusion (aligned scale) per
        25 s fusion window; alerts = 2 of the last 3 above the limit.

Protocol: settle 2 min -> rest 10 EEG blocks -> task 19 blocks -> recovery
12 blocks (5 min) -> live: calm 4 min, demand 4, calm 4, demand 4, calm 5.

  PYTHONPATH=../..:. ../../venv/bin/python -m simkit.evaluate [--seeds 20] [--profiles all] [--workers 8]
"""
import argparse
import json
import math
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from backend.common.config import GSR_CAL
from backend.physiological.extract_features import compute_signal_quality, extract_features
from backend.physiological.predictor import (
    PERSONAL_THRESHOLD_MIN_SEPARATION, STRESS_DECISION_THRESHOLD, compute_baseline, midpoint_stress_threshold,
    predict_window,
)
from backend.psychological.realtime.adc import microvolts_to_bipolar_code
from backend.psychological.realtime.firebase_sync import make_eeg_fusion_record, make_eeg_output_record
from backend.psychological.realtime.mqtt_client import BipolarRawSample
from backend.psychological.realtime.pipeline import RealtimeInference

from . import GENERATOR_VERSION
from .profiles import PROFILES
from .ring import window_arrays
from .session import STEP, VirtualUser

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "fushion engin"))
import fusion_engin  # noqa: E402

MODEL_DIR = Path(__file__).resolve().parents[2] / "psychological" / "models"
OUT = Path(__file__).resolve().parents[1] / "output" / "simkit"
SETTLE_S, N_REST, N_TASK, N_REC = 120, 10, 19, 12
LIVE = [("calm", 240), ("demand", 240), ("calm", 240), ("demand", 240), ("calm", 300)]
RING_REST, RING_TASK, RING_REC = 4, 7, 5
GRACE_S, ONSET_S = 120, 120
# Live monitoring on a later occasion than the ring calibration (profiles.py): HR sd, SCL, variability.
LATER_OCCASION = (6.0, 0.35, 0.25)
BLOCK_S = 25.0


def _samples(uv, millis):
    return [BipolarRawSample(millis=int(m), code=int(c)) for m, c in zip(millis, microvolts_to_bipolar_code(uv))]


class Run:
    """Accumulates one virtual user's device data while the protocol runs."""

    def __init__(self, profile, seed):
        self.u = VirtualUser(profile, seed)
        self.t = 0.0
        self.cur_uv, self.cur_ms, self.cur_keep = [], [], []
        self.packets = []           # (t, packet) for the whole session
        self.blocks = []            # dicts: phase, t_end, uv, millis, lost, loads

    def advance(self, demand, phase):
        s = self.u.step(demand, phase)
        self.cur_uv.append(s["uv"]); self.cur_ms.append(s["millis"]); self.cur_keep.append(s["keep"])
        if s["packet"] is not None:
            self.packets.append((self.t, s["packet"]))
        self.t += STEP
        if s["block_done"]:
            keep = np.concatenate(self.cur_keep)
            self.blocks.append({"phase": phase, "t_end": self.t, "uv": np.concatenate(self.cur_uv)[keep],
                                "millis": np.concatenate(self.cur_ms)[keep], "lost": s["block_lost"],
                                "loads": s["loads"], "demand": demand, "drowsy": s["drowsy"], "drift": s["drift"]})
            self.cur_uv, self.cur_ms, self.cur_keep = [], [], []
            return self.blocks[-1]
        return None

    def run_for(self, demand, phase, seconds):
        for _ in range(int(round(seconds / STEP))):
            self.advance(demand, phase)

    def run_blocks(self, demand, phase, n_usable, stop=None):
        """Advance until n_usable non-lost blocks of this phase were captured."""
        got = []
        while len(got) < n_usable:
            b = self.advance(demand, phase)
            if b and not b["lost"]:
                got.append(b)
                if stop and stop(got):
                    break
        return got


# ── Ring helpers (calibration_capture.py / app.py /predict) ─────────
def ring_window(packets):
    ibi, gsr, acc = window_arrays(packets)
    if len(ibi) < 10 or len(gsr) < 20 or len(acc) < 10:
        return None, None, "insufficient"
    f2, motion, _fd, fallback, _wd = extract_features(ibi, gsr, acc, GSR_CAL, actual_fs=5)
    q = compute_signal_quality(ibi, gsr, acc, motion, actual_fs=5)
    if motion:
        return None, q, "motion"
    if fallback:
        return None, q, "hrv_fallback"
    return f2, q, "ok"


def run_session(profile, seed, keep_blocks=False):
    t0 = time.time()
    R = Run(profile, seed)
    R.run_for(0.0, "settle", SETTLE_S)
    t_rest0 = R.t

    # ── EEG resting baseline (mqtt_bridge.py rolling /calibrate) ──
    rest_blocks, seen, engine, cal = [], 0, None, None
    while True:
        b = R.advance(0.0, "rest")
        if not b or b["lost"]:
            continue
        rest_blocks.append(b)
        seen += 1
        rest_blocks = rest_blocks[-12:]
        if len(rest_blocks) < N_REST:
            continue
        e = RealtimeInference(MODEL_DIR)
        for rb in rest_blocks:
            e.calibrate_bipolar_block(_samples(rb["uv"], rb["millis"]))
        out = e.finalize_calibration_bipolar(allow_degraded=seen >= 20)
        if out["status"] in ("ok", "degraded") and (seen >= 20 or out.get("n_blocks", 0) >= 8):
            engine, cal = e, out
            break
        if seen >= 40:
            break
    eeg_rest_blocks_seen = seen

    # ── EEG task + recovery ──
    task_blocks = R.run_blocks(1.0, "task", N_TASK)
    rec_blocks = R.run_blocks(0.0, "recovery", N_REC)
    thr = {}
    if engine is not None:
        for b in task_blocks:
            engine.score_threshold_task_block(_samples(b["uv"], b["millis"]))
        for b in rec_blocks:
            engine.score_recovery_block(_samples(b["uv"], b["millis"]))
        thr = engine.finalize_personal_threshold()
        thr.update(engine.recovery_outcome())

    # ── Ring calibration from the packets of rest/task/recovery ──
    ring = {"present": R.u.ring is not None}
    if ring["present"]:
        pk = [p for t, p in R.packets if t >= t_rest0]
        wins, i = [], 0
        while i + 300 <= len(pk):
            wins.append(ring_window(pk[i:i + 300]))
            i += 300
        # rest: first RING_REST captured windows (insufficient-data windows replaced);
        # a motion / HRV-fallback window fails the whole calibration -> retried.
        retries, k, rest_f = 0, 0, None
        while k < len(wins) and retries < 4:
            cand, j = [], k
            while j < len(wins) and len(cand) < RING_REST:
                if wins[j][2] != "insufficient":
                    cand.append(wins[j])
                j += 1
            k = j
            if len(cand) < RING_REST:
                break
            if all(w[2] == "ok" for w in cand):
                rest_f = [w[0][0] for w in cand]
                break
            retries += 1
        ring["rest_retries"] = retries
        if rest_f:
            bm, bs = compute_baseline(np.array(rest_f), n_windows=len(rest_f))
            score = lambda f: float(predict_window(f, bm, bs)["prob_stress"])  # noqa: E731
            rest_s = [score(f[None, :]) for f in rest_f]
            later = [w for w in wins[k:] if w[2] != "insufficient"]
            task_s = [score(w[0]) for w in later[:RING_TASK] if w[2] == "ok"]
            rec_s = [score(w[0]) for w in later[RING_TASK:RING_TASK + RING_REC] if w[2] == "ok"]
            mid = midpoint_stress_threshold(rest_s, task_s, recovery_scores=rec_s)
            ring.update({"rest": rest_s, "task": task_s, "recovery": rec_s, "status": mid["status"] if mid else None,
                         "limit": mid["limit"] if mid and mid["separated"] else STRESS_DECISION_THRESHOLD,
                         "baseline": (bm, bs)})
        else:
            ring.update({"status": "calibration_failed", "limit": None})

    # ── Live monitoring ──
    live, hist, t_live0 = [], [], R.t
    ring_pred = []                      # (t, prob, quality) every 20 s, last 60 s of packets
    next_ring = R.t + 20.0
    periods = []
    if R.u.ring is not None and LATER_OCCASION:
        R.u.ring.later_occasion(*LATER_OCCASION)
    for name, dur in LIVE:
        start = R.t
        demand = 1.0 if name == "demand" else 0.0
        steps = int(round(dur / STEP))
        for _ in range(steps):
            b = R.advance(demand, name)
            if ring.get("baseline") and R.t >= next_ring:
                next_ring += 20.0
                recent = [p for t, p in R.packets if R.t - 60.0 <= t < R.t]
                f2, q, why = ring_window(recent)
                if why == "ok":
                    bm, bs = ring["baseline"]
                    ring_pred.append((R.t, float(predict_window(f2, bm, bs)["prob_stress"]), q))
            if b is None:
                continue
            row = {"t": b["t_end"] - t_live0, "period": name, "demand": demand, "loads": b["loads"],
                   "drowsy": b["drowsy"], "drift": b["drift"], "lost": b["lost"]}
            fe = None
            if not b["lost"] and engine is not None:
                res = engine.infer_bipolar_block(_samples(b["uv"], b["millis"]))
                hist.append(res.get("calibrated_p") if not res.get("skipped") else None)
                rec = make_eeg_output_record(res, window_sec=BLOCK_S, model_version="bipolar_only_v1",
                                             feature_set="bipolar_only_v1", history_scores=hist,
                                             high_load_p=engine.thresholds.high_load_p, capture_end_ts=1.8e9 + b["t_end"])
                fe = make_eeg_fusion_record(rec)
                row.update({"skipped": bool(rec.get("skipped")), "eeg_score": rec.get("task_state_score"),
                            "eeg_z": rec.get("task_state_z")})
            in_bucket = [x for x in ring_pred if b["t_end"] - BLOCK_S <= x[0] < b["t_end"]]
            rp = in_bucket[-1] if in_bucket else None
            mods = {"eeg": ({"prob": fe["prob_eeg"], "confidence": fe["conf_eeg"], "signal_quality": fe["signal_quality_eeg"],
                             "model_acc": fe["model_acc_eeg"], "threshold": fe["threshold_eeg"],
                             "threshold_scale": fe["threshold_scale_eeg"], "z": fe["z_logit_eeg"], "z_alert": fe["z_alert_eeg"]}
                            if fe else {"prob": None}),
                    "hrv_gsr": ({"prob": rp[1], "confidence": max(rp[1], 1 - rp[1]), "signal_quality": rp[2], "model_acc": 0.851,
                                 "threshold": ring["limit"], "threshold_scale": PERSONAL_THRESHOLD_MIN_SEPARATION}
                                if rp and ring.get("limit") is not None else {"prob": None})}
            fu = fusion_engin.compute_realtime_multimodal_fusion(mods, scale="aligned")
            al = fu.get("aligned_probs") or {}
            w = fu.get("modality_weights") or {}
            row.update({"mind": al.get("eeg"), "body": al.get("hrv_gsr"), "fused": fu.get("fused_stress_probability"),
                        "w_eeg": w.get("eeg"), "w_ring": w.get("hrv_gsr"), "ring_p": rp[1] if rp else None})
            vals = [v for v in (row["mind"], row["body"]) if v is not None]
            row["fused_equal"] = float(np.mean(vals)) if vals else None
            live.append(row)
        periods.append((name, start - t_live0, R.t - t_live0))

    for key in ("mind", "body", "fused", "fused_equal"):
        flags = [None if r[key] is None else r[key] >= 0.5 for r in live]
        for i, r in enumerate(live):
            recent = [f for f in flags[max(0, i - 2):i + 1] if f is not None]
            r[f"{key}_alert"] = None if not recent else sum(recent) >= 2

    m = metrics(live, periods)
    m.update({
        "profile": profile, "seed": seed, "eeg_subject": R.u.params.eeg["subject"],
        "eeg_status": thr.get("calibration_status") if engine else "calibration_failed",
        "eeg_direction": thr.get("personal_direction"), "eeg_separation_sd": thr.get("separation_sd"),
        "eeg_reversal_sd": thr.get("reversal_sd"), "eeg_rest_blocks_seen": eeg_rest_blocks_seen,
        "eeg_amplitude_gain": cal.get("amplitude_gain") if cal else None,
        "ring_status": ring.get("status"), "ring_rest_retries": ring.get("rest_retries"),
        "ring_limit": ring.get("limit"), "runtime_s": time.time() - t0,
    })
    if keep_blocks:
        m["live_rows"] = [{k: v for k, v in r.items() if k != "loads"} | {f"load_{k}": v for k, v in r["loads"].items()} for r in live]
        m["calibration"] = {"eeg_rest": thr.get("rest_scores"), "eeg_task": thr.get("task_scores"),
                            "eeg_recovery": thr.get("recovery_scores"), "eeg_baseline_logit": thr.get("baseline_logit"),
                            "eeg_limit_logit": thr.get("limit_logit"), "eeg_rest_sd_logit": thr.get("rest_sd_logit"),
                            "eeg_z_alert": thr.get("z_alert"),
                            "ring_rest": ring.get("rest"), "ring_task": ring.get("task"), "ring_recovery": ring.get("recovery")}
    return m


def metrics(live, periods):
    out = {}
    demand = [(s, e) for n, s, e in periods if n == "demand"]
    for key in ("mind", "body", "fused", "fused_equal"):
        dem = [r for r in live if any(s + ONSET_S <= r["t"] < e for s, e in demand)]
        calm = [r for r in live if r["period"] == "calm" and not any(e <= r["t"] < e + GRACE_S for _, e in demand)]
        rate = lambda rows: (None if not [r for r in rows if r[f"{key}_alert"] is not None]  # noqa: E731
                             else float(np.mean([bool(r[f"{key}_alert"]) for r in rows if r[f"{key}_alert"] is not None])))
        out[f"{key}_alert_rate_demand"] = rate(dem)
        out[f"{key}_false_alarm_rate_calm"] = rate(calm)
        ttf, ttc = [], []
        for s, e in demand:
            first = [r["t"] for r in live if s <= r["t"] < e + GRACE_S and r[f"{key}_alert"]]
            ttf.append(first[0] - s if first else None)
            after = [r["t"] for r in live if r["t"] >= e and r[f"{key}_alert"] is False]
            ttc.append(after[0] - e if after else None)
        out[f"{key}_time_to_alert_s"] = [x for x in ttf]
        out[f"{key}_time_to_clear_s"] = [x for x in ttc]
    eeg_rows = [r for r in live]
    out["gate_rejection_rate"] = float(np.mean([bool(r.get("lost") or r.get("skipped")) for r in eeg_rows])) if eeg_rows else None
    both = [r for r in live if r["w_eeg"] is not None and r["w_ring"] is not None and r["mind"] is not None and r["body"] is not None]
    out["w_eeg_mean"] = float(np.mean([r["w_eeg"] for r in both])) if both else None
    out["w_ring_mean"] = float(np.mean([r["w_ring"] for r in both])) if both else None
    fm = [r for r in live if r["fused"] is not None and r["mind"] is not None and r["body"] is None]
    out["fused_equals_mind_share"] = (float(np.mean([abs(r["fused"] - r["mind"]) < 1e-6 for r in fm])) if fm else None)
    return out


def _set_occasion(v):
    global LATER_OCCASION
    LATER_OCCASION = v


def _job(args):
    profile, seed, keep = args
    try:
        return run_session(profile, seed, keep_blocks=keep)
    except Exception as e:                       # one broken run must not lose the others
        import traceback
        return {"profile": profile, "seed": seed, "error": repr(e), "trace": traceback.format_exc()[-1500:]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=20)
    ap.add_argument("--profiles", default="all")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--same-occasion", action="store_true",
                    help="sensitivity run: live monitoring right after a fresh ring calibration (no day-to-day shift)")
    args = ap.parse_args()
    global LATER_OCCASION
    if args.same_occasion:
        LATER_OCCASION = None
    profiles = list(PROFILES) if args.profiles == "all" else args.profiles.split(",")
    jobs = [(p, 100 + s, s == 0) for p in profiles for s in range(args.seeds)]
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with ProcessPoolExecutor(args.workers, initializer=_set_occasion, initargs=(LATER_OCCASION,)) as ex:
        results = list(ex.map(_job, jobs))
    meta = {"generator_version": GENERATOR_VERSION, "seeds_per_profile": args.seeds, "profiles": profiles,
            "protocol": {"settle_s": SETTLE_S, "rest_blocks": N_REST, "task_blocks": N_TASK, "recovery_blocks": N_REC,
                         "live": LIVE, "ring_windows": [RING_REST, RING_TASK, RING_REC], "grace_s": GRACE_S, "onset_s": ONSET_S},
            "runtime_s": time.time() - t0}
    meta["ring_later_occasion"] = LATER_OCCASION
    name = "results_same_occasion.json" if args.same_occasion else "results.json"
    (OUT / name).write_text(json.dumps({"meta": meta, "runs": results}, default=float))
    errs = [r for r in results if "error" in r]
    print(f"{len(results)} runs in {meta['runtime_s'] / 60:.1f} min, {len(errs)} errors")
    for e in errs[:3]:
        print(e["profile"], e["seed"], e["trace"])


if __name__ == "__main__":
    main()
