"""
Software stimulator: three simulated users under different conditions, run
end to end through the REAL MindPulse backend code (no re-implementation):

  EEG   realtime/pipeline.py RealtimeInference   calibrate_bipolar_block -> finalize_calibration_bipolar
        -> score_threshold_task_block / score_recovery_block -> finalize_personal_threshold
        (direction-aware ABA rule, sam40/decision.py) -> infer_bipolar_block (live)
        -> firebase_sync.make_eeg_output_record / make_eeg_fusion_record
  Ring  physiological/extract_features.extract_features -> predictor.compute_baseline / predict_window
        -> predictor.midpoint_stress_threshold (ABA)
  Fused fushion engin/fusion_engin.compute_realtime_multimodal_fusion (aligned scale) + 2-of-3 rule

Signals are synthetic but in the devices' own raw formats:
  EEG  T7-T8 bipolar ADC codes (adc.microvolts_to_bipolar_code), 1/f background + theta/alpha/beta/
       gamma rhythms, 25 s blocks at the headband's rate. "Load" is a theta increase / alpha decrease
       (frontal-midline theta, alpha suppression -- the direction the SAM40 model learned).
  Ring beat-to-beat intervals (ms), Grove GSR ADC at 5 Hz (inverse of adc_to_conductance), and
       accelerometer magnitude (g), 60 s windows. "Stress" = higher heart rate, lower variability,
       higher skin conductance with more skin-conductance responses.

Conditions (one simulated user each):
  sim_typical   score RISES under load, recovers afterwards     -> responsive, direction +1
  sim_inverted  score FALLS under load, recovers afterwards     -> responsive, direction -1
                (the pattern seen on wearable02 for mindpulse_user8)
  sim_drift     slow drift that starts in the task and never comes back (electrode settling),
                ring barely responds                            -> 'drift_suspected' / provisional limits

Protocol: calibration = 2 min settle (not simulated: discarded anyway) -> rest -> task -> recovery;
then live monitoring = calm -> stress episode -> calm, scored against the new limits.

Usage (from the repo root):
  venv/bin/python backend/simulation/simulate_sessions.py            # run + report + figure
  venv/bin/python backend/simulation/simulate_sessions.py --firebase # also write sim_* users to
                                                                    # Firebase for psy_web / StressApp
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "fushion engin"))

from backend.common.config import GSR_CAL, WINDOW_SEC  # noqa: E402
from backend.physiological.extract_features import compute_signal_quality, extract_features  # noqa: E402
from backend.physiological.predictor import (  # noqa: E402
    PERSONAL_THRESHOLD_MIN_SEPARATION, STRESS_DECISION_THRESHOLD, compute_baseline, midpoint_stress_threshold,
    predict_window,
)
from backend.psychological.realtime.adc import microvolts_to_bipolar_code  # noqa: E402
from backend.psychological.realtime.firebase_sync import make_eeg_fusion_record, make_eeg_output_record  # noqa: E402
from backend.psychological.realtime.mqtt_client import BipolarRawSample  # noqa: E402
from backend.psychological.realtime.pipeline import BLOCK_SEC, RealtimeInference  # noqa: E402
from backend.psychological.realtime.resample import SOURCE_FS  # noqa: E402
import fusion_engin  # noqa: E402

MODEL_DIR = REPO / "backend" / "psychological" / "models"
OUT_DIR = REPO / "backend" / "simulation" / "output"
N_REST, N_TASK, N_RECOVERY = 10, 19, 7            # EEG blocks (mqtt_bridge.py protocol)
RING_REST, RING_TASK, RING_RECOVERY = 4, 8, 3      # ring 60 s windows
LIVE = [("calm", 10), ("stress", 14), ("calm", 12)]  # live monitoring, EEG blocks
RING_FS = 5
MODEL_VERSION = "bipolar_only_v1"

# ── Synthetic signals ───────────────────────────────────────────────
# Resting EEG profile (uV of each rhythm) and how far "load" moves theta.
REST_EEG = dict(alpha=12.0, theta=4.0, beta=2.5, gamma=0.6, pink=6.0)
REST_RING = dict(hr=70.0, rmssd=45.0, scl=3.0, scr=1.0)
STRESS_RING = dict(hr=86.0, rmssd=24.0, scl=4.2, scr=5.0)


def eeg_block(rng, start_ms, theta_shift=0.0, jitter=0.08, **over):
    """One 25 s T7-T8 block as the headband sends it (millis, ADC code)."""
    p = {**REST_EEG, **over}
    n = int(BLOCK_SEC * SOURCE_FS)
    t = np.arange(n) / SOURCE_FS
    f = np.fft.rfftfreq(n, 1 / SOURCE_FS)
    X = np.fft.rfft(rng.normal(size=n))
    X[1:] /= np.sqrt(f[1:])
    X[0] = 0
    bg = np.fft.irfft(X, n)
    bg *= p["pink"] / bg.std()

    def band(lo, hi, amp):
        Y = np.fft.rfft(rng.normal(size=n))
        Y[(f < lo) | (f > hi)] = 0
        s = np.fft.irfft(Y, n)
        return amp * s / (s.std() + 1e-12)

    theta = p["theta"] + theta_shift + rng.normal(0, jitter)        # block-to-block variability
    alpha = p["alpha"] - 2.0 * theta_shift + rng.normal(0, 4 * jitter)
    uv = bg + band(4, 7.5, theta) + band(8, 12.5, alpha) + band(13, 30, p["beta"]) + band(30, 45, p["gamma"])
    codes = microvolts_to_bipolar_code(uv)
    return [BipolarRawSample(millis=int(start_ms + m), code=int(c)) for m, c in zip((t * 1000).astype(int), codes)]


def ring_window(rng, level):
    """One 60 s ring window: beat intervals (ms), GSR ADC at 5 Hz, |acc| in g.
    level 0 = rest profile, 1 = stress profile (linear in between)."""
    p = {k: REST_RING[k] + level * (STRESS_RING[k] - REST_RING[k]) for k in REST_RING}
    ibi, t, mean_ibi = [], 0.0, 60000.0 / p["hr"]
    prev = mean_ibi
    while t < WINDOW_SEC * 1000:
        cur = mean_ibi + 0.6 * (prev - mean_ibi) + rng.normal(0, p["rmssd"] / 1.2)
        ibi.append(float(cur))
        prev, t = cur, t + cur
    n = WINDOW_SEC * RING_FS
    tt = np.arange(n) / RING_FS
    g = p["scl"] + 0.05 * rng.normal(size=n).cumsum() / np.sqrt(n)
    for onset in rng.uniform(0, WINDOW_SEC - 8, rng.poisson(p["scr"])):
        k = tt >= onset
        g[k] += 0.4 * p["scl"] * (1 - np.exp(-(tt[k] - onset))) * np.exp(-(tt[k] - onset) / 6.0)
    R = 1e6 / np.clip(g, 0.05, None)                  # inverse of adc_to_conductance()
    adc = (R * GSR_CAL - 10240000) / (R + 20000)
    acc = 1.0 + 0.01 * rng.normal(size=n)
    return {"ibi_array": ibi, "gsr_adc_array": [int(round(a)) for a in adc], "acc_array": list(acc),
            "gsr_calibration": GSR_CAL, "actual_fs": RING_FS}


def ring_features(w):
    f2, motion, _fd, fallback, _wd = extract_features(w["ibi_array"], w["gsr_adc_array"], w["acc_array"],
                                                       w["gsr_calibration"], actual_fs=w["actual_fs"])
    q = compute_signal_quality(w["ibi_array"], w["gsr_adc_array"], w["acc_array"], motion, actual_fs=w["actual_fs"])
    return (None if motion or fallback else f2), q


# ── Conditions ──────────────────────────────────────────────────────
# eeg(phase, i, n) -> theta shift for block i of n in that phase;
# ring(phase, i, n) -> stress level 0..1 for ring window i of n.
def ramp(i, n, k=5):
    return min(1.0, (i + 1) / k)


CONDITIONS = {
    "sim_typical": dict(
        label="Typical responder: EEG score rises under load, recovers",
        eeg=lambda ph, i, n: {"task": 0.55 * ramp(i, n), "stress": 0.55 * ramp(i, n, 3)}.get(ph, 0.0),
        ring=lambda ph, i, n: {"task": ramp(i, n, 2), "stress": ramp(i, n, 1)}.get(ph, 0.0),
    ),
    "sim_inverted": dict(
        label="Inverted responder: EEG score FALLS under load, recovers (wearable02 pattern)",
        eeg=lambda ph, i, n: {"task": -0.55 * ramp(i, n), "stress": -0.55 * ramp(i, n, 3)}.get(ph, 0.0),
        ring=lambda ph, i, n: {"task": ramp(i, n, 2), "stress": ramp(i, n, 1)}.get(ph, 0.0),
    ),
    "sim_drift": dict(
        label="Drift / poor contact: slow rise that never comes back; ring barely responds",
        # drift grows through the task and keeps growing through recovery and live
        eeg=lambda ph, i, n: {"task": 0.04 * i, "recovery": 0.04 * (N_TASK + i),
                              "calm": 0.6, "stress": 0.6}.get(ph, 0.0),
        ring=lambda ph, i, n: {"task": 0.12, "recovery": 0.12, "stress": 0.15}.get(ph, 0.0),
    ),
}


# ── Running one simulated user ──────────────────────────────────────
def persistent(flags, k=2, n=3):
    out = []
    for i in range(len(flags)):
        recent = [f for f in flags[max(0, i - n + 1):i + 1] if f is not None]
        out.append(sum(recent) >= k if recent else None)
    return out


def run_user(uid, cond, seed, t0):
    rng = np.random.default_rng(seed)
    eng = RealtimeInference(MODEL_DIR)
    clock = {"ms": 0}

    def next_block(phase, i, n):
        blk = eeg_block(rng, clock["ms"], theta_shift=cond["eeg"](phase, i, n))
        clock["ms"] += int(BLOCK_SEC * 1000)
        return blk

    # EEG calibration: rest -> task -> recovery (as calibration_service.run_eeg_threshold_from_blocks)
    for i in range(N_REST):
        eng.calibrate_bipolar_block(next_block("rest", i, N_REST))
    cal = eng.finalize_calibration_bipolar()
    task_blocks = [next_block("task", i, N_TASK) for i in range(N_TASK)]
    rec_blocks = [next_block("recovery", i, N_RECOVERY) for i in range(N_RECOVERY)]
    for b in task_blocks:
        eng.score_threshold_task_block(b)
    for b in rec_blocks:
        eng.score_recovery_block(b)
    thr = eng.finalize_personal_threshold()
    thr.update(eng.recovery_outcome())
    now = time.time()
    cal["updated_at"], thr["updated_at"] = t0, t0 + (N_TASK + N_RECOVERY) * BLOCK_SEC

    # Ring calibration: rest -> task -> recovery (as calibration_capture.py)
    ring_rest_f, ring_task_f, ring_rec_f = [], [], []
    for i in range(RING_REST):
        f, _ = ring_features(ring_window(rng, cond["ring"]("rest", i, RING_REST)))
        if f is not None:
            ring_rest_f.append(f[0])
    b_mean, b_std = compute_baseline(np.array(ring_rest_f), n_windows=len(ring_rest_f))
    score = lambda f: float(predict_window(f, b_mean, b_std)["prob_stress"])  # noqa: E731
    ring_rest = [score(f[None, :]) for f in ring_rest_f]
    for name, n, sink in (("task", RING_TASK, ring_task_f), ("recovery", RING_RECOVERY, ring_rec_f)):
        for i in range(n):
            f, _ = ring_features(ring_window(rng, cond["ring"](name, i, n)))
            if f is not None:
                sink.append(score(f))
    ring_mid = midpoint_stress_threshold(ring_rest, ring_task_f, recovery_scores=ring_rec_f)
    ring_limit = ring_mid["limit"] if ring_mid["separated"] else STRESS_DECISION_THRESHOLD

    # Live monitoring: each EEG block (real /predict path) + the ring window covering it -> fusion
    live, history, ring_cache = [], [], {}
    t_live = t0 + (N_REST + N_TASK + N_RECOVERY) * BLOCK_SEC + 60
    k = 0
    for phase, n in LIVE:
        for i in range(n):
            res = eng.infer_bipolar_block(next_block(phase, i, n))
            history.append(res.get("calibrated_p") if not res.get("skipped") else None)
            ts = t_live + (k + 1) * BLOCK_SEC
            rec = make_eeg_output_record(res, window_sec=BLOCK_SEC, model_version=MODEL_VERSION, feature_set=MODEL_VERSION,
                                         history_scores=history, high_load_p=eng.thresholds.high_load_p, capture_end_ts=ts)
            fe = make_eeg_fusion_record(rec)
            ring_idx = int((k * BLOCK_SEC) // WINDOW_SEC)              # a new ring window every 60 s
            if ring_idx not in ring_cache:
                f, q = ring_features(ring_window(rng, cond["ring"](phase, i, n)))
                p = score(f) if f is not None else None
                ring_cache[ring_idx] = (p, q)
            p_ring, q_ring = ring_cache[ring_idx]
            mods = {
                "eeg": {"prob": fe["prob_eeg"], "confidence": fe["conf_eeg"], "signal_quality": fe["signal_quality_eeg"],
                        "model_acc": fe["model_acc_eeg"], "threshold": fe["threshold_eeg"],
                        "threshold_scale": fe["threshold_scale_eeg"], "z": fe["z_logit_eeg"], "z_alert": fe["z_alert_eeg"]},
                "hrv_gsr": {"prob": p_ring, "confidence": None if p_ring is None else max(p_ring, 1 - p_ring),
                            "signal_quality": q_ring, "model_acc": 0.851, "threshold": ring_limit,
                            "threshold_scale": PERSONAL_THRESHOLD_MIN_SEPARATION},
            }
            fused = fusion_engin.compute_realtime_multimodal_fusion(mods, scale="aligned")
            al = fused.get("aligned_probs", {})
            live.append({"k": k, "phase": phase, "t": ts, "eeg_record": rec, "fusion_eeg": fe,
                         "mind": al.get("eeg"), "body": al.get("hrv_gsr"), "prob_ring": p_ring,
                         "fused": fused.get("fused_stress_probability")})
            k += 1
    for key in ("mind", "body", "fused"):
        flags = persistent([None if r[key] is None else r[key] >= 0.5 for r in live])
        for r, f in zip(live, flags):
            r[f"{key}_high"] = f

    return {"uid": uid, "label": cond["label"], "t0": t0, "eeg_cal": cal, "eeg_thr": thr,
            "ring": {"rest": ring_rest, "task": ring_task_f, "recovery": ring_rec_f, "midpoint": ring_mid,
                     "limit": ring_limit, "baseline_mean": b_mean.tolist(), "baseline_std": b_std.tolist()},
            "live": live}


# ── Report ──────────────────────────────────────────────────────────
def summarize(r):
    thr, ring, live = r["eeg_thr"], r["ring"], r["live"]

    def phase_rate(key, phase):
        v = [x[f"{key}_high"] for x in live if x["phase"] == phase and x[f"{key}_high"] is not None]
        return None if not v else sum(v) / len(v)

    calm = [x for x in live if x["phase"] == "calm"]
    return {
        "user": r["uid"],
        "eeg_status": thr.get("calibration_status"), "eeg_direction": thr.get("personal_direction"),
        "eeg_separation_sd": thr.get("separation_sd"), "eeg_reversal_sd": thr.get("reversal_sd"),
        "eeg_method": thr.get("threshold_method"),
        "ring_status": ring["midpoint"]["status"], "ring_limit": ring["limit"],
        **{f"{k}_high_in_stress": phase_rate(k, "stress") for k in ("mind", "body", "fused")},
        **{f"{k}_high_in_calm": (None if not calm else
                                 sum(bool(x[f"{k}_high"]) for x in calm) / len(calm)) for k in ("mind", "body", "fused")},
    }


def plot(results, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from backend.psychological.sam40.decision import logit
    fig, axes = plt.subplots(len(results), 2, figsize=(15, 4.2 * len(results)), squeeze=False)
    for row, r in zip(axes, results):
        thr, ring = r["eeg_thr"], r["ring"]
        # Calibration: EEG on the oriented fusion scale, ring on its own scale
        base, sd = thr.get("baseline_logit"), thr.get("rest_sd_logit") or 0.55
        direction = thr.get("personal_direction") or 1
        za = thr.get("z_alert") or 0.84
        def to_fused(p):
            if p is None or not (0 < p < 1) or base is None:
                return None
            L = logit(p)
            if abs(L) > 40:
                return None
            z = direction * (L - base) / sd if thr.get("responsive") else (L - base) / sd
            return 1 / (1 + math.exp(-max(-3, min(3, z - za))))
        eeg_vals = [to_fused(p) for p in thr["rest_scores"] + thr["task_scores"] + thr.get("recovery_scores", [])]
        ax = row[0]
        ax.plot(range(1, len(eeg_vals) + 1), eeg_vals, "o-", color="#2a78d6", ms=3, label="Mind (EEG, fusion scale)")
        nR, nT = len(thr["rest_scores"]), len(thr["task_scores"])
        ax.axvspan(nR + 0.5, nR + nT + 0.5, color="#eda100", alpha=0.12, label="Task")
        x_r = np.linspace(1, len(eeg_vals), RING_REST + RING_TASK + RING_RECOVERY)
        ring_vals = [fusion_engin._sigmoid(max(-3, min(3, (p - ring["limit"]) / PERSONAL_THRESHOLD_MIN_SEPARATION)))
                     for p in ring["rest"] + ring["task"] + ring["recovery"]]
        ax.plot(x_r, ring_vals, "s-", color="#eb6834", ms=4, label="Body (ring, fusion scale)")
        ax.axhline(0.5, color="#c0392b", lw=1.2, label="Own limit")
        ax.set_ylim(0, 1)
        ax.set_title(f"{r['uid']} calibration · EEG {thr.get('calibration_status')} (dir {direction:+d}) · "
                     f"ring {ring['midpoint']['status']}", fontsize=10)
        ax.set_xlabel("rest → task → recovery (EEG block #)")
        ax.legend(fontsize=7, loc="upper left")
        # Live monitoring
        ax = row[1]
        live = r["live"]
        x = [l["k"] + 1 for l in live]
        for key, color, lab in (("mind", "#2a78d6", "Mind"), ("body", "#eb6834", "Body"), ("fused", "#4a3aa7", "Fused")):
            ax.plot(x, [l[key] for l in live], "-", color=color, lw=2.6 if key == "fused" else 1.4, label=lab)
        hi = [l["k"] + 1 for l in live if l["fused_high"]]
        ax.scatter(hi, [0.97] * len(hi), marker="v", color="#c0392b", s=18, label="Fused alert (2 of 3)")
        s0 = LIVE[0][1]
        ax.axvspan(s0 + 0.5, s0 + LIVE[1][1] + 0.5, color="#eda100", alpha=0.12, label="Stress episode")
        ax.axhline(0.5, color="#c0392b", lw=1.0)
        ax.set_ylim(0, 1)
        ax.set_title(f"{r['uid']} live monitoring · {r['label']}", fontsize=10)
        ax.set_xlabel("live EEG block # (25 s)")
        ax.legend(fontsize=7, loc="upper left")
    fig.tight_layout()
    fig.savefig(path, dpi=130)


# ── Optional: write the sessions to Firebase for psy_web / StressApp ─
def push_firebase(r, sid):
    """Writes one simulated user in the same layout the backends use, under
    sim_* user ids. REST writes (the database rules allow them, as psy_web's do)."""
    import requests
    from backend.common.firebase_config import FIREBASE_DB_URL
    from backend.common.fusion import fusion_window_key
    base = FIREBASE_DB_URL.rstrip("/")
    put = lambda path, v: requests.put(f"{base}/{path}.json", data=json.dumps(v, default=float), timeout=30).raise_for_status()  # noqa: E731
    uid = r["uid"]
    clean = lambda d: json.loads(json.dumps(d, default=float, allow_nan=False).replace("NaN", "null")) if d else d  # noqa: E731
    put(f"psychological/{uid}/{sid}/calibration_result", clean({**r["eeg_cal"], "simulated": True}))
    put(f"psychological/{uid}/{sid}/threshold_result", clean({**r["eeg_thr"], "simulated": True}))
    for l in r["live"]:
        put(f"psychological/{uid}/{sid}/{l['k']}", clean({**l["eeg_record"], "simulated": True}))
    ring = r["ring"]
    m = ring["midpoint"]
    put(f"physiological/personal_thresholds/{uid}", clean({
        "resting_scores": ring["rest"], "task_scores": ring["task"], "simulated": True,
        "personal_stress_threshold": ring["limit"] if m["separated"] else None,
        "task_result": {"method": "midpoint (median rest, sustained task) + recovery check", "status": m["status"],
                        "baseline": m["baseline"], "task_level": m["task_level"], "needed_separation": m["needed_separation"],
                        "recovery_scores": ring["recovery"], "aba_confirmed": m["aba_confirmed"],
                        "personal_stress_threshold": ring["limit"] if m["separated"] else None}}))
    put(f"physiological/baselines/{uid}", {"mean": ring["baseline_mean"], "std": ring["baseline_std"], "simulated": True})
    for l in r["live"]:
        fe = l["fusion_eeg"]
        key = str(fusion_window_key(l["t"]))
        put(f"fusion_en/{uid}/{sid}/{key}", clean({
            **{k: v for k, v in fe.items() if k != "window"},
            "prob_hrv_gsr": l["prob_ring"], "threshold_hrv_gsr": ring["limit"],
            "threshold_scale_hrv_gsr": PERSONAL_THRESHOLD_MIN_SEPARATION,
            "eeg_aligned": l["mind"], "hrv_gsr_aligned": l["body"],
            "fused_probability": l["fused"], "fused_threshold": 0.5, "fused_scale": "aligned",
            "fused_label": None if l["fused"] is None else int(l["fused"] >= 0.5),
            "fused_high_persistent": l["fused_high"], "simulated": True}))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--firebase", action="store_true", help="also write the sim_* users to Firebase")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time() - 3600
    results = [run_user(uid, cond, args.seed + i, t0) for i, (uid, cond) in enumerate(CONDITIONS.items())]
    summary = [summarize(r) for r in results]
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2, default=float))
    f = lambda v: "—" if v is None else (f"{v:+.2f}" if isinstance(v, float) else str(v))  # noqa: E731
    pct = lambda v: "—" if v is None else f"{100 * v:.0f}%"  # noqa: E731
    print(f"\n{'user':13s} {'EEG result':16s} {'dir':>4s} {'vs rest':>8s} {'recovery':>9s} {'ring result':16s} "
          f"| high in stress: mind body fused | high in calm: mind body fused")
    for s in summary:
        print(f"{s['user']:13s} {f(s['eeg_status']):16s} {f(s['eeg_direction']):>4s} {f(s['eeg_separation_sd']):>8s} "
              f"{f(s['eeg_reversal_sd']):>9s} {f(s['ring_status']):16s} | "
              f"{pct(s['mind_high_in_stress']):>5s} {pct(s['body_high_in_stress']):>5s} {pct(s['fused_high_in_stress']):>5s} | "
              f"{pct(s['mind_high_in_calm']):>5s} {pct(s['body_high_in_calm']):>5s} {pct(s['fused_high_in_calm']):>5s}")
    print(f"\nSummary: {OUT_DIR / 'summary.json'}")
    try:
        plot(results, OUT_DIR / "simulated_sessions.png")
        print(f"Figure: {OUT_DIR / 'simulated_sessions.png'}")
    except ImportError as e:
        print(f"Figure skipped (matplotlib couldn't load: {e})")
    if args.firebase:
        sid = time.strftime("session_%Y%m%dT%H%M%S_sim")
        for r in results:
            push_firebase(r, sid)
        print(f"Written to Firebase as {', '.join(r['uid'] for r in results)} / {sid}")


if __name__ == "__main__":
    main()
