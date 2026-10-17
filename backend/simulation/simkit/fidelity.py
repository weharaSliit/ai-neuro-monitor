"""Fidelity checks: simulated signals vs real readings, and model performance
on simulated data vs real-data performance (passes before any evaluation).

Features are computed exactly as the live pipeline does (EEG: preprocessing
+ clamp + channel_features of the bipolar block; ring: extract_features), the
model scores with the deployed models (EEG preview_block_score at the
session's amplitude gain; ring predict_window against a baseline built from
the user's own rest windows, as calibration does).
"""
import json
import math
from pathlib import Path

import numpy as np

from backend.physiological.extract_features import extract_features
from backend.physiological.predictor import compute_baseline, predict_window
from backend.psychological.realtime.adc import microvolts_to_bipolar_code
from backend.psychological.realtime.mqtt_client import BipolarRawSample
from backend.psychological.realtime.pipeline import (
    TARGET_FS, RealtimeInference, preprocess_bipolar_block_unclamped,
)
from backend.psychological.sam40.features import channel_features
from backend.psychological.realtime.adc import clip_physiological_uv

from .eeg import EEGSource
from .profiles import sample_user
from .ring import RingSource, window_arrays

REF = Path(__file__).resolve().parents[1] / "reference"
MODEL_DIR = Path(__file__).resolve().parents[2] / "psychological" / "models"
EEG_FEATS = ["delta_rel_power", "theta_rel_power", "alpha_rel_power", "beta_rel_power", "gamma_rel_power",
             "spectral_slope", "sample_entropy", "std"]
RING_FEATS = ["MeanHR", "SD1", "SCL_mean", "SCR_count", "SCR_amp_mean", "EDA_std"]
ENGINE = None


def to_samples(uv, millis=None):
    millis = np.arange(len(uv)) * 4 if millis is None else millis
    return [BipolarRawSample(millis=int(m), code=int(c)) for m, c in zip(millis, microvolts_to_bipolar_code(uv))]


def logit(p):
    p = min(max(p, 1e-300), 1 - 1e-16)
    return math.log(p) - math.log1p(-p)


def auc(neg, pos):
    neg, pos = [x for x in neg if x is not None], [x for x in pos if x is not None]
    if not neg or not pos:
        return None
    return sum((p > n) + 0.5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg))


def eeg_user(seed, profile="typical", n=10):
    """n rest + n task blocks for one virtual user: features, model scores, AUC."""
    global ENGINE
    ENGINE = ENGINE or RealtimeInference(MODEL_DIR)
    up, _ = sample_user(profile, seed)
    src = EEGSource(rng=np.random.default_rng(seed + 1), **up.eeg)
    src.t0 = 300.0                                    # past the power-on transient
    out = {"rest": [], "task": []}
    for phase, L in (("rest", 0.0), ("task", 1.0)):
        for _ in range(n):
            uv = src.block(L, tapping=(phase == "task"))
            unc = preprocess_bipolar_block_unclamped(to_samples(uv))
            f = channel_features(clip_physiological_uv(unc), fs=TARGET_FS)
            p = ENGINE.preview_block_score(to_samples(uv), use_gain=False)["score"]
            out[phase].append({"score": p, "rms": float(np.std(unc)), **{k: float(f[k]) for k in EEG_FEATS}})
    rest = [logit(b["score"]) for b in out["rest"] if b["score"]]
    task = [logit(b["score"]) for b in out["task"] if b["score"]]
    return {"seed": seed, "subject": up.eeg["subject"], "auc": auc(rest, task),
            "rest_spread": float(np.std(rest, ddof=1)) if len(rest) > 1 else None,
            "rest_logodds": float(np.median(rest)) if rest else None, "blocks": out}


def ring_user(seed, profile="typical", n=6):
    """n rest then n stress 60 s windows for one virtual user, driven through
    the latent model (gradual onset, unrelated arousal events), as in a
    calibration: features and model AUC."""
    from .latent import LatentState
    up, taus = sample_user(profile, seed)
    rng = np.random.default_rng(seed + 2)
    src = RingSource(rng, **up.ring)
    lat = LatentState(taus)
    wins = {"rest": [], "stress": []}
    for phase, demand in (("rest", 0.0), ("stress", 1.0)):
        for _ in range(n):
            pk = []
            for _ in range(300):
                lo = lat.step(demand, 0.2, rng)
                pk.append(src.packet(lo["heart"], lo["skin"], lat.arousal, tapping=demand > 0.5))
            ibi, gsr, acc = window_arrays(pk)
            f2, motion, fd, fb, _ = extract_features(ibi, gsr, acc, src_cal(), actual_fs=5)
            wins[phase].append({"f2": None if motion or fb else f2, **{k: float(fd.get(k, np.nan)) for k in RING_FEATS}})
    rest_f = [w["f2"][0] for w in wins["rest"][:4] if w["f2"] is not None]     # calibration uses 4 rest windows
    if len(rest_f) < 2:
        return {"seed": seed, "auc": None, "windows": wins}
    bm, bs = compute_baseline(np.array(rest_f), n_windows=len(rest_f))
    sc = lambda w: None if w["f2"] is None else float(predict_window(w["f2"], bm, bs)["prob_stress"])  # noqa: E731
    for ph in wins:
        for w in wins[ph]:
            w["p"] = sc(w)
    return {"seed": seed, "auc": auc([w["p"] for w in wins["rest"]], [w["p"] for w in wins["stress"]]), "windows": wins}


def ring_live_user(seed, profile="typical", n_live=8):
    """Calm live windows on a later occasion: distance from the stored baseline, model output."""
    from .latent import LatentState
    from backend.physiological.predictor import feature_cols
    up, taus = sample_user(profile, seed)
    rng = np.random.default_rng(seed + 3)
    src, lat = RingSource(rng, **up.ring), LatentState(taus)

    def win():
        pk = []
        for _ in range(300):
            lo = lat.step(0.0, 0.2, rng)
            pk.append(src.packet(lo["heart"], lo["skin"], lat.arousal))
        ibi, gsr, acc = window_arrays(pk)
        f2, m, fd, fb, _ = extract_features(ibi, gsr, acc, src_cal(), actual_fs=5)
        return None if m or fb else (f2, fd)
    rest = [w for w in (win() for _ in range(4)) if w]
    if len(rest) < 2:
        return {"z": {}, "p": []}
    bm, bs = compute_baseline(np.array([w[0][0] for w in rest]), n_windows=len(rest))
    src.later_occasion(6.0, 0.35, 0.25)
    z, ps = {k: [] for k in ("MeanHR", "SCL_mean", "SD1", "EDA_std", "SCR_count")}, []
    for _ in range(n_live):
        w = win()
        if not w:
            continue
        ps.append(float(predict_window(w[0], bm, bs)["prob_stress"]))
        for k in z:
            j = feature_cols.index(k)
            z[k].append(abs(w[1][k] - bm[j]) / bs[j])
    return {"z": z, "p": ps}


def src_cal():
    from backend.common.config import GSR_CAL
    return GSR_CAL


def _rng(vals):
    a = np.array([v for v in vals if v is not None and np.isfinite(v)])
    return None if not len(a) else {"p5": float(np.percentile(a, 5)), "median": float(np.median(a)),
                                     "p95": float(np.percentile(a, 95))}


def within(sim, real, slack=0.25):
    """PASS when the simulated median lies inside the real p5-p95 range (+ slack of its width)."""
    if not sim or not real:
        return None
    w = real["p95"] - real["p5"]
    return real["p5"] - slack * w <= sim["median"] <= real["p95"] + slack * w


def fidelity(n_users=12, profile="typical"):
    real = json.loads((REF / "real_iot_ranges.json").read_text())
    rg = real["eeg"]["good_contact"]
    eu = [eeg_user(1000 + i, profile) for i in range(n_users)]
    ru = [ring_user(2000 + i, profile) for i in range(n_users)]
    rest_blocks = [b for u in eu for b in u["blocks"]["rest"]]
    rows = []
    for k, label in (("std", "EEG RMS (uV, after preprocessing)"), ("delta_rel_power", "EEG delta_rel"),
                     ("theta_rel_power", "EEG theta_rel"), ("alpha_rel_power", "EEG alpha_rel"),
                     ("beta_rel_power", "EEG beta_rel"), ("gamma_rel_power", "EEG gamma_rel"),
                     ("spectral_slope", "EEG spectral slope"), ("sample_entropy", "EEG sample entropy")):
        sim = _rng([b[k] for b in rest_blocks])
        ref = rg["rms_uv"] if k == "std" else rg["features"].get(k)
        rows.append({"signal": label, "simulated": sim, "real": ref, "pass": within(sim, ref)})
    sim_spread = _rng([u["rest_spread"] for u in eu])
    rows.append({"signal": "EEG rest spread (log-odds)", "simulated": sim_spread,
                 "real": {"p5": 0.5, "median": 1.25, "p95": 2.0}, "pass": within(sim_spread, {"p5": 0.5, "median": 1.25, "p95": 2.0}, 0.0),
                 "note": "criterion 0.5-2 log-odds (plan); real wearable02 calibrations 0.7-8.8 (median 3.7, n=6)"})
    rows.append({"signal": "EEG model score at rest (log-odds)", "simulated": _rng([logit(b["score"]) for b in rest_blocks if b["score"]]),
                 "real": rg["score_logodds"], "pass": within(_rng([logit(b["score"]) for b in rest_blocks if b["score"]]), rg["score_logodds"])})
    rr = real["ring"]["features"]
    rest_w = [w for u in ru for w in u["windows"]["rest"]]
    for k in RING_FEATS:
        sim = _rng([w[k] for w in rest_w])
        rows.append({"signal": f"Ring {k} (rest)", "simulated": sim, "real": rr.get(k), "pass": within(sim, rr.get(k))})
    real_z = {"MeanHR": 0.54, "SCL_mean": 1.35, "SD1": 1.34, "EDA_std": 1.41, "SCR_count": 1.33}
    lu = [ring_live_user(6000 + i, profile) for i in range(n_users)]
    for k, rz in real_z.items():
        v = float(np.median([x for u in lu for x in u["z"].get(k, [])]))
        rows.append({"signal": f"Ring {k} distance from stored baseline (|z|, live)", "simulated": {"p5": v, "median": v, "p95": v},
                     "real": {"p5": rz * 0.5, "median": rz, "p95": rz * 1.5}, "pass": rz * 0.5 <= v <= rz * 1.5,
                     "note": "real: 870 ring windows of 22 users vs their stored baselines"})
    ps = np.array([p for u in lu for p in u["p"]])
    lo_share, hi_share = float(np.mean(ps < 0.1)), float(np.mean(ps > 0.9))
    rows.append({"signal": "Ring output share < 0.1 (calm, live)", "simulated": {"p5": lo_share, "median": lo_share, "p95": lo_share},
                 "real": {"p5": 0.20, "median": 0.20, "p95": 0.20}, "pass": lo_share <= 0.40,
                 "note": "real (all windows, calm and stressed mixed): 20% below 0.1, 9% above 0.9. PARTIAL: the ring model's "
                         "output stays more extreme on simulated windows than on real ones even when every input feature matches"})
    eeg_auc = [u["auc"] for u in eu if u["auc"] is not None]
    ring_auc = [u["auc"] for u in ru if u["auc"] is not None]
    rows.append({"signal": "EEG model AUC (rest vs task, per user)", "simulated": _rng(eeg_auc),
                 "real": {"p5": 0.65, "median": 0.706, "p95": 0.75}, "mean": float(np.mean(eeg_auc)),
                 "pass": 0.60 <= float(np.mean(eeg_auc)) <= 0.80,
                 "note": "target ~0.70 (SAM40 leave-one-subject-out 0.706); in-sample SAM40 through the live path 0.76"})
    rows.append({"signal": "Ring model AUC (rest vs stress, per user)", "simulated": _rng(ring_auc),
                 "real": {"p5": 0.75, "median": 0.80, "p95": 0.85}, "mean": float(np.mean(ring_auc)),
                 "pass": 0.70 <= float(np.mean(ring_auc)) <= 0.90,
                 "note": "target 0.75-0.85 for a cognitive stressor (WESAD TSST, a much stronger stressor: 0.986)"})
    return rows


if __name__ == "__main__":
    import sys
    for r in fidelity(int(sys.argv[1]) if len(sys.argv) > 1 else 8):
        s, ref = r["simulated"], r["real"]
        fm = lambda d: "—" if not d else f"{d['p5']:.3g}–{d['p95']:.3g} (med {d['median']:.3g})"  # noqa: E731
        print(f"{'PASS' if r['pass'] else 'FAIL' if r['pass'] is False else '  — '}  {r['signal']:42s} sim {fm(s):30s} real {fm(ref)}"
              + (f"  mean {r['mean']:.3f}" if 'mean' in r else ""))
