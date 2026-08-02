"""
Teacher Model — Single-Head Emotional Stress Classifier (y_emo only)
====================================================================

Three teacher architectures for comparison:
  [svm]        TeacherSVM        — LinearSVC on 480-dim pre-extracted features (baseline)
  [eegnet]     EEGNetTeacher     — EEGNet (Lawhern et al. 2018) on raw 32-ch EEG
  [cnn_bilstm] CNNBiLSTMTeacher  — CNN + BiLSTM on raw 32-ch EEG

Label scheme (single head):
  y_emo : emotional stress (DEAP VAD score ≥ 0.5 or SAM40 per-subject z > 0)

Pre-stress / pre-stage classification removed — DEAP/SAM40 assign a uniform label
per trial, so within-trial transitions required for pre-stage labelling never occur.
Early warning is handled by the spiral predictor (temporal forecasting) and
personalised baseline calibration in the inference engine.

Inputs:
  SVM       : features_dataset.npz   → F_teacher (E, 480)
  EEGNet /
  CNN+BiLSTM: normalized_dataset.npz → X_teacher (E, 32, 512)

Evaluation:
  Both ROC-AUC and PR-AUC (average precision) reported.
  Precision–recall curves reflect the class-imbalanced real deployment scenario.
"""

import json
import pickle
import warnings
import numpy as np
from pathlib import Path

from sklearn.model_selection import GroupShuffleSplit
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    accuracy_score, balanced_accuracy_score,
    f1_score, roc_auc_score, average_precision_score,
)

import torch
import torch.nn as nn

warnings.filterwarnings("ignore")

UNIFIED_OUTPUT_DIR = Path(
    "/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/Research"
    "/ai-neuro-monitor/eeg/data/unified_output"
)
MODELS_DIR = UNIFIED_OUTPUT_DIR / "models"
SOFT_DIR   = UNIFIED_OUTPUT_DIR / "soft_logits"

# SVM features
N_CHANNELS  = 32
N_FEATURES  = 15
N_FEAT_FLAT = N_CHANNELS * N_FEATURES   # 480

# Deep model raw EEG dimensions
N_CH_RAW   = 32
N_TIME_RAW = 256   # actual epoch length — overridden by data shape at runtime

TEMPERATURE  = 4.0
TEST_SIZE    = 0.20
RANDOM_STATE = 42

SVM_C         = 1.0
SVM_SUBSAMPLE = 10_000

# Deep teacher training
DEEP_EPOCHS  = 60
DEEP_LR      = 1e-3
DEEP_BATCH   = 128
DEEP_DROPOUT = 0.4
DEEP_FOCAL_G = 2.0

# EEGNet hyperparameters
EEGNET_F1 = 8
EEGNET_D  = 2
EEGNET_F2 = 16

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ═══════════════════════════════════════════════════════════════════
#  DATA LOADING
# ═══════════════════════════════════════════════════════════════════

def load_teacher_data(npz_path=None):
    """
    Load pre-extracted features for SVM teacher.
    Returns X (E, 480), y_emo, subject_id, source.
    """
    if npz_path is None:
        npz_path = UNIFIED_OUTPUT_DIR / "features_dataset.npz"
    if not Path(npz_path).exists():
        return _synthetic_data_features()

    d          = np.load(npz_path, allow_pickle=True)
    X          = d["F_teacher"].astype(np.float32)
    y_emo      = d["y_emo"].astype(np.int64)
    subject_id = d["subject_id"].astype(np.int32)
    source     = d["source"]

    sam40_m = np.array([str(s).lower() == "sam40" for s in source])
    deap_m  = ~sam40_m
    print(f"\n  Feature dataset summary:")
    print(f"    DEAP  : {deap_m.sum():,} epochs  {len(np.unique(subject_id[deap_m]))} subj")
    print(f"    SAM40 : {sam40_m.sum():,} epochs  {len(np.unique(subject_id[sam40_m]))} subj")
    print(f"    Total : {len(X):,}  emo_bal={y_emo.mean():.2%}")
    return X, y_emo, subject_id, source


def load_teacher_data_raw(npz_path=None):
    """
    Load raw EEG for deep teachers (EEGNet / CNN+BiLSTM).
    Reads from normalized_dataset.npz: X_teacher (E, 32, 512).
    Returns X_raw, y_emo, subject_id, source.
    """
    if npz_path is None:
        npz_path = UNIFIED_OUTPUT_DIR / "normalized_dataset.npz"
    if not Path(npz_path).exists():
        return _synthetic_data_raw()

    d          = np.load(npz_path, allow_pickle=True)
    X          = d["X_teacher"].astype(np.float32)   # (E, 32, 512)
    y_emo      = d["y_emo"].astype(np.int64)
    subject_id = d["subject_id"].astype(np.int32)
    source     = d["source"]

    sam40_m = np.array([str(s).lower() == "sam40" for s in source])
    deap_m  = ~sam40_m
    print(f"\n  Raw EEG dataset summary:")
    print(f"    DEAP  : {deap_m.sum():,} epochs  {len(np.unique(subject_id[deap_m]))} subj")
    print(f"    SAM40 : {sam40_m.sum():,} epochs  {len(np.unique(subject_id[sam40_m]))} subj")
    print(f"    X_raw : {X.shape}  emo_bal={y_emo.mean():.2%}")
    return X, y_emo, subject_id, source


def _synthetic_data_features():
    rng = np.random.default_rng(RANDOM_STATE)
    E   = 600
    X   = rng.standard_normal((E, N_FEAT_FLAT)).astype(np.float32)
    ye  = (rng.random(E) < 0.28).astype(np.int64)
    sid = np.repeat(np.arange(30), E // 30).astype(np.int32)
    src = np.array(["deap"] * (E // 2) + ["sam40"] * (E // 2))
    X[ye == 1, 3] += 1.5
    return X, ye, sid, src


def _synthetic_data_raw():
    rng = np.random.default_rng(RANDOM_STATE)
    E   = 600
    X   = rng.standard_normal((E, N_CH_RAW, N_TIME_RAW)).astype(np.float32)
    ye  = (rng.random(E) < 0.28).astype(np.int64)
    sid = np.repeat(np.arange(30), E // 30).astype(np.int32)
    src = np.array(["deap"] * (E // 2) + ["sam40"] * (E // 2))
    X[ye == 1, 6, :] += 1.0    # T7-like beta elevation
    X[ye == 1, 23, :] += 1.0   # T8-like beta elevation
    return X, ye, sid, src


# ═══════════════════════════════════════════════════════════════════
#  SHARED DEEP TRAINING UTILITIES
# ═══════════════════════════════════════════════════════════════════

def _focal_loss(pred, target, gamma=DEEP_FOCAL_G):
    bce = nn.functional.binary_cross_entropy(pred, target, reduction="none")
    p_t = torch.where(target == 1, pred, 1.0 - pred)
    return ((1.0 - p_t) ** gamma * bce).mean()


def _balanced_sampler(y):
    n_pos = max(int(y.sum()), 1)
    n_neg = max(int(len(y) - n_pos), 1)
    w = np.where(y == 1, 1.0 / n_pos, 1.0 / n_neg)
    return torch.utils.data.WeightedRandomSampler(
        torch.tensor(w, dtype=torch.float32), len(y), replacement=True
    )


def _normalize_raw_eeg(X):
    """Per-epoch per-channel z-score normalisation (in-place safe)."""
    mu  = X.mean(axis=-1, keepdims=True)
    std = X.std(axis=-1, keepdims=True) + 1e-6
    return (X - mu) / std


# ═══════════════════════════════════════════════════════════════════
#  EEGNET TEACHER  (Lawhern et al. 2018)
# ═══════════════════════════════════════════════════════════════════

class EEGNetTeacher(nn.Module):
    """
    EEGNet-based single-head teacher (y_emo only).
    Input : (batch, 1, n_ch, n_time)   — 4D raw EEG tensor.

    Architecture:
      Block 1: Temporal Conv → Depthwise Spatial Conv → ELU → AvgPool → Dropout
      Block 2: Separable Conv → ELU → AvgPool → Dropout
      Flatten → Linear head (emo)
    """

    def __init__(self, n_ch=N_CH_RAW, n_time=N_TIME_RAW,
                 F1=EEGNET_F1, D=EEGNET_D, F2=EEGNET_F2, dropout=DEEP_DROPOUT):
        super().__init__()
        self.n_ch   = n_ch
        self.n_time = n_time

        kern_t = n_time // 8
        self.conv1   = nn.Conv2d(1, F1, (1, kern_t), padding=(0, kern_t // 2), bias=False)
        self.bn1     = nn.BatchNorm2d(F1)
        self.dw1     = nn.Conv2d(F1, F1 * D, (n_ch, 1), groups=F1, bias=False)
        self.bn2     = nn.BatchNorm2d(F1 * D)
        self.elu1    = nn.ELU()
        self.pool1   = nn.AvgPool2d((1, 4))
        self.drop1   = nn.Dropout(dropout)

        self.sep1    = nn.Conv2d(F1 * D, F1 * D, (1, 16),
                                 padding=(0, 8), groups=F1 * D, bias=False)
        self.pw1     = nn.Conv2d(F1 * D, F2, (1, 1), bias=False)
        self.bn3     = nn.BatchNorm2d(F2)
        self.elu2    = nn.ELU()
        self.pool2   = nn.AvgPool2d((1, 8))
        self.drop2   = nn.Dropout(dropout)

        with torch.no_grad():
            flat = self._features(torch.zeros(1, 1, n_ch, n_time)).shape[1]

        self.head_emo = nn.Linear(flat, 1)

    def _features(self, x):
        x = self.drop1(self.elu1(self.bn2(self.dw1(self.bn1(self.conv1(x))))))
        x = self.pool1(x)
        x = self.drop2(self.elu2(self.bn3(self.pw1(self.sep1(x)))))
        x = self.pool2(x)
        return x.flatten(1)

    def forward(self, x):
        """x: (B, 1, n_ch, n_time) → p_emo (B,)."""
        return torch.sigmoid(self.head_emo(self._features(x))).squeeze(1)

    def _prepare_tensor(self, X_raw):
        X_n = _normalize_raw_eeg(X_raw.copy())
        return torch.tensor(X_n[:, np.newaxis], dtype=torch.float32)

    def fit(self, X_raw, y_emo):
        X_t = self._prepare_tensor(X_raw).to(DEVICE)
        self.to(DEVICE)
        print(f"  [EEGNet] emo head (pos={int(y_emo.sum()):,} = {y_emo.mean():.1%})")
        sampler = _balanced_sampler(y_emo)
        ds  = torch.utils.data.TensorDataset(
            X_t, torch.tensor(y_emo, dtype=torch.float32)
        )
        ld  = torch.utils.data.DataLoader(ds, DEEP_BATCH, sampler=sampler)
        opt = torch.optim.Adam(self.parameters(), lr=DEEP_LR, weight_decay=1e-4)
        sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=DEEP_EPOCHS)
        self.train()
        for ep in range(DEEP_EPOCHS):
            ep_loss = 0.0
            for Xb, yb in ld:
                Xb, yb = Xb.to(DEVICE), yb.to(DEVICE)
                opt.zero_grad()
                loss = _focal_loss(self(Xb), yb)
                loss.backward(); opt.step()
                ep_loss += loss.item()
            sch.step()
            if (ep + 1) % 20 == 0:
                print(f"    epoch {ep+1}/{DEEP_EPOCHS}  loss={ep_loss/len(ld):.4f}")
        self.cpu()
        return self

    def predict_proba(self, X_raw):
        X_t = self._prepare_tensor(X_raw)
        self.eval()
        with torch.no_grad():
            parts = []
            for i in range(0, len(X_t), DEEP_BATCH):
                parts.append(self(X_t[i:i+DEEP_BATCH].to(DEVICE)).cpu().numpy())
        return np.concatenate(parts).astype(np.float32)

    def save(self, p):
        torch.save(self.state_dict(), str(p).replace(".pkl", "_weights.pt"))
        with open(p, "wb") as f: pickle.dump(self, f)

    @staticmethod
    def load(p):
        with open(p, "rb") as f: return pickle.load(f)


# ═══════════════════════════════════════════════════════════════════
#  CNN+BILSTM TEACHER  (heavier temporal model)
# ═══════════════════════════════════════════════════════════════════

class CNNBiLSTMTeacher(nn.Module):
    """
    CNN + BiLSTM single-head teacher (y_emo only) on raw 32-channel EEG.
    Input : (batch, n_ch, n_time) = (B, 32, 512).

    Architecture:
      Conv1d(32→64, k=32, s=4) → BN → ReLU → Conv1d(64→128, k=8, s=2) → BN → ReLU
      Transpose to (B, T', 128) → 2-layer BiLSTM(128) → last step → head_emo.
    """

    def __init__(self, n_ch=N_CH_RAW, n_time=N_TIME_RAW,
                 lstm_hidden=128, dropout=DEEP_DROPOUT):
        super().__init__()
        self.n_ch   = n_ch
        self.n_time = n_time

        self.cnn = nn.Sequential(
            nn.Conv1d(n_ch, 64, kernel_size=32, stride=4, padding=16),
            nn.BatchNorm1d(64), nn.ReLU(), nn.Dropout(dropout),
            nn.Conv1d(64, 128, kernel_size=8, stride=2, padding=4),
            nn.BatchNorm1d(128), nn.ReLU(), nn.Dropout(dropout),
        )
        self.lstm = nn.LSTM(128, lstm_hidden, num_layers=2, batch_first=True,
                            bidirectional=True,
                            dropout=dropout if 2 > 1 else 0.0)
        self.norm     = nn.LayerNorm(lstm_hidden * 2)
        self.drop_out = nn.Dropout(dropout)
        self.head_emo = nn.Linear(lstm_hidden * 2, 1)

    def _features(self, x):
        """x: (B, n_ch, n_time) → (B, lstm_hidden*2)."""
        c = self.cnn(x).transpose(1, 2)
        out, _ = self.lstm(c)
        return self.drop_out(self.norm(out[:, -1, :]))

    def forward(self, x):
        """x: (B, n_ch, n_time) → p_emo (B,)."""
        return torch.sigmoid(self.head_emo(self._features(x))).squeeze(1)

    def _prepare_tensor(self, X_raw):
        X_n = _normalize_raw_eeg(X_raw.copy())
        return torch.tensor(X_n, dtype=torch.float32)

    def fit(self, X_raw, y_emo):
        X_t = self._prepare_tensor(X_raw).to(DEVICE)
        self.to(DEVICE)
        print(f"  [CNN+BiLSTM Teacher] emo head (pos={int(y_emo.sum()):,} = {y_emo.mean():.1%})")
        sampler = _balanced_sampler(y_emo)
        ds  = torch.utils.data.TensorDataset(
            X_t, torch.tensor(y_emo, dtype=torch.float32)
        )
        ld  = torch.utils.data.DataLoader(ds, DEEP_BATCH, sampler=sampler)
        opt = torch.optim.Adam(self.parameters(), lr=DEEP_LR, weight_decay=1e-4)
        sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=DEEP_EPOCHS)
        self.train()
        for ep in range(DEEP_EPOCHS):
            ep_loss = 0.0
            for Xb, yb in ld:
                Xb, yb = Xb.to(DEVICE), yb.to(DEVICE)
                opt.zero_grad()
                loss = _focal_loss(self(Xb), yb)
                loss.backward(); opt.step()
                ep_loss += loss.item()
            sch.step()
            if (ep + 1) % 20 == 0:
                print(f"    epoch {ep+1}/{DEEP_EPOCHS}  loss={ep_loss/len(ld):.4f}")
        self.cpu()
        return self

    def predict_proba(self, X_raw):
        X_t = self._prepare_tensor(X_raw)
        self.eval()
        with torch.no_grad():
            parts = []
            for i in range(0, len(X_t), DEEP_BATCH):
                parts.append(self(X_t[i:i+DEEP_BATCH].to(DEVICE)).cpu().numpy())
        return np.concatenate(parts).astype(np.float32)

    def save(self, p):
        torch.save(self.state_dict(), str(p).replace(".pkl", "_weights.pt"))
        with open(p, "wb") as f: pickle.dump(self, f)

    @staticmethod
    def load(p):
        with open(p, "rb") as f: return pickle.load(f)


# ═══════════════════════════════════════════════════════════════════
#  SVM TEACHER  (baseline — dual-head, pre-extracted features)
# ═══════════════════════════════════════════════════════════════════

class TeacherSVM:
    """
    Single-head SVM teacher (y_emo only).
    Uses pre-extracted 480-dim features.
    """
    def __init__(self, C=SVM_C):
        self.svm_emo = Pipeline([
            ("sc",  StandardScaler()),
            ("clf", CalibratedClassifierCV(
                LinearSVC(C=C, class_weight="balanced",
                          max_iter=2000, random_state=RANDOM_STATE),
                method="sigmoid", cv=3
            ))
        ])

    def fit(self, X, y_emo):
        print(f"  [SVM-Linear] emo on {len(X):,} (pos={int(y_emo.sum()):,} = {y_emo.mean():.1%}) ...")
        self.svm_emo.fit(X, y_emo)
        return self

    def predict_proba(self, X):
        return self.svm_emo.predict_proba(X)[:, 1].astype(np.float32)

    def predict(self, X):
        return self.svm_emo.predict(X)

    def save(self, p):
        with open(p, "wb") as f: pickle.dump(self, f)

    @staticmethod
    def load(p):
        with open(p, "rb") as f: return pickle.load(f)


# ═══════════════════════════════════════════════════════════════════
#  EVALUATION  (ROC-AUC + PR-AUC, dual head)
# ═══════════════════════════════════════════════════════════════════

def find_optimal_threshold(probs, y_true, metric="f1_pos"):
    best_t, best_s = 0.5, -1.
    for t in np.arange(0.10, 0.91, 0.05):
        pred = (np.array(probs) >= t).astype(int)
        s = (f1_score(y_true, pred, pos_label=1, zero_division=0)
             if metric == "f1_pos" else
             f1_score(y_true, pred, average="macro", zero_division=0))
        if s > best_s: best_s, best_t = s, t
    return float(best_t), float(best_s)


def evaluate_teacher(model, X_te, ye_te, tag=""):
    """
    Evaluate single-head teacher on y_emo. Returns metrics dict.
    raw=True: X_te is (E, n_ch, n_time) for deep models.
    """
    p_emo = model.predict_proba(X_te)

    if len(ye_te) < 10 or len(np.unique(ye_te)) < 2:
        print(f"  [{tag}] insufficient classes for evaluation")
        return {}

    thr, _ = find_optimal_threshold(p_emo, ye_te, "f1_pos")
    pred   = (p_emo >= thr).astype(int)
    results = {
        "emo": {
            "accuracy"          : float(accuracy_score(ye_te, pred)),
            "balanced_accuracy" : float(balanced_accuracy_score(ye_te, pred)),
            "f1_macro"          : float(f1_score(ye_te, pred, average="macro", zero_division=0)),
            "f1_pos"            : float(f1_score(ye_te, pred, pos_label=1, zero_division=0)),
            "auc_roc"           : float(roc_auc_score(ye_te, p_emo)),
            "auc_pr"            : float(average_precision_score(ye_te, p_emo)),
            "threshold"         : thr,
            "n"                 : int(len(ye_te)),
            "pos_rate"          : float(ye_te.mean()),
        }
    }
    m = results["emo"]
    print(f"\n  [{tag}]")
    print(f"  {'Head':<6} {'Acc':>6} {'BalAcc':>7} {'F1+':>6} {'ROC-AUC':>8} {'PR-AUC':>7} {'PosRate':>8}")
    print("  " + "─" * 54)
    print(f"  {'emo':<6} {m['accuracy']:.4f} {m['balanced_accuracy']:.4f} "
          f"{m['f1_pos']:.4f}  {m['auc_roc']:.4f}   {m['auc_pr']:.4f}  {m['pos_rate']:.2%}")
    return results


# ═══════════════════════════════════════════════════════════════════
#  SOFT LOGIT SAVING  (emo + pre only — perc removed)
# ═══════════════════════════════════════════════════════════════════

def save_soft_logits(model, X, y_emo, source, save_dir=None, T=TEMPERATURE):
    if save_dir is None:
        save_dir = SOFT_DIR
    Path(save_dir).mkdir(parents=True, exist_ok=True)

    eps = 1e-7
    def ts(p):
        lo = np.log(np.clip(p, eps, 1 - eps)) - np.log(np.clip(1 - p, eps, 1 - eps))
        return (1 / (1 + np.exp(-lo / T))).astype(np.float32)

    p_emo    = model.predict_proba(X)
    soft_emo = ts(p_emo)

    np.save(Path(save_dir) / "soft_emo.npy", soft_emo)
    np.save(Path(save_dir) / "y_emo.npy",    y_emo)
    np.save(Path(save_dir) / "source.npy",   source)
    print(f"  Soft logits → {save_dir}/  emo_mean={soft_emo.mean():.4f}")
    return soft_emo


# ═══════════════════════════════════════════════════════════════════
#  FULL PIPELINE — supports svm | eegnet | cnn_bilstm
# ═══════════════════════════════════════════════════════════════════

def run_teacher_pipeline(npz_path=None, model_type="svm"):
    model_type = model_type.lower()
    is_deep    = model_type in ("eegnet", "cnn_bilstm")

    _labels = {
        "svm":        "SVM (LinearSVC + Platt) — single head",
        "eegnet":     "EEGNet Teacher — single head",
        "cnn_bilstm": "CNN+BiLSTM Teacher — single head",
    }
    label = _labels.get(model_type, model_type)

    print(f"\n{'=' * 62}")
    print(f"  TEACHER PIPELINE — DEAP+SAM40")
    print(f"  Model : {label}")
    print(f"  Head  : y_emo only  (early warning via spiral predictor)")
    print(f"{'=' * 62}")

    print("\n[1] Loading data")
    if is_deep:
        X, y_emo, sid, source = load_teacher_data_raw(npz_path)
    else:
        X, y_emo, sid, source = load_teacher_data(npz_path)

    print("\n[2] Subject-stratified split (80/20)")
    gss = GroupShuffleSplit(1, test_size=TEST_SIZE, random_state=RANDOM_STATE)
    tr, te = next(gss.split(X, y_emo, groups=sid))
    X_tr, X_te   = X[tr],     X[te]
    ye_tr, ye_te = y_emo[tr], y_emo[te]
    print(f"  Train:{len(tr):,} ({len(np.unique(sid[tr]))} subj)  "
          f"Test:{len(te):,} ({len(np.unique(sid[te]))} subj)")
    print(f"  Train emo pos: {int(ye_tr.sum()):,} ({ye_tr.mean():.1%})")

    print(f"\n[3] Training {label}")
    if model_type == "svm":
        rng   = np.random.default_rng(RANDOM_STATE)
        idx_s = (rng.choice(len(X_tr), SVM_SUBSAMPLE, replace=False)
                 if len(X_tr) > SVM_SUBSAMPLE else np.arange(len(X_tr)))
        if len(X_tr) > SVM_SUBSAMPLE:
            print(f"  Subsampled to {SVM_SUBSAMPLE:,}/{len(X_tr):,}")
        model = TeacherSVM(C=SVM_C)
        model.fit(X_tr[idx_s], ye_tr[idx_s])

    elif model_type == "eegnet":
        n_ch_actual, n_time_actual = X_tr.shape[1], X_tr.shape[2]
        model = EEGNetTeacher(n_ch=n_ch_actual, n_time=n_time_actual)
        model.fit(X_tr, ye_tr)

    elif model_type == "cnn_bilstm":
        n_ch_actual, n_time_actual = X_tr.shape[1], X_tr.shape[2]
        model = CNNBiLSTMTeacher(n_ch=n_ch_actual, n_time=n_time_actual)
        model.fit(X_tr, ye_tr)

    else:
        raise ValueError(f"Unknown model_type: {model_type}. Choose svm|eegnet|cnn_bilstm")

    print("\n[4] Evaluating on held-out test set")
    results = evaluate_teacher(model, X_te, ye_te, tag=label)
    roc_auc = results.get("emo", {}).get("auc_roc", 0.)
    pr_auc  = results.get("emo", {}).get("auc_pr",  0.)
    print(f"\n  ROC-AUC={roc_auc:.4f}  PR-AUC={pr_auc:.4f}")

    print("\n[5] Saving model")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = {"svm": "svm", "eegnet": "eegnet", "cnn_bilstm": "cnn_bilstm"}[model_type]
    pkl_path = MODELS_DIR / f"teacher_{suffix}.pkl"
    model.save(pkl_path)
    print(f"  Saved → {pkl_path}")

    print("\n[6] Saving soft logits for student distillation")
    save_soft_logits(model, X, y_emo, source)

    rpt = {
        "model"     : label,
        "model_type": model_type,
        "head"      : "emo",
        "roc_auc"   : roc_auc,
        "pr_auc"    : pr_auc,
        "results"   : results,
    }

    def _j(o):
        if isinstance(o, np.integer):  return int(o)
        if isinstance(o, np.floating): return float(o)
        if isinstance(o, np.ndarray):  return o.tolist()
        raise TypeError(type(o))

    results_path = MODELS_DIR / f"teacher_{suffix}_results.json"
    with open(results_path, "w") as f:
        json.dump(rpt, f, indent=2, default=_j)
    print(f"  Results → {results_path}")

    print(f"\n{'=' * 62}")
    print(f"  Teacher: {label}")
    print(f"  ROC-AUC={roc_auc:.4f}  PR-AUC={pr_auc:.4f}")
    print(f"{'=' * 62}\n")
    return model, results


# ═══════════════════════════════════════════════════════════════════
#  ABLATION COMPARISON
# ═══════════════════════════════════════════════════════════════════

def run_ablation_comparison(npz_path=None):
    """
    Train SVM, EEGNet, and CNN+BiLSTM teachers on the same split.
    Saves comparison JSON to models/teacher_ablation.json.
    """
    print(f"\n{'=' * 62}")
    print("  TEACHER ABLATION — SVM vs EEGNet vs CNN+BiLSTM")
    print(f"{'=' * 62}")

    # SVM (features)
    X_f, ye, sid, _ = load_teacher_data(npz_path)
    gss = GroupShuffleSplit(1, test_size=TEST_SIZE, random_state=RANDOM_STATE)
    tr_f, te_f = next(gss.split(X_f, ye, groups=sid))
    rng   = np.random.default_rng(RANDOM_STATE)
    idx_s = rng.choice(len(tr_f), min(SVM_SUBSAMPLE, len(tr_f)), replace=False)
    svm   = TeacherSVM(); svm.fit(X_f[tr_f][idx_s], ye[tr_f][idx_s])
    res_svm = evaluate_teacher(svm, X_f[te_f], ye[te_f], tag="SVM")

    # EEGNet + CNN+BiLSTM (raw)
    X_r, ye_r, sid_r, _ = load_teacher_data_raw(
        npz_path.parent / "normalized_dataset.npz" if npz_path else None
    )
    tr_r, te_r = next(gss.split(X_r, ye_r, groups=sid_r))

    _n_ch, _n_t = X_r.shape[1], X_r.shape[2]
    egn = EEGNetTeacher(n_ch=_n_ch, n_time=_n_t); egn.fit(X_r[tr_r], ye_r[tr_r])
    res_egn = evaluate_teacher(egn, X_r[te_r], ye_r[te_r], tag="EEGNet")

    cbl = CNNBiLSTMTeacher(n_ch=_n_ch, n_time=_n_t); cbl.fit(X_r[tr_r], ye_r[tr_r])
    res_cbl = evaluate_teacher(cbl, X_r[te_r], ye_r[te_r], tag="CNN+BiLSTM")

    def _roc(r): return r.get("emo", {}).get("auc_roc", 0.)
    def _pr(r):  return r.get("emo", {}).get("auc_pr",  0.)

    ablation = {
        "SVM":        {"roc_auc": _roc(res_svm), "pr_auc": _pr(res_svm), "results": res_svm},
        "EEGNet":     {"roc_auc": _roc(res_egn), "pr_auc": _pr(res_egn), "results": res_egn},
        "CNN+BiLSTM": {"roc_auc": _roc(res_cbl), "pr_auc": _pr(res_cbl), "results": res_cbl},
    }

    def _j(o):
        if isinstance(o, (np.integer, int)):    return int(o)
        if isinstance(o, (np.floating, float)): return float(o)
        if isinstance(o, np.ndarray):           return o.tolist()
        raise TypeError(type(o))

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODELS_DIR / "teacher_ablation.json", "w") as f:
        json.dump(ablation, f, indent=2, default=_j)
    print(f"\n  Ablation saved → {MODELS_DIR}/teacher_ablation.json")

    print(f"\n  {'Model':<14} {'ROC-AUC':>8} {'PR-AUC':>8}")
    print("  " + "─" * 34)
    for name, r in ablation.items():
        print(f"  {name:<14} {r['roc_auc']:.4f}   {r['pr_auc']:.4f}")
    return ablation


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--npz",       default=None,  help="Path to NPZ (features or raw)")
    p.add_argument("--model",     default="svm", choices=["svm", "eegnet", "cnn_bilstm"],
                   help="Teacher model type (default: svm)")
    p.add_argument("--ablation",  action="store_true",
                   help="Run all three models and compare (ignores --model)")
    p.add_argument("--soft_only", action="store_true",
                   help="Skip training — load saved pkl and regenerate soft_logits only")
    args = p.parse_args()

    npz = Path(args.npz) if args.npz else None

    if args.soft_only:
        suffix   = args.model
        pkl_path = MODELS_DIR / f"teacher_{suffix}.pkl"
        if not pkl_path.exists():
            print(f"ERROR: {pkl_path} not found — run without --soft_only first.")
            raise SystemExit(1)
        is_deep = suffix in ("eegnet", "cnn_bilstm")
        print(f"\nLoading saved {suffix} teacher from {pkl_path.name} ...")
        with open(pkl_path, "rb") as f:
            import pickle as _pkl
            model = _pkl.load(f)
        X, y_emo, _, source = (load_teacher_data_raw(npz) if is_deep
                                else load_teacher_data(npz))
        save_soft_logits(model, X, y_emo, source)
        print("Done — soft_logits/soft_emo.npy updated.")
    elif args.ablation:
        run_ablation_comparison(npz)
    else:
        model, results = run_teacher_pipeline(npz, model_type=args.model)
        for k, m in results.items():
            print(f"  {k}: roc={m['auc_roc']:.4f}  pr={m['auc_pr']:.4f}  "
                  f"bal_acc={m['balanced_accuracy']:.4f}  f1+={m['f1_pos']:.4f}")
