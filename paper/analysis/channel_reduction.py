#!/usr/bin/env python3
"""
Channel-reduction analysis (the paper's central question): how much
cognitive-load information survives when the 32-channel SAM40 montage is
reduced to two electrodes, and is the temporal pair (T7, T8) a good choice
among two-electrode placements a wearable could use?

Same pipeline for every montage: SAM40 cleaned recordings -> 50 Hz notch +
0.5-45 Hz band-pass -> 29 single-signal features per signal -> scaler +
class-balanced logistic regression -> LOSO (40 subjects), rest vs task.

  R1 montage ladder
       32 channels, common-average reference (CAR)      needs a full cap
       T7 + T8, CAR-referenced (2 x 29 features)         needs a full cap for CAR
       T7 - T8 bipolar (29 features)                     2 electrodes, deployable
  R2 two-electrode bipolar pairs (all reference-free, 29 features each)

Outputs results/R_channel_reduction.csv, results/R_channel_reduction_per_subject.csv

Run:  venv/bin/python paper/analysis/channel_reduction.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from scipy import stats
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "results"
sys.path.insert(0, str(REPO / "psycological" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sam40.channels import CHANNEL_INDEX, CHANNEL_NAMES  # noqa: E402
from sam40.features import channel_features  # noqa: E402
from sam40.labels import binary_label_from_task  # noqa: E402
from sam40.loader import discover_trials, load_trial_data  # noqa: E402
from sam40.preprocess import common_average_reference, notch_then_bandpass  # noqa: E402
from stats_utils import subject_bootstrap  # noqa: E402

FS = 128
PAIRS = {  # wearable-plausible, left-right homologous unless noted
    "T7-T8 (temporal, above the ears)": ("T7", "T8"),
    "FT9-FT10 (anterior to the ears)": ("FT9", "FT10"),
    "Fp1-Fp2 (forehead)": ("Fp1", "Fp2"),
    "F7-F8 (frontotemporal)": ("F7", "F8"),
    "C3-C4 (central)": ("C3", "C4"),
    "P7-P8 (posterior temporal)": ("P7", "P8"),
    "O1-O2 (occipital)": ("O1", "O2"),
    "T7-FT9 (left, around one ear)": ("T7", "FT9"),
    "T8-FT10 (right, around one ear)": ("T8", "FT10"),
}


def trial_features(t):
    d = notch_then_bandpass(load_trial_data(t))
    car = common_average_reference(d)
    row = {"subject": t.subject, "task": t.task, "trial": t.trial,
           "y": binary_label_from_task(t.task)}
    for ch in CHANNEL_NAMES:  # CAR-referenced single channels
        for k, v in channel_features(car[CHANNEL_INDEX[ch]], fs=FS).items():
            row[f"car_{ch}_{k}"] = v
    for name, (a, b) in PAIRS.items():  # bipolar: reference cancels
        for k, v in channel_features(d[CHANNEL_INDEX[a]] - d[CHANNEL_INDEX[b]], fs=FS).items():
            row[f"bip_{a}_{b}_{k}"] = v
    return row


def loso(X, y, g):
    out = np.full(len(y), np.nan)
    for s in np.unique(g):
        te, tr = g == s, g != s
        m = make_pipeline(StandardScaler(),
                          LogisticRegression(class_weight="balanced", max_iter=5000))
        out[te] = m.fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    return out


def main():
    cache = OUT / "R_channel_features_cache.csv"
    if cache.exists():
        df = pd.read_csv(cache)
    else:
        trials = discover_trials(REPO / "psycological/data/SAM40/filtered_data")
        df = pd.DataFrame(Parallel(n_jobs=-1)(delayed(trial_features)(t) for t in trials))
        df.to_csv(cache, index=False)
    df = df.sort_values(["subject", "task", "trial"]).reset_index(drop=True)
    y, g = df.y.to_numpy(int), df.subject.to_numpy()
    subjects = np.unique(g)

    montages = {
        "32 channels, CAR (full cap)": ("full cap", 32, [c for c in df if c.startswith("car_")]),
        "T7 + T8, CAR-referenced": ("full cap needed for CAR", 32,
                                    [c for c in df if c.startswith(("car_T7_", "car_T8_"))]),
    }
    for name, (a, b) in PAIRS.items():
        montages[f"{name}, bipolar"] = ("2 electrodes", 2, [c for c in df if c.startswith(f"bip_{a}_{b}_")])

    per_subj, rows = {}, []
    for name, (hw, n_el, cols) in montages.items():
        s = loso(df[cols].to_numpy(float), y, g)
        a = np.array([roc_auc_score(y[g == k], s[g == k]) for k in subjects])
        per_subj[name] = a
        m, lo, hi = subject_bootstrap(a)
        rows.append({"montage": name, "hardware": hw, "electrodes_needed": n_el, "n_features": len(cols),
                     "subj_mean_auc": m, "ci_lo": lo, "ci_hi": hi, "median_auc": float(np.median(a)),
                     "n_below_0.5": int((a < 0.5).sum()), "pooled_auc": roc_auc_score(y, s)})
    ref = per_subj["T7-T8 (temporal, above the ears), bipolar"]
    for r in rows:
        d = per_subj[r["montage"]] - ref
        _, lo, hi = subject_bootstrap(d)
        r.update({"diff_vs_T7T8": d.mean(), "diff_ci_lo": lo, "diff_ci_hi": hi,
                  "wilcoxon_p_vs_T7T8": stats.wilcoxon(d).pvalue if np.any(d != 0) else np.nan})
    res = pd.DataFrame(rows)
    res.to_csv(OUT / "R_channel_reduction.csv", index=False)
    pd.DataFrame(per_subj, index=subjects).to_csv(OUT / "R_channel_reduction_per_subject.csv")
    pd.set_option("display.width", 250, "display.max_columns", 20)
    print(res.drop(columns=["hardware"]).round(3).to_string())


if __name__ == "__main__":
    main()
