"""Redraw Figure 6.2 (pooled LOSO evaluation) for the deployed baseline-normalised model.

Re-runs the same LOSO as physiological_signals/retrain_personalised.py (deterministic,
seed 42) and draws: confusion matrix at the Youden threshold, ROC curve, top-12 feature
importance of the final model, and summary metrics.
"""
import os
import sys

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, f1_score, roc_auc_score, roc_curve

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHYS = os.path.join(ROOT, "physiological_signals")
sys.path.insert(0, PHYS)
sys.path.insert(0, os.path.join(PHYS, "src"))
import retrain_personalised as R  # noqa: E402
from utils.config import RESULTS_PATH, MODELS_PATH  # noqa: E402

df = pd.read_csv(os.path.join(RESULTS_PATH, "objective1", "wesad_features_selected.csv"))
cols = joblib.load(os.path.join(MODELS_PATH, "feature_cols_obj1_v3.pkl"))
X, y, subj = df[cols].values, df["label"].values, df["subject_id"].values
Xn = R.normalise_all(X, y, subj, cols)

oof = np.zeros(len(y))
for s in np.unique(subj):
    te = subj == s
    m, sc = R.fit(Xn[~te], y[~te])
    oof[te] = m.predict_proba(sc.transform(Xn[te]))[:, 1]

fpr, tpr, thr = roc_curve(y, oof)
k = int(np.argmax(tpr - fpr))
T = float(thr[k])
auc = roc_auc_score(y, oof)
pred = (oof > T).astype(int)
cm = confusion_matrix(y, pred)
acc = (pred == y).mean()
f1m = f1_score(y, pred, average="macro")

final = joblib.load(os.path.join(MODELS_PATH, "best_model_obj1_v3.pkl"))
imp = final.feature_importances_
order = np.argsort(imp)[::-1][:12]

fig, ax = plt.subplots(2, 2, figsize=(10, 8.2))
fig.suptitle("Deployed ring model (baseline-normalised) -- pooled LOSO evaluation", fontweight="bold")

a = ax[0, 0]
im = a.imshow(cm, cmap="Blues")
a.set_xticks([0, 1]); a.set_xticklabels(["Normal", "Stress"])
a.set_yticks([0, 1]); a.set_yticklabels(["Normal", "Stress"])
a.set_xlabel("Predicted"); a.set_ylabel("Actual")
a.set_title(f"Confusion Matrix (pooled LOSO, threshold {T:.4f})")
for i in range(2):
    for j in range(2):
        a.text(j, i, str(cm[i, j]), ha="center", va="center", fontsize=14, fontweight="bold",
               color="white" if cm[i, j] > cm.max() / 2 else "black")
fig.colorbar(im, ax=a, fraction=0.046)

a = ax[0, 1]
a.plot(fpr, tpr, color="#1f2a44", lw=2, label=f"AUC = {auc:.4f}")
a.plot([0, 1], [0, 1], "--", color="grey", label="Chance")
a.scatter([fpr[k]], [tpr[k]], color="#d1495b", zorder=5, label=f"Youden threshold {T:.4f}")
a.set_xlabel("False Positive Rate"); a.set_ylabel("True Positive Rate")
a.set_title("ROC Curve (pooled LOSO)"); a.legend(loc="lower right")

a = ax[1, 0]
a.barh([cols[i] for i in order][::-1], imp[order][::-1], color="#3b82f6")
a.set_title("Top 12 Features (final model)")
a.set_xlabel("XGBoost feature importance (gain-based)")

a = ax[1, 1]
a.axis("off")
rec = lambda i: cm[i, i] / cm[i].sum()
prec = [cm[0, 0] / cm[:, 0].sum(), cm[1, 1] / cm[:, 1].sum()]
f1c = [2 * prec[i] * rec(i) / (prec[i] + rec(i)) for i in range(2)]
txt = (f"Accuracy:   {acc:.3f}\nF1-macro:   {f1m:.3f}\nAUC:        {auc:.4f}\n\n"
       f"Class    Precision  Recall    F1     n\n"
       f"Normal     {prec[0]:.3f}    {rec(0):.3f}  {f1c[0]:.3f}   {cm[0].sum()}\n"
       f"Stress     {prec[1]:.3f}    {rec(1):.3f}  {f1c[1]:.3f}   {cm[1].sum()}")
a.text(0.0, 0.85, txt, family="monospace", fontsize=10, va="top")
a.set_title("Summary Metrics (pooled LOSO)")

plt.tight_layout()
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figures", "fig_loso_evaluation.png")
plt.savefig(out, dpi=200)
print("saved", out, "threshold", round(T, 4), "acc", round(acc, 3), "cm", cm.tolist())
