"""
SAM40 reference for the simulator, measured the way the LIVE pipeline sees a
block: each 25 s trial's T7-T8 bipolar signal is resampled to the headband's
250 Hz, converted to ADC codes (adc.microvolts_to_bipolar_code) and scored by
the deployed model (RealtimeInference.preview_block_score -- no state change).

Per subject: rest (Relax) vs task (Arithmetic / Stroop / Mirror image) model
scores -> AUC, log-odds shift in rest spreads (effect size, sign = direction),
and the bipolar band features of both. Also the signal amplitude.

Note: the deployed model was trained on all 40 SAM40 subjects, so its AUC here
is IN-SAMPLE (optimistic); the leave-one-subject-out AUC is 0.706
(paper/analysis/results/A_eeg_per_subject.csv). The simulator adds the
headband layer on top, and its fidelity check compares against 0.706.

  venv/bin/python backend/simulation/analysis/sam40_reference.py
Writes backend/simulation/reference/sam40_reference.json
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "psycological"))

from backend.psychological.realtime.adc import microvolts_to_bipolar_code  # noqa: E402
from backend.psychological.realtime.mqtt_client import BipolarRawSample  # noqa: E402
from backend.psychological.realtime.pipeline import RealtimeInference  # noqa: E402
from backend.psychological.sam40.features import channel_features  # noqa: E402
from src.sam40.channels import T7_IDX, T8_IDX  # noqa: E402
from src.sam40.loader import discover_trials, load_trial_data  # noqa: E402

DATA = REPO / "data" / "SAM40" / "filtered_data"
OUT = REPO / "backend" / "simulation" / "reference"
FEATS = ["delta_rel_power", "theta_rel_power", "alpha_rel_power", "beta_rel_power", "gamma_rel_power",
         "spectral_slope", "sample_entropy", "std"]


def bipolar_250(trial):
    x = load_trial_data(trial, "filtered")
    bip = x[T7_IDX] - x[T8_IDX]
    return resample_poly(bip, 125, 64)          # 128 Hz -> 250 Hz


def to_samples(uv):
    codes = microvolts_to_bipolar_code(uv)
    return [BipolarRawSample(millis=int(i * 4), code=int(c)) for i, c in enumerate(codes)]


def logit(p):
    p = min(max(p, 1e-300), 1 - 1e-16)
    return math.log(p) - math.log1p(-p)


def auc(neg, pos):
    if not neg or not pos:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def main():
    eng = RealtimeInference(REPO / "backend" / "psychological" / "models")
    per_trial = []
    for t in discover_trials(DATA):
        uv = bipolar_250(t)
        p = eng.preview_block_score(to_samples(uv), use_gain=False)["score"]
        f = channel_features(uv, fs=250)
        per_trial.append({"subject": t.subject, "task": t.task, "trial": t.trial, "score": p,
                          "rms_uv": float(np.sqrt(np.mean(uv ** 2))), **{k: float(f[k]) for k in FEATS if k in f}})
    subjects = []
    for s in sorted({r["subject"] for r in per_trial}):
        rows = [r for r in per_trial if r["subject"] == s]
        rest = [logit(r["score"]) for r in rows if r["task"] == "Relax" and r["score"] is not None]
        task = [logit(r["score"]) for r in rows if r["task"] != "Relax" and r["score"] is not None]
        sd = max(0.55, float(np.std(rest, ddof=1))) if len(rest) > 1 else 0.55
        shift = (float(np.mean(task)) - float(np.median(rest))) / sd if rest and task else None
        subjects.append({"subject": s, "auc": auc(rest, task), "shift_sd": shift,
                         "rest_logodds": float(np.median(rest)) if rest else None,
                         "task_logodds": float(np.mean(task)) if task else None,
                         **{f"rest_{k}": float(np.mean([r[k] for r in rows if r["task"] == "Relax"])) for k in FEATS},
                         **{f"task_{k}": float(np.mean([r[k] for r in rows if r["task"] != "Relax"])) for k in FEATS}})
    a = np.array([x["auc"] for x in subjects if x["auc"] is not None])
    sh = np.array([x["shift_sd"] for x in subjects if x["shift_sd"] is not None])
    summary = {
        "n_subjects": len(subjects), "n_trials": len(per_trial),
        "in_sample_auc_mean": float(a.mean()), "in_sample_auc_median": float(np.median(a)),
        "loso_auc_reference": 0.706,
        "share_inverted (task below rest by >=1 spread)": float(np.mean(sh <= -1)),
        "share_weak (|shift| < 1 spread)": float(np.mean(np.abs(sh) < 1)),
        "share_typical (task above rest by >=1 spread)": float(np.mean(sh >= 1)),
        "shift_sd_percentiles": {q: float(np.percentile(sh, q)) for q in (5, 25, 50, 75, 95)},
        "rms_uv": {k: float(v) for k, v in zip(("p5", "median", "p95"), np.percentile([r["rms_uv"] for r in per_trial], [5, 50, 95]))},
        "rest_features_mean": {k: float(np.mean([r[k] for r in per_trial if r["task"] == "Relax"])) for k in FEATS},
        "task_features_mean": {k: float(np.mean([r[k] for r in per_trial if r["task"] != "Relax"])) for k in FEATS},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sam40_reference.json").write_text(json.dumps({"summary": summary, "subjects": subjects}, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
