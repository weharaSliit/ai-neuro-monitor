import sys
import numpy as np
from pathlib import Path
from scipy.signal import butter, filtfilt, periodogram
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

BANDPASS_LOW_HZ:  float = 0.5
BANDPASS_HIGH_HZ: float = 45.0
FILTER_ORDER:     int   = 4
SAMPLING_RATE_HZ: float = 256.0             # DEAP native; SAM40 resampled to this

UNIFIED_OUTPUT_DIR: Path = Path("/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/Research/ai-neuro-monitor/eeg/data/unified_output")


# ─────────────────────────────────────────────
#  FILTER DESIGN
# ─────────────────────────────────────────────

def build_bandpass_filter(
    low_hz:  float = BANDPASS_LOW_HZ,
    high_hz: float = BANDPASS_HIGH_HZ,
    order:   int   = FILTER_ORDER,
    fs:      float = SAMPLING_RATE_HZ,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Design a zero-phase Butterworth bandpass filter.

    Parameters
    ----------
    low_hz  : float  Lower cutoff frequency in Hz (default 0.5).
    high_hz : float  Upper cutoff frequency in Hz (default 45.0).
    order   : int    Filter order (default 4).
    fs      : float  Sampling rate in Hz (default 256.0).

    Returns
    -------
    (b, a) : filter coefficients for use with scipy.signal.filtfilt.
    """
    nyq    = fs / 2.0
    low_n  = low_hz  / nyq
    high_n = high_hz / nyq
    b, a   = butter(order, [low_n, high_n], btype='band', analog=False)
    return b, a


# ─────────────────────────────────────────────
#  APPLY FILTER — NUMPY ARRAY
# ─────────────────────────────────────────────

def apply_bandpass(
    eeg_array: np.ndarray,
    fs:        float = SAMPLING_RATE_HZ,
    low_hz:    float = BANDPASS_LOW_HZ,
    high_hz:   float = BANDPASS_HIGH_HZ,
    order:     int   = FILTER_ORDER,
) -> np.ndarray:
    """
    Apply zero-phase bandpass filter to an EEG numpy array.

    filtfilt applies the filter forward then backward, producing zero phase
    shift. This is critical so every channel's temporal structure is preserved
    identically — any per-channel phase delay would misalign T7/T8 relative to
    the full 32-channel teacher representation.

    Parameters
    ----------
    eeg_array : np.ndarray
        Shape (n_channels, n_samples)         — single trial / segment
        Shape (n_samples, n_channels)         — NOT supported; transpose first
        Shape (n_samples,)                    — single channel
        Shape (n_trials, n_channels, n_samples) — batch of trials
    fs        : float  Sampling rate in Hz.
    low_hz    : float  Bandpass lower cutoff Hz.
    high_hz   : float  Bandpass upper cutoff Hz.
    order     : int    Butterworth filter order.

    Returns
    -------
    np.ndarray  Filtered array, same shape as input.

    Raises
    ------
    ValueError  If array is not 1D, 2D, or 3D.
    """
    b, a = build_bandpass_filter(low_hz, high_hz, order, fs)
    arr  = eeg_array.astype(np.float64)

    if arr.ndim == 1:
        arr = filtfilt(b, a, arr)

    elif arr.ndim == 2:                        # (n_channels, n_samples)
        for ch in range(arr.shape[0]):
            arr[ch] = filtfilt(b, a, arr[ch])

    elif arr.ndim == 3:                        # (n_trials, n_channels, n_samples)
        for trial in range(arr.shape[0]):
            for ch in range(arr.shape[1]):
                arr[trial, ch] = filtfilt(b, a, arr[trial, ch])

    else:
        raise ValueError(
            f"Expected 1D, 2D (ch, samples) or 3D (trials, ch, samples). "
            f"Got shape {eeg_array.shape}."
        )

    return arr


# ─────────────────────────────────────────────
#  TEACHER / STUDENT SPLIT
# ─────────────────────────────────────────────

def split_teacher_student(
    X_full_filtered: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Split a filtered EEG array into teacher (all 32 ch) and student (T7+T8).

    Must be called AFTER bandpass filtering so both arrays receive identically
    filtered signals. Extracting T7/T8 before filtering would produce the same
    numerical result, but calling after is clearer and avoids state errors.

    Parameters
    ----------
    X_full_filtered : np.ndarray
        Shape (N, 32, T) — bandpass-filtered full EEG array from apply_bandpass.

    Returns
    -------
    (X_teacher, X_student)
        X_teacher : np.ndarray  (N, 32, T)  all 32 channels
        X_student : np.ndarray  (N,  2, T)  T7 (index 6) and T8 (index 23) only

    Raises
    ------
    ValueError  If input is not 3D or does not have 32 channels.
    """
    if X_full_filtered.ndim != 3:
        raise ValueError(
            f"Expected (N, 32, T) array, got shape {X_full_filtered.shape}."
        )
    if X_full_filtered.shape[1] != 32:
        raise ValueError(
            f"Expected 32 channels (axis 1), got {X_full_filtered.shape[1]}."
        )

    X_teacher = X_full_filtered.copy()
    X_student = X_full_filtered[:, [T7_INDEX, T8_INDEX], :]

    return X_teacher, X_student


# ─────────────────────────────────────────────
#  VERIFICATION
# ─────────────────────────────────────────────

def verify_filter_effect(
    raw_trial:      np.ndarray,
    filtered_trial: np.ndarray,
    channel_index:  int   = T7_INDEX,
    fs:             float = SAMPLING_RATE_HZ,
) -> Dict[str, float]:
    """
    Compute before/after power statistics to confirm the filter worked.

    Checks:
      · Power below 0.5 Hz drops   — DC drift removed
      · Power in 1–45 Hz preserved — stress-relevant bands intact
      · Power above 45 Hz drops    — high-frequency muscle noise removed

    Parameters
    ----------
    raw_trial      : np.ndarray  Shape (32, T) — one unfiltered trial.
    filtered_trial : np.ndarray  Shape (32, T) — same trial after filtering.
    channel_index  : int         Which channel to inspect (default T7 = 6).
    fs             : float       Sampling rate in Hz.

    Returns
    -------
    dict of verification statistics.
    """
    raw = raw_trial[channel_index].astype(np.float64)
    flt = filtered_trial[channel_index].astype(np.float64)
    ch_name = EEG_CHANNELS[channel_index]

    def band_power(freqs, psd, lo, hi):
        mask = (freqs >= lo) & (freqs <= hi)
        return float(np.trapezoid(psd[mask], freqs[mask])) if mask.any() else 0.0

    fr, pr = periodogram(raw, fs)
    ff, pf = periodogram(flt, fs)

    pres = band_power(fr, pr, 1, 45)
    pref = band_power(ff, pf, 1, 45)
    preservation_pct = (pref / pres * 100) if pres > 0 else 0.0

    stats = {
        'channel'                    : ch_name,
        'raw_mean_abs'               : float(np.abs(raw).mean()),
        'filtered_mean_abs'          : float(np.abs(flt).mean()),
        'raw_power_below_0.5Hz'      : band_power(fr, pr, 0.0, 0.5),
        'filtered_power_below_0.5Hz' : band_power(ff, pf, 0.0, 0.5),
        'raw_power_1_45Hz'           : pres,
        'filtered_power_1_45Hz'      : pref,
        'preservation_pct'           : preservation_pct,
        'raw_power_above_45Hz'       : band_power(fr, pr, 45.0, fs / 2),
        'filtered_power_above_45Hz'  : band_power(ff, pf, 45.0, fs / 2),
    }

    print(f"\n  [{ch_name}] Filter verification")
    print(f"  Mean absolute      : {stats['raw_mean_abs']:.4f}  →  {stats['filtered_mean_abs']:.4f}")
    print(f"  Power <0.5 Hz      : {stats['raw_power_below_0.5Hz']:.4f}  →  {stats['filtered_power_below_0.5Hz']:.4f}  (DC removed)")
    print(f"  Power 1–45 Hz      : {pres:.4f}  →  {pref:.4f}  ({preservation_pct:.1f}% preserved)")
    print(f"  Power >45 Hz       : {stats['raw_power_above_45Hz']:.4f}  →  {stats['filtered_power_above_45Hz']:.4f}  (HF noise removed)")

    return stats


# ─────────────────────────────────────────────
#  FULL PIPELINE ENTRY POINT
# ─────────────────────────────────────────────

def run_bandpass_pipeline(
    input_npz:  Path,
    output_npz: Optional[Path] = None,
    fs:         float = SAMPLING_RATE_HZ,
    low_hz:     float = BANDPASS_LOW_HZ,
    high_hz:    float = BANDPASS_HIGH_HZ,
    order:      int   = FILTER_ORDER,
    verify:     bool  = True,
) -> Dict[str, np.ndarray]:
    """
    Load unified_dataset.npz, bandpass filter X_full, split into
    teacher / student arrays, save result, and return arrays.

    Parameters
    ----------
    input_npz  : Path   Path to unified_dataset.npz (output of
                        apply_unified_labeling.py).
    output_npz : Path   Where to write the filtered .npz.  Defaults to
                        <input_npz parent>/bandpass_filtered_dataset.npz.
    fs         : float  Sampling rate in Hz (default 256.0).
    low_hz     : float  Bandpass lower cutoff Hz (default 0.5).
    high_hz    : float  Bandpass upper cutoff Hz (default 45.0).
    order      : int    Butterworth filter order (default 4).
    verify     : bool   If True, print power-band stats for T7 and T8
                        on the first sample after filtering.

    Returns
    -------
    dict with keys:
        'X_teacher' — (N, 32, T) bandpass filtered, all 32 channels
        'X_student' — (N,  2, T) bandpass filtered, T7 + T8 only
        'y_emo'     — (N,) emotional stress labels   (unchanged)
        'source'    — (N,) dataset source per sample (unchanged)
    """
    if output_npz is None:
        output_npz = UNIFIED_OUTPUT_DIR / "bandpass_filtered_dataset.npz"

    output_npz.parent.mkdir(parents=True, exist_ok=True)

    print("\n" + "=" * 60)
    print("  BANDPASS FILTERING PIPELINE")
    print(f"  Filter : {low_hz}–{high_hz} Hz  |  "
          f"Butterworth order {order}  |  zero-phase  |  fs={fs} Hz")
    print("=" * 60)

    # ── [1] Load ──────────────────────────────────────────────────
    print(f"\n[1] Loading  {input_npz}")
    data   = np.load(input_npz, allow_pickle=True)
    X_full = data['X_full'].astype(np.float32)   # (N, 32, T)
    y_emo  = data['y_emo']
    source = data['source']

    N, n_ch, T = X_full.shape
    print(f"    X_full  : {X_full.shape}  (N={N}, channels={n_ch}, samples={T})")
    print(f"    y_emo   : {y_emo.shape}   pos={int(y_emo.sum())}  neg={int((y_emo == 0).sum())}")
    print(f"    sources : {np.unique(source)}")

    if n_ch != 32:
        raise ValueError(f"Expected 32 EEG channels, got {n_ch}. "
                         "Check that input comes from apply_unified_labeling.py.")

    # ── [2] Bandpass filter ───────────────────────────────────────
    print(f"\n[2] Applying bandpass filter to all {N} samples × {n_ch} channels …")
    X_filtered = apply_bandpass(X_full.astype(np.float64), fs=fs,
                                low_hz=low_hz, high_hz=high_hz, order=order)
    X_filtered = X_filtered.astype(np.float32)
    print(f"    Done.  X_filtered : {X_filtered.shape}")

    # ── [3] Teacher / student split ───────────────────────────────
    print(f"\n[3] Splitting into teacher (all 32 ch) and student (T7 + T8) …")
    X_teacher, X_student = split_teacher_student(X_filtered)
    print(f"    X_teacher : {X_teacher.shape}  "
          f"(channels: all {n_ch}  [{EEG_CHANNELS[0]} … {EEG_CHANNELS[-1]}])")
    print(f"    X_student : {X_student.shape}  "
          f"(channels: T7 [idx {T7_INDEX}], T8 [idx {T8_INDEX}])")

    # ── [4] Verification (first sample) ──────────────────────────
    if verify:
        print(f"\n[4] Filter verification on sample 0 …")
        for ch_idx in [T7_INDEX, T8_INDEX]:
            verify_filter_effect(
                raw_trial      = X_full[0].astype(np.float64),
                filtered_trial = X_filtered[0].astype(np.float64),
                channel_index  = ch_idx,
                fs             = fs,
            )

    # ── [5] Save ──────────────────────────────────────────────────
    print(f"\n[5] Saving  →  {output_npz}")
    np.savez(
        output_npz,
        X_teacher = X_teacher,
        X_student = X_student,
        y_emo     = y_emo,
        source    = source,
    )

    # ── Summary ───────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  OUTPUT SUMMARY")
    print("=" * 60)
    print(f"  X_teacher : {X_teacher.shape}  dtype={X_teacher.dtype}")
    print(f"  X_student : {X_student.shape}   dtype={X_student.dtype}")
    print(f"  y_emo     : {y_emo.shape}        unique={np.unique(y_emo)}")
    print(f"  source    : {source.shape}        unique={np.unique(source)}")
    print(f"\n  Saved to  : {output_npz}")
    print(f"\n  Next step → notch_filter_ica.py")
    print("=" * 60 + "\n")

    return {
        'X_teacher' : X_teacher,
        'X_student' : X_student,
        'y_emo'     : y_emo,
        'source'    : source,
    }


# ─────────────────────────────────────────────
#  SELF-TEST  (python bandpass_filtering.py)
# ─────────────────────────────────────────────

def _make_synthetic_unified_npz(tmp_path: Path, n_samples: int = 20) -> Path:
    """
    Write a minimal synthetic unified_dataset.npz for testing.
    Mirrors the structure written by apply_unified_labeling.py.
    """
    rng = np.random.default_rng(42)
    T   = 2560    # 10 s at 256 Hz

    def synthetic_eeg():
        t         = np.arange(T) / SAMPLING_RATE_HZ
        brain     = (0.5 * np.sin(2 * np.pi * 10 * t) +
                     0.3 * np.sin(2 * np.pi * 20 * t) +
                     0.2 * np.sin(2 * np.pi * 35 * t))
        drift     = 5.0 * np.sin(2 * np.pi * 0.1 * t)
        powerline = 1.5 * np.sin(2 * np.pi * 50 * t)
        hf_noise  = 0.8 * rng.standard_normal(T)
        return (brain + drift + powerline + hf_noise).astype(np.float32)

    X_full = np.stack(
        [np.stack([synthetic_eeg() for _ in range(32)], axis=0)
         for _ in range(n_samples)],
        axis=0,
    )  # (n_samples, 32, T)

    X_t7t8 = X_full[:, [T7_INDEX, T8_INDEX], :]   # unfiltered, as produced by
                                                    # apply_unified_labeling.py
    y_emo  = rng.integers(0, 2, size=n_samples)
    source = np.array(['deap'  if i % 2 == 0 else 'sam40'
                       for i in range(n_samples)])

    npz_path = tmp_path / "unified_dataset.npz"   # tmp_path is unified_output in real use
    np.savez(npz_path,
             X_full=X_full, X_t7t8=X_t7t8,
             y_emo=y_emo, source=source)

    print(f"  Synthetic unified_dataset.npz written → {npz_path}")
    print(f"    X_full  : {X_full.shape}")
    print(f"    X_t7t8  : {X_t7t8.shape}")
    print(f"    y_emo   : {y_emo.shape}  (pos={int(y_emo.sum())})")
    return npz_path


if __name__ == '__main__':
    import tempfile, argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--test', action='store_true',
                        help='Run on synthetic data instead of real data')
    args = parser.parse_args()

    real_input = UNIFIED_OUTPUT_DIR / "unified_dataset.npz"

    if args.test:
        print("=" * 60)
        print("  BANDPASS FILTERING — SELF-TEST (synthetic data)")
        print("=" * 60)
        with tempfile.TemporaryDirectory() as tmp:
            syn_dir = Path(tmp) / "unified_output"
            syn_dir.mkdir()
            print("\n[0] Generating synthetic unified_dataset.npz …")
            input_npz = _make_synthetic_unified_npz(syn_dir)
            results = run_bandpass_pipeline(input_npz=input_npz, verify=True)
            t7 = np.allclose(results['X_student'][:, 0, :], results['X_teacher'][:, T7_INDEX, :])
            t8 = np.allclose(results['X_student'][:, 1, :], results['X_teacher'][:, T8_INDEX, :])
            print(f"  Student ch-0 == Teacher T7  : {'OK  ✓' if t7 else 'FAIL ✗'}")
            print(f"  Student ch-1 == Teacher T8  : {'OK  ✓' if t8 else 'FAIL ✗'}")
            print("\n  Self-test complete.\n")

    elif real_input.exists():
        print("=" * 60)
        print("  BANDPASS FILTERING — REAL DATA")
        print("=" * 60)
        run_bandpass_pipeline(input_npz=real_input, verify=True)

    else:
        print(f"\n  ERROR: input not found:\n    {real_input}")
        print("  Run apply_unified_labeling.py first, or use --test for synthetic data.\n")
        sys.exit(1)