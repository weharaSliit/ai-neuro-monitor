#!/usr/bin/env python3
"""
Evaluation of the personal z scale (fushion engin/personal_scale.py).

  Z1  SAM40: z = (raw score - own onboarding-rest mean) / sigma, alert at
      z >= k (k = 0.84 and 1.28), vs one fixed threshold for everyone.
      Onboarding trial(s) never tested; model trained on the other 39.
  Z2  Onboarding responsiveness check: does a low onboarding task z
      identify people whose EEG does not track load?
  Z3  Artefact limit: largest |z| seen on real blocks (sets Z_MAX).
  Z4  Fusion mechanism tests in z units: controlled scenarios, EEG-quality
      sweep, performance-prior sweep, clock offset between devices.

Run:  venv/bin/python paper/analysis/personal_scale_analysis.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from scipy import stats
from sklearn.metrics import roc_auc_score

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "results"
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO / "fushion engin"))
import personalization as P  # noqa: E402  (shared model / normalisation / inner stats)
from personal_scale import K_ALERT, MIN_TASK_RESPONSE, Z_MAX, PersonalBaseline, fuse_personal_z  # noqa: E402
from stats_utils import subject_bootstrap  # noqa: E402

feat = P.feat
A_L, A_A = 0.632, 0.938   # performance priors (pooled LOSO AUC)


# ── Z1/Z2/Z3 ───────────────────────────────────────────────────────────
def session(s, design, cal, personal):
    X, keep = P.normalise(feat, cal, personal)
    y, g = feat.label_task.to_numpy(int), feat.subject.to_numpy()
    rest = (feat.task == "Relax").to_numpy()
    cal_all = feat.trial.isin(cal).to_numpy()
    o = g != s
    m = P.model().fit(X[o & keep], y[o & keep])
    thr_fixed, sigma = P.inner_stats(X[o], y[o], g[o], keep[o], rest[o], cal_all[o])
    me = g == s
    p = m.predict_proba(X[me])[:, 1]
    yb, restb, calb = y[me], rest[me], cal_all[me]
    arith = (feat.task == "Arithmetic").to_numpy()[me]
    pb = PersonalBaseline(sigma_prior=sigma)
    onb = pb.onboard(p[calb & restb], p[calb & arith])
    ev = ~calb
    z = np.array([pb.z(v) for v in p[ev]])
    rows = []
    for rule, flag in [("fixed threshold", p[ev] >= thr_fixed),
                       ("z >= 0.84", z >= 0.84), ("z >= 1.28", z >= 1.28)]:
        ye = yb[ev]
        sens, far = flag[ye == 1].mean(), flag[ye == 0].mean()
        rows.append({"subject": s, "design": design, "cal": str(cal),
                     "baseline": "personal features" if personal else "raw features", "rule": rule,
                     "sens": sens, "far": far, "bal_acc": 0.5 * (sens + 1 - far),
                     "auc": roc_auc_score(ye, p[ev]), "task_response_z": onb["task_response_z"],
                     "responsive": onb["responsive"]})
    blocks = pd.DataFrame({"subject": s, "design": design, "cal": str(cal), "personal": personal,
                           "y": yb[ev], "z": z})
    return rows, blocks


def run_sam40():
    jobs = [(s, d, c, pb) for s in feat.subject.unique() for d, cs in P.DESIGNS.items()
            for c in cs for pb in (False, True)]
    res = Parallel(n_jobs=-1)(delayed(session)(*j) for j in jobs)
    rows = pd.DataFrame(sum([r[0] for r in res], []))
    blocks = pd.concat([r[1] for r in res])
    per = rows.groupby(["design", "baseline", "rule", "subject"])[["sens", "far", "bal_acc", "auc"]] \
        .mean().reset_index()
    ref = per[per.rule == "fixed threshold"].set_index(["design", "baseline", "subject"])
    out = []
    for (d, b, r), gp in per.groupby(["design", "baseline", "rule"], sort=False):
        gp = gp.set_index(["design", "baseline", "subject"])
        row = {"design": d, "baseline": b, "rule": r}
        for mtr in ["sens", "far", "bal_acc"]:
            mm, lo, hi = subject_bootstrap(gp[mtr])
            row.update({mtr: mm, f"{mtr}_ci": (round(lo, 3), round(hi, 3))})
        dba = (gp.bal_acc - ref.loc[gp.index, "bal_acc"]).to_numpy()
        mm, lo, hi = subject_bootstrap(dba)
        row.update({"d_bal_acc": mm, "d_ci": (round(lo, 3), round(hi, 3)),
                    "p": stats.wilcoxon(dba).pvalue if np.any(dba != 0) else np.nan})
        out.append(row)
    pd.DataFrame(out).to_csv(OUT / "Z1_personal_scale_sam40.csv", index=False)

    # Z2 responsiveness: per person (averaged over sessions), 2+2, raw features
    r2 = rows[(rows.design == "2+2") & (rows.baseline == "raw features") & (rows.rule == "z >= 0.84")]
    pp = r2.groupby("subject").agg(task_z=("task_response_z", "mean"), auc=("auc", "mean"),
                                   frac_resp=("responsive", "mean"), bal_acc=("bal_acc", "mean"))
    flagged = pp.frac_resp < 0.5  # non-responsive in most onboarding sessions
    rho = stats.spearmanr(pp.task_z, pp.auc)
    Z2 = {"n_people": len(pp), "n_flagged_nonresponsive": int(flagged.sum()),
          "min_task_response_z": MIN_TASK_RESPONSE,
          "spearman_task_z_vs_eval_auc": rho.statistic, "spearman_p": rho.pvalue,
          "eval_auc_flagged": pp.auc[flagged].mean(), "eval_auc_not_flagged": pp.auc[~flagged].mean(),
          "below_chance_total": int((pp.auc < 0.5).sum()),
          "below_chance_flagged": int(((pp.auc < 0.5) & flagged).sum()),
          "bal_acc_not_flagged": pp.bal_acc[~flagged].mean()}
    pd.DataFrame([Z2]).T.to_csv(OUT / "Z2_responsiveness_check.csv", header=["value"])
    pp.to_csv(OUT / "Z2_responsiveness_per_person.csv")

    # Z3 artefact limit
    b = blocks[(blocks.design == "2+2") & (~blocks.personal)]
    pd.DataFrame([{"max_abs_z_real_blocks": blocks.z.abs().max(), "p99_abs_z": blocks.z.abs().quantile(.99),
                   "Z_MAX": Z_MAX}]).T.to_csv(OUT / "Z3_z_range.csv", header=["value"])
    return b


# ── Z4 fusion mechanism tests in z units ───────────────────────────────
def cell(zl, ql, za, qa, a_l=A_L, a_a=A_A):
    return {"eeg": None if zl is None else {"z": zl, "signal_quality": ql, "model_acc": a_l},
            "hrv_gsr": None if za is None else {"z": za, "signal_quality": qa, "model_acc": a_a}}


def arousal_pools(wesad_z):
    """Arousal personal scores: real held-out WESAD windows (K11 of
    wesad_subject_level.py, onboarding windows excluded) when available;
    otherwise simulated N(0,1) rest / N(2.5,1) stress test, labelled as such."""
    if wesad_z is not None:
        w = pd.read_csv(wesad_z)
        w = w[~w.is_calibration_window]
        return (w.loc[w.label == 0, "z"].to_numpy(), w.loc[w.label == 1, "z"].to_numpy(),
                "WESAD held-out (real)")
    r = np.random.default_rng(1)
    return r.normal(0, 1, 5000), r.normal(2.5, 1, 5000), "simulated"


def run_fusion(eeg_blocks, wesad_z=None):
    rest_z = eeg_blocks.loc[eeg_blocks.y == 0, "z"].to_numpy()
    task_z = eeg_blocks.loc[eeg_blocks.y == 1, "z"].to_numpy()
    a_rest, a_high, a_src = arousal_pools(wesad_z)
    # controlled scenarios use real values: low = median rest window,
    # high = 90th percentile of task / stress-test windows (a clearly high
    # window). The typical (median) task window is reported as well.
    L0, L1 = float(np.median(rest_z)), float(np.percentile(task_z, 90))
    A0, A1 = float(np.median(a_rest)), float(np.percentile(a_high, 90))
    pd.DataFrame([{"load_rest_median": L0, "load_task_median": float(np.median(task_z)),
                   "load_task_p90": L1, "load_task_share_above_k": float((task_z >= K_ALERT).mean()),
                   "arousal_rest_median": A0, "arousal_high_median": float(np.median(a_high)),
                   "arousal_high_p90": A1, "arousal_high_share_above_k": float((a_high >= K_ALERT).mean()),
                   "arousal_source": a_src}]).to_csv(OUT / "Z4_scenario_values.csv", index=False)
    scen = [("S1 both high", L1, 92, A1, 0.9), ("S2 both low", L0, 92, A0, 0.9),
            ("S3 load only", L1, 92, A0, 0.9), ("S4 arousal only", L0, 92, A1, 0.9),
            ("S5 poor EEG", L1, 20, A0, 0.9), ("S6 poor GSR/HRV", L1, 92, A0, 0.2),
            ("S7 EEG artefact", -40.0, 90, A1, 0.9), ("S8 GSR/HRV artefact", L0, 92, 50.0, 0.9),
            ("S9 EEG missing", None, 0, A1, 0.9)]
    rows = []
    for name, zl, ql, za, qa in scen:
        f = fuse_personal_z(cell(zl, ql, za, qa))
        eq = fuse_personal_z(cell(zl, 100 if zl is not None else 0, za, 1.0, 1.0, 1.0))
        nogate = fuse_personal_z(cell(zl, ql, za, qa), z_max=np.inf)
        rows.append({"scenario": name, "z_load": zl, "q_load": ql, "z_arousal": za, "q_arousal": qa,
                     "w_eeg": f["weights"].get("eeg", 0.0), "z_fused": f["z_fused"], "alert": f["alert"],
                     "agreement": f["agreement"], "state": f["state"],
                     "equal_z": eq["z_fused"], "equal_alert": eq["alert"],
                     "nogate_z": nogate["z_fused"], "nogate_alert": nogate["alert"], "arousal_source": a_src})
    pd.DataFrame(rows).to_csv(OUT / "Z4_fusion_scenarios.csv", index=False)

    sweep = [{"eeg_quality": q, "w_eeg": fuse_personal_z(cell(L1, q, A0, 0.9))["weights"].get("eeg", 0.0)}
             for q in (100, 80, 60, 40, 20, 0)]
    pd.DataFrame(sweep).to_csv(OUT / "Z4_quality_sweep.csv", index=False)

    rng = np.random.default_rng(0)

    # prior sweep: 5000 cells, EEG z from real SAM40 blocks, arousal z synthetic
    n = 5000
    zl = np.where(rng.random(n) < 0.5, rng.choice(rest_z, n), rng.choice(task_z, n))
    za = np.where(rng.random(n) < 0.5, rng.choice(a_rest, n), rng.choice(a_high, n))
    ql, qa = rng.uniform(60, 100, n), rng.uniform(0.6, 1.0, n)

    def flags(a_l, a_a):
        return np.array([fuse_personal_z(cell(zl[i], ql[i], za[i], qa[i], a_l, a_a))["alert"] for i in range(n)])
    ref = flags(A_L, A_A)
    pri = []
    for ratio in (0.25, 0.5, 0.67, 1.0, 2.0, 4.0):
        a_l, a_a = (ratio, 1.0) if ratio <= 1 else (1.0, 1.0 / ratio)
        f = flags(a_l, a_a)
        pri.append({"a_ratio_load_over_arousal": ratio, "alert_rate": f.mean(), "flags_changed": (f != ref).mean()})
    pd.DataFrame(pri).assign(arousal_source=a_src).to_csv(OUT / "Z4_prior_sweep.csv", index=False)

    # clock offset: 200 synthetic 30-min sessions, live 25 s capture-time grid
    off_rows = []
    for seed in range(200):
        r = np.random.default_rng(seed)
        T = 1800
        load, ar = [], []
        while len(load) < T:
            d = int(r.integers(120, 361))
            load += [int(r.random() < 0.5)] * d
            ar += [int(r.random() < 0.5)] * d
        load, ar = np.array(load[:T]), np.array(ar[:T])
        ends = np.arange(60, T + 1, 60)
        zav = {e: float(r.choice(a_high if ar[e - 60:e].mean() >= 0.5 else a_rest)) for e in ends}
        zle = {b: float(r.choice(task_z if load[b - 25:b].mean() >= 0.5 else rest_z)) for b in range(25, T + 1, 25)}
        for off in (0, 5, 15, 30):
            bucket = {int(np.ceil((e + off) / 25) * 25): zav[e] for e in ends}
            for b, z_l in zle.items():
                f = fuse_personal_z(cell(z_l, 90, bucket.get(b), 0.9))
                off_rows.append({"seed": seed, "t": b, "offset": off, "alert": bool(f["alert"]),
                                 "bimodal": b in bucket})
    Q = pd.DataFrame(off_rows)
    base = Q[Q.offset == 0].set_index(["seed", "t"]).alert
    offs = [{"clock_offset_s": o, "bimodal_share": g.bimodal.mean(),
             "flags_changed": (g.set_index(["seed", "t"]).alert != base).mean()} for o, g in Q.groupby("offset")]
    pd.DataFrame(offs).assign(arousal_source=a_src).to_csv(OUT / "Z4_clock_offset.csv", index=False)


def write_latex():
    """paper/lncs/generated/fusion_results.tex: Table 7 rows + text macros,
    so the paper always shows this script's last run."""
    sc = pd.read_csv(OUT / "Z4_fusion_scenarios.csv")
    v = pd.read_csv(OUT / "Z4_scenario_values.csv").iloc[0]
    pri = pd.read_csv(OUT / "Z4_prior_sweep.csv").set_index("a_ratio_load_over_arousal")
    off = pd.read_csv(OUT / "Z4_clock_offset.csv").set_index("clock_offset_s")
    names = {"S1 both high": "S1 both high", "S2 both low": "S2 both low", "S3 load only": "S3 load only",
             "S4 arousal only": "S4 arousal only", "S5 poor EEG": "S5 poor EEG",
             "S6 poor GSR/HRV": "S6 poor GSR/HRV", "S7 EEG artefact": "S7 EEG artefact",
             "S8 GSR/HRV artefact": "S8 GSR/HRV artefact", "S9 EEG missing": "S9 EEG missing"}
    states = {"load+arousal": "load + arousal", "focused load": "focused load",
              "arousal without load": "arousal without load", "rest": "rest"}

    def zf(x):
        return "--" if pd.isna(x) else f"{round(x, 2) + 0.0:.2f}".replace("-", "$-$")

    rows = []
    for r in sc.itertuples():
        ql = "--" if pd.isna(r.z_load) else f"{zf(r.z_load)} [{int(r.q_load)}]"
        rule = f"{r.w_eeg:.2f}; {zf(r.z_fused)}\\,{'A' if r.alert else '--'}"
        state = states.get(r.state, "--") if isinstance(r.state, str) else "--"
        ng = "= rule" if (r.nogate_alert == r.alert and abs((r.nogate_z or 0) - (r.z_fused or 0)) < 1e-9) \
            else f"{zf(r.nogate_z)}\\,\\textbf{{{'A' if r.nogate_alert else '--'}}}"
        rows.append(f"{names[r.scenario]} & {ql} & {zf(r.z_arousal)} [{r.q_arousal:g}] & {rule} & {state} & {ng}\\\\")
    pct = lambda x: f"{100 * x:.1f}\\%"  # noqa: E731
    src = "real held-out WESAD windows" if v.arousal_source.startswith("WESAD") else \
        "\\textcolor{red}{simulated values (re-run with WESAD)}"
    m = {
        "FusionArousalSource": src,
        "FusionLoadRest": zf(v.load_rest_median), "FusionLoadTaskMedian": zf(v.load_task_median),
        "FusionLoadTaskPninety": zf(v.load_task_p90), "FusionLoadTaskAboveK": pct(v.load_task_share_above_k),
        "FusionArousalRest": zf(v.arousal_rest_median), "FusionArousalHighPninety": zf(v.arousal_high_p90),
        "FusionPriorMaxHalfToOne": pct(max(pri.loc[0.5, "flags_changed"], pri.loc[1.0, "flags_changed"])),
        "FusionPriorQuarter": pct(pri.loc[0.25, "flags_changed"]),
        "FusionOffsetFive": pct(off.loc[5, "flags_changed"]), "FusionOffsetFifteen": pct(off.loc[15, "flags_changed"]),
        "FusionOffsetThirty": pct(off.loc[30, "flags_changed"]),
    }
    dest = REPO / "paper/lncs/generated"
    dest.mkdir(parents=True, exist_ok=True)
    lines = ["% AUTO-GENERATED by paper/analysis/personal_scale_analysis.py -- do not edit by hand"]
    lines += [f"\\newcommand{{\\{k}}}{{{val}}}" for k, val in m.items()]
    lines += ["\\newcommand{\\FusionScenarioRows}{%"] + rows + ["}"]
    (dest / "fusion_results.tex").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--wesad-z", type=Path, default=OUT / "wesad_K11_arousal_z.csv",
                    help="arousal personal scores from wesad_subject_level.py (K11)")
    a = ap.parse_args()
    wz = a.wesad_z if a.wesad_z.exists() else None
    if wz is None:
        print("NOTE: WESAD arousal scores not found -- arousal is SIMULATED in Z4 "
              "(run wesad_subject_level.py first for real values)")
    blocks = run_sam40()
    run_fusion(blocks, wz)
    write_latex()
    pd.set_option("display.width", 250, "display.max_columns", 30)
    for f in ["Z1_personal_scale_sam40", "Z4_scenario_values", "Z4_fusion_scenarios", "Z4_quality_sweep", "Z4_prior_sweep",
              "Z4_clock_offset"]:
        print(f"\n### {f}\n{pd.read_csv(OUT / (f + '.csv')).round(3).to_string()}")
    for f in ["Z2_responsiveness_check", "Z3_z_range"]:
        print(f"\n### {f}\n{pd.read_csv(OUT / (f + '.csv')).to_string()}")
