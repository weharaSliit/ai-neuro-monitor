# s2_cmu_train.py
# ─────────────────────────────────────────────────────────
# PURPOSE: Train and compare IF vs One-Class SVM on CMU data
# What this proves: Personalized typing baseline anomaly detection
# Literature: Idiographic ML 2023, Online Anomaly Detection 2022
# ─────────────────────────────────────────────────────────
import pandas as pd
import numpy as np
import joblib  # Added for model saving
from sklearn.svm import OneClassSVM
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score, precision_score, recall_score
import warnings, os

warnings.filterwarnings("ignore")

# Ensure the models directory exists for Objective 3 
os.makedirs("../outputs/models", exist_ok=True)

PROCESSED = "../data/processed/cmu_processed.csv"

print("=" * 60)
print("  S2 — CMU MODEL TRAINING: IF vs One-Class SVM")
print("  BOTH models trained on SAME data, SAME splits")
print("=" * 60)

if not os.path.exists(PROCESSED):
    print(f"❌ Error: {PROCESSED} not found. Run s1_cmu_preprocess.py first.")
    exit()

df = pd.read_csv(PROCESSED)
print(f"Loaded: {df.shape}")

EXCLUDE   = ["user_id"]
feat_cols = [c for c in df.columns if c not in EXCLUDE
             and df[c].dtype in [float, int, np.float64, np.int64]]
print(f"Features: {len(feat_cols)}")
print(f"Users:    {df['user_id'].nunique()}")

# ── EVALUATION FUNCTION ───────────────────────────────────────
def evaluate(name, y_true, y_pred):
    f1  = f1_score(y_true, y_pred, pos_label=-1, zero_division=0)
    pre = precision_score(y_true, y_pred, pos_label=-1, zero_division=0)
    rec = recall_score(y_true, y_pred, pos_label=-1, zero_division=0)
    return {"model": name, "f1": round(f1,4),
            "precision": round(pre,4), "recall": round(rec,4)}

# ── PERSONALIZATION LOGIC ─────────────────────────────────────
print("\nMethod: First 200 rows per user = personal baseline")
print("        Test: own remaining rows (normal) vs other users (anomaly)")

y_true_if, y_pred_if   = [], []
y_true_svm, y_pred_svm = [], []
trained = 0

all_users = df["user_id"].unique()
for uid in all_users:
    user_data  = df[df["user_id"] == uid][feat_cols].values
    other_data = df[df["user_id"] != uid][feat_cols].values

    if len(user_data) < 220:
        continue

    train       = user_data[:200]
    test_own    = user_data[200:]
    test_other  = other_data[:min(200, len(other_data))]

    scaler        = StandardScaler()
    train_sc      = scaler.fit_transform(train)
    test_own_sc   = scaler.transform(test_own)
    test_other_sc = scaler.transform(test_other)

    X_test = np.vstack([test_own_sc, test_other_sc])
    y_true = [1]*len(test_own_sc) + [-1]*len(test_other_sc)

    # ── ISOLATION FOREST ──────────────────────────────────────
    iso = IsolationForest(contamination=0.1, n_estimators=100, random_state=42)
    iso.fit(train_sc)
    y_true_if.extend(y_true)
    y_pred_if.extend(iso.predict(X_test))

    # ── ONE-CLASS SVM ─────────────────────────────────────────
    svm = OneClassSVM(kernel="rbf", nu=0.1, gamma="scale")
    svm.fit(train_sc)
    y_true_svm.extend(y_true)
    y_pred_svm.extend(svm.predict(X_test))

    trained += 1

print(f"\nTrained on {trained} users")

# ── COMPARE BOTH MODELS ───────────────────────────────────────
r_if  = evaluate("Isolation Forest", y_true_if,  y_pred_if)
r_svm = evaluate("One-Class SVM",    y_true_svm, y_pred_svm)
r_if["dataset"]  = "CMU"
r_svm["dataset"] = "CMU"

print(f"\n{'='*55}")
print(f"  CMU RESULTS — SIDE BY SIDE COMPARISON")
print(f"{'='*55}")
print(f"  {'Model':<22} {'F1':>7} {'Precision':>11} {'Recall':>9}")
print(f"  {'─'*52}")
for r in [r_if, r_svm]:
    marker = "← WINNER" if r["f1"] == max(r_if["f1"], r_svm["f1"]) else ""
    print(f"  {r['model']:<22} {r['f1']:>7.4f} {r['precision']:>11.4f}"
          f" {r['recall']:>9.4f}  {marker}")

# ── SAVE THE DEPLOYMENT MODEL (OBJECTIVE 3) ───────────────────
# We train a final model for user 's002' to use in our Backend [cite: 70, 71]
target_user = 's002' 
if target_user in df['user_id'].values:
    print(f"\n[Objective 3] Training final deployment model for {target_user}...")
    user_data = df[df['user_id'] == target_user][feat_cols].values
    train_final = user_data[:200]
    
    scaler_final = StandardScaler()
    train_sc_final = scaler_final.fit_transform(train_final)
    
    # Use the winning model: One-Class SVM [cite: 35]
    final_model = OneClassSVM(kernel="rbf", nu=0.1, gamma="scale")
    final_model.fit(train_sc_final)
    
    # Save the model and the scaler for the backend to use 
    model_save_path = "../outputs/models/behavior_svm_s002.joblib"
    joblib.dump(final_model, model_save_path)
    print(f"✅ Model saved to: {model_save_path}")

pd.DataFrame([r_if, r_svm]).to_csv("../outputs/cmu_results.csv", index=False)
print("\n✅ Results saved: ../outputs/cmu_results.csv")
print("Next: python s3_emosurv_preprocess.py")