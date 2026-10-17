#!/usr/bin/env python3
"""
Validation of the personal baseline and threshold values themselves
(not only of the detection they produce). SAM40, raw T7-T8 features,
model trained on the other 39 people, onboarding trials never tested.

  V1 Baseline: is the onboarding-rest mean an unbiased estimate of the
     person's later rest, with the error size sigma predicts?
     -> held-out rest z: mean ~ 0 (no bias), RMS ~ 1 (sigma correct).
  V2 Threshold calibration: does alert level k give the promised
     false-alert rate 1 - Phi(k) on held-out rest blocks?
  V3 Test-retest: is the personal threshold a stable property of the
     person? Within-person SD across onboarding sessions vs between-person
     SD; intraclass correlation.
  V4 Evenness: per-person false-alert rates with the personal threshold vs
     one fixed threshold for everyone.

Output: results/V_personal_validation_*.csv
Run:    venv/bin/python paper/analysis/personal_validation.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parent))
import personalization as P  # noqa: E402
from stats_utils import subject_bootstrap  # noqa: E402

OUT = P.OUT
feat = P.feat
K_GRID = [0.25, 0.5, 0.84, 1.0, 1.28, 1.645, 2.0]


def session(s, design, cal):
    X, keep = P.normalise(feat, cal, personal=False)
    y, g = feat.label_task.to_numpy(int), feat.subject.to_numpy()
    rest = (feat.task == "Relax").to_numpy()
    cal_all = feat.trial.isin(cal).to_numpy()
    o = g != s
    m = P.model().fit(X[o & keep], y[o & keep])
    thr_fixed, sigma = P.inner_stats(X[o], y[o], g[o], keep[o], rest[o], cal_all[o])
    me = g == s
    p = m.predict_proba(X[me])[:, 1]
    yb, rb, cb = y[me], rest[me], cal_all[me]
    mu = p[cb & rb].mean()
    ev = ~cb
    return {"subject": s, "design": design, "cal": str(cal), "mu_rest": mu, "sigma": sigma,
            "threshold_084": mu + 0.84 * sigma, "fixed_threshold": thr_fixed,
            "z_rest": list((p[ev & (yb == 0)] - mu) / sigma),
            "z_task": list((p[ev & (yb == 1)] - mu) / sigma),
            "fixed_rest_alerts": list(p[ev & (yb == 0)] >= thr_fixed)}


def main():
    jobs = [(s, d, c) for s in feat.subject.unique() for d, cs in P.DESIGNS.items() for c in cs]
    S = pd.DataFrame(Parallel(n_jobs=-1)(delayed(session)(*j) for j in jobs))
    out = {}
    for d, sd in S.groupby("design"):
        zr = np.concatenate(sd.z_rest.to_numpy())
        # V1 baseline / sigma. Bias must be measured FORWARD in time only
        # (onboard on earlier trials, test on later ones): rotating the
        # onboarding trial makes each person's deviations cancel by
        # construction, so the rotated mean is ~0 regardless of drift.
        fwd = sd[sd.cal.isin(["[1]", "[1, 2]"])]
        per_person_bias = fwd.groupby("subject").z_rest.apply(lambda v: np.mean(np.concatenate(v.to_numpy())))
        b, blo, bhi = subject_bootstrap(per_person_bias)
        zf = np.concatenate(fwd.z_rest.to_numpy())
        v1 = {"design": d, "n_rest_evaluations": len(zr),
              "forward_mean_rest_z": b, "forward_mean_rest_z_ci": (round(blo, 3), round(bhi, 3)),
              "forward_rms_rest_z": float(np.sqrt(np.mean(zf ** 2))),
              "wilcoxon_p_forward_bias": float(stats.wilcoxon(per_person_bias).pvalue),
              "rms_rest_z": float(np.sqrt(np.mean(zr ** 2))), "sd_rest_z": float(zr.std(ddof=1)),
              "shapiro_p": float(stats.shapiro(zr).pvalue)}
        # V2 calibration of k
        v2 = []
        for k in K_GRID:
            pp = sd.groupby("subject").z_rest.apply(lambda v: np.mean(np.concatenate(v.to_numpy()) >= k))
            m, lo, hi = subject_bootstrap(pp)
            v2.append({"design": d, "k": k, "target_false_alerts": 1 - stats.norm.cdf(k),
                       "observed_false_alerts": m, "ci": (round(lo, 3), round(hi, 3))})
        # V3 test-retest of the personal threshold
        th = sd.pivot_table(index="subject", columns="cal", values="threshold_084")
        within = float(np.sqrt(th.var(axis=1, ddof=1).mean()))
        between = float(th.mean(axis=1).std(ddof=1))
        kk = th.shape[1]
        msb = kk * th.mean(axis=1).var(ddof=1)
        msw = th.var(axis=1, ddof=1).mean()
        icc = (msb - msw) / (msb + (kk - 1) * msw)
        # 2+2 sessions share one trial pairwise, which inflates agreement;
        # 1+1 sessions are independent. Spearman-Brown projects the
        # independent 1+1 reliability to a 2-trial onboarding.
        v3 = {"design": d, "within_person_sd_threshold": within, "between_person_sd_threshold": between,
              "icc_threshold": float(icc), "within_sd_in_sigma_units": within / sd.sigma.mean(),
              "sessions_independent": d == "1+1",
              "spearman_brown_projected_to_2_trials": float(2 * icc / (1 + icc)) if d == "1+1" else np.nan}
        # V4 evenness of false alerts across people
        far_pers = sd.groupby("subject").z_rest.apply(lambda v: np.mean(np.concatenate(v.to_numpy()) >= 0.84))
        far_fix = sd.groupby("subject").fixed_rest_alerts.apply(lambda v: np.mean(np.concatenate(v.to_numpy())))
        v4 = {"design": d,
              "personal_far_mean": far_pers.mean(), "personal_far_sd_people": far_pers.std(ddof=1),
              "personal_people_far_ge_50pct": int((far_pers >= 0.5).sum()),
              "personal_people_far_0": int((far_pers == 0).sum()),
              "fixed_far_mean": far_fix.mean(), "fixed_far_sd_people": far_fix.std(ddof=1),
              "fixed_people_far_ge_50pct": int((far_fix >= 0.5).sum()),
              "fixed_people_far_0": int((far_fix == 0).sum()),
              "rest_evaluations_per_person": int(len(np.concatenate(sd[sd.subject == sd.subject.iloc[0]].z_rest.to_numpy())))}
        out[d] = (v1, v2, v3, v4)
    pd.DataFrame([o[0] for o in out.values()]).to_csv(OUT / "V1_baseline_accuracy.csv", index=False)
    pd.DataFrame(sum([o[1] for o in out.values()], [])).to_csv(OUT / "V2_threshold_calibration.csv", index=False)
    pd.DataFrame([o[2] for o in out.values()]).to_csv(OUT / "V3_threshold_test_retest.csv", index=False)
    pd.DataFrame([o[3] for o in out.values()]).to_csv(OUT / "V4_false_alert_evenness.csv", index=False)
    pd.set_option("display.width", 250, "display.max_columns", 30)
    for f in ["V1_baseline_accuracy", "V2_threshold_calibration", "V3_threshold_test_retest",
              "V4_false_alert_evenness"]:
        print(f"\n### {f}\n{pd.read_csv(OUT / (f + '.csv')).round(3).to_string()}")


if __name__ == "__main__":
    main()
