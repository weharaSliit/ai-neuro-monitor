"""
shap_analysis.py — SHAP feature-importance / explainability analysis for
the deployed StudentMLP (the model that actually produces p_emo live).

Why this exists
----------------
Clinical/healthcare reviewers expect some interpretability beyond raw
accuracy numbers — this computes per-feature SHAP values on the deployed
model's real held-out test data and reports which handcrafted EEG features
(PSD band power, differential entropy, Hjorth parameters, spectral/
connectivity extensions — see feature_extraction.py) actually drive its
stress predictions.

Method: GradientExplainer (exact for this feed-forward architecture given
differentiable ops throughout) against a background sample drawn from the
training split, explaining a sample of held-out test epochs. The fitted
StandardScaler is reimplemented as a manual affine op inside a wrapper
nn.Module so the whole pipeline (scale -> trunk -> head) stays
differentiable for SHAP.

Run:
    python3 shap_analysis.py
Outputs:
    data/unified_output/shap_report.json
    data/unified_output/reports/shap_feature_importance.png
"""

import sys
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.model_selection import GroupShuffleSplit

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "models"))

from student_model import load_student_data, StudentMLP

import __main__ as _main_mod
_main_mod.StudentMLP = StudentMLP  # pickle __main__ class-resolution fix

UNIFIED_OUTPUT_DIR = _HERE / "data" / "unified_output"
MODELS_DIR = UNIFIED_OUTPUT_DIR / "models"
REPORTS_DIR = UNIFIED_OUTPUT_DIR / "reports"

TEST_SIZE = 0.20
RANDOM_STATE = 42
N_BACKGROUND = 100
N_EXPLAIN = 300
TOP_K = 20


class _ScaledStudent(nn.Module):
    """Wraps StudentMLP with its (non-differentiable) sklearn StandardScaler
    reimplemented as a manual affine transform, so the whole thing stays
    differentiable end-to-end for SHAP's GradientExplainer."""

    def __init__(self, student: StudentMLP):
        super().__init__()
        self.student = student
        self.student.eval()
        mean = student.scaler.mean_.astype(np.float32)
        scale = student.scaler.scale_.astype(np.float32)
        self.register_buffer("mean", torch.tensor(mean))
        self.register_buffer("scale", torch.tensor(scale))

    def forward(self, x):
        x_sc = (x - self.mean) / self.scale
        _, pred = self.student._trunk_and_pred(x_sc)
        return pred.unsqueeze(1)   # (N, 1) — SHAP expects a 2D output


def main():
    print("=" * 62)
    print("  SHAP EXPLAINABILITY — deployed StudentMLP")
    print("=" * 62)

    print("\n[1] Loading student features + deployed model")
    X, y_emo, sid, source = load_student_data(use_extended=True)
    feat_names = np.load(UNIFIED_OUTPUT_DIR / "features_dataset.npz",
                          allow_pickle=True)["student_feat_names_ext"]
    feat_names = [str(f) for f in feat_names]

    gss = GroupShuffleSplit(1, test_size=TEST_SIZE, random_state=RANDOM_STATE)
    tr, te = next(gss.split(X, y_emo, groups=sid))

    student = StudentMLP.load(MODELS_DIR / "student_model.pkl")
    wrapped = _ScaledStudent(student)
    wrapped.eval()

    rng = np.random.default_rng(RANDOM_STATE)
    bg_idx = rng.choice(tr, size=min(N_BACKGROUND, len(tr)), replace=False)
    ex_idx = rng.choice(te, size=min(N_EXPLAIN, len(te)), replace=False)

    background = torch.tensor(X[bg_idx], dtype=torch.float32)
    explain_x = torch.tensor(X[ex_idx], dtype=torch.float32)
    print(f"  Background: {len(bg_idx)} train epochs   Explain set: {len(ex_idx)} test epochs")

    print("\n[2] Computing SHAP values (GradientExplainer)")
    import shap
    explainer = shap.GradientExplainer(wrapped, background)
    shap_values = explainer.shap_values(explain_x)

    # shap_values may come back as (N, F, 1) or (N, F) depending on shap version
    sv = np.asarray(shap_values)
    if sv.ndim == 3:
        sv = sv[:, :, 0]
    print(f"  SHAP values shape: {sv.shape}")

    mean_abs_shap = np.abs(sv).mean(axis=0)
    order = np.argsort(mean_abs_shap)[::-1]
    top_idx = order[:TOP_K]

    print(f"\n  Top {TOP_K} features by mean |SHAP|:")
    for rank, i in enumerate(top_idx, 1):
        print(f"  {rank:>2}. {feat_names[i]:<28} {mean_abs_shap[i]:.5f}")

    print("\n[3] Saving feature importance chart")
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(8, 7))
    y_pos = np.arange(len(top_idx))
    ax.barh(y_pos, mean_abs_shap[top_idx][::-1], color="#2f6fa8")
    ax.set_yticks(y_pos)
    ax.set_yticklabels([feat_names[i] for i in top_idx][::-1], fontsize=9)
    ax.set_xlabel("Mean |SHAP value|  (impact on p_emo)")
    ax.set_title(f"Top {TOP_K} features — deployed StudentMLP\n"
                 f"(SHAP GradientExplainer, n={len(ex_idx)} held-out epochs)")
    fig.tight_layout()
    fig_path = REPORTS_DIR / "shap_feature_importance.png"
    fig.savefig(fig_path, dpi=150, bbox_inches="tight")
    print(f"  Figure saved -> {fig_path}")

    # ── group by band / channel / feature-family for a higher-level summary ──
    def _family(name):
        if name.startswith("psd_"): return "PSD band power"
        if name.startswith("de_"): return "Differential entropy"
        if name.startswith("td_hjorth_"): return "Hjorth parameters"
        if name.startswith("td_"): return "Time-domain statistics"
        if name.startswith("rel_"): return "Relative band power"
        if name.startswith("sp_"): return "Spectral shape (centroid/SEF95/ratios)"
        if name.startswith("nl_"): return "Nonlinear/entropy/fractal dimension"
        if name.startswith(("coh_", "plv_", "pli_", "xcorr")): return "Connectivity (T7-T8)"
        return "Other"

    fam_importance = {}
    for i, name in enumerate(feat_names):
        fam = _family(name)
        fam_importance[fam] = fam_importance.get(fam, 0.0) + float(mean_abs_shap[i])
    fam_sorted = dict(sorted(fam_importance.items(), key=lambda kv: -kv[1]))

    print("\n  Importance by feature family (sum of mean |SHAP|):")
    for fam, val in fam_sorted.items():
        print(f"    {fam:<32} {val:.4f}")

    report = {
        "n_background": int(len(bg_idx)),
        "n_explained": int(len(ex_idx)),
        "top_features": [
            {"rank": r + 1, "feature": feat_names[i], "mean_abs_shap": float(mean_abs_shap[i])}
            for r, i in enumerate(top_idx)
        ],
        "family_importance": fam_sorted,
    }
    report_path = UNIFIED_OUTPUT_DIR / "shap_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Report saved -> {report_path}")


if __name__ == "__main__":
    main()
