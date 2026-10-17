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
from .session import SCENARIOS, STEP, VirtualUser
from backend.common.early_warning import EarlyWarning, mind_led

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
# Live scenario: None = LIVE above (steps, the original study); "ramp" = gradual
# rise + moderate-load plateau (session.SCENARIOS) for the early-warning study.
SCENARIO = None
EW_HORIZON_S = 300          # a warning "leads to" HIGH if HIGH starts within 5 min
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

    def advance(self, demand, phase, body=None):
        s = self.u.step(demand, phase, body=body)
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

    def run_for(self, demand, phase, seconds, body=None):
        for _ in range(int(round(seconds / STEP))):
            self.advance(demand, phase, body)

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
    live_plan = ([(n, d, 1.0 if n == "demand" else 0.0, 1.0 if n == "demand" else 0.0) for n, d in LIVE]
                 if SCENARIO is None else SCENARIOS[SCENARIO])
    for name, dur, d0, d1 in live_plan:
        start = R.t
        steps = int(round(dur / STEP))
        for k_step in range(steps):
            demand = d0 + (d1 - d0) * k_step / steps
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

    early_warning(live, engine, thr, ring, R.u.ring is not None)
    m = metrics(live, periods)
    m.update(ew_metrics(live, periods))
    if SCENARIO == "ramp":          # detector inputs, so parameters can be re-tested without re-simulating
        m["ew_inputs"] = {"periods": periods,
                          "rows": [{k: r.get(k) for k in ("t", "period", "eeg_z", "lost", "skipped", "mind", "body", "fused",
                                                          "mind_alert", "fused_alert")} for r in live],
                          "z_alert": getattr(engine, "z_alert", 0.84) if engine else 0.84,
                          "eeg_status": thr.get("calibration_status") if engine else None,
                          "ring_limit": ring.get("limit"), "ring_present": R.u.ring is not None,
                          "eeg_rest": thr.get("rest_scores"), "ring_rest": ring.get("rest"),
                          "mu_rest_logit": getattr(engine, "mu_rest_logit", None), "direction": getattr(engine, "direction", 1),
                          "sigma": getattr(engine, "sigma", None)}
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


def _aligned(z):
    return 1.0 / (1.0 + math.exp(-max(-3.0, min(3.0, z))))


def early_warning(live, engine, thr, ring, ring_present, params=None):
    """Early-warning states per live block for mind and fused
    (backend/common/early_warning.py), as the dashboard computes them."""
    eeg_ok = engine is not None and thr.get("calibration_status") == "ok"
    mind_reason = None if eeg_ok else f"EEG calibration {thr.get('calibration_status') or 'missing'}"
    # Mind: oriented z (task_state_z): baseline 0, limit z_alert, spread 1.
    z_alert = getattr(engine, "z_alert", 0.84) if engine else 0.84
    from backend.common.early_warning import DEFAULT
    params = params or DEFAULT
    mind = EarlyWarning(0.0, z_alert, 1.0, params)
    # Fused: calm level and spread from the calibration's rest blocks on the
    # fusion scale (mind and body aligned, paired by position).
    fused_rest = []
    if engine is not None and engine.mu_rest_logit is not None:
        from backend.psychological.sam40.decision import logit
        mr = [_aligned(engine.direction * (logit(p) - engine.mu_rest_logit) / engine.sigma - z_alert)
              for p in (thr.get("rest_scores") or []) if 0 < p < 1 and abs(logit(p)) <= 40]
        br = [_aligned((p - ring["limit"]) / PERSONAL_THRESHOLD_MIN_SEPARATION) for p in (ring.get("rest") or [])] \
            if ring.get("limit") is not None else []
        n = max(len(mr), len(br))
        for i in range(n):
            v = [x[int(i * len(x) / n)] for x in (mr, br) if x]
            fused_rest.append(float(np.mean(v)))
    fb = float(np.median(fused_rest)) if fused_rest else 0.25
    fs = max(0.05, float(np.std(fused_rest, ddof=1))) if len(fused_rest) > 1 else 0.05
    fused = EarlyWarning(fb, 0.5, fs, params)
    ring_missing_baseline = ring_present and ring.get("limit") is None
    for r in live:
        valid = not (r.get("lost") or r.get("skipped")) and r.get("eeg_z") is not None
        o = mind.update(r.get("eeg_z"), valid=valid, suppressed=mind_reason, high_alert=bool(r.get("mind_alert")))
        r["mind_ew"], r["mind_ew_reason"] = o["state"], o["reason"]
        f_reason = ("ring baseline missing" if ring_missing_baseline and r["body"] is None
                    else (mind_reason and f"mind only and {mind_reason}") if r["body"] is None and mind_reason else None)
        o = fused.update(r["fused"], valid=r["fused"] is not None, suppressed=f_reason, high_alert=bool(r.get("fused_alert")))
        r["fused_ew"], r["fused_ew_reason"] = o["state"], o["reason"]
        r["mind_led"] = mind_led(r["mind_ew"], r["body"])


def _episodes(live, key):
    """Start times of runs of consecutive True in r[key]."""
    out, prev = [], False
    for r in live:
        cur = bool(r.get(key))
        if cur and not prev:
            out.append(r["t"])
        prev = cur
    return out


def ew_metrics(live, periods):
    out = {}
    high_periods = [(s, e) for n, s, e in periods if n in ("demand", "ramp")]
    calm = [(s, e) for n, s, e in periods if n == "calm"]
    calm_s = sum(max(0.0, e - (s + GRACE_S)) for s, e in calm if s > 0) + sum(e - s for s, e in calm if s == 0)
    in_calm = lambda t: any((s + (GRACE_S if s > 0 else 0)) <= t < e for s, e in calm)  # noqa: E731
    for key in ("mind", "fused"):
        st = f"{key}_ew"
        for r in live:
            r[f"{key}_is_warn"] = r[st] == "early_warning"
        warns = _episodes(live, f"{key}_is_warn")
        highs = _episodes(live, f"{key}_alert")
        # sensitivity / lead time: HIGH episodes in a high-load period preceded by a warning
        lead, n_high, preceded = [], 0, 0
        for h in highs:
            if not any(s <= h < e + GRACE_S for s, e in high_periods):
                continue
            n_high += 1
            before = [w for w in warns if h - EW_HORIZON_S <= w <= h]
            if before:
                preceded += 1
                lead.append(h - before[0])
        out[f"{key}_ew_sensitivity"] = preceded / n_high if n_high else None
        out[f"{key}_ew_lead_time_s"] = float(np.median(lead)) if lead else None
        followed = [w for w in warns if any(w <= h <= w + EW_HORIZON_S for h in highs)]
        out[f"{key}_ew_precision"] = len(followed) / len(warns) if warns else None
        out[f"{key}_ew_false_per_hour_calm"] = (len([w for w in warns if in_calm(w)]) / (calm_s / 3600.0)) if calm_s else None
        out[f"{key}_ew_in_plateau"] = len([w for w in warns if any(s <= w < e for n, s, e in periods if n == "plateau")])
        out[f"{key}_high_in_plateau"] = len([h for h in highs if any(s <= h < e for n, s, e in periods if n == "plateau")])
        out[f"{key}_ew_limited_share"] = float(np.mean([r[st] == "limited" for r in live])) if live else None
        out[f"{key}_ew_warnings"] = len(warns)
    fh = _episodes(live, "fused_alert")
    mind_first = 0
    for h in fh:
        m = [r for r in live if h - EW_HORIZON_S <= r["t"] <= h and r["mind_led"]]
        mind_first += bool(m)
    out["mind_led_share_of_fused_high"] = mind_first / len(fh) if fh else None
    return out


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


def _set_occasion(v, scenario=None):
    global LATER_OCCASION, SCENARIO
    LATER_OCCASION, SCENARIO = v, scenario


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
    ap.add_argument("--scenario", choices=("steps", "ramp"), default="steps")
    ap.add_argument("--seed0", type=int, default=100, help="first seed (dev / confirmation sets use other ranges)")
    ap.add_argument("--tag", default="", help="suffix for the results file")
    ap.add_argument("--same-occasion", action="store_true",
                    help="sensitivity run: live monitoring right after a fresh ring calibration (no day-to-day shift)")
    args = ap.parse_args()
    global LATER_OCCASION, SCENARIO
    if args.same_occasion:
        LATER_OCCASION = None
    SCENARIO = None if args.scenario == "steps" else args.scenario
    profiles = list(PROFILES) if args.profiles == "all" else args.profiles.split(",")
    jobs = [(p, args.seed0 + s, s == 0) for p in profiles for s in range(args.seeds)]
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with ProcessPoolExecutor(args.workers, initializer=_set_occasion, initargs=(LATER_OCCASION, SCENARIO)) as ex:
        results = list(ex.map(_job, jobs))
    meta = {"generator_version": GENERATOR_VERSION, "seeds_per_profile": args.seeds, "profiles": profiles,
            "protocol": {"settle_s": SETTLE_S, "rest_blocks": N_REST, "task_blocks": N_TASK, "recovery_blocks": N_REC,
                         "live": LIVE, "ring_windows": [RING_REST, RING_TASK, RING_REC], "grace_s": GRACE_S, "onset_s": ONSET_S},
            "runtime_s": time.time() - t0}
    meta["ring_later_occasion"] = LATER_OCCASION
    meta["scenario"] = args.scenario
    meta["seed0"] = args.seed0
    name = ("results_ramp.json" if SCENARIO == "ramp" else "results_same_occasion.json" if args.same_occasion else "results.json")
    if args.tag:
        name = name.replace(".json", f"_{args.tag}.json")
    (OUT / name).write_text(json.dumps({"meta": meta, "runs": results}, default=float))
    errs = [r for r in results if "error" in r]
    print(f"{len(results)} runs in {meta['runtime_s'] / 60:.1f} min, {len(errs)} errors")
    for e in errs[:3]:
        print(e["profile"], e["seed"], e["trace"])


if __name__ == "__main__":
    main()
