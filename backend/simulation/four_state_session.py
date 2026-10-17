"""
Four-state demo session (SIMULATED): one virtual user whose mind (EEG) and body
(HRV/GSR) are driven SEPARATELY, so each condition the dashboards show appears
in turn, with a clear rise and a full recovery to calm in between:

  Relaxed / normal   mind calm,   body calm
  High mental load   mind loaded, body calm     ("You're concentrating hard.")
  Physical arousal   mind calm,   body aroused  ("Your body is activated ...")
  Stress             mind loaded, body aroused  ("High load and high arousal ...")

Data:
  EEG   REAL SAM40 T7-T8 trials of one subject (simkit/eeg.py): Relax trials when
        the mind is calm, Arithmetic/Stroop/Mirror trials when loaded, plus the
        headband layer measured on real wearable02 blocks.
  Ring  beat intervals / GSR ADC (simkit/ring.py), resting HR / skin level from real
        ring users (reference/real_iot_ranges.json); the response at full arousal
        is WESAD's baseline -> TSST class difference (HR +22.8 bpm, RMSSD -17 %,
        SCL +1.1 uS, SCRs 3.6 -> 6.8 /min); see the grounding table in the report.

Everything is scored by the deployed backend code (imported read-only, nothing
deployed is changed): EEG calibration -> personal threshold (rest -> task ->
recovery ABA rule) -> infer_bipolar_block; ring compute_baseline ->
midpoint_stress_threshold -> predict_window; fusion_engin (aligned scale);
mind / body HIGH = 2 of the last 3 readings at/above their own limit, combined
into the four states exactly as web/src/lib/condition.js does.

  venv/bin/python backend/simulation/four_state_session.py              # demo user, figure + report
  venv/bin/python backend/simulation/four_state_session.py --seeds 10   # + repeat check over 10 users
"""
import argparse
import json
import math
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

SIM = Path(__file__).resolve().parent
REPO = SIM.parents[1]
for p in (REPO, SIM, REPO / "fushion engin"):
    sys.path.insert(0, str(p))

from backend.common.config import GSR_CAL  # noqa: E402
from backend.physiological.extract_features import adc_to_conductance, compute_signal_quality, extract_features  # noqa: E402
from backend.physiological.predictor import (  # noqa: E402
    PERSONAL_THRESHOLD_MIN_SEPARATION, STRESS_DECISION_THRESHOLD, compute_baseline, midpoint_stress_threshold,
    predict_window,
)
from backend.psychological.realtime.firebase_sync import make_eeg_fusion_record, make_eeg_output_record  # noqa: E402
from backend.psychological.realtime.pipeline import RealtimeInference  # noqa: E402
import fusion_engin  # noqa: E402
from simkit.evaluate import MODEL_DIR, N_REST, N_TASK, RING_REST, RING_TASK, Run, _samples  # noqa: E402
from simkit.session import EXPECTED_STATE, FOUR_STATE  # noqa: E402
from simkit.ring import window_arrays  # noqa: E402

OUT = SIM / "output" / "four_state"
PROFILE = "responsive"   # simkit.profiles DEMO_PROFILES: the live stimulator's default user
BLOCK_S = 25.0
GRACE_S = 120          # physiological onset / recovery time before a phase is judged
END_S = 180            # 'end of phase' window
SETTLE_S = 120         # bridge settle before every EEG calibration attempt
# The live stimulator's protocol (live_stimulator.py): the bridge's EEG calibration
# (rest, 19 task, 7 recovery blocks), repeated up to MAX_EEG_RETRIES times when it
# doesn't end 'ok'; the ring calibrates alongside the first attempt and keeps
# recording recovery into the following calm until it has RING_RECOVERY_WINDOWS.
N_REC = 7
MAX_EEG_RETRIES = 2
RING_RECOVERY_WINDOWS = 8
# Calibration and live monitoring in ONE sitting: no day-to-day shift of the
# ring baseline (simkit.evaluate's --same-occasion case).
LATER_OCCASION = None

# Live plan = the live stimulator's 'four_state' scenario (simkit.session.FOUR_STATE):
# (phase, seconds, mind demand, body demand, expected state); recoveries numbered.
PLAN, _n = [], 0
for _name, _dur, _m, _b in FOUR_STATE:
    if _name == "recovery":
        _n += 1
        _name = f"recovery_{_n}"
    PLAN.append((_name, _dur, _m, _b, EXPECTED_STATE[_name.split("_")[0]]))
LABELS = {"relaxed": "Relaxed / normal", "mental": "High mental load", "arousal": "Physical arousal", "stress": "Stress"}
COLORS = {"relaxed": "#7fb77e", "mental": "#5b8def", "arousal": "#f0a04b", "stress": "#d9534f", None: "#cccccc"}


def ring_window(packets):
    """60 s of ring packets -> (features, quality, status, feature dict)."""
    ibi, gsr, acc = window_arrays(packets)
    if len(ibi) < 10 or len(gsr) < 20 or len(acc) < 10:
        return None, None, "insufficient", None
    f2, motion, fd, fallback, _ = extract_features(ibi, gsr, acc, GSR_CAL, actual_fs=5)
    q = compute_signal_quality(ibi, gsr, acc, motion, actual_fs=5)
    status = "motion" if motion else "hrv_fallback" if fallback else "ok"
    return (f2 if status == "ok" else None), q, status, fd


def raw_summary(packets):
    """Mean HR (bpm) and skin conductance (uS) straight from the raw packets."""
    ibi, gsr, _ = window_arrays(packets)
    hr = 60000.0 / float(np.median(ibi)) if ibi else None
    scl = float(np.median(adc_to_conductance(np.array(gsr, float), GSR_CAL))) if gsr else None
    return hr, scl


def persistent(flags):
    """2 of the last 3 non-missing readings (condition.js / evaluate.py)."""
    out = []
    for i in range(len(flags)):
        recent = [f for f in flags[max(0, i - 2):i + 1] if f is not None]
        out.append(None if not recent else sum(recent) >= 2)
    return out


def quadrant(mind_high, body_high):
    if mind_high is None and body_high is None:
        return None
    m, b = bool(mind_high), bool(body_high)
    return "stress" if m and b else "mental" if m else "arousal" if b else "relaxed"


def eeg_calibration(R):
    """One bridge EEG calibration (settle, rolling rest window until >=8 trusted,
    19 task, 7 recovery blocks) -> (engine, threshold result, blocks, times)."""
    R.run_for(0.0, "settle", SETTLE_S)
    t_rest0 = R.t
    rest_blocks, seen, engine = [], 0, None
    while seen < 40:
        b = R.advance(0.0, "rest")
        if not b or b["lost"]:
            continue
        rest_blocks = (rest_blocks + [b])[-12:]
        seen += 1
        if len(rest_blocks) < N_REST:
            continue
        e = RealtimeInference(MODEL_DIR)
        for rb in rest_blocks:
            e.calibrate_bipolar_block(_samples(rb["uv"], rb["millis"]))
        out = e.finalize_calibration_bipolar(allow_degraded=seen >= 20)
        if out["status"] in ("ok", "degraded") and (seen >= 20 or out.get("n_blocks", 0) >= 8):
            engine = e
            break
    t_task0 = R.t
    task_blocks = R.run_blocks(1.0, "task", N_TASK)
    t_rec0 = R.t
    rec_blocks = R.run_blocks(0.0, "recovery", N_REC)
    thr = {}
    if engine is not None:
        for b in task_blocks:
            engine.score_threshold_task_block(_samples(b["uv"], b["millis"]))
        for b in rec_blocks:
            engine.score_recovery_block(_samples(b["uv"], b["millis"]))
        thr = engine.finalize_personal_threshold()
        thr.update(engine.recovery_outcome())
    return engine, thr, {"rest": rest_blocks, "task": task_blocks, "recovery": rec_blocks}, (t_rest0, t_task0, t_rec0, R.t)


def run(seed):
    R = Run(PROFILE, seed)
    u = R.u
    # ── Calibration, EEG: as the live stimulator -- retried when it doesn't end 'ok' ──
    attempts = []
    for k in range(MAX_EEG_RETRIES + 1):
        engine, thr, blocks, times = eeg_calibration(R)
        attempts.append(thr.get("calibration_status") if engine else "calibration_failed")
        if k == 0:
            first_times = times
        if attempts[-1] == "ok":
            break
    rest_blocks, task_blocks, rec_blocks = blocks["rest"], blocks["task"], blocks["recovery"]
    t_rest0, t_task0, t_rec0, t_cal_end = first_times      # ring: calibrated alongside the first attempt
    e_rest0, e_task0, e_rec0, e_end = times                 # EEG: the attempt in use
    # the ring keeps recording recovery into the following calm (live_stimulator.py)
    t_ring_end = max(R.t, t_cal_end)
    if t_ring_end - t_rec0 < 60 * (RING_RECOVERY_WINDOWS + 1):
        R.run_for(0.0, "calm", 60 * (RING_RECOVERY_WINDOWS + 1) - (t_ring_end - t_rec0))
        t_ring_end = R.t

    # ── Calibration, ring: consecutive 60 s windows over rest / task / recovery ──
    pk = [(t, p) for t, p in R.packets if t >= t_rest0]
    wins, i = [], 0
    while i + 300 <= len(pk):
        ps = [p for _, p in pk[i:i + 300]]
        wins.append((pk[i + 299][0], ring_window(ps), raw_summary(ps)))
        i += 300
    ok = [w for w in wins if w[1][2] == "ok"]
    rest_w = [w for w in ok if w[0] <= t_task0][:RING_REST]
    task_w = [w for w in ok if t_task0 < w[0] <= t_rec0][-RING_TASK:]
    rec_w = [w for w in ok if t_rec0 < w[0] <= t_ring_end][:RING_RECOVERY_WINDOWS]
    ring = {"status": "calibration_failed", "limit": None}
    if len(rest_w) >= 2 and task_w:
        bm, bs = compute_baseline(np.array([w[1][0][0] for w in rest_w]), n_windows=len(rest_w))
        score = lambda f: float(predict_window(f, bm, bs)["prob_stress"])  # noqa: E731
        rs, ts, cs = ([score(w[1][0]) for w in ws] for ws in (rest_w, task_w, rec_w))
        mid = midpoint_stress_threshold(rs, ts, recovery_scores=cs)
        ring = {"rest": rs, "task": ts, "recovery": cs, "status": mid["status"] if mid else None,
                "separated": bool(mid and mid["separated"]), "mid": mid,
                "limit": mid["limit"] if mid and mid["separated"] else STRESS_DECISION_THRESHOLD, "baseline": (bm, bs),
                "t": {"rest": [w[0] - t_rest0 for w in rest_w], "task": [w[0] - t_rest0 for w in task_w],
                      "recovery": [w[0] - t_rest0 for w in rec_w]},
                "hr": {k: [w[2][0] for w in ws] for k, ws in (("rest", rest_w), ("task", task_w), ("recovery", rec_w))},
                "scl": {k: [w[2][1] for w in ws] for k, ws in (("rest", rest_w), ("task", task_w), ("recovery", rec_w))}}
    calib = {
        "eeg_status": thr.get("calibration_status") if engine else "calibration_failed",
        "eeg_attempts": attempts,
        "eeg_direction": thr.get("personal_direction"), "eeg_separation_sd": thr.get("separation_sd"),
        "eeg_reversal_sd": thr.get("reversal_sd"),
        "eeg_rest": thr.get("rest_scores"), "eeg_task": thr.get("task_scores"), "eeg_recovery": thr.get("recovery_scores"),
        "eeg_t": {"rest": [b["t_end"] - e_rest0 for b in rest_blocks], "task": [b["t_end"] - e_rest0 for b in task_blocks],
                  "recovery": [b["t_end"] - e_rest0 for b in rec_blocks]},
        "eeg_baseline_logit": thr.get("baseline_logit"), "eeg_limit_logit": thr.get("limit_logit"),
        "eeg_rest_sd_logit": thr.get("rest_sd_logit"), "eeg_z_alert": thr.get("z_alert"),
        "ring": {k: v for k, v in ring.items() if k not in ("baseline",)},
        "phases_s": {"rest": [0, e_task0 - e_rest0], "task": [e_task0 - e_rest0, e_rec0 - e_rest0],
                     "recovery": [e_rec0 - e_rest0, e_end - e_rest0]},
        "ring_phases_s": {"rest": [0, t_task0 - t_rest0], "task": [t_task0 - t_rest0, t_rec0 - t_rest0],
                          "recovery": [t_rec0 - t_rest0, t_ring_end - t_rest0]},
    }

    # ── Live: mind and body driven separately ──
    if LATER_OCCASION:
        u.ring.later_occasion(*LATER_OCCASION)
    live, hist, ring_pred, t0 = [], [], [], R.t
    next_ring = R.t + 20.0
    periods = []
    for name, dur, mind_d, body_d, expect in PLAN:
        start = R.t - t0
        for _ in range(int(round(dur / 0.2))):
            b = R.advance(float(mind_d), name.split("_")[0], body=float(body_d))
            if ring.get("baseline") and R.t >= next_ring:
                next_ring += 20.0
                recent = [p for t, p in R.packets if R.t - 60.0 <= t < R.t]
                f2, q, why, _ = ring_window(recent)
                hr, scl = raw_summary(recent)
                if why == "ok":
                    bm, bs = ring["baseline"]
                    ring_pred.append((R.t, float(predict_window(f2, bm, bs)["prob_stress"]), q, hr, scl))
            if b is None:
                continue
            row = {"t": b["t_end"] - t0, "phase": name, "expect": expect, "mind_demand": mind_d, "body_demand": body_d,
                   "load_brain": b["loads"]["brain"], "load_heart": b["loads"]["heart"], "load_skin": b["loads"]["skin"],
                   "lost": b["lost"], "eeg_score": None, "skipped": None}
            fe = None
            if not b["lost"] and engine is not None:
                res = engine.infer_bipolar_block(_samples(b["uv"], b["millis"]))
                hist.append(res.get("calibrated_p") if not res.get("skipped") else None)
                rec = make_eeg_output_record(res, window_sec=BLOCK_S, model_version="bipolar_only_v1",
                                             feature_set="bipolar_only_v1", history_scores=hist,
                                             high_load_p=engine.thresholds.high_load_p, capture_end_ts=1.8e9 + b["t_end"])
                fe = make_eeg_fusion_record(rec)
                row.update({"skipped": bool(rec.get("skipped")), "eeg_score": rec.get("task_state_score")})
            bucket = [x for x in ring_pred if b["t_end"] - BLOCK_S <= x[0] < b["t_end"]]
            rp = bucket[-1] if bucket else None
            mods = {"eeg": ({"prob": fe["prob_eeg"], "confidence": fe["conf_eeg"], "signal_quality": fe["signal_quality_eeg"],
                             "model_acc": fe["model_acc_eeg"], "threshold": fe["threshold_eeg"],
                             "threshold_scale": fe["threshold_scale_eeg"], "z": fe["z_logit_eeg"], "z_alert": fe["z_alert_eeg"]}
                            if fe else {"prob": None}),
                    "hrv_gsr": ({"prob": rp[1], "confidence": max(rp[1], 1 - rp[1]), "signal_quality": rp[2], "model_acc": 0.851,
                                 "threshold": ring["limit"], "threshold_scale": PERSONAL_THRESHOLD_MIN_SEPARATION}
                                if rp and ring.get("limit") is not None else {"prob": None})}
            fu = fusion_engin.compute_realtime_multimodal_fusion(mods, scale="aligned")
            al = fu.get("aligned_probs") or {}
            row.update({"mind": al.get("eeg"), "body": al.get("hrv_gsr"), "fused": fu.get("fused_stress_probability"),
                        "ring_p": rp[1] if rp else None, "hr": rp[3] if rp else None, "scl": rp[4] if rp else None})
            live.append(row)
        periods.append((name, start, R.t - t0, expect))

    mh = persistent([None if r["mind"] is None else r["mind"] >= 0.5 for r in live])
    bh = persistent([None if r["body"] is None else r["body"] >= 0.5 for r in live])
    for r, m, bb in zip(live, mh, bh):
        r["mind_high"], r["body_high"], r["state"] = m, bb, quadrant(m, bb)
    return {"seed": seed, "eeg_subject": u.params.eeg["subject"], "ring_params": {k: u.params.ring[k] for k in ("hr0", "d_hr", "scl0", "d_scl")},
            "calibration": calib, "live": live, "periods": periods, "metrics": phase_metrics(live, periods)}


def phase_metrics(live, periods):
    """Per phase: share of blocks in the expected state after the first 2 min
    (hit_rate), in the last 3 min (end_share: has the state settled / has the
    user recovered?), and time from phase start to the expected state, first of
    2 blocks in a row (for a recovery phase: the time to return to Relaxed)."""
    out = {}
    for name, s, e, expect in periods:
        rows = [r for r in live if s <= r["t"] < e]
        judged = [r for r in rows if r["t"] >= s + GRACE_S and r["state"] is not None]
        reach = None
        for a, b in zip(rows, rows[1:]):
            if a["state"] == expect and b["state"] == expect:
                reach = a["t"] - s
                break
        states = [r["state"] for r in judged]
        end = [r["state"] for r in rows if r["t"] >= e - END_S and r["state"] is not None]
        out[name] = {"expected": expect, "n_judged": len(judged),
                     "end_share": float(np.mean([x == expect for x in end])) if end else None,
                     "hit_rate": float(np.mean([x == expect for x in states])) if states else None,
                     "time_to_state_s": reach,
                     "state_share": {k: states.count(k) / len(states) for k in LABELS} if states else {},
                     "mind_mean": _mean([r["mind"] for r in judged]), "body_mean": _mean([r["body"] for r in judged]),
                     "hr_mean": _mean([r["hr"] for r in judged]), "scl_mean": _mean([r["scl"] for r in judged])}
    return out


def _mean(v):
    v = [x for x in v if x is not None]
    return float(np.mean(v)) if v else None


# ── Figure ──────────────────────────────────────────────────────────
def figure(res, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    c, live = res["calibration"], res["live"]
    fig = plt.figure(figsize=(17, 13))
    gs = fig.add_gridspec(5, 2, height_ratios=[1.1, 1.1, 1, 1, 0.35], width_ratios=[1, 2.0], hspace=0.5, wspace=0.28)
    pc = {"rest": "#7fb77e", "task": "#d9534f", "recovery": "#5bc0de"}

    def shade_cal(ax, key="phases_s"):
        for k, (a, b) in c[key].items():
            ax.axvspan(a / 60, b / 60, color=pc[k], alpha=0.12, lw=0)

    # EEG calibration trend
    ax = fig.add_subplot(gs[0, 0])
    shade_cal(ax)
    for k in ("rest", "task", "recovery"):
        s = c[f"eeg_{k}"] or []
        t = c["eeg_t"][k][-len(s):] if s else []
        ax.plot(np.array(t) / 60, s, "o-", color=pc[k], ms=4, label=f"{k} (median {np.median(s):.2f})" if s else k)
    if c["eeg_baseline_logit"] is not None:
        sig = lambda x: 1 / (1 + math.exp(-x))  # noqa: E731
        ax.axhline(sig(c["eeg_baseline_logit"]), color="k", ls=":", lw=1, label="baseline")
        if c["eeg_limit_logit"] is not None:
            ax.axhline(sig(c["eeg_limit_logit"]), color="k", ls="--", lw=1, label="personal limit")
    att = f" (attempt {len(c['eeg_attempts'])})" if len(c.get("eeg_attempts") or []) > 1 else ""
    ax.set_title(f"Calibration, mind (EEG): {c['eeg_status']}{att}, direction {c['eeg_direction']:+d}, "
                 f"separation {c['eeg_separation_sd']:.1f} SD" if c["eeg_separation_sd"] is not None else
                 f"Calibration, mind (EEG): {c['eeg_status']}", fontsize=10)
    ax.set_ylabel("task_state_score")
    ax.legend(fontsize=7, loc="best")

    # Ring calibration trend
    ax = fig.add_subplot(gs[1, 0])
    shade_cal(ax, "ring_phases_s")
    rg = c["ring"]
    for k in ("rest", "task", "recovery"):
        s = rg.get(k) or []
        ax.plot(np.array(rg.get("t", {}).get(k, []))[:len(s)] / 60, s, "s-", color=pc[k], ms=5,
                label=f"{k} (median {np.median(s):.2f})" if s else k)
    if rg.get("limit") is not None:
        ax.axhline(rg["limit"], color="k", ls="--", lw=1, label="personal limit")
    ax.set_title(f"Calibration, body (ring): {rg.get('status')}", fontsize=10)
    ax.set_ylabel("prob_stress")
    ax.set_xlabel("minutes from rest start")
    ax.legend(fontsize=7, loc="best")

    # Ring raw calibration: HR and SCL
    ax = fig.add_subplot(gs[2:4, 0])
    shade_cal(ax, "ring_phases_s")
    ax2 = ax.twinx()
    for k in ("rest", "task", "recovery"):
        t = np.array(rg.get("t", {}).get(k, [])) / 60
        ax.plot(t, rg.get("hr", {}).get(k, []), "o-", color=pc[k], ms=4)
        ax2.plot(t, rg.get("scl", {}).get(k, []), "^--", color=pc[k], ms=4)
    ax.set_ylabel("heart rate, bpm (o)")
    ax2.set_ylabel("skin conductance, uS (^)")
    ax.set_xlabel("minutes from rest start")
    ax.set_title("Calibration raw ring signals: rest -> task -> recovery", fontsize=10)

    # Live
    t = np.array([r["t"] for r in live]) / 60

    def shade_live(ax):
        for name, s, e, expect in res["periods"]:
            ax.axvspan(s / 60, e / 60, color=COLORS[expect], alpha=0.13, lw=0)

    ax = fig.add_subplot(gs[0, 1])
    shade_live(ax)
    for name, s, e, expect in res["periods"]:
        ax.text((s + e) / 120, 1.02, LABELS[expect] if not name.startswith("recovery") else "recovery",
                ha="center", va="bottom", fontsize=8, transform=ax.get_xaxis_transform())
    ax.plot(t, [r["mind"] for r in live], "-", color="#5b8def", lw=1.6, label="mind (EEG), own scale")
    ax.plot(t, [r["body"] for r in live], "-", color="#f0a04b", lw=1.6, label="body (ring), own scale")
    ax.axhline(0.5, color="k", ls="--", lw=1, label="own limit (0.50)")
    ax.set_ylim(0, 1)
    ax.set_ylabel("aligned score")
    ax.legend(fontsize=7, loc="upper left", ncol=3)
    ax.set_title("Live monitoring: mind and body each against its OWN calibrated limit", fontsize=10, pad=16)

    ax = fig.add_subplot(gs[1, 1], sharex=ax)
    shade_live(ax)
    ax.plot(t, [r["load_brain"] for r in live], color="#5b8def", lw=1.2, label="mind demand (latent)")
    ax.plot(t, [r["load_heart"] for r in live], color="#c0392b", lw=1.2, label="heart load (latent)")
    ax.plot(t, [r["load_skin"] for r in live], color="#f0a04b", lw=1.2, label="skin load (latent)")
    ax.set_ylabel("ground truth")
    ax.legend(fontsize=7, loc="upper left", ncol=3)

    ax = fig.add_subplot(gs[2, 1], sharex=ax)
    shade_live(ax)
    ax.plot(t, [r["hr"] for r in live], color="#c0392b", lw=1.2)
    ax.set_ylabel("HR bpm", color="#c0392b")
    ax2 = ax.twinx()
    ax2.plot(t, [r["scl"] for r in live], color="#f0a04b", lw=1.2)
    ax2.set_ylabel("SCL uS", color="#f0a04b")

    ax = fig.add_subplot(gs[3, 1], sharex=ax)
    shade_live(ax)
    ax.plot(t, [r["eeg_score"] for r in live], ".", color="#5b8def", ms=4)
    ax.set_ylabel("EEG raw score")

    ax = fig.add_subplot(gs[4, 1], sharex=ax)
    for r in live:
        ax.axvspan((r["t"] - BLOCK_S) / 60, r["t"] / 60, color=COLORS[r["state"]], lw=0)
    ax.set_yticks([])
    ax.set_xlabel("minutes into live monitoring")
    ax.set_title("Detected state (2 of last 3 rule, as the app shows it)", fontsize=9)
    ax.legend(handles=[Patch(color=COLORS[k], label=v) for k, v in LABELS.items()], fontsize=7, ncol=4,
              loc="upper center", bbox_to_anchor=(0.5, -0.9))

    m = res["metrics"]
    lines = [f"{n}: {LABELS[v['expected']]} {v['hit_rate']:.0%} after 2 min, {v['end_share']:.0%} in last 3 min" +
             (f", reached in {v['time_to_state_s'] / 60:.1f} min" if v["time_to_state_s"] is not None else ", not reached")
             for n, v in m.items() if v["hit_rate"] is not None]
    fig.text(0.02, -0.02, f"SIMULATED  |  seed {res['seed']}, SAM40 subject {res['eeg_subject']}\n" + "\n".join(lines),
             fontsize=8, va="top")
    fig.suptitle("MindPulse four-state session (SIMULATED: real SAM40 EEG + ring model, scored by the deployed backend)",
                 fontsize=12, y=0.995)
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)


# ── Grounding: simulated vs real data ───────────────────────────────
def grounding(res):
    ref = json.loads((SIM / "reference" / "real_iot_ranges.json").read_text())["ring"]
    m = res["metrics"]
    rest_hr, rest_scl = m["relaxed"]["hr_mean"], m["relaxed"]["scl_mean"]
    ar_hr, ar_scl = m["arousal"]["hr_mean"], m["arousal"]["scl_mean"]
    st_hr, st_scl = m["stress"]["hr_mean"], m["stress"]["scl_mean"]
    hr_ref, scl_ref = ref["per_user_median_hr"], ref["per_user_median_scl"]
    return [
        ("Rest heart rate (bpm)", rest_hr, f"real ring users median {hr_ref['median']:.0f}, p5-p95 {hr_ref['p5']:.0f}-{hr_ref['p95']:.0f}"),
        ("Rest skin conductance (uS)", rest_scl, f"real ring users median {scl_ref['median']:.1f}, p5-p95 {scl_ref['p5']:.1f}-{scl_ref['p95']:.1f}"),
        ("HR rise, physical arousal (bpm)", _d(ar_hr, rest_hr), "WESAD baseline -> TSST: 72.2 -> 95.0 (+22.8)"),
        ("HR rise, stress (bpm)", _d(st_hr, rest_hr), "WESAD baseline -> TSST: 72.2 -> 95.0 (+22.8)"),
        ("SCL rise, physical arousal (uS)", _d(ar_scl, rest_scl), "WESAD 1.17 -> 2.27 (+1.10; per subject +0.11..+3.37)"),
        ("SCL rise, stress (uS)", _d(st_scl, rest_scl), "WESAD 1.17 -> 2.27 (+1.10; per subject +0.11..+3.37)"),
        ("EEG", res["eeg_subject"], "real SAM40 T7-T8 trials of this subject (Relax vs Arithmetic/Stroop/Mirror)"),
    ]


def _d(a, b):
    return None if a is None or b is None else a - b


def report(res, path, multi=None):
    c, m = res["calibration"], res["metrics"]
    L = ["# Four-state session (SIMULATED)", "",
         f"Seed {res['seed']}, EEG = real SAM40 subject {res['eeg_subject']}. Scored by the deployed backend code.", "",
         "## Calibration: rest -> task -> recovery", "",
         f"EEG attempts (the stimulator recalibrates when not 'ok', up to {MAX_EEG_RETRIES} times): {' -> '.join(c['eeg_attempts'])}", "",
         "| Component | Rest median | Task median | Recovery median | Status | Separation |", "|---|---|---|---|---|---|"]
    med = lambda v: f"{np.median(v):.3f}" if v else "-"  # noqa: E731
    L.append(f"| Mind (EEG task_state_score) | {med(c['eeg_rest'])} | {med(c['eeg_task'])} | {med(c['eeg_recovery'])} | "
             f"{c['eeg_status']} (direction {c['eeg_direction']}) | {c['eeg_separation_sd']:.2f} SD |"
             if c["eeg_separation_sd"] is not None else f"| Mind | - | - | - | {c['eeg_status']} | - |")
    rg = c["ring"]
    L.append(f"| Body (ring prob_stress) | {med(rg.get('rest'))} | {med(rg.get('task'))} | {med(rg.get('recovery'))} | "
             f"{rg.get('status')} | limit {rg.get('limit'):.3f} |" if rg.get("limit") is not None else
             f"| Body | - | - | - | {rg.get('status')} | - |")
    L.append(f"| Body raw HR (bpm) | {med(rg.get('hr', {}).get('rest'))} | {med(rg.get('hr', {}).get('task'))} | "
             f"{med(rg.get('hr', {}).get('recovery'))} | | |")
    L.append(f"| Body raw SCL (uS) | {med(rg.get('scl', {}).get('rest'))} | {med(rg.get('scl', {}).get('task'))} | "
             f"{med(rg.get('scl', {}).get('recovery'))} | | |")
    L += ["", "## Live: each state, its rise and its recovery", "",
          f"Judged after the first {GRACE_S // 60} min of each phase (physiological onset / recovery).", "",
          "| Phase | Expected | After 2 min | Last 3 min | Time to state | Mind mean | Body mean | HR | SCL | Shares |", "|---|---|---|---|---|---|---|---|---|---|"]
    f = lambda x, p=2: "-" if x is None else f"{x:.{p}f}"  # noqa: E731
    for n, v in m.items():
        sh = ", ".join(f"{k} {s:.0%}" for k, s in v["state_share"].items() if s)
        L.append(f"| {n} | {LABELS[v['expected']]} | {f(v['hit_rate'] and v['hit_rate'] * 100, 0)}% | "
                 f"{f(v['end_share'] and v['end_share'] * 100, 0)}% | "
                 f"{f(v['time_to_state_s'] and v['time_to_state_s'] / 60, 1)} min | {f(v['mind_mean'])} | {f(v['body_mean'])} | "
                 f"{f(v['hr_mean'], 1)} | {f(v['scl_mean'])} | {sh} |")
    L += ["", "## Simulated vs real data", "", "| Quantity | This session | Real reference |", "|---|---|---|"]
    for q, v, r in grounding(res):
        L.append(f"| {q} | {v if isinstance(v, int) else f(v, 1)} | {r} |")
    if multi:
        passed = [r for r in multi if r["calibration"]["eeg_status"] == "ok" and r["calibration"]["ring"].get("status") == "ok"]
        for title, group in ((f"calibration passed on both (EEG ok and ring ok): {len(passed)} users", passed),
                             (f"all {len(multi)} users, including failed calibrations (fallback limits)", multi)):
            if group:
                L += repeat_table(title, group, m)
        st = {}
        for r in multi:
            k = (r["calibration"]["eeg_status"], r["calibration"]["ring"].get("status"))
            st[k] = st.get(k, 0) + 1
        L += ["", "Calibration status (EEG, ring) over these users: " + ", ".join(f"{k}: {v}" for k, v in st.items())]
        na = {}
        for r in multi:
            n = len(r["calibration"]["eeg_attempts"])
            na[n] = na.get(n, 0) + 1
        L += ["", "EEG calibration attempts needed: " + ", ".join(f"{k}: {v} users" for k, v in sorted(na.items()))]
    path.write_text("\n".join(L) + "\n")


def repeat_table(title, multi, m):
    if True:
        L = ["", f"## Repeat check, {title}", "",
              "| Phase | After 2 min (mean) | Last 3 min (mean) | Median time to state | Users reaching the state |", "|---|---|---|---|---|"]
        for n in m:
            hr = [r["metrics"][n]["hit_rate"] for r in multi if r["metrics"][n]["hit_rate"] is not None]
            reach = sum(r["metrics"][n]["time_to_state_s"] is not None for r in multi)
            es = [r["metrics"][n]["end_share"] for r in multi if r["metrics"][n]["end_share"] is not None]
            tt = [r["metrics"][n]["time_to_state_s"] / 60 for r in multi if r["metrics"][n]["time_to_state_s"] is not None]
            L.append(f"| {n} | {np.mean(hr):.0%} | {np.mean(es):.0%} | {np.median(tt) if tt else float('nan'):.1f} min | {reach}/{len(multi)} |")
    return L


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=None,
                    help="demo user; default: the first seed from 1 whose EEG AND ring calibration pass "
                         "(the app asks for recalibration otherwise). Chosen on calibration only, never on live results.")
    ap.add_argument("--seeds", type=int, default=0, help="also repeat over this many other users")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.seed is None:
        for seed in range(1, 100):
            res = run(seed)
            c = res["calibration"]
            print(f"seed {seed}: EEG {c['eeg_status']}, ring {c['ring'].get('status')}")
            if c["eeg_status"] == "ok" and c["ring"].get("status") == "ok":
                break
        args.seed = seed
    else:
        res = run(args.seed)
    figure(res, OUT / f"four_state_seed{args.seed}.png")
    (OUT / f"four_state_seed{args.seed}.json").write_text(json.dumps(res, default=float, indent=1))
    multi = None
    if args.seeds:
        with ProcessPoolExecutor(args.workers) as ex:
            multi = list(ex.map(run, range(200, 200 + args.seeds)))
        (OUT / "four_state_multi.json").write_text(json.dumps([{k: r[k] for k in ("seed", "eeg_subject", "metrics")}
                                                               | {"calibration": {"eeg_status": r["calibration"]["eeg_status"],
                                                                                  "ring_status": r["calibration"]["ring"].get("status")}}
                                                               for r in multi], default=float, indent=1))
    report(res, OUT / f"four_state_seed{args.seed}.md", multi)
    print((OUT / f"four_state_seed{args.seed}.md").read_text())


if __name__ == "__main__":
    main()
