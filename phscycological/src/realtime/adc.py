"""Raw ADS1292R ADC code -> microvolts conversion.

Decoded from the Arduino firmware's register writes (best-effort -- NOT
independently verified against a live device, see warning below):

    CH1SET = CH2SET = 0x60 = 0b0110_0000
        bit7 PD=0        -> channel powered on
        bits6:4 GAIN=110 -> Gain code 6 -> PGA gain = 12 (ADS1292R GAIN
                             table: 000=6, 001=1, 010=2, 011=3, 100=4,
                             101=8, 110=12)
        bits3:0 MUX=0000 -> normal electrode input

    CONFIG2 was 0xA0 = 0b1010_0000 (bit6 PDB_REFBUF=0, bit5 VREF_4V=1, bit4 RLD_REF_INT=0)
        -> ambiguous: VREF_4V=1 nominally selects the 4V reference, but
           PDB_REFBUF=0 (reference buffer disabled) made it unclear whether
           that reference was actually being driven -- a short-input bench
           test on real hardware showed a large (~-4200 to -6100uV), non-zero
           DC offset on both channels under a dead short, consistent with an
           undriven/floating reference.

    CONFIG2 is now 0xE0 = 0b1110_0000 (bit6 PDB_REFBUF=1, bit5 VREF_4V=1,
    bit4 RLD_REF_INT=0) -- reference buffer enabled, changed in firmware/
    eeg_t7t8/eeg_t7t8.ino's initADS() specifically to address that offset.

    OPEN QUESTION, NOT YET RESOLVED: with the buffer now actually driving
    VREF_4V=1, the true reference is likely 4.0V, not the 2.42V (ADS1292R's
    internal default) assumed below for the old 0xA0 config -- that would
    change every decoded uV value (and every uV-scale threshold downstream:
    max_amplitude=7000, etc.) by a factor of ~1.65x. DO NOT hardcode 4.0
    here without re-running scripts/adc_bench_verify.py's short + sine
    tests against the 0xE0 firmware first -- this project has repeatedly
    found datasheet-nominal assumptions wrong for this specific board (see
    the GAIN/PGA mixup documented in scripts/adc_bench_verify.py's own
    history); re-verify empirically, don't guess from the register name.

DO NOT TRUST ABSOLUTE AMPLITUDE-DEPENDENT FEATURES (raw/log band power,
Hjorth activity, RMS, ptp) from this conversion until GAIN/VREF are
verified against the real device -- e.g. shorting the electrodes should
read ~0 uV, and a known injected test signal should read its true
amplitude. Relative/ratio features (band ratios, PLV/PLI, spectral
entropy, spectral slope) are far less sensitive to a wrong overall scale
factor and are safer to trust before that verification is done.
"""

import numpy as np

ADC_BITS = 24
ADC_FULL_SCALE = 2 ** (ADC_BITS - 1) - 1  # signed 24-bit max code (matches the hardware verification protocol's formula)

GAIN = 12          # decoded from CH1SET/CH2SET=0x60, see module docstring
VREF_VOLTS = 2.42  # ASSUMED, for the OLD CONFIG2=0xA0 -- re-verify against 0xE0 hardware, see docstring above


def code_to_microvolts(code: np.ndarray | int, gain: float = GAIN, vref: float = VREF_VOLTS) -> np.ndarray:
    """ADS1292R transfer function: V_uV = (code * VREF / (Gain * (2^23 - 1))) * 1e6."""
    volts = np.asarray(code, dtype=np.float64) * vref / (gain * ADC_FULL_SCALE)
    return volts * 1e6  # -> microvolts, matching SAM40's feature-extraction scale


def microvolts_to_code(uv: np.ndarray | float, gain: float = GAIN, vref: float = VREF_VOLTS) -> np.ndarray:
    """Inverse of code_to_microvolts -- for synthesizing/reconstructing raw ADC codes
    from a uV-domain signal (scripts/generate_synthetic_eeg.py, realtime_inference.py's
    --reconstruct-ch2-from-ch1)."""
    volts = np.asarray(uv, dtype=np.float64) / 1e6
    code = volts * (gain * ADC_FULL_SCALE) / vref
    return np.round(code).astype(np.int64)
