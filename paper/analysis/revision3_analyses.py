#!/usr/bin/env python3
"""
Third-round revision analyses (external review, Sept 2026). All runnable
from artifacts in this repo (SAM40 features / cleaned recordings, committed
out-of-fold scores); WESAD-dependent checks live in wesad_subject_level.py.

  M. Nested model-family selection for the EEG component (review item 12):
     family chosen inside each outer LOSO fold by inner GroupKFold AUC, and
     a re-run of the five-family comparison with one shared code path.
  N. EEG baselines + subject-level permutation test (items 8/23):
     single-feature scores, band-power-only model, and label permutation
     within subject (1000 permutations) for the LOSO mean per-subject AUC.
  O. Personalization: nested selection of the margin configuration (item 2)
     and sensitivity / false-alert breakdown by user group (item 18).
  P. EEG signal-quality validation under injected corruption (item 16):
     quality score (SignalQualityGate) and held-out AUC vs artefact severity.
  Q. Fusion under clock offset between the EEG and peripheral devices (item 17).

Run:  venv/bin/python paper/analysis/revision3_analyses.py
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from scipy import stats
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "results"
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "fushion engin"))
sys.path.insert(0, str(REPO / "psycological" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
warnings.filterwarnings("ignore")

from sam40.train import MODELS, feature_columns  # noqa: E402
from stats_utils import subject_bootstrap  # noqa: E402

RNG = np.random.default_rng(0)
feat = pd.read_csv(REPO / "psycological/results/features_bipolar_only_25s_block.csv")
FCOLS = feature_columns(feat)
X = feat[FCOLS].to_numpy(float)
y = feat.label_task.to_numpy(int)
g = feat.subject.to_numpy()
SUBJ = np.unique(g)
scores = pd.read_csv(REPO / "psycological/results/final_analysis/bipolar_block_level_scores.csv")
pct = json.load(open(REPO / "backend/psychological/sam40/population_percentiles.json"))
P5, P95 = pct["P5"], pct["P95"]
POP_T = 0.7933008189294708


def per_subject_auc(y_, s_, g_):
    return np.array([roc_auc_score(y_[g_ == k], s_[g_ == k]) for k in np.unique(g_)])


def summarize_auc(name, y_, s_, g_, **extra):
    a = per_subject_auc(y_, s_, g_)
    m, lo, hi = subject_bootstrap(a)
    return {"variant": name, "subj_mean_auc": m, "ci_lo": lo, "ci_hi": hi,
            "median_auc": float(np.median(a)), "n_below_0.5": int((a < 0.5).sum()),
            "pooled_auc": roc_auc_score(y_, s_), **extra}


# ── M. Nested model-family selection ──────────────────────────────────
def _outer_fold(s):
    te, tr = g == s, g != s
    inner = GroupKFold(n_splits=5)
    inner_auc = {}
    for name in MODELS:
        oof = np.full(tr.sum(), np.nan)
        for itr, ite in inner.split(X[tr], y[tr], g[tr]):
            m = MODELS[name]().fit(X[tr][itr], y[tr][itr])
            oof[ite] = m.predict_proba(X[tr][ite])[:, 1]
        inner_auc[name] = float(np.mean(per_subject_auc(y[tr], oof, g[tr])))
    outer = {}
    for name in MODELS:
        m = MODELS[name]().fit(X[tr], y[tr])
        outer[name] = (m.predict_proba(X[te])[:, 1], m.predict(X[te]))
    chosen = max(inner_auc, key=inner_auc.get)
    return s, inner_auc, outer, chosen


res = Parallel(n_jobs=-1)(delayed(_outer_fold)(s) for s in SUBJ)
oof_p = {n: np.full(len(y), np.nan) for n in MODELS}
oof_hat = {n: np.full(len(y), np.nan) for n in MODELS}
nested_p = np.full(len(y), np.nan)
choices = []
for s, inner_auc, outer, chosen in res:
    te = g == s
    for n, (p, hat) in outer.items():
        oof_p[n][te], oof_hat[n][te] = p, hat
    nested_p[te] = outer[chosen][0]
    choices.append({"outer_subject": s, "chosen_family": chosen, **{f"inner_auc_{k}": v for k, v in inner_auc.items()}})
choices = pd.DataFrame(choices)
choices.to_csv(OUT / "M_nested_model_selection_per_fold.csv", index=False)
M = []
for n in MODELS:
    per_fold = [{"acc": accuracy_score(y[g == s], oof_hat[n][g == s]),
                 "ba": balanced_accuracy_score(y[g == s], oof_hat[n][g == s]),
                 "f1": f1_score(y[g == s], oof_hat[n][g == s], zero_division=0)} for s in SUBJ]
    pf = pd.DataFrame(per_fold).mean()
    M.append(summarize_auc(n, y, oof_p[n], g, accuracy=pf.acc, balanced_accuracy=pf.ba, f1=pf.f1,
                           times_chosen=int((choices.chosen_family == n).sum())))
M.append(summarize_auc("NESTED: family selected inside each outer fold", y, nested_p, g,
                       times_chosen=len(SUBJ)))
pd.DataFrame(M).to_csv(OUT / "M_nested_model_selection_summary.csv", index=False)


# ── N. Baselines + permutation test ───────────────────────────────────
def loso_lr(Xm, y_, g_):
    out = np.full(len(y_), np.nan)
    for s in np.unique(g_):
        te, tr = g_ == s, g_ != s
        m = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=2000))
        out[te] = m.fit(Xm[tr], y_[tr]).predict_proba(Xm[te])[:, 1]
    return out


def loso_single_feature(col):
    """Untrained score: the feature itself, sign fixed on the training subjects."""
    v = feat[col].to_numpy(float)
    out = np.full(len(y), np.nan)
    for s in SUBJ:
        tr = g != s
        sign = 1.0 if roc_auc_score(y[tr], v[tr]) >= 0.5 else -1.0
        out[g == s] = sign * v[g == s]
    return out


N = [summarize_auc("Chance (constant score)", y, np.zeros(len(y)), g)]
for col in ["bipolar_theta_alpha_ratio", "bipolar_alpha_rel_power", "bipolar_beta_rel_power",
            "bipolar_total_power", "bipolar_spectral_slope"]:
    N.append(summarize_auc(f"Single feature: {col}", y, loso_single_feature(col), g))
band_cols = [c for c in FCOLS if any(b in c for b in ["_power", "_ratio"])]
N.append(summarize_auc(f"Band-power-only LR ({len(band_cols)} features)", y,
                       loso_lr(feat[band_cols].to_numpy(float), y, g), g))
N.append(summarize_auc("Full LR (29 features)", y, loso_lr(X, y, g), g))
observed = N[-1]["subj_mean_auc"]


def _perm(seed):
    r = np.random.default_rng(seed)
    yp = y.copy()
    for s in SUBJ:  # permute within subject: keeps 3 rest / 9 task per subject
        idx = np.where(g == s)[0]
        yp[idx] = r.permutation(y[idx])
    return float(np.mean(per_subject_auc(yp, loso_lr(X, yp, g), g)))


N_PERM = 1000
null = np.array(Parallel(n_jobs=-1)(delayed(_perm)(1000 + i) for i in range(N_PERM)))
N.append({"variant": f"Permutation test (labels permuted within subject, {N_PERM} perms)",
          "subj_mean_auc": observed, "null_mean": null.mean(), "null_p95": np.percentile(null, 95),
          "perm_p": (1 + (null >= observed).sum()) / (N_PERM + 1)})
pd.DataFrame(N).to_csv(OUT / "N_eeg_baselines_permutation.csv", index=False)


# ── O. Personalization: nested config selection + group breakdown ─────
G = pd.read_csv(OUT / "G_margin_per_session.csv")
G["config"] = G.design + " | " + G.rule
G["d_ba"] = G.bal_acc_rule - G.bal_acc_population
per = G.groupby(["config", "subject"]).d_ba.mean().unstack(0)
O_rows = []
for s in per.index:
    best = per.drop(index=s).mean().idxmax()  # chosen on the other 39 subjects only
    O_rows.append({"subject": s, "chosen_config": best, "d_ba": per.loc[s, best]})
O = pd.DataFrame(O_rows)
m, lo, hi = subject_bootstrap(O.d_ba)
O_sum = [{"analysis": "nested config selection (chosen on 39 subjects, applied to held-out one)",
          "mean_d_ba": m, "ci_lo": lo, "ci_hi": hi,
          "wilcoxon_p": stats.wilcoxon(O.d_ba).pvalue if (O.d_ba != 0).any() else np.nan,
          "configs_chosen": O.chosen_config.value_counts().to_dict()}]

# Breakdown of the primary configuration (2+2, z=1.645): sensitivity / FAR
sub_auc = dict(pd.read_csv(OUT / "A_eeg_per_subject.csv")[["subject", "auc"]].values)


def pooled_sd(df):
    r = df[df.task == "Relax"]
    dev = r.calibrated_score - r.groupby("subject").calibrated_score.transform("mean")
    return float(np.sqrt((dev ** 2).sum() / (len(r) - r.subject.nunique())))


rows = []
for s, gs in scores.groupby("subject"):
    sw = pooled_sd(scores[scores.subject != s])
    for cal in ([1, 2], [1, 3], [2, 3]):
        c, ev = gs[gs.trial.isin(cal)], gs[~gs.trial.isin(cal)]
        rest = c.loc[c.task == "Relax", "calibrated_score"]
        task = c.loc[c.task == "Arithmetic", "calibrated_score"]
        delta = 1.645 * sw * np.sqrt(1 / len(rest) + 1 / len(task))
        ok = task.mean() - rest.mean() >= delta
        th = max(P5, min(P95, (rest.mean() + task.mean()) / 2)) if ok else POP_T
        for rule, t in [("rule", th), ("population", POP_T)]:
            pred = ev.calibrated_score >= t
            rows.append({"subject": s, "cal": str(cal), "rule": rule, "accepted": ok,
                         "sens": pred[ev.y_true == 1].mean(), "far": pred[ev.y_true == 0].mean()})
B = pd.DataFrame(rows)
subj_acc = B[B.rule == "rule"].groupby("subject").accepted.any()
B["group"] = B.subject.map(lambda s: "ever accepted" if subj_acc[s] else "never accepted")
B["below_chance"] = B.subject.map(lambda s: sub_auc[s] < 0.5)
brk = []
for grp, gb in [("all users", B), ("ever accepted", B[B.group == "ever accepted"]),
                ("never accepted", B[B.group == "never accepted"]),
                ("below-chance users", B[B.below_chance]),
                ("above-chance users", B[~B.below_chance])]:
    ps = gb.groupby(["subject", "rule"])[["sens", "far"]].mean().unstack("rule")
    brk.append({"group": grp, "n_users": ps.shape[0],
                "sens_population": ps["sens"]["population"].mean(), "sens_rule": ps["sens"]["rule"].mean(),
                "far_population": ps["far"]["population"].mean(), "far_rule": ps["far"]["rule"].mean()})
pd.DataFrame(O_sum).to_csv(OUT / "O_personalization_nested_selection.csv", index=False)
O.to_csv(OUT / "O_personalization_nested_per_subject.csv", index=False)
pd.DataFrame(brk).to_csv(OUT / "O_personalization_breakdown.csv", index=False)


# ── P. Signal-quality validation under injected corruption ────────────
from backend.psychological.realtime.quality_gate import SignalQualityGate  # noqa: E402
from sam40.channels import T7_IDX, T8_IDX  # noqa: E402
from sam40.features import channel_features  # noqa: E402
from sam40.loader import discover_trials, load_trial_data  # noqa: E402
from sam40.preprocess import notch_then_bandpass  # noqa: E402

FS = 128
trials = discover_trials(REPO / "psycological/data/SAM40/filtered_data")
key = {(t.subject, t.task, t.trial): t for t in trials}
raw_bip = [load_trial_data(key[(r.subject, r.task, r.trial)]) for r in feat.itertuples()]
raw_bip = [d[T7_IDX] - d[T8_IDX] for d in raw_bip]  # (T7-r)-(T8-r): reference-free


def corrupt(sig, kind, level, r):
    x = sig.copy()
    sd = np.std(sig)
    n = len(x)
    if kind == "white noise (x SD)":
        x += r.normal(0, level * sd, n)
    elif kind == "motion bursts (x SD)":
        for _ in range(5):  # five 1-s low-frequency transients
            s0 = r.integers(0, n - FS)
            x[s0:s0 + FS] += level * sd * np.sin(np.linspace(0, np.pi, FS)) * r.choice([-1, 1])
    elif kind == "electrode dropout (fraction)":
        s0 = r.integers(0, int(n * (1 - level)) + 1)
        x[s0:s0 + int(level * n)] = 0.0
    elif kind == "50 Hz line noise (x SD)":
        x += level * sd * np.sin(2 * np.pi * 50 * np.arange(n) / FS)
    elif kind == "saturation (clip at x SD)":
        x = np.clip(x, -level * sd, level * sd)
    return x


def block_row(i, kind, level):
    r = np.random.default_rng(i)
    x = corrupt(raw_bip[i], kind, level, r) if kind != "clean" else raw_bip[i]
    filt = notch_then_bandpass(x[None, :])[0]
    q, rating, _ = SignalQualityGate().assess_epoch_single(x, filt)
    cf = channel_features(filt, fs=FS)
    return [cf[c.replace("bipolar_", "", 1)] for c in FCOLS], q


conditions = [("clean", 0)]
conditions += [("white noise (x SD)", v) for v in (0.5, 1, 2, 4)]
conditions += [("motion bursts (x SD)", v) for v in (5, 20, 50)]
conditions += [("electrode dropout (fraction)", v) for v in (0.1, 0.3, 0.6)]
conditions += [("50 Hz line noise (x SD)", v) for v in (1, 5)]
conditions += [("saturation (clip at x SD)", v) for v in (1.0, 0.5)]

# models trained on the CLEAN committed feature table, applied to corrupted held-out blocks
lr_models = {s: make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=2000))
             .fit(X[g != s], y[g != s]) for s in SUBJ}
P, check = [], None
for kind, level in conditions:
    out = Parallel(n_jobs=-1)(delayed(block_row)(i, kind, level) for i in range(len(y)))
    Xc = np.array([o[0] for o in out], float)
    qc = np.array([o[1] for o in out], float)
    if kind == "clean":
        check = float(np.nanmax(np.abs(Xc - X) / (np.abs(X) + 1e-9)))
    pc = np.full(len(y), np.nan)
    for s in SUBJ:
        pc[g == s] = lr_models[s].predict_proba(np.nan_to_num(Xc[g == s]))[:, 1]
    keep = qc >= 40  # not POOR
    a_all = per_subject_auc(y, pc, g)
    a_keep = [roc_auc_score(y[(g == s) & keep], pc[(g == s) & keep]) for s in SUBJ
              if len(np.unique(y[(g == s) & keep])) == 2]
    P.append({"corruption": kind, "level": level, "quality_mean": qc.mean(), "quality_sd": qc.std(),
              "frac_good_ge80": (qc >= 80).mean(), "frac_poor_lt40": (qc < 40).mean(),
              "subj_mean_auc": a_all.mean(), "pooled_auc": roc_auc_score(y, pc),
              "coverage_quality_ge40": keep.mean(),
              "subj_mean_auc_quality_ge40": float(np.mean(a_keep)) if a_keep else np.nan,
              "n_subjects_evaluable_ge40": len(a_keep)})
P = pd.DataFrame(P)
P["clean_feature_reproduction_max_rel_err"] = check
P.to_csv(OUT / "P_eeg_quality_corruption.csv", index=False)


# ── Q. Temporal misalignment of the peripheral stream ─────────────────
import fusion_engin as fe  # noqa: E402

TH_CL, TH_AA, A_CL, A_AA = POP_T, 0.7141, 0.632, 0.938
rest_pool = scores.loc[scores.y_true == 0, "calibrated_score"].to_numpy()
task_pool = scores.loc[scores.y_true == 1, "calibrated_score"].to_numpy()


def session(seed, minutes=30):
    """1-s latent load/arousal states, piecewise constant over 2-6 min segments."""
    r = np.random.default_rng(seed)
    load, ar = [], []
    while len(load) < minutes * 60:
        d = int(r.integers(120, 361))
        load += [int(r.random() < 0.5)] * d
        ar += [int(r.random() < 0.5)] * d
    return np.array(load[:minutes * 60]), np.array(ar[:minutes * 60]), r


def fuse(pcl, paa):
    out = fe.compute_realtime_multimodal_fusion({
        "eeg": {"prob": pcl, "confidence": max(pcl, 1 - pcl), "signal_quality": 90, "model_acc": A_CL,
                "threshold": TH_CL},
        "hrv_gsr": {"prob": paa, "confidence": max(paa, 1 - paa), "signal_quality": 0.9, "model_acc": A_AA,
                    "threshold": TH_AA}})
    return out["fused_stress_probability"] >= out["fused_stress_threshold"], out["modality_concordance"]


Q_rows = []
# Live implementation (backend/common/fusion.py): every record is keyed to an
# ABSOLUTE 25 s bucket by its own capture timestamp; a peripheral reading is
# used only in the bucket containing its capture time (not held), all other
# buckets are EEG-only. Transmission delay therefore does not matter, but a
# clock OFFSET between the EEG device and the peripheral device moves
# readings into neighbouring buckets.
for seed in range(200):
    load, ar, r = session(seed)
    T = len(load)
    aa_ends = np.arange(60, T + 1, 60)  # each reading covers the 60 s ending at its capture time
    aa_val = {e: float(r.beta(6, 2) if ar[e - 60:e].mean() >= 0.5 else r.beta(2, 6)) for e in aa_ends}
    pcl = {}
    for b_end in range(25, T + 1, 25):
        seg = load[b_end - 25:b_end]
        pcl[b_end] = float(r.choice(task_pool if seg.mean() >= 0.5 else rest_pool))
    for offset in (0, 5, 15, 30, 60):
        bucket = {}
        for e in aa_ends:
            t = e + offset
            b = int(np.ceil(t / 25) * 25)  # bucket (b-25, b] that contains the stamped time
            bucket[b] = aa_val[e]
        for b_end, pc in pcl.items():
            if b_end in bucket:
                flag, _ = fuse(pc, bucket[b_end])
            else:
                flag = pc >= TH_CL  # EEG-only window
            Q_rows.append({"seed": seed, "t": b_end, "offset_s": offset, "flag": bool(flag),
                           "bimodal": b_end in bucket})
Q = pd.DataFrame(Q_rows)
ref = Q[Q.offset_s == 0].set_index(["seed", "t"]).flag
Qs = []
for d, gd in Q.groupby("offset_s"):
    gd = gd.set_index(["seed", "t"])
    common = gd.index.intersection(ref.index)
    Qs.append({"clock_offset_s": d, "n_windows": len(common), "bimodal_share": float(gd.bimodal.mean()),
               "flag_changed_vs_0s": float((gd.loc[common].flag != ref.loc[common]).mean())})
pd.DataFrame(Qs).to_csv(OUT / "Q_temporal_misalignment.csv", index=False)

pd.set_option("display.width", 250, "display.max_columns", 30)
for f in ["M_nested_model_selection_summary", "N_eeg_baselines_permutation", "O_personalization_nested_selection",
          "O_personalization_breakdown", "P_eeg_quality_corruption", "Q_temporal_misalignment"]:
    print(f"\n### {f}\n{pd.read_csv(OUT / (f + '.csv')).to_string()}")
