# phenotyping/research_v4_swell/src/s2_swell_trainer.py
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import recall_score, f1_score, precision_score

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "processed" / "swell_v4_processed.csv"

def run_personalized_test():
    print("🧠 [S2] SWELL Training V4 - Personalized Comparison...")
    df = pd.read_csv(DATA)
    features = ["SnKeyStrokes", "SnChars", "ErrorKeyRatio", "CharactersRatio", "SnMouseAct", "SnAppChange"]
    rng = np.random.RandomState(42)

    user_results = []
    for uid, u_df in df.groupby("PP"):
        # Personal Scaler
        scaler = StandardScaler()
        X = scaler.fit_transform(u_df[features])
        y = u_df["label"].values

        normal_idx = np.where(y == "normal")[0]
        stress_idx = np.where(y != "normal")[0]
        if len(normal_idx) < 5 or len(stress_idx) < 1:
            continue # Skip users without enough baseline or stress data

        # --- FIX: hold out real negatives ---
        # PREVIOUSLY: ALL of a user's "normal" rows went into training, and
        # X_test = X[y != "normal"] meant the test set contained ONLY
        # pre_stress/stressed rows — zero true "normal" examples. With every
        # ground-truth test label forced to -1 (anomaly), a false positive
        # was structurally impossible to record: precision was trivially
        # ~1.0 whenever the model flagged anything, so the reported "F1"
        # collapsed into a disguised, inflated function of recall alone. For
        # a pre-stress ALERTING system, the false-alarm rate is one of the
        # most important things to measure, and this setup could never
        # measure it.
        #
        # Fix: split "normal" rows 80/20. Train only on the 80%. The held-out
        # 20% of normal rows join the test set alongside every stress row,
        # so a false alarm on a genuinely calm moment can finally be counted.
        rng.shuffle(normal_idx)
        split = int(len(normal_idx) * 0.8)
        train_idx = normal_idx[:split]
        test_normal_idx = normal_idx[split:]
        if len(train_idx) < 5:
            continue

        X_train = X[train_idx]
        test_idx = np.concatenate([test_normal_idx, stress_idx])
        X_test = X[test_idx]
        # True labels: +1 for held-out normal rows, -1 for any stress row
        y_test = np.where(np.isin(test_idx, stress_idx), -1, 1)

        # 1. One-Class SVM (The Research Choice)
        ocsvm = OneClassSVM(kernel='rbf', nu=0.1).fit(X_train)

        # 2. Isolation Forest
        iso = IsolationForest(contamination=0.1, random_state=42).fit(X_train)

        # Calculate F1, Precision and Recall for anomalies (Escalation) —
        # precision is now meaningful because true negatives exist in y_test
        ocsvm_preds = ocsvm.predict(X_test)
        iso_preds = iso.predict(X_test)

        user_results.append({
            "User": uid,
            "OC-SVM F1": f1_score(y_test, ocsvm_preds, pos_label=-1, zero_division=0),
            "OC-SVM Precision": precision_score(y_test, ocsvm_preds, pos_label=-1, zero_division=0),
            "OC-SVM Recall": recall_score(y_test, ocsvm_preds, pos_label=-1, zero_division=0),
            "IF F1": f1_score(y_test, iso_preds, pos_label=-1, zero_division=0),
            "IF Precision": precision_score(y_test, iso_preds, pos_label=-1, zero_division=0),
            "IF Recall": recall_score(y_test, iso_preds, pos_label=-1, zero_division=0),
            "test_normal_n": len(test_normal_idx),
            "test_stress_n": len(stress_idx),
        })

    res_df = pd.DataFrame(user_results)

    # Save results for cross-dataset synthesis (s1_metric_aggregator.py)
    out_dir = ROOT / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    res_df.to_csv(out_dir / "swell_results.csv", index=False)

    print("\n🏆 PERSONALIZED RESULTS (MEAN ACROSS USERS, held-out negatives included)")
    print("==========================================")
    print(res_df[["OC-SVM F1", "OC-SVM Precision", "OC-SVM Recall",
                   "IF F1", "IF Precision", "IF Recall"]].mean())
    print(f"\n📊 Results saved to outputs/swell_results.csv")

if __name__ == "__main__": run_personalized_test()
