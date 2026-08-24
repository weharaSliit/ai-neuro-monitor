# phenotyping/research_v4_swell/src/s2_swell_trainer.py
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import recall_score, f1_score

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "processed" / "swell_v4_processed.csv"

def run_personalized_test():
    print("🧠 [S2] SWELL Training V4 - Personalized Comparison...")
    df = pd.read_csv(DATA)
    features = ["SnKeyStrokes", "SnChars", "ErrorKeyRatio", "CharactersRatio", "SnMouseAct", "SnAppChange"]
    
    user_results = []
    for uid, u_df in df.groupby("PP"):
        # Personal Scaler
        scaler = StandardScaler()
        X = scaler.fit_transform(u_df[features])
        y = u_df["label"].values

        # Split: Train models only on THIS user's 'normal' data
        X_train = X[y == "normal"]
        if len(X_train) < 5: continue # Skip users with no baseline

        # Test on the rest (Pre-Stress and Stressed)
        X_test = X[y != "normal"]
        y_test = np.where(u_df[y != "normal"]["label"] == "pre_stress", -1, -1) # Treat any stress as anomaly

        # 1. One-Class SVM (The Research Choice)
        ocsvm = OneClassSVM(kernel='rbf', nu=0.1).fit(X_train)
        
        # 2. Isolation Forest
        iso = IsolationForest(contamination=0.1, random_state=42).fit(X_train)
        
        # Calculate F1 and Recall for anomalies (Escalation)
        ocsvm_preds = ocsvm.predict(X_test)
        iso_preds = iso.predict(X_test)
        
        user_results.append({
            "User": uid,
            "OC-SVM F1": f1_score(y_test, ocsvm_preds, pos_label=-1),
            "OC-SVM Recall": recall_score(y_test, ocsvm_preds, pos_label=-1),
            "IF F1": f1_score(y_test, iso_preds, pos_label=-1),
            "IF Recall": recall_score(y_test, iso_preds, pos_label=-1)
        })

    res_df = pd.DataFrame(user_results)
    
    # Save results for cross-dataset synthesis (s1_metric_aggregator.py)
    out_dir = ROOT / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    res_df.to_csv(out_dir / "swell_results.csv", index=False)
    
    print("\n🏆 PERSONALIZED RESULTS (MEAN ACROSS USERS)")
    print("==========================================")
    print(res_df[["OC-SVM F1", "OC-SVM Recall", "IF F1", "IF Recall"]].mean())
    print(f"\n📊 Results saved to outputs/swell_results.csv")

if __name__ == "__main__": run_personalized_test()