"""
Real-time stress inference pipeline.

Pipeline position : STEP 9  (after spiral_predictor.py)

Input  : 2-second EEG window (2 T7+T8 channels at 256 Hz = 512 samples)
         streamed from a wearable device or simulated from the DEAP dataset.

Signal chain per epoch
----------------------
  raw window (2, 512)
    → bandpass 0.5–45 Hz
    → z-score normalise (running per-channel stats)
    → extract 30 student features (PSD + DE + Hjorth on T7, T8)
    → StudentKNN → (p_emo, p_pre, p_perc)
    → SpiralLSTM look-back buffer (SEQ_LEN=40 epochs)
    → spiral risk score → alert if risk ≥ ALERT_THRESH

Output per epoch
----------------
  {
    "epoch"      : int,           # 0-based epoch counter
    "time_s"     : float,         # wall time in seconds
    "p_emo"      : float,         # emotional stress probability
    "p_pre"      : float,         # pre-stage (build-up) stress probability
    "p_perc"     : float,         # perceived/sustained stress probability
    "risk"       : float,         # spiral risk score (10 s ahead)
    "alert"      : bool,          # True when risk ≥ ALERT_THRESH
    "stage"      : int,           # 0=calm  1=pre-stage  2=stressed
  }

Usage
-----
  # Simulate from saved DEAP epochs (default):
  python3 real_time_inference.py

  # Run on a specific DEAP subject for replay:
  python3 real_time_inference.py --subject 3

  # Headless batch mode (no per-epoch print):
  python3 real_time_inference.py --quiet --subject 5
"""

import sys
import pickle
import argparse
import json
from collections import deque
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from scipy.signal import butter, filtfilt

# Make student models importable for pickle.load
sys.path.insert(0, str(Path(__file__).resolve().parent / "models"))
from student_model import StudentMLP, StudentKNN  # noqa: F401  (needed by pickle)

# ─────────────────────────────────────────────
#  PATHS
# ─────────────────────────────────────────────

_HERE            = Path(__file__).resolve().parent
UNIFIED_OUT      = _HERE / "data" / "unified_output"
MODELS_DIR       = UNIFIED_OUT / "models"
FEATURES_NPZ     = UNIFIED_OUT / "features_dataset.npz"

STUDENT_PKL      = MODELS_DIR / "student_model.pkl"
SPIRAL_PT        = MODELS_DIR / "spiral_predictor.pt"
SPIRAL_REPORT    = UNIFIED_OUT / "spiral_report.json"

# ─────────────────────────────────────────────
#  SHARED CONSTANTS  (must match training scripts)
# ─────────────────────────────────────────────

SAMPLING_RATE_HZ : float = 256.0
EPOCH_SAMPLES    : int   = 512        # 2 s × 256 Hz
EPOCH_STRIDE_S   : float = 0.5        # epoch stride used in training

BANDPASS_LOW     : float = 0.5
BANDPASS_HIGH    : float = 45.0
BP_ORDER         : int   = 4

SEQ_LEN          : int   = 40         # spiral look-back window
K_AHEAD          : int   = 20         # spiral lead steps
N_INPUT_FEAT     : int   = 5          # soft_emo, soft_pre, soft_perc, d_emo, d_perc
LSTM_HIDDEN      : int   = 96
LSTM_LAYERS      : int   = 2
LSTM_DROPOUT     : float = 0.35
ALERT_THRESH     : float = 0.45

# ─────────────────────────────────────────────
#  SPIRAL LSTM  (must match spiral_predictor.py)
# ─────────────────────────────────────────────

class SpiralLSTM(nn.Module):
    def __init__(self, n_input=N_INPUT_FEAT, hidden=LSTM_HIDDEN,
                 n_layers=LSTM_LAYERS, dropout=LSTM_DROPOUT):
        super().__init__()
        self.lstm = nn.LSTM(n_input, hidden, num_layers=n_layers,
                            batch_first=True, bidirectional=True,
                            dropout=dropout if n_layers > 1 else 0.0)
        self.norm = nn.LayerNorm(hidden * 2)
        self.drop = nn.Dropout(dropout)
        self.head = nn.Sequential(
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


# ─────────────────────────────────────────────
#  SIGNAL PROCESSING HELPERS
# ─────────────────────────────────────────────

def _bp_coeffs():
    nyq  = SAMPLING_RATE_HZ / 2.0
    b, a = butter(BP_ORDER, [BANDPASS_LOW / nyq, BANDPASS_HIGH / nyq], btype='band')
    return b, a

_B, _A = _bp_coeffs()


def bandpass(epoch: np.ndarray) -> np.ndarray:
    """Zero-phase bandpass filter a (n_ch, T) epoch."""
    return filtfilt(_B, _A, epoch, axis=1).astype(np.float32)


class RunningNorm:
    """Per-channel running z-score (Welford online algorithm)."""
    def __init__(self, n_ch: int):
        self.n   = np.zeros(n_ch, dtype=np.float64)
        self.mu  = np.zeros(n_ch, dtype=np.float64)
        self.M2  = np.zeros(n_ch, dtype=np.float64)

    def update(self, epoch: np.ndarray) -> np.ndarray:
        """Update stats with epoch (n_ch, T) and return normalised epoch."""
        for ch in range(epoch.shape[0]):
            for x in epoch[ch]:
                self.n[ch]  += 1
                delta        = x - self.mu[ch]
                self.mu[ch] += delta / self.n[ch]
                self.M2[ch] += delta * (x - self.mu[ch])
        sigma = np.where(self.n > 1,
                         np.sqrt(self.M2 / np.maximum(self.n - 1, 1)),
                         np.ones_like(self.mu))
        sigma = np.maximum(sigma, 1e-6)
        return ((epoch - self.mu[:, None]) / sigma[:, None]).astype(np.float32)


# ─────────────────────────────────────────────
#  FEATURE EXTRACTION  (T7 + T8 student features)
# ─────────────────────────────────────────────

from scipy.signal import welch as sp_welch

BANDS = {'delta': (0.5, 4.0), 'theta': (4.0, 8.0),
         'alpha': (8.0, 13.0), 'beta': (13.0, 30.0), 'gamma': (30.0, 45.0)}
LOG_EPS = 1e-10


def _psd_band_power(x: np.ndarray) -> np.ndarray:
    W = len(x)
    _, pxx = sp_welch(x.astype(np.float64), fs=SAMPLING_RATE_HZ,
                      nperseg=W, noverlap=W // 2, window='hann')
    freqs  = np.fft.rfftfreq(W, 1.0 / SAMPLING_RATE_HZ)
    out    = np.empty(len(BANDS), dtype=np.float32)
    for i, (lo, hi) in enumerate(BANDS.values()):
        mask = (freqs >= lo) & (freqs < hi)
        out[i] = float(np.log10(pxx[mask].mean() + LOG_EPS)) if mask.any() else 0.0
    return out


def _de(x: np.ndarray) -> np.ndarray:
    from scipy.signal import butter as _butter, filtfilt as _ff
    out = np.empty(len(BANDS), dtype=np.float32)
    nyq = SAMPLING_RATE_HZ / 2.0
    for i, (lo, hi) in enumerate(BANDS.values()):
        b, a = _butter(BP_ORDER, [lo / nyq, hi / nyq], btype='band')
        sig  = _ff(b, a, x.astype(np.float64))
        var  = float(sig.var()) + LOG_EPS
        out[i] = float(0.5 * np.log(2 * np.pi * np.e * var))
    return out


def _td(x: np.ndarray) -> np.ndarray:
    x    = x.astype(np.float64)
    dx   = np.diff(x)
    ddx  = np.diff(dx)
    act  = float(x.var())
    mob  = float(np.sqrt(dx.var() / (act + 1e-10)))
    cmp  = float(np.sqrt(ddx.var() / (dx.var() + 1e-10)) / (mob + 1e-10))
    return np.array([float(x.mean()), act, act, mob, cmp], dtype=np.float32)


def extract_student_features(epoch_t7t8: np.ndarray,
                              extended: bool = True) -> np.ndarray:
    """
    (2, T) → 30-dim base or 76-dim extended student feature vector.

    When extended=True (default), delegates to feature_extraction.py for
    the full 76-dim vector (base + spectral_ext + nonlinear + connectivity).
    Falls back to 30-dim base if the import fails (e.g., no scipy available).
    """
    if extended:
        try:
            from feature_extraction import extract_student_epoch_extended
            return extract_student_epoch_extended(epoch_t7t8, SAMPLING_RATE_HZ)
        except Exception:
            pass  # fall through to base

    # Base 30-dim
    feats = []
    for ch in range(epoch_t7t8.shape[0]):
        feats.append(_psd_band_power(epoch_t7t8[ch]))
    for ch in range(epoch_t7t8.shape[0]):
        feats.append(_de(epoch_t7t8[ch]))
    for ch in range(epoch_t7t8.shape[0]):
        feats.append(_td(epoch_t7t8[ch]))
    return np.concatenate(feats).astype(np.float32)   # (30,)


# ─────────────────────────────────────────────
#  SPIRAL BUFFER
# ─────────────────────────────────────────────

class SpiralBuffer:
    """Maintains a SEQ_LEN rolling buffer of (soft_emo, soft_pre, soft_perc)."""
    def __init__(self, seq_len: int = SEQ_LEN):
        self.seq_len  = seq_len
        self._buf_e   = deque(maxlen=seq_len)
        self._buf_ps  = deque(maxlen=seq_len)
        self._buf_p   = deque(maxlen=seq_len)
        self._prev_e  = 0.0
        self._prev_p  = 0.0

    def push(self, p_emo: float, p_pre: float, p_perc: float):
        self._buf_e.append(p_emo)
        self._buf_ps.append(p_pre)
        self._buf_p.append(p_perc)
        self._prev_e = p_emo
        self._prev_p = p_perc

    def ready(self) -> bool:
        return len(self._buf_e) == self.seq_len

    def to_tensor(self) -> torch.Tensor:
        se  = np.array(self._buf_e,  dtype=np.float32)
        sps = np.array(self._buf_ps, dtype=np.float32)
        sp  = np.array(self._buf_p,  dtype=np.float32)
        de  = np.diff(se,  prepend=se[0])
        dp  = np.diff(sp,  prepend=sp[0])
        seq = np.stack([se, sps, sp, de, dp], axis=1)   # (SEQ_LEN, 5)
        return torch.tensor(seq).unsqueeze(0)            # (1, SEQ_LEN, 5)


# ─────────────────────────────────────────────
#  INFERENCE ENGINE
# ─────────────────────────────────────────────

class StressInferenceEngine:
    """
    Loads trained models and processes one 2-second epoch at a time.

    Parameters
    ----------
    student_pkl   : Path to student_model.pkl (StudentMLP preferred, falls back to KNN)
    spiral_pt     : Path to spiral_predictor.pt (SpiralLSTM)
    alert_thresh  : Fallback risk score threshold when no per-subject value exists
    subject_id    : Optional subject ID — used to look up per-subject threshold from
                    spiral_report.json (produced by spiral_predictor.py)
    """

    def __init__(self,
                 student_pkl: Path = STUDENT_PKL,
                 spiral_pt:   Path = SPIRAL_PT,
                 alert_thresh: float = ALERT_THRESH,
                 subject_id: int = None):

        if not student_pkl.exists():
            raise FileNotFoundError(f"Student model not found: {student_pkl}")
        if not spiral_pt.exists():
            raise FileNotFoundError(f"Spiral model not found: {spiral_pt}")

        with open(student_pkl, "rb") as f:
            self.student = pickle.load(f)
        _stype = type(self.student).__name__
        print(f"  [Engine] Loaded student model: {_stype}")

        ckpt = torch.load(spiral_pt, map_location="cpu")
        self.spiral = SpiralLSTM()
        self.spiral.load_state_dict(ckpt["state_dict"])
        self.spiral.eval()
        self._opt_thresh = float(ckpt.get("opt_threshold", alert_thresh))

        # Load per-subject thresholds from spiral_report.json when available
        self._per_subject_thresholds: dict = {}
        if SPIRAL_REPORT.exists():
            try:
                with open(SPIRAL_REPORT) as f:
                    rpt = json.load(f)
                raw = rpt.get("per_subject_thresholds", {})
                self._per_subject_thresholds = {int(k): float(v) for k, v in raw.items()}
                if self._per_subject_thresholds:
                    print(f"  [Engine] Loaded per-subject thresholds for "
                          f"{len(self._per_subject_thresholds)} subjects from spiral_report.json")
            except Exception as e:
                print(f"  [Engine] Warning: could not load per-subject thresholds: {e}")

        # Resolve threshold for this subject
        if subject_id is not None and subject_id in self._per_subject_thresholds:
            self.alert_thresh = self._per_subject_thresholds[subject_id]
            print(f"  [Engine] Subject {subject_id}: using per-subject threshold {self.alert_thresh:.4f}")
        else:
            self.alert_thresh = self._opt_thresh if self._opt_thresh != ALERT_THRESH else alert_thresh
            print(f"  [Engine] Using global threshold {self.alert_thresh:.4f}")

        self.norm         = RunningNorm(n_ch=2)   # T7 + T8
        self.buffer       = SpiralBuffer(SEQ_LEN)
        self.epoch_count  = 0
        self._feat_buffer = []   # rolling feature buffer for CNN+BiLSTM student

    def reset(self):
        """Reset between subjects / sessions."""
        self.norm         = RunningNorm(n_ch=2)
        self.buffer       = SpiralBuffer(SEQ_LEN)
        self.epoch_count  = 0
        self._feat_buffer = []

    def _mc_risk(self, n_samples: int = 20) -> tuple[float, float]:
        """
        Monte Carlo Dropout estimate of spiral risk and uncertainty.

        Enables dropout layers during inference and runs n_samples forward
        passes. Returns (mean_risk, std_risk). High std → low confidence.
        If the spiral model has no dropout, returns (risk, 0.0).
        """
        if not self.buffer.ready():
            return 0.0, 0.0

        seq_tensor = self.buffer.to_tensor()
        self.spiral.train()   # activates dropout layers
        risks = []
        with torch.no_grad():
            for _ in range(n_samples):
                r = float(self.spiral(seq_tensor, calibrate=True)[0])
                risks.append(r)
        self.spiral.eval()
        return float(np.mean(risks)), float(np.std(risks))

    def process_epoch(self, raw_t7t8: np.ndarray,
                       mc_samples: int = 0) -> dict:
        """
        Process one raw 2-second EEG window.

        Parameters
        ----------
        raw_t7t8   : np.ndarray  shape (2, 512)  — T7 and T8 at 256 Hz
        mc_samples : int  MC Dropout samples for uncertainty (0 = disabled)

        Returns
        -------
        dict with keys: epoch, time_s, p_emo, p_pre, p_perc,
                        risk, alert, stage [, risk_std, confidence]
        """
        if raw_t7t8.shape != (2, EPOCH_SAMPLES):
            raise ValueError(f"Expected (2, {EPOCH_SAMPLES}), got {raw_t7t8.shape}")

        # Signal chain
        filtered  = bandpass(raw_t7t8)
        normed    = self.norm.update(filtered)
        features  = extract_student_features(normed, extended=True)  # 30 or 76-dim

        # Handle CNN+BiLSTM (sequence-based) vs flat models
        from student_model import StudentCNNBiLSTM
        if isinstance(self.student, StudentCNNBiLSTM):
            self._feat_buffer.append(features)
            seq_len = self.student.seq_len
            if len(self._feat_buffer) < seq_len:
                # Pad with zeros until buffer fills
                padded = np.zeros((seq_len, features.shape[0]), dtype=np.float32)
                padded[-len(self._feat_buffer):] = self._feat_buffer
            else:
                padded = np.array(self._feat_buffer[-seq_len:], dtype=np.float32)
            p_emo, p_pre, p_perc = self.student.predict_proba(padded[np.newaxis])
        else:
            p_emo, p_pre, p_perc = self.student.predict_proba(features.reshape(1, -1))

        p_emo  = float(p_emo[0])
        p_pre  = float(p_pre[0])
        p_perc = float(p_perc[0])

        # Spiral buffer + risk score
        self.buffer.push(p_emo, p_pre, p_perc)

        if mc_samples > 0:
            risk, risk_std = self._mc_risk(mc_samples)
            confidence = max(0.0, 1.0 - 2.0 * risk_std)   # 1=certain, 0=uncertain
        elif self.buffer.ready():
            with torch.no_grad():
                risk = float(self.spiral(self.buffer.to_tensor(), calibrate=True)[0])
            risk_std   = None
            confidence = None
        else:
            risk = risk_std = confidence = 0.0

        alert = risk >= self.alert_thresh

        # Stage: 0=calm, 1=pre-stage build-up, 2=perceived stress
        if p_perc >= 0.5:
            stage = 2
        elif p_pre >= 0.5:
            stage = 1
        else:
            stage = 0

        result = {
            "epoch"  : self.epoch_count,
            "time_s" : round(self.epoch_count * EPOCH_STRIDE_S, 2),
            "p_emo"  : round(p_emo,  4),
            "p_pre"  : round(p_pre,  4),
            "p_perc" : round(p_perc, 4),
            "risk"   : round(float(risk), 4),
            "alert"  : alert,
            "stage"  : stage,
        }
        if mc_samples > 0:
            result["risk_std"]   = round(float(risk_std), 4)
            result["confidence"] = round(float(confidence), 4)
        self.epoch_count += 1
        return result


# ─────────────────────────────────────────────
#  SIMULATION — replay from features_dataset.npz
# ─────────────────────────────────────────────

def run_simulation(subject_id: int = None, quiet: bool = False):
    """
    Replay stored T7/T8 epochs from features_dataset.npz through the engine.
    Simulates a real-time stream without a physical EEG device.
    """
    if not FEATURES_NPZ.exists():
        print(f"ERROR: {FEATURES_NPZ} not found. Run feature_extraction.py first.")
        sys.exit(1)

    d          = np.load(FEATURES_NPZ, allow_pickle=True)
    F_student  = d["F_student"].astype(np.float32)     # (N, 30)
    y_emo      = d["y_emo"].astype(np.int32)
    y_perc     = d["y_perc"].astype(np.int32)
    source     = d["source"]
    sid        = d["subject_id"].astype(np.int32)

    deap_mask = np.array([str(s).lower() == "deap" for s in source])

    # Pick subject
    deap_subjs = np.unique(sid[deap_mask])
    if subject_id is None:
        subject_id = int(deap_subjs[0])
    if subject_id not in deap_subjs:
        print(f"ERROR: subject {subject_id} not in DEAP data. "
              f"Available: {deap_subjs.tolist()}")
        sys.exit(1)

    mask   = deap_mask & (sid == subject_id)
    F_subj = F_student[mask]
    ye     = y_emo[mask]
    yp     = y_perc[mask]
    N      = len(F_subj)

    print(f"\n{'='*60}")
    print(f"  REAL-TIME STRESS INFERENCE — SIMULATION")
    print(f"  Subject: DEAP s{subject_id:02d}  |  {N} epochs  ({N*EPOCH_STRIDE_S:.0f} s)")
    print(f"  Alert threshold: (subject-specific, loaded after engine init)  "
          f"|  Lead time: {K_AHEAD*EPOCH_STRIDE_S:.0f} s")
    print(f"{'='*60}\n")

    engine = StressInferenceEngine(subject_id=subject_id)

    # Header
    if not quiet:
        print(f"  {'ep':>5}  {'t(s)':>6}  {'p_emo':>6}  {'p_pre':>6}  "
              f"{'p_perc':>6}  {'risk':>6}  {'alert':>5}  {'stage':>5}  "
              f"{'y_emo':>5}  {'y_perc':>5}")
        print("  " + "-"*75)

    results  = []
    n_alerts = 0
    tp = fp = fn = tn = 0

    for i in range(N):
        # In simulation we pass the stored 30-dim features directly to the student
        # (bypassing the signal chain — features already extracted and normalised).
        # This faithfully replays the trained distribution without needing raw EEG.
        features = F_subj[i].reshape(1, -1)
        p_emo_a, p_pre_a, p_perc_a = engine.student.predict_proba(features)
        p_emo  = float(p_emo_a[0])
        p_pre  = float(p_pre_a[0])
        p_perc = float(p_perc_a[0])

        engine.buffer.push(p_emo, p_pre, p_perc)
        if engine.buffer.ready():
            with torch.no_grad():
                risk = float(engine.spiral(engine.buffer.to_tensor(), calibrate=False)[0])
        else:
            risk = 0.0

        alert = risk >= ALERT_THRESH
        stage = 2 if p_perc >= 0.5 else (1 if p_pre >= 0.5 else 0)

        if alert: n_alerts += 1
        if yp[i] == 1 and alert:   tp += 1
        if yp[i] == 0 and alert:   fp += 1
        if yp[i] == 1 and not alert: fn += 1
        if yp[i] == 0 and not alert: tn += 1

        r = {"epoch": i, "time_s": round(i * EPOCH_STRIDE_S, 2),
             "p_emo": round(p_emo, 4), "p_pre": round(p_pre, 4),
             "p_perc": round(p_perc, 4), "risk": round(risk, 4),
             "alert": alert, "stage": stage,
             "y_emo": int(ye[i]), "y_perc": int(yp[i])}
        results.append(r)
        engine.epoch_count += 1

        if not quiet:
            alert_str = "🚨" if alert else "  "
            stage_str = ["CALM", "PRE ", "STRSS"][stage]
            print(f"  {i:>5}  {i*EPOCH_STRIDE_S:>6.1f}  {p_emo:>6.3f}  {p_pre:>6.3f}  "
                  f"{p_perc:>6.3f}  {risk:>6.3f}  {alert_str}  {stage_str}  "
                  f"{ye[i]:>5}  {yp[i]:>5}")

    # Summary
    prec  = tp / max(tp + fp, 1)
    rec   = tp / max(tp + fn, 1)
    f1    = 2 * prec * rec / max(prec + rec, 1e-6)
    spec  = tn / max(tn + fp, 1)

    print(f"\n{'='*60}")
    print(f"  SIMULATION SUMMARY — DEAP s{subject_id:02d}")
    print(f"{'='*60}")
    print(f"  Epochs processed : {N}")
    print(f"  Alerts fired     : {n_alerts}  ({n_alerts/N:.1%})")
    print(f"  Precision        : {prec:.3f}")
    print(f"  Recall           : {rec:.3f}")
    print(f"  F1-score         : {f1:.3f}")
    print(f"  Specificity      : {spec:.3f}")
    print(f"{'='*60}\n")

    return results


# ─────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real-time stress inference simulation")
    parser.add_argument("--subject", type=int, default=None,
                        help="DEAP subject ID (default: first available)")
    parser.add_argument("--quiet", action="store_true",
                        help="Suppress per-epoch output")
    parser.add_argument("--all-subjects", action="store_true",
                        help="Run simulation for all DEAP subjects")
    args = parser.parse_args()

    if args.all_subjects:
        d         = np.load(FEATURES_NPZ, allow_pickle=True)
        source    = d["source"]
        sid       = d["subject_id"].astype(np.int32)
        deap_mask = np.array([str(s).lower() == "deap" for s in source])
        subjs     = np.unique(sid[deap_mask]).tolist()
        all_res   = {}
        for s in subjs:
            all_res[s] = run_simulation(subject_id=s, quiet=True)
        out = UNIFIED_OUT / "realtime_simulation_all.json"
        with open(out, "w") as f:
            json.dump(all_res, f, default=lambda x: bool(x) if isinstance(x, np.bool_) else x)
        print(f"All-subject results saved → {out}")
    else:
        run_simulation(subject_id=args.subject, quiet=args.quiet)
