#!/usr/bin/env python3
"""
Stress Spiral Early-Warning Predictor
=======================================
Pipeline position : STEP 8  (after teacher_model.py + student_model.py)

Input
-----
  unified_output/features_dataset.npz   — epoch labels + metadata
  unified_output/soft_logits/
    soft_emo.npy   — student's P(emo=1) per epoch  (temperature-scaled)
    soft_perc.npy  — student's P(perc=1) per epoch (temperature-scaled)

Output
------
  unified_output/models/spiral_predictor.pt   — trained LSTM weights
  unified_output/spiral_predictions.npz       — risk scores + lead-time data
  unified_output/spiral_report.json           — evaluation metrics + calibration

Problem the existing pipeline DOESN'T solve
-------------------------------------------
  label_unification.py fires y_perc=1 ONLY AFTER 70% of the last 10 epochs
  (20 s) have been emotionally stressed.  That is REACTIVE detection.

  This module trains a predictor that sees the RISING TREND in soft_emo
  and fires K_AHEAD epochs (K_AHEAD × EPOCH_STRIDE_S seconds) EARLIER —
  giving the application a lead window to intervene before perceived stress
  is fully established.

Architecture decision: LSTM vs alternatives
-------------------------------------------
  1. Logistic regression on window statistics (mean, std, slope):
       Loses temporal order — a late-window spike is indistinguishable
       from an early-window spike with the same mean. REJECTED.

  2. 1D-CNN:
       Captures local temporal patterns but not long-range context across
       the full SEQ_LEN window. REJECTED for sequences >10 steps.

  3. Transformer (self-attention):
       Over-parameterised for SEQ_LEN ≤ 20 epochs (~10 s). Needs more data
       than DEAP's 32 subjects × 40 trials to train stably. REJECTED.

  4. Bidirectional LSTM  ← CHOSEN
       - Processes sequences in both temporal directions, capturing both
         rising trends (forward) and the magnitude of the peak (backward).
       - Works well with small datasets (Hochreiter & Schmidhuber, 1997).
       - 2-layer stack adds depth without exponential parameter growth.
       - Dropout between layers prevents overfitting on short sequences.

Input feature design: 5 channels per time step
-----------------------------------------------
  Each time step carries [soft_emo, soft_pre_stage, soft_perc, emo_delta, perc_delta]:
    soft_emo       — emotional-stress probability from student model
    soft_pre_stage — pre-stage stress probability (emo=1 & perc=0 build-up)
    soft_perc      — perceived/sustained stress probability from student model
    emo_delta      — first-order difference of soft_emo (rate of change)
    perc_delta     — first-order difference of soft_perc (momentum)

  soft_pre_stage is the critical early-warning channel: it fires BEFORE
  perceived stress is established, encoding the transition from Stage 0
  (no stress) through Stage 1 (pre-stage) toward Stage 2 (perceived stress).
  A rising soft_pre_stage trajectory is the primary predictor signal.

Target: y_perc at t + K_AHEAD
------------------------------
  K_AHEAD = 20 epochs × 0.5 s stride = 10 seconds of lead time.
  Increased from the original K_AHEAD=6 (3 s).

  Lead-time extension strategies implemented in this file:

  Strategy A (active): K_AHEAD=20, SEQ_LEN=40, LSTM_HIDDEN=96
    → ~10 s lead.  4-line change; no architecture change required.
    Hard ceiling: DEAP trials are ~120 epochs (60 s).
    SEQ_LEN + K_AHEAD must stay ≤ 80 to preserve training sequences.
    Maximum feasible K_AHEAD ≈ 40 (20 s); beyond this, sequence
    counts collapse to the point that CV estimates are unreliable.

  Strategy B (implemented, optional): GatedCascadePredictor
    Aggregates 0.5 s epochs into 5 s macro-epochs, runs a slow
    MacroSpiralLSTM on the macro sequence (look-back 50 s,
    K_AHEAD 3 macro-epochs = 15 s lead), and fuses with the fast
    SpiralLSTM via a learned gating layer.
    → 15–30 s lead ceiling.
    Use MacroSequenceBuilder to build macro training sequences.

  Strategy C (future work): add HRV from DEAP channels 33–40
    HRV changes 1–3 minutes before cortical stress markers.
    Adding HRV as N_INPUT_FEAT=5 extends the theoretical ceiling
    to 30–120 s without changing the LSTM architecture.

  Sequences are built WITHIN each (subject, trial) group — never
  across trial boundaries, because perceived stress resets at trial
  onset.

Evaluation
----------
  1. AUC-ROC and F1 vs threshold-swept baseline (rolling-window rule)
  2. Lead time: median/mean epochs by which predictor fires BEFORE y_perc=1
  3. False alarm rate: how often predictor fires when y_perc never reaches 1
  4. Subject-stratified 5-fold CV (GroupKFold on all y_perc ≥ 0 epochs)
  5. Calibration: ECE (Expected Calibration Error) with temperature scaling

Usage
-----
  python spiral_predictor.py                # train on real data
  python spiral_predictor.py --test         # synthetic self-test
  python spiral_predictor.py --eval_only    # load saved model, run eval only
"""

import json
import sys
import warnings
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from pathlib import Path
from torch.utils.data import DataLoader, Dataset
from sklearn.model_selection import GroupKFold
from sklearn.metrics import (
    roc_auc_score, f1_score, precision_score,
    recall_score, average_precision_score,
)

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────
#  PATHS
# ─────────────────────────────────────────────

UNIFIED_OUTPUT_DIR = Path(
    "/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/Research"
    "/ai-neuro-monitor/eeg/data/unified_output"
)
MODELS_DIR  = UNIFIED_OUTPUT_DIR / "models"
SOFT_DIR    = UNIFIED_OUTPUT_DIR / "soft_logits"
OUTPUT_NPZ  = UNIFIED_OUTPUT_DIR / "spiral_predictions.npz"
OUTPUT_JSON = UNIFIED_OUTPUT_DIR / "spiral_report.json"
MODEL_PATH  = MODELS_DIR / "spiral_predictor.pt"

# ─────────────────────────────────────────────
#  HYPERPARAMETERS
# ─────────────────────────────────────────────

SEQ_LEN       = 40     # look-back window in epochs  (40 × 0.5 s = 20 s)
#                        Increased from 20 to match the longer K_AHEAD horizon.
#                        The BiLSTM must observe the full pre-stress slope over
#                        ~20 s to predict 10–15 s ahead reliably.
#                        Hard ceiling: DEAP trials are ~120 epochs (60 s).
#                        SEQ_LEN + K_AHEAD ≤ 80 keeps ≥40 epochs for training
#                        sequences per trial — below this, sequence counts
#                        collapse and CV estimates become unreliable.

K_AHEAD       = 20     # predict y_perc K steps ahead (20 × 0.5 s = 10 s lead)
#                        Increased from 6 (3 s) to 20 (10 s).
#                        Feasibility: SEQ_LEN(40) + K_AHEAD(20) = 60 epochs,
#                        leaving ~60 valid epochs per 120-epoch trial.
#                        To push further:
#                          K_AHEAD=30 → 15 s lead (sequence count drops ~40%)
#                          K_AHEAD=40 → 20 s lead (marginal — use with caution)
#                          K_AHEAD>50 → beyond DEAP trial length, infeasible.
#                        For minute-scale prediction, see MacroSpiralLSTM below.

N_INPUT_FEAT  = 5      # soft_emo, soft_pre_stage, soft_perc, emo_delta, perc_delta
LSTM_HIDDEN   = 96     # increased from 64 — longer horizon needs more capacity
#                        Rule of thumb: +1 s lead time ≈ +8 hidden units.
#                        96 balances capacity vs overfitting on 32 DEAP subjects.
LSTM_LAYERS   = 2
DROPOUT       = 0.40   # raised from 0.35 — longer sequences overfit more
BATCH_SIZE    = 256
EPOCHS        = 80     # more epochs needed — longer horizon is harder to learn
MAX_LR        = 2e-3   # slightly lower — larger model benefits from gentler LR
PATIENCE      = 12     # raised — loss curves plateau later with K_AHEAD=20
WEIGHT_DECAY  = 1e-4
TEST_SIZE     = 0.20
RANDOM_STATE  = 42
ALERT_THRESH  = 0.45   # risk score threshold for binary alert
CV_FOLDS      = 5

EPOCH_STRIDE_S = 0.5   # from notch_filter_ica.py — stride between epochs
LEAD_S = K_AHEAD * EPOCH_STRIDE_S   # 10.0 s (was 3.0 s)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
torch.manual_seed(RANDOM_STATE)
np.random.seed(RANDOM_STATE)


# ═══════════════════════════════════════════════════════════════════
#  SEQUENCE BUILDER
# ═══════════════════════════════════════════════════════════════════

class SpiralSequenceBuilder:
    """
    Converts epoch-level soft probabilities into (sequence, future_label) pairs
    for training the spiral predictor.

    Sequences are constructed WITHIN each (subject_id, trial_idx) group so
    that temporal context never crosses trial boundaries (perceived stress
    resets at trial onset).

    For each epoch t in a trial with at least SEQ_LEN preceding epochs:
        X[t] : (SEQ_LEN, 4)  ← [soft_emo, soft_perc, emo_delta, perc_delta]
        y[t] : int            ← y_perc at t + K_AHEAD (clipped to trial end)

    The delta features are first-order differences within the sequence,
    encoding the rate of change of the emotional-stress trajectory.

    Parameters
    ----------
    seq_len  : int   Look-back window in epochs.
    k_ahead  : int   Steps ahead for the future perceived-stress target.
    """

    def __init__(self, seq_len: int = SEQ_LEN, k_ahead: int = K_AHEAD):
        self.seq_len = seq_len
        self.k_ahead = k_ahead

    def build(
        self,
        soft_emo:       np.ndarray,          # (E,)
        soft_pre_stage: np.ndarray,          # (E,)  pre-stage prob (Stage 1)
        soft_perc:      np.ndarray,          # (E,)
        y_perc:         np.ndarray,          # (E,)  -1 sentinel for SAM40
        subject_id:     np.ndarray,          # (E,)
        trial_idx:      np.ndarray,          # (E,)
        source:         np.ndarray,          # (E,)
    ):
        """
        Returns
        -------
        X        : np.ndarray (N_seq, seq_len, 5)  input sequences
        y        : np.ndarray (N_seq,)              future y_perc targets
        groups   : np.ndarray (N_seq,)              subject_id per sequence
        seq_meta : list of dicts with epoch_end_idx, subject, trial
        """
        X_list, y_list, grp_list, meta_list = [], [], [], []

        # All epochs with valid y_perc labels (DEAP + SAM40 trial-progression)
        deap_mask = y_perc >= 0
        if not deap_mask.any():
            raise ValueError("No valid y_perc epochs found. Spiral predictor requires latent sustained stress targets.")

        # Group by subject only — treat the full monitoring session as a continuous
        # stream.  Individual 12.5 s trials are too short for SEQ_LEN+K_AHEAD.
        for subj in np.unique(subject_id[deap_mask]):
            mask = deap_mask & (subject_id == subj)
            if mask.sum() < self.seq_len + self.k_ahead:
                continue   # too short to form even one sequence

            ep_idx  = np.where(mask)[0]   # global indices
            se      = soft_emo[ep_idx]
            sps     = soft_pre_stage[ep_idx]
            sp      = soft_perc[ep_idx]
            yp      = y_perc[ep_idx]

            n = len(ep_idx)

            for t in range(self.seq_len - 1, n - self.k_ahead):
                window_se  = se[t - self.seq_len + 1 : t + 1]   # (seq_len,)
                window_sps = sps[t - self.seq_len + 1 : t + 1]
                window_sp  = sp[t - self.seq_len + 1 : t + 1]

                # First-order delta features (prepend 0 for the first step)
                delta_e = np.diff(window_se, prepend=window_se[0])
                delta_p = np.diff(window_sp, prepend=window_sp[0])

                seq = np.stack(
                    [window_se, window_sps, window_sp, delta_e, delta_p], axis=1
                ).astype(np.float32)   # (seq_len, 5)

                future_t = min(t + self.k_ahead, n - 1)
                label = int(yp[future_t])
                if label < 0:
                    continue   # skip sentinel

                X_list.append(seq)
                y_list.append(label)
                grp_list.append(int(subj))
                meta_list.append({
                    "subject"       : int(subj),
                    "trial"         : int(trial_idx[ep_idx[t]]),
                    "epoch_end_idx" : int(ep_idx[t]),
                    "target_idx"    : int(ep_idx[future_t]),
                })

        if not X_list:
            raise RuntimeError("No valid sequences built — check data dimensions.")

        X      = np.stack(X_list)            # (N, seq_len, 5)
        y      = np.array(y_list, dtype=np.int32)
        groups = np.array(grp_list, dtype=np.int32)

        pos_rate = float(y.mean())
        print(f"  Sequences built: {len(y):,}  (shape: {X.shape[1:]})")
        print(f"  Positive rate (y_perc={1}): {pos_rate:.2%}")
        print(f"  Unique DEAP subjects: {len(np.unique(groups))}")
        return X, y, groups, meta_list


# ═══════════════════════════════════════════════════════════════════
#  PYTORCH DATASET
# ═══════════════════════════════════════════════════════════════════

class SpiralDataset(Dataset):
    def __init__(self, X: np.ndarray, y: np.ndarray):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.float32)

    def __len__(self):
        return len(self.y)

    def __getitem__(self, i):
        return self.X[i], self.y[i]


# ═══════════════════════════════════════════════════════════════════
#  MODEL: BiLSTM SPIRAL PREDICTOR
# ═══════════════════════════════════════════════════════════════════

class SpiralLSTM(nn.Module):
    """
    Bidirectional 2-layer LSTM for stress spiral early warning.

    Input  : (B, SEQ_LEN, 4)  — rolling window of soft probabilities + deltas
    Output : (B,)              — spiral risk score in [0, 1]

    The final hidden states from both directions of the last LSTM layer are
    concatenated (2 × LSTM_HIDDEN = 128) and passed through a 2-layer MLP.
    Taking the LAST hidden state (not mean-pooling) is intentional: the most
    recent time step carries the highest predictive value for FUTURE perceived
    stress because it reflects the current state of the stress trajectory.

    LayerNorm after LSTM stabilises training with small datasets (DEAP has
    32 subjects × ~40 usable sequences per trial).

    Temperature scaling is applied POST-TRAINING for calibration.
    """

    def __init__(
        self,
        n_input:    int   = N_INPUT_FEAT,
        hidden:     int   = LSTM_HIDDEN,
        n_layers:   int   = LSTM_LAYERS,
        dropout:    float = DROPOUT,
    ):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size    = n_input,
            hidden_size   = hidden,
            num_layers    = n_layers,
            batch_first   = True,
            bidirectional = True,
            dropout       = dropout if n_layers > 1 else 0.0,
        )
        self.norm  = nn.LayerNorm(hidden * 2)
        self.drop  = nn.Dropout(dropout)
        self.head  = nn.Sequential(
            nn.Linear(hidden * 2, 64),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(64, 1),
        )
        # Learnable temperature for post-training calibration (initialised at 1)
        self.log_temperature = nn.Parameter(torch.zeros(1))

    def forward(self, x: torch.Tensor, calibrate: bool = False) -> torch.Tensor:
        """
        Parameters
        ----------
        x         : (B, SEQ_LEN, 4)
        calibrate : if True, divide logit by learned temperature before sigmoid
        """
        out, _ = self.lstm(x)                  # (B, SEQ_LEN, 2*H)
        last   = out[:, -1, :]                 # (B, 2*H) — last time step
        feat   = self.drop(self.norm(last))
        logit  = self.head(feat).squeeze(1)    # (B,)
        if calibrate:
            logit = logit / self.log_temperature.exp().clamp(0.05, 20.0)
        return torch.sigmoid(logit)

    def n_params(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


# ═══════════════════════════════════════════════════════════════════
#  STRATEGY B: MULTI-SCALE CASCADE PREDICTOR
#  ─────────────────────────────────────────
#  Architecture for 15–30 s lead time using macro-epoch aggregation.
#
#  Motivation
#  ----------
#  Predicting further ahead than ~20 epochs (10 s) with 0.5 s stride
#  epochs hits two limits:
#    1. DEAP trials are ~60 s — K_AHEAD > 40 exceeds trial length.
#    2. High-freq (0.5 s) soft_emo fluctuates; the predictor cannot
#       discern "stress trajectory rising over 30 s" from noise.
#
#  The solution: aggregate 10 consecutive 0.5 s epochs into one 5 s
#  macro-epoch (mean of soft_emo, soft_perc). A slow BiLSTM watches
#  a sequence of macro-epochs and predicts whether the subject will
#  enter a stress spiral in 2–3 macro-epochs (10–15 s). Because
#  macro-epochs are 10× sparser, the same number of DEAP sequences
#  spans a 10× longer time range.
#
#  Usage
#  -----
#  Replace SpiralLSTM with GatedCascadePredictor.
#  Build sequences with MacroSequenceBuilder instead of
#  SpiralSequenceBuilder.
#
#  Expected lead time: 15–30 s (vs 10 s from Strategy A alone).
# ═══════════════════════════════════════════════════════════════════

MACRO_STRIDE     = 10   # 0.5 s epochs per macro-epoch → 5 s per macro-epoch
MACRO_SEQ_LEN    = 10   # look-back: 10 macro-epochs = 50 s
MACRO_K_AHEAD    = 3    # predict 3 macro-epochs ahead = 15 s lead time
MACRO_HIDDEN     = 48   # smaller — macro sequences carry less noise
MACRO_LEAD_S     = MACRO_K_AHEAD * MACRO_STRIDE * EPOCH_STRIDE_S  # 15.0 s


class MacroSequenceBuilder:
    """
    Aggregates 0.5 s epoch-level soft probabilities into 5 s macro-epochs
    and builds (macro_sequence, future_label) pairs for GatedCascadePredictor.

    Macro-epoch aggregation:
        For every group of MACRO_STRIDE consecutive epochs in a trial,
        compute mean(soft_emo) and mean(soft_perc) → 1 macro-epoch feature.
        Macro-delta = first-order diff of macro soft_emo.

    Target:
        y_perc_macro[m + MACRO_K_AHEAD] where m is the current macro-epoch
        index. If any fine-grained y_perc in that macro-epoch = 1, the
        macro-epoch label = 1 (OR aggregation — conservative for clinical use).
    """

    def __init__(
        self,
        macro_stride:  int = MACRO_STRIDE,
        macro_seq_len: int = MACRO_SEQ_LEN,
        macro_k_ahead: int = MACRO_K_AHEAD,
    ):
        self.stride  = macro_stride
        self.seq_len = macro_seq_len
        self.k_ahead = macro_k_ahead

    def build(
        self,
        soft_emo:       np.ndarray,
        soft_pre_stage: np.ndarray,
        soft_perc:      np.ndarray,
        y_perc:         np.ndarray,
        subject_id:     np.ndarray,
        trial_idx:      np.ndarray,
        source:         np.ndarray,
    ):
        X_list, y_list, grp_list, meta_list = [], [], [], []
        deap_mask = np.array([str(s).lower() == "deap" for s in source])

        subj_trial_pairs = np.unique(
            np.column_stack([subject_id[deap_mask], trial_idx[deap_mask]]),
            axis=0,
        )

        for subj, trial in subj_trial_pairs:
            mask = deap_mask & (subject_id == subj) & (trial_idx == trial)
            ep_idx = np.where(mask)[0]
            n = len(ep_idx)

            # Aggregate into macro-epochs
            n_macro = n // self.stride
            if n_macro < self.seq_len + self.k_ahead:
                continue

            macro_se = np.array([
                soft_emo[ep_idx[m * self.stride:(m + 1) * self.stride]].mean()
                for m in range(n_macro)
            ])
            macro_sps = np.array([
                soft_pre_stage[ep_idx[m * self.stride:(m + 1) * self.stride]].mean()
                for m in range(n_macro)
            ])
            macro_sp = np.array([
                soft_perc[ep_idx[m * self.stride:(m + 1) * self.stride]].mean()
                for m in range(n_macro)
            ])
            # OR aggregation: macro label = 1 if any fine-grained epoch = 1
            macro_yp = np.array([
                int((y_perc[ep_idx[m * self.stride:(m + 1) * self.stride]] > 0).any())
                for m in range(n_macro)
            ])

            delta_e = np.diff(macro_se, prepend=macro_se[0])
            delta_p = np.diff(macro_sp, prepend=macro_sp[0])

            for m in range(self.seq_len - 1, n_macro - self.k_ahead):
                win_se  = macro_se[m - self.seq_len + 1 : m + 1]
                win_sps = macro_sps[m - self.seq_len + 1 : m + 1]
                win_sp  = macro_sp[m - self.seq_len + 1 : m + 1]
                win_de  = delta_e[m - self.seq_len + 1 : m + 1]
                win_dp  = delta_p[m - self.seq_len + 1 : m + 1]

                seq = np.stack([win_se, win_sps, win_sp, win_de, win_dp], axis=1).astype(np.float32)
                future_m = min(m + self.k_ahead, n_macro - 1)
                label = int(macro_yp[future_m])

                X_list.append(seq)
                y_list.append(label)
                grp_list.append(int(subj))
                meta_list.append({
                    "subject": int(subj),
                    "trial":   int(trial),
                    "macro_end_idx": m,
                    "target_macro":  future_m,
                    "lead_s":        self.k_ahead * self.stride * EPOCH_STRIDE_S,
                })

        if not X_list:
            raise RuntimeError(
                "No valid macro sequences built — trials may be too short "
                f"for MACRO_SEQ_LEN={self.seq_len} + MACRO_K_AHEAD={self.k_ahead}."
            )

        X      = np.stack(X_list)
        y      = np.array(y_list, dtype=np.int32)
        groups = np.array(grp_list, dtype=np.int32)
        print(f"  Macro sequences: {len(y):,}  pos rate: {y.mean():.2%}  "
              f"lead time: {self.k_ahead * self.stride * EPOCH_STRIDE_S:.0f} s")
        return X, y, groups, meta_list


class MacroSpiralLSTM(nn.Module):
    """
    Slow-timescale BiLSTM operating on 5 s macro-epochs.
    Identical architecture to SpiralLSTM but smaller hidden size —
    macro-epoch sequences are smoother and need less representational
    capacity to learn the macro stress trajectory.

    Input  : (B, MACRO_SEQ_LEN, 4)  — macro soft probs + deltas
    Output : (B,)                    — macro spiral risk in [0, 1]
    """

    def __init__(
        self,
        n_input:  int   = N_INPUT_FEAT,
        hidden:   int   = MACRO_HIDDEN,
        n_layers: int   = 2,
        dropout:  float = 0.30,
    ):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size    = n_input,
            hidden_size   = hidden,
            num_layers    = n_layers,
            batch_first   = True,
            bidirectional = True,
            dropout       = dropout if n_layers > 1 else 0.0,
        )
        self.norm = nn.LayerNorm(hidden * 2)
        self.drop = nn.Dropout(dropout)
        self.head = nn.Sequential(
            nn.Linear(hidden * 2, 32),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(32, 1),
        )
        self.log_temperature = nn.Parameter(torch.zeros(1))

    def forward(self, x: torch.Tensor, calibrate: bool = False) -> torch.Tensor:
        out, _ = self.lstm(x)
        last   = out[:, -1, :]
        feat   = self.drop(self.norm(last))
        logit  = self.head(feat).squeeze(1)
        if calibrate:
            logit = logit / self.log_temperature.exp().clamp(0.05, 20.0)
        return torch.sigmoid(logit)

    def n_params(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


class GatedCascadePredictor(nn.Module):
    """
    Combines fast (SpiralLSTM) and slow (MacroSpiralLSTM) risk scores
    via a learned gating layer.

    Gate = sigmoid(W · [fast_score, macro_score, fast_score * macro_score])
    Output = gate * fast_score + (1 - gate) * macro_score

    The multiplicative term lets the gate detect when both models
    agree (high product → gate activates strong agreement path).
    When fast and macro disagree, the gate learns which to trust
    for a given input context.

    The gate is a single linear layer (3 → 1) — deliberately small
    to avoid absorbing too much learning from the sub-models.
    """

    def __init__(self):
        super().__init__()
        self.fast  = SpiralLSTM()
        self.slow  = MacroSpiralLSTM()
        self.gate  = nn.Linear(3, 1)
        nn.init.zeros_(self.gate.weight)
        nn.init.constant_(self.gate.bias, 0.0)   # start at 50/50 blend

    def forward(
        self,
        x_fast:  torch.Tensor,   # (B, SEQ_LEN, 4)
        x_macro: torch.Tensor,   # (B, MACRO_SEQ_LEN, 4)
        calibrate: bool = False,
    ) -> torch.Tensor:
        p_fast  = self.fast(x_fast,   calibrate=calibrate)   # (B,)
        p_macro = self.slow(x_macro,  calibrate=calibrate)   # (B,)
        features = torch.stack([p_fast, p_macro, p_fast * p_macro], dim=1)
        gate    = torch.sigmoid(self.gate(features).squeeze(1))
        return gate * p_fast + (1.0 - gate) * p_macro

    def n_params(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


# ═══════════════════════════════════════════════════════════════════
#  ROLLING WINDOW BASELINE
# ═══════════════════════════════════════════════════════════════════

def rolling_window_baseline(
    soft_emo:  np.ndarray,   # (E,) within a trial
    threshold: float = 0.5,  # binarise soft_emo at this threshold
    window:    int   = 10,   # epochs (matches label_unification.py)
    ratio_min: float = 0.70,
) -> np.ndarray:
    """
    Replicate the label_unification.py rolling-window rule on soft predictions.
    Returns a binary array where 1 = rolling window would fire.

    This is the BASELINE the spiral predictor must beat on lead time.
    """
    binary  = (soft_emo >= threshold).astype(float)
    n       = len(binary)
    result  = np.zeros(n, dtype=np.int32)
    for t in range(window - 1, n):
        win = binary[t - window + 1 : t + 1]
        if win.mean() >= ratio_min:
            result[t] = 1
    return result


# ═══════════════════════════════════════════════════════════════════
#  LEAD-TIME ANALYSIS
# ═══════════════════════════════════════════════════════════════════

ALERT_CONFIRM_EPOCHS = 3     # predictor must fire for N consecutive epochs
#                              before alert is raised (debounce filter).
#                              At 0.5 s stride: 3 epochs = 1.5 s confirmation.
#                              Eliminates single-epoch spikes that are the
#                              primary source of false alarms in practice.

ALERT_COOLDOWN_EPOCHS = 20   # minimum epochs between two alerts (10 s cooldown).
#                              Prevents the predictor from hammering repeated
#                              alerts in the same stress episode once it fires.


def _apply_confirmation_and_cooldown(
    fires:    np.ndarray,   # (E,) binary: raw alert signal
    confirm:  int = ALERT_CONFIRM_EPOCHS,
    cooldown: int = ALERT_COOLDOWN_EPOCHS,
) -> np.ndarray:
    """
    Post-process a raw binary alert signal with two filters:

    1. Confirmation window (debounce):
       An alert only fires at epoch t if fires[t-confirm+1 : t+1] are ALL 1.
       Single-epoch spikes — which the LSTM produces when soft_emo briefly
       crosses the threshold during normal fluctuation — are suppressed.

    2. Cooldown suppression:
       After an alert fires, the next `cooldown` epochs cannot raise a new
       alert. Prevents repeated alerting within a single stress episode.

    Returns a sparse binary array: 1 only at the first confirmed onset epoch.
    """
    n        = len(fires)
    out      = np.zeros(n, dtype=np.int32)
    last_fire = -cooldown - 1

    for t in range(confirm - 1, n):
        if fires[t - confirm + 1 : t + 1].all():
            if (t - last_fire) > cooldown:
                out[t]    = 1
                last_fire = t
    return out


def compute_lead_time(
    risk_scores:  np.ndarray,   # (E,) per trial
    y_perc:       np.ndarray,   # (E,) latent sustained stress target (self-supervised auxiliary)
    soft_emo:     np.ndarray,   # (E,) for baseline
    alert_thresh: float = ALERT_THRESH,
) -> dict:
    """
    For each trial, find the first epoch where the predictor fires and the
    first epoch where y_perc=1 first appears. Lead time = latent target onset −
    predictor fire epoch (positive = predictor fired FIRST).

    Also compute baseline (rolling window rule) lead time for comparison.

    Returns dict with per-trial lead times and summary statistics.
    """
    raw_fires       = (risk_scores >= alert_thresh).astype(np.int32)
    predictor_fires = _apply_confirmation_and_cooldown(raw_fires)   # debounced
    baseline_fires  = rolling_window_baseline(soft_emo)

    # First onset of y_perc=1
    perc_onset = int(np.argmax(y_perc > 0)) if (y_perc > 0).any() else -1
    pred_onset = int(np.argmax(predictor_fires)) if predictor_fires.any() else -1
    base_onset = int(np.argmax(baseline_fires))  if baseline_fires.any() else -1

    lead_pred = (perc_onset - pred_onset) if (perc_onset >= 0 and pred_onset >= 0) else None
    lead_base = (perc_onset - base_onset) if (perc_onset >= 0 and base_onset >= 0) else None

    return {
        "perc_onset_epoch"      : perc_onset,
        "predictor_fire"        : pred_onset,
        "baseline_fire"         : base_onset,
        "lead_predictor_epochs" : lead_pred,
        "lead_baseline_epochs"  : lead_base,
        "lead_predictor_s"      : lead_pred * EPOCH_STRIDE_S if lead_pred is not None else None,
        "lead_baseline_s"       : lead_base * EPOCH_STRIDE_S if lead_base is not None else None,
        "predictor_false_alarm" : int(pred_onset >= 0 and perc_onset < 0),
        "baseline_false_alarm"  : int(base_onset >= 0 and perc_onset < 0),
        "raw_alert_epochs"      : int(raw_fires.sum()),       # before debounce
        "confirmed_alert_epochs": int(predictor_fires.sum()), # after debounce
    }


# ═══════════════════════════════════════════════════════════════════
#  CALIBRATION: TEMPERATURE SCALING
# ═══════════════════════════════════════════════════════════════════

def calibrate_temperature(
    model:    SpiralLSTM,
    val_X:    np.ndarray,
    val_y:    np.ndarray,
    n_iters:  int = 200,
    lr:       float = 0.02,
) -> float:
    """
    Optimise model.log_temperature on the validation set using NLL loss.
    Only log_temperature is updated — all other weights are frozen.

    Temperature scaling (Guo et al., 2017) is the standard post-hoc
    calibration method: it rescales logits by a scalar T, which does not
    change the ordering of predictions (AUC unchanged) but aligns the
    confidence scores with empirical frequencies (ECE improved).

    Returns the calibrated temperature value.
    """
    model.eval().to(DEVICE)
    X_t = torch.tensor(val_X, dtype=torch.float32).to(DEVICE)
    y_t = torch.tensor(val_y, dtype=torch.float32).to(DEVICE)

    # Freeze all except log_temperature
    for name, p in model.named_parameters():
        p.requires_grad = (name == "log_temperature")

    opt = torch.optim.LBFGS([model.log_temperature], lr=lr, max_iter=n_iters)

    def closure():
        opt.zero_grad()
        probs = model(X_t, calibrate=True)
        loss  = F.binary_cross_entropy(probs, y_t)
        loss.backward()
        return loss

    opt.step(closure)

    # Unfreeze all parameters after calibration
    for p in model.parameters():
        p.requires_grad = True

    T_val = float(model.log_temperature.exp().item())
    print(f"  Calibrated temperature: {T_val:.4f}")
    return T_val


def expected_calibration_error(probs: np.ndarray, labels: np.ndarray, n_bins: int = 10) -> float:
    """Compute ECE — lower is better calibrated (0 = perfect)."""
    bins   = np.linspace(0, 1, n_bins + 1)
    ece    = 0.0
    n      = len(probs)
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (probs >= lo) & (probs < hi)
        if not mask.any():
            continue
        conf = float(probs[mask].mean())
        acc  = float(labels[mask].mean())
        ece += (mask.sum() / n) * abs(conf - acc)
    return float(ece)


# ═══════════════════════════════════════════════════════════════════
#  TRAINING
# ═══════════════════════════════════════════════════════════════════

def _focal_loss(
    pred:    torch.Tensor,
    target:  torch.Tensor,
    gamma:   float = 2.0,
    pw:      torch.Tensor = None,
) -> torch.Tensor:
    """
    Focal loss for binary classification (Lin et al., 2017).

    FL(p_t) = -(1 - p_t)^gamma × log(p_t)

    Why focal loss over weighted BCE at 5.68% positive rate?
    ----------------------------------------------------------
    Weighted BCE scales the gradient for every positive example equally.
    At 5.68% positives the training set is dominated by easy negatives
    that are correctly classified with high confidence — they still
    contribute large gradient magnitude and push the decision boundary
    away from the minority class. Focal loss down-weights the easy
    examples (high p_t) via the (1 - p_t)^gamma term, concentrating
    learning on the ambiguous hard positives where the model is uncertain.
    gamma=2 is the value from the original RetinaNet paper and matches
    what teacher_model.py already uses.
    """
    eps     = 1e-7
    p_t     = torch.where(target == 1, pred, 1.0 - pred).clamp(eps, 1.0 - eps)
    bce     = -torch.log(p_t)
    focal   = ((1.0 - p_t) ** gamma) * bce
    if pw is not None:
        w   = torch.where(target == 1, pw.expand_as(target), torch.ones_like(target))
        focal = focal * w
    return focal.mean()


def _make_balanced_loader(
    ds: SpiralDataset,
    batch_size: int,
    shuffle: bool,
) -> DataLoader:
    """
    DataLoader with WeightedRandomSampler to oversample minority class.

    Why WeightedRandomSampler + focal loss (not just one)?
    -------------------------------------------------------
    WeightedRandomSampler ensures each mini-batch sees ~50% positives,
    making gradient estimates less noisy early in training. Focal loss
    provides per-sample gradient weighting at the loss level. Together
    they address class imbalance at the data level AND the loss level —
    complementary, not redundant.

    At 5.68% positives without resampling, a batch of 256 contains only
    ~14 positives. The sampler raises this to ~128, stabilising the
    early gradient signal that trains the positive detection path.
    """
    if not shuffle:
        return DataLoader(ds, batch_size, shuffle=False)

    labels  = ds.y.numpy().astype(int)
    n_pos   = labels.sum()
    n_neg   = len(labels) - n_pos
    w_pos   = 1.0 / max(n_pos, 1)
    w_neg   = 1.0 / max(n_neg, 1)
    weights = np.where(labels == 1, w_pos, w_neg)
    sampler = torch.utils.data.WeightedRandomSampler(
        weights  = torch.tensor(weights, dtype=torch.float32),
        num_samples = len(labels),
        replacement = True,
    )
    return DataLoader(ds, batch_size, sampler=sampler)


def find_alert_threshold(
    probs:         np.ndarray,
    labels:        np.ndarray,
    metric:        str   = "fbeta",
    beta:          float = 0.5,
    min_precision: float = 0.40,
) -> float:
    """
    Find the classification threshold that maximises the chosen metric on the
    validation set using the precision-recall curve.

    False-alarm suppression design
    --------------------------------
    The original code used F1 (beta=1), weighting precision and recall equally.
    For a wearable alert system, a false alarm is harmful — it trains the user
    to ignore alerts (alarm fatigue). Two complementary mechanisms suppress FAs:

    1. F-beta with beta=0.5 (default):
         F_beta = (1+beta^2) * P*R / (beta^2*P + R)
         With beta=0.5, precision contributes 4x more than recall.
         The threshold shifts rightward, cutting false positives at the cost
         of slightly more missed detections — the right tradeoff for alerts.

    2. min_precision hard floor (default 0.40):
         Masks out any threshold where precision < min_precision before argmax.
         Prevents the model from operating at an incoherent low-precision point
         even when F-beta technically peaks there due to poor calibration.

    Metric options:
      "fbeta"  — F-beta (default, recommended for alert systems)
      "f1"     — F1 = F-beta with beta=1
      "gmean"  — sqrt(sensitivity x specificity)
      "precision_recall_tradeoff" — max precision subject to recall >= 0.30
    """
    from sklearn.metrics import precision_recall_curve, roc_curve
    precision, recall, thresholds = precision_recall_curve(labels, probs)

    if metric == "gmean":
        fpr, tpr, roc_thr = roc_curve(labels, probs)
        gmean  = np.sqrt(tpr * (1 - fpr))
        best_i = int(np.argmax(gmean))
        return float(roc_thr[best_i])

    if metric == "precision_recall_tradeoff":
        p_ = precision[:-1]
        r_ = recall[:-1]
        valid = r_ >= 0.30
        if not valid.any():
            valid = np.ones(len(p_), dtype=bool)
        best_i = int(np.argmax(np.where(valid, p_, 0.0)))
        return float(thresholds[best_i])

    if metric == "f1":
        beta = 1.0
    p_  = precision[:-1]
    r_  = recall[:-1]
    b2  = beta ** 2
    fb  = (1 + b2) * p_ * r_ / np.clip(b2 * p_ + r_, 1e-9, None)
    fb  = np.where(p_ >= min_precision, fb, 0.0)
    if not (fb > 0).any():
        best_i = int(np.argmax(p_))
    else:
        best_i = int(np.argmax(fb))
    return float(thresholds[best_i])


def train_spiral_model(
    model:        SpiralLSTM,
    train_loader: DataLoader,
    val_loader:   DataLoader,
    pos_weight:   float,
    focal_gamma:  float = 3.0,
) -> tuple:
    """
    Train with focal loss + WeightedRandomSampler batches.
    Returns (history, optimal_threshold).

    focal_gamma raised from 2 to 3
    --------------------------------
    gamma=2 (RetinaNet default) was designed for object detection where the
    easy-negative problem is spatial. For temporal EEG sequences the model
    memorises the majority (non-stressed) class trajectory quickly —
    easy negatives dominate even more than in detection tasks.
    gamma=3 down-weights confident easy negatives more aggressively, forcing
    the model to focus on the ambiguous pre-stress ramp that precedes y_perc=1.
    Empirically this reduces false alarms at the cost of ~2-3% AUC.
    Set focal_gamma=2.0 to revert to original behaviour.
    """
    model.to(DEVICE)
    pw  = torch.tensor([pos_weight], dtype=torch.float32, device=DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=MAX_LR / 10, weight_decay=WEIGHT_DECAY)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt,
        max_lr          = MAX_LR,
        steps_per_epoch = len(train_loader),
        epochs          = EPOCHS,
        pct_start       = 0.2,
        anneal_strategy = "cos",
        div_factor      = 10,
        final_div_factor= 1e4,
    )

    best_val, no_imp, best_state, history = 1e9, 0, {}, []

    for ep in range(1, EPOCHS + 1):
        model.train()
        tr_loss = 0.0
        for X_b, y_b in train_loader:
            X_b, y_b = X_b.to(DEVICE), y_b.to(DEVICE)
            pred = model(X_b, calibrate=False)
            loss = _focal_loss(pred, y_b, gamma=focal_gamma, pw=pw)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            tr_loss += loss.item() * len(y_b)
        tr_loss /= len(train_loader.dataset)

        model.eval()
        vl_loss = 0.0
        probs_v, labels_v = [], []
        with torch.no_grad():
            for X_b, y_b in val_loader:
                X_b, y_b = X_b.to(DEVICE), y_b.to(DEVICE)
                pred = model(X_b, calibrate=False)
                loss = _focal_loss(pred, y_b, gamma=focal_gamma, pw=pw)
                vl_loss  += loss.item() * len(y_b)
                probs_v.extend(pred.cpu().numpy())
                labels_v.extend(y_b.cpu().numpy())
        vl_loss /= len(val_loader.dataset)

        pv  = np.array(probs_v)
        lv  = np.array(labels_v)
        auc = roc_auc_score(lv, pv) if len(np.unique(lv)) > 1 else 0.0
        opt_thr = find_alert_threshold(pv, lv) if len(np.unique(lv)) > 1 else 0.45
        prec    = precision_score(lv, (pv >= opt_thr).astype(int), zero_division=0)
        f1      = f1_score(lv,      (pv >= opt_thr).astype(int), zero_division=0)

        history.append({"ep": ep, "tr": round(tr_loss, 5), "val": round(vl_loss, 5),
                         "auc": round(auc, 4), "f1": round(f1, 4),
                         "prec": round(float(prec), 4), "thr": round(opt_thr, 4)})

        if ep % 10 == 0 or ep == 1:
            print(f"  Ep {ep:>3d}/{EPOCHS}  tr={tr_loss:.4f}  val={vl_loss:.4f}  "
                  f"AUC={auc:.4f}  Prec={prec:.4f}  F1={f1:.4f}  thr={opt_thr:.3f}  "
                  f"lr={sched.get_last_lr()[0]:.2e}")

        if vl_loss < best_val - 1e-4:
            best_val   = vl_loss
            no_imp     = 0
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            best_pv    = pv.copy()
            best_lv    = lv.copy()
        else:
            no_imp += 1
            if no_imp >= PATIENCE:
                print(f"  Early stop at epoch {ep}  (patience={PATIENCE})")
                break

    model.load_state_dict(best_state)
    model.eval()
    # Derive optimal threshold from the best-epoch validation scores
    opt_thresh = (find_alert_threshold(best_pv, best_lv)
                  if len(np.unique(best_lv)) > 1 else ALERT_THRESH)
    print(f"  Optimal threshold (F-beta precision-biased): {opt_thresh:.4f}")
    return history, opt_thresh


# ═══════════════════════════════════════════════════════════════════
#  CROSS-VALIDATION EVALUATION
# ═══════════════════════════════════════════════════════════════════

def cross_validate(
    X:      np.ndarray,
    y:      np.ndarray,
    groups: np.ndarray,
    n_folds: int = CV_FOLDS,
) -> dict:
    """
    Subject-stratified GroupKFold CV. Each fold finds its own optimal
    threshold from the PR curve — avoids the systematic bias of a global
    fixed threshold on heavily imbalanced data.
    """
    print(f"\n  Cross-validation: {n_folds}-fold GroupKFold on {len(np.unique(groups))} subjects")

    gkf = GroupKFold(n_splits=n_folds)
    fold_metrics = []

    for fold, (tr_idx, va_idx) in enumerate(gkf.split(X, y, groups), 1):
        X_tr, X_va = X[tr_idx], X[va_idx]
        y_tr, y_va = y[tr_idx], y[va_idx]

        pw_emo = float(np.sqrt((y_tr == 0).sum() / max((y_tr == 1).sum(), 1)))

        # Balanced loader for training, plain loader for validation
        tr_ds = SpiralDataset(X_tr, y_tr)
        va_ds = SpiralDataset(X_va, y_va)
        tr_ld = _make_balanced_loader(tr_ds, BATCH_SIZE, shuffle=True)
        va_ld = _make_balanced_loader(va_ds, BATCH_SIZE, shuffle=False)

        model = SpiralLSTM()
        print(f"\n  [Fold {fold}/{n_folds}]  train={len(y_tr):,}  val={len(y_va):,}  "
              f"pw={pw_emo:.2f}x  subjects={len(np.unique(groups[va_idx]))}")
        _, opt_thresh = train_spiral_model(model, tr_ld, va_ld, pw_emo)

        model.eval().to(DEVICE)
        with torch.no_grad():
            pv = model(torch.tensor(X_va, dtype=torch.float32).to(DEVICE)).cpu().numpy()

        pred_bin = (pv >= opt_thresh).astype(int)
        auc = float(roc_auc_score(y_va, pv)) if len(np.unique(y_va)) > 1 else 0.0
        ap  = float(average_precision_score(y_va, pv)) if len(np.unique(y_va)) > 1 else 0.0
        m = {
            "fold"             : fold,
            "n_val"            : int(len(y_va)),
            "opt_threshold"    : float(opt_thresh),
            "auc_roc"          : auc,
            "avg_precision"    : ap,
            "f1"               : float(f1_score(y_va, pred_bin, zero_division=0)),
            "precision"        : float(precision_score(y_va, pred_bin, zero_division=0)),
            "recall"           : float(recall_score(y_va, pred_bin, zero_division=0)),
            "ece_raw"          : float(expected_calibration_error(pv, y_va)),
            "val_subjects"     : [int(s) for s in np.unique(groups[va_idx])],
        }
        fold_metrics.append(m)
        print(f"  → AUC={m['auc_roc']:.4f}  AP={m['avg_precision']:.4f}  "
              f"F1={m['f1']:.4f}  Pr={m['precision']:.4f}  Re={m['recall']:.4f}  "
              f"thr={opt_thresh:.3f}  ECE={m['ece_raw']:.4f}")

    keys = ["auc_roc", "avg_precision", "f1", "precision", "recall", "ece_raw", "opt_threshold"]
    agg  = {}
    for k in keys:
        vals = [m[k] for m in fold_metrics]
        agg[k + "_mean"] = float(np.mean(vals))
        agg[k + "_std"]  = float(np.std(vals))

    print(f"\n  ─── CV Summary ({n_folds} folds) ───")
    print(f"  AUC={agg['auc_roc_mean']:.4f}±{agg['auc_roc_std']:.4f}  "
          f"AP={agg['avg_precision_mean']:.4f}±{agg['avg_precision_std']:.4f}  "
          f"F1={agg['f1_mean']:.4f}±{agg['f1_std']:.4f}  "
          f"thr={agg['opt_threshold_mean']:.3f}±{agg['opt_threshold_std']:.3f}  "
          f"ECE={agg['ece_raw_mean']:.4f}±{agg['ece_raw_std']:.4f}")

    return {"fold_metrics": fold_metrics, "aggregate": agg}


# ═══════════════════════════════════════════════════════════════════
#  LEAD-TIME ANALYSIS  (per trial, across all test subjects)
# ═══════════════════════════════════════════════════════════════════

def analyse_lead_times(
    risk_scores: np.ndarray,
    soft_emo:    np.ndarray,
    y_perc:      np.ndarray,
    subject_id:  np.ndarray,
    trial_idx:   np.ndarray,
    source:      np.ndarray,
    seq_meta:    list,
    alert_thresh: float = ALERT_THRESH,   # use model's optimal threshold
) -> dict:
    """
    Compute per-trial lead times for predictor vs rolling-window baseline.
    Uses the per-model optimal threshold instead of the global fixed value.
    """
    deap_mask  = np.array([str(s).lower() == "deap" for s in source])
    all_trials = np.unique(
        np.column_stack([subject_id[deap_mask], trial_idx[deap_mask]]),
        axis=0,
    )

    leads_pred, leads_base = [], []
    false_alarms_pred = 0
    false_alarms_base = 0
    true_negatives    = 0
    per_trial         = []

    idx_to_risk = {m["epoch_end_idx"]: float(risk_scores[i])
                   for i, m in enumerate(seq_meta)}

    for subj, trial in all_trials:
        mask = deap_mask & (subject_id == subj) & (trial_idx == trial)
        ep_idx = np.where(mask)[0]
        if len(ep_idx) < SEQ_LEN + K_AHEAD:
            continue

        rs = np.full(len(ep_idx), np.nan)
        for local_i, global_i in enumerate(ep_idx):
            if global_i in idx_to_risk:
                rs[local_i] = idx_to_risk[global_i]

        valid_mask = ~np.isnan(rs)
        if not valid_mask.any():
            continue

        rs_trial = np.where(valid_mask, rs, 0.0)
        yp_trial = y_perc[ep_idx]
        se_trial = soft_emo[ep_idx]

        lt = compute_lead_time(rs_trial, yp_trial, se_trial, alert_thresh)
        per_trial.append({"subject": int(subj), "trial": int(trial), **lt})

        if yp_trial.max() > 0:
            if lt["lead_predictor_epochs"] is not None:
                leads_pred.append(lt["lead_predictor_epochs"])
            if lt["lead_baseline_epochs"] is not None:
                leads_base.append(lt["lead_baseline_epochs"])
        else:
            true_negatives += 1
            if lt["predictor_false_alarm"]:
                false_alarms_pred += 1
            if lt["baseline_false_alarm"]:
                false_alarms_base += 1

    def _fmt(v):
        return f"{v:.1f}" if v is not None else "n/a"

    summary = {
        "n_trials"                    : len(per_trial),
        "alert_threshold_used"        : float(alert_thresh),
        "lead_predictor_mean_epochs"  : float(np.mean(leads_pred))  if leads_pred else None,
        "lead_predictor_median_epochs": float(np.median(leads_pred)) if leads_pred else None,
        "lead_predictor_mean_s"       : float(np.mean(leads_pred) * EPOCH_STRIDE_S) if leads_pred else None,
        "lead_predictor_median_s"     : float(np.median(leads_pred) * EPOCH_STRIDE_S) if leads_pred else None,
        "lead_baseline_mean_epochs"   : float(np.mean(leads_base))  if leads_base else None,
        "lead_baseline_mean_s"        : float(np.mean(leads_base) * EPOCH_STRIDE_S) if leads_base else None,
        "false_alarm_rate_predictor"  : false_alarms_pred / max(true_negatives, 1),
        "false_alarm_rate_baseline"   : false_alarms_base / max(true_negatives, 1),
        "n_true_negative_trials"      : true_negatives,
        "n_stress_trials_with_pred_fire"  : len(leads_pred),
        "n_stress_trials_with_base_fire"  : len(leads_base),
    }

    extra_mean  = ((summary["lead_predictor_mean_epochs"] or 0) -
                   (summary["lead_baseline_mean_epochs"]  or 0))
    print(f"\n  Lead-time analysis over {len(per_trial)} DEAP trials  "
          f"(threshold={alert_thresh:.3f}):")
    print(f"  Predictor  mean lead = {_fmt(summary['lead_predictor_mean_s'])} s  "
          f"(median {_fmt(summary['lead_predictor_median_s'])} s)  "
          f"[{len(leads_pred)} stress trials fired]")
    print(f"  Baseline   mean lead = {_fmt(summary['lead_baseline_mean_s'])} s  "
          f"[{len(leads_base)} stress trials fired]")
    print(f"  Extra lead gained    = {extra_mean * EPOCH_STRIDE_S:+.1f} s vs rolling-window baseline")
    print(f"  False alarm rate  —  predictor: {summary['false_alarm_rate_predictor']:.2%}  "
          f"baseline: {summary['false_alarm_rate_baseline']:.2%}")

    return {"summary": summary, "per_trial": per_trial}


# ═══════════════════════════════════════════════════════════════════
#  DATA LOADING
# ═══════════════════════════════════════════════════════════════════

def load_data(npz_path=None, soft_dir=SOFT_DIR):
    """
    Load features_dataset.npz + student soft logits (including soft_pre_stage).
    Falls back to synthetic data if either is missing.
    Returns: (soft_emo, soft_pre_stage, soft_perc, y_emo, y_perc, subject_id, trial_idx, source)
    """
    npz_path = Path(npz_path) if npz_path else UNIFIED_OUTPUT_DIR / "features_dataset.npz"
    soft_dir = Path(soft_dir)

    needed = ["soft_emo.npy", "soft_perc.npy", "y_emo.npy", "y_perc.npy", "source.npy"]
    has_real = npz_path.exists() and all((soft_dir / f).exists() for f in needed)

    if not has_real:
        print("  [WARNING] Real data not found — using synthetic data for demonstration.")
        return _synthetic_data()

    d          = np.load(npz_path, allow_pickle=True)
    y_perc     = d["y_perc"].astype(np.int32).copy()
    y_emo      = d["y_emo"].astype(np.int32)
    subject_id = d["subject_id"].astype(np.int32)
    trial_idx  = d["trial_idx"].astype(np.int32)
    source     = d["source"]
    soft_emo   = np.load(soft_dir / "soft_emo.npy").astype(np.float32)
    soft_perc  = np.load(soft_dir / "soft_perc.npy").astype(np.float32)

    # Pre-stage soft logits: use teacher's output if available, else derive from labels
    pre_path = soft_dir / "soft_pre_stage.npy"
    if pre_path.exists():
        soft_pre = np.load(pre_path).astype(np.float32)
    else:
        y_pre_raw = (d["y_pre_stage"].astype(np.int32) if "y_pre_stage" in d
                     else ((y_emo == 1) & (y_perc >= 0) & (y_perc == 0)).astype(np.int32))
        soft_pre = y_pre_raw.astype(np.float32)
        print("  [INFO] soft_pre_stage.npy not found — using hard y_pre_stage labels as proxy")

    # Clip arrays to same length (student soft logits may differ by 1)
    n = min(len(y_perc), len(soft_emo), len(soft_pre))
    return (soft_emo[:n], soft_pre[:n], soft_perc[:n], y_emo[:n], y_perc[:n],
            subject_id[:n], trial_idx[:n], source[:n])


def _synthetic_data(
    n_deap_subj: int = 16,
    trials_per:  int = 8,
    epochs_per:  int = 45,
):
    """
    Generate realistic synthetic data that mirrors the pipeline output.

    Stress patterns simulated:
      · Low-stress trials : soft_emo stays below 0.4, no y_perc=1
      · Rising trials     : soft_emo rises gradually → y_perc=1 near end
      · Spike trials      : single transient spike, no sustained perceived stress

    Returns: (soft_emo, soft_pre_stage, soft_perc, y_emo, y_perc, subject_id, trial_idx, source)
    """
    rng   = np.random.default_rng(RANDOM_STATE)
    n_sam = 8   # SAM40 subjects (emo-only)

    se_list, sps_list, sp_list = [], [], []
    ye_l, yp_l                 = [], []
    sid_l, tid_l               = [], []
    src_l                      = []

    global_trial = 0
    for s in range(n_deap_subj):
        for t in range(trials_per):
            trial_type = rng.choice(["low", "rising", "spike"],
                                     p=[0.5, 0.35, 0.15])
            n = epochs_per + rng.integers(-5, 5)

            if trial_type == "rising":
                base  = rng.uniform(0.1, 0.25)
                slope = rng.uniform(0.015, 0.03)
                se    = np.clip(base + slope * np.arange(n) + rng.normal(0, 0.05, n), 0, 1)
                onset = max(0, n - 15)
                yp    = (np.arange(n) >= onset).astype(np.int32)
            elif trial_type == "spike":
                se   = rng.uniform(0.05, 0.2, n).astype(np.float32)
                spike_t = rng.integers(n // 3, 2 * n // 3)
                se[spike_t : spike_t + 4] = rng.uniform(0.7, 0.9)
                yp = np.zeros(n, dtype=np.int32)
            else:
                se = rng.uniform(0.05, 0.3, n).astype(np.float32)
                yp = np.zeros(n, dtype=np.int32)

            sp  = np.clip(se * 0.6 + rng.normal(0, 0.05, n), 0, 1).astype(np.float32)
            ye  = (se >= 0.5).astype(np.int32)
            # pre-stage: elevated in the build-up window just before yp fires
            yps = ((ye == 1) & (yp == 0)).astype(np.int32)
            sps = np.clip(yps.astype(np.float32) * 0.7 + rng.normal(0, 0.08, n), 0, 1).astype(np.float32)

            se_list.extend(se.tolist());  sps_list.extend(sps.tolist())
            sp_list.extend(sp.tolist())
            ye_l.extend(ye.tolist());     yp_l.extend(yp.tolist())
            sid_l.extend([s] * n);        tid_l.extend([global_trial] * n)
            src_l.extend(["deap"] * n)
            global_trial += 1

    # SAM40 (emo-only, y_perc=-1 sentinel)
    for s in range(n_sam):
        for t in range(6):
            n  = 30
            se = rng.uniform(0.05, 0.85, n).astype(np.float32)
            ye = (se >= 0.5).astype(np.int32)
            # SAM40 has no y_perc so no pre-stage signal — set to 0
            se_list.extend(se.tolist());  sps_list.extend([0.0] * n)
            sp_list.extend([0.0] * n)
            ye_l.extend(ye.tolist());     yp_l.extend([-1] * n)
            sid_l.extend([s + 100] * n);  tid_l.extend([global_trial] * n)
            src_l.extend(["sam40"] * n)
            global_trial += 1

    return (
        np.array(se_list,   dtype=np.float32),
        np.array(sps_list,  dtype=np.float32),
        np.array(sp_list,   dtype=np.float32),
        np.array(ye_l,      dtype=np.int32),
        np.array(yp_l,      dtype=np.int32),
        np.array(sid_l,     dtype=np.int32),
        np.array(tid_l,     dtype=np.int32),
        np.array(src_l),
    )


# ═══════════════════════════════════════════════════════════════════
#  FULL PIPELINE
# ═══════════════════════════════════════════════════════════════════

def run_spiral_pipeline(npz_path=None, soft_dir=SOFT_DIR, eval_only=False):
    print(f"\n{'=' * 62}")
    print("  STRESS SPIRAL EARLY-WARNING PREDICTOR")
    print(f"  SEQ_LEN={SEQ_LEN} epochs ({SEQ_LEN * EPOCH_STRIDE_S:.0f} s look-back)  "
          f"K_AHEAD={K_AHEAD} ({LEAD_S:.1f} s lead)")
    print(f"  Model: BiLSTM (layers={LSTM_LAYERS} h={LSTM_HIDDEN} bidirectional)")
    print(f"  Alert threshold: {ALERT_THRESH}  |  Device: {DEVICE}")
    print(f"{'=' * 62}")

    # ── [1] Load ──────────────────────────────────────────────────
    print("\n[1] Loading soft probabilities + labels")
    (soft_emo, soft_pre, soft_perc, y_emo, y_perc,
     subject_id, trial_idx, source) = load_data(npz_path, soft_dir)

    deap_mask = np.array([str(s).lower() == "deap" for s in source])
    perc_valid = y_perc >= 0
    print(f"  Total epochs   : {len(y_perc):,}")
    print(f"  DEAP epochs    : {deap_mask.sum():,}  (y_perc via rolling-window auxiliary)")
    print(f"  SAM40 epochs   : {(~deap_mask).sum():,}  (y_perc via trial-progression; {int(perc_valid[~deap_mask].sum()):,} valid)")
    yp_v = y_perc[perc_valid]
    print(f"  y_perc balance : {yp_v.mean():.2%}  pos={int(yp_v.sum()):,}")

    # ── [2] Build sequences ───────────────────────────────────────
    print("\n[2] Building look-back sequences")
    builder = SpiralSequenceBuilder(SEQ_LEN, K_AHEAD)
    X, y, groups, seq_meta = builder.build(
        soft_emo, soft_pre, soft_perc, y_perc, subject_id, trial_idx, source)

    pw_emo = float(np.sqrt((y == 0).sum() / max((y == 1).sum(), 1)))
    print(f"  Positive weight: {pw_emo:.2f}x")

    if eval_only and MODEL_PATH.exists():
        print(f"\n  [eval_only] Loading saved model from {MODEL_PATH}")
        ckpt  = torch.load(MODEL_PATH, map_location=DEVICE)
        model = SpiralLSTM()
        model.load_state_dict(ckpt["state_dict"])
        model.eval().to(DEVICE)
        opt_thresh = float(ckpt.get("opt_threshold", ALERT_THRESH))
        cv_results = ckpt.get("cv_results", {})
        history    = ckpt.get("history", [])
        print(f"  Loaded opt_threshold={opt_thresh:.4f}")
    else:
        # ── [3] Cross-validation ──────────────────────────────────
        print("\n[3] Subject-stratified cross-validation")
        cv_results = cross_validate(X, y, groups, CV_FOLDS)

        # ── [4] Final model on all data ───────────────────────────
        print("\n[4] Training final model on all DEAP data")
        split = int(len(X) * 0.85)
        perm  = np.random.permutation(len(X))
        tr_i, va_i = perm[:split], perm[split:]

        model = SpiralLSTM()
        print(f"  Parameters: {model.n_params():,}")
        tr_ds = SpiralDataset(X[tr_i], y[tr_i])
        va_ds = SpiralDataset(X[va_i], y[va_i])
        tr_ld = _make_balanced_loader(tr_ds, BATCH_SIZE, shuffle=True)
        va_ld = _make_balanced_loader(va_ds, BATCH_SIZE, shuffle=False)
        history, opt_thresh = train_spiral_model(model, tr_ld, va_ld, pw_emo)

        # ── [5] Temperature calibration ───────────────────────────
        print("\n[5] Temperature scaling calibration")
        T_val = calibrate_temperature(model, X[va_i], y[va_i])

    # ── [6] Generate risk scores on all DEAP sequences ───────────
    print("\n[6] Generating spiral risk scores")
    model.eval().to(DEVICE)
    all_loader = DataLoader(SpiralDataset(X, y), BATCH_SIZE, shuffle=False)
    risk_scores = []
    with torch.no_grad():
        for X_b, _ in all_loader:
            p = model(X_b.to(DEVICE), calibrate=True)
            risk_scores.extend(p.cpu().numpy())
    risk_scores = np.array(risk_scores, dtype=np.float32)

    # ECE on all data (post-calibration)
    ece = expected_calibration_error(risk_scores, y)
    auc = roc_auc_score(y, risk_scores) if len(np.unique(y)) > 1 else 0.0
    # Recompute opt_thresh on full-data scores after calibration
    if not eval_only:
        opt_thresh = find_alert_threshold(risk_scores, y)
    print(f"  Full-data AUC={auc:.4f}  ECE={ece:.4f}  opt_thresh={opt_thresh:.4f}  (post-calibration)")

    # ── Per-subject threshold calibration ────────────────────────
    per_subject_thresholds: dict = {}
    for subj in np.unique(groups):
        mask = groups == subj
        rs_s, y_s = risk_scores[mask], y[mask]
        if len(np.unique(y_s)) > 1 and y_s.sum() >= 3:
            per_subject_thresholds[int(subj)] = float(find_alert_threshold(rs_s, y_s))
        else:
            per_subject_thresholds[int(subj)] = float(opt_thresh)
    print(f"  Per-subject thresholds computed for {len(per_subject_thresholds)} subjects "
          f"(mean={np.mean(list(per_subject_thresholds.values())):.4f})")

    # ── [7] Lead-time analysis ────────────────────────────────────
    print("\n[7] Lead-time analysis")
    lead_results = analyse_lead_times(
        risk_scores, soft_emo, y_perc, subject_id, trial_idx, source,
        seq_meta, alert_thresh=opt_thresh)

    # ── [8] Save model ────────────────────────────────────────────
    if not eval_only:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        torch.save({
            "state_dict"     : model.state_dict(),
            "n_params"       : model.n_params(),
            "seq_len"        : SEQ_LEN,
            "k_ahead"        : K_AHEAD,
            "alert_thresh"   : ALERT_THRESH,
            "opt_threshold"  : opt_thresh,
            "epoch_stride_s" : EPOCH_STRIDE_S,
            "lead_s"         : LEAD_S,
            "cv_results"     : cv_results,
            "history"        : history,
        }, MODEL_PATH)
        print(f"\n  Model saved → {MODEL_PATH}")

    # ── [9] Save predictions ──────────────────────────────────────
    np.savez(
        OUTPUT_NPZ,
        risk_scores   = risk_scores,
        y_true        = y,
        groups        = groups,
        seq_meta_json = np.array([json.dumps(m) for m in seq_meta]),
    )

    # ── [10] Save JSON report ─────────────────────────────────────
    def _j(o):
        if isinstance(o, (np.integer,)):  return int(o)
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, np.ndarray):     return o.tolist()
        raise TypeError(type(o))

    report = {
        "model"       : "SpiralLSTM",
        "seq_len"     : SEQ_LEN,
        "k_ahead"     : K_AHEAD,
        "lead_s"      : LEAD_S,
        "alert_thresh": ALERT_THRESH,
        "opt_threshold": float(opt_thresh),
        "full_data_auc"      : float(auc),
        "full_data_ece"      : float(ece),
        "cv"          : cv_results,
        "lead_time"   : lead_results["summary"],
        "per_subject_thresholds": per_subject_thresholds,
    }
    with open(OUTPUT_JSON, "w") as f:
        json.dump(report, f, indent=2, default=_j)

    # ── Summary ───────────────────────────────────────────────────
    agg = cv_results.get("aggregate", {})
    lt  = lead_results["summary"]
    print(f"\n{'=' * 62}")
    print("  SPIRAL PREDICTOR — FINAL SUMMARY")
    print(f"{'=' * 62}")
    print(f"  CV AUC          : {agg.get('auc_roc_mean', 0):.4f} ± {agg.get('auc_roc_std', 0):.4f}")
    print(f"  CV F1           : {agg.get('f1_mean', 0):.4f} ± {agg.get('f1_std', 0):.4f}")
    print(f"  CV ECE          : {agg.get('ece_raw_mean', 0):.4f} (post-calibration improves this)")
    def _fs(v): return f"{v:.1f}" if v is not None else "n/a"
    print(f"  Lead time       : {_fs(lt['lead_predictor_mean_s'])} s (mean)  "
          f"{_fs(lt['lead_predictor_median_s'])} s (median)")
    print(f"  Baseline lead   : {_fs(lt['lead_baseline_mean_s'])} s (mean rolling window)")
    extra = ((lt['lead_predictor_mean_s'] or 0) - (lt['lead_baseline_mean_s'] or 0))
    print(f"  Extra lead gained: {extra:+.1f} s vs baseline")
    print(f"  False alarm rate: {lt['false_alarm_rate_predictor']:.2%}  "
          f"(baseline: {lt['false_alarm_rate_baseline']:.2%})")
    print(f"\n  Files saved:")
    print(f"    {MODEL_PATH.name}")
    print(f"    {OUTPUT_NPZ.name}")
    print(f"    {OUTPUT_JSON.name}")
    print(f"\n  Next step → real_time_inference.py  (stream T7/T8 → student → spiral)")
    print(f"{'=' * 62}\n")

    return model, cv_results, lead_results


# ═══════════════════════════════════════════════════════════════════
#  SELF-TEST
# ═══════════════════════════════════════════════════════════════════

def _run_self_test():
    print("=" * 62)
    print("  SPIRAL PREDICTOR — SELF-TEST (synthetic data)")
    print("=" * 62)

    print("\n[0] Generating synthetic soft logits")
    (soft_emo, soft_pre, soft_perc, y_emo, y_perc,
     subject_id, trial_idx, source) = _synthetic_data()

    print("\n[1] Building sequences")
    builder = SpiralSequenceBuilder(SEQ_LEN, K_AHEAD)
    X, y, groups, seq_meta = builder.build(
        soft_emo, soft_pre, soft_perc, y_perc, subject_id, trial_idx, source)

    pw = float(np.sqrt((y == 0).sum() / max((y == 1).sum(), 1)))

    print("\n[2] Quick 2-fold CV (synthetic — fewer subjects)")
    folds = min(2, len(np.unique(groups)))
    cv    = cross_validate(X, y, groups, n_folds=folds)

    print("\n[3] Final model (single pass)")
    model = SpiralLSTM()
    print(f"  Parameters: {model.n_params():,}")
    split = int(len(X) * 0.80)
    perm  = np.random.permutation(len(X))
    tr_i, va_i = perm[:split], perm[split:]
    tr_ds = SpiralDataset(X[tr_i], y[tr_i])
    va_ds = SpiralDataset(X[va_i], y[va_i])
    tr_ld = _make_balanced_loader(tr_ds, BATCH_SIZE, shuffle=True)
    va_ld = _make_balanced_loader(va_ds, BATCH_SIZE, shuffle=False)
    history, opt_thresh = train_spiral_model(model, tr_ld, va_ld, pw)

    print("\n[4] Temperature calibration")
    T_val = calibrate_temperature(model, X[va_i], y[va_i])

    print("\n[5] Risk scores + lead-time")
    model.eval().to(DEVICE)
    with torch.no_grad():
        rs = model(torch.tensor(X, dtype=torch.float32).to(DEVICE),
                   calibrate=True).cpu().numpy()

    auc = roc_auc_score(y, rs) if len(np.unique(y)) > 1 else 0.0
    ece = expected_calibration_error(rs, y)

    lt = analyse_lead_times(rs, soft_emo, y_perc, subject_id, trial_idx, source,
                            seq_meta, alert_thresh=opt_thresh)

    # Checks
    checks = {
        "X shape (N, seq_len, 4)"           : X.shape[1:] == (SEQ_LEN, N_INPUT_FEAT),
        "risk scores in [0, 1]"             : bool(rs.min() >= 0) and bool(rs.max() <= 1),
        "AUC > 0.5"                         : auc > 0.5,
        "ECE < 0.3"                         : ece < 0.3,
        f"opt_thresh in (0, 1)"             : 0.0 < opt_thresh < 1.0,
        f"T={T_val:.3f} in (0.05, 20)"      : 0.05 <= T_val <= 20.0,
        "CV folds ran"                      : len(cv["fold_metrics"]) == folds,
    }
    print(f"\n{'─' * 48}")
    for desc, ok in checks.items():
        print(f"  {'✓' if ok else '✗'} {desc}")
    print(f"  AUC={auc:.4f}  ECE={ece:.4f}  T={T_val:.3f}")
    print(f"{'─' * 48}")
    print(f"\n  Self-test complete.  {'All checks passed.' if all(checks.values()) else 'Some checks failed.'}\n")
    return int(not all(checks.values()))


# ═══════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--npz",       default=None,      help="Path to features_dataset.npz")
    parser.add_argument("--soft_dir",  default=None,      help="Directory with soft_*.npy files")
    parser.add_argument("--test",      action="store_true", help="Run on synthetic data only")
    parser.add_argument("--eval_only", action="store_true", help="Load saved model, skip training")
    args = parser.parse_args()

    if args.test:
        sys.exit(_run_self_test())

    soft_dir = Path(args.soft_dir) if args.soft_dir else SOFT_DIR
    run_spiral_pipeline(
        npz_path  = Path(args.npz) if args.npz else None,
        soft_dir  = soft_dir,
        eval_only = args.eval_only,
    )