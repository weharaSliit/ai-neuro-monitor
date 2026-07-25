#!/usr/bin/env python3
"""
Signal Normalisation Pipeline
==============================
Datasets : DEAP + SAM40 (unified)
Input    : unified_output/preprocessed_dataset.npz
           Keys → X_teacher  (E, 32, W)  clean, epoched, all 32 channels
                  X_student  (E,  2, W)  clean, epoched, T7 + T8 only
                  y_emo      (E,)         emotional stress labels
                  y_perc     (E,)         latent sustained stress targets (self-supervised auxiliary)
                  source     (E,)         'deap' | 'sam40' per epoch
                  trial_idx  (E,)         parent trial index

Output   : unified_output/normalized_dataset.npz
           Keys → X_teacher  (E, 32, W)  normalised, all 32 channels
                  X_student  (E,  2, W)  normalised, T7 + T8 only
                  y_emo      (E,)         unchanged
                  y_perc     (E,)         unchanged
                  source     (E,)         unchanged
                  trial_idx  (E,)         unchanged
                  subject_id (E,)         subject index per epoch (int32)

Pipeline (applied in this order)
----------------------------------
  [1] Baseline correction      — subtract pre-stimulus window mean per channel
  [2] Baseline drift removal   — linear detrend per channel per epoch
  [3] Savitzky-Golay smoothing — SAM40 epochs only (removes residual baseline
                                 drift from variable task-onset conditions)
  [4] Z-score normalisation    — per channel, grouped by subject
                                 (global per channel if no subject map provided)

Step detail
-----------
  Baseline correction
    Window  : first BASELINE_FRAC × W samples of each epoch (default 25% = 64 samp)
    Why 25% : mimics pre-stimulus baseline window used in standard ERP analysis;
              removes epoch-level DC offset without needing explicit stim markers

  Baseline drift removal
    Method  : scipy.signal.detrend (linear) per channel per epoch
    Why     : ICA removes large artefacts but slow linear drift can remain,
              especially in SAM40 where task transitions create ramp-like offsets

  Savitzky-Golay smoothing  (SAM40 only)
    Window  : SG_WINDOW_SAMPLES samples (default 11 = ~43 ms @ 256 Hz)
    Order   : SG_POLY_ORDER (default 3)
    Why SAM40 only : SAM40 task-switching (Arithmetic→Stroop→Mirror→Relax)
              introduces more residual baseline variation than DEAP's passive
              video-watching paradigm; SG preserves peak shape while attenuating
              slow non-physiological drift; DEAP epochs are already clean enough

  Z-score normalisation
    Scope   : per channel, per subject
    Formula : z = (x − μ_ch_subj) / (σ_ch_subj + ε)
    Why     : removes inter-subject amplitude differences caused by electrode
              impedance, skull thickness, and recording setup variations;
              per-subject (not global) prevents one high-amplitude subject
              dominating the distribution
    Fallback: if subject_ids array is not provided, normalisation is computed
              per channel globally across all epochs with a warning

Subject identification
----------------------
  Subject IDs are inferred from trial_idx using trials-per-subject counts:
    DEAP  : 40 trials/subject  (32 subjects × 40 trials = 1280 trials)
    SAM40 : 12 trials/subject  (40 subjects × 12 trials =  480 trials)
  If total trial counts do not match, per-channel global fallback is used.
  An explicit subject_ids array can be passed to run_normalisation_pipeline()
  to override inference.

Next step → feature_extraction.py
"""

import sys
import warnings
import numpy as np
from pathlib import Path
from scipy.signal import savgol_filter, detrend
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

UNIFIED_OUTPUT_DIR: Path = Path("/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/Research/ai-neuro-monitor/eeg/data/unified_output")

SAMPLING_RATE_HZ: float = 256.0

# ── Baseline correction ───────────────────────────────────────
BASELINE_FRAC: float = 0.25   # fraction of epoch used as pre-stimulus baseline
                                # 0.25 × 256 = 64 samples = 250 ms

# ── Savitzky-Golay (SAM40 only) ───────────────────────────────
SG_WINDOW_SAMPLES: int = 11   # must be odd;  11 samp ≈ 43 ms @ 256 Hz
SG_POLY_ORDER:     int = 3    # polynomial order (must be < window)

# ── Z-score ───────────────────────────────────────────────────
ZSCORE_EPSILON: float = 1e-8  # added to std to prevent division-by-zero

INCLUDE_SAM40: bool = True  # set False to restrict normalisation to DEAP only

# ── Subject trial counts (for ID inference) ───────────────────
DEAP_TRIALS_PER_SUBJECT:  int = 40
SAM40_TRIALS_PER_SUBJECT: int = 12


# ─────────────────────────────────────────────
#  [1] BASELINE CORRECTION
# ─────────────────────────────────────────────

def apply_baseline_correction(
    X:             np.ndarray,
    baseline_frac: float = BASELINE_FRAC,
) -> np.ndarray:
    """
    Subtract the pre-stimulus window mean from every channel in every epoch.

    The baseline window is the first `baseline_frac` proportion of the epoch
    (default 25% = 64 samples = 250 ms at 256 Hz).  This mimics standard ERP
    baseline correction and removes epoch-level DC offsets without requiring
    explicit stimulus timing markers.

    Parameters
    ----------
    X             : np.ndarray  (E, n_ch, W)  epoched EEG.
    baseline_frac : float       Fraction of W to use as baseline (default 0.25).

    Returns
    -------
    np.ndarray  (E, n_ch, W)  baseline-corrected, float32.
    """
    E, n_ch, W    = X.shape
    baseline_end  = max(1, int(baseline_frac * W))
    baseline_mean = X[:, :, :baseline_end].mean(axis=2, keepdims=True)  # (E, n_ch, 1)
    X_corrected   = (X.astype(np.float64) - baseline_mean.astype(np.float64))

    print(f"  Baseline correction: window = first {baseline_end} samples "
          f"({baseline_end / SAMPLING_RATE_HZ * 1000:.0f} ms)  "
          f"[{E} epochs × {n_ch} ch]")
    return X_corrected.astype(np.float32)


# ─────────────────────────────────────────────
#  [2] BASELINE DRIFT REMOVAL
# ─────────────────────────────────────────────

def apply_detrend(X: np.ndarray) -> np.ndarray:
    """
    Remove linear baseline drift per channel per epoch using scipy.signal.detrend.

    Linear detrending fits and subtracts a straight line from each channel
    time series.  This targets slow ramp-like offsets that ICA does not remove,
    particularly at task-transition boundaries in SAM40.

    Parameters
    ----------
    X : np.ndarray  (E, n_ch, W)  baseline-corrected EEG.

    Returns
    -------
    np.ndarray  (E, n_ch, W)  detrended, float32.
    """
    E, n_ch, W = X.shape
    X_dt = X.astype(np.float64).copy()

    for e in range(E):
        for ch in range(n_ch):
            X_dt[e, ch] = detrend(X_dt[e, ch], type='linear')

    print(f"  Baseline drift removal: linear detrend  [{E} epochs × {n_ch} ch]")
    return X_dt.astype(np.float32)


# ─────────────────────────────────────────────
#  [3] SAVITZKY-GOLAY SMOOTHING  (SAM40 ONLY)
# ─────────────────────────────────────────────

def apply_savitzky_golay(
    X:         np.ndarray,
    source:    np.ndarray,
    window:    int = SG_WINDOW_SAMPLES,
    polyorder: int = SG_POLY_ORDER,
) -> np.ndarray:
    """
    Apply Savitzky-Golay smoothing to SAM40 epochs only.

    SAM40's cognitive task-switching paradigm (Arithmetic → Stroop →
    Mirror → Relax) introduces more residual slow-wave variation than DEAP's
    passive video-watching design.  Savitzky-Golay preserves peak amplitude
    and timing while attenuating these non-physiological low-frequency
    components.  DEAP epochs are left unchanged.

    Parameters
    ----------
    X         : np.ndarray  (E, n_ch, W)  detrended EEG.
    source    : np.ndarray  (E,)          'deap' | 'sam40' per epoch.
    window    : int         SG window length in samples (must be odd,
                            default 11 ≈ 43 ms @ 256 Hz).
    polyorder : int         SG polynomial order (default 3; must be < window).

    Returns
    -------
    np.ndarray  (E, n_ch, W)  SAM40 epochs smoothed, DEAP epochs unchanged.
    """
    if window % 2 == 0:
        raise ValueError(f"SG window must be odd, got {window}.")
    if polyorder >= window:
        raise ValueError(f"SG polyorder ({polyorder}) must be < window ({window}).")

    X_sg         = X.astype(np.float64).copy()
    sam40_mask   = np.array([str(s).lower() == 'sam40' for s in source])
    n_sam40      = int(sam40_mask.sum())

    if n_sam40 == 0:
        print(f"  Savitzky-Golay: no SAM40 epochs found — skipping")
        return X_sg.astype(np.float32)

    E, n_ch, W = X.shape
    for e in np.where(sam40_mask)[0]:
        for ch in range(n_ch):
            X_sg[e, ch] = savgol_filter(X_sg[e, ch], window, polyorder)

    print(f"  Savitzky-Golay: window={window} ({window/SAMPLING_RATE_HZ*1000:.0f} ms)  "
          f"polyorder={polyorder}  "
          f"applied to {n_sam40} SAM40 epochs  "
          f"(DEAP {E - n_sam40} epochs unchanged)")
    return X_sg.astype(np.float32)


# ─────────────────────────────────────────────
#  SUBJECT ID INFERENCE
# ─────────────────────────────────────────────

def infer_subject_ids(
    trial_idx: np.ndarray,
    source:    np.ndarray,
) -> Optional[np.ndarray]:
    """
    Infer per-epoch subject IDs from trial_idx and source using known
    trials-per-subject counts (DEAP=40, SAM40=12).

    Subject IDs are assigned independently within each dataset, then offset
    so DEAP subjects are 0–31 and SAM40 subjects are 32–71.

    Parameters
    ----------
    trial_idx : np.ndarray  (E,)  parent trial index per epoch.
    source    : np.ndarray  (E,)  'deap' | 'sam40' per epoch.

    Returns
    -------
    np.ndarray (E,) int32 subject IDs, or None if inference fails.
    """
    subject_ids = np.full(len(trial_idx), -1, dtype=np.int32)

    deap_mask  = np.array([str(s).lower() == 'deap'  for s in source])
    sam40_mask = np.array([str(s).lower() == 'sam40' for s in source])

    # DEAP: trial 0–39 → subj 0, trial 40–79 → subj 1, …
    if deap_mask.any():
        max_trial_deap = int(trial_idx[deap_mask].max())
        inferred_n_deap = (max_trial_deap // DEAP_TRIALS_PER_SUBJECT) + 1
        subject_ids[deap_mask] = (
            trial_idx[deap_mask] // DEAP_TRIALS_PER_SUBJECT
        ).astype(np.int32)

    # SAM40: trial N → subj (N // 12) + 32   (offset past DEAP subjects)
    if sam40_mask.any():
        subject_ids[sam40_mask] = (
            trial_idx[sam40_mask] // SAM40_TRIALS_PER_SUBJECT + 32
        ).astype(np.int32)

    if (subject_ids == -1).any():
        warnings.warn(
            "Subject ID inference failed for some epochs — falling back to "
            "global per-channel z-score.",
            UserWarning,
        )
        return None

    n_subj = len(np.unique(subject_ids))
    print(f"  Subject IDs inferred: {n_subj} unique subjects  "
          f"(DEAP range {subject_ids[deap_mask].min() if deap_mask.any() else 'N/A'}–"
          f"{subject_ids[deap_mask].max() if deap_mask.any() else 'N/A'}, "
          f"SAM40 range {subject_ids[sam40_mask].min() if sam40_mask.any() else 'N/A'}–"
          f"{subject_ids[sam40_mask].max() if sam40_mask.any() else 'N/A'})")
    return subject_ids


# ─────────────────────────────────────────────
#  [4] Z-SCORE NORMALISATION
# ─────────────────────────────────────────────

def apply_zscore_normalisation(
    X:           np.ndarray,
    subject_ids: Optional[np.ndarray] = None,
    eps:         float                = ZSCORE_EPSILON,
) -> Tuple[np.ndarray, Dict]:
    """
    Z-score normalise per channel, grouped by subject.

    For each (subject, channel) pair, compute mean and std across all epochs
    belonging to that subject, then standardise:
        z = (x − μ) / (σ + ε)

    This removes inter-subject amplitude differences caused by electrode
    impedance variation, skull conductivity, and recording equipment drift.
    Per-subject scope (rather than global) prevents high-amplitude subjects
    from dominating the training distribution.

    If `subject_ids` is None, falls back to global per-channel normalisation
    (compute mean/std across all epochs for each channel).

    Parameters
    ----------
    X           : np.ndarray          (E, n_ch, W)  SG-smoothed EEG.
    subject_ids : np.ndarray or None  (E,) int32 subject index per epoch.
                                      None → global per-channel fallback.
    eps         : float               Stability constant (default 1e-8).

    Returns
    -------
    X_z   : np.ndarray  (E, n_ch, W) z-scored, float32.
    stats : dict        μ and σ per (subject_id, channel_idx) for inspection
                        or inverse-transform. Keys: 'means', 'stds', 'mode'.
    """
    E, n_ch, W = X.shape
    X_z        = X.astype(np.float64).copy()
    stats      = {'means': {}, 'stds': {}, 'mode': ''}

    if subject_ids is None:
        # ── Global per-channel fallback ───────────────────────
        warnings.warn(
            "subject_ids not provided — applying global per-channel z-score.",
            UserWarning,
        )
        for ch in range(n_ch):
            mu  = X_z[:, ch, :].mean()
            sig = X_z[:, ch, :].std()
            X_z[:, ch, :] = (X_z[:, ch, :] - mu) / (sig + eps)
            stats['means'][('global', ch)] = float(mu)
            stats['stds'][('global', ch)]  = float(sig)
        stats['mode'] = 'global_per_channel'
        print(f"  Z-score: global per-channel  [{E} epochs × {n_ch} ch]")

    else:
        # ── Per-subject per-channel ───────────────────────────
        unique_subjs = np.unique(subject_ids)
        for subj in unique_subjs:
            subj_mask = subject_ids == subj
            for ch in range(n_ch):
                # epochs belonging to this subject, this channel: (n_s, W)
                data = X_z[subj_mask, ch, :]
                mu   = data.mean()
                sig  = data.std()
                X_z[subj_mask, ch, :] = (data - mu) / (sig + eps)
                stats['means'][(int(subj), ch)] = float(mu)
                stats['stds'][(int(subj), ch)]  = float(sig)
        stats['mode'] = 'per_subject_per_channel'
        n_subj = len(unique_subjs)
        print(f"  Z-score: per subject per channel  "
              f"[{n_subj} subjects × {n_ch} ch × {E} epochs]")

    # Verify distribution
    grand_mean = float(X_z.mean())
    grand_std  = float(X_z.std())
    print(f"  Post z-score:  grand mean={grand_mean:.4f}  grand std={grand_std:.4f}  "
          f"(expect ~0 and ~1)")

    return X_z.astype(np.float32), stats


# ─────────────────────────────────────────────
#  RE-DERIVE STUDENT CHANNELS
# ─────────────────────────────────────────────

def _sync_student(X_teacher: np.ndarray) -> np.ndarray:
    """Extract T7 (idx 6) and T8 (idx 23) from normalised teacher array."""
    return X_teacher[:, [T7_INDEX, T8_INDEX], :]


# ─────────────────────────────────────────────
#  VERIFICATION
# ─────────────────────────────────────────────

def verify_normalisation(
    X_before: np.ndarray,
    X_after:  np.ndarray,
    ch_idx:   int   = T7_INDEX,
    label:    str   = 'T7',
) -> Dict[str, float]:
    """
    Print before/after statistics for a single channel to confirm each step.
    Uses the first 50 epochs (or all if fewer).
    """
    n = min(50, X_before.shape[0])
    raw = X_before[:n, ch_idx, :].ravel().astype(np.float64)
    nrm = X_after[:n,  ch_idx, :].ravel().astype(np.float64)

    stats = {
        'channel'          : label,
        'raw_mean'         : float(raw.mean()),
        'raw_std'          : float(raw.std()),
        'raw_min'          : float(raw.min()),
        'raw_max'          : float(raw.max()),
        'normalised_mean'  : float(nrm.mean()),
        'normalised_std'   : float(nrm.std()),
        'normalised_min'   : float(nrm.min()),
        'normalised_max'   : float(nrm.max()),
    }

    print(f"\n  [{label}] Normalisation verification  (first {n} epochs)")
    print(f"    mean     : {stats['raw_mean']:+.4f}  →  {stats['normalised_mean']:+.4f}")
    print(f"    std      : {stats['raw_std']:.4f}   →  {stats['normalised_std']:.4f}")
    print(f"    range    : [{stats['raw_min']:.3f}, {stats['raw_max']:.3f}]  →  "
          f"[{stats['normalised_min']:.3f}, {stats['normalised_max']:.3f}]")
    return stats


# ─────────────────────────────────────────────
#  FULL PIPELINE ENTRY POINT
# ─────────────────────────────────────────────

def run_normalisation_pipeline(
    input_npz:   Path,
    output_npz:  Optional[Path]        = None,
    subject_ids: Optional[np.ndarray]  = None,
    baseline_frac: float               = BASELINE_FRAC,
    sg_window:   int                   = SG_WINDOW_SAMPLES,
    sg_polyorder: int                  = SG_POLY_ORDER,
    verify:      bool                  = True,
) -> Dict[str, np.ndarray]:
    """
    Baseline correction → detrend → Savitzky-Golay (SAM40) → Z-score.

    Parameters
    ----------
    input_npz     : Path    Path to preprocessed_dataset.npz.
    output_npz    : Path    Defaults to unified_output/normalized_dataset.npz.
    subject_ids   : np.ndarray or None
                            (E,) int32 per-epoch subject IDs.  If None, IDs are
                            inferred from trial_idx using known trials-per-subject
                            counts; falls back to global per-channel if inference
                            fails.
    baseline_frac : float   Pre-stimulus window as fraction of epoch (default 0.25).
    sg_window     : int     Savitzky-Golay window in samples (default 11, odd).
    sg_polyorder  : int     Savitzky-Golay polynomial order (default 3).
    verify        : bool    Print before/after stats for T7 and T8.

    Returns
    -------
    dict with keys:
        'X_teacher', 'X_student', 'y_emo', 'y_perc',
        'source', 'trial_idx', 'subject_id'
    """
    if output_npz is None:
        output_npz = UNIFIED_OUTPUT_DIR / "normalized_dataset.npz"

    output_npz.parent.mkdir(parents=True, exist_ok=True)

    print("\n" + "=" * 62)
    print("  SIGNAL NORMALISATION PIPELINE")
    print(f"  Baseline  : first {baseline_frac:.0%} of epoch  "
          f"({int(baseline_frac * SAMPLING_RATE_HZ)} ms)")
    print(f"  Detrend   : linear per channel per epoch")
    print(f"  SG filter : window={sg_window} ({sg_window/SAMPLING_RATE_HZ*1000:.0f} ms)  "
          f"polyorder={sg_polyorder}  SAM40 only")
    print(f"  Z-score   : per channel per subject")
    print("=" * 62)

    # ── [1] Load ───────────────────────────────────────────────
    print(f"\n[1] Loading  {input_npz}")
    data      = np.load(input_npz, allow_pickle=True)
    X_teacher = data['X_teacher'].astype(np.float32)
    y_emo     = data['y_emo']
    y_perc    = data['y_perc']
    source    = data['source']
    trial_idx = data['trial_idx']

    E, n_ch, W = X_teacher.shape
    print(f"    X_teacher : {X_teacher.shape}  dtype={X_teacher.dtype}")
    print(f"    y_emo     : {y_emo.shape}   pos={int(y_emo.sum())}  neg={int((y_emo==0).sum())}")
    print(f"    sources   : {np.unique(source)}")
    print(f"    trials    : {int(trial_idx.max()) + 1} unique parent trials")

    # ── Optional DEAP-only filter ─────────────────────────────
    deap_mask = np.array([str(s).lower() == "deap" for s in source])
    if not INCLUDE_SAM40 and deap_mask.any() and not deap_mask.all():
        n_before  = len(X_teacher)
        X_teacher = X_teacher[deap_mask]
        y_emo     = y_emo[deap_mask]
        y_perc    = y_perc[deap_mask]
        source    = source[deap_mask]
        trial_idx = trial_idx[deap_mask]
        E         = len(X_teacher)
        pw = float(((y_perc==0).sum() / max(y_perc.sum(),1))**0.5)
        print(f"  DEAP-only: kept {E:,} / {n_before:,} epochs  ({n_before-E:,} SAM40 removed)")
        print(f"  y_emo  : pos={int(y_emo.sum()):,}  balance={y_emo.mean():.2%}")
        print(f"  y_perc : pos={int(y_perc.sum()):,}  balance={y_perc.mean():.2%}  pw_sqrt={pw:.2f}x")
    elif not deap_mask.any():
        print("  WARNING: no DEAP epochs — proceeding with all data")
    else:
        n_sam40 = int((~deap_mask).sum())
        if n_sam40:
            print(f"  INCLUDE_SAM40=True: retaining {n_sam40:,} SAM40 epochs")

    X_before = X_teacher.copy()   # snapshot for verification

    # ── [2] Infer subject IDs if not provided ─────────────────
    print(f"\n[2] Subject ID resolution …")
    if subject_ids is None:
        subject_ids = infer_subject_ids(trial_idx, source)
    else:
        n_subj = len(np.unique(subject_ids))
        print(f"  Using provided subject_ids: {n_subj} unique subjects")

    # ── [3] Baseline correction ───────────────────────────────
    print(f"\n[3] Baseline correction …")
    X_teacher = apply_baseline_correction(X_teacher, baseline_frac)

    # ── [4] Baseline drift removal (detrend) ──────────────────
    print(f"\n[4] Baseline drift removal (linear detrend) …")
    X_teacher = apply_detrend(X_teacher)

    # ── [5] Savitzky-Golay smoothing (SAM40 only) ─────────────
    print(f"\n[5] Savitzky-Golay smoothing (SAM40 only) …")
    X_teacher = apply_savitzky_golay(X_teacher, source, sg_window, sg_polyorder)

    # ── [6] Z-score normalisation ─────────────────────────────
    print(f"\n[6] Z-score normalisation …")
    X_teacher, zscore_stats = apply_zscore_normalisation(X_teacher, subject_ids)

    # ── [7] Verification ──────────────────────────────────────
    if verify:
        print(f"\n[7] Verification …")
        verify_normalisation(X_before, X_teacher, T7_INDEX, 'T7')
        verify_normalisation(X_before, X_teacher, T8_INDEX, 'T8')

    # ── [8] Re-sync student channels ──────────────────────────
    print(f"\n[8] Re-syncing student channels (T7 + T8) from normalised teacher …")
    X_student = _sync_student(X_teacher)
    print(f"    X_student : {X_student.shape}")

    # ── [9] Save ───────────────────────────────────────────────
    # Resolve subject_ids for saving (may be None if inference failed → global mode)
    subj_ids_save = (subject_ids if subject_ids is not None
                     else np.full(E, -1, dtype=np.int32))

    print(f"\n[9] Saving  →  {output_npz}")
    np.savez(
        output_npz,
        X_teacher  = X_teacher,
        X_student  = X_student,
        y_emo      = y_emo,
        y_perc     = y_perc,
        source     = source,
        trial_idx  = trial_idx,
        subject_id = subj_ids_save,
    )

    # ── Summary ────────────────────────────────────────────────
    print("\n" + "=" * 62)
    print("  OUTPUT SUMMARY")
    print("=" * 62)
    print(f"  X_teacher  : {X_teacher.shape}  dtype={X_teacher.dtype}")
    print(f"  X_student  : {X_student.shape}   dtype={X_student.dtype}")
    print(f"  y_emo      : {y_emo.shape}    unique={np.unique(y_emo)}")
    print(f"  y_perc     : {y_perc.shape}   unique={np.unique(y_perc)}")
    print(f"  source     : {source.shape}   unique={np.unique(source)}")
    print(f"  trial_idx  : {trial_idx.shape}")
    print(f"  subject_id : {subj_ids_save.shape}  "
          f"unique={len(np.unique(subj_ids_save))} subjects")
    print(f"  Z-score mode : {zscore_stats['mode']}")
    print(f"\n  Saved to  : {output_npz}")
    print(f"\n  Next step → feature_extraction.py")
    print("=" * 62 + "\n")

    return {
        'X_teacher'  : X_teacher,
        'X_student'  : X_student,
        'y_emo'      : y_emo,
        'y_perc'     : y_perc,
        'source'     : source,
        'trial_idx'  : trial_idx,
        'subject_id' : subj_ids_save,
    }


# ─────────────────────────────────────────────
#  SELF-TEST  (python normalisation.py)
# ─────────────────────────────────────────────

def _make_synthetic_preprocessed_npz(
    out_dir:      Path,
    n_deap:       int = 40,   # 1 DEAP subject × 40 trials
    n_sam40:      int = 12,   # 1 SAM40 subject × 12 trials
    epochs_per_trial: int = 19,
) -> Path:
    """
    Write a synthetic preprocessed_dataset.npz mimicking the output of
    notch_filter_ica.py.  Injects:
      · Inter-subject amplitude differences (different scale per source)
      · Slow linear drift per epoch (for detrend verification)
      · SAM40-specific baseline wander (for SG verification)
    """
    rng = np.random.default_rng(7)
    W   = 256   # 1 s at 256 Hz
    t   = np.arange(W) / SAMPLING_RATE_HZ

    def neural(amp: float = 1.0) -> np.ndarray:
        return amp * (
            0.5 * np.sin(2 * np.pi * 10 * t) +
            0.3 * np.sin(2 * np.pi * 20 * t) +
            0.2 * np.sin(2 * np.pi * 35 * t) +
            0.1 * rng.standard_normal(W)
        )

    teacher_list, y_emo_list, y_perc_list = [], [], []
    source_list, trial_list = [], []

    # DEAP: amplitude scale ~5 µV
    for trial in range(n_deap):
        for _ in range(epochs_per_trial):
            drift  = 2.0 * t                              # slow linear drift
            ep     = np.stack([neural(amp=5.0) + drift for _ in range(32)])
            teacher_list.append(ep.astype(np.float32))
            y_emo_list.append(rng.integers(0, 2))
            y_perc_list.append(rng.integers(0, 2))
            source_list.append('deap')
            trial_list.append(trial)

    # SAM40: amplitude scale ~30 µV + extra baseline wander
    sam40_trial_offset = n_deap
    for trial in range(n_sam40):
        for _ in range(epochs_per_trial):
            wander = 10.0 * np.sin(2 * np.pi * 0.3 * t)  # slow sine wander
            drift  = 3.0 * t
            ep     = np.stack([neural(amp=30.0) + wander + drift for _ in range(32)])
            teacher_list.append(ep.astype(np.float32))
            y_emo_list.append(rng.integers(0, 2))
            y_perc_list.append(rng.integers(0, 2))
            source_list.append('sam40')
            trial_list.append(trial + sam40_trial_offset)

    X_teacher = np.stack(teacher_list)
    X_student = X_teacher[:, [T7_INDEX, T8_INDEX], :]
    y_emo     = np.array(y_emo_list,  dtype=np.int32)
    y_perc    = np.array(y_perc_list, dtype=np.int32)
    source    = np.array(source_list)
    trial_idx = np.array(trial_list,  dtype=np.int32)

    npz_path = out_dir / "preprocessed_dataset.npz"
    np.savez(npz_path,
             X_teacher=X_teacher, X_student=X_student,
             y_emo=y_emo, y_perc=y_perc, source=source, trial_idx=trial_idx)

    E_deap  = n_deap  * epochs_per_trial
    E_sam40 = n_sam40 * epochs_per_trial
    print(f"  Synthetic preprocessed_dataset.npz → {npz_path}")
    print(f"    X_teacher : {X_teacher.shape}  "
          f"(DEAP {E_deap} epochs amp~5µV, SAM40 {E_sam40} epochs amp~30µV + wander)")
    return npz_path


if __name__ == '__main__':
    import tempfile, argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--test', action='store_true',
                        help='Run on synthetic data instead of real data')
    args = parser.parse_args()

    real_input = UNIFIED_OUTPUT_DIR / "preprocessed_dataset.npz"

    if args.test:
        print("=" * 62)
        print("  SIGNAL NORMALISATION — SELF-TEST (synthetic data)")
        print("=" * 62)
        with tempfile.TemporaryDirectory() as tmp:
            syn_dir = Path(tmp) / "unified_output"
            syn_dir.mkdir()
            print("\n[0] Generating synthetic preprocessed_dataset.npz …")
            input_npz = _make_synthetic_preprocessed_npz(syn_dir)
            result = run_normalisation_pipeline(input_npz=input_npz, verify=True)
            X_t = result['X_teacher']
            X_s = result['X_student']
            E, Tch, W = X_t.shape
            means_ok = bool(np.abs(X_t.reshape(E, Tch, -1).mean(axis=(0,2))).max() < 0.5)
            stds_ok  = bool(np.abs(X_t.reshape(E, Tch, -1).std(axis=(0,2)) - 1.0).max() < 0.5)
            t7 = np.allclose(X_s[:, 0, :], X_t[:, T7_INDEX, :])
            t8 = np.allclose(X_s[:, 1, :], X_t[:, T8_INDEX, :])
            checks = {
                'Teacher channels == 32' : Tch == 32,
                'Student ch-0 == T7'     : t7,
                'Student ch-1 == T8'     : t8,
                'Grand mean per ch ~0'   : means_ok,
                'Grand std  per ch ~1'   : stds_ok,
                'No NaN'                 : bool(~np.isnan(X_t).any()),
            }
            for desc, ok in checks.items():
                print(f"  {desc:<32s}: {'OK  ✓' if ok else 'FAIL ✗'}")
            print("\n  Self-test complete.\n")
            sys.exit(0 if all(checks.values()) else 1)

    elif real_input.exists():
        print("=" * 62)
        print("  SIGNAL NORMALISATION — REAL DATA")
        print("=" * 62)
        run_normalisation_pipeline(input_npz=real_input, verify=True)

    else:
        print(f"\n  ERROR: input not found:\n    {real_input}")
        print("  Run notch_filter_ica.py first, or use --test for synthetic data.\n")
        sys.exit(1)