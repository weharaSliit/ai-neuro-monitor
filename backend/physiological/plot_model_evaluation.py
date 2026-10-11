# ============================================================
# plot_model_evaluation.py -- confusion matrix, ROC curve, feature
# importance, and summary metrics for the DEPLOYED physiological
# (Ring) XGBoost model.
#
# Reuses the EXACT same methodology as physiological_signals/notebooks/
# 05_model_training.ipynb (same XGB_PARAMS, same leave-one-subject-out
# cross-validation over the same wesad_features_selected.csv) rather
# than a separate, possibly-inconsistent evaluation -- these numbers
# should match what that notebook already reports (85.1% accuracy,
# AUC 0.9382), not a new estimate.
#
# Requires matplotlib (local analysis tool only, not added to the
# deployed backend's requirements.txt):
#   pip install matplotlib
#
# Usage (run from the repo root):
#   python -m backend.physiological.plot_model_evaluation
# ============================================================

import sys
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

WESAD_CSV = (Path(__file__).resolve().parents[2]
             / 'physiological_signals' / 'results' / 'objective1' / 'wesad_features_selected.csv')

# Identical to 05_model_training.ipynb's XGB_PARAMS -- keep these two in
# sync; this script exists to VISUALIZE that notebook's methodology, not
# to define a separate one.
XGB_PARAMS = dict(
    n_estimators=300, max_depth=6, learning_rate=0.1,
    use_label_encoder=False, eval_metric='logloss',
    random_state=42, n_jobs=-1, verbosity=0,
)


def _run_loso(X, y, subjects, feature_cols):
    """Same loop as 05_model_training.ipynb Cells 2 + 2.5, but returning
    both hard predictions (for the confusion matrix / accuracy / F1) and
    predicted probabilities (for the ROC curve) from ONE pass, plus the
    final full-data model + its feature importances (matching Cell 3)."""
    import numpy as np
    import xgboost as xgb
    from sklearn.preprocessing import StandardScaler
    from sklearn.utils.class_weight import compute_sample_weight

    unique_subjects = sorted(np.unique(subjects))
    all_true, all_pred, all_prob = [], [], []

    for sid in unique_subjects:
        test_mask, train_mask = subjects == sid, subjects != sid
        X_train, y_train = X[train_mask], y[train_mask]
        X_test, y_test = X[test_mask], y[test_mask]

        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X_train)
        X_test_s = scaler.transform(X_test)

        sample_weights = compute_sample_weight('balanced', y_train)
        model = xgb.XGBClassifier(**XGB_PARAMS)
        model.fit(X_train_s, y_train, sample_weight=sample_weights)

        all_true.extend(y_test.tolist())
        all_pred.extend(model.predict(X_test_s).tolist())
        all_prob.extend(model.predict_proba(X_test_s)[:, 1].tolist())

    # Final model on ALL data (matches Cell 3 -- the one actually deployed),
    # used here only for its feature_importances_.
    scaler_final = StandardScaler()
    X_scaled = scaler_final.fit_transform(X)
    sample_weights = compute_sample_weight('balanced', y)
    final_model = xgb.XGBClassifier(**XGB_PARAMS)
    final_model.fit(X_scaled, y, sample_weight=sample_weights)
    importances = dict(zip(feature_cols, final_model.feature_importances_))

    return (np.array(all_true), np.array(all_pred), np.array(all_prob), importances)


def plot_evaluation(out_path: str, top_n_features: int = 12) -> None:
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    from sklearn.metrics import (
        confusion_matrix, roc_curve, roc_auc_score,
        accuracy_score, precision_recall_fscore_support, f1_score,
    )

    if not WESAD_CSV.exists():
        raise SystemExit(f'WESAD features CSV not found at {WESAD_CSV}')
    df = pd.read_csv(WESAD_CSV)
    feature_cols = [c for c in df.columns if c not in ('label', 'subject_id')]
    X = df[feature_cols].values
    y = df['label'].values
    subjects = df['subject_id'].values

    print(f'Running LOSO cross-validation over {len(np.unique(subjects))} subjects, '
          f'{len(y)} windows -- this refits {len(np.unique(subjects))} + 1 XGBoost models, may take a moment...')
    y_true, y_pred, y_prob, importances = _run_loso(X, y, subjects, feature_cols)

    acc = accuracy_score(y_true, y_pred)
    precision, recall, f1, support = precision_recall_fscore_support(y_true, y_pred, labels=[0, 1])
    f1_macro = f1_score(y_true, y_pred, average='macro')
    auc = roc_auc_score(y_true, y_prob)
    cm = confusion_matrix(y_true, y_pred)
    fpr, tpr, _ = roc_curve(y_true, y_prob)

    fig, axes = plt.subplots(2, 2, figsize=(11, 9))
    fig.suptitle('Physiological (Ring) model -- pooled LOSO evaluation, matching 05_model_training.ipynb',
                 fontweight='bold', fontsize=11)

    # -- Confusion matrix --
    ax_cm = axes[0][0]
    im = ax_cm.imshow(cm, cmap='Blues')
    ax_cm.set_xticks([0, 1]); ax_cm.set_xticklabels(['Normal', 'Stress'])
    ax_cm.set_yticks([0, 1]); ax_cm.set_yticklabels(['Normal', 'Stress'])
    ax_cm.set_xlabel('Predicted'); ax_cm.set_ylabel('Actual')
    ax_cm.set_title('Confusion Matrix (pooled LOSO)', fontsize=10)
    for i in range(2):
        for j in range(2):
            color = 'white' if cm[i, j] > cm.max() / 2 else 'black'
            ax_cm.text(j, i, str(cm[i, j]), ha='center', va='center', color=color, fontweight='bold', fontsize=13)
    fig.colorbar(im, ax=ax_cm, fraction=0.046, pad=0.04)

    # -- ROC curve --
    ax_roc = axes[0][1]
    ax_roc.plot(fpr, tpr, color='#1e293b', linewidth=2, label=f'AUC = {auc:.4f}')
    ax_roc.plot([0, 1], [0, 1], color='#9ca3af', linestyle='--', linewidth=1, label='Chance')
    ax_roc.set_xlabel('False Positive Rate'); ax_roc.set_ylabel('True Positive Rate')
    ax_roc.set_title('ROC Curve (pooled LOSO)', fontsize=10)
    ax_roc.legend(fontsize=9, loc='lower right')

    # -- Feature importance --
    ax_fi = axes[1][0]
    top_feats = sorted(importances.items(), key=lambda kv: kv[1], reverse=True)[:top_n_features]
    names = [k for k, _ in top_feats][::-1]
    vals = [v for _, v in top_feats][::-1]
    ax_fi.barh(names, vals, color='#3b82f6')
    ax_fi.set_xlabel('XGBoost feature importance (gain-based)')
    ax_fi.set_title(f'Top {top_n_features} Features (final model)', fontsize=10)
    ax_fi.tick_params(axis='y', labelsize=8)

    # -- Metrics summary panel --
    ax_txt = axes[1][1]
    ax_txt.axis('off')
    lines = [
        f"Accuracy:        {acc:.3f}",
        f"F1-macro:        {f1_macro:.3f}",
        f"AUC:             {auc:.4f}",
        "",
        f"{'Class':<8}{'Precision':>10}{'Recall':>9}{'F1':>7}{'n':>6}",
        f"{'Normal':<8}{precision[0]:>10.3f}{recall[0]:>9.3f}{f1[0]:>7.3f}{support[0]:>6d}",
        f"{'Stress':<8}{precision[1]:>10.3f}{recall[1]:>9.3f}{f1[1]:>7.3f}{support[1]:>6d}",
    ]
    ax_txt.text(0.02, 0.95, '\n'.join(lines), transform=ax_txt.transAxes,
                fontsize=11, fontfamily='monospace', va='top')
    ax_txt.set_title('Summary Metrics (pooled LOSO)', fontsize=10)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')
    print(f'Accuracy={acc:.3f}  F1-macro={f1_macro:.3f}  AUC={auc:.4f}')


def main():
    from datetime import datetime

    run_stamp = datetime.now().strftime('%Y%m%dT%H%M%S')
    out = f'physiological_model_evaluation_{run_stamp}.png'
    plot_evaluation(out)


if __name__ == '__main__':
    main()
