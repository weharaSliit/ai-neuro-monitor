#!/usr/bin/env python3
"""
Offline signal-quality check on captured T7/T8 CSV recordings (e.g. output
from scripts/mqtt_capture.py or --log-raw-csv), using the SAME
TrustedIoTEEGValidator gate AND the same preprocess_block() preprocessing
chain (spike-filter, uniform-grid interpolation, resample, notch+bandpass)
that scripts/realtime_inference.py runs live before scoring each block --
not a separate approximation of it (see quality_gate.py's module docstring
for why that distinction matters; this script used to have its own
simplified internal filtering, which has been removed in favor of reusing
preprocess_block directly, for full consistency).

Requires a `millis` column (present in mqtt_capture.py/--log-raw-csv
output) for the uniform-grid interpolation step to be meaningful; falls
back to assuming even spacing if absent (logged when that happens).

Useful for inspecting a recording session after the fact -- e.g. to see
which portions would have been rejected, or to sanity-check electrode
placement before a live session.

Usage:
    python3 scripts/check_signal_quality.py --folder captures/ --epoch-sec 25.0 --trim-min 1.5
"""

import argparse
import glob
import os
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from realtime.pipeline import preprocess_block  # noqa: E402
from realtime.mqtt_client import RawSample  # noqa: E402
from realtime.quality_gate import TrustedIoTEEGValidator  # noqa: E402
from realtime.resample import SOURCE_FS  # noqa: E402

COLUMN_ALIASES = {
    'ch1': ['ch1_code', 'ch1t7', 'ch1', 't7', 'eeg1'],
    'ch2': ['ch2_code', 'ch2t8', 'ch2', 't8', 'eeg2'],
}


def _find_columns(df: pd.DataFrame) -> tuple[str, str] | None:
    col_map = {re.sub(r'[^a-z0-9]', '', str(col).lower()): col for col in df.columns}
    c1 = next((col_map[k] for k in COLUMN_ALIASES['ch1'] if k in col_map), None)
    c2 = next((col_map[k] for k in COLUMN_ALIASES['ch2'] if k in col_map), None)
    if c1 and c2:
        return c1, c2
    numeric_cols = [c for c in df.select_dtypes(include=[np.number]).columns
                     if not any(ign in c.lower() for ign in ['time', 'timestamp', 'index', 'id', 'unnamed', 'millis'])]
    if len(numeric_cols) >= 2:
        return numeric_cols[0], numeric_cols[1]
    return None


def _epoch_to_samples(millis_slice: np.ndarray, c1_slice: np.ndarray, c2_slice: np.ndarray) -> list[RawSample]:
    return [RawSample(millis=int(m), ch1_code=int(a), ch2_code=int(b))
            for m, a, b in zip(millis_slice, c1_slice, c2_slice)]


def run(folder: str, epoch_sec: float, fs: int, trim_min: float, max_amplitude: float, max_epochs: int) -> None:
    csv_files = glob.glob(os.path.join(folder, '*.csv'))
    if not csv_files:
        print(f'No CSV files found in {folder}')
        return

    validator = TrustedIoTEEGValidator(fs_raw=fs, max_amplitude=max_amplitude)
    epoch_len = int(epoch_sec * fs)
    trim_samples = int(trim_min * 60 * fs)

    print(f'Checking {len(csv_files)} file(s) in {folder}')
    print(f'Trimming first {trim_min} min ({trim_samples} samples); epoch = {epoch_sec}s ({epoch_len} samples)\n')

    for file_path in csv_files:
        file_name = os.path.basename(file_path)
        try:
            df = pd.read_csv(file_path)
            cols = _find_columns(df)
            if cols is None:
                print(f'Skipping {file_name}: could not locate two numeric EEG columns.')
                continue
            c1, c2 = cols

            has_millis = 'millis' in df.columns
            if not has_millis:
                print(f'  NOTE: {file_name} has no `millis` column -- assuming even {fs}Hz spacing '
                      f'(uniform-grid interpolation skipped; timing jitter in the raw capture will not be corrected).')
                df = df.assign(millis=(np.arange(len(df)) * (1000.0 / fs)))

            raw_c1_full = df[c1].dropna().values.astype(float)
            raw_c2_full = df[c2].dropna().values.astype(float)
            millis_full = df['millis'].dropna().values.astype(float)
            total_samples = min(len(raw_c1_full), len(raw_c2_full), len(millis_full))

            if total_samples <= trim_samples:
                print(f'Skipping {file_name}: {total_samples} samples <= trim length {trim_samples}.')
                continue

            raw_c1 = raw_c1_full[trim_samples:total_samples]
            raw_c2 = raw_c2_full[trim_samples:total_samples]
            millis = millis_full[trim_samples:total_samples]
            num_epochs = min(max_epochs, len(raw_c1) // epoch_len)

            print(f'=== {file_name}: {total_samples} total, {len(raw_c1)} after trim, using cols ({c1}, {c2}) ===')
            baseline_samples = _epoch_to_samples(millis[:epoch_len], raw_c1[:epoch_len], raw_c2[:epoch_len])
            baseline_filtered = preprocess_block(baseline_samples, duration_sec=epoch_sec)  # Itakura reference, both channels

            trusted_count = 0
            for i in range(num_epochs):
                start, end = i * epoch_len, (i + 1) * epoch_len
                samples = _epoch_to_samples(millis[start:end], raw_c1[start:end], raw_c2[start:end])
                filtered = preprocess_block(samples, duration_sec=epoch_sec)  # SAME chain the live pipeline uses
                res = validator.validate_epoch(raw_c1[start:end], raw_c2[start:end],
                                                filtered[0], filtered[1], baseline_filtered[0], baseline_filtered[1])
                trusted_count += int(res['is_trusted'])
                print(f'  epoch {i + 1}: {res}')
            print(f'  -> {trusted_count}/{num_epochs} epochs trusted\n')

        except Exception as e:
            print(f'Error processing {file_name}: {e}\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--folder', default='.', help='Directory containing capture CSVs')
    parser.add_argument('--epoch-sec', type=float, default=25.0,
                         help='Default 25.0 to match the live pipeline\'s block size (BLOCK_SEC) -- '
                              'shorter epochs are supported but won\'t reflect live behavior exactly.')
    parser.add_argument('--fs', type=int, default=SOURCE_FS)
    parser.add_argument('--trim-min', type=float, default=1.5, help='Skip this much from the start of each file (settling time)')
    parser.add_argument('--max-amplitude', type=float, default=7000.0, help='Max filtered peak-to-peak uV before amplitude check fails')
    parser.add_argument('--max-epochs', type=int, default=5, help='Max epochs to check per file')
    args = parser.parse_args()
    run(args.folder, args.epoch_sec, args.fs, args.trim_min, args.max_amplitude, args.max_epochs)


if __name__ == '__main__':
    main()
