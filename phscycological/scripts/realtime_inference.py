#!/usr/bin/env python3
"""
Real-time T7/T8 inference: subscribes to the ESP32/ADS1292R's MQTT stream,
buffers raw samples into 25s blocks, and prints decision values for each
block (no interventions -- stops at the decision layer, per project scope).

Requires an initial rest/calibration period (default 60s = ~2 blocks worth
at 25s/block, but the first --calibration-sec seconds are used regardless
of block boundaries) to establish this user's Relax baseline before
inference blocks are scored -- baseline-relative features are zero/
meaningless without it.

Every block passes through a signal-quality gate (src/realtime/quality_gate.py)
before scoring: 9-factor amplitude/spectral checks, T7-T8 PLI-vs-surrogate
coupling, and an Itakura spectral-distance artifact check against the
first trusted calibration block. Blocks that fail are NOT scored and are
NOT added to decision-state history (a gap in the printed `window` index
means a block was skipped, not that time stood still).

A rolling SESSION HEALTH check (src/realtime/pipeline.py: SessionQualityMonitor,
default 8-block/~200s window) also runs on every inferred block, classifying
the recent rejection rate against a literature-benchmark scale: <=20%
rejected = CLEAN, <=50% = USABLE (minor artifacts), >50% = SETUP_FAILURE
(check electrode contact/skin prep/reference/movement). This is a per-SESSION
signal, distinct from the per-block quality gate -- it exists to catch "most
blocks are bad" (a setup problem) rather than "this one block was bad"
(the normal, expected case the gate already handles).

Default model is the bipolar-only ("hardware-realistic") model
(results/models_25s_block_bipolar_only/, LOSO AUC 0.706) -- trained
exclusively on the reference-agnostic T7-T8 differential feature set, so
it does not carry the CAR-vs-2-electrode training/inference mismatch the
original CAR-trained model (results/models_25s_block/, 0.795 AUC offline)
has. Pass --model-dir explicitly to use the higher-AUC CAR-trained model,
but that one is NOT recommended against live hardware -- see
src/realtime/pipeline.py's module docstring for why.

KNOWN LIMITATIONS (see src/realtime/pipeline.py docstring for detail):
  - ADC gain/VREF are a best-effort decode of the firmware's register
    writes, not verified against the physical device.
  - "calibrated_p" here is the raw model score -- no standalone,
    reusable held-out calibrator object exists from this project's nested
    calibration runs (those calibrators are fold-specific and discarded
    after evaluation, by design, to avoid leakage).
  - The quality gate's ML sub-classifier self-calibrates from the first
    epoch it sees (see quality_gate.py docstring) -- a soft heuristic,
    not a validated classifier.

Usage:
    python3 scripts/realtime_inference.py --broker 192.168.1.2 --calibration-sec 60 \\
        --log-raw-csv session_raw.csv --log-decisions-csv session_decisions.csv

Optional: push each block's fusion-ready record (task_state_score, quality,
timestamps) to Firebase Realtime Database as it's computed:
    python3 scripts/realtime_inference.py --broker 192.168.1.2 \\
        --firebase-cred ~/.secrets/stress-monitor-firebase.json \\
        --firebase-db-url https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/

SECURITY: --firebase-cred must point OUTSIDE this repository (e.g. ~/.secrets/).
It can also be set via the FIREBASE_CREDENTIALS environment variable instead
of a CLI flag. Never place a service-account key inside the project directory
-- see src/realtime/firebase_sync.py's module docstring.
"""

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

import numpy as np

from realtime.adc import code_to_microvolts, microvolts_to_code  # noqa: E402
from realtime.csv_logger import CsvLogger, RAW_FIELDS, log_raw_block  # noqa: E402
from realtime.firebase_sync import FirebaseSync, make_eeg_output_record  # noqa: E402
from realtime.mqtt_client import RawSample, RawSampleBuffer, make_client  # noqa: E402
from realtime.pipeline import BLOCK_SAMPLES_RAW, BLOCK_SEC, RealtimeInference, preprocess_block  # noqa: E402
from realtime.resample import SOURCE_FS, TARGET_FS  # noqa: E402

DECISION_FIELDS = ['skipped', 'baseline_degraded', 'ch2_mirrored', 'ch2_reconstructed', 'calibrated_p',
                    'high_load_alert', 'micro_break_recommended', 'fatigue_warning', 'cooldown_logged',
                    'baseline_drift', 'baseline_drift_n_calm_blocks',
                    'quality_is_trusted', 'quality_gate_rating', 'quality_quality_score',
                    'quality_snr_db', 'quality_snr_db_ch2', 'quality_pli_t7_t8', 'quality_surrogate_pli',
                    'quality_itakura_distance', 'quality_itakura_distance_ch2',
                    'quality_amplitude_ok_ch2', 'quality_peak_to_peak_uV_ch2',
                    'quality_ml_rating', 'quality_reason',
                    'session_window_blocks', 'session_rejected_in_window',
                    'session_rejection_rate', 'session_band', 'session_message']


def mirror_ch1_to_ch2(block: list[RawSample]) -> list[RawSample]:
    """CH2 hardware workaround (--mirror-ch1-to-ch2): duplicates CH1 into
    CH2's slot on every sample, immediately after it's drained from the
    buffer -- so every downstream consumer (raw/preprocessed logs,
    calibration, inference) sees the same mirrored data consistently.

    KNOWN CONSEQUENCE, measured empirically (scripts/generate_synthetic_eeg.py,
    'mirror_software' condition): with CH2 an exact copy of CH1, the T7-T8
    bipolar differential is identically zero, which is the ENTIRE feature
    basis of the default bipolar-only deployment model (29/29 features) --
    verified this collapses every subsequent calibrated_p to a frozen
    0.0000 regardless of the wearer's actual state. Every output row is
    tagged ch2_mirrored=True (see DECISION_FIELDS) specifically so this
    data is never silently mixed with genuine two-channel sessions."""
    return [RawSample(millis=s.millis, ch1_code=s.ch1_code, ch2_code=s.ch1_code) for s in block]


def reconstruct_ch2_from_ch1(block: list[RawSample], rng: np.random.Generator) -> list[RawSample]:
    """CH2 hardware workaround, v2 (--reconstruct-ch2-from-ch1): derives CH2
    from CH1 (the working channel) instead of an exact copy, specifically
    to avoid mirror_ch1_to_ch2's measured failure mode (bipolar T7-T8
    differential collapsing to identically zero, freezing calibrated_p at
    a constant 0.0000). Applies a small propagation-like sample delay, an
    amplitude scale, and independent noise, so CH1 and CH2 stay correlated
    but distinct -- plausible in shape, but STILL NOT a real T8 signal.
    Keeps the pipeline mechanically exercisable (non-degenerate bipolar/
    coherence/asymmetry features, non-frozen model score), not a source of
    trustworthy T8 readings. Matches
    scripts/generate_synthetic_eeg.py's 'ch2_reconstructed' condition,
    which was used to validate this approach doesn't collapse the same way
    a direct mirror does. Every output row is tagged
    ch2_reconstructed=True (see DECISION_FIELDS)."""
    ch1_codes = np.array([s.ch1_code for s in block], dtype=np.float64)
    ch1_uv = code_to_microvolts(ch1_codes)
    n = len(ch1_uv)
    delay = int(round(rng.uniform(2, 6)))
    shifted = np.roll(ch1_uv, delay)
    shifted[:delay] = shifted[delay] if n > delay else 0.0
    amp_scale = rng.uniform(0.7, 1.1)
    independent_noise = rng.normal(0, 6.0, size=n)
    ch2_codes = microvolts_to_code(shifted * amp_scale + independent_noise)
    return [RawSample(millis=s.millis, ch1_code=s.ch1_code, ch2_code=int(c2))
            for s, c2 in zip(block, ch2_codes)]


def log_preprocessed_block(logger: CsvLogger, block_seq: int, timestamp: str, block, phase: str) -> None:
    """Logs the ACTUAL signal fed to feature extraction -- post spike-filter,
    post uniform-grid interpolation, post resample-to-128Hz, post
    notch+bandpass (preprocess_block()'s output, the "[Clean EEG]" stage) --
    as opposed to --log-raw-csv (pre-preprocessing) or --log-decisions-csv
    (post-everything, decision-level only, no signal). Run regardless of
    whether the block later passes the quality gate, so a rejected block's
    cleaned signal can still be inspected for debugging.
    """
    filtered = preprocess_block(block)  # (2, BLOCK_SEC*TARGET_FS)
    t7, t8 = filtered[0], filtered[1]
    for i in range(t7.shape[0]):
        logger.write({
            'block_seq': block_seq, 'timestamp': timestamp, 'phase': phase, 'sample_index': i,
            't7_uv': f'{t7[i]:.4f}', 't8_uv': f'{t8[i]:.4f}',
        })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--broker', default='192.168.1.2')
    parser.add_argument('--port', type=int, default=1883)
    parser.add_argument('--topic', default='eeg/t7t8/raw')
    parser.add_argument('--model-dir', default=str(ROOT / 'results' / 'models_25s_block_bipolar_only'),
                         help='Default is the hardware-realistic bipolar-only model (0.706 AUC, no CAR '
                              'mismatch). Pass results/models_25s_block for the higher-AUC (0.795) '
                              'CAR-trained model -- NOT recommended against live hardware, see '
                              'src/realtime/pipeline.py docstring.')
    parser.add_argument('--calibration-sec', type=float, default=60.0,
                         help='Initial rest period used to compute this user\'s baseline, before scoring begins')
    parser.add_argument('--calibration-min-rating', default='GOOD', choices=['GOOD', 'QUESTIONABLE'],
                         help='Minimum quality-gate rating a block must reach to be used as baseline. '
                              'Default GOOD -- backed by real hardware data (see src/realtime/pipeline.py '
                              'RealtimeInference docstring): every known-clean epoch scored GOOD, every '
                              'calibration block from a session with a real hardware fault stayed QUESTIONABLE.')
    parser.add_argument('--calibration-fallback', default='stop', choices=['stop', 'best-available'],
                         help='What to do if zero blocks reach --calibration-min-rating. "stop" (default, '
                              'safe): exit rather than proceed with no real baseline. "best-available": use '
                              'the single best-scoring non-POOR block anyway, clearly flagged via '
                              'baseline_degraded=True on every subsequent output row -- lets you exercise the '
                              'rest of the pipeline while a hardware issue is being diagnosed, but any '
                              'resulting task_state_score should NOT be treated as trustworthy.')
    parser.add_argument('--log-raw-csv', default=None,
                         help='Path to continuously log every raw sample (millis, ch1/ch2 code + uV)')
    parser.add_argument('--log-decisions-csv', default=None,
                         help='Path to continuously log every computed 25s-block decision row')
    parser.add_argument('--log-preprocessed-csv', default=None,
                         help='Path to log the cleaned/filtered T7,T8 signal (post spike-filter, '
                              'post resample-to-128Hz, post notch+bandpass -- the actual signal fed '
                              'to feature extraction), one row per sample, for every drained block '
                              'whether or not it later passes the quality gate.')
    parser.add_argument('--firebase-cred', default=os.environ.get('FIREBASE_CREDENTIALS'),
                         help='Path to a Firebase service-account JSON, OUTSIDE this repo '
                              '(e.g. ~/.secrets/...). Defaults to $FIREBASE_CREDENTIALS. '
                              'Omit to skip Firebase entirely.')
    parser.add_argument('--firebase-db-url', default=os.environ.get('FIREBASE_DB_URL'),
                         help='Firebase Realtime Database URL. Defaults to $FIREBASE_DB_URL.')
    parser.add_argument('--firebase-session-id', default=None,
                         help='Session key under --firebase-path in the RTDB. Default: timestamp.')
    parser.add_argument('--firebase-path', default='phsycological',
                         help='RTDB root path each session is written under, as {path}/{session_id}/{window}. '
                              'Default: phsycological.')
    parser.add_argument('--mirror-ch1-to-ch2', action='store_true',
                         help='CH2 HARDWARE WORKAROUND: overwrite CH2 with a copy of CH1 on every sample. '
                              'Only use this if CH2 is a known-bad channel and you specifically need a '
                              '2-channel-shaped input. Measured consequence with the default bipolar-only '
                              'model: the T7-T8 differential becomes identically zero, freezing calibrated_p '
                              'at 0.0000 for every block regardless of the wearer\'s actual state -- this is '
                              'NOT a degraded-but-usable prediction, see mirror_ch1_to_ch2()\'s docstring. '
                              'Every output row is tagged ch2_mirrored=True.')
    parser.add_argument('--reconstruct-ch2-from-ch1', action='store_true',
                         help='CH2 HARDWARE WORKAROUND, v2 (recommended over --mirror-ch1-to-ch2): derives '
                              'CH2 from CH1 with a small delay/amplitude-scale/independent-noise instead of '
                              'an exact copy, avoiding the frozen-0.0000 collapse mirroring causes -- see '
                              'reconstruct_ch2_from_ch1()\'s docstring. STILL fabricated data, not a real T8 '
                              'reading. Every output row is tagged ch2_reconstructed=True. Mutually exclusive '
                              'with --mirror-ch1-to-ch2.')
    parser.add_argument('--seed', type=int, default=0, help='RNG seed for --reconstruct-ch2-from-ch1.')
    args = parser.parse_args()

    if args.mirror_ch1_to_ch2 and args.reconstruct_ch2_from_ch1:
        raise SystemExit('--mirror-ch1-to-ch2 and --reconstruct-ch2-from-ch1 are mutually exclusive -- pick one.')

    rng = np.random.default_rng(args.seed)

    if args.mirror_ch1_to_ch2:
        print('=' * 70)
        print('!! --mirror-ch1-to-ch2 is ACTIVE: CH2 is being overwritten with a')
        print('   copy of CH1 on every sample. With the default bipolar-only model')
        print('   this freezes calibrated_p at 0.0000 for every block -- verified')
        print('   empirically, not a degraded approximation. Every output row is')
        print('   tagged ch2_mirrored=True. Do not treat scores from this session')
        print('   as real predictions.')
        print('=' * 70)
    elif args.reconstruct_ch2_from_ch1:
        print('=' * 70)
        print('!! --reconstruct-ch2-from-ch1 is ACTIVE: CH2 is being replaced with')
        print('   a delayed/scaled/noised derivative of CH1, not a real T8 reading.')
        print('   This avoids the frozen-0.0000 failure of exact mirroring, but')
        print('   scores from this session are still not trustworthy predictions')
        print('   of this wearer\'s actual state. Every output row is tagged')
        print('   ch2_reconstructed=True.')
        print('=' * 70)

    buffer = RawSampleBuffer()
    client = make_client(args.broker, args.port, args.topic, buffer)
    client.loop_start()

    engine = RealtimeInference(Path(args.model_dir), calibration_min_rating=args.calibration_min_rating)
    raw_logger = CsvLogger(args.log_raw_csv, RAW_FIELDS)
    decision_logger = CsvLogger(args.log_decisions_csv, ['timestamp', 'block_seq'] + DECISION_FIELDS)
    preprocessed_logger = CsvLogger(args.log_preprocessed_csv,
                                     ['block_seq', 'timestamp', 'phase', 'sample_index', 't7_uv', 't8_uv'])
    block_seq = 0

    firebase = None
    if args.firebase_cred and args.firebase_db_url:
        firebase = FirebaseSync(args.firebase_cred, args.firebase_db_url,
                                 session_id=args.firebase_session_id, root_path=args.firebase_path)
    elif args.firebase_cred or args.firebase_db_url:
        raise SystemExit('Both --firebase-cred and --firebase-db-url are required to enable Firebase sync '
                          '(only one was given).')
    model_version = f'{Path(args.model_dir).name}'
    score_history: list[float | None] = []

    print(f'Calibration: collecting {args.calibration_sec:.0f}s of rest data before scoring '
          f'(min rating to accept: {args.calibration_min_rating})...')
    calib_samples_needed = int(args.calibration_sec * SOURCE_FS)
    calib_collected = 0
    calib_blocks_attempted = 0
    try:
        while calib_collected < calib_samples_needed:
            time.sleep(1)
            n = buffer.peek_count()
            if n >= BLOCK_SAMPLES_RAW:
                block = buffer.drain(BLOCK_SAMPLES_RAW)
                if args.mirror_ch1_to_ch2:
                    block = mirror_ch1_to_ch2(block)
                elif args.reconstruct_ch2_from_ch1:
                    block = reconstruct_ch2_from_ch1(block, rng)
                log_raw_block(raw_logger, block)
                ts = time.strftime('%Y-%m-%d %H:%M:%S')
                log_preprocessed_block(preprocessed_logger, block_seq, ts, block, phase='calibration')
                block_seq += 1
                quality = engine.calibrate_block(block)
                calib_collected += len(block)
                calib_blocks_attempted += 1
                status = 'used' if quality['is_trusted'] else 'REJECTED (not used as baseline)'
                print(f'  calibration: {calib_collected}/{calib_samples_needed} samples  '
                      f'[{quality["gate_rating"]}, score={quality["quality_score"]:.1f}] {status}')

        outcome = engine.finalize_calibration(allow_degraded=(args.calibration_fallback == 'best-available'))
        if outcome['status'] == 'failed':
            print(f'\nCALIBRATION FAILED: {calib_blocks_attempted}/{calib_blocks_attempted} blocks rejected -- '
                  f'none reached {args.calibration_min_rating}'
                  + (', and none were even usable as a degraded fallback (all POOR).' if args.calibration_fallback == 'best-available' else '.')
                  + f' Check electrode contact/reference (see scripts/adc_bench_verify.py short and '
                  f'scripts/check_signal_quality.py) and re-run once calibration blocks reach '
                  f'{args.calibration_min_rating}, or pass --calibration-fallback best-available to proceed '
                  f'anyway with an explicitly-flagged degraded baseline (not a fix -- see its --help text). '
                  f'Stopping.')
            raise SystemExit(1)
        elif outcome['status'] == 'degraded':
            print(f'\n!! CALIBRATION DEGRADED: none of {calib_blocks_attempted} blocks reached '
                  f'{args.calibration_min_rating}. Proceeding anyway (--calibration-fallback best-available) '
                  f'with the single best-scoring block available (score={outcome["score"]:.1f}) as baseline. '
                  f'Every output row from here on is tagged baseline_degraded=True -- '
                  f'DO NOT treat task_state_score from this session as trustworthy. Starting inference...\n')
        else:
            print(f'Calibration complete: {outcome["n_blocks"]}/{calib_blocks_attempted} blocks used as '
                  f'baseline. Starting inference...\n')

        while True:
            if buffer.peek_count() >= BLOCK_SAMPLES_RAW:
                block = buffer.drain(BLOCK_SAMPLES_RAW)
                if args.mirror_ch1_to_ch2:
                    block = mirror_ch1_to_ch2(block)
                elif args.reconstruct_ch2_from_ch1:
                    block = reconstruct_ch2_from_ch1(block, rng)
                log_raw_block(raw_logger, block)
                ts = time.strftime('%Y-%m-%d %H:%M:%S')
                log_preprocessed_block(preprocessed_logger, block_seq, ts, block, phase='inference')
                block_seq += 1
                result = engine.infer_block(block)
                result['ch2_mirrored'] = args.mirror_ch1_to_ch2
                result['ch2_reconstructed'] = args.reconstruct_ch2_from_ch1
                if result.get('skipped'):
                    if 'quality_snr_db' in result:
                        # Gate itself passed (not POOR) -- one of the finer checks failed. Per
                        # channel: amplitude_ok and snr>-20dB and itakura<6.0 (T7 AND T8 each
                        # independently), plus ml_rating!=LOW-Q (T7-only, see quality_gate.py's
                        # TrustedIoTEEGValidator.validate_epoch for why). pli>surrogate_pli is
                        # diagnostic only, NOT part of is_trusted.
                        print(f'[{time.strftime("%H:%M:%S")}] SKIPPED (low quality) '
                              f'gate={result.get("quality_gate_rating")} score={result.get("quality_quality_score")} | '
                              f'amp_ok=({result.get("quality_amplitude_ok")},{result.get("quality_amplitude_ok_ch2")}) '
                              f'ptp=({result.get("quality_peak_to_peak_uV")},{result.get("quality_peak_to_peak_uV_ch2")})uV '
                              f'snr=({result.get("quality_snr_db")},{result.get("quality_snr_db_ch2")})dB '
                              f'pli={result.get("quality_pli_t7_t8")} vs surrogate={result.get("quality_surrogate_pli")} '
                              f'itakura=({result.get("quality_itakura_distance")},{result.get("quality_itakura_distance_ch2")}) '
                              f'ml={result.get("quality_ml_rating")}')
                    else:
                        # Failed the Step-0 9-factor gate itself (POOR) -- finer checks never ran.
                        print(f'[{time.strftime("%H:%M:%S")}] SKIPPED (low quality) '
                              f'gate={result.get("quality_gate_rating")} '
                              f'score={result.get("quality_quality_score")} (failed pre-filter, finer checks not run)')
                else:
                    drift = result.get('baseline_drift')
                    drift_str = f'{drift:.1%}' if drift is not None else 'n/a (no calm blocks yet)'
                    print(f'[{time.strftime("%H:%M:%S")}] p={result["calibrated_p"]:.3f}  '
                          f'high_load={result["high_load_alert"]}  '
                          f'break={result["micro_break_recommended"]}  '
                          f'fatigue={result["fatigue_warning"]}  '
                          f'cooldown={result["cooldown_logged"]}  '
                          f'quality={result.get("quality_gate_rating")}  '
                          f'baseline_drift={drift_str}')

                if not result.get('skipped'):
                    score_history.append(result.get('calibrated_p'))
                else:
                    score_history.append(None)
                if firebase is not None:
                    record = make_eeg_output_record(
                        result, window_sec=BLOCK_SEC, model_version=model_version,
                        feature_set='bipolar_only_v1' if 'bipolar_only' in args.model_dir else 'car_v1',
                        history_scores=score_history,
                    )
                    firebase.push(record)

                band = result.get('session_band')
                if band == 'SETUP_FAILURE':
                    print(f'  !! SESSION HEALTH: {band} -- '
                          f'{result.get("session_rejected_in_window")}/{result.get("session_window_blocks")} '
                          f'blocks rejected ({result.get("session_rejection_rate", 0):.0%}) in the last '
                          f'{result.get("session_window_blocks")} blocks. {result.get("session_message")}')
                elif band == 'USABLE':
                    print(f'  session health: {band} '
                          f'({result.get("session_rejection_rate", 0):.0%} rejected recently)')

                decision_logger.write({'timestamp': ts, 'block_seq': block_seq - 1, **result})
            time.sleep(1)
    except KeyboardInterrupt:
        print('\nStopping...')
    finally:
        client.loop_stop()
        client.disconnect()
        raw_logger.close()
        decision_logger.close()


if __name__ == '__main__':
    main()
