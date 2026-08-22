#!/usr/bin/env python3
"""
ADC gain/VREF bench verification -- run this WITH THE PHYSICAL HARDWARE
before trusting any absolute-amplitude feature from live inference.

Two tests, matching the hardware risk protocol:
  A. Short-inputs test: tie IN+/IN- together (or use the ADS1292R's internal
     short-input MUX setting) and capture a few seconds of raw codes.
     Decoded voltage should be ~0 uV (noise floor only).
  B. Known sine-wave test: inject a calibrated signal (e.g. 10 Hz, 50 uVpp)
     from a signal generator and capture raw codes. Compares the decoded
     peak-to-peak amplitude against the known injected amplitude and
     reports a corrected GAIN if they don't match.

Usage (with real captured data, from scripts/mqtt_capture.py's CSV output):
    python3 scripts/adc_bench_verify.py short  --codes-file short_test.csv --channel 1
    python3 scripts/adc_bench_verify.py sine   --codes-file sine_test.csv --channel 1 \\
        --fs 250 --expected-freq-hz 10 --expected-amplitude-uvpp 50

Usage (self-test, no hardware -- proves this script's own logic is correct
before you rely on it against real captures):
    python3 scripts/adc_bench_verify.py selftest
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from realtime.adc import GAIN, VREF_VOLTS, code_to_microvolts, ADC_FULL_SCALE  # noqa: E402


def check_short(codes: np.ndarray, tolerance_uv: float = 5.0) -> None:
    uv = code_to_microvolts(codes)
    mean_uv, std_uv = uv.mean(), uv.std()
    print(f'Short-input test: mean={mean_uv:+.2f} uV, std={std_uv:.2f} uV (n={len(codes)})')
    if abs(mean_uv) <= tolerance_uv:
        print(f'PASS: within +/-{tolerance_uv} uV of zero.')
    else:
        print(f'FAIL: mean offset {mean_uv:+.2f} uV exceeds +/-{tolerance_uv} uV tolerance -- '
              f'check for a DC bias / electrode-offset issue before trusting amplitude features.')


def check_sine(codes: np.ndarray, fs: float, expected_freq_hz: float, expected_amplitude_uvpp: float,
                gain: float = GAIN, vref: float = VREF_VOLTS) -> float:
    uv = code_to_microvolts(codes, gain=gain, vref=vref)

    freqs = np.fft.rfftfreq(len(uv), d=1 / fs)
    spectrum = np.abs(np.fft.rfft(uv * np.hanning(len(uv))))
    peak_idx = np.argmin(np.abs(freqs - expected_freq_hz))
    search = slice(max(0, peak_idx - 2), peak_idx + 3)
    peak_freq = freqs[search][np.argmax(spectrum[search])]

    observed_amplitude_uvpp = uv.max() - uv.min()
    ratio = observed_amplitude_uvpp / expected_amplitude_uvpp

    print(f'Sine test: peak detected at {peak_freq:.2f} Hz (expected {expected_freq_hz} Hz)')
    print(f'Observed amplitude: {observed_amplitude_uvpp:.2f} uVpp (expected {expected_amplitude_uvpp} uVpp)')
    print(f'Ratio observed/expected: {ratio:.3f}')

    if 0.9 <= ratio <= 1.1:
        print(f'PASS: within 10% of expected amplitude. Current GAIN={gain} is correct.')
    else:
        corrected_gain = gain * ratio
        print(f'FAIL: amplitude off by {ratio:.2f}x. Corrected GAIN should be '
              f'{gain} * {ratio:.3f} = {corrected_gain:.2f} '
              f'(update GAIN in src/realtime/adc.py to the nearest valid ADS1292R gain code: '
              f'1, 2, 3, 4, 6, 8, or 12).')
    return ratio


def load_codes(path: str, channel: int = 1) -> np.ndarray:
    """Reads the CSV written by scripts/mqtt_capture.py (millis,ch1_code,ch2_code,ch1_uv,ch2_uv)."""
    df = pd.read_csv(path)
    col = 'ch1_code' if channel == 1 else 'ch2_code'
    return df[col].to_numpy(dtype=np.int64)


def selftest():
    """Synthesizes a known signal, converts it to codes the same way the firmware
    would produce them, then verifies this script correctly recovers the truth --
    both when the assumed GAIN is right and when it's deliberately wrong.
    """
    print('=== Self-test: short-input (codes near 0) ===')
    rng = np.random.RandomState(0)
    short_codes = rng.randint(-50, 50, size=1000)  # small noise around 0, simulating a real short
    check_short(short_codes)

    print('\n=== Self-test: sine wave, CORRECT assumed gain ===')
    fs, freq, amp_uvpp = 250.0, 10.0, 50.0
    t = np.arange(2 * fs) / fs
    true_signal_uv = (amp_uvpp / 2) * np.sin(2 * np.pi * freq * t)
    true_volts = true_signal_uv / 1e6
    codes = np.round(true_volts * (GAIN * ADC_FULL_SCALE) / VREF_VOLTS).astype(np.int64)
    ratio = check_sine(codes, fs=fs, expected_freq_hz=freq, expected_amplitude_uvpp=amp_uvpp)
    assert 0.95 < ratio < 1.05, f'selftest FAILED: expected ratio ~1.0, got {ratio}'

    print('\n=== Self-test: sine wave, WRONG assumed gain (script should catch it) ===')
    wrong_gain = 6.0  # pretend we assumed gain=6 when the true hardware gain (used to make `codes`) was 12
    ratio2 = check_sine(codes, fs=fs, expected_freq_hz=freq, expected_amplitude_uvpp=amp_uvpp, gain=wrong_gain)
    assert abs(ratio2 - 2.0) < 0.05, f'selftest FAILED: expected ~2x mismatch, got ratio={ratio2}'
    print(f'\nCorrectly detected the induced 2x gain error (script recommended '
          f'corrected_gain={wrong_gain * ratio2:.1f}, true value is {GAIN}).')

    print('\nALL SELF-TESTS PASSED -- this script'"'"'s verification logic is correct.')


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)

    p_short = sub.add_parser('short')
    p_short.add_argument('--codes-file', required=True)
    p_short.add_argument('--channel', type=int, choices=[1, 2], default=1)
    p_short.add_argument('--tolerance-uv', type=float, default=5.0)

    p_sine = sub.add_parser('sine')
    p_sine.add_argument('--codes-file', required=True)
    p_sine.add_argument('--channel', type=int, choices=[1, 2], default=1)
    p_sine.add_argument('--fs', type=float, required=True)
    p_sine.add_argument('--expected-freq-hz', type=float, required=True)
    p_sine.add_argument('--expected-amplitude-uvpp', type=float, required=True)

    sub.add_parser('selftest')

    args = parser.parse_args()
    if args.command == 'short':
        check_short(load_codes(args.codes_file, channel=args.channel), tolerance_uv=args.tolerance_uv)
    elif args.command == 'sine':
        check_sine(load_codes(args.codes_file, channel=args.channel), fs=args.fs,
                   expected_freq_hz=args.expected_freq_hz, expected_amplitude_uvpp=args.expected_amplitude_uvpp)
    elif args.command == 'selftest':
        selftest()


if __name__ == '__main__':
    main()
