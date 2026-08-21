"""Resample the ESP32's 250 SPS stream down to 128 Hz -- the sampling rate
every offline model in this project was trained on. Feeding 250Hz-computed
features into a model trained on 128Hz features would silently corrupt
sampling-rate-dependent features (Hjorth parameters, sample entropy, RMS);
band-power-in-a-Hz-range is closer to fs-invariant but not exactly, since
Welch's frequency resolution also depends on fs. Resampling first, so every
downstream computation matches training exactly, is the only fully-safe fix.
"""

import numpy as np
from scipy.signal import resample_poly

SOURCE_FS = 250
TARGET_FS = 128


def resample_to_target(data: np.ndarray, source_fs: int = SOURCE_FS, target_fs: int = TARGET_FS) -> np.ndarray:
    """data: (..., n_samples) along the last axis. Uses an exact rational
    up/down ratio (128/250 = 64/125) via polyphase filtering -- anti-aliased,
    unlike naive decimation or linear-interpolation resampling.
    """
    from math import gcd
    g = gcd(source_fs, target_fs)
    up, down = target_fs // g, source_fs // g
    return resample_poly(data, up, down, axis=-1)
