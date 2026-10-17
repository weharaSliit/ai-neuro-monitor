#!/usr/bin/env python3
"""
L3 fusion evaluation on SYNCHRONIZED data (pilot study, Sect. 12).
Compares the proposed reliability-weighted rule (and its ablations) with
each single modality and with a learned logistic meta-model, all LOSO.

    python paper/analysis/fusion_comparison.py --data pilot_windows.csv

Input: one row per aligned 25 s window with columns
    subject, label (independent condition label, 0/1),
    p_cl, q_cl (0-100), p_aa, q_aa (0-1),
    th_cl, th_aa (effective thresholds; optional, population defaults used)
Missing modality = NaN in p_*.

Output: results/fusion_L_summary.csv (per-variant AUC with subject-cluster
CI, mean per-subject AUC with CI, DeLong vs best single modality) and
results/fusion_L_per_subject.csv.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stats_utils import cluster_bootstrap_auc, delong_test, safe_auc, subject_bootstrap  # noqa: E402

A_CL, A_AA = 0.632, 0.938          # pooled LOSO AUC, same metric for both (Sect. 7.3)
TH_CL, TH_AA = 0.7933, 0.7141
EPS = 1e-6


def rule_margin(df, mode="full", a_cl=A_CL, a_aa=A_AA):
    """Continuous fused margin p_F - theta_F (monotone in the ELEVATED decision)."""
    out = np.full(len(df), np.nan)
    for i, r in enumerate(df.itertuples()):
        w, p, t = [], [], []
        for pm, qm, am, tm, qmax in [(r.p_cl, r.q_cl, a_cl, r.th_cl, 100.0), (r.p_aa, r.q_aa, a_aa, r.th_aa, 1.0)]:
            if np.isnan(pm):
                continue
            c = max(pm, 1 - pm)
            q = min(max(qm / qmax, 0), 1)
            wm = {"full": q * c * am, "no_quality": c * am, "equal": 1.0, "no_gate": q * c * am}[mode]
            if mode != "no_gate" and (pm < EPS or pm > 1 - EPS):
                wm = 0.0
            if wm > 0:
                w.append(wm); p.append(pm); t.append(tm)
        if w:
            w = np.array(w) / sum(w)
            out[i] = float(np.dot(w, p) - np.dot(w, t))
    return out


def meta_model_loso(df, groups):
    """Logistic meta-model on [p_cl, p_aa, p_cl*p_aa, missing flags], LOSO."""
    X = pd.DataFrame({"p_cl": df.p_cl.fillna(df.th_cl), "p_aa": df.p_aa.fillna(df.th_aa),
                      "miss_cl": df.p_cl.isna().astype(float), "miss_aa": df.p_aa.isna().astype(float)})
    X["inter"] = X.p_cl * X.p_aa
    X = X.to_numpy()
    y = df.label.to_numpy()
    out = np.full(len(df), np.nan)
    for s in np.unique(groups):
        te, tr = groups == s, groups != s
        m = LogisticRegression(max_iter=1000).fit(X[tr], y[tr])
        out[te] = m.predict_proba(X[te])[:, 1]
    return out


def run(df):
    df = df.copy()
    df["th_cl"] = df.get("th_cl", pd.Series(TH_CL, index=df.index)).fillna(TH_CL)
    df["th_aa"] = df.get("th_aa", pd.Series(TH_AA, index=df.index)).fillna(TH_AA)
    g = df.subject.to_numpy()
    both = df.p_cl.notna() & df.p_aa.notna()
    scores = {
        "EEG only (p_CL)": df.p_cl.to_numpy(),
        "Physiological only (p_AA)": df.p_aa.to_numpy(),
        "Fusion: full (q*c*a, gate)": rule_margin(df, "full"),
        "Fusion: equal weights": rule_margin(df, "equal"),
        "Fusion: no quality term": rule_margin(df, "no_quality"),
        "Fusion: no plausibility gate": rule_margin(df, "no_gate"),
        "Fusion: a = Gini (2AUC-1)": rule_margin(df, "full", 2 * A_CL - 1, 2 * A_AA - 1),
        "Logistic meta-model": meta_model_loso(df, g),
        # hard decision-level baselines (review item 23): continuous margins so
        # AUC is defined -- AND = min of the two margins, OR = max
        "Hard AND (both above own threshold)": np.fmin(df.p_cl - df.th_cl, df.p_aa - df.th_aa).to_numpy(),
        "Hard OR (either above own threshold)": np.fmax(df.p_cl - df.th_cl, df.p_aa - df.th_aa).to_numpy(),
    }
    # headline comparisons on windows where BOTH modalities are present
    sub = df[both]
    y = sub.label.to_numpy()
    singles = {k: safe_auc(y, v[both.to_numpy()]) for k, v in scores.items() if "only" in k}
    best_single = max(singles, key=singles.get)
    rows, per_subj = [], []
    for name, s in scores.items():
        sb = s[both.to_numpy()]
        pooled = cluster_bootstrap_auc(y, sb, sub.subject)
        ps = [safe_auc(sub.label[sub.subject == k], sb[(sub.subject == k).to_numpy()])
              for k in np.unique(sub.subject)]
        m, lo, hi = subject_bootstrap(ps)
        a1, a2, z, p = delong_test(y, sb, scores[best_single][both.to_numpy()])
        rows.append({"variant": name, "n_windows_bimodal": int(both.sum()), "pooled_auc": pooled[0],
                     "pooled_auc_ci": (pooled[1], pooled[2]), "subj_mean_auc": m, "subj_auc_ci": (lo, hi),
                     "delong_vs_best_single": best_single, "delong_z": z, "delong_p": p})
        per_subj += [{"variant": name, "subject": k, "auc": a} for k, a in zip(np.unique(sub.subject), ps)]
    return pd.DataFrame(rows), pd.DataFrame(per_subj)


def synthetic(n_subj=12, n_win=40, seed=0):
    """Smoke-test data only -- NOT results."""
    rng = np.random.default_rng(seed)
    rows = []
    for s in range(n_subj):
        for w in range(n_win):
            lab = int(w >= n_win // 2)
            rows.append({"subject": s, "label": lab,
                         "p_cl": np.clip(0.73 + 0.03 * lab + rng.normal(0, 0.05), 0, 1),
                         "q_cl": rng.uniform(40, 100),
                         "p_aa": np.clip(0.3 + 0.4 * lab + rng.normal(0, 0.2), 0, 1) if rng.random() > 0.3 else np.nan,
                         "q_aa": rng.uniform(0.5, 1)})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path)
    ap.add_argument("--smoke-test", action="store_true", help="run on synthetic data (not results)")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "results")
    a = ap.parse_args()
    df = synthetic() if a.smoke_test else pd.read_csv(a.data)
    summ, per = run(df)
    pd.set_option("display.width", 250, "display.max_columns", 20)
    print(summ.to_string())
    if not a.smoke_test:
        a.out.mkdir(parents=True, exist_ok=True)
        summ.to_csv(a.out / "fusion_L_summary.csv", index=False)
        per.to_csv(a.out / "fusion_L_per_subject.csv", index=False)
