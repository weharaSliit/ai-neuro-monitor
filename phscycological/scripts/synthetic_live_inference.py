#!/usr/bin/env python3
"""
Runs the REAL live-inference engine (RealtimeInference: calibration ->
quality gate -> model scoring, exactly what scripts/realtime_inference.py
drives against MQTT) against a synthetic sample stream instead of live
hardware -- for testing pipeline/model logic in isolation from hardware
noise, with zero ESP32/MQTT/broker dependency.

Deliberately does NOT reimplement gating/windowing/inference as a mock:
it imports and drives the SAME RealtimeInference class, the SAME
preprocess_block chain, and the SAME BLOCK_SAMPLES_RAW (25s @ 250Hz)
block size the live pipeline uses. A smaller/different window (e.g. a
1s/250-sample mock loop) would exercise a different, invalid
architecture -- the deployed model was trained on 25s blocks; see
scripts/realtime_inference.py's module docstring.

Sources blocks from scripts/generate_synthetic_eeg.py's condition
generators (clean, ch2_railed, ch2_noisy, ch2_reconstructed, ...) --
reusing the same generators already validated against this model, not a
fresh ad-hoc waveform.

Usage:
    # Calibrate on clean synthetic blocks, then run inference blocks
    # under a (possibly different) condition:
    python3 scripts/synthetic_live_inference.py --calib-condition clean --calib-blocks 3 \\
        --infer-condition ch2_reconstructed --infer-blocks 5

    # Inject one corrupted sample into one inference block, to verify
    # the REAL quality gate rejects only that block and recovers
    # immediately on the next one:
    python3 scripts/synthetic_live_inference.py --infer-condition clean --infer-blocks 5 \\
        --inject-artifact-at-block 2

    # Also push each inference block's fusion record (prediction_probability,
    # model_accuracy, signal_quality, model_confidence, ...) to Firebase --
    # same schema/fields realtime_inference.py writes from live hardware, so
    # you can verify the fusion table end-to-end without working hardware.
    # Uses a synthetic-only session_id by default so this never lands in the
    # same session as a real run unless you override it:
    python3 scripts/synthetic_live_inference.py --infer-condition clean --infer-blocks 5 \\
        --firebase-cred ~/.secrets/stress-monitor-firebase.json \\
        --firebase-db-url https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/ \\
        --firebase-session-id hituni_synthetic_test
"""

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_synthetic_eeg import GENERATORS  # noqa: E402
from realtime.adc import microvolts_to_code  # noqa: E402
from realtime.firebase_sync import FirebaseSync, make_eeg_output_record  # noqa: E402
from realtime.mqtt_client import RawSample  # noqa: E402
from realtime.pipeline import BLOCK_SAMPLES_RAW, BLOCK_SEC, RealtimeInference  # noqa: E402
from realtime.resample import SOURCE_FS  # noqa: E402


def make_block(condition: str, rng: np.random.Generator, start_millis: int) -> list[RawSample]:
    """One BLOCK_SAMPLES_RAW-length block from a generate_synthetic_eeg.py generator,
    converted to the same RawSample shape MQTT delivery would produce."""
    ch1_uv, ch2_uv = GENERATORS[condition](BLOCK_SAMPLES_RAW, SOURCE_FS, rng)
    ch1_codes = microvolts_to_code(ch1_uv)
    ch2_codes = microvolts_to_code(ch2_uv)
    millis = start_millis + (np.arange(BLOCK_SAMPLES_RAW) * (1000.0 / SOURCE_FS)).astype(np.int64)
    return [RawSample(millis=int(m), ch1_code=int(c1), ch2_code=int(c2))
            for m, c1, c2 in zip(millis, ch1_codes, ch2_codes)]


def inject_amplitude_artifact(block: list[RawSample], factor: float = 100.0, at_index: int = 500) -> list[RawSample]:
    """Multiplies one sample's ch1_code by `factor` -- tests that the REAL
    quality gate (not a reimplemented one) rejects only the block
    containing the corrupted sample and recovers on the next block."""
    out = list(block)
    s = out[at_index]
    out[at_index] = RawSample(millis=s.millis, ch1_code=int(s.ch1_code * factor), ch2_code=s.ch2_code)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', default=str(ROOT / 'results' / 'models_25s_block_bipolar_only'))
    parser.add_argument('--calib-condition', default='clean', choices=list(GENERATORS))
    parser.add_argument('--calib-blocks', type=int, default=3)
    parser.add_argument('--calibration-min-rating', default='GOOD', choices=['GOOD', 'QUESTIONABLE'])
    parser.add_argument('--infer-condition', default='clean', choices=list(GENERATORS))
    parser.add_argument('--infer-blocks', type=int, default=5)
    parser.add_argument('--inject-artifact-at-block', type=int, default=None,
                         help='0-indexed inference block to corrupt one sample in (ch1_code x100 at '
                              'sample 500), to verify the gate rejects only that block and recovers '
                              'immediately after -- see raw_cleaning.py/quality_gate.py for what SHOULD '
                              'happen: not silently passed, not a cascading rejection of later blocks.')
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--firebase-cred', default=os.environ.get('FIREBASE_CREDENTIALS'),
                         help='Path to a Firebase service-account JSON, OUTSIDE this repo. Defaults to '
                              '$FIREBASE_CREDENTIALS. Omit to skip Firebase entirely (default).')
    parser.add_argument('--firebase-db-url', default=os.environ.get('FIREBASE_DB_URL'),
                         help='Firebase Realtime Database URL. Defaults to $FIREBASE_DB_URL.')
    parser.add_argument('--firebase-session-id', default='synthetic_' + time.strftime('%Y%m%dT%H%M%S'),
                         help='Session key under --firebase-path. Defaults to a synthetic_-prefixed '
                              'timestamp specifically so a synthetic test run is never mistaken for a '
                              'real hardware session in the fusion table -- override deliberately if you '
                              'want it under a specific name.')
    parser.add_argument('--firebase-path', default='phsycological',
                         help='RTDB root path, as {path}/{session_id}/{window}. Default: phsycological.')
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    engine = RealtimeInference(Path(args.model_dir), calibration_min_rating=args.calibration_min_rating)
    millis = 0

    firebase = None
    if args.firebase_cred and args.firebase_db_url:
        firebase = FirebaseSync(args.firebase_cred, args.firebase_db_url,
                                 session_id=args.firebase_session_id, root_path=args.firebase_path)
    elif args.firebase_cred or args.firebase_db_url:
        raise SystemExit('Both --firebase-cred and --firebase-db-url are required to enable Firebase sync '
                          '(only one was given).')
    model_version = Path(args.model_dir).name
    feature_set = 'bipolar_only_v1' if 'bipolar_only' in args.model_dir else 'car_v1'
    score_history: list[float | None] = []

    print(f'=== Calibration: {args.calib_blocks} synthetic "{args.calib_condition}" blocks ===')
    for i in range(args.calib_blocks):
        block = make_block(args.calib_condition, rng, millis)
        millis += int(BLOCK_SAMPLES_RAW * (1000.0 / SOURCE_FS))
        quality = engine.calibrate_block(block)
        status = 'used' if quality['is_trusted'] else 'REJECTED'
        print(f'  block {i}: [{quality["gate_rating"]}, score={quality["quality_score"]:.1f}] {status}')

    outcome = engine.finalize_calibration()
    if outcome['status'] == 'failed':
        print('\nCALIBRATION FAILED -- no synthetic calibration block reached '
              f'{args.calibration_min_rating}. Stopping (this itself is a useful result: it means the '
              f'"{args.calib_condition}" generator or --calibration-min-rating combination can\'t '
              f'establish a baseline, independent of any real hardware).')
        raise SystemExit(1)
    print(f'Calibration: {outcome["status"]} ({outcome.get("n_blocks", 0)} blocks used)\n')

    print(f'=== Inference: {args.infer_blocks} synthetic "{args.infer_condition}" blocks ===')
    for i in range(args.infer_blocks):
        block = make_block(args.infer_condition, rng, millis)
        millis += int(BLOCK_SAMPLES_RAW * (1000.0 / SOURCE_FS))
        if args.inject_artifact_at_block == i:
            block = inject_amplitude_artifact(block)
            print(f'  (block {i}: injected 100x amplitude artifact at sample 500)')

        t0 = time.perf_counter()
        result = engine.infer_block(block)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        if result.get('skipped'):
            print(f'  block {i}: SKIPPED (low quality) gate={result.get("quality_gate_rating")} '
                  f'score={result.get("quality_quality_score")} '
                  f'amp_ok=({result.get("quality_amplitude_ok")},{result.get("quality_amplitude_ok_ch2")})  '
                  f'[{elapsed_ms:.1f}ms]')
            score_history.append(None)
        else:
            print(f'  block {i}: PASSED  calibrated_p={result["calibrated_p"]:.4f}  '
                  f'quality={result.get("quality_gate_rating")}  [{elapsed_ms:.1f}ms]')
            score_history.append(result.get('calibrated_p'))

        if firebase is not None:
            record = make_eeg_output_record(result, window_sec=BLOCK_SEC, model_version=model_version,
                                             feature_set=feature_set, history_scores=score_history)
            record['synthetic'] = True  # never conflate with a real-hardware fusion record
            record['synthetic_condition'] = args.infer_condition
            firebase.push(record)

    if firebase is not None:
        print(f'\n[firebase] pushed {args.infer_blocks} synthetic records to '
              f'{args.firebase_path}/{args.firebase_session_id}/')

    print(f'\nSYNTHETIC LIVE INFERENCE TEST COMPLETE (per-block budget: {(BLOCK_SAMPLES_RAW / SOURCE_FS):.0f}s -- '
          f'compare against the [Xms] figures above, not a per-sample 4ms figure: this pipeline scores '
          f'once per 25s block, not once per sample).')


if __name__ == '__main__':
    main()
