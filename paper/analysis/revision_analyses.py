#!/usr/bin/env python3
"""
Analyses added for the paper revision (cognitive-load / autonomic-arousal
framing). Reads only artifacts already committed in this repo; writes CSVs
to paper/analysis/results/.

  A. EEG subject-level statistics (testing unit = subject, n=40)
  B. Personal-threshold separation rule: accepted / rejected subjects
  C. Repeated-calibration stability (leave-one-trial-out proxy on SAM40)
  D. Fusion mechanism validation + ablations (synthetic, deterministic)
  E. Computational cost (model size, inference time, memory)

Run:  venv/bin/python paper/analysis/revision_analyses.py
"""
import json
import os
import pickle
import platform
import sys
import time
import tracemalloc
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import roc_auc_score

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "results"
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "fushion engin"))
sys.path.insert(0, str(REPO / "psycological" / "src"))

RNG = np.random.default_rng(0)
N_BOOT = 10000

scores = pd.read_csv(REPO / "psycological/results/final_analysis/bipolar_block_level_scores.csv")
pct = json.load(open(REPO / "backend/psychological/sam40/population_percentiles.json"))
P5, P50, P95 = pct["P5"], pct["P50"], pct["P95"]
MAX_SHIFT = (P95 - P5) / 2
POP_HIGH_LOAD = 0.7933008189294708  # DecisionThresholds.high_load_p (code default)


def boot_ci(x, fn=np.mean, n=N_BOOT):
    x = np.asarray(x)
    b = [fn(x[RNG.integers(0, len(x), len(x))]) for _ in range(n)]
    return float(np.percentile(b, 2.5)), float(np.percentile(b, 97.5))


def bal_acc(y, pred):
    y, pred = np.asarray(y), np.asarray(pred)
    return 0.5 * ((pred[y == 1] == 1).mean() + (pred[y == 0] == 0).mean())


# ── A. EEG subject-level statistics ───────────────────────────────────
rows = []
for s, g in scores.groupby("subject"):
    rows.append({"subject": s, "auc": roc_auc_score(g.y_true, g.calibrated_score),
                 **{f"mean_{t}": g.loc[g.task == t, "calibrated_score"].mean()
                    for t in ["Relax", "Stroop", "Arithmetic", "Mirror_image"]},
                 "mean_task_all": g.loc[g.y_true == 1, "calibrated_score"].mean()})
subj = pd.DataFrame(rows)
subj.to_csv(OUT / "A_eeg_per_subject.csv", index=False)

auc = subj.auc.to_numpy()
A = [{"metric": "per-subject AUC", "n_subjects": len(auc), "mean": auc.mean(),
      "mean_ci": boot_ci(auc), "median": np.median(auc), "median_ci": boot_ci(auc, np.median),
      "iqr": (np.percentile(auc, 25), np.percentile(auc, 75)),
      "n_below_0.5": int((auc < 0.5).sum()), "n_eq_0.5": int((auc == 0.5).sum()),
      "n_ge_0.8": int((auc >= 0.8).sum()),
      "wilcoxon_vs_0.5_p": stats.wilcoxon(auc - 0.5).pvalue}]

paired = []
for t in ["Stroop", "Arithmetic", "Mirror_image", "task_all"]:
    d = (subj[f"mean_{t}"] - subj.mean_Relax).to_numpy()
    tt = stats.ttest_1samp(d, 0)
    paired.append({"comparison": f"{t} - Relax (subject means)", "n_subjects": len(d),
                   "mean_diff": d.mean(), "mean_diff_ci": boot_ci(d),
                   "t": tt.statistic, "p_t": tt.pvalue, "p_wilcoxon": stats.wilcoxon(d).pvalue,
                   "cohen_dz": d.mean() / d.std(ddof=1),
                   "n_subjects_task_higher": int((d > 0).sum())})
# Friedman: 4 conditions, repeated within subject
fr = stats.friedmanchisquare(*[subj[f"mean_{t}"] for t in ["Relax", "Stroop", "Arithmetic", "Mirror_image"]])
paired.append({"comparison": "Friedman across 4 conditions (subject means)", "n_subjects": len(subj),
               "t": fr.statistic, "p_t": fr.pvalue})

# repeated-measures correlation (within-subject) of score vs rating
r = scores.dropna(subset=["rating"]).copy()
r["s_c"] = r.calibrated_score - r.groupby("subject").calibrated_score.transform("mean")
r["r_c"] = r.rating - r.groupby("subject").rating.transform("mean")
rm_r = np.corrcoef(r.s_c, r.r_c)[0, 1]
df_rm = len(r) - r.subject.nunique() - 1
rm_t = rm_r * np.sqrt(df_rm / (1 - rm_r ** 2))
paired.append({"comparison": "rmcorr score vs self-report rating (within-subject)",
               "n_subjects": r.subject.nunique(), "mean_diff": rm_r, "t": rm_t,
               "p_t": 2 * stats.t.sf(abs(rm_t), df_rm)})
pd.DataFrame(A).to_csv(OUT / "A_eeg_auc_distribution.csv", index=False)
pd.DataFrame(paired).to_csv(OUT / "A_eeg_subject_level_tests.csv", index=False)


# ── B. Personal-threshold separation rule (SAM40 LOSO out-of-fold scores) ──
def personal_threshold(rest, task):
    rm, tm = np.mean(rest), np.mean(task)
    if tm - rm < MAX_SHIFT:
        return None
    return max(P5, min(P95, (rm + tm) / 2))


B = []
for s, g in scores.groupby("subject"):
    rest = g.loc[g.task == "Relax", "calibrated_score"]
    for task_def, task in [("Arithmetic (onboarding task)", g.loc[g.task == "Arithmetic", "calibrated_score"]),
                           ("All tasks", g.loc[g.y_true == 1, "calibrated_score"])]:
        th = personal_threshold(rest, task)
        B.append({"subject": s, "task_def": task_def, "separation": task.mean() - rest.mean(),
                  "accepted": th is not None, "personal_threshold": th,
                  "subject_auc": float(subj.loc[subj.subject == s, "auc"].iloc[0])})
B = pd.DataFrame(B)
B.to_csv(OUT / "B_personal_threshold_per_subject.csv", index=False)
Bs = []
for td, g in B.groupby("task_def"):
    acc_, rej = g[g.accepted], g[~g.accepted]
    Bs.append({"task_def": td, "min_separation": MAX_SHIFT, "n_accepted": len(acc_), "n_rejected": len(rej),
               "median_auc_accepted": acc_.subject_auc.median(), "median_auc_rejected": rej.subject_auc.median(),
               "n_below_chance_rejected": int((rej.subject_auc < 0.5).sum()),
               "n_below_chance_total": int((g.subject_auc < 0.5).sum()),
               "mannwhitney_p_auc": stats.mannwhitneyu(acc_.subject_auc, rej.subject_auc).pvalue
               if len(acc_) and len(rej) else np.nan})
pd.DataFrame(Bs).to_csv(OUT / "B_personal_threshold_summary.csv", index=False)


# ── C. Repeated-calibration stability (leave-one-trial-out proxy) ─────
# Calibrate on trial k (1 Relax + 1 Arithmetic block), evaluate on the
# other two trials' blocks (all 4 conditions). 3 "calibration sessions"
# per subject. Evaluation blocks are never used for calibration.
C = []
for s, g in scores.groupby("subject"):
    for k in (1, 2, 3):
        cal = g[g.trial == k]
        ev = g[g.trial != k]
        rest = cal.loc[cal.task == "Relax", "calibrated_score"]
        task = cal.loc[cal.task == "Arithmetic", "calibrated_score"]
        th = personal_threshold(rest, task)
        used = th if th is not None else POP_HIGH_LOAD
        C.append({"subject": s, "cal_trial": k, "accepted": th is not None,
                  "personal_threshold": th, "threshold_used": used,
                  "bal_acc_personal_or_fallback": bal_acc(ev.y_true, ev.calibrated_score >= used),
                  "bal_acc_population": bal_acc(ev.y_true, ev.calibrated_score >= POP_HIGH_LOAD)})
C = pd.DataFrame(C)
C.to_csv(OUT / "C_repeated_calibration_per_session.csv", index=False)
acc_counts = C.groupby("subject").accepted.sum()
within_sd = C.dropna(subset=["personal_threshold"]).groupby("subject").personal_threshold.agg(["std", "count"])
within_sd = within_sd[within_sd["count"] >= 2]
per_subj = C.groupby("subject")[["bal_acc_personal_or_fallback", "bal_acc_population"]].mean()
diff = (per_subj.bal_acc_personal_or_fallback - per_subj.bal_acc_population).to_numpy()
Csum = {
    "n_subjects": C.subject.nunique(), "sessions_per_subject": 3,
    "subjects_accepted_0_of_3": int((acc_counts == 0).sum()),
    "subjects_accepted_1_of_3": int((acc_counts == 1).sum()),
    "subjects_accepted_2_of_3": int((acc_counts == 2).sum()),
    "subjects_accepted_3_of_3": int((acc_counts == 3).sum()),
    "session_acceptance_rate": C.accepted.mean(),
    "n_subjects_with_>=2_accepted": len(within_sd),
    "median_within_subject_threshold_sd": within_sd["std"].median() if len(within_sd) else np.nan,
    "max_within_subject_threshold_sd": within_sd["std"].max() if len(within_sd) else np.nan,
    "between_subject_threshold_sd": C.dropna(subset=["personal_threshold"]).groupby("subject")
        .personal_threshold.mean().std(),
    "mean_bal_acc_personal": per_subj.bal_acc_personal_or_fallback.mean(),
    "mean_bal_acc_personal_ci": boot_ci(per_subj.bal_acc_personal_or_fallback.to_numpy()),
    "mean_bal_acc_population": per_subj.bal_acc_population.mean(),
    "mean_bal_acc_population_ci": boot_ci(per_subj.bal_acc_population.to_numpy()),
    "mean_diff": diff.mean(), "mean_diff_ci": boot_ci(diff),
    "wilcoxon_p": stats.wilcoxon(diff).pvalue if np.any(diff != 0) else np.nan,
}
pd.DataFrame([Csum]).T.to_csv(OUT / "C_repeated_calibration_summary.csv", header=["value"])


# ── D. Fusion mechanism validation + ablations (synthetic, no labels) ──
import fusion_engin as fe  # noqa: E402

EEG_ACC, PHY_ACC = 0.706, 0.851
EEG_TH, PHY_TH = POP_HIGH_LOAD, 0.7141


def variant(inp, mode):
    """mode: full | equal | no_quality | no_gate  (re-implements the weighting
    so each ablation changes exactly one factor of fusion_engin's formula)."""
    w, p, th = {}, {}, {}
    for m, d in inp.items():
        if d is None or d.get("prob") is None:
            continue
        q = d["signal_quality"] / (100.0 if m == "eeg" else 1.0)
        c = max(d["prob"], 1 - d["prob"])
        extreme = d["prob"] < fe.EXTREME_PROB_EPS or d["prob"] > 1 - fe.EXTREME_PROB_EPS
        if mode == "equal":
            wm = 1.0
        elif mode == "no_quality":
            wm = c * d["model_acc"]
        else:
            wm = q * c * d["model_acc"]
        if extreme and mode != "no_gate":
            wm = 0.0
        if wm > 0:
            w[m], p[m], th[m] = wm, d["prob"], d["threshold"]
    if not w:
        return None, None, None, {}
    tot = sum(w.values())
    fp = sum(p[m] * w[m] / tot for m in w)
    ft = sum(th[m] * w[m] / tot for m in w)
    return fp, ft, ("ELEVATED" if fp >= ft else "NOT_ELEVATED"), {m: w[m] / tot for m in w}


def mk(prob, q, acc, th):
    return None if prob is None else {"prob": prob, "confidence": max(prob, 1 - prob),
                                       "signal_quality": q, "model_acc": acc, "threshold": th,
                                       "threshold_scale": 0.11 if acc == EEG_ACC else 0.10}


scen = [
    ("S1 both present, good quality, both elevated", mk(0.84, 92, EEG_ACC, EEG_TH), mk(0.88, 0.9, PHY_ACC, PHY_TH)),
    ("S2 both present, good quality, both low", mk(0.66, 92, EEG_ACC, EEG_TH), mk(0.20, 0.9, PHY_ACC, PHY_TH)),
    ("S3 discordant: load up, arousal low", mk(0.84, 92, EEG_ACC, EEG_TH), mk(0.20, 0.9, PHY_ACC, PHY_TH)),
    ("S4 discordant: load low, arousal up", mk(0.66, 92, EEG_ACC, EEG_TH), mk(0.88, 0.9, PHY_ACC, PHY_TH)),
    ("S5 EEG missing (no block in window)", None, mk(0.88, 0.9, PHY_ACC, PHY_TH)),
    ("S6 physiological missing (60s cadence gap)", mk(0.84, 92, EEG_ACC, EEG_TH), None),
    ("S7 both missing", None, None),
    ("S8 EEG poor quality (q=20) + discordant", mk(0.84, 20, EEG_ACC, EEG_TH), mk(0.20, 0.9, PHY_ACC, PHY_TH)),
    ("S9 physiological poor quality (q=0.2) + discordant", mk(0.84, 92, EEG_ACC, EEG_TH), mk(0.20, 0.2, PHY_ACC, PHY_TH)),
    ("S10 EEG implausible (p=1e-40, OOD artifact)", mk(1e-40, 90, EEG_ACC, EEG_TH), mk(0.88, 0.9, PHY_ACC, PHY_TH)),
    ("S11 physiological implausible (p=1-1e-9)", mk(0.66, 92, EEG_ACC, EEG_TH), mk(1 - 1e-9, 0.9, PHY_ACC, PHY_TH)),
    ("S12 personal EEG threshold 0.70 vs population", mk(0.74, 92, EEG_ACC, 0.70), mk(0.60, 0.9, PHY_ACC, PHY_TH)),
    ("S13 same as S12 with population EEG threshold", mk(0.74, 92, EEG_ACC, EEG_TH), mk(0.60, 0.9, PHY_ACC, PHY_TH)),
]
D = []
for name, e, ph in scen:
    ref = fe.compute_realtime_multimodal_fusion({"eeg": e, "hrv_gsr": ph})
    row = {"scenario": name, "engine_p": ref["fused_stress_probability"],
           "engine_theta": ref["fused_stress_threshold"], "engine_label": ref["fused_stress_label"],
           "engine_active": ",".join(ref["active_modalities"]), "concordance": ref["modality_concordance"],
           "relative_index": ref["fused_relative_index"],
           "w_eeg": ref["modality_weights"].get("eeg"), "w_phy": ref["modality_weights"].get("hrv_gsr")}
    for mode in ["full", "equal", "no_quality", "no_gate"]:
        fp, ft, lab, w = variant({"eeg": e, "hrv_gsr": ph}, mode)
        row[f"{mode}_p"], row[f"{mode}_label"] = fp, lab
        row[f"{mode}_w_eeg"] = w.get("eeg")
    D.append(row)
D = pd.DataFrame(D)
D.to_csv(OUT / "D_fusion_scenarios.csv", index=False)

# Quality sweep: EEG weight as its quality falls (discordant case S3)
sweep = []
for q in [100, 90, 80, 60, 40, 20, 10, 0]:
    r_ = fe.compute_realtime_multimodal_fusion({"eeg": mk(0.84, q, EEG_ACC, EEG_TH),
                                                "hrv_gsr": mk(0.20, 0.9, PHY_ACC, PHY_TH)})
    sweep.append({"eeg_quality": q, "w_eeg": r_["modality_weights"]["eeg"],
                  "fused_p": r_["fused_stress_probability"], "label": r_["fused_stress_label"]})
pd.DataFrame(sweep).to_csv(OUT / "D_fusion_quality_sweep.csv", index=False)

# Missing-modality Monte Carlo: EEG p drawn from real SAM40 OOF scores,
# availability pattern from the two cadences (EEG 25 s, physiological 60 s
# on 25 s windows), plus random dropout.
mc = []
eeg_pool = scores.calibrated_score.to_numpy()
for drop in [0.0, 0.1, 0.3, 0.5]:
    cnt = {"both": 0, "eeg_only": 0, "phy_only": 0, "none": 0}
    n = 20000
    for i in range(n):
        eeg_on = RNG.random() >= drop
        phy_on = (RNG.random() < 25 / 60) and (RNG.random() >= drop)
        e = mk(float(RNG.choice(eeg_pool)), 90, EEG_ACC, EEG_TH) if eeg_on else None
        ph = mk(float(RNG.uniform(0.05, 0.95)), 0.9, PHY_ACC, PHY_TH) if phy_on else None
        res = fe.compute_realtime_multimodal_fusion({"eeg": e, "hrv_gsr": ph})
        act = res["active_modalities"]
        key = "both" if len(act) == 2 else ("eeg_only" if act == ["eeg"] else ("phy_only" if act else "none"))
        cnt[key] += 1
    mc.append({"per_modality_dropout": drop, **{k: v / n for k, v in cnt.items()}})
pd.DataFrame(mc).to_csv(OUT / "D_missing_modality_montecarlo.csv", index=False)


# ── E. Computational cost ─────────────────────────────────────────────
from sam40.features import channel_features  # noqa: E402

def timeit(fn, n=500):
    fn()
    t = time.perf_counter()
    for _ in range(n):
        fn()
    return (time.perf_counter() - t) / n * 1000


E = []
eeg_path = REPO / "psycological/results/models_25s_block_bipolar_only/sam40_t7t8_state_model.joblib"
eeg_obj = joblib.load(eeg_path)
eeg_model = eeg_obj["model"] if isinstance(eeg_obj, dict) else eeg_obj
n_eeg_feat = 29
Xe = RNG.normal(size=(1, n_eeg_feat))
try:
    lr = eeg_model[-1]
    n_params = lr.coef_.size + lr.intercept_.size + 2 * n_eeg_feat
except Exception:
    n_params = None
sig = RNG.normal(size=128 * 25) * 20
tracemalloc.start()
channel_features(sig, fs=128)
_, peak_feat = tracemalloc.get_traced_memory()
tracemalloc.stop()
E.append({"component": "EEG model (StandardScaler + LogisticRegression)",
          "file_kb": eeg_path.stat().st_size / 1024, "parameters": n_params,
          "inference_ms_per_window": timeit(lambda: eeg_model.predict_proba(Xe)),
          "feature_extraction_ms_per_window": timeit(lambda: channel_features(sig, fs=128), n=50),
          "peak_mem_feature_extraction_kb": peak_feat / 1024})

phy_dir = REPO / "physiological_signals/saved_models"
phy_model = joblib.load(phy_dir / "best_model_obj1_v2.pkl")
phy_scaler = joblib.load(phy_dir / "scaler_obj1_v2.pkl")
n_phy = len(joblib.load(phy_dir / "feature_cols_obj1_v2.pkl"))
Xp = RNG.normal(size=(1, n_phy))
try:
    tdf = phy_model.get_booster().trees_to_dataframe()
    n_nodes = len(tdf)
    n_trees = tdf.Tree.nunique()
except Exception:
    n_nodes = n_trees = None
E.append({"component": f"Physiological model (StandardScaler + XGBoost, {n_trees} trees, {n_nodes} nodes)",
          "file_kb": (phy_dir / "best_model_obj1_v2.pkl").stat().st_size / 1024, "parameters": n_nodes,
          "inference_ms_per_window": timeit(lambda: phy_model.predict_proba(phy_scaler.transform(Xp)))})

fin = {"eeg": mk(0.84, 92, EEG_ACC, EEG_TH), "hrv_gsr": mk(0.3, 0.9, PHY_ACC, PHY_TH)}
E.append({"component": "Fusion step (reliability-weighted)", "file_kb": 0, "parameters": 0,
          "inference_ms_per_window": timeit(lambda: fe.compute_realtime_multimodal_fusion(fin), n=5000)})
E = pd.DataFrame(E)
E["platform"] = f"{platform.machine()} {platform.system()} {platform.release()}, Python {platform.python_version()}"
E.to_csv(OUT / "E_computational_cost.csv", index=False)

pd.set_option("display.width", 220, "display.max_columns", 40)
for f in sorted(OUT.glob("*.csv")):
    if "per_subject" in f.name or "per_session" in f.name:
        continue
    print(f"\n### {f.name}\n{pd.read_csv(f).to_string()}")
