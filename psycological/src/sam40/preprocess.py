"""Filtering, re-referencing and epoching for SAM40 trial arrays."""

import numpy as np
from scipy.signal import butter, iirnotch, sosfiltfilt

from .channels import SFREQ


def bandpass(data: np.ndarray, low: float = 0.5, high: float = 45.0,
             fs: int = SFREQ, order: int = 4) -> np.ndarray:
    """Zero-phase Butterworth band-pass, applied per channel. data: (n_channels, n_samples)."""
    nyq = fs / 2
    sos = butter(order, [low / nyq, high / nyq], btype='band', output='sos')
    return sosfiltfilt(sos, data, axis=-1)


def notch_filter(data: np.ndarray, freq: float = 50.0, fs: int = SFREQ, q: float = 30.0) -> np.ndarray:
    """Remove powerline interference at `freq` Hz (50 or 60).

    NOTE: with this project's 0.5-45 Hz bandpass, 50/60 Hz is already
    outside the passband -- the notch is a no-op on data that's already
    been through bandpass(). Included for pipeline completeness/fidelity
    (real acquisition hardware notches BEFORE bandpass filtering, and a
    wider-band future acquisition chain would need it); apply it first if
    used, per notch_then_bandpass() below.
    """
    if freq >= fs / 2:
        return data  # can't notch above Nyquist
    b, a = iirnotch(freq, q, fs)
    from scipy.signal import filtfilt
    return filtfilt(b, a, data, axis=-1)


def notch_then_bandpass(data: np.ndarray, notch_freq: float = 50.0, low: float = 0.5, high: float = 45.0,
                         fs: int = SFREQ, order: int = 4) -> np.ndarray:
    """Realistic acquisition order: notch powerline noise first, then bandpass."""
    return bandpass(notch_filter(data, freq=notch_freq, fs=fs), low=low, high=high, fs=fs, order=order)


def common_average_reference(data: np.ndarray) -> np.ndarray:
    """Subtract the across-channel mean at each sample. data: (n_channels, n_samples).

    Must be applied to the FULL 32-channel array before selecting T7/T8 --
    referencing against only two channels would be meaningless.
    """
    return data - data.mean(axis=0, keepdims=True)


def preprocess_trial(data: np.ndarray, low: float = 0.5, high: float = 45.0) -> np.ndarray:
    """Full-montage preprocessing: band-pass then common-average reference."""
    filtered = bandpass(data, low=low, high=high)
    return common_average_reference(filtered)


def epoch(data: np.ndarray, window_sec: float, overlap: float = 0.5,
          fs: int = SFREQ) -> np.ndarray:
    """Slice (n_channels, n_samples) into overlapping windows.

    Returns an array of shape (n_windows, n_channels, window_samples).
    overlap is the fraction of window_sec that consecutive windows share.
    """
    window_samples = int(round(window_sec * fs))
    step = max(1, int(round(window_samples * (1 - overlap))))
    n_samples = data.shape[-1]

    starts = list(range(0, n_samples - window_samples + 1, step))
    return np.stack([data[:, s:s + window_samples] for s in starts], axis=0)
