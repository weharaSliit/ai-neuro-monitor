"""
calibration_analysis.py — ECE / Brier score / reliability diagrams for the
three probability-producing models in the pipeline (teacher ensemble,
deployed student, SpiralLSTM), before vs after their respective
calibration steps.

Why this exists
----------------
The pipeline already performs temperature scaling in two places (teacher
soft-label export, SpiralLSTM's post-hoc calibration) but never explicitly
evaluated whether that calibration actually improved anything, or reported
standard calibration metrics (ECE, Brier score) that a clinical/real-time
alerting use case needs to justify trusting the predicted probabilities.

Run:
    python3 calibration_analysis.py
Outputs:
    data/unified_output/calibration_report.json
    data/unified_output/reports/calibration_reliability.png
"""

import sys
import json
from pathlib import Path

import numpy as np
import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.model_selection import GroupShuffleSplit

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "models"))

UNIFIED_OUTPUT_DIR = _HERE / "data" / "unified_output"
MODELS_DIR = UNIFIED_OUTPUT_DIR / "models"
REPORTS_DIR = UNIFIED_OUTPUT_DIR / "reports"

N_BINS = 10
TEST_SIZE = 0.20
RANDOM_STATE = 42


def ece_and_brier(probs, y_true, n_bins=N_BINS):
    """Standard equal-width-bin Expected Calibration Error + Brier score."""
    probs = np.asarray(probs, dtype=np.float64).ravel()
    y_true = np.asarray(y_true, dtype=np.float64).ravel()
    brier = float(np.mean((probs - y_true) ** 2))

    bin_edges = np.linspace(0, 1, n_bins + 1)
    bin_ids = np.clip(np.digitize(probs, bin_edges[1:-1]), 0, n_bins - 1)
    n = len(probs)
    ece = 0.0
    bin_stats = []
    for b in range(n_bins):
        mask = bin_ids == b
        if mask.sum() == 0:
            bin_stats.append({"conf": None, "acc": None, "count": 0})
            continue
        conf = float(probs[mask].mean())
        acc = float(y_true[mask].mean())
        count = int(mask.sum())
        ece += (count / n) * abs(acc - conf)
        bin_stats.append({"conf": conf, "acc": acc, "count": count})
    return float(ece), brier, bin_stats


def plot_reliability(ax, bins_raw, bins_cal, title):
    ax.plot([0, 1], [0, 1], "--", color="#999999", lw=1, label="perfect calibration")

    def _plot(bins, color, label):
        xs = [b["conf"] for b in bins if b["conf"] is not None]
        ys = [b["acc"] for b in bins if b["conf"] is not None]
        sizes = [max(20, b["count"] / 3) for b in bins if b["conf"] is not None]
        if xs:
            ax.plot(xs, ys, color=color, lw=1.3, alpha=0.7)
            ax.scatter(xs, ys, s=sizes, color=color, alpha=0.85,
                       edgecolor="white", zorder=3, label=label)

    _plot(bins_raw, "#e74c3c", "before calibration")
    _plot(bins_cal, "#2ecc71", "after calibration")
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.set_xlabel("Mean predicted probability", fontsize=9)
    ax.set_ylabel("Observed frequency", fontsize=9)
    ax.set_title(title, fontsize=10)
    ax.legend(fontsize=7, loc="upper left")
    ax.tick_params(labelsize=8)


results = {}
fig, axes = plt.subplots(1, 3, figsize=(15, 5))

# ═══════════════════════════════════════════════════════════════════
#  1. TEACHER ENSEMBLE
# ═══════════════════════════════════════════════════════════════════
print("=" * 62)
print("  TEACHER ENSEMBLE CALIBRATION")
print("=" * 62)
from teacher_model import (
    build_teacher_ensemble, optimize_temperature, _temp_scale,
    TeacherSVM, EEGNetTeacher, CNNBiLSTMTeacher,
)
# these .pkl files were saved while their own scripts were __main__ — plain
# pickle.load can't resolve "__main__.TeacherSVM" etc from a different
# entry-point script, so register the classes under __main__ ourselves
# (same fix real_time_inference.py applies via _StudentUnpickler).
import __main__ as _main_mod
_main_mod.TeacherSVM = TeacherSVM
_main_mod.EEGNetTeacher = EEGNetTeacher
_main_mod.CNNBiLSTMTeacher = CNNBiLSTMTeacher

ensemble, (X_feat, X_raw, ye, src, sid, tr, te) = build_teacher_ensemble()
p_raw = ensemble.predict_proba(X_feat[te], X_raw[te])
T_opt, val_nll = optimize_temperature(p_raw, ye[te])
p_cal = _temp_scale(p_raw, T_opt)

ece_raw, brier_raw, bins_raw = ece_and_brier(p_raw, ye[te])
ece_cal, brier_cal, bins_cal = ece_and_brier(p_cal, ye[te])
print(f"  Raw ensemble:        ECE={ece_raw:.4f}  Brier={brier_raw:.4f}")
print(f"  Adaptively calibrated (T={T_opt:.3f}): ECE={ece_cal:.4f}  Brier={brier_cal:.4f}")

results["teacher_ensemble"] = {
    "n_test": int(len(te)),
    "raw": {"ece": ece_raw, "brier": brier_raw},
    "calibrated": {"ece": ece_cal, "brier": brier_cal, "temperature": T_opt},
}
plot_reliability(axes[0], bins_raw, bins_cal, "Teacher Ensemble")

# ═══════════════════════════════════════════════════════════════════
#  2. DEPLOYED STUDENT MLP
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 62)
print("  DEPLOYED STUDENT MLP CALIBRATION")
print("=" * 62)
from student_model import load_student_data, StudentMLP
_main_mod.StudentMLP = StudentMLP

X, y_emo, sid_s, source_s = load_student_data(use_extended=True)
gss = GroupShuffleSplit(1, test_size=TEST_SIZE, random_state=RANDOM_STATE)
tr_s, te_s = next(gss.split(X, y_emo, groups=sid_s))

model = StudentMLP.load(MODELS_DIR / "student_model.pkl")
p_raw_s = model.predict_proba(X[te_s])
T_s, _ = optimize_temperature(p_raw_s, y_emo[te_s])
p_cal_s = _temp_scale(p_raw_s, T_s)

ece_raw_s, brier_raw_s, bins_raw_s = ece_and_brier(p_raw_s, y_emo[te_s])
ece_cal_s, brier_cal_s, bins_cal_s = ece_and_brier(p_cal_s, y_emo[te_s])
print(f"  As-deployed (no post-hoc calibration): ECE={ece_raw_s:.4f}  Brier={brier_raw_s:.4f}")
print(f"  If adaptively calibrated (T={T_s:.3f}):    ECE={ece_cal_s:.4f}  Brier={brier_cal_s:.4f}")

results["student_mlp"] = {
    "n_test": int(len(te_s)),
    "as_deployed": {"ece": ece_raw_s, "brier": brier_raw_s},
    "if_calibrated": {"ece": ece_cal_s, "brier": brier_cal_s, "temperature": T_s},
}
plot_reliability(axes[1], bins_raw_s, bins_cal_s, "Deployed Student (MLP)")

# ═══════════════════════════════════════════════════════════════════
#  3. SPIRALLSTM
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 62)
print("  SPIRALLSTM CALIBRATION")
print("=" * 62)
from spiral_predictor import load_data as spiral_load_data, SpiralSequenceBuilder, SpiralLSTM, MODEL_PATH

p_emo_sp, y_emo_sp, subject_id_sp, trial_idx_sp, source_sp = spiral_load_data()
builder = SpiralSequenceBuilder()
X_seq, y_seq, groups_seq, meta = builder.build(
    p_emo_sp, y_emo_sp, subject_id_sp, trial_idx_sp, source_sp
)

ckpt = torch.load(MODEL_PATH, map_location="cpu")
spiral_model = SpiralLSTM()
spiral_model.load_state_dict(ckpt["state_dict"])
spiral_model.eval()

X_t = torch.tensor(X_seq, dtype=torch.float32)
with torch.no_grad():
    p_raw_sp = spiral_model(X_t, calibrate=False).numpy()
    p_cal_sp = spiral_model(X_t, calibrate=True).numpy()
T_sp = float(spiral_model.log_temperature.exp().clamp(0.05, 20.0).item())

ece_raw_sp, brier_raw_sp, bins_raw_sp = ece_and_brier(p_raw_sp, y_seq)
ece_cal_sp, brier_cal_sp, bins_cal_sp = ece_and_brier(p_cal_sp, y_seq)
print(f"  Raw (T=1, uncalibrated):   ECE={ece_raw_sp:.4f}  Brier={brier_raw_sp:.4f}")
print(f"  Calibrated (T={T_sp:.2f}):      ECE={ece_cal_sp:.4f}  Brier={brier_cal_sp:.4f}")

# sanity check against the cached full-dataset predictions
cache_path = UNIFIED_OUTPUT_DIR / "spiral_predictions.npz"
if cache_path.exists():
    cached = np.load(cache_path, allow_pickle=True)
    if len(cached["risk_scores"]) == len(p_cal_sp):
        max_diff = float(np.max(np.abs(cached["risk_scores"] - p_cal_sp)))
        print(f"  Sanity check vs spiral_predictions.npz: max |diff| = {max_diff:.6f}")

results["spiral_lstm"] = {
    "n_sequences": int(len(y_seq)),
    "raw": {"ece": ece_raw_sp, "brier": brier_raw_sp},
    "calibrated": {"ece": ece_cal_sp, "brier": brier_cal_sp, "temperature": T_sp},
}
plot_reliability(axes[2], bins_raw_sp, bins_cal_sp, "SpiralLSTM")

# ═══════════════════════════════════════════════════════════════════
#  SAVE
# ═══════════════════════════════════════════════════════════════════
fig.suptitle("Reliability Diagrams — Before vs After Calibration", fontsize=12)
fig.tight_layout(rect=[0, 0, 1, 0.94])
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
fig_path = REPORTS_DIR / "calibration_reliability.png"
fig.savefig(fig_path, dpi=150, bbox_inches="tight")
print(f"\n  Figure saved -> {fig_path}")

report_path = UNIFIED_OUTPUT_DIR / "calibration_report.json"
with open(report_path, "w") as f:
    json.dump(results, f, indent=2)
print(f"  Report saved -> {report_path}")

print("\n" + "=" * 62)
print("  SUMMARY")
print("=" * 62)
for name, r in results.items():
    before = r.get("raw") or r.get("as_deployed")
    after = r.get("calibrated") or r.get("if_calibrated")
    print(f"  {name:<18} ECE {before['ece']:.4f} -> {after['ece']:.4f}   "
          f"Brier {before['brier']:.4f} -> {after['brier']:.4f}")
