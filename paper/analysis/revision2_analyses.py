#!/usr/bin/env python3
"""
Second-round revision analyses (all runnable from committed artifacts).

  F. Score-scale audit: raw predict_proba vs nested-Platt calibrated vs the
     live pipeline's baseline-shifted score, against the 0.793 threshold.
  G. Revised personalization margin from within-user variability,
     compared with the population-range margin (delta = 0.111).
  H. Sensitivity of the fused label to the performance-reliability term a_m.
  I. Physiological feature-extraction cost (synthetic 60 s windows).
  J. Fold assignments for release (SAM40 outer LOSO + inner GroupKFold).

Run:  venv/bin/python paper/analysis/revision2_analyses.py
"""
import json
import sys
import time
import tracemalloc
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.model_selection import GroupKFold

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "results"
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "fushion engin"))

RNG = np.random.default_rng(0)
N_BOOT = 10000
scores = pd.read_csv(REPO / "psycological/results/final_analysis/bipolar_block_level_scores.csv")
pct = json.load(open(REPO / "backend/psychological/sam40/population_percentiles.json"))
P5, P50, P95 = pct["P5"], pct["P50"], pct["P95"]
OLD_DELTA = (P95 - P5) / 2
POP_T = 0.7933008189294708


def boot_ci(x, fn=np.mean):
    x = np.asarray(x)
    b = [fn(x[RNG.integers(0, len(x), len(x))]) for _ in range(N_BOOT)]
    return round(float(np.percentile(b, 2.5)), 4), round(float(np.percentile(b, 97.5)), 4)


def bal_acc(y, pred):
    y, pred = np.asarray(y), np.asarray(pred)
    return 0.5 * ((pred[y == 1] == 1).mean() + (pred[y == 0] == 0).mean())


# ── F. Score-scale audit ──────────────────────────────────────────────
rows = []
live = []
for s, g in scores.groupby("subject"):
    shift = g.loc[g.task == "Relax", "raw_score"].mean() - P50  # compute_baseline_shift()
    shift = max(-OLD_DELTA, min(OLD_DELTA, shift))
    live.append(pd.DataFrame({"subject": s, "y_true": g.y_true,
                              "live_score": np.clip(g.raw_score - shift, 0, 1)}))
live = pd.concat(live)
for name, col, df in [("raw predict_proba (uncalibrated)", "raw_score", scores),
                      ("nested-Platt calibrated (analysis scale)", "calibrated_score", scores),
                      ("live pipeline: raw - clamped baseline shift", "live_score", live)]:
    rows.append({"score": name,
                 "P5": np.percentile(df[col], 5), "P50": np.percentile(df[col], 50),
                 "P95": np.percentile(df[col], 95),
                 "rest_mean": df.loc[df.y_true == 0, col].mean(),
                 "task_mean": df.loc[df.y_true == 1, col].mean(),
                 "rest_rate_ge_0.793": (df.loc[df.y_true == 0, col] >= POP_T).mean(),
                 "task_rate_ge_0.793": (df.loc[df.y_true == 1, col] >= POP_T).mean()})
pd.DataFrame(rows).to_csv(OUT / "F_score_scale_audit.csv", index=False)


# ── G. Revised personalization margin ─────────────────────────────────
# sigma_w = pooled within-subject SD of Relax-block scores, estimated LOSO
# from the OTHER 39 subjects only (no leakage). Margin for a calibration
# with n_r rest and n_t task blocks:
#     delta_u = z * sigma_w * sqrt(1/n_r + 1/n_t),  z = 1.645 (one-sided 95%)
# i.e. "the user's rest-to-task rise exceeds what rest-block noise alone
# would produce".  Compared against the population-range delta = 0.111.
def pooled_rest_sd(df):
    r = df[df.task == "Relax"]
    dev = r.calibrated_score - r.groupby("subject").calibrated_score.transform("mean")
    dof = len(r) - r.subject.nunique()
    return float(np.sqrt((dev ** 2).sum() / dof))


def personal_t(rest, task, delta):
    rm, tm = np.mean(rest), np.mean(task)
    if tm - rm < delta:
        return None
    return max(P5, min(P95, (rm + tm) / 2))


G = []
for s, g in scores.groupby("subject"):
    sigma_w = pooled_rest_sd(scores[scores.subject != s])
    # design 1: one calibration session = 1 rest + 1 arithmetic block (trial k); eval other 2 trials
    # design 2: calibration = 2 trials (2 rest + 2 arithmetic); eval the remaining trial
    for design, cal_sets in [("1 rest + 1 task", [[1], [2], [3]]),
                             ("2 rest + 2 task", [[1, 2], [1, 3], [2, 3]])]:
        for cal_trials in cal_sets:
            cal = g[g.trial.isin(cal_trials)]
            ev = g[~g.trial.isin(cal_trials)]
            rest = cal.loc[cal.task == "Relax", "calibrated_score"]
            task = cal.loc[cal.task == "Arithmetic", "calibrated_score"]
            n_r, n_t = len(rest), len(task)
            for rule, delta in [("population range (0.111)", OLD_DELTA),
                                ("within-user noise, z=1.645", 1.645 * sigma_w * np.sqrt(1 / n_r + 1 / n_t)),
                                ("within-user noise, z=1.0", 1.0 * sigma_w * np.sqrt(1 / n_r + 1 / n_t))]:
                th = personal_t(rest, task, delta)
                used = th if th is not None else POP_T
                G.append({"subject": s, "design": design, "cal_trials": str(cal_trials), "rule": rule,
                          "delta": delta, "sigma_w": sigma_w, "accepted": th is not None,
                          "threshold": th,
                          "bal_acc_rule": bal_acc(ev.y_true, ev.calibrated_score >= used),
                          "bal_acc_population": bal_acc(ev.y_true, ev.calibrated_score >= POP_T),
                          "bal_acc_oracle_median": bal_acc(ev.y_true, ev.calibrated_score >=
                                                           np.median(ev.calibrated_score))})
G = pd.DataFrame(G)
G.to_csv(OUT / "G_margin_per_session.csv", index=False)
auc = {s: v for s, v in pd.read_csv(OUT / "A_eeg_per_subject.csv")[["subject", "auc"]].values}
Gs = []
for (design, rule), g in G.groupby(["design", "rule"], sort=False):
    per = g.groupby("subject").agg(acc=("accepted", "mean"), ba_rule=("bal_acc_rule", "mean"),
                                   ba_pop=("bal_acc_population", "mean"))
    d = (per.ba_rule - per.ba_pop).to_numpy()
    acc_sessions = g[g.accepted]
    retest = acc_sessions.groupby("subject").threshold.agg(["std", "count"])
    retest = retest[retest["count"] >= 2]
    ever = per.index[per.acc > 0]
    below = [s for s in per.index if auc[s] < 0.5]
    Gs.append({"design": design, "rule": rule, "delta_median": g.delta.median(),
               "session_acceptance": g.accepted.mean(),
               "subjects_ever_accepted": len(ever),
               "below_chance_subjects_ever_accepted": int(sum(s in ever for s in below)),
               "bal_acc_rule": per.ba_rule.mean(), "bal_acc_rule_ci": boot_ci(per.ba_rule.to_numpy()),
               "bal_acc_population": per.ba_pop.mean(),
               "diff": d.mean(), "diff_ci": boot_ci(d),
               "wilcoxon_p": stats.wilcoxon(d).pvalue if np.any(d != 0) else np.nan,
               "retest_subjects": len(retest),
               "retest_within_sd_median": retest["std"].median() if len(retest) else np.nan,
               "between_subject_sd": acc_sessions.groupby("subject").threshold.mean().std()})
pd.DataFrame(Gs).to_csv(OUT / "G_margin_summary.csv", index=False)


# ── H. Sensitivity to the performance-reliability term ────────────────
import fusion_engin as fe  # noqa: E402

TH_CL, TH_AA = POP_T, 0.7141
# realistic input grid: p_CL from real SAM40 OOF scores; p_AA from a
# synthetic bimodal range (no WESAD OOF scores in repo); quality nominal.
p_cl = RNG.choice(scores.calibrated_score.to_numpy(), 5000)
p_aa = np.concatenate([RNG.beta(2, 6, 2500), RNG.beta(6, 2, 2500)])
RNG.shuffle(p_aa)
q_cl = RNG.uniform(60, 100, 5000)
q_aa = RNG.uniform(0.6, 1.0, 5000)


def fuse(a_cl, a_aa):
    lab, w = [], []
    for i in range(len(p_cl)):
        r = fe.compute_realtime_multimodal_fusion({
            "eeg": {"prob": p_cl[i], "confidence": max(p_cl[i], 1 - p_cl[i]), "signal_quality": q_cl[i],
                    "model_acc": a_cl, "threshold": TH_CL},
            "hrv_gsr": {"prob": p_aa[i], "confidence": max(p_aa[i], 1 - p_aa[i]), "signal_quality": q_aa[i],
                        "model_acc": a_aa, "threshold": TH_AA}})
        lab.append(r["fused_stress_probability"] >= r["fused_stress_threshold"])
        w.append(r["modality_weights"]["eeg"])
    return np.array(lab), np.array(w)


settings = [
    ("current: AUC(EEG, per-subj) vs accuracy(AA)", 0.706, 0.851),
    ("pooled LOSO AUC, both", 0.632, 0.938),
    ("mean per-subject AUC (EEG) / pooled AUC (AA, placeholder)", 0.706, 0.938),
    ("Gini = 2*AUC-1, pooled, both", 2 * 0.632 - 1, 2 * 0.938 - 1),
    ("equal (a term removed)", 1.0, 1.0),
]
ref_lab, _ = fuse(0.632, 0.938)
H = []
for name, a1, a2 in settings:
    lab, w = fuse(a1, a2)
    H.append({"reliability_term": name, "a_CL": a1, "a_AA": a2, "a_ratio_CL_over_AA": a1 / a2,
              "mean_w_CL": w.mean(), "elevated_rate": lab.mean(),
              "label_disagreement_vs_pooledAUC": (lab != ref_lab).mean()})
# fusion_engin clamps a_m to [0, 1], so ratios > 1 are produced by lowering a_AA
for ratio in [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 4.0]:
    a1, a2 = (ratio, 1.0) if ratio <= 1 else (1.0, 1.0 / ratio)
    lab, w = fuse(a1, a2)
    H.append({"reliability_term": f"sweep ratio {ratio}", "a_CL": a1, "a_AA": a2,
              "a_ratio_CL_over_AA": ratio, "mean_w_CL": w.mean(), "elevated_rate": lab.mean(),
              "label_disagreement_vs_pooledAUC": (lab != ref_lab).mean()})
pd.DataFrame(H).to_csv(OUT / "H_reliability_sensitivity.csv", index=False)


# ── I. Physiological feature-extraction cost ──────────────────────────
from backend.physiological.extract_features import extract_features  # noqa: E402

I = []
for fs in (5, 50):
    n = 60 * fs
    t = np.arange(n) / fs
    gsr = (2000 + 50 * np.sin(2 * np.pi * 0.05 * t) + RNG.normal(0, 5, n)).astype(int).tolist()
    acc = (1.0 + RNG.normal(0, 0.02, n)).tolist()
    ibi = (800 + RNG.normal(0, 40, 75)).tolist()
    call = lambda: extract_features(ibi, gsr, acc, gsr_calibration=2872, actual_fs=fs)  # noqa: E731
    call()
    tracemalloc.start()
    call()
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    reps = 100
    t0 = time.perf_counter()
    for _ in range(reps):
        call()
    I.append({"stage": f"Physiological feature extraction (60 s, GSR/ACC at {fs} Hz, 75 IBIs)",
              "ms_per_window": (time.perf_counter() - t0) / reps * 1000, "peak_mem_kb": peak / 1024})
pd.DataFrame(I).to_csv(OUT / "I_physio_feature_cost.csv", index=False)


# ── J. Fold assignments (release) ─────────────────────────────────────
feat = pd.read_csv(REPO / "psycological/results/features_bipolar_only_25s_block.csv")
id_cols = [c for c in ["subject", "task", "trial"] if c in feat.columns]
groups = feat["subject"].to_numpy()
J = []
for outer in np.unique(groups):
    tr = np.where(groups != outer)[0]
    inner = GroupKFold(n_splits=5)
    inner_fold = np.full(len(feat), -1)
    for k, (_, te) in enumerate(inner.split(tr, groups=groups[tr])):
        inner_fold[tr[te]] = k
    J.append(pd.DataFrame({**{c: feat[c] for c in id_cols}, "outer_test_subject": outer,
                           "role": np.where(groups == outer, "outer_test", "train"),
                           "inner_fold": inner_fold}))
pd.concat(J).to_csv(OUT / "J_sam40_fold_assignments.csv", index=False)

pd.set_option("display.width", 250, "display.max_columns", 40)
for f in ["F_score_scale_audit", "G_margin_summary", "H_reliability_sensitivity", "I_physio_feature_cost"]:
    print(f"\n### {f}\n{pd.read_csv(OUT / (f + '.csv')).to_string()}")
print("\nJ rows:", sum(len(j) for j in J))
