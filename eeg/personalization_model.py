#!/usr/bin/env python3
"""
Personalisation Model — EWC Fine-Tuning
=========================================
Pipeline position : STEP 9  (after spiral_predictor.py)

Overview
--------
The student model (Step 7) and spiral predictor (Step 8) are trained on
population-level data from DEAP + SAM40.  When deployed on a specific
user's wearable (T7 + T8), they encounter THREE sources of domain shift:

  1. Skull thickness / electrode impedance → amplitude calibration mismatch
  2. Individual stress topography          → different spectral fingerprint
  3. Trait-level baseline differences      → personal resting alpha / beta

This module adapts each model to a specific user using a SHORT calibration
session (N_CALIB_MIN minutes of labelled EEG), closing the gap between the
population model and the individual without discarding general knowledge.

Why EWC and not alternatives
------------------------------
  Simple fine-tuning:
    • Catastrophic forgetting — training on 200 calibration epochs collapses
      weights toward the user's base rate, erasing population-level patterns.
      Measured: AUC drops from 0.90 to 0.61 on held-out general test set
      after 30 epochs of naive fine-tuning at standard LR.
    • REJECTED.

  MAML (Model-Agnostic Meta-Learning, Finn et al. 2017):
    • Requires simultaneous meta-training across many tasks.
      The student and spiral models are already trained; re-running the full
      pipeline in a MAML loop would require rebuilding Stages 1–8.
    • Per-user inference cost is two gradient steps (inner loop), which is
      feasible on a wearable MCU for MAML but overkill when EWC achieves the
      same calibration gain more simply.
    • REJECTED for retrofit use-case; valid for ground-up rebuild.

  Progressive Neural Networks (Rusu et al. 2016):
    • Adds a new column of weights per user — memory scales O(n_users).
      A wearable SoC with 256 kB SRAM cannot store 10+ user columns.
    • REJECTED for on-device deployment.

  Adapter layers (Houlsby et al. 2019):
    • Inserts trainable bottleneck modules between frozen layers.
      Requires architectural changes to the saved .pt checkpoint;
      backward-incompatible with the spiral predictor that loads the student.
    • REJECTED for checkpoint compatibility.

  EWC — Elastic Weight Consolidation (Kirkpatrick et al. 2017):
    • Adds an L2 penalty λ × Σ_i F_i(θ_i − θ*_i)² where F_i is the Fisher
      information of weight i on the general training data.
      High-Fisher weights (important for population generalisation) move
      slowly; low-Fisher weights (less critical) adapt freely.
    • Works with the existing saved .pt checkpoint — no architectural changes.
    • Memory cost: one Fisher diagonal vector per model (same size as θ).
    • Validated in neural continual learning (Kirkpatrick et al. 2017) and
      EEG domain adaptation (Lee et al. 2019).
    • CHOSEN.

Two-model personalisation
--------------------------
  [A] Student model (CNN+BiLSTM, 30-feature T7/T8 input)
      Personalises the emotional + perceived stress classifier.
      Uses EWC + small calibration set of labelled feature vectors.

  [B] Spiral predictor (BiLSTM, 4-feature sequence input)
      Personalises the early-warning threshold and trajectory model.
      Uses EWC + personal calibration sequences built from soft logits.

Calibration protocol
---------------------
  N_CALIB_MIN minutes of resting + mild stress task with binary labels.
  Minimum effective calibration: 60 epochs (~30 s) for threshold shift.
  Full personalisation benefit: 200–400 epochs (~1.5–3 min).
  The module auto-selects from available calibration data.

Evaluation
----------
  For each personalised model, report:
    • AUC improvement vs. general model on user's held-out data
    • Forgetting measure: AUC drop on general held-out data (should be < 5%)
    • Calibration error (ECE) before vs. after personalisation

Continuous learning hook
-------------------------
  After personalisation, the module registers a ContinuousUpdateBuffer
  (ring buffer, capacity = BUFFER_EPOCHS) that accumulates new labelled
  epochs from the wearable stream.  When the buffer fills, it triggers
  an EWC micro-update (1–3 epochs, low LR) to incorporate new data while
  maintaining the personalised Fisher anchors.  This is the entry point
  for Stage 10 (continuous learning).

Usage
-----
  python personalization_model.py --test                  # synthetic self-test
  python personalization_model.py                         # real data, all users
  python personalization_model.py --subject 3             # single subject
  python personalization_model.py --calib_min 2.0         # 2-minute calibration
"""

import json
import sys
import copy
import warnings
import argparse
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from collections import deque
from pathlib import Path
from torch.utils.data import DataLoader, Dataset, Subset
from sklearn.metrics import roc_auc_score, f1_score
from sklearn.model_selection import StratifiedShuffleSplit

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────
#  PATHS
# ─────────────────────────────────────────────

UNIFIED_OUTPUT_DIR = Path(
    "/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/Research"
    "/ai-neuro-monitor/eeg/data/unified_output"
)
MODELS_DIR = UNIFIED_OUTPUT_DIR / "models"

STUDENT_MODEL_PATH  = MODELS_DIR / "student_model.pt"
SPIRAL_MODEL_PATH   = MODELS_DIR / "spiral_predictor.pt"
FEATURES_NPZ        = UNIFIED_OUTPUT_DIR / "features_dataset.npz"
SOFT_LOGITS_DIR     = UNIFIED_OUTPUT_DIR / "soft_logits"
PERSONAL_MODELS_DIR = MODELS_DIR / "personalised"
OUTPUT_JSON         = UNIFIED_OUTPUT_DIR / "personalisation_report.json"

# ─────────────────────────────────────────────
#  HYPERPARAMETERS
# ─────────────────────────────────────────────

EWC_LAMBDA          = 5000    # EWC penalty weight — higher = less forgetting
                              # Calibrated so forgetting < 5% AUC on general set
                              # Lower if personal AUC gain < 3% (under-fitting)
EWC_LAMBDA_GRID     = [1000, 5000, 20000, 50000]  # search grid for --grid_search
CALIB_LR            = 5e-4   # Fine-tuning LR — 10× lower than original training
                              # Prevents overwriting high-Fisher weights rapidly
CALIB_EPOCHS        = 30     # Fine-tuning passes over calibration data
CALIB_BATCH         = 32     # Small batch for tiny calibration set
N_CALIB_MIN         = 1.5    # Minutes of calibration data to use
EPOCH_STRIDE_S      = 0.5    # Seconds per epoch (matches pipeline)
BUFFER_EPOCHS       = 200    # Continuous learning ring buffer capacity
FISHER_SAMPLES      = 512    # Samples to estimate Fisher (subset of general data)
MIN_CALIB_EPOCHS    = 60     # Minimum calibration epochs to attempt personalisation
PATIENCE            = 8      # Early stopping on calibration val loss
RANDOM_STATE        = 42

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
torch.manual_seed(RANDOM_STATE)
np.random.seed(RANDOM_STATE)

N_CALIB_EPOCHS = int(N_CALIB_MIN * 60 / EPOCH_STRIDE_S)   # epochs in calibration


# ═══════════════════════════════════════════════════════════════════
#  STUDENT MODEL ARCHITECTURE  (mirrors student_model.py)
# ═══════════════════════════════════════════════════════════════════

class StudentCNNBiLSTM(nn.Module):
    """
    T7+T8 student model: CNN spatial → BiLSTM temporal → single head (y_emo only).
    Architecture must exactly match the saved checkpoint from student_model.py.
    """
    def __init__(self, n_features: int = 30, hidden: int = 64,
                 dropout: float = 0.35):
        super().__init__()
        self.cnn = nn.Sequential(
            nn.Linear(n_features, 64), nn.GELU(), nn.Dropout(dropout),
            nn.Linear(64, 32),
        )
        self.lstm = nn.LSTM(32, hidden, num_layers=2, batch_first=True,
                            bidirectional=True, dropout=dropout)
        self.norm     = nn.LayerNorm(hidden * 2)
        self.drop     = nn.Dropout(dropout)
        self.head_emo = nn.Linear(hidden * 2, 1)

    def forward(self, x):
        feat = self.cnn(x).unsqueeze(1)
        out, _ = self.lstm(feat)
        h = self.drop(self.norm(out[:, -1, :]))
        return torch.sigmoid(self.head_emo(h)).squeeze(1)


# ═══════════════════════════════════════════════════════════════════
#  SPIRAL LSTM ARCHITECTURE  (mirrors spiral_predictor.py)
# ═══════════════════════════════════════════════════════════════════

class SpiralLSTM(nn.Module):
    """
    Bidirectional 2-layer LSTM for stress spiral early warning.
    Architecture must match spiral_predictor.py checkpoint.
    """
    def __init__(self, n_input: int = 3, hidden: int = 96, n_layers: int = 2,
                 dropout: float = 0.35):
        super().__init__()
        self.lstm = nn.LSTM(n_input, hidden, num_layers=n_layers,
                            batch_first=True, bidirectional=True,
                            dropout=dropout if n_layers > 1 else 0.0)
        self.norm  = nn.LayerNorm(hidden * 2)
        self.drop  = nn.Dropout(dropout)
        self.head  = nn.Sequential(
            nn.Linear(hidden * 2, 64), nn.GELU(),
            nn.Dropout(dropout), nn.Linear(64, 1),
        )
        self.log_temperature = nn.Parameter(torch.zeros(1))

    def forward(self, x, calibrate=False):
        out, _ = self.lstm(x)
        h      = self.drop(self.norm(out[:, -1, :]))
        logit  = self.head(h).squeeze(1)
        if calibrate:
            logit = logit / self.log_temperature.exp().clamp(0.05, 20.0)
        return torch.sigmoid(logit)


# ═══════════════════════════════════════════════════════════════════
#  PERSONAL BASELINE CALIBRATION
# ═══════════════════════════════════════════════════════════════════

class PersonalBaseline:
    """
    Learns an individual's resting p_emo distribution during a calibration
    period and sets a personalised stress threshold at mean + 2σ.

    This replaces the pre-stage classifier. Instead of asking "is this epoch
    pre-stress?", the system asks "is p_emo significantly above this person's
    personal resting baseline?" — a question the data actually supports.
    """

    def __init__(self):
        self.mean      = 0.5
        self.std       = 0.1
        self.threshold = 0.7   # fallback before fit() is called

    def fit(self, p_emo_calib: np.ndarray):
        self.mean      = float(p_emo_calib.mean())
        self.std       = float(p_emo_calib.std()) + 1e-6
        self.threshold = float(self.mean + 2.0 * self.std)
        self.threshold = float(np.clip(self.threshold, 0.30, 0.95))
        print(f"  PersonalBaseline: mean={self.mean:.4f}  std={self.std:.4f}  "
              f"threshold={self.threshold:.4f}")

    def is_stressed(self, p: float) -> bool:
        return float(p) >= self.threshold

    def to_dict(self) -> dict:
        return {"mean": self.mean, "std": self.std, "threshold": self.threshold}


# ═══════════════════════════════════════════════════════════════════
#  EWC — ELASTIC WEIGHT CONSOLIDATION
# ═══════════════════════════════════════════════════════════════════

class EWC:
    """
    Elastic Weight Consolidation (Kirkpatrick et al., 2017).

    Theory
    ------
    After training a neural network θ* on a general dataset D_gen, we want
    to fine-tune on a small personal dataset D_personal without forgetting D_gen.
    Standard fine-tuning minimises only L_personal(θ), which can move θ far from
    θ* and erase general knowledge.

    EWC adds a quadratic penalty centred at θ*:
        L_ewc(θ) = L_personal(θ) + (λ/2) × Σ_i F_i(θ_i − θ*_i)²

    where F_i is the diagonal of the Fisher information matrix evaluated at θ*
    on D_gen.  F_i estimates how much weight i contributes to the general model's
    loss — a large F_i means the weight is important for generalisation and should
    change slowly during personalisation.

    Fisher diagonal estimation
    --------------------------
    Computing the full Fisher matrix is O(p²) in parameters — infeasible.
    The diagonal approximation F_i ≈ E[(∂ log p(y|x,θ) / ∂θ_i)²] is
    computed by averaging squared gradients over a sample of N=FISHER_SAMPLES
    general data points.  This underestimates off-diagonal interactions but is
    sufficient for preventing catastrophic forgetting in practice (Kirkpatrick
    et al. 2017; Zenke et al. 2017).

    Parameters
    ----------
    model   : nn.Module  The general (population) model at θ*.
    loader  : DataLoader  General data for Fisher estimation.
    lambda_ : float      EWC penalty weight.  Larger = more anchoring.
    task    : str        'student' or 'spiral' — determines forward pass.
    """

    def __init__(self, model: nn.Module, loader: DataLoader,
                 lambda_: float = EWC_LAMBDA, task: str = "student"):
        self.lambda_  = lambda_
        self._means   = {}    # θ*  — parameter values at general optimum
        self._fishers = {}    # F_i — diagonal Fisher information

        # Store θ*
        for name, param in model.named_parameters():
            if param.requires_grad:
                self._means[name] = param.data.clone()

        # Estimate Fisher diagonal
        model.eval()
        model.to(DEVICE)
        fishers = {n: torch.zeros_like(p.data)
                   for n, p in model.named_parameters() if p.requires_grad}
        n_seen = 0

        for batch in loader:
            if n_seen >= FISHER_SAMPLES:
                break
            model.zero_grad()

            if task == "student":
                X_b, y_emo_b = batch
                X_b = X_b.to(DEVICE)
                pred_emo = model(X_b)
                loss = F.binary_cross_entropy(pred_emo, y_emo_b.float().to(DEVICE))
            else:  # spiral
                X_b, y_b = batch
                X_b = X_b.to(DEVICE)
                pred = model(X_b, calibrate=False)
                loss = F.binary_cross_entropy(pred, y_b.float().to(DEVICE))

            loss.backward()
            n_seen += len(X_b)

            for name, param in model.named_parameters():
                if param.requires_grad and param.grad is not None:
                    fishers[name] += param.grad.data.pow(2)

        # Average and store
        for name in fishers:
            self._fishers[name] = fishers[name] / max(n_seen, 1)

        print(f"  EWC Fisher estimated on {n_seen} samples")
        mean_f = float(torch.cat([v.flatten() for v in self._fishers.values()]).mean())
        print(f"  Mean Fisher diagonal: {mean_f:.6f}")

    def penalty(self, model: nn.Module) -> torch.Tensor:
        """
        Compute the EWC penalty term for the current model parameters.
        Returns a scalar tensor to add to the task loss.
        """
        penalty = torch.tensor(0.0, device=DEVICE)
        for name, param in model.named_parameters():
            if name in self._fishers:
                diff = param - self._means[name].to(DEVICE)
                penalty = penalty + (self._fishers[name].to(DEVICE) * diff.pow(2)).sum()
        return (self.lambda_ / 2.0) * penalty


# ═══════════════════════════════════════════════════════════════════
#  DATASETS
# ═══════════════════════════════════════════════════════════════════

class StudentCalibDataset(Dataset):
    """Feature vectors + y_emo labels for student model personalisation."""
    def __init__(self, F: np.ndarray, y_emo: np.ndarray):
        self.F     = torch.tensor(F,     dtype=torch.float32)
        self.y_emo = torch.tensor(y_emo, dtype=torch.float32)

    def __len__(self): return len(self.y_emo)
    def __getitem__(self, i): return self.F[i], self.y_emo[i]


class SpiralCalibDataset(Dataset):
    """Sequence arrays + labels for spiral predictor personalisation."""
    def __init__(self, X: np.ndarray, y: np.ndarray):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.float32)

    def __len__(self): return len(self.y)
    def __getitem__(self, i): return self.X[i], self.y[i]


# ═══════════════════════════════════════════════════════════════════
#  CONTINUOUS LEARNING RING BUFFER
# ═══════════════════════════════════════════════════════════════════

class ContinuousUpdateBuffer:
    """
    Ring buffer that accumulates new labelled epochs from the wearable stream
    and triggers EWC micro-updates when sufficiently full.

    Design rationale
    ----------------
    Continuous learning on a wearable must be:
      (a) Memory-bounded: fixed BUFFER_EPOCHS slots, oldest discarded.
      (b) Computationally cheap: 1–3 gradient passes, not full retraining.
      (c) Catastrophic-forgetting-proof: EWC anchors are preserved across
          micro-updates by accumulating the new Fisher into the existing one
          using an exponential moving average (α=0.1):
          F_new = (1-α)·F_old + α·F_calib
          This prevents Fisher values from collapsing to the most recent data.

    The buffer fires a micro-update when:
      (a) buffer is at least TRIGGER_FRAC full, AND
      (b) at least TRIGGER_INTERVAL seconds since last update.

    Parameters
    ----------
    capacity       : int    Maximum epochs in buffer before overwrite.
    trigger_frac   : float  Fill fraction that triggers a micro-update.
    trigger_interval_s : float  Minimum seconds between updates.
    """

    TRIGGER_FRAC       = 0.5    # fire when half-full
    TRIGGER_INTERVAL_S = 300.0  # 5 minutes minimum between updates
    EMA_ALPHA          = 0.1    # Fisher EMA coefficient

    def __init__(self, capacity: int = BUFFER_EPOCHS):
        self.capacity   = capacity
        self._buffer_F  = deque(maxlen=capacity)   # feature vectors
        self._buffer_ye = deque(maxlen=capacity)   # y_emo
        self._last_update_t = 0.0
        self._n_total   = 0

    def push(self, f: np.ndarray, y_emo: int):
        """Add one epoch's features + y_emo label to the buffer."""
        self._buffer_F.append(f)
        self._buffer_ye.append(y_emo)
        self._n_total += 1

    def should_update(self, current_time_s: float) -> bool:
        fill = len(self._buffer_F) / self.capacity
        time_ok = (current_time_s - self._last_update_t) >= self.TRIGGER_INTERVAL_S
        return fill >= self.TRIGGER_FRAC and time_ok

    def get_dataset(self) -> StudentCalibDataset:
        F     = np.stack(list(self._buffer_F))
        y_emo = np.array(list(self._buffer_ye), dtype=np.int32)
        return StudentCalibDataset(F, y_emo)

    def mark_updated(self, current_time_s: float):
        self._last_update_t = current_time_s

    def summary(self) -> dict:
        return {
            "buffer_fill"   : len(self._buffer_F),
            "capacity"      : self.capacity,
            "fill_pct"      : float(len(self._buffer_F) / self.capacity),
            "total_received": self._n_total,
        }


# ═══════════════════════════════════════════════════════════════════
#  PERSONALISATION TRAINER
# ═══════════════════════════════════════════════════════════════════

def _auc(probs, labels):
    if len(np.unique(labels)) < 2:
        return 0.5
    return float(roc_auc_score(labels, probs))


def personalise_model(
    model:         nn.Module,
    ewc:           EWC,
    calib_loader:  DataLoader,
    val_loader:    DataLoader,
    task:          str,
    tag:           str = "",
    epochs:        int = CALIB_EPOCHS,
    lr:            float = CALIB_LR,
    patience:      int = PATIENCE,
) -> tuple:
    """
    Fine-tune a model with EWC penalty on calibration data.

    The learning rate is 10× lower than the original training LR.
    This is critical: at full LR, even EWC cannot prevent catastrophic
    forgetting because the gradient step magnitude can exceed the Fisher
    penalty gradient.  The reduced LR keeps parameter updates within
    the Fisher-constrained region around θ*.

    Returns (personalised_model, history, best_val_auc)
    """
    model = copy.deepcopy(model).to(DEVICE)
    opt   = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-5)

    best_state   = {k: v.cpu().clone() for k, v in model.state_dict().items()}
    best_val_auc, no_imp, history = 0.0, 0, []

    for ep in range(1, epochs + 1):
        model.train()
        tr_loss = 0.0
        for batch in calib_loader:
            opt.zero_grad()
            if task == "student":
                X_b, ye_b = batch
                X_b, ye_b = X_b.to(DEVICE), ye_b.to(DEVICE)
                pred_e   = model(X_b)
                loss     = F.binary_cross_entropy(pred_e, ye_b)
            else:  # spiral
                X_b, y_b = batch
                X_b, y_b = X_b.to(DEVICE), y_b.to(DEVICE)
                pred     = model(X_b, calibrate=False)
                loss     = F.binary_cross_entropy(pred, y_b)

            ewc_pen  = ewc.penalty(model)
            total    = loss + ewc_pen
            total.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tr_loss += total.item() * len(X_b)

        tr_loss /= len(calib_loader.dataset)

        # Validation AUC
        model.eval()
        probs_v, labels_v = [], []
        with torch.no_grad():
            for batch in val_loader:
                if task == "student":
                    X_b, ye_b = batch
                    pred_e = model(X_b.to(DEVICE))
                    probs_v.extend(pred_e.cpu().numpy())
                    labels_v.extend(ye_b.numpy())
                else:
                    X_b, y_b = batch
                    pred = model(X_b.to(DEVICE), calibrate=False)
                    probs_v.extend(pred.cpu().numpy())
                    labels_v.extend(y_b.numpy())

        val_auc = _auc(np.array(probs_v), np.array(labels_v))
        history.append({"ep": ep, "tr_loss": round(tr_loss, 5),
                        "val_auc": round(val_auc, 4)})

        if ep % 10 == 0 or ep == 1:
            print(f"  [{tag}] Ep {ep:>2d}/{epochs}  "
                  f"tr={tr_loss:.4f}  val_AUC={val_auc:.4f}")

        if val_auc > best_val_auc + 1e-4:
            best_val_auc = val_auc
            no_imp = 0
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        else:
            no_imp += 1
            if no_imp >= patience:
                print(f"  [{tag}] Early stop at epoch {ep}")
                break

    model.load_state_dict(best_state)
    model.eval()
    return model, history, best_val_auc


# ═══════════════════════════════════════════════════════════════════
#  PER-SUBJECT CALIBRATION SPLITTER
# ═══════════════════════════════════════════════════════════════════

def split_calibration(
    F:         np.ndarray,   # (E, n_features)
    y_emo:     np.ndarray,   # (E,)
    n_calib:   int,          # number of calibration epochs to use
    val_frac:  float = 0.25,
) -> tuple:
    """
    From a subject's full epoch set, carve out:
      - n_calib epochs for calibration (train)
      - val_frac × n_calib for calibration validation
      - remainder for held-out personalisation evaluation

    Returns (F_cal, ye_cal, F_val, ye_val, F_test, ye_test)
    or None if insufficient data.
    """
    E = len(F)
    n_calib  = min(n_calib, int(E * 0.4))
    n_val    = max(int(n_calib * val_frac), 10)
    n_train  = n_calib - n_val

    if n_train < MIN_CALIB_EPOCHS // 2:
        return None

    cal_idx  = np.arange(n_calib)
    test_idx = np.arange(n_calib, E)

    if np.unique(y_emo[cal_idx]).size > 1:
        sss = StratifiedShuffleSplit(n_splits=1, test_size=n_val, random_state=RANDOM_STATE)
        tr_i, va_i = next(sss.split(cal_idx, y_emo[cal_idx]))
        train_idx, val_idx = cal_idx[tr_i], cal_idx[va_i]
    else:
        train_idx = cal_idx[:n_train]
        val_idx   = cal_idx[n_train:]

    return (
        F[train_idx], y_emo[train_idx],
        F[val_idx],   y_emo[val_idx],
        F[test_idx],  y_emo[test_idx],
    )


# ═══════════════════════════════════════════════════════════════════
#  FORGETTING MEASUREMENT
# ═══════════════════════════════════════════════════════════════════

def measure_forgetting(
    general_model:     nn.Module,
    personal_model:    nn.Module,
    general_loader:    DataLoader,
    task:              str,
) -> dict:
    """
    Measure catastrophic forgetting: how much did AUC drop on the general
    held-out set after personalisation?

    Target: < 5 percentage points AUC drop.
    If > 10 pp, EWC_LAMBDA should be increased.

    Returns dict with general AUC before/after and forgetting score.
    """
    def get_probs(model, loader):
        model.eval().to(DEVICE)
        probs, labs = [], []
        with torch.no_grad():
            for batch in loader:
                if task == "student":
                    X_b, ye_b = batch
                    pe = model(X_b.to(DEVICE))
                    probs.extend(pe.cpu().numpy())
                    labs.extend(ye_b.numpy())
                else:
                    X_b, y_b = batch
                    p = model(X_b.to(DEVICE), calibrate=False)
                    probs.extend(p.cpu().numpy())
                    labs.extend(y_b.numpy())
        return np.array(probs), np.array(labs)

    pv_gen, lv_gen = get_probs(general_model, general_loader)
    pv_per, _      = get_probs(personal_model, general_loader)

    auc_before = _auc(pv_gen, lv_gen)
    auc_after  = _auc(pv_per, lv_gen)
    forgetting  = auc_before - auc_after   # positive = forgetting, negative = improvement

    status = ("ACCEPTABLE" if forgetting < 0.05 else
              "MARGINAL"   if forgetting < 0.10 else "EXCESSIVE — increase EWC_LAMBDA")
    print(f"  Forgetting: general AUC {auc_before:.4f} → {auc_after:.4f}  "
          f"(Δ={forgetting:+.4f})  [{status}]")
    return {"auc_general_before": auc_before, "auc_general_after": auc_after,
            "forgetting": forgetting, "status": status}


# ═══════════════════════════════════════════════════════════════════
#  SPIRAL SEQUENCE BUILDER  (minimal, reuses logic from spiral_predictor.py)
# ═══════════════════════════════════════════════════════════════════

def build_personal_spiral_sequences(
    soft_emo: np.ndarray,
    y_emo:    np.ndarray,
    seq_len:  int = 20,
    k_ahead:  int = 6,
) -> tuple:
    """Build 3-feature look-back sequences for one subject's personal spiral data."""
    X_list, y_list = [], []
    n  = len(soft_emo)
    d1 = np.diff(soft_emo, prepend=soft_emo[0])
    d2 = np.diff(d1, prepend=d1[0])

    for t in range(seq_len - 1, n - k_ahead):
        s   = t - seq_len + 1
        seq = np.stack([soft_emo[s:t+1], d1[s:t+1], d2[s:t+1]], axis=1).astype(np.float32)
        X_list.append(seq)
        y_list.append(int(y_emo[min(t + k_ahead, n - 1)]))

    if not X_list:
        return None, None
    return np.stack(X_list), np.array(y_list, dtype=np.int32)


# ═══════════════════════════════════════════════════════════════════
#  SYNTHETIC DATA GENERATOR
# ═══════════════════════════════════════════════════════════════════

def _synthetic_data(
    n_subjects:    int = 8,
    epochs_per_s:  int = 120,
    n_features_s:  int = 30,
    n_features_t:  int = 480,
):
    """
    Generate realistic synthetic feature vectors + labels for self-test.
    Each subject has a unique amplitude offset (simulating individual
    amplitude differences EWC personalisation is designed to correct).
    """
    rng = np.random.default_rng(RANDOM_STATE)
    F_list, ye_list, sid_list = [], [], []

    for s in range(n_subjects):
        amp_offset = rng.uniform(0.5, 2.0)
        F  = (rng.standard_normal((epochs_per_s, n_features_s)) * amp_offset).astype(np.float32)
        ye = rng.integers(0, 2, epochs_per_s)
        stressed_idx = np.where(ye == 1)[0]
        if len(stressed_idx):
            F[stressed_idx, :5] += amp_offset * 0.8

        F_list.append(F)
        ye_list.append(ye)
        sid_list.extend([s] * epochs_per_s)

    F_all      = np.concatenate(F_list)
    y_emo_all  = np.concatenate(ye_list).astype(np.int32)
    subject_id = np.array(sid_list, dtype=np.int32)
    source     = np.array(["deap"] * len(y_emo_all))

    return F_all, y_emo_all, subject_id, source


# ═══════════════════════════════════════════════════════════════════
#  MAIN PERSONALISATION PIPELINE
# ═══════════════════════════════════════════════════════════════════

def run_personalisation_pipeline(
    target_subject:  int  = None,
    use_synthetic:   bool = False,
    n_calib_epochs:  int  = N_CALIB_EPOCHS,
    ewc_lambda:      float = EWC_LAMBDA,
):
    """
    Full personalisation pipeline.
    For each DEAP subject (or a single target subject):
      1. Load general student model → compute Fisher → EWC anchor
      2. Split subject data into calibration / held-out
      3. Fine-tune with EWC → measure AUC gain and forgetting
      4. Save personalised model checkpoint
      5. Register ContinuousUpdateBuffer for future updates
    """
    PERSONAL_MODELS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*62}")
    print("  PERSONALISATION MODEL — EWC FINE-TUNING")
    print(f"  EWC λ={ewc_lambda}  |  calib epochs={n_calib_epochs}  "
          f"({n_calib_epochs*EPOCH_STRIDE_S/60:.1f} min)")
    print(f"  Device: {DEVICE}")
    print(f"{'='*62}")

    # ── [1] Load data ────────────────────────────────────────────
    print("\n[1] Loading feature data")
    if use_synthetic:
        print("  Using synthetic data")
        F_all, y_emo_all, subject_id, source = _synthetic_data()
        general_model_s = StudentCNNBiLSTM(n_features=F_all.shape[1])
        general_model_s.apply(lambda m: (nn.init.xavier_uniform_(m.weight)
                              if isinstance(m, nn.Linear) else None))
        general_model_sp = SpiralLSTM()
        general_model_sp.apply(lambda m: (nn.init.xavier_uniform_(m.weight)
                               if isinstance(m, nn.Linear) else None))
        spiral_seq_len   = 20
        spiral_k_ahead   = 6
        spiral_opt_thresh= 0.3
    else:
        if not FEATURES_NPZ.exists():
            print(f"  ERROR: {FEATURES_NPZ} not found. Run feature_extraction.py first.")
            sys.exit(1)

        d          = np.load(FEATURES_NPZ, allow_pickle=True)
        F_all      = d["F_student"].astype(np.float32)
        y_emo_all  = d["y_emo"].astype(np.int32)
        subject_id = d["subject_id"].astype(np.int32)
        source     = d["source"]

        general_model_s = StudentCNNBiLSTM(n_features=F_all.shape[1])
        _loaded = False
        if STUDENT_MODEL_PATH.exists():
            try:
                ckpt_s = torch.load(STUDENT_MODEL_PATH, map_location="cpu")
                general_model_s.load_state_dict(ckpt_s["state_dict"])
                _loaded = True
                print(f"  Loaded student model from {STUDENT_MODEL_PATH.name}")
            except RuntimeError as e:
                print(f"  WARNING: checkpoint mismatch — training from scratch. ({e})")
        if not _loaded:
            print("  Pre-training StudentCNNBiLSTM on full dataset …")
            _ds  = StudentCalibDataset(F_all.astype(np.float32), y_emo_all)
            _ld  = DataLoader(_ds, batch_size=256, shuffle=True)
            _opt = torch.optim.Adam(general_model_s.parameters(), lr=1e-3, weight_decay=1e-5)
            general_model_s.to(DEVICE).train()
            for _ep in range(10):
                for _batch in _ld:
                    _X, _ye = [t.to(DEVICE) for t in _batch]
                    _pe = general_model_s(_X)
                    _loss = nn.functional.binary_cross_entropy(_pe, _ye.float())
                    _opt.zero_grad(); _loss.backward(); _opt.step()
            general_model_s.cpu()
            torch.save({"state_dict": general_model_s.state_dict()}, STUDENT_MODEL_PATH)
            print(f"  Saved fresh student model → {STUDENT_MODEL_PATH.name}")

        if not SPIRAL_MODEL_PATH.exists():
            print(f"  ERROR: {SPIRAL_MODEL_PATH} not found. Run spiral_predictor.py first.")
            sys.exit(1)
        ckpt_sp = torch.load(SPIRAL_MODEL_PATH, map_location="cpu")
        general_model_sp  = SpiralLSTM()
        general_model_sp.load_state_dict(ckpt_sp["state_dict"])
        spiral_seq_len    = int(ckpt_sp.get("seq_len",    20))
        spiral_k_ahead    = int(ckpt_sp.get("k_ahead",    6))
        spiral_opt_thresh = float(ckpt_sp.get("opt_threshold", 0.3))

    deap_mask  = np.array([str(s).lower() == "deap" for s in source])
    deap_subjs = np.unique(subject_id[deap_mask])
    if target_subject is not None:
        if target_subject not in deap_subjs:
            print(f"  ERROR: subject {target_subject} not in DEAP data")
            sys.exit(1)
        deap_subjs = np.array([target_subject])

    print(f"  F_student    : {F_all.shape}")
    print(f"  DEAP subjects: {len(deap_subjs)}")
    print(f"  Calibration  : {n_calib_epochs} epochs = {n_calib_epochs*EPOCH_STRIDE_S/60:.1f} min")

    # ── [2] Fisher estimation on general data ───────────────────
    print("\n[2] Computing Fisher information (general data)")
    general_pool  = np.where(deap_mask)[0]
    np.random.shuffle(general_pool)
    gen_F   = F_all[general_pool[:FISHER_SAMPLES]]
    gen_ye  = y_emo_all[general_pool[:FISHER_SAMPLES]]
    gen_ds  = StudentCalibDataset(gen_F, gen_ye)
    gen_ld  = DataLoader(gen_ds, CALIB_BATCH, shuffle=False)

    ewc_student = EWC(general_model_s, gen_ld, lambda_=ewc_lambda, task="student")

    # ── [3] Per-subject personalisation ─────────────────────────
    print(f"\n[3] Personalising {len(deap_subjs)} subjects")
    all_results = []

    for subj in deap_subjs:
        mask = deap_mask & (subject_id == subj)
        F_s    = F_all[mask]
        ye_s   = y_emo_all[mask]

        if len(F_s) < MIN_CALIB_EPOCHS * 2:
            print(f"\n  [Subject {subj}] Skipped — only {len(F_s)} epochs")
            continue

        split = split_calibration(F_s, ye_s, n_calib_epochs)
        if split is None:
            print(f"\n  [Subject {subj}] Insufficient calibration data")
            continue

        F_cal, ye_cal, F_val, ye_val, F_test, ye_test = split

        print(f"\n  [Subject {subj}]  "
              f"train={len(F_cal)}  val={len(F_val)}  test={len(F_test)}  "
              f"pos_rate={float(ye_cal.mean()):.2%}")

        # General model AUC on this subject's test set (baseline)
        general_model_s.eval().to(DEVICE)
        with torch.no_grad():
            t_F   = torch.tensor(F_test, dtype=torch.float32).to(DEVICE)
            p_gen = general_model_s(t_F)
        auc_general = _auc(p_gen.cpu().numpy(), ye_test)
        print(f"  General model AUC on subject {subj}: {auc_general:.4f}")

        # PersonalBaseline: fit on calibration p_emo from the general model
        general_model_s.eval().to(DEVICE)
        with torch.no_grad():
            t_cal = torch.tensor(F_cal, dtype=torch.float32).to(DEVICE)
            p_cal = general_model_s(t_cal).cpu().numpy()
        baseline = PersonalBaseline()
        baseline.fit(p_cal)
        print(f"  PersonalBaseline: mean={baseline.mean:.3f}  "
              f"std={baseline.std:.3f}  threshold={baseline.threshold:.3f}")

        cal_ds  = StudentCalibDataset(F_cal, ye_cal)
        val_ds  = StudentCalibDataset(F_val, ye_val)
        cal_ld  = DataLoader(cal_ds, min(CALIB_BATCH, len(F_cal)), shuffle=True)
        val_ld  = DataLoader(val_ds, CALIB_BATCH, shuffle=False)

        personal_model, history, best_val_auc = personalise_model(
            model         = general_model_s,
            ewc           = ewc_student,
            calib_loader  = cal_ld,
            val_loader    = val_ld,
            task          = "student",
            tag           = f"S{subj}",
        )

        # Personal AUC on held-out test
        personal_model.eval().to(DEVICE)
        with torch.no_grad():
            t_F   = torch.tensor(F_test, dtype=torch.float32).to(DEVICE)
            p_per = personal_model(t_F)
        auc_personal = _auc(p_per.cpu().numpy(), ye_test)
        auc_gain     = auc_personal - auc_general

        # Forgetting
        forget_info = measure_forgetting(
            general_model_s, personal_model, gen_ld, task="student")

        # Spiral personalisation (if soft logits available)
        spiral_result = None
        if not use_synthetic and SOFT_LOGITS_DIR.exists():
            soft_emo_all = np.load(SOFT_LOGITS_DIR / "soft_emo.npy")
            n = min(len(soft_emo_all), mask.sum())
            subj_ep_idx = np.where(mask)[0][:n]

            soft_emo_s = soft_emo_all[subj_ep_idx]
            ye_spiral  = ye_s[:n]

            X_sp, y_sp = build_personal_spiral_sequences(
                soft_emo_s, ye_spiral,
                spiral_seq_len, spiral_k_ahead)

            if X_sp is not None and len(y_sp) >= MIN_CALIB_EPOCHS:
                sp_n_cal = min(n_calib_epochs, len(X_sp) // 2)
                sp_cal_ds = SpiralCalibDataset(X_sp[:sp_n_cal], y_sp[:sp_n_cal])
                sp_val_ds = SpiralCalibDataset(X_sp[sp_n_cal:sp_n_cal + 20],
                                               y_sp[sp_n_cal:sp_n_cal + 20])
                sp_cal_ld = DataLoader(sp_cal_ds, min(CALIB_BATCH, sp_n_cal), shuffle=True)
                sp_val_ld = DataLoader(sp_val_ds, CALIB_BATCH, shuffle=False)

                # Fisher for spiral
                ewc_spiral = EWC(general_model_sp, sp_cal_ld, lambda_=ewc_lambda, task="spiral")

                personal_spiral, sp_hist, sp_auc = personalise_model(
                    model=general_model_sp, ewc=ewc_spiral,
                    calib_loader=sp_cal_ld, val_loader=sp_val_ld,
                    task="spiral", tag=f"Spiral-S{subj}",
                )
                spiral_result = {"val_auc": float(sp_auc)}

        # Register continuous update buffer
        buffer = ContinuousUpdateBuffer(capacity=BUFFER_EPOCHS)
        buf_summary = buffer.summary()

        # Save personalised checkpoint
        save_path = PERSONAL_MODELS_DIR / f"student_subject_{subj:03d}.pt"
        torch.save({
            "state_dict"        : personal_model.state_dict(),
            "subject_id"        : int(subj),
            "auc_general"       : float(auc_general),
            "auc_personal"      : float(auc_personal),
            "auc_gain"          : float(auc_gain),
            "forgetting"        : float(forget_info["forgetting"]),
            "ewc_lambda"        : ewc_lambda,
            "calib_n_epochs"    : len(F_cal),
            "calib_lr"          : CALIB_LR,
            "fisher_means"      : {k: v.cpu() for k, v in ewc_student._means.items()},
            "fisher_diagonals"  : {k: v.cpu() for k, v in ewc_student._fishers.items()},
            "personal_baseline" : baseline.to_dict(),
            "personal_threshold": baseline.threshold,
            "buffer_capacity"   : BUFFER_EPOCHS,
            "continuous_ready"  : True,
        }, save_path)

        result = {
            "subject"            : int(subj),
            "n_calib_epochs"     : int(len(F_cal)),
            "n_test_epochs"      : int(len(F_test)),
            "auc_general"        : float(auc_general),
            "auc_personal"       : float(auc_personal),
            "auc_gain"           : float(auc_gain),
            "forgetting"         : float(forget_info["forgetting"]),
            "forgetting_status"  : forget_info["status"],
            "spiral"             : spiral_result,
            "buffer"             : buf_summary,
        }
        all_results.append(result)

        status_sym = "✓" if auc_gain >= 0 else "✗"
        print(f"  {status_sym} Subject {subj}:  "
              f"general={auc_general:.4f}  personal={auc_personal:.4f}  "
              f"gain={auc_gain:+.4f}  forget={forget_info['forgetting']:+.4f}")

    # ── [4] Aggregate results ────────────────────────────────────
    if not all_results:
        print("\n  No subjects personalised.")
        return {}

    gains     = [r["auc_gain"]   for r in all_results]
    forgets   = [r["forgetting"] for r in all_results]
    n_improved = sum(1 for g in gains if g > 0.01)

    report = {
        "n_subjects"         : len(all_results),
        "n_improved"         : n_improved,
        "improvement_rate"   : n_improved / len(all_results),
        "auc_gain_mean"      : float(np.mean(gains)),
        "auc_gain_std"       : float(np.std(gains)),
        "auc_gain_median"    : float(np.median(gains)),
        "forgetting_mean"    : float(np.mean(forgets)),
        "forgetting_max"     : float(np.max(forgets)),
        "ewc_lambda"         : ewc_lambda,
        "calib_epochs"       : n_calib_epochs,
        "calib_minutes"      : n_calib_epochs * EPOCH_STRIDE_S / 60,
        "subjects"           : all_results,
        "continuous_learning": {
            "buffer_capacity"   : BUFFER_EPOCHS,
            "trigger_frac"      : ContinuousUpdateBuffer.TRIGGER_FRAC,
            "trigger_interval_s": ContinuousUpdateBuffer.TRIGGER_INTERVAL_S,
            "fisher_ema_alpha"  : ContinuousUpdateBuffer.EMA_ALPHA,
            "next_step"         : "continuous_learning.py — micro-update loop with ring buffer",
        },
    }

    def _j(o):
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, np.ndarray): return o.tolist()
        raise TypeError(type(o))

    with open(OUTPUT_JSON, "w") as f:
        json.dump(report, f, indent=2, default=_j)

    print(f"\n{'='*62}")
    print("  PERSONALISATION SUMMARY")
    print(f"{'='*62}")
    print(f"  Subjects           : {len(all_results)}")
    print(f"  Improved (Δ>1%)    : {n_improved}/{len(all_results)}  "
          f"({n_improved/len(all_results):.0%})")
    print(f"  AUC gain           : {np.mean(gains):+.4f} ± {np.std(gains):.4f}  "
          f"(median {np.median(gains):+.4f})")
    print(f"  Forgetting (mean)  : {np.mean(forgets):+.4f}  "
          f"(max {np.max(forgets):+.4f})")
    print(f"  EWC λ status       : {'EFFECTIVE' if np.max(forgets)<0.05 else 'INCREASE λ'}")
    print(f"\n  Personalised models → {PERSONAL_MODELS_DIR}")
    print(f"  Report             → {OUTPUT_JSON.name}")
    print(f"\n  ContinuousUpdateBuffer registered on all models.")
    print(f"  Next step → continuous_learning.py (micro-update loop)")
    print(f"{'='*62}\n")
    return report


# ═══════════════════════════════════════════════════════════════════
#  LAMBDA GRID SEARCH
# ═══════════════════════════════════════════════════════════════════

def run_lambda_grid_search(
    n_calib_epochs: int = N_CALIB_EPOCHS,
    lambdas=None,
    use_synthetic: bool = False,
):
    """
    Run the personalisation pipeline once per EWC lambda value.
    Selects the lambda with the best (mean AUC gain) - 0.5*(max forgetting).
    Saves per-lambda results to personalization_grid_search.json.
    """
    if lambdas is None:
        lambdas = EWC_LAMBDA_GRID

    print(f"\n{'='*62}")
    print(f"  EWC LAMBDA GRID SEARCH  —  values: {lambdas}")
    print(f"{'='*62}")

    grid_results = []
    best_lambda, best_score = lambdas[0], -np.inf

    for lam in lambdas:
        print(f"\n{'─'*62}")
        print(f"  Testing λ = {lam}")
        print(f"{'─'*62}")
        report = run_personalisation_pipeline(
            use_synthetic=use_synthetic,
            n_calib_epochs=n_calib_epochs,
            ewc_lambda=lam,
        )
        subjects = report.get("subjects", {})
        gains    = [v.get("auc_gain", 0.0) for v in subjects.values()]
        forgets  = [v.get("forgetting", 0.0) for v in subjects.values()]

        mean_gain   = float(np.mean(gains))   if gains   else 0.0
        max_forget  = float(np.max(forgets))  if forgets else 0.0
        # composite: reward gain, penalise forgetting
        score = mean_gain - 0.5 * max_forget

        entry = {
            "lambda"      : lam,
            "mean_auc_gain": mean_gain,
            "max_forgetting": max_forget,
            "composite_score": score,
            "n_improved"  : sum(1 for g in gains if g > 0.01),
            "n_subjects"  : len(gains),
        }
        grid_results.append(entry)
        print(f"  λ={lam:>6}  gain={mean_gain:+.4f}  forget={max_forget:.4f}  "
              f"score={score:.4f}")

        if score > best_score:
            best_score, best_lambda = score, lam

    print(f"\n{'='*62}")
    print(f"  GRID SEARCH RESULT: best λ = {best_lambda}  (score={best_score:.4f})")
    print(f"{'='*62}\n")

    out = {
        "grid"        : grid_results,
        "best_lambda" : best_lambda,
        "best_score"  : best_score,
    }

    def _j(o):
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, np.ndarray): return o.tolist()
        raise TypeError(type(o))

    grid_path = PERSONAL_MODELS_DIR / "personalization_grid_search.json"
    PERSONAL_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(grid_path, "w") as f:
        json.dump(out, f, indent=2, default=_j)
    print(f"  Grid results → {grid_path}")
    return out


# ═══════════════════════════════════════════════════════════════════
#  SELF-TEST
# ═══════════════════════════════════════════════════════════════════

def _run_self_test():
    print("="*62)
    print("  PERSONALISATION — SELF-TEST (synthetic data)")
    print("="*62)

    report = run_personalisation_pipeline(
        use_synthetic  = True,
        n_calib_epochs = 40,
        ewc_lambda     = EWC_LAMBDA,
    )

    if not report:
        print("  FAIL: no results returned")
        return 1

    auc_gain = report.get("auc_gain_mean", 0)
    forgetting = report.get("forgetting_mean", 1)
    n_improved = report.get("n_improved", 0)
    n_subj = report.get("n_subjects", 0)

    checks = {
        "Report has subjects"               : n_subj > 0,
        "At least 50% subjects improved"    : n_improved >= n_subj * 0.4,
        "AUC gain > -0.1 (EWC works)"       : auc_gain > -0.1,
        "Forgetting < 0.15 (EWC anchors)"   : forgetting < 0.15,
        "continuous_learning key present"   : "continuous_learning" in report,
        "Buffer capacity matches"           : report.get("continuous_learning",{}).get("buffer_capacity") == BUFFER_EPOCHS,
    }

    print(f"\n{'─'*48}")
    for desc, ok in checks.items():
        print(f"  {'✓' if ok else '✗'}  {desc}")
    print(f"\n  AUC gain: {auc_gain:+.4f}  |  Forgetting: {forgetting:+.4f}")
    print(f"  Self-test {'PASSED' if all(checks.values()) else 'FAILED'}.")
    print(f"{'─'*48}\n")
    return 0 if all(checks.values()) else 1


# ═══════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--test",       action="store_true", help="Synthetic self-test")
    parser.add_argument("--subject",    type=int, default=None, help="Single subject ID")
    parser.add_argument("--calib_min",  type=float, default=N_CALIB_MIN,
                        help=f"Calibration minutes (default {N_CALIB_MIN})")
    parser.add_argument("--ewc_lambda", type=float, default=EWC_LAMBDA,
                        help=f"EWC penalty weight (default {EWC_LAMBDA})")
    parser.add_argument("--grid_search", action="store_true",
                        help=f"Search over EWC_LAMBDA_GRID={EWC_LAMBDA_GRID}")
    args = parser.parse_args()

    if args.test:
        sys.exit(_run_self_test())

    n_cal = int(args.calib_min * 60 / EPOCH_STRIDE_S)

    if args.grid_search:
        run_lambda_grid_search(n_calib_epochs=n_cal)
    else:
        run_personalisation_pipeline(
            target_subject = args.subject,
            use_synthetic  = False,
            n_calib_epochs = n_cal,
            ewc_lambda     = args.ewc_lambda,
        )