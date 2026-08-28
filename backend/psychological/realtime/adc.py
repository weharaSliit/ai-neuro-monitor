import numpy as np

ADC_BITS = 24
ADC_FULL_SCALE = 2 ** (ADC_BITS - 1) - 1  
GAIN = 12          
VREF_VOLTS = 2.42  

def code_to_microvolts(code: np.ndarray | int, gain: float = GAIN, vref: float = VREF_VOLTS) -> np.ndarray:
    volts = np.asarray(code, dtype=np.float64) * vref / (gain * ADC_FULL_SCALE)
    return volts * 1e6  # -> microvolts, matching SAM40's feature-extraction scale

CLIP_UV = 100.0


def clip_physiological_uv(uv: np.ndarray) -> np.ndarray:
    return np.clip(uv, -CLIP_UV, CLIP_UV)


def microvolts_to_code(uv: np.ndarray | float, gain: float = GAIN, vref: float = VREF_VOLTS) -> np.ndarray:
    volts = np.asarray(uv, dtype=np.float64) / 1e6
    code = volts * (gain * ADC_FULL_SCALE) / vref
    return np.round(code).astype(np.int64)

BIPOLAR_GAIN = 6
BIPOLAR_VREF_VOLTS = 2.42
BIPOLAR_UV_PER_COUNT = (2.0 * BIPOLAR_VREF_VOLTS / BIPOLAR_GAIN) / ADC_FULL_SCALE * 1e6  # == 0.0961538...


def bipolar_code_to_microvolts(code: np.ndarray | int) -> np.ndarray:
    return np.asarray(code, dtype=np.float64) * BIPOLAR_UV_PER_COUNT


def microvolts_to_bipolar_code(uv: np.ndarray | float) -> np.ndarray:
    """Proper inverse of bipolar_code_to_microvolts() -- NOT the same as
    microvolts_to_code() above, which inverts code_to_microvolts() instead
    (GAIN=12/VREF_VOLTS, the 2-channel path's constants). The bipolar path
    uses its own BIPOLAR_GAIN=6 and a 2x differential-signal factor
    (BIPOLAR_UV_PER_COUNT ~= 0.0961538, ~4x code_to_microvolts()'s
    per-count scale) -- round-tripping a real bipolar uV value through
    microvolts_to_code() -> bipolar_code_to_microvolts() silently produces
    a ~4x-inflated value instead of recovering the original, which is
    exactly wrong for feeding real/synthetic bipolar uV data back into
    BipolarRawSample.code for testing (see test_realtime_pipeline.py and
    any script decoding a real device's already-uV-converted debug output
    back into codes)."""
    code = np.asarray(uv, dtype=np.float64) / BIPOLAR_UV_PER_COUNT
    return np.round(code).astype(np.int64)


# Coarse, cheap early-reject threshold -- checked on the RAW (unfiltered)
# bipolar signal, before any spike-removal/resample/filter work runs, so an
# unambiguous hardware fault (railed electrode, disconnected reference) is
# rejected without wasting a filter pass on it. This is NOT a substitute for
# CLIP_UV/the quality gate's amplitude checks: tested empirically against
# real captured wearable02 data, a block with max|raw_uv| well under
# MAX_RAW_UV (e.g. ~31,000uV, 3-4x under this threshold) still had 96.7% of
# its samples exceed the physiologically-motivated CLIP_UV=100uV clamp and
# produced unstable, preprocessing-recipe-dependent model predictions
# (0.4473 under one filter chain, 0.9447 under another) -- this threshold
# only catches the most extreme, unambiguous faults (multiple real blocks
# measured at 350,000-655,000uV), not "merely" 100-300x too large for real
# EEG. Always use alongside, never instead of, the tighter checks.
MAX_RAW_UV = 100_000.0


def raw_magnitude_ok(uv: np.ndarray) -> bool:
    """True if this block's raw (pre-filter) signal doesn't have an
    unambiguous, extreme hardware-fault magnitude -- see MAX_RAW_UV above."""
    arr = np.asarray(uv, dtype=np.float64)
    return bool(arr.size > 0 and np.max(np.abs(arr)) <= MAX_RAW_UV)
