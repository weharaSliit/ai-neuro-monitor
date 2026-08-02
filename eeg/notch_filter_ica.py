#!/usr/bin/env python3
"""
Notch Filtering + ICA Artifact Removal + Epoch Segmentation
=============================================================
Datasets : DEAP + SAM40 (unified)
Input    : unified_output/bandpass_filtered_dataset.npz
           Keys → X_teacher  (N, 32, T)  bandpass-filtered, all 32 channels
                  X_student  (N,  2, T)  bandpass-filtered, T7 + T8 only
                  y_emo      (N,)         emotional stress labels
                  source     (N,)         'deap' | 'sam40' per sample

Output   : unified_output/preprocessed_dataset.npz
           Keys → X_teacher  (E, 32, W)  clean, epoched, all 32 channels
                  X_student  (E,  2, W)  clean, epoched, T7 + T8 only
                  y_emo      (E,)         emotional stress target per epoch (inherited from trial)
                  source     (E,)         source per epoch (inherited from trial)
                  trial_idx  (E,)         parent trial index (for tracing)
           where E = total epochs, W = epoch length in samples

Pipeline
---------
  [1] Notch filter      — remove 50 Hz powerline + 100 Hz harmonic (zero-phase)
  [2] ICA               — fit once on pooled data, reject artifact components:
                            · high kurtosis       → muscle / EMG artifacts
                            · frontal dominance   → ocular / EOG artifacts
  [3] Re-derive student — T7 + T8 extracted from clean X_teacher
  [4] Epoch segmentation — sliding window, configurable length + overlap

Notch filter specification
---------------------------
  Frequencies : 50 Hz (powerline) + 100 Hz (harmonic)
  Filter type : 2nd-order IIR notch (scipy.signal.iirnotch)
                applied with filtfilt → zero-phase, no temporal distortion
  Quality Q   : 30.0 (narrow notch, bandwidth ≈ 1.67 Hz, minimal passband loss)
  Applied to  : X_teacher only (32 ch); student re-derived after all cleaning

ICA specification
-----------------
  Algorithm   : FastICA (sklearn.decomposition.FastICA)
  Components  : 32 (full rank for 32-channel EEG)
  Fit data    : random subsample of trials concatenated along time axis,
                capped at MAX_ICA_FIT_SAMPLES time points for efficiency
  Artifact IC rejection criteria (two independent, both checked):
    · Kurtosis  : excess kurtosis of IC time series > KURTOSIS_THRESHOLD
                  high kurtosis = spiky, non-Gaussian → muscle artifact
    · Frontal   : fraction of IC mixing-vector energy on frontal channels
                  (Fp1, Fp2, AF3, AF4) > FRONTAL_RATIO_THRESHOLD
                  high frontal energy = eye-blink / horizontal EOG

Epoch segmentation specification
----------------------------------
  Window      : EPOCH_LEN_S seconds  (default 1.0 s = 256 samples @ 256 Hz)
  Stride      : EPOCH_STRIDE_S seconds (default 0.5 s = 128 samples, 50% overlap)
  Rejection   : epochs whose peak-to-peak amplitude > EPOCH_REJECT_UV are
                discarded (residual artifacts after ICA)
  Labels      : each epoch inherits y_emo and source of its parent trial

Next step → feature_extraction.py
"""

import sys
import numpy as np
from pathlib import Path
from scipy.signal import iirnotch, filtfilt, periodogram
from scipy.stats import kurtosis as scipy_kurtosis
from sklearn.decomposition import FastICA
from typing import Dict, List, Optional, Tuple


# ─────────────────────────────────────────────
#  CONSTANTS
# ─────────────────────────────────────────────

EEG_CHANNELS: List[str] = [
    'Fp1', 'AF3', 'F7',  'F3',  'FC1', 'FC5',
    'T7',  'C3',  'CP1', 'CP5', 'P7',  'P3',
    'PZ',  'PO3', 'O1',  'OZ',  'O2',  'PO4',
    'P4',  'P8',  'CP6', 'CP2', 'C4',  'T8',
    'FC6', 'FC2', 'F4',  'F8',  'AF4', 'Fp2',
    'Fz',  'Cz',
]

T7_INDEX: int = EEG_CHANNELS.index('T7')   # 6
T8_INDEX: int = EEG_CHANNELS.index('T8')   # 23

# Frontal channels used for ocular artifact detection
FRONTAL_CHANNELS: List[str] = ['Fp1', 'Fp2', 'AF3', 'AF4']
FRONTAL_INDICES:  List[int]  = [EEG_CHANNELS.index(c) for c in FRONTAL_CHANNELS]

UNIFIED_OUTPUT_DIR: Path = Path("/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/Research/ai-neuro-monitor/eeg/data/unified_output")

# ── Sampling rate ─────────────────────────────────────────────
SAMPLING_RATE_HZ: float = 256.0

# ── Notch filter ──────────────────────────────────────────────
NOTCH_FREQ_HZ:     float = 50.0    # powerline fundamental
NOTCH_HARMONIC_HZ: float = 100.0   # first harmonic
NOTCH_QUALITY_Q:   float = 30.0    # Q = f0 / bandwidth — higher Q = narrower notch

# ── ICA ───────────────────────────────────────────────────────
ICA_N_COMPONENTS:        int   = 32
ICA_MAX_ITER:            int   = 1000
ICA_RANDOM_STATE:        int   = 42
MAX_ICA_FIT_SAMPLES:     int   = 200_000   # cap on pooled time points for ICA fit
KURTOSIS_THRESHOLD:      float = 20.0      # muscle/blink ICs typically >20; neural ICs 3-15
FRONTAL_RATIO_THRESHOLD: float = 0.70      # genuine blink IC concentrates >70% on Fp1/Fp2
MAX_REJECTION_FRACTION:  float = 0.25      # safety cap: never reject more than 25% of ICs
                                            # regardless of thresholds — prevents signal loss

# ── Epoch segmentation ────────────────────────────────────────
EPOCH_LEN_S:     float = 1.0     # epoch window length in seconds
EPOCH_STRIDE_S:  float = 0.5     # stride in seconds (50% overlap)
EPOCH_REJECT_UV: float = 150.0   # peak-to-peak amplitude rejection threshold µV


# ─────────────────────────────────────────────
#  [1] NOTCH FILTER
# ─────────────────────────────────────────────

def _apply_notch(
    signal_1d: np.ndarray,
    freq_hz:   float,
    Q:         float,
    fs:        float,
) -> np.ndarray:
    """Apply a single zero-phase IIR notch at freq_hz to a 1-D signal."""
    b, a = iirnotch(freq_hz, Q, fs)
    return filtfilt(b, a, signal_1d)


def apply_notch_filter(
    X:     np.ndarray,
    fs:    float           = SAMPLING_RATE_HZ,
    freqs: Tuple[float, ...] = (NOTCH_FREQ_HZ, NOTCH_HARMONIC_HZ),
    Q:     float           = NOTCH_QUALITY_Q,
) -> np.ndarray:
    """
    Apply zero-phase notch filter(s) to a (N, 32, T) EEG array.

    Each frequency in `freqs` is notched independently using a 2nd-order IIR
    notch filter applied with filtfilt (forward + backward → zero phase).
    Q=30 gives a notch bandwidth of f0/Q ≈ 1.67 Hz at 50 Hz, surgically
    removing powerline noise while preserving the broadband signal.

    Parameters
    ----------
    X     : np.ndarray      (N, n_ch, T) bandpass-filtered EEG array.
    fs    : float           Sampling rate Hz (default 256.0).
    freqs : tuple of float  Notch frequencies Hz (default 50 + 100 Hz).
    Q     : float           Quality factor — controls notch width (default 30.0).

    Returns
    -------
    np.ndarray  (N, n_ch, T) notch-filtered array, float32.
    """
    arr = X.astype(np.float64)
    N, n_ch, T = arr.shape

    for f in freqs:
        for trial in range(N):
            for ch in range(n_ch):
                arr[trial, ch] = _apply_notch(arr[trial, ch], f, Q, fs)

    print(f"  Notch filter applied: {freqs} Hz  (Q={Q}, zero-phase, fs={fs} Hz)")
    return arr.astype(np.float32)


# ─────────────────────────────────────────────
#  [2] ICA ARTIFACT REMOVAL
# ─────────────────────────────────────────────

class ICArtifactRemover:
    """
    Fit FastICA on pooled EEG data and remove artifact components.

    Two rejection criteria operate independently; a component is rejected if
    EITHER condition is met:

    Kurtosis criterion
        Excess kurtosis > KURTOSIS_THRESHOLD (default 5.0).
        Muscle and EMG artifacts produce spiky, highly non-Gaussian IC time
        series. Normal neural signals are approximately Gaussian (kurtosis ≈ 0).

    Frontal dominance criterion
        Fraction of IC mixing-vector energy on frontal channels (Fp1, Fp2,
        AF3, AF4) > FRONTAL_RATIO_THRESHOLD (default 0.40).
        Eye-blink and horizontal EOG artifacts produce ICs whose scalp
        topography is dominated by prefrontal electrodes.

    ICA is fit ONCE on a pooled random subsample of all trials
    (capped at MAX_ICA_FIT_SAMPLES) — per-trial ICA would be too slow
    on thousands of epochs and would lose cross-trial consistency.

    Parameters
    ----------
    n_components              : int    Number of ICA components (default 32).
    kurtosis_threshold        : float  Excess kurtosis cutoff (default 5.0).
    frontal_ratio_threshold   : float  Frontal energy fraction cutoff (default 0.40).
    max_fit_samples           : int    Max pooled time points for fit (default 200 000).
    random_state              : int    FastICA seed (default 42).
    max_iter                  : int    FastICA max iterations (default 1000).
    """

    def __init__(
        self,
        n_components:            int   = ICA_N_COMPONENTS,
        kurtosis_threshold:      float = KURTOSIS_THRESHOLD,
        frontal_ratio_threshold: float = FRONTAL_RATIO_THRESHOLD,
        max_fit_samples:         int   = MAX_ICA_FIT_SAMPLES,
        random_state:            int   = ICA_RANDOM_STATE,
        max_iter:                int   = ICA_MAX_ITER,
    ) -> None:
        self.n_components            = n_components
        self.kurtosis_threshold      = kurtosis_threshold
        self.frontal_ratio_threshold = frontal_ratio_threshold
        self.max_fit_samples         = max_fit_samples
        self.ica = FastICA(
            n_components = n_components,
            max_iter     = max_iter,
            random_state = random_state,
            whiten       = 'unit-variance',
        )
        self.mixing_matrix_:   Optional[np.ndarray] = None   # (n_ch, n_comp)
        self.unmixing_matrix_: Optional[np.ndarray] = None   # (n_comp, n_ch)
        self.artifact_mask_:   Optional[np.ndarray] = None   # bool (n_comp,)
        self.n_rejected_:      int                  = 0

    # ── Fit ───────────────────────────────────────────────────
    def fit(self, X: np.ndarray) -> 'ICArtifactRemover':
        """
        Fit ICA on a random subsample of the pooled trial data.

        Parameters
        ----------
        X : np.ndarray  (N, 32, T) notch-filtered EEG array.

        Returns
        -------
        self
        """
        N, n_ch, T = X.shape
        total_samples = N * T

        # Pool all trials → (n_ch, N*T) then transpose to (N*T, n_ch)
        X_cat = X.astype(np.float64).transpose(1, 0, 2).reshape(n_ch, total_samples).T

        # Subsample if too large
        if total_samples > self.max_fit_samples:
            rng  = np.random.default_rng(ICA_RANDOM_STATE)
            idx  = np.sort(rng.choice(total_samples, self.max_fit_samples, replace=False))
            X_fit = X_cat[idx]
            print(f"  ICA fit: subsampled {self.max_fit_samples:,} / {total_samples:,} "
                  f"time points  ({self.max_fit_samples/total_samples*100:.1f}%)")
        else:
            X_fit = X_cat
            print(f"  ICA fit: using all {total_samples:,} time points")

        self.ica.fit(X_fit)
        self.mixing_matrix_   = self.ica.mixing_      # (n_ch, n_comp)
        self.unmixing_matrix_ = self.ica.components_  # (n_comp, n_ch)
        print(f"  ICA converged: {self.n_components} components  "
              f"(mixing matrix {self.mixing_matrix_.shape})")

        self._identify_artifact_components(X_fit)
        return self

    def _identify_artifact_components(self, X_fit: np.ndarray) -> None:
        """
        Compute kurtosis and frontal dominance for every IC; build artifact mask.

        Parameters
        ----------
        X_fit : np.ndarray  (n_samples, n_ch) — data used to fit ICA.
        """
        IC_acts = self.ica.transform(X_fit)   # (n_samples, n_comp)
        n_comp  = self.n_components

        kurtosis_vals      = np.array([
            float(scipy_kurtosis(IC_acts[:, k], fisher=True, bias=True))
            for k in range(n_comp)
        ])

        frontal_ratio_vals = np.array([
            (self.mixing_matrix_[:, k][FRONTAL_INDICES] ** 2).sum() /
            ((self.mixing_matrix_[:, k] ** 2).sum() + 1e-12)
            for k in range(n_comp)
        ])

        kurtosis_mask  = kurtosis_vals      > self.kurtosis_threshold
        frontal_mask   = frontal_ratio_vals > self.frontal_ratio_threshold
        combined_mask  = kurtosis_mask | frontal_mask

        # ── Safety cap ────────────────────────────────────────
        # Never reject more than MAX_REJECTION_FRACTION of ICs.
        # If the raw criteria would exceed the cap, retain the
        # least-suspicious ICs (lowest kurtosis among flagged).
        max_reject = max(1, int(np.floor(n_comp * MAX_REJECTION_FRACTION)))
        if combined_mask.sum() > max_reject:
            # Rank flagged ICs by kurtosis; keep the least spiky ones
            flagged_indices  = np.where(combined_mask)[0]
            rank_by_kurtosis = flagged_indices[np.argsort(kurtosis_vals[flagged_indices])]
            to_keep          = rank_by_kurtosis[:combined_mask.sum() - max_reject]
            combined_mask[to_keep] = False

        self.artifact_mask_ = combined_mask
        self.n_rejected_    = int(self.artifact_mask_.sum())

        # ── Abort guard ───────────────────────────────────────
        if self.n_rejected_ >= n_comp:
            raise RuntimeError(
                f"ICA rejected ALL {n_comp} components. "
                f"Kurtosis vals: min={kurtosis_vals.min():.1f} "
                f"max={kurtosis_vals.max():.1f}. "
                f"Frontal ratio vals: max={frontal_ratio_vals.max():.2%}. "
                f"Raise KURTOSIS_THRESHOLD or lower MAX_REJECTION_FRACTION."
            )

        print(f"\n  IC artifact detection:")
        print(f"    Total ICs            : {n_comp}")
        print(f"    Rejected (kurtosis)  : {int(kurtosis_mask.sum())}  "
              f"(threshold > {self.kurtosis_threshold})")
        print(f"    Rejected (frontal)   : {int(frontal_mask.sum())}  "
              f"(threshold > {self.frontal_ratio_threshold:.0%})")
        print(f"    Rejected (after cap) : {self.n_rejected_}  "
              f"(cap = {MAX_REJECTION_FRACTION:.0%} = {max_reject} max)")
        print(f"    Retained             : {n_comp - self.n_rejected_}")

        top_k = np.argsort(kurtosis_vals)[::-1][:5]
        top_f = np.argsort(frontal_ratio_vals)[::-1][:5]
        print(f"\n    Top-5 kurtosis ICs   : "
              + "  ".join(f"IC{i}={kurtosis_vals[i]:.2f}" for i in top_k))
        print(f"    Top-5 frontal ICs    : "
              + "  ".join(f"IC{i}={frontal_ratio_vals[i]:.2%}" for i in top_f))

    # ── Transform ─────────────────────────────────────────────
    def transform(self, X: np.ndarray) -> np.ndarray:
        """
        Remove artifact ICs from X and reconstruct clean EEG.

        Zeroes the artifact IC columns in the mixing matrix, then reconstructs:
            X_clean = IC_activations_zeroed @ mixing_clean.T + mean

        Parameters
        ----------
        X : np.ndarray  (N, 32, T)

        Returns
        -------
        np.ndarray  (N, 32, T) artifact-removed EEG, float32.
        """
        if self.mixing_matrix_ is None:
            raise RuntimeError("Call fit() before transform().")

        N, n_ch, T = X.shape
        X_clean    = np.empty_like(X, dtype=np.float64)

        mixing_clean                           = self.mixing_matrix_.copy()
        mixing_clean[:, self.artifact_mask_]   = 0.0

        for i in range(N):
            trial_t        = X[i].astype(np.float64).T          # (T, n_ch)
            IC_acts        = self.ica.transform(trial_t)         # (T, n_comp)
            reconstructed  = IC_acts @ mixing_clean.T + self.ica.mean_  # (T, n_ch)
            X_clean[i]     = reconstructed.T                     # (n_ch, T)

        return X_clean.astype(np.float32)

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        """Fit ICA and remove artifact components in one call."""
        self.fit(X)
        X_clean = self.transform(X)

        # Post-transform signal quality check
        sample_std = float(X_clean[:min(50, len(X_clean))].std())
        if sample_std < 1e-6:
            raise RuntimeError(
                f"ICA reconstruction produced flat signal (std={sample_std:.2e}). "
                f"All {self.n_rejected_} rejected components zeroed the signal. "
                f"Check KURTOSIS_THRESHOLD ({self.kurtosis_threshold}) and "
                f"MAX_REJECTION_FRACTION ({MAX_REJECTION_FRACTION})."
            )
        print(f"  Post-ICA signal std: {sample_std:.4f}  (non-zero = reconstruction OK)")
        return X_clean


# ─────────────────────────────────────────────
#  [3] RE-DERIVE STUDENT CHANNELS
# ─────────────────────────────────────────────

def extract_student_channels(X_teacher: np.ndarray) -> np.ndarray:
    """
    Extract T7 and T8 from a (N, 32, T) teacher array.

    Called AFTER ICA cleaning so student channels reflect the
    artifact-free signal.

    Returns
    -------
    np.ndarray  (N, 2, T)  T7 at channel index 0, T8 at index 1.
    """
    return X_teacher[:, [T7_INDEX, T8_INDEX], :]


# ─────────────────────────────────────────────
#  [4] EPOCH SEGMENTATION
# ─────────────────────────────────────────────

def segment_epochs(
    X_teacher:   np.ndarray,
    X_student:   np.ndarray,
    y_emo:       np.ndarray,
    source:      np.ndarray,
    fs:          float = SAMPLING_RATE_HZ,
    epoch_len_s: float = EPOCH_LEN_S,
    stride_s:    float = EPOCH_STRIDE_S,
    reject_uv:   float = EPOCH_REJECT_UV,
) -> Dict[str, np.ndarray]:
    """
    Segment trials into fixed-length overlapping epochs.

    Each epoch inherits y_emo and source from its parent trial.
    Epochs whose peak-to-peak amplitude on any channel exceeds reject_uv
    are discarded to remove residual artifacts that survived ICA.

    Parameters
    ----------
    X_teacher    : np.ndarray  (N, 32, T)
    X_student    : np.ndarray  (N,  2, T)
    y_emo        : np.ndarray  (N,)
    source       : np.ndarray  (N,)

    Returns
    -------
    dict with keys:
        'X_teacher'   : (E, 32, W)
        'X_student'   : (E,  2, W)
        'y_emo'       : (E,)
        'source'      : (E,)
        'trial_idx'   : (E,)
    where W = int(epoch_len_s * fs).
    """
    W      = int(epoch_len_s * fs)
    stride = int(stride_s    * fs)
    N, _, T = X_teacher.shape

    teacher_epochs: List[np.ndarray] = []
    student_epochs: List[np.ndarray] = []
    y_emo_list:     List[int]        = []
    source_list:    List[str]        = []
    trial_idx_list: List[int]        = []

    n_extracted = 0
    n_rejected  = 0

    for i in range(N):
        trial_t = X_teacher[i]   # (32, T)
        trial_s = X_student[i]   # (2,  T)

        for start in range(0, T - W + 1, stride):
            end     = start + W
            epoch_t = trial_t[:, start:end]   # (32, W)
            epoch_s = trial_s[:, start:end]   # (2,  W)

            ptp = epoch_t.max(axis=1) - epoch_t.min(axis=1)
            if ptp.max() > reject_uv:
                n_rejected += 1
                continue

            teacher_epochs.append(epoch_t)
            student_epochs.append(epoch_s)
            y_emo_list.append(int(y_emo[i]))
            source_list.append(str(source[i]))
            trial_idx_list.append(i)
            n_extracted += 1

    total = n_extracted + n_rejected
    print(f"\n  Epoch segmentation:")
    print(f"    Window      : {epoch_len_s:.1f} s = {W} samples")
    print(f"    Stride      : {stride_s:.1f} s = {stride} samples  "
          f"({(1 - stride_s / epoch_len_s) * 100:.0f}% overlap)")
    print(f"    Epochs/trial: ~{(T - W) // stride + 1} per {N}-trial dataset")
    print(f"    Extracted   : {n_extracted:,}")
    print(f"    Rejected    : {n_rejected:,}  (ptp > {reject_uv} µV)")
    print(f"    Retained    : {n_extracted:,} / {total:,}  "
          f"({n_extracted / total * 100:.1f}%)")

    return {
        'X_teacher' : np.stack(teacher_epochs).astype(np.float32),
        'X_student' : np.stack(student_epochs).astype(np.float32),
        'y_emo'     : np.array(y_emo_list,     dtype=np.int32),
        'source'    : np.array(source_list),
        'trial_idx' : np.array(trial_idx_list, dtype=np.int32),
    }


# ─────────────────────────────────────────────
#  VERIFICATION
# ─────────────────────────────────────────────

def verify_notch_effect(
    X_before:      np.ndarray,
    X_after:       np.ndarray,
    channel_index: int             = T7_INDEX,
    fs:            float           = SAMPLING_RATE_HZ,
    notch_freqs:   Tuple[float, ...] = (NOTCH_FREQ_HZ, NOTCH_HARMONIC_HZ),
) -> Dict[str, float]:
    """
    Check that power at notch frequencies dropped while broadband is preserved.
    Uses the first trial's specified channel.
    """
    raw     = X_before[0, channel_index].astype(np.float64)
    flt     = X_after[0,  channel_index].astype(np.float64)
    ch_name = EEG_CHANNELS[channel_index]

    def narrow(freqs, psd, center, bw=2.0):
        mask = (freqs >= center - bw) & (freqs <= center + bw)
        return float(np.trapezoid(psd[mask], freqs[mask])) if mask.any() else 0.0

    def broad(freqs, psd, lo, hi):
        mask = (freqs >= lo) & (freqs <= hi)
        return float(np.trapezoid(psd[mask], freqs[mask])) if mask.any() else 0.0

    fr, pr = periodogram(raw, fs)
    ff, pf = periodogram(flt, fs)

    stats: Dict = {'channel': ch_name}
    print(f"\n  [{ch_name}] Notch verification")
    for f0 in notch_freqs:
        before      = narrow(fr, pr, f0)
        after       = narrow(ff, pf, f0)
        suppression = (1 - after / (before + 1e-12)) * 100
        stats[f'power_{int(f0)}Hz_before']       = before
        stats[f'power_{int(f0)}Hz_after']        = after
        stats[f'suppression_{int(f0)}Hz_pct']    = suppression
        print(f"    Power @ {f0:.0f} Hz  : {before:.5f} → {after:.5f}  "
              f"({suppression:.1f}% suppressed)")

    bb_b = broad(fr, pr, 1, 45)
    bb_a = broad(ff, pf, 1, 45)
    pres = (bb_a / (bb_b + 1e-12)) * 100
    stats['broadband_1_45Hz_preservation_pct'] = pres
    print(f"    Broadband 1–45 Hz  : {bb_b:.4f} → {bb_a:.4f}  ({pres:.1f}% preserved)")
    return stats


# ─────────────────────────────────────────────
#  FULL PIPELINE ENTRY POINT
# ─────────────────────────────────────────────

def run_notch_ica_epoch_pipeline(
    input_npz:   Path,
    output_npz:  Optional[Path]    = None,
    fs:          float             = SAMPLING_RATE_HZ,
    notch_freqs: Tuple[float, ...] = (NOTCH_FREQ_HZ, NOTCH_HARMONIC_HZ),
    notch_Q:     float             = NOTCH_QUALITY_Q,
    epoch_len_s: float             = EPOCH_LEN_S,
    stride_s:    float             = EPOCH_STRIDE_S,
    reject_uv:   float             = EPOCH_REJECT_UV,
    verify:      bool              = True,
) -> Dict[str, np.ndarray]:
    """
    Full notch filter → ICA artifact removal → epoch segmentation pipeline.

    Parameters
    ----------
    input_npz   : Path    Path to bandpass_filtered_dataset.npz.
    output_npz  : Path    Defaults to unified_output/preprocessed_dataset.npz.
    fs          : float   Sampling rate Hz (default 256.0).
    notch_freqs : tuple   Notch frequencies Hz (default (50, 100)).
    notch_Q     : float   Notch quality factor (default 30.0).
    epoch_len_s : float   Epoch window length seconds (default 1.0).
    stride_s    : float   Epoch stride seconds (default 0.5).
    reject_uv   : float   Peak-to-peak rejection threshold µV (default 150).
    verify      : bool    Print notch + ICA verification stats.

    Returns
    -------
    dict with keys: 'X_teacher', 'X_student', 'y_emo', 'source', 'trial_idx'
    """
    if output_npz is None:
        output_npz = UNIFIED_OUTPUT_DIR / "preprocessed_dataset.npz"

    output_npz.parent.mkdir(parents=True, exist_ok=True)

    print("\n" + "=" * 62)
    print("  NOTCH + ICA + EPOCH PIPELINE")
    print(f"  Notch  : {notch_freqs} Hz  Q={notch_Q}")
    print(f"  ICA    : {ICA_N_COMPONENTS} components  "
          f"kurtosis>{KURTOSIS_THRESHOLD}  frontal>{FRONTAL_RATIO_THRESHOLD:.0%}")
    print(f"  Epochs : {epoch_len_s}s window  {stride_s}s stride  "
          f"reject>{reject_uv}µV")
    print("=" * 62)

    # ── [1] Load ───────────────────────────────────────────────
    print(f"\n[1] Loading  {input_npz}")
    data        = np.load(input_npz, allow_pickle=True)
    X_teacher   = data['X_teacher'].astype(np.float32)
    y_emo       = data['y_emo']
    source      = data['source']

    N, n_ch, T = X_teacher.shape
    print(f"    X_teacher   : {X_teacher.shape}  dtype={X_teacher.dtype}")
    print(f"    y_emo       : {y_emo.shape}   pos={int(y_emo.sum())}  neg={int((y_emo==0).sum())}")
    print(f"    sources     : {np.unique(source)}")

    if n_ch != 32:
        raise ValueError(f"Expected 32 EEG channels, got {n_ch}.")

    # ── [2] Notch filter ───────────────────────────────────────
    print(f"\n[2] Notch filtering {notch_freqs} Hz …")
    X_notched = apply_notch_filter(X_teacher, fs=fs, freqs=notch_freqs, Q=notch_Q)
    if verify:
        verify_notch_effect(X_teacher, X_notched, T7_INDEX, fs, notch_freqs)
        verify_notch_effect(X_teacher, X_notched, T8_INDEX, fs, notch_freqs)

    # ── [3] ICA artifact removal ───────────────────────────────
    print(f"\n[3] ICA artifact removal …")
    remover = ICArtifactRemover()
    X_clean = remover.fit_transform(X_notched)
    print(f"    X_clean : {X_clean.shape}  dtype={X_clean.dtype}")

    # ── [4] Re-derive student from clean teacher ───────────────
    print(f"\n[4] Re-deriving student channels (T7 + T8) …")
    X_student = extract_student_channels(X_clean)
    print(f"    X_student : {X_student.shape}")

    # ── [5] Epoch segmentation ─────────────────────────────────
    print(f"\n[5] Epoch segmentation …")
    epochs = segment_epochs(
        X_teacher   = X_clean,
        X_student   = X_student,
        y_emo       = y_emo,
        source      = source,
        fs          = fs,
        epoch_len_s = epoch_len_s,
        stride_s    = stride_s,
        reject_uv   = reject_uv,
    )

    # ── [6] Save ───────────────────────────────────────────────
    print(f"\n[6] Saving  →  {output_npz}")
    np.savez(output_npz, **epochs)

    # ── Summary ────────────────────────────────────────────────
    E = epochs['X_teacher'].shape[0]
    W = epochs['X_teacher'].shape[2]
    print("\n" + "=" * 62)
    print("  OUTPUT SUMMARY")
    print("=" * 62)
    print(f"  X_teacher   : {epochs['X_teacher'].shape}  dtype={epochs['X_teacher'].dtype}")
    print(f"  X_student   : {epochs['X_student'].shape}   dtype={epochs['X_student'].dtype}")
    print(f"  y_emo       : {epochs['y_emo'].shape}    unique={np.unique(epochs['y_emo'])}")
    print(f"  source      : {epochs['source'].shape}   unique={np.unique(epochs['source'])}")
    print(f"  trial_idx   : {epochs['trial_idx'].shape}")
    print(f"\n  Epochs total  : {E:,}  ({N} trials × ~{E // N} epochs/trial)")
    print(f"  Epoch shape   : (32, {W}) teacher  |  (2, {W}) student")
    print(f"  ICA removed   : {remover.n_rejected_} / {ICA_N_COMPONENTS} components")
    print(f"\n  Saved to  : {output_npz}")
    print(f"\n  Next step → feature_extraction.py")
    print("=" * 62 + "\n")

    return epochs


# ─────────────────────────────────────────────
#  SELF-TEST  (python notch_filter_ica.py)
# ─────────────────────────────────────────────

def _make_synthetic_bandpass_npz(out_dir: Path, n_samples: int = 30) -> Path:
    """
    Write a synthetic bandpass_filtered_dataset.npz that mimics the output
    of bandpass_filtering.py.  Signals contain:
      · Neural oscillations (10, 20, 35 Hz)
      · 50 Hz powerline + 100 Hz harmonic       ← for notch verification
      · Eye-blink transient on frontal channels ← for ICA frontal rejection
      · Muscle burst on random channels         ← for ICA kurtosis rejection
    """
    rng = np.random.default_rng(0)
    T   = 2560   # 10 s at 256 Hz
    t   = np.arange(T) / SAMPLING_RATE_HZ

    def neural():
        return (0.5 * np.sin(2 * np.pi * 10 * t) +
                0.3 * np.sin(2 * np.pi * 20 * t) +
                0.2 * np.sin(2 * np.pi * 35 * t) +
                0.05 * rng.standard_normal(T))

    def powerline():
        return (1.5 * np.sin(2 * np.pi * 50  * t) +
                0.5 * np.sin(2 * np.pi * 100 * t))

    def eye_blink(amp: float = 80.0) -> np.ndarray:
        return amp * np.exp(-0.5 * ((t - 3.0) / 0.1) ** 2)

    def muscle_burst(amp: float = 60.0, dur_s: float = 0.3) -> np.ndarray:
        burst = np.zeros(T)
        start = rng.integers(T // 4, 3 * T // 4)
        end   = min(start + int(dur_s * SAMPLING_RATE_HZ), T)
        burst[start:end] = amp * rng.standard_normal(end - start)
        return burst

    X_teacher_list = []
    for _ in range(n_samples):
        trial = np.zeros((32, T), dtype=np.float32)
        for ch in range(32):
            trial[ch] = (neural() + powerline()).astype(np.float32)
        for ch_idx in FRONTAL_INDICES:
            trial[ch_idx] += eye_blink(amp=float(rng.uniform(50, 100))).astype(np.float32)
        non_frontal = [c for c in range(32) if c not in FRONTAL_INDICES]
        for ch_idx in rng.choice(non_frontal, size=2, replace=False):
            trial[ch_idx] += muscle_burst().astype(np.float32)
        X_teacher_list.append(trial)

    X_teacher = np.stack(X_teacher_list)                              # (N, 32, T)
    X_student = X_teacher[:, [T7_INDEX, T8_INDEX], :]
    y_emo     = rng.integers(0, 2, size=n_samples)
    source    = np.array(['deap' if i % 2 == 0 else 'sam40'
                          for i in range(n_samples)])

    npz_path = out_dir / "bandpass_filtered_dataset.npz"
    np.savez(npz_path, X_teacher=X_teacher, X_student=X_student,
             y_emo=y_emo, source=source)

    print(f"  Synthetic bandpass_filtered_dataset.npz → {npz_path}")
    print(f"    X_teacher : {X_teacher.shape}  "
          f"(neural + 50/100 Hz + eye-blink + muscle burst)")
    return npz_path


if __name__ == '__main__':
    import tempfile, argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--test', action='store_true',
                        help='Run on synthetic data instead of real data')
    args = parser.parse_args()

    real_input = UNIFIED_OUTPUT_DIR / "bandpass_filtered_dataset.npz"

    if args.test:
        print("=" * 62)
        print("  NOTCH + ICA + EPOCH PIPELINE — SELF-TEST (synthetic data)")
        print("=" * 62)
        with tempfile.TemporaryDirectory() as tmp:
            syn_dir = Path(tmp) / "unified_output"
            syn_dir.mkdir()
            print("\n[0] Generating synthetic bandpass_filtered_dataset.npz …")
            input_npz = _make_synthetic_bandpass_npz(syn_dir, n_samples=30)
            epochs = run_notch_ica_epoch_pipeline(input_npz=input_npz, verify=True)
            E, Tch, W = epochs['X_teacher'].shape
            Sch = epochs['X_student'].shape[1]
            exp_W = int(EPOCH_LEN_S * SAMPLING_RATE_HZ)
            t7 = np.allclose(epochs['X_student'][:, 0, :], epochs['X_teacher'][:, T7_INDEX, :])
            t8 = np.allclose(epochs['X_student'][:, 1, :], epochs['X_teacher'][:, T8_INDEX, :])
            checks = {
                'Teacher channels == 32'    : Tch == 32,
                'Student channels == 2'     : Sch == 2,
                f'Epoch width == {exp_W}' : W == exp_W,
                'Student ch-0 == T7'        : t7,
                'Student ch-1 == T8'        : t8,
            }
            for desc, ok in checks.items():
                print(f"  {desc:<38s}: {'OK  ✓' if ok else 'FAIL ✗'}")
            print("\n  Self-test complete.\n")
            sys.exit(0 if all(checks.values()) else 1)

    elif real_input.exists():
        print("=" * 62)
        print("  NOTCH + ICA + EPOCH PIPELINE — REAL DATA")
        print("=" * 62)
        run_notch_ica_epoch_pipeline(input_npz=real_input, verify=True)

    else:
        print(f"\n  ERROR: input not found:\n    {real_input}")
        print("  Run bandpass_filtering.py first, or use --test for synthetic data.\n")
        sys.exit(1)