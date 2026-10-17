#!/usr/bin/env python3
"""
Personalization of the T7-T8 load estimate without probability calibration
(no Platt scaling: every score is the model's raw output).

Onboarding (calibration) is emulated with SAM40 trials: the Relax and
Arithmetic blocks of the calibration trial(s) are the person's onboarding;
ALL blocks of the remaining trial(s) are the evaluation set. Onboarding
blocks are never evaluated. Model always trained on the other 39 people.

  Designs      1+1: calibrate on trial k, evaluate the other two (3 sessions/person)
               2+2: calibrate on two trials, evaluate the third (3 sessions/person)
  Feature baseline
      none       raw T7-T8 features
      personal   features minus the person's own onboarding-rest mean
                 (training people normalised the same way with their own
                 rest blocks from the same trials; normalising blocks are
                 excluded from training rows)
  Threshold
      generic    80th percentile of training people's rest scores (inner
                 out-of-fold, 5-fold GroupKFold) -> ~20% false-alert target
      rest+noise person's onboarding-rest mean + k * sigma, sigma = RMS
                 deviation of later rest scores from the onboarding-rest mean
                 in training people (inner OOF, same design); k = 0.84
                 (~20% false-alert target, pre-specified)
      midpoint   halfway between the person's onboarding rest and task means

Output: results/S_personalization_summary.csv, results/S_personalization_per_person.csv
Run:    venv/bin/python paper/analysis/personalization.py
"""
import sys
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from scipy import stats
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "results"
sys.path.insert(0, str(REPO / "psycological" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sam40.train import feature_columns  # noqa: E402
from stats_utils import subject_bootstrap  # noqa: E402

feat = pd.read_csv(REPO / "psycological/results/features_bipolar_only_25s_block.csv")
F = feature_columns(feat)
K_REST = 0.84
DESIGNS = {"1+1": [[1], [2], [3]], "2+2": [[1, 2], [1, 3], [2, 3]]}


def model():
    return make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=2000))


def normalise(df, cal_trials, personal):
    """Returns feature matrix and a mask of rows usable for training
    (the rest blocks that defined a person's baseline are dropped)."""
    X = df[F].to_numpy(float).copy()
    keep = np.ones(len(df), bool)
    if personal:
        for s in df.subject.unique():
            m = (df.subject == s).to_numpy()
            base = m & (df.task == "Relax").to_numpy() & df.trial.isin(cal_trials).to_numpy()
            X[m] -= X[base].mean(0)
            keep &= ~base
    return X, keep


def inner_stats(X, y, g, keep, rest, cal):
    """Inner out-of-fold raw scores of the training people (inner models fit
    on trainable rows only, but every row is scored) ->
      generic threshold: 80th percentile of rest scores (~20% false alerts)
      sigma: RMS deviation of a person's later rest scores from their own
             onboarding-rest mean (drift + noise, the quantity the personal
             rest threshold has to absorb)."""
    oof = np.full(len(y), np.nan)
    for itr, ite in GroupKFold(5).split(X, y, g):
        itr = itr[keep[itr]]
        oof[ite] = model().fit(X[itr], y[itr]).predict_proba(X[ite])[:, 1]
    devs = []
    for s in np.unique(g):
        m = g == s
        base = oof[m & rest & cal].mean()
        devs.append(oof[m & rest & ~cal] - base)
    sigma = float(np.sqrt(np.mean(np.concatenate(devs) ** 2)))
    return float(np.percentile(oof[rest & ~cal], 80)), sigma


def session(s, design, cal, personal):
    X, keep = normalise(feat, cal, personal)
    y = feat.label_task.to_numpy(int)
    g = feat.subject.to_numpy()
    rest = (feat.task == "Relax").to_numpy()
    cal_all = feat.trial.isin(cal).to_numpy()
    tr = (g != s) & keep
    m = model().fit(X[tr], y[tr])
    o = g != s
    thr_gen, sigma = inner_stats(X[o], y[o], g[o], keep[o], rest[o], cal_all[o])
    me = g == s
    cal_m = me & cal_all
    ev = me & ~feat.trial.isin(cal).to_numpy()
    p = m.predict_proba(X)[:, 1]
    cal_rest = p[cal_m & rest]
    cal_task = p[cal_m & (feat.task == "Arithmetic").to_numpy()]
    thresholds = {
        "generic": thr_gen,
        "rest+noise": cal_rest.mean() + K_REST * sigma,
        "midpoint": (cal_rest.mean() + cal_task.mean()) / 2,
    }
    rows = []
    for tname, t in thresholds.items():
        pred = p[ev] >= t
        ye = y[ev]
        sens, far = pred[ye == 1].mean(), pred[ye == 0].mean()
        rows.append({"subject": s, "design": design, "cal": str(cal),
                     "baseline": "personal" if personal else "none", "threshold": tname,
                     "auc": roc_auc_score(ye, p[ev]), "sens": sens, "far": far,
                     "bal_acc": 0.5 * (sens + 1 - far)})
    return rows


def main():
    jobs = [(s, d, c, pb) for s in feat.subject.unique() for d, cs in DESIGNS.items()
            for c in cs for pb in (False, True)]
    rows = sum(Parallel(n_jobs=-1)(delayed(session)(*j) for j in jobs), [])
    df = pd.DataFrame(rows)
    per = df.groupby(["design", "baseline", "threshold", "subject"])[["auc", "sens", "far", "bal_acc"]] \
        .mean().reset_index()
    per.to_csv(OUT / "S_personalization_per_person.csv", index=False)
    ref = per[(per.baseline == "none") & (per.threshold == "generic")].set_index(["design", "subject"])
    out = []
    for (d, b, t), gp in per.groupby(["design", "baseline", "threshold"], sort=False):
        gp = gp.set_index(["design", "subject"])
        row = {"design": d, "baseline": b, "threshold": t}
        for mtr in ["auc", "bal_acc", "sens", "far"]:
            mm, lo, hi = subject_bootstrap(gp[mtr])
            row.update({mtr: mm, f"{mtr}_ci": (round(lo, 3), round(hi, 3))})
        dba = (gp.bal_acc - ref.loc[gp.index, "bal_acc"]).to_numpy()
        mm, lo, hi = subject_bootstrap(dba)
        row.update({"d_bal_acc": mm, "d_bal_acc_ci": (round(lo, 3), round(hi, 3)),
                    "p_wilcoxon": stats.wilcoxon(dba).pvalue if np.any(dba != 0) else np.nan,
                    "n_below_chance_auc": int((gp.auc < 0.5).sum())})
        out.append(row)
    res = pd.DataFrame(out)
    res.to_csv(OUT / "S_personalization_summary.csv", index=False)
    pd.set_option("display.width", 260, "display.max_columns", 30)
    print(res.round(3).to_string())


if __name__ == "__main__":
    main()
