#!/usr/bin/env python3
"""
WESAD autonomic-arousal component: subject-level analysis for the paper.
Run this where the WESAD feature table exists (it is not in the repo):

    python paper/analysis/wesad_subject_level.py \
        --features path/to/wesad_features_selected.csv

Input: one row per 60 s window (30 s step), columns = the 23 deployed
features + `label` (0 = baseline, 1 = TSST condition) + `subject_id`.
Rows must be in chronological order within each subject (as written by
notebook 03/04) -- used to identify the calibration windows and the
non-overlapping subset.

Outputs (paper/analysis/results/wesad_*.csv):
  K1 per-subject metrics + subject-bootstrap CIs, static model
  K2 nested Youden threshold (inner GroupKFold on training subjects only)
     vs the pooled-OOF threshold 0.7141 (optimistic reference)
  K3 personalization with the calibration windows EXCLUDED from evaluation
  K4 overlap sensitivity: every metric re-computed on non-overlapping windows
  K5 probability calibration: ECE raw vs nested-Platt
  K6 out-of-fold scores (for fusion analyses) + fold assignments
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stats_utils import (bal_acc, cluster_bootstrap_auc, ece, safe_auc,  # noqa: E402
                         subject_bootstrap, youden_threshold)

XGB_PARAMS = dict(n_estimators=300, max_depth=6, learning_rate=0.1, eval_metric="logloss",
                  random_state=42, n_jobs=-1, verbosity=0)
EDA_FEATURES = {"SCL_mean", "SCL_std", "SCL_slope", "EDA_mean", "EDA_std", "EDA_range", "EDA_slope",
                "SCR_count", "SCR_amp_mean", "SCR_width_mean", "EDA_q10", "EDA_q25", "EDA_q75", "EDA_q90",
                "deriv1_mean", "deriv1_std", "deriv2_mean", "wavelet_approx_mean", "wavelet_approx_energy",
                "wavelet_d1_energy", "wavelet_d2_energy", "wavelet_d3_energy"}
POOLED_YOUDEN = 0.7141
N_CAL = 3


def make_model():
    import xgboost as xgb
    return xgb.XGBClassifier(**XGB_PARAMS)


def fit_predict(Xtr, ytr, Xte):
    sc = StandardScaler().fit(Xtr)
    m = make_model()
    m.fit(sc.transform(Xtr), ytr, sample_weight=compute_sample_weight("balanced", ytr))
    return m.predict_proba(sc.transform(Xte))[:, 1]


def personal_normalize(X, y, cols):
    """Baseline = first N_CAL baseline-condition windows (protocol-defined rest
    calibration). Returns normalized X and a mask of the calibration windows."""
    cal_idx = np.where(y == 0)[0][:N_CAL]
    base = X[cal_idx] if len(cal_idx) else X[:N_CAL]
    mu, sd = base.mean(0), base.std(0)
    floor = np.maximum(np.abs(mu) * 0.10, 0.01)
    sd = np.maximum(sd, floor)
    Xn = X.astype(float).copy()
    for i, c in enumerate(cols):
        if c in EDA_FEATURES:
            Xn[:, i] = X[:, i] / mu[i] if abs(mu[i]) > 1e-3 else X[:, i] - mu[i]
        else:
            Xn[:, i] = (X[:, i] - mu[i]) / sd[i]
    cal_mask = np.zeros(len(X), bool)
    cal_mask[cal_idx] = True
    return Xn, cal_mask


def non_overlap_mask(df):
    """Keep every second window within each (subject, contiguous label run):
    with a 30 s step and 60 s length, alternate windows do not overlap."""
    keep = np.zeros(len(df), bool)
    run = (df.label != df.label.shift()) | (df.subject_id != df.subject_id.shift())
    run_id = run.cumsum().to_numpy()
    pos = df.groupby(run_id).cumcount().to_numpy()
    keep[pos % 2 == 0] = True
    return keep


def write_arousal_z(df_out, out):
    """K11: arousal on the personal scale, exactly as for EEG
    (fushion engin/personal_scale.py): z = (p - mu_rest) / sigma, where
    mu_rest = mean raw score of the person's onboarding (calibration) rest
    windows and sigma = RMS deviation of LATER rest windows from their own
    onboarding-rest mean, measured on the OTHER people only. Raw XGBoost
    scores (p_static) -- no probability calibration."""
    d = df_out.copy()
    mu = d[d.is_calibration_window].groupby("subject_id").p_static.mean()
    later_rest = d[(d.label == 0) & ~d.is_calibration_window]
    dev = later_rest.p_static - later_rest.subject_id.map(mu)
    sig = {}
    for s in d.subject_id.unique():
        dv = dev[later_rest.subject_id != s]
        sig[s] = float(np.sqrt(np.mean(dv ** 2)))
    d["mu_rest"] = d.subject_id.map(mu)
    d["sigma"] = d.subject_id.map(sig)
    d["z"] = (d.p_static - d.mu_rest) / d.sigma
    d[["subject_id", "label", "is_calibration_window", "non_overlap", "p_static", "mu_rest", "sigma", "z"]] \
        .to_csv(out / "wesad_K11_arousal_z.csv", index=False)


def check_input(df):
    """Fail early, with a clear message, if the feature table is not in the
    expected form (one row per window, chronological within each subject)."""
    missing = {"label", "subject_id"} - set(df.columns)
    if missing:
        sys.exit(f"feature table is missing column(s) {sorted(missing)}; found: {list(df.columns)[:10]}...")
    if not set(df.label.unique()) <= {0, 1}:
        sys.exit(f"label must be 0 (baseline) / 1 (TSST); found {sorted(df.label.unique())}")
    n_feat = len([c for c in df.columns if c not in ("label", "subject_id")])
    print(f"input OK: {len(df)} windows, {df.subject_id.nunique()} subjects, {n_feat} features, "
          f"{int((df.label == 0).sum())} baseline / {int((df.label == 1).sum())} TSST")
    if n_feat != 23 or df.subject_id.nunique() != 15:
        print("WARNING: the paper describes 23 features and 15 subjects -- check this is the final table")


def run(features_csv: Path, out: Path, n_inner=5):
    df = pd.read_csv(features_csv).reset_index(drop=True)
    check_input(df)
    cols = [c for c in df.columns if c not in ("label", "subject_id")]
    X, y, g = df[cols].to_numpy(float), df.label.to_numpy(int), df.subject_id.to_numpy()
    subjects = np.unique(g)
    no_mask = non_overlap_mask(df)

    oof_static = np.full(len(y), np.nan)
    oof_pers = np.full(len(y), np.nan)
    oof_cal = np.full(len(y), np.nan)
    thr_nested = {}
    cal_mask_all = np.zeros(len(y), bool)
    folds = []

    # per-subject personal normalization (uses only that subject's own calibration windows)
    Xp = np.empty_like(X)
    for s in subjects:
        m = g == s
        Xp[m], cm = personal_normalize(X[m], y[m], cols)
        cal_mask_all[np.where(m)[0][cm]] = True

    for s in subjects:
        te, tr = np.where(g == s)[0], np.where(g != s)[0]
        # static outer prediction
        oof_static[te] = fit_predict(X[tr], y[tr], X[te])
        oof_pers[te] = fit_predict(Xp[tr], y[tr], Xp[te])
        # inner CV on training subjects only -> nested threshold + Platt calibrator
        inner_oof = np.full(len(tr), np.nan)
        for k, (itr, ite) in enumerate(GroupKFold(n_splits=min(n_inner, len(np.unique(g[tr]))))
                                       .split(X[tr], y[tr], g[tr])):
            inner_oof[ite] = fit_predict(X[tr][itr], y[tr][itr], X[tr][ite])
            folds.append(pd.DataFrame({"row": tr[ite], "subject_id": g[tr][ite],
                                       "outer_test_subject": s, "inner_fold": k}))
        folds.append(pd.DataFrame({"row": te, "subject_id": s, "outer_test_subject": s, "inner_fold": -1}))
        thr_nested[s] = youden_threshold(y[tr], inner_oof)
        platt = LogisticRegression().fit(inner_oof.reshape(-1, 1), y[tr])
        oof_cal[te] = platt.predict_proba(oof_static[te].reshape(-1, 1))[:, 1]

    df_out = pd.DataFrame({"subject_id": g, "label": y, "p_static": oof_static, "p_platt": oof_cal,
                           "p_personal": oof_pers, "is_calibration_window": cal_mask_all,
                           "non_overlap": no_mask,
                           "nested_threshold": [thr_nested[s] for s in g]})
    df_out.to_csv(out / "wesad_K6_oof_scores.csv", index=False)
    write_arousal_z(df_out, out)
    pd.concat(folds).to_csv(out / "wesad_K6_fold_assignments.csv", index=False)

    def per_subject(mask, score_col, thr_fn):
        rows = []
        for s in subjects:
            d = df_out[(df_out.subject_id == s) & mask]
            thr = thr_fn(s)
            pred = d[score_col] >= thr
            rows.append({"subject_id": s, "n_windows": len(d), "auc": safe_auc(d.label, d[score_col]),
                         "bal_acc": bal_acc(d.label, pred),
                         "sensitivity": pred[d.label == 1].mean() if (d.label == 1).any() else np.nan,
                         "fpr": pred[d.label == 0].mean() if (d.label == 0).any() else np.nan,
                         "threshold": thr})
        return pd.DataFrame(rows)

    all_rows = np.ones(len(df_out), bool)
    eval_pers = ~df_out.is_calibration_window.to_numpy()
    configs = [
        ("K1 static, pooled-OOF Youden 0.7141 (optimistic)", all_rows, "p_static", lambda s: POOLED_YOUDEN),
        ("K2 static, nested Youden threshold", all_rows, "p_static", lambda s: thr_nested[s]),
        ("K3 personalized, nested threshold, calibration windows excluded", eval_pers, "p_personal",
         lambda s: thr_nested[s]),
        ("K4 static, nested threshold, non-overlapping windows only", no_mask, "p_static",
         lambda s: thr_nested[s]),
        ("K4 personalized, non-overlapping, calibration excluded", no_mask & eval_pers, "p_personal",
         lambda s: thr_nested[s]),
    ]
    summary = []
    for name, mask, col, thr_fn in configs:
        ps = per_subject(mask, col, thr_fn)
        ps.to_csv(out / f"wesad_{name.split()[0]}_{col}_{'no' if mask is no_mask else 'all'}_per_subject.csv",
                  index=False)
        d = df_out[mask]
        pooled = cluster_bootstrap_auc(d.label, d[col], d.subject_id)
        row = {"config": name, "n_windows": int(mask.sum()), "n_subjects": len(subjects),
               "pooled_auc": pooled[0], "pooled_auc_ci": (pooled[1], pooled[2])}
        for metric in ["auc", "bal_acc", "sensitivity", "fpr"]:
            m, lo, hi = subject_bootstrap(ps[metric])
            row[f"subj_mean_{metric}"] = m
            row[f"subj_{metric}_ci"] = (lo, hi)
        row["subj_median_auc"] = float(np.nanmedian(ps.auc))
        row["n_subjects_auc_below_0.5"] = int((ps.auc < 0.5).sum())
        summary.append(row)
    pd.DataFrame(summary).to_csv(out / "wesad_K_summary.csv", index=False)

    th = np.array(list(thr_nested.values()))
    pd.DataFrame([{
        "nested_threshold_mean": th.mean(), "nested_threshold_sd": th.std(ddof=1),
        "nested_threshold_min": th.min(), "nested_threshold_max": th.max(),
        "pooled_oof_youden_reference": POOLED_YOUDEN,
        "ece_raw": ece(y, oof_static), "ece_nested_platt": ece(y, oof_cal),
        "brier_raw": float(np.mean((oof_static - y) ** 2)),
        "brier_nested_platt": float(np.mean((oof_cal - y) ** 2)),
    }]).T.to_csv(out / "wesad_K5_threshold_and_calibration.csv", header=["value"])
    write_latex_macros(pd.DataFrame(summary), th, ece(y, oof_static), ece(y, oof_cal), len(y))
    return pd.DataFrame(summary)


HRV_FEATURES = {"AVNN", "MeanHR", "SDHR", "pNN20", "SD1"}


def feature_groups(cols):
    acc = [c for c in cols if c.lower().startswith("acc")]
    return {"HRV only": [c for c in cols if c in HRV_FEATURES],
            "EDA only": [c for c in cols if c in EDA_FEATURES],
            "ACC only": acc,
            "all 23 features": list(cols)}


def run_robustness(features_csv: Path, out: Path, n_perm=200):
    """Review item 8: is the high WESAD AUC real?
    K7 simpler models / feature groups / single-feature thresholds (LOSO)
    K8 stricter transition exclusion: drop the first/last 2 windows of every
       contiguous label run (>= 60 s more than the +-30 s already removed)
    K9 permutation test: window labels permuted within subject, full LOSO
       re-run (XGBoost), n_perm permutations
    K10 per-subject AUC figure data (static, nested)."""
    df = pd.read_csv(features_csv).reset_index(drop=True)
    cols = [c for c in df.columns if c not in ("label", "subject_id")]
    y, g = df.label.to_numpy(int), df.subject_id.to_numpy()

    def loso(Xm, y_, fit=fit_predict):
        o = np.full(len(y_), np.nan)
        for s in np.unique(g):
            te, tr = g == s, g != s
            o[te] = fit(Xm[tr], y_[tr], Xm[te])
        return o

    def lr_fit(Xtr, ytr, Xte):
        sc = StandardScaler().fit(Xtr)
        m = LogisticRegression(class_weight="balanced", max_iter=2000).fit(sc.transform(Xtr), ytr)
        return m.predict_proba(sc.transform(Xte))[:, 1]

    def summ(name, s, mask=None):
        mask = np.ones(len(y), bool) if mask is None else mask
        a = [safe_auc(y[mask & (g == k)], s[mask & (g == k)]) for k in np.unique(g)]
        m, lo, hi = subject_bootstrap(a)
        return {"variant": name, "n_windows": int(mask.sum()), "subj_mean_auc": m, "ci_lo": lo, "ci_hi": hi,
                "n_below_0.5": int(np.nansum(np.array(a) < 0.5))}

    rows = []
    for gname, gc in feature_groups(cols).items():
        if not gc:
            continue
        Xm = df[gc].to_numpy(float)
        rows.append(summ(f"LogReg, {gname}", loso(Xm, y, lr_fit)))
        rows.append(summ(f"XGBoost, {gname}", loso(Xm, y)))
    for c in [c for c in ("MeanHR", "SCL_mean", "EDA_mean") if c in cols]:
        v = df[c].to_numpy(float)
        o = np.full(len(y), np.nan)
        for s in np.unique(g):
            tr = g != s
            o[g == s] = (1 if safe_auc(y[tr], v[tr]) >= 0.5 else -1) * v[g == s]
        rows.append(summ(f"Single feature, no training: {c}", o))
    static = loso(df[cols].to_numpy(float), y)
    run_id = ((df.label != df.label.shift()) | (df.subject_id != df.subject_id.shift())).cumsum()
    pos = df.groupby(run_id).cumcount()
    rev = df.iloc[::-1].groupby(run_id.iloc[::-1]).cumcount().iloc[::-1]
    strict = ((pos >= 2) & (rev >= 2)).to_numpy()
    rows.append(summ("XGBoost, all features, strict transition exclusion (K8)", static, strict))
    no = non_overlap_mask(df)
    rows.append(summ("XGBoost, all features, strict exclusion + non-overlapping", static, strict & no))
    observed = np.nanmean([safe_auc(y[g == k], static[g == k]) for k in np.unique(g)])
    rng = np.random.default_rng(0)
    null = []
    for _ in range(n_perm):
        yp = y.copy()
        for s in np.unique(g):
            idx = np.where(g == s)[0]
            yp[idx] = rng.permutation(y[idx])
        sp = loso(df[cols].to_numpy(float), yp)
        null.append(np.nanmean([safe_auc(yp[g == k], sp[g == k]) for k in np.unique(g)]))
    null = np.array(null)
    rows.append({"variant": f"K9 permutation test ({n_perm} perms, within subject)", "subj_mean_auc": observed,
                 "null_mean": null.mean(), "null_p95": np.percentile(null, 95),
                 "perm_p": (1 + (null >= observed).sum()) / (n_perm + 1)})
    pd.DataFrame(rows).to_csv(out / "wesad_K7_K9_robustness.csv", index=False)
    pd.DataFrame({"subject_id": np.unique(g),
                  "auc": [safe_auc(y[g == k], static[g == k]) for k in np.unique(g)]}) \
        .to_csv(out / "wesad_K10_per_subject_auc.csv", index=False)
    return pd.DataFrame(rows)


def write_latex_macros(summary, th, ece_raw, ece_platt, n_windows):
    """Writes paper/lncs/generated/wesad_results.tex, \\input by main.tex, so
    the paper's WESAD numbers always come from this script's last run."""
    def f(x):
        return f"{x:.3f}"

    def ci(t):
        return f"[{t[0]:.3f}, {t[1]:.3f}]"

    k = {r["config"].split()[0] + ("P" if "personalized" in r["config"] else ""): r
         for _, r in summary.iterrows()}
    s1, s2, s3, s4, s4p = k["K1"], k["K2"], k["K3P"], k["K4"], k["K4P"]
    macros = {
        "WesadNWindows": str(n_windows),
        "WesadSubjAUC": f(s2["subj_mean_auc"]), "WesadSubjAUCci": ci(s2["subj_auc_ci"]),
        "WesadMedianAUC": f(s2["subj_median_auc"]), "WesadNBelowChance": str(s2["n_subjects_auc_below_0.5"]),
        "WesadPooledAUC": f(s2["pooled_auc"]), "WesadPooledAUCci": ci(s2["pooled_auc_ci"]),
        "WesadThrMean": f(th.mean()), "WesadThrSD": f(th.std(ddof=1)),
        "WesadThrMin": f(th.min()), "WesadThrMax": f(th.max()),
        "WesadBAoptimistic": f(s1["subj_mean_bal_acc"]), "WesadBAoptimisticci": ci(s1["subj_bal_acc_ci"]),
        "WesadBAnested": f(s2["subj_mean_bal_acc"]), "WesadBAnestedci": ci(s2["subj_bal_acc_ci"]),
        "WesadSensNested": f"{100 * s2['subj_mean_sensitivity']:.1f}\\%",
        "WesadFPRNested": f"{100 * s2['subj_mean_fpr']:.1f}\\%",
        "WesadPersAUC": f(s3["subj_mean_auc"]), "WesadPersAUCci": ci(s3["subj_auc_ci"]),
        "WesadPersBA": f(s3["subj_mean_bal_acc"]), "WesadPersBAci": ci(s3["subj_bal_acc_ci"]),
        "WesadNOAUC": f(s4["subj_mean_auc"]), "WesadNOAUCci": ci(s4["subj_auc_ci"]),
        "WesadNOBA": f(s4["subj_mean_bal_acc"]), "WesadNOBAci": ci(s4["subj_bal_acc_ci"]),
        "WesadNOPersAUC": f(s4p["subj_mean_auc"]), "WesadNOPersAUCci": ci(s4p["subj_auc_ci"]),
        "WesadNOPersBA": f(s4p["subj_mean_bal_acc"]), "WesadNOPersBAci": ci(s4p["subj_bal_acc_ci"]),
        "WesadECEraw": f(ece_raw), "WesadECEplatt": f(ece_platt),
    }
    dest = Path(__file__).resolve().parents[1] / "lncs" / "generated"
    dest.mkdir(parents=True, exist_ok=True)
    lines = ["% AUTO-GENERATED by paper/analysis/wesad_subject_level.py -- do not edit by hand"]
    lines += [f"\\newcommand{{\\{k}}}{{{v}}}" for k, v in macros.items()]
    (dest / "wesad_results.tex").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "results")
    ap.add_argument("--robustness", action="store_true", help="also run K7-K10 (review item 8)")
    ap.add_argument("--n-perm", type=int, default=200)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    pd.set_option("display.width", 250, "display.max_columns", 30)
    print(run(a.features, a.out).to_string())
    if a.robustness:
        print(run_robustness(a.features, a.out, a.n_perm).to_string())
