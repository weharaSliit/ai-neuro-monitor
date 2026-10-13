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

# Must match the firmware's CH2SET register (iot_firmware/wearable02/
# wearable02.ino): 0x50 -> GAIN2[2:0] (bits 6:4) = 101 = gain 8 on the
# ADS1292R (000=6, 001=1, 010=2, 011=3, 100=4, 101=8, 110=12). This was 6,
# which overstated every live amplitude by 8/6 (band powers by 1.78x).
BIPOLAR_GAIN = 8
BIPOLAR_VREF_VOLTS = 2.42
# ADS1292R LSB = VREF / (gain * (2^23 - 1)) -- the datasheet's "LSB weight
# VREF / (2^23 - 1)" at gain 1, divided by the PGA gain; the input range is
# +-VREF/gain, i.e. 2*VREF/gain spread over 2^24 codes, which is the same
# number. Same formula code_to_microvolts() above already uses. This was
# (2 * VREF / gain) / (2^23 - 1) ~= 0.0962, counting the two-sided range
# twice: every live bipolar amplitude came out 2x too large (band powers 4x)
# relative to the SAM40 microvolts the model was trained on.
BIPOLAR_UV_PER_COUNT = BIPOLAR_VREF_VOLTS / (BIPOLAR_GAIN * ADC_FULL_SCALE) * 1e6  # == 0.0360608...


def bipolar_code_to_microvolts(code: np.ndarray | int) -> np.ndarray:
    return np.asarray(code, dtype=np.float64) * BIPOLAR_UV_PER_COUNT


def microvolts_to_bipolar_code(uv: np.ndarray | float) -> np.ndarray:
    """Proper inverse of bipolar_code_to_microvolts() -- NOT the same as
    microvolts_to_code() above, which inverts code_to_microvolts() instead
    (GAIN=12/VREF_VOLTS, the 2-channel path's constants). The bipolar path
    uses its own BIPOLAR_GAIN=8 (BIPOLAR_UV_PER_COUNT ~= 0.0360608, 1.5x
    code_to_microvolts()'s per-count scale) -- round-tripping a real bipolar
    uV value through microvolts_to_code() -> bipolar_code_to_microvolts()
    silently produces a ~2x-inflated value instead of recovering the original, which is
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

# Share of samples allowed beyond MAX_RAW_UV before the whole block counts
# as a hardware fault. Was effectively 0 (np.max -> one sample rejected the
# block): real wearable02 streams carry occasional single-sample glitches
# (e.g. a recurring 0x67BFF3 = ~245 mV code) inside otherwise normal blocks,
# and those threw away 25 s of good data each. The faults this check exists
# for -- railed or floating inputs at 350,000-655,000 uV, or pinned at full
# scale -- put most of the block out of range, so 1% still catches them;
# sparse glitches are interpolated over (pipeline.py) and then go through
# the normal spike removal and quality gate.
MAX_RAW_OUT_FRACTION = 0.01


def raw_out_of_range_mask(uv: np.ndarray) -> np.ndarray:
    return np.abs(np.asarray(uv, dtype=np.float64)) > MAX_RAW_UV


def raw_magnitude_ok(uv: np.ndarray) -> bool:
    """True unless more than MAX_RAW_OUT_FRACTION of this block's raw
    (pre-filter) samples exceed MAX_RAW_UV -- an unambiguous hardware fault.
    A few isolated glitch samples pass (see MAX_RAW_OUT_FRACTION)."""
    arr = np.asarray(uv, dtype=np.float64)
    return bool(arr.size > 0 and np.mean(raw_out_of_range_mask(arr)) <= MAX_RAW_OUT_FRACTION)
