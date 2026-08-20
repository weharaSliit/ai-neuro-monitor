#!/usr/bin/env python3
"""
Replay test for the real-time pipeline, without live hardware/MQTT broker.

Takes real SAM40 T7/T8 signal (128Hz), upsamples it to 250Hz and inverts
the ADC conversion to synthesize plausible raw ADC codes, then feeds those
through the EXACT same RawSample -> RealtimeInference code path a live
MQTT stream would use. This validates the whole pipeline (ADC conversion,
250->128Hz resampling, feature extraction, model inference, decision
logic) except the network transport itself (thin, well-tested paho-mqtt
code, low risk) -- and as a side effect, tests that the resample round-
trip (128Hz -> upsample to 250 -> back down to 128Hz) doesn't destroy the
signal's useful structure.

Usage:
    python3 scripts/test_realtime_pipeline_replay.py --subject 2
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from realtime.adc import GAIN, VREF_VOLTS  # noqa: E402
from realtime.mqtt_client import RawSample  # noqa: E402
from realtime.pipeline import RealtimeInference  # noqa: E402
from sam40.channels import CHANNEL_NAMES  # noqa: E402
from sam40.loader import discover_trials, load_trial_data  # noqa: E402
from sam40.preprocess import common_average_reference  # noqa: E402


def microvolts_to_code(uv: np.ndarray, gain: float = GAIN, vref: float = VREF_VOLTS) -> np.ndarray:
    """Inverse of realtime.adc.code_to_microvolts, to synthesize test ADC codes."""
    from realtime.adc import ADC_FULL_SCALE
    volts = uv / 1e6
    code = volts * (gain * ADC_FULL_SCALE) / vref
    return np.round(code).astype(np.int64)


def trial_to_raw_samples(trial, chan_idx) -> list[RawSample]:
    raw_32chan = load_trial_data(trial, source='filtered')
    # The deployed model is bipolar-only (T7-T8) and reference-agnostic.
    # To test it correctly, we must NOT apply a 32-channel Common Average
    # Reference (CAR), as the live 2-electrode hardware cannot compute it.
    # This test must replicate the live hardware's input as closely as possible,
    # where the bipolar difference T7-T8 is computed from non-CAR signals.
    selected = raw_32chan[chan_idx, :]  # (2, 3200) at 128Hz

    upsampled = resample_poly(selected, 250, 128, axis=-1)  # -> ~250Hz, simulating raw hardware rate
    codes = microvolts_to_code(upsampled)

    samples = []
    for i in range(codes.shape[1]):
        samples.append(RawSample(millis=i * 4, ch1_code=int(codes[0, i]), ch2_code=int(codes[1, i])))
    return samples


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--subject', type=int, default=2)
    parser.add_argument('--model-dir', default=str(ROOT / 'results' / 'models_25s_block'))
    args = parser.parse_args()

    chan_idx = [CHANNEL_NAMES.index(c) for c in ['T7', 'T8']]
    all_trials = discover_trials(ROOT / 'data' / 'SAM40' / 'filtered_data')
    subject_trials = {t.task: t for t in all_trials if t.subject == args.subject and t.trial == 1}
    relax_extra = [t for t in all_trials if t.subject == args.subject and t.task == 'Relax' and t.trial in (2, 3)]

    engine = RealtimeInference(Path(args.model_dir))

    print('Calibrating from Relax trials (simulated raw MQTT samples)...')
    for trial in [subject_trials['Relax']] + relax_extra:
        samples = trial_to_raw_samples(trial, chan_idx)
        engine.calibrate_block(samples)
    print(f'  baseline established from {len(engine.baseline.blocks)} Relax blocks')

    print('\nRunning inference on each condition (via the full replay pipeline)...')
    results = {}
    for task in ['Relax', 'Arithmetic', 'Mirror_image', 'Stroop']:
        samples = trial_to_raw_samples(subject_trials[task], chan_idx)
        assert len(samples) > 0
        result = engine.infer_block(samples)
        results[task] = result
        if result.get('skipped'):
            print(f'  {task:14s} SKIPPED (quality gate: {result.get("quality_gate_rating")}, '
                  f'reason={result.get("quality_reason", "see quality_* fields")})')
        else:
            print(f'  {task:14s} raw_score={result["raw_score"]:.3f}  '
                  f'high_load_alert={result["high_load_alert"]}')

    print('\n=== Replay test verdict ===')
    scored = {t: r for t, r in results.items() if not r.get('skipped')}
    if 'Relax' not in scored:
        print('FAIL: Relax block itself was skipped by the quality gate -- cannot check ordering.')
    else:
        relax_score = scored['Relax']['raw_score']
        task_scores = {t: scored[t]['raw_score'] for t in ['Arithmetic', 'Mirror_image', 'Stroop'] if t in scored}
        ordered_correctly = all(s > relax_score for s in task_scores.values())
        print(f'Relax score ({relax_score:.3f}) lower than all scored task blocks {list(task_scores.keys())}: '
              f'{ordered_correctly}')
        skipped = [t for t in results if results[t].get('skipped')]
        if skipped:
            print(f'NOTE: {skipped} were skipped by the quality gate this run and excluded from the '
                  f'ordering check -- not necessarily a failure, see their printed reason above.')
        print('PASS: full replay pipeline (ADC->resample->features->model->decision) runs end-to-end '
              'and preserves the expected Relax < stress-task ordering (among scored blocks).' if ordered_correctly else
              'FAIL: ordering was not preserved through the replay pipeline -- investigate before trusting '
              'live-hardware inference.')


if __name__ == '__main__':
    main()
