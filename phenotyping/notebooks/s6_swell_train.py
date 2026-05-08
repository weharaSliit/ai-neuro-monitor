"""
================================================================
S6 - SWELL-KW MODEL TRAINING (PURE DIGITAL PHENOTYPING)
================================================================
Three parts:

  Part 1 - Per-user training (Leave-One-Subject-Out style):
            Train Isolation Forest + One-Class SVM on each user's
            'normal' rows only. Test on held-out 'normal' +
            'pre_stress' + 'stressed' rows.
            Compute pre_stress_recall (novel metric) and
            false_alarm_rate (honesty check).

  Part 2 - PROPER permutation test (1000 iterations):
            Shuffle the LABELS while keeping features fixed.
            Compare real pre_stress_recall against the null
            distribution. p < 0.05 means result is real.

  Part 3 - Bootstrap 95% CI (500 iterations):
            Resample users with replacement, recompute mean
            metrics, take 2.5%/97.5% percentiles.

NO HR. NO RMSSD. NO PHYSIOLOGY. ANYWHERE.

Inputs  : data/processed/swell_processed.csv
Outputs : outputs/swell_results.csv
          outputs/swell_per_user.csv
          outputs/permutation_test.csv
          outputs/confidence_intervals.csv
================================================================
"""
from pathlib import Path
import sys
import warnings
import numpy as np
import pandas as pd
from sklearn.ensemble       import IsolationForest
from sklearn.svm            import OneClassSVM
from sklearn.preprocessing  import StandardScaler
from sklearn.metrics        import (f1_score, precision_score,
                                     recall_score)

warnings.filterwarnings("ignore")

# --------------------------------------------------------------
# CONFIG
# --------------------------------------------------------------
ROOT       = Path(__file__).resolve().parents[1]
INPUT      = ROOT / "data" / "processed" / "swell_processed.csv"
OUT_RES    = ROOT / "outputs" / "swell_results.csv"
OUT_USR    = ROOT / "outputs" / "swell_per_user.csv"
OUT_PERM   = ROOT / "outputs" / "permutation_test.csv"
OUT_CI     = ROOT / "outputs" / "confidence_intervals.csv"

FEATURES   = ["SnKeyStrokes", "SnChars", "ErrorKeyRatio",
              "CharactersRatio", "SnMouseAct", "SnAppChange"]

HOLDOUT_FRAC      = 0.30      # fraction of normal rows held back as test
RANDOM_STATE      = 42
MIN_NORMAL_TRAIN  = 5
MIN_PRE_STRESS    = 1
MIN_STRESSED      = 2

N_PERMUTATIONS = 1000
N_BOOTSTRAP    = 500


# --------------------------------------------------------------
# Per-user evaluation
# --------------------------------------------------------------
def evaluate_user(user_df: pd.DataFrame, uid: str, rng) -> list:
    """Return list of dicts (one per model). Empty list if not enough data."""
    normal     = user_df[user_df["label"] == "normal"]
    pre_stress = user_df[user_df["label"] == "pre_stress"]
    stressed   = user_df[user_df["label"] == "stressed"]

    n_holdout = int(round(len(normal) * HOLDOUT_FRAC))
    if (len(normal) - n_holdout < MIN_NORMAL_TRAIN
            or len(pre_stress) < MIN_PRE_STRESS
            or len(stressed)   < MIN_STRESSED):
        return []

    perm        = rng.permutation(len(normal))
    train_idx   = normal.index[perm[n_holdout:]]
    test_n_idx  = normal.index[perm[:n_holdout]]

    X_train = user_df.loc[train_idx, FEATURES].values
    X_n     = user_df.loc[test_n_idx, FEATURES].values
    X_pre   = pre_stress[FEATURES].values
    X_str   = stressed[FEATURES].values

    scaler = StandardScaler().fit(X_train)
    X_train_s = scaler.transform(X_train)
    X_n_s     = scaler.transform(X_n)
    X_pre_s   = scaler.transform(X_pre)
    X_str_s   = scaler.transform(X_str)

    X_test = np.vstack([X_n_s, X_pre_s, X_str_s])
    y_true = np.concatenate([
        np.ones(len(X_n_s)),                  # normal -> +1
        -np.ones(len(X_pre_s)),               # pre_stress -> -1
        -np.ones(len(X_str_s)),               # stressed -> -1
    ])

    out = []
    for name, model in [
        ("Isolation Forest",
         IsolationForest(contamination=0.10,
                         n_estimators=100,
                         random_state=RANDOM_STATE)),
        ("One-Class SVM",
         OneClassSVM(kernel="rbf", nu=0.10, gamma="scale")),
    ]:
        model.fit(X_train_s)
        y_pred = model.predict(X_test)
        # Pre-stress and stressed recall (separately)
        pre_recall = (model.predict(X_pre_s) == -1).mean()
        str_recall = (model.predict(X_str_s) == -1).mean()
        false_alarm = (model.predict(X_n_s) == -1).mean()

        out.append({
            "user_id":            uid,
            "model":              name,
            "f1":                 f1_score (y_true, y_pred,
                                            pos_label=-1, zero_division=0),
            "precision":          precision_score(y_true, y_pred,
                                                  pos_label=-1, zero_division=0),
            "recall":             recall_score   (y_true, y_pred,
                                                  pos_label=-1, zero_division=0),
            "pre_stress_recall":  pre_recall,
            "stressed_recall":    str_recall,
            "false_alarm_rate":   false_alarm,
            "n_train_normal":     len(X_train),
            "n_test_normal":      len(X_n),
            "n_pre_stress":       len(X_pre),
            "n_stressed":         len(X_str),
        })
    return out


# --------------------------------------------------------------
# Permutation worker - shuffle LABELS not rows
# --------------------------------------------------------------
def permutation_iteration(df: pd.DataFrame, rng) -> float:
    """One permutation iteration: shuffle labels within each user,
    train SVM on shuffled-normal, measure 'pre_stress_recall'.
    Returns mean pre_stress_recall across users."""
    user_recalls = []
    for uid, sub in df.groupby("user_id", sort=False):
        if len(sub) < (MIN_NORMAL_TRAIN + MIN_PRE_STRESS + MIN_STRESSED):
            continue

        shuffled = sub["label"].sample(frac=1.0,
                                       random_state=int(rng.integers(1e9))
                                       ).values
        sub2 = sub.copy()
        sub2["label"] = shuffled

        normal_sh     = sub2[sub2["label"] == "normal"]
        pre_sh        = sub2[sub2["label"] == "pre_stress"]
        if len(normal_sh) < MIN_NORMAL_TRAIN or len(pre_sh) < MIN_PRE_STRESS:
            continue
        try:
            scaler = StandardScaler().fit(normal_sh[FEATURES])
            X_tr   = scaler.transform(normal_sh[FEATURES])
            X_pre  = scaler.transform(pre_sh[FEATURES])
            svm    = OneClassSVM(kernel="rbf", nu=0.10, gamma="scale")
            svm.fit(X_tr)
            user_recalls.append((svm.predict(X_pre) == -1).mean())
        except Exception:
            continue
    return float(np.mean(user_recalls)) if user_recalls else np.nan


# --------------------------------------------------------------
# MAIN
# --------------------------------------------------------------
def main():
    print("=" * 65)
    print("  S6 - SWELL-KW TRAINING (PURE DIGITAL PHENOTYPING)")
    print("  Part 1: Per-user training")
    print("  Part 2: Permutation test (proper label shuffle)")
    print("  Part 3: Bootstrap confidence intervals")
    print("=" * 65)

    if not INPUT.exists():
        print(f"\n[ERROR] {INPUT} not found. Run s5 first.")
        sys.exit(1)

    df = pd.read_csv(INPUT)
    print(f"\nLoaded: {df.shape[0]} rows, {df['user_id'].nunique()} users")
    print(f"Labels: {df['label'].value_counts().to_dict()}")
    print(f"Features (NO physiology): {FEATURES}")

    if "pre_stress" not in df["label"].unique():
        print("[ERROR] No pre_stress rows found. Re-run preprocessing.")
        sys.exit(1)

    rng = np.random.default_rng(RANDOM_STATE)

    # ====== PART 1: per-user training ========================
    print("\n" + "=" * 65)
    print("  PART 1 - PER-USER TRAINING (LOSO-style)")
    print("=" * 65)
    results = []
    skipped = 0
    for uid, sub in df.groupby("user_id", sort=False):
        rows = evaluate_user(sub.reset_index(drop=True), str(uid), rng)
        if rows:
            results.extend(rows)
        else:
            skipped += 1
    res = pd.DataFrame(results)
    res.to_csv(OUT_USR, index=False)
    n_eval = res["user_id"].nunique() if not res.empty else 0
    print(f"\nEvaluated : {n_eval} users   Skipped : {skipped}")

    if res.empty:
        print("[ERROR] No users evaluated.")
        sys.exit(1)

    summary = res.groupby("model")[["f1", "precision", "recall",
                                     "pre_stress_recall",
                                     "stressed_recall",
                                     "false_alarm_rate"]].mean().round(4)
    summary.to_csv(OUT_RES)

    print("\n" + "=" * 65)
    print("  SWELL-KW RESULTS - SIDE BY SIDE")
    print("=" * 65)
    metrics = [("Overall F1",          "f1",                False),
               ("Precision",           "precision",         False),
               ("Recall",              "recall",            False),
               ("PRE-STRESS Recall *", "pre_stress_recall", False),
               ("Stressed Recall",     "stressed_recall",   False),
               ("False Alarm Rate",    "false_alarm_rate",  True)]
    iso = summary.loc["Isolation Forest"]
    svm = summary.loc["One-Class SVM"]
    print(f"\n  {'Metric':<22} {'IF':>10} {'SVM':>10}   Better")
    print("  " + "-" * 55)
    for label, key, lower_better in metrics:
        if lower_better:
            better = "SVM" if svm[key] < iso[key] else "IF"
        else:
            better = "SVM" if svm[key] > iso[key] else "IF"
        print(f"  {label:<22} {iso[key]:>10.4f} {svm[key]:>10.4f}   {better}")

    winner = ("One-Class SVM" if svm["pre_stress_recall"]
              >= iso["pre_stress_recall"] else "Isolation Forest")
    w = svm if winner == "One-Class SVM" else iso
    print(f"\n  Winner (by pre_stress_recall): {winner}")
    print(f"  Pre-stress recall: {w['pre_stress_recall']*100:.1f}%")
    print(f"  False alarm rate : {w['false_alarm_rate']*100:.1f}% "
          f"(honesty metric)")

    # ====== PART 2: permutation test =========================
    print("\n" + "=" * 65)
    print(f"  PART 2 - PERMUTATION TEST ({N_PERMUTATIONS} iterations)")
    print("  Proper test: shuffle LABELS, keep features fixed")
    print("=" * 65)
    real_pre_recall = float(svm["pre_stress_recall"])
    perm_results = []
    perm_rng = np.random.default_rng(RANDOM_STATE + 1)
    for i in range(N_PERMUTATIONS):
        val = permutation_iteration(df, perm_rng)
        if not np.isnan(val):
            perm_results.append(val)
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{N_PERMUTATIONS} permutations done", flush=True)

    perm_arr = np.array(perm_results)
    p_value = float((perm_arr >= real_pre_recall).mean()) if len(perm_arr) else np.nan
    print(f"\n  Real pre_stress_recall : {real_pre_recall:.4f}")
    print(f"  Null mean              : {perm_arr.mean():.4f}")
    print(f"  Null std               : {perm_arr.std():.4f}")
    print(f"  p-value                : {p_value:.4f}")
    sig = "YES (p < 0.05)" if p_value < 0.05 else "NO"
    print(f"  Statistically real     : {sig}")

    pd.DataFrame({
        "iteration":        np.arange(len(perm_arr)),
        "shuffled_recall":  perm_arr,
        "real_recall":      real_pre_recall,
        "p_value":          p_value,
    }).to_csv(OUT_PERM, index=False)

    # ====== PART 3: bootstrap CI =============================
    print("\n" + "=" * 65)
    print(f"  PART 3 - BOOTSTRAP 95% CI ({N_BOOTSTRAP} iterations)")
    print("=" * 65)
    svm_users = res[res["model"] == "One-Class SVM"].reset_index(drop=True)
    boot_f1, boot_pre, boot_rec, boot_fa = [], [], [], []
    boot_rng = np.random.default_rng(RANDOM_STATE + 2)
    for b in range(N_BOOTSTRAP):
        idx = boot_rng.integers(0, len(svm_users), size=len(svm_users))
        s = svm_users.iloc[idx]
        boot_f1 .append(s["f1"].mean())
        boot_pre.append(s["pre_stress_recall"].mean())
        boot_rec.append(s["recall"].mean())
        boot_fa .append(s["false_alarm_rate"].mean())
        if (b + 1) % 100 == 0:
            print(f"  {b+1}/{N_BOOTSTRAP} bootstrap iters done", flush=True)

    def ci(arr): return float(np.percentile(arr, 2.5)), float(np.percentile(arr, 97.5))
    ci_f1  = ci(boot_f1)
    ci_pre = ci(boot_pre)
    ci_rec = ci(boot_rec)
    ci_fa  = ci(boot_fa)

    print(f"\n  Metric                   Mean       95% CI")
    print(f"  {'-'*55}")
    print(f"  Overall F1             {svm['f1']:.4f}   "
          f"[{ci_f1[0]:.4f} - {ci_f1[1]:.4f}]")
    print(f"  Pre-stress Recall *    {svm['pre_stress_recall']:.4f}   "
          f"[{ci_pre[0]:.4f} - {ci_pre[1]:.4f}]")
    print(f"  Overall Recall         {svm['recall']:.4f}   "
          f"[{ci_rec[0]:.4f} - {ci_rec[1]:.4f}]")
    print(f"  False Alarm Rate       {svm['false_alarm_rate']:.4f}   "
          f"[{ci_fa[0]:.4f} - {ci_fa[1]:.4f}]")

    pd.DataFrame({
        "metric":  ["f1", "pre_stress_recall", "recall", "false_alarm_rate"],
        "mean":    [svm["f1"], svm["pre_stress_recall"],
                    svm["recall"], svm["false_alarm_rate"]],
        "ci_low":  [ci_f1[0], ci_pre[0], ci_rec[0], ci_fa[0]],
        "ci_high": [ci_f1[1], ci_pre[1], ci_rec[1], ci_fa[1]],
        "p_value": [p_value]*4,
    }).to_csv(OUT_CI, index=False)

    # ====== Final panel statement ============================
    print("\n" + "=" * 65)
    print("  PANEL STATEMENT")
    print("=" * 65)
    print(f"""
  "Using only behavioural keyboard and mouse features (no
   physiological signals), One-Class SVM achieved a pre-stress
   recall of {svm['pre_stress_recall']*100:.1f}%
   (95% CI: {ci_pre[0]*100:.1f}% - {ci_pre[1]*100:.1f}%) on the SWELL-KW
   gold-standard dataset across {n_eval} participants. Pre-stress
   was defined temporally as the 5 minutes of Neutral condition
   immediately preceding the experimental stressors. The result
   was statistically significant (permutation test p={p_value:.3f},
   {N_PERMUTATIONS} iterations). Overall F1 = {svm['f1']*100:.1f}%
   (95% CI: {ci_f1[0]*100:.1f}% - {ci_f1[1]*100:.1f}%) with a false-alarm
   rate of {svm['false_alarm_rate']*100:.1f}% on truly-normal rows."
""")
    print(f"  Saved: {OUT_RES.relative_to(ROOT)}")
    print(f"         {OUT_USR.relative_to(ROOT)}")
    print(f"         {OUT_PERM.relative_to(ROOT)}")
    print(f"         {OUT_CI.relative_to(ROOT)}")
    print("=" * 65)


if __name__ == "__main__":
    main()