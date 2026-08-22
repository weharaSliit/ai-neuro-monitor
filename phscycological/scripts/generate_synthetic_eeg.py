#!/usr/bin/env python3
"""
Synthetic raw-ADC-code EEG generator, for developing/testing the quality
gate and pipeline without depending on live (currently unreliable)
hardware. Every condition below is modeled on a fault this project's own
device actually produced today -- not a hypothetical/generic artifact
list -- so testing against these is testing against real failure modes.

Output matches mqtt_capture.py/--log-raw-csv's CSV format exactly
(millis,ch1_code,ch2_code,ch1_uv,ch2_uv), so it drops straight into
scripts/check_signal_quality.py --folder, or can be loaded as RawSample
rows for a direct RealtimeInference/pipeline.preprocess_block test.

Conditions:
  clean                -- band-limited EEG-like signal + Gaussian noise on
                           both channels. Should pass the quality gate
                           end-to-end (gate=GOOD, is_trusted=True).
  ch2_railed           -- CH2 stuck near ADC positive full-scale ~99.97%
                           of samples (the T8 disconnected-electrode fault
                           found earlier this session).
  ch2_noisy            -- CH2 carries a large DC offset (~-6000uV) plus
                           heavy broadband + 50Hz-ish noise riding on top
                           (the CONFIG2/diode-damage fault found during
                           today's short-input bench testing: mean~-6000
                           to -7000uV, std~1300-1600uV under a dead short).
  dc_offset_asymmetric -- both channels offset from 0 by different FIXED
                           amounts, otherwise low noise -- isolates a pure
                           reference/offset problem from the noise problem
                           (a highpass filter should erase this cleanly).
  motion_artifact      -- otherwise-clean block with one ~2s high-
                           amplitude burst -- tests whole-block rejection
                           at the amplitude gate.
  sparse_glitches      -- otherwise-clean block with a handful of isolated
                           single-sample extreme values -- tests that
                           remove_spikes() catches and interpolates these
                           (contrast with ch2_noisy, which it correctly
                           does NOT fix -- see raw_cleaning.py docstring).
  flatline             -- one channel dead (std~0) -- tests the Step-0
                           gate's flatline_score check.

Usage:
    python3 scripts/generate_synthetic_eeg.py --condition clean --out synth_clean.csv
    python3 scripts/generate_synthetic_eeg.py --condition all --out-dir synth/
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from realtime.adc import ADC_FULL_SCALE, GAIN, VREF_VOLTS, microvolts_to_code as uv_to_code  # noqa: E402
from realtime.pipeline import BLOCK_SEC  # noqa: E402
from realtime.resample import SOURCE_FS  # noqa: E402

CONDITIONS = ['clean', 'ch2_railed', 'ch2_noisy', 'dc_offset_asymmetric',
              'motion_artifact', 'sparse_glitches', 'flatline',
              'mirror_software', 'mirror_hardware_realistic', 'ch2_reconstructed']


def clean_eeg_uv(n: int, fs: float, rng: np.random.Generator, amp_uv: float = 15.0) -> np.ndarray:
    """Band-limited EEG-like signal: a few oscillatory components (theta/
    alpha/beta) plus Gaussian noise, scaled to a realistic ~10-50uV range.
    Noise dominates enough that kurtosis stays near-Gaussian (~3), well
    under the gate's kurt<12 threshold."""
    t = np.arange(n) / fs
    sig = np.zeros(n)
    for freq, weight in [(5.5, 0.5), (10.0, 1.0), (20.0, 0.3)]:
        phase = rng.uniform(0, 2 * np.pi)
        sig += weight * np.sin(2 * np.pi * freq * t + phase)
    sig_std = np.std(sig)
    if sig_std > 0:  # n too small (e.g. n=1) for a defined std -- leave sig as-is rather than divide by zero
        sig *= amp_uv / sig_std
    noise = rng.normal(0, amp_uv * 0.8, size=n)
    return sig + noise


def gen_clean(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    return clean_eeg_uv(n, fs, rng), clean_eeg_uv(n, fs, rng)


def gen_ch2_railed(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    ch1 = clean_eeg_uv(n, fs, rng)
    rail_code = ADC_FULL_SCALE  # matches the observed T8 fault: stuck at +full-scale
    ch2_code = np.full(n, rail_code, dtype=np.int64)
    n_real = max(1, int(n * 0.0003))  # ~0.03% genuinely-connected samples, matching the 99.97% rail rate found
    real_idx = rng.choice(n, size=n_real, replace=False)
    ch2 = ch2_code.astype(np.float64) * VREF_VOLTS / (GAIN * ADC_FULL_SCALE) * 1e6
    ch2[real_idx] = clean_eeg_uv(n_real, fs, rng)[: len(real_idx)]
    return ch1, ch2  # ch2 returned in uV; caller re-derives codes uniformly


def gen_ch2_noisy(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    """Reproduces the measured short-input fault: large DC offset, 50Hz-ish
    ripple, AND heavy-tailed (high-kurtosis) broadband noise -- real
    hardware showed kurtosis 22-83, not just large variance. Gaussian
    noise alone has near-zero excess kurtosis no matter how large its std,
    so this uses a contaminated-Gaussian mixture (mostly small excursions,
    a minority of much larger ones) to get genuinely heavy tails."""
    ch1 = clean_eeg_uv(n, fs, rng)
    t = np.arange(n) / fs
    offset = -6500.0  # matches measured short-input mean (~-6100 to -7100uV) post-CONFIG2=0xE0
    is_large = rng.random(n) < 0.04  # ~4% of samples are large excursions -> heavy tails
    broadband = np.where(is_large, rng.normal(0, 6000.0, size=n), rng.normal(0, 150.0, size=n))
    mains = 300.0 * np.sin(2 * np.pi * 50.0 * t + rng.uniform(0, 2 * np.pi))  # the ~50Hz ripple found in short_test_live.csv
    ch2 = offset + broadband + mains
    return ch1, ch2


def gen_dc_offset_asymmetric(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    ch1 = clean_eeg_uv(n, fs, rng, amp_uv=10.0) - 2000.0
    ch2 = clean_eeg_uv(n, fs, rng, amp_uv=10.0) + 2000.0
    return ch1, ch2


def gen_motion_artifact(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    ch1 = clean_eeg_uv(n, fs, rng)
    ch2 = clean_eeg_uv(n, fs, rng)
    burst_len = int(2.0 * fs)  # ~2s burst
    start = rng.integers(0, n - burst_len)
    burst = rng.normal(0, 3000.0, size=burst_len)  # large-amplitude, well above the 7000uV gate ceiling in ptp terms
    ch1[start:start + burst_len] += burst
    ch2[start:start + burst_len] += burst * 0.8
    return ch1, ch2


def gen_sparse_glitches(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    ch1 = clean_eeg_uv(n, fs, rng)
    ch2 = clean_eeg_uv(n, fs, rng)
    n_glitches = 4
    for ch in (ch1, ch2):
        idx = rng.choice(n, size=n_glitches, replace=False)
        ch[idx] = rng.choice([-1, 1], size=n_glitches) * rng.uniform(12000, 20000, size=n_glitches)
    return ch1, ch2


def gen_flatline(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    ch1 = clean_eeg_uv(n, fs, rng)
    ch2 = np.zeros(n)  # dead channel
    return ch1, ch2


def gen_mirror_software(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    """Tests the 'jumper IN1->IN2, then data[1]=data[0]' proposal in its
    cleanest possible form: CH2 is an EXACT copy of CH1, no noise added at
    all. Even in this best case, T7/T8 stop being physically distinct."""
    ch1 = clean_eeg_uv(n, fs, rng)
    return ch1, ch1.copy()


def gen_ch2_reconstructed(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    """CH2 hardware workaround, v2: derives CH2 from CH1 (the working
    channel) instead of an exact copy, specifically to avoid
    mirror_software's measured failure mode (bipolar T7-T8 differential
    collapsing to identically zero, freezing the deployed model's score
    at a constant 0.0000). Applies a small propagation-like sample delay,
    an amplitude scale, and independent noise, so CH1 and CH2 stay
    correlated but distinct -- plausible in shape, but still NOT a real
    T8 signal. This exists to keep the pipeline mechanically exercisable
    (non-degenerate bipolar/coherence/asymmetry features, non-frozen
    model score) while T8 hardware is unavailable, not to produce
    trustworthy live predictions. See reconstruct_ch2_from_ch1() in
    scripts/realtime_inference.py for the live-pipeline equivalent."""
    ch1 = clean_eeg_uv(n, fs, rng)
    delay = int(round(rng.uniform(2, 6)))  # a few ms, T7-T8 volume-conduction-like lag
    shifted = np.roll(ch1, delay)
    shifted[:delay] = shifted[delay] if n > delay else 0.0  # avoid a wrap-around discontinuity at block start
    amp_scale = rng.uniform(0.7, 1.1)  # T7/T8 amplitudes aren't identical
    independent_noise = rng.normal(0, 6.0, size=n)  # decorrelates CH2 from CH1 at a realistic EEG-noise scale
    ch2 = shifted * amp_scale + independent_noise
    return ch1, ch2


def gen_mirror_hardware_realistic(n: int, fs: float, rng) -> tuple[np.ndarray, np.ndarray]:
    """The more realistic version of the same proposal: physically jumper
    CH1's electrode into CH2's input, but CH2's own damage-induced offset/
    noise (measured today: mean~-6500uV, heavy-tailed broadband + 50Hz)
    doesn't disappear just because the source signal changed -- it's
    downstream of the jumper point if the fault is in CH2's own clamp
    diode/input stage, per the 1.2V power-rail-diode reading."""
    ch1 = clean_eeg_uv(n, fs, rng)
    t = np.arange(n) / fs
    is_large = rng.random(n) < 0.04
    ch2_own_noise = np.where(is_large, rng.normal(0, 6000.0, size=n), rng.normal(0, 150.0, size=n))
    mains = 300.0 * np.sin(2 * np.pi * 50.0 * t + rng.uniform(0, 2 * np.pi))
    ch2 = ch1 + (-6500.0) + ch2_own_noise + mains
    return ch1, ch2


GENERATORS = {
    'clean': gen_clean,
    'ch2_railed': gen_ch2_railed,
    'ch2_noisy': gen_ch2_noisy,
    'dc_offset_asymmetric': gen_dc_offset_asymmetric,
    'motion_artifact': gen_motion_artifact,
    'sparse_glitches': gen_sparse_glitches,
    'flatline': gen_flatline,
    'mirror_software': gen_mirror_software,
    'mirror_hardware_realistic': gen_mirror_hardware_realistic,
    'ch2_reconstructed': gen_ch2_reconstructed,
}


def write_condition(condition: str, out_path: Path, duration_sec: float, fs: float, seed: int) -> None:
    rng = np.random.default_rng(seed)
    n = int(duration_sec * fs)
    ch1_uv, ch2_uv = GENERATORS[condition](n, fs, rng)
    ch1_code = uv_to_code(ch1_uv)
    ch2_code = uv_to_code(ch2_uv)
    millis = np.round(np.arange(n) * (1000.0 / fs)).astype(np.int64)

    df = pd.DataFrame({
        'millis': millis, 'ch1_code': ch1_code, 'ch2_code': ch2_code,
        'ch1_uv': ch1_code.astype(np.float64) * VREF_VOLTS / (GAIN * ADC_FULL_SCALE) * 1e6,
        'ch2_uv': ch2_code.astype(np.float64) * VREF_VOLTS / (GAIN * ADC_FULL_SCALE) * 1e6,
    })
    df.to_csv(out_path, index=False)
    print(f'{condition}: wrote {len(df)} samples ({duration_sec:.0f}s @ {fs:.0f}Hz) -> {out_path}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--condition', choices=CONDITIONS + ['all'], default='all')
    parser.add_argument('--out', default=None, help='Output CSV path (single condition only)')
    parser.add_argument('--out-dir', default='synth', help='Output directory (used for --condition all)')
    parser.add_argument('--duration-sec', type=float, default=BLOCK_SEC,
                         help=f'Default {BLOCK_SEC}s matches the live pipeline\'s block size')
    parser.add_argument('--fs', type=float, default=SOURCE_FS)
    parser.add_argument('--seed', type=int, default=0)
    args = parser.parse_args()

    if args.condition == 'all':
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, cond in enumerate(CONDITIONS):
            write_condition(cond, out_dir / f'{cond}.csv', args.duration_sec, args.fs, seed=args.seed + i)
    else:
        out_path = Path(args.out) if args.out else Path(f'{args.condition}.csv')
        write_condition(args.condition, out_path, args.duration_sec, args.fs, seed=args.seed)


if __name__ == '__main__':
    main()
