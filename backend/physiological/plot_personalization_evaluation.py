# ============================================================
# plot_personalization_evaluation.py -- confusion matrices, ROC
# curves and metrics comparing the STATIC (population-only) model
# against the PERSONALIZED-BASELINE model, reproducing
# physiological_signals/notebooks/06_binary_personalization_validation.ipynb
# Cell 4 exactly (same per-subject baseline normalization, same
# LOSO loop, same XGB_PARAMS) rather than a separate, possibly-
# inconsistent evaluation.
#
# IMPORTANT: the "personalized" model here is NOT the mechanism the
# deployed app actually ships (backend/physiological/predictor.py's
# personal_stress_threshold, which only shifts the DECISION
# THRESHOLD and never touches input features). This script
# reproduces a deeper, notebook-only research question -- "how much
# headroom exists if personalization went all the way down to
# renormalizing raw features and retraining" -- which is why the
# static row alone matches plot_model_evaluation.py's numbers
# (85.1% / AUC 0.9382) while the personalized row does not match
# anything currently deployed.
#
# Requires matplotlib (local analysis tool only, not added to the
# deployed backend's requirements.txt):
#   pip install matplotlib
#
# Usage (run from the repo root):
#   python -m backend.physiological.plot_personalization_evaluation
# ============================================================

import sys
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

WESAD_CSV = (Path(__file__).resolve().parents[2]
             / 'physiological_signals' / 'results' / 'objective1' / 'wesad_features_selected.csv')

# The deployed ring model (v3) decides at the Youden threshold of the pooled
# personalised LOSO predictions, saved with its metrics. The personalised
# panels below use it, so they show the numbers of the model that ships.
import json
_V3 = json.loads((WESAD_CSV.parent / 'personalised_v3_metrics.json').read_text(encoding='utf-8'))
DEPLOYED_THRESHOLD = float(_V3['at_youden']['threshold'])

# Identical to notebook 06 Cell 4 / 05_model_training.ipynb's XGB_PARAMS --
# keep these three files in sync; this script exists to VISUALIZE that
# notebook's methodology, not to define a separate one.
XGB_PARAMS = dict(
    n_estimators=300, max_depth=6, learning_rate=0.1,
    use_label_encoder=False, eval_metric='logloss',
    random_state=42, n_jobs=-1, verbosity=0,
)

# Same EDA/HRV/ACC groupings as notebook 06 Cell 1 -- EDA features are
# normalized as a ratio-to-baseline-mean (skin conductance is strictly
# positive and multiplicative in nature), HRV/ACC features as a
# baseline z-score.
EDA_FEATURES = [
    'SCL_mean', 'SCL_slope', 'SCL_std',
    'EDA_mean', 'EDA_std', 'EDA_range', 'EDA_slope',
    'SCR_count', 'SCR_amp_mean', 'SCR_width_mean',
    'EDA_q10', 'EDA_q25', 'EDA_q75', 'EDA_q90',
    'deriv1_mean', 'deriv1_std', 'deriv2_mean',
    'wavelet_approx_mean', 'wavelet_approx_energy',
    'wavelet_d1_energy', 'wavelet_d2_energy', 'wavelet_d3_energy',
]


def _compute_personal_baseline(X_person, y_person, n_baseline_windows=3):
    import numpy as np
    normal_mask = (y_person == 0)
    normal_windows = X_person[normal_mask]

    if len(normal_windows) == 0:
        baseline_mean = np.mean(X_person, axis=0)
        baseline_std = np.std(X_person, axis=0)
    else:
        baseline_windows = normal_windows[:n_baseline_windows]
        baseline_mean = np.mean(baseline_windows, axis=0)
        baseline_std = np.std(baseline_windows, axis=0)

    min_std = np.abs(baseline_mean) * 0.10
    min_std = np.where(min_std < 0.01, 0.01, min_std)
    baseline_std = np.where(baseline_std < min_std, min_std, baseline_std)
    return baseline_mean, baseline_std


def _apply_personal_normalization(X_person, baseline_mean, baseline_std, feature_cols_list):
    import numpy as np
    X_norm = X_person.copy().astype(np.float64)
    for i, feat in enumerate(feature_cols_list):
        val, mean, std = X_person[:, i], baseline_mean[i], baseline_std[i]
        if feat in EDA_FEATURES:
            X_norm[:, i] = val / mean if abs(mean) > 0.001 else val - mean
        else:
            X_norm[:, i] = (val - mean) / std
    return X_norm


def _run_personalization_loso(X, y, subjects, feature_cols):
    """Reproduces notebook 06 Cell 4's static-vs-personalized LOSO loop,
    extended (beyond the notebook) to also capture predict_proba so this
    script can plot ROC curves for both approaches -- the notebook itself
    only ever computed hard predictions via .predict()."""
    import numpy as np
    import xgboost as xgb
    from sklearn.preprocessing import StandardScaler
    from sklearn.utils.class_weight import compute_sample_weight

    unique_subjects = sorted(np.unique(subjects))
    out = {
        'static':   {'true': [], 'pred': [], 'prob': []},
        'personal': {'true': [], 'pred': [], 'prob': []},
    }
    final_personal_importances = None

    print(f'Running personalized LOSO over {len(unique_subjects)} subjects, '
          f'{len(y)} windows -- refits {len(unique_subjects)} x 2 XGBoost models, may take a moment...')

    for sid in unique_subjects:
        sid_mask = subjects == sid
        X_test, y_test = X[sid_mask], y[sid_mask]
        train_mask = ~sid_mask
        X_train_all, y_train_all, s_train_all = X[train_mask], y[train_mask], subjects[train_mask]

        # -- Static (no personalization): identical to 05_model_training.ipynb / plot_model_evaluation.py --
        scaler_s = StandardScaler()
        X_tr_s = scaler_s.fit_transform(X_train_all)
        X_te_s = scaler_s.transform(X_test)
        sw = compute_sample_weight('balanced', y_train_all)
        m_static = xgb.XGBClassifier(**XGB_PARAMS)
        m_static.fit(X_tr_s, y_train_all, sample_weight=sw)
        out['static']['true'].extend(y_test.tolist())
        out['static']['pred'].extend(m_static.predict(X_te_s).tolist())
        out['static']['prob'].extend(m_static.predict_proba(X_te_s)[:, 1].tolist())

        # -- Personalized: every subject (train AND test) renormalized by
        # their OWN baseline before the model ever sees the data --
        bm_test, bs_test = _compute_personal_baseline(X_test, y_test)
        X_test_norm = _apply_personal_normalization(X_test, bm_test, bs_test, feature_cols)

        X_train_norm_list = []
        for train_sid in np.unique(s_train_all):
            mask_tr = s_train_all == train_sid
            X_tr_subj, y_tr_subj = X_train_all[mask_tr], y_train_all[mask_tr]
            bm_tr, bs_tr = _compute_personal_baseline(X_tr_subj, y_tr_subj)
            X_train_norm_list.append(_apply_personal_normalization(X_tr_subj, bm_tr, bs_tr, feature_cols))
        X_train_norm = np.vstack(X_train_norm_list)

        scaler_p = StandardScaler()
        X_tr_p = scaler_p.fit_transform(X_train_norm)
        X_te_p = scaler_p.transform(X_test_norm)
        sw_p = compute_sample_weight('balanced', y_train_all)
        m_pers = xgb.XGBClassifier(**XGB_PARAMS)
        m_pers.fit(X_tr_p, y_train_all, sample_weight=sw_p)
        out['personal']['true'].extend(y_test.tolist())
        out['personal']['pred'].extend(m_pers.predict(X_te_p).tolist())
        out['personal']['prob'].extend(m_pers.predict_proba(X_te_p)[:, 1].tolist())

        final_personal_importances = dict(zip(feature_cols, m_pers.feature_importances_))
        print(f'  S{sid} done', flush=True)

    return out, final_personal_importances


def plot_evaluation(out_path: str, top_n_features: int = 12) -> None:
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    from sklearn.metrics import (
        confusion_matrix, roc_curve, roc_auc_score,
        accuracy_score, f1_score,
    )

    if not WESAD_CSV.exists():
        raise SystemExit(f'WESAD features CSV not found at {WESAD_CSV}')
    df = pd.read_csv(WESAD_CSV)
    feature_cols = [c for c in df.columns if c not in ('label', 'subject_id')]
    X = df[feature_cols].values
    y = df['label'].values
    subjects = df['subject_id'].values

    results, personal_importances = _run_personalization_loso(X, y, subjects, feature_cols)

    metrics = {}
    for key in ('static', 'personal'):
        t = np.array(results[key]['true'])
        p = np.array(results[key]['pred'])
        prob = np.array(results[key]['prob'])
        if key == 'personal':
            p = (prob >= DEPLOYED_THRESHOLD).astype(int)   # the deployed decision threshold
        metrics[key] = dict(
            acc=accuracy_score(t, p),
            f1_macro=f1_score(t, p, average='macro'),
            f1_normal=f1_score(t, p, labels=[0], average='macro'),
            f1_stress=f1_score(t, p, labels=[1], average='macro'),
            auc=roc_auc_score(t, prob),
            cm=confusion_matrix(t, p),
            roc=roc_curve(t, prob),
        )

    fig = plt.figure(figsize=(13, 15))
    gs = fig.add_gridspec(3, 2, hspace=0.42, wspace=0.32)
    fig.suptitle('Ring model (HRV + GSR): population model vs. personal-baseline model\n'
                 'Leave-one-subject-out, WESAD, 15 subjects, 913 windows',
                 fontweight='bold', fontsize=12)

    cm_titles = {'static': 'Confusion matrix: population model (threshold 0.50)',
                 'personal': f'Confusion matrix: personal baseline, deployed (threshold {DEPLOYED_THRESHOLD:.4f})'}
    for col, key in enumerate(('static', 'personal')):
        ax = fig.add_subplot(gs[0, col])
        cm = metrics[key]['cm']
        im = ax.imshow(cm, cmap='Blues')
        ax.set_xticks([0, 1]); ax.set_xticklabels(['Normal', 'Stress'])
        ax.set_yticks([0, 1]); ax.set_yticklabels(['Normal', 'Stress'])
        ax.set_xlabel('Predicted'); ax.set_ylabel('Actual')
        ax.set_title(cm_titles[key], fontsize=10)
        for i in range(2):
            for j in range(2):
                color = 'white' if cm[i, j] > cm.max() / 2 else 'black'
                ax.text(j, i, str(cm[i, j]), ha='center', va='center', color=color, fontweight='bold', fontsize=13)
        fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

    # -- ROC overlay --
    ax_roc = fig.add_subplot(gs[1, 0])
    colors = {'static': '#94a3b8', 'personal': '#1e293b'}
    labels = {'static': 'Population model', 'personal': 'Personal baseline (deployed)'}
    for key in ('static', 'personal'):
        fpr, tpr, _ = metrics[key]['roc']
        ax_roc.plot(fpr, tpr, color=colors[key], linewidth=2,
                    label=f"{labels[key]} (AUC = {metrics[key]['auc']:.4f})")
    ax_roc.plot([0, 1], [0, 1], color='#cbd5e1', linestyle='--', linewidth=1, label='Chance')
    ax_roc.set_xlabel('False Positive Rate'); ax_roc.set_ylabel('True Positive Rate')
    ax_roc.set_title('ROC curve', fontsize=10)
    ax_roc.legend(fontsize=9, loc='lower right')

    # -- Metrics grouped bar comparison --
    ax_bar = fig.add_subplot(gs[1, 1])
    metric_names = ['Accuracy', 'F1-macro', 'F1-Normal', 'F1-Stress']
    static_vals = [metrics['static']['acc'], metrics['static']['f1_macro'],
                   metrics['static']['f1_normal'], metrics['static']['f1_stress']]
    personal_vals = [metrics['personal']['acc'], metrics['personal']['f1_macro'],
                      metrics['personal']['f1_normal'], metrics['personal']['f1_stress']]
    x_pos = np.arange(len(metric_names))
    width = 0.35
    ax_bar.bar(x_pos - width / 2, static_vals, width, label='Population model', color='#94a3b8')
    ax_bar.bar(x_pos + width / 2, personal_vals, width, label='Personal baseline (deployed)', color='#1e293b')
    ax_bar.set_xticks(x_pos); ax_bar.set_xticklabels(metric_names, fontsize=9)
    ax_bar.set_ylim(0, 1.05)
    ax_bar.set_title('Metrics', fontsize=10)
    ax_bar.legend(fontsize=9, loc='lower left')
    for i, (sv, pv) in enumerate(zip(static_vals, personal_vals)):
        ax_bar.text(i - width / 2, sv + 0.015, f'{sv:.3f}', ha='center', fontsize=8)
        ax_bar.text(i + width / 2, pv + 0.015, f'{pv:.3f}', ha='center', fontsize=8)

    # -- Personalized model feature importance --
    ax_fi = fig.add_subplot(gs[2, 0])
    top_feats = sorted(personal_importances.items(), key=lambda kv: kv[1], reverse=True)[:top_n_features]
    names = [k for k, _ in top_feats][::-1]
    vals = [v for _, v in top_feats][::-1]
    ax_fi.barh(names, vals, color='#3b82f6')
    ax_fi.set_xlabel('XGBoost feature importance (gain-based)')
    ax_fi.set_title(f'Top {top_n_features} features: personal-baseline model', fontsize=10)
    ax_fi.tick_params(axis='y', labelsize=8)

    # -- Summary + caveat panel --
    ax_txt = fig.add_subplot(gs[2, 1])
    ax_txt.axis('off')
    lines = [
        f"{'Metric':<12}{'Population':>12}{'Personal':>12}{'Delta':>9}",
        f"{'Accuracy':<12}{metrics['static']['acc']:>12.3f}{metrics['personal']['acc']:>12.3f}"
        f"{metrics['personal']['acc'] - metrics['static']['acc']:>+9.3f}",
        f"{'F1-macro':<12}{metrics['static']['f1_macro']:>12.3f}{metrics['personal']['f1_macro']:>12.3f}"
        f"{metrics['personal']['f1_macro'] - metrics['static']['f1_macro']:>+9.3f}",
        f"{'F1-stress':<12}{metrics['static']['f1_stress']:>12.3f}{metrics['personal']['f1_stress']:>12.3f}"
        f"{metrics['personal']['f1_stress'] - metrics['static']['f1_stress']:>+9.3f}",
        f"{'AUC':<12}{metrics['static']['auc']:>12.4f}{metrics['personal']['auc']:>12.4f}"
        f"{metrics['personal']['auc'] - metrics['static']['auc']:>+9.4f}",
        "",
        "Personal baseline: each person's features are",
        "normalised by their own calm baseline (the deployed",
        "model does this live). Deployed decision threshold",
        f"{DEPLOYED_THRESHOLD:.4f}, chosen by Youden's J on these",
        "pooled predictions, so accuracy is slightly",
        "optimistic. AUC does not depend on the threshold.",
    ]
    ax_txt.text(0.02, 0.95, '\n'.join(lines), transform=ax_txt.transAxes,
                fontsize=9.5, fontfamily='monospace', va='top')
    ax_txt.set_title('Summary', fontsize=10)

    fig.savefig(out_path, dpi=150, bbox_inches='tight')
    print(f'Saved {out_path}')
    print(f"Static:      acc={metrics['static']['acc']:.3f}  F1-macro={metrics['static']['f1_macro']:.3f}  AUC={metrics['static']['auc']:.4f}")
    print(f"Personalized: acc={metrics['personal']['acc']:.3f}  F1-macro={metrics['personal']['f1_macro']:.3f}  AUC={metrics['personal']['auc']:.4f}")


def main():
    from datetime import datetime

    run_stamp = datetime.now().strftime('%Y%m%dT%H%M%S')
    out = f'physiological_personalization_evaluation_deployed_{run_stamp}.png'
    plot_evaluation(out)


if __name__ == '__main__':
    main()
