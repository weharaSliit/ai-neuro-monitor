"""
Psychological (EEG) Realtime Pipeline Verification Suite
Exercises backend/psychological/realtime/* end-to-end with synthetic data --
no server, no hardware, and no real Firebase/MQTT connection needed. Matches
this repo's existing test convention (see
backend/phenotyping_behavior/test_integration.py,
backend/physiological/test_firebase.py): a plain runnable script with manual
assertions and a pass/fail summary, not pytest (pytest isn't a project
dependency here).

Run with: python backend/psychological/test_realtime_pipeline.py
"""

import sys
from pathlib import Path

import numpy as np

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.psychological.realtime.adc import (
    BIPOLAR_UV_PER_COUNT, bipolar_code_to_microvolts, clip_physiological_uv, microvolts_to_bipolar_code,
    raw_magnitude_ok,
)
from backend.psychological.realtime.mqtt_client import BipolarRawSample
from backend.psychological.realtime.pipeline import BLOCK_SEC, RealtimeInference, preprocess_bipolar_block
from backend.psychological.realtime.quality_gate import SignalQualityGate
from backend.psychological.realtime.raw_cleaning import interpolate_to_uniform_grid, remove_spikes, timing_ok
from backend.psychological.realtime.resample import SOURCE_FS, TARGET_FS, resample_to_target
from backend.psychological.sam40.decision import (
    MAX_THRESHOLD_SHIFT, POPULATION_P5, POPULATION_P95, compute_personal_threshold,
)

MODEL_DIR = Path(__file__).resolve().parent / "models"


def make_synthetic_block(duration_sec: float = BLOCK_SEC, fs: int = SOURCE_FS,
                          start_millis: int = 0, seed: int = 0) -> list[BipolarRawSample]:
    """A plausible T7-T8 bipolar block: theta+alpha+beta sines plus small
    measurement noise, in a physiological uV range, converted to ADC codes
    via the real microvolts_to_bipolar_code() (adc.py) -- NOT
    microvolts_to_code(), which inverts the 2-channel code_to_microvolts()
    instead and silently produces a ~4x-wrong code for this bipolar path
    (see microvolts_to_bipolar_code()'s own docstring) -- so this exercises
    the same round-trip preprocess_bipolar_block()'s
    bipolar_code_to_microvolts() call actually does."""
    rng = np.random.default_rng(seed)
    n = int(duration_sec * fs)
    t = np.arange(n) / fs
    uv = (25.0 * np.sin(2 * np.pi * 6.0 * t)      # theta
          + 20.0 * np.sin(2 * np.pi * 10.0 * t)   # alpha
          + 10.0 * np.sin(2 * np.pi * 20.0 * t)   # beta
          + rng.normal(0.0, 2.0, n))               # measurement noise
    codes = microvolts_to_bipolar_code(uv)
    millis = start_millis + (t * 1000).astype(int)
    return [BipolarRawSample(millis=int(m), code=int(c)) for m, c in zip(millis, codes)]


def main() -> bool:
    print("=" * 60)
    print("PSYCHOLOGICAL (EEG) REALTIME PIPELINE VERIFICATION SUITE")
    print("=" * 60)
    all_passed = True

    def check(label: str, condition: bool, detail: str = "") -> None:
        nonlocal all_passed
        if condition:
            print(f"[PASS] {label}")
        else:
            all_passed = False
            print(f"[FAIL] {label}" + (f" -- {detail}" if detail else ""))

    # 1. ADC conversion ---------------------------------------------------
    print("\n[1] adc.py")
    uv = bipolar_code_to_microvolts(np.array([1000.0]))[0]
    check("bipolar_code_to_microvolts scales a known code", abs(uv - 1000.0 * BIPOLAR_UV_PER_COUNT) < 1e-6,
          f"got {uv}")
    clamped = clip_physiological_uv(np.array([500.0, -500.0, 50.0]))
    check("clip_physiological_uv clamps to +-100uV", list(clamped) == [100.0, -100.0, 50.0],
          f"got {list(clamped)}")
    check("raw_magnitude_ok flags an extreme value", not raw_magnitude_ok(np.array([500_000.0])))
    check("raw_magnitude_ok passes a normal value", raw_magnitude_ok(np.array([50.0, -80.0])))

    # 2. Raw cleaning -------------------------------------------------------
    print("\n[2] raw_cleaning.py")
    clean_vals = np.sin(np.linspace(0, 20, 200))
    spiked_vals = clean_vals.copy()
    spiked_vals[100] = 500.0  # a single wild outlier
    despiked, n_spikes = remove_spikes(spiked_vals, window=25)
    check("remove_spikes flags the injected outlier", n_spikes >= 1, f"n_spikes={n_spikes}")
    check("remove_spikes pulls the outlier back toward the real signal",
          abs(despiked[100] - clean_vals[100]) < abs(spiked_vals[100] - clean_vals[100]))

    millis = np.arange(0, 1000, 4)  # 250Hz-spaced timestamps, 1s worth
    values = np.sin(np.linspace(0, 10, len(millis)))
    grid = interpolate_to_uniform_grid(millis, values, target_fs=TARGET_FS, duration_sec=1.0)
    check("interpolate_to_uniform_grid produces duration_sec*target_fs samples",
          len(grid) == TARGET_FS, f"got {len(grid)}, expected {TARGET_FS}")

    check("timing_ok passes normal 4ms spacing", timing_ok(millis))
    gapped = np.concatenate([millis[:50], millis[50:] + 2000])  # >1s gap injected
    check("timing_ok flags a >1s gap", not timing_ok(gapped))

    # 3. Resampling -----------------------------------------------------
    print("\n[3] resample.py")
    block_250hz = np.zeros((1, int(BLOCK_SEC * SOURCE_FS)))
    resampled = resample_to_target(block_250hz, source_fs=SOURCE_FS, target_fs=TARGET_FS)
    expected_len = int(BLOCK_SEC * TARGET_FS)
    check("resample_to_target maps a 250Hz block length to the 128Hz block length",
          abs(resampled.shape[-1] - expected_len) <= 1, f"got {resampled.shape[-1]}, expected ~{expected_len}")

    # 4. Quality gate, on a REAL synthetic block run through the real -------
    #    preprocessing chain (not a hand-crafted filtered array).
    print("\n[4] quality_gate.py (synthetic block through preprocess_bipolar_block)")
    samples = make_synthetic_block(seed=1)
    raw_codes = np.array([s.code for s in samples], dtype=float)
    filtered = preprocess_bipolar_block(samples)

    gate = SignalQualityGate(fs_raw=SOURCE_FS, fs_filtered=TARGET_FS)
    score, rating, _ = gate.assess_epoch_single(raw_codes, filtered)
    check("a clean synthetic signal does not score POOR", rating != "POOR", f"rating={rating} score={score}")

    flat_raw = np.zeros_like(raw_codes)
    flat_filtered = np.zeros_like(filtered)
    flat_score, flat_rating, _ = gate.assess_epoch_single(flat_raw, flat_filtered)
    check("a flat/degenerate signal scores POOR", flat_rating == "POOR", f"rating={flat_rating}")

    # 5. End-to-end RealtimeInference smoke test ---------------------------
    print("\n[5] pipeline.py RealtimeInference (calibrate -> finalize -> infer)")
    try:
        engine = RealtimeInference(MODEL_DIR, disable_quality_gate=True)
        for i in range(2):
            block = make_synthetic_block(start_millis=i * int(BLOCK_SEC * 1000), seed=10 + i)
            engine.calibrate_bipolar_block(block)
        outcome = engine.finalize_calibration_bipolar()
        check("finalize_calibration_bipolar succeeds on trusted synthetic blocks",
              outcome["status"] == "ok", f"outcome={outcome}")

        infer_block = make_synthetic_block(start_millis=2 * int(BLOCK_SEC * 1000), seed=20)
        result = engine.infer_bipolar_block(infer_block)
        check("infer_bipolar_block does not skip a trusted block", result.get("skipped") is False,
              f"result keys={list(result.keys())}")
        p = result.get("calibrated_p")
        check("infer_bipolar_block returns calibrated_p in [0, 1]",
              p is not None and 0.0 <= p <= 1.0, f"calibrated_p={p}")
    except Exception as e:
        check("RealtimeInference end-to-end smoke test raised no exception", False, repr(e))

    # 6. compute_personal_threshold() -- the onboarding task-calibration math -
    print("\n[6] sam40/decision.py compute_personal_threshold()")
    # Chosen to sit inside [POPULATION_P5, POPULATION_P95] so the clamp
    # doesn't kick in here -- clamping itself is checked separately below.
    resting = [0.65, 0.67, 0.64, 0.66]
    clearly_separated_task = [0.65 + MAX_THRESHOLD_SHIFT + 0.05] * 2  # comfortably past the separation floor
    threshold = compute_personal_threshold(resting, clearly_separated_task)
    expected_midpoint = (np.mean(resting) + np.mean(clearly_separated_task)) / 2.0
    check("clear Rest/Task separation returns the midpoint",
          threshold is not None and abs(threshold - expected_midpoint) < 1e-9,
          f"got {threshold}, expected {expected_midpoint}")
    check("the returned threshold is clamped within the observed population range",
          threshold is not None and POPULATION_P5 <= threshold <= POPULATION_P95, f"got {threshold}")

    noisy_task = [0.66, 0.68, 0.65]  # barely different from resting -- not real separation
    check("overlapping/noisy Rest vs Task scores return None (not personalized)",
          compute_personal_threshold(resting, noisy_task) is None)
    check("compute_personal_threshold requires at least one score per group",
          compute_personal_threshold([], [0.9]) is None and compute_personal_threshold([0.2], []) is None)

    below_range = compute_personal_threshold([0.05], [0.05 + MAX_THRESHOLD_SHIFT + 0.05])
    check("a midpoint below POPULATION_P5 is clamped up to it",
          below_range == POPULATION_P5, f"got {below_range}, expected {POPULATION_P5}")

    # 7. Onboarding task-calibration flow, on the same engine as [5] --------
    print("\n[7] pipeline.py score_threshold_task_block() -> finalize_personal_threshold()")
    try:
        task_block = make_synthetic_block(start_millis=3 * int(BLOCK_SEC * 1000), seed=30)
        task_quality = engine.score_threshold_task_block(task_block)
        check("score_threshold_task_block returns a quality dict with is_trusted",
              "is_trusted" in task_quality, f"got keys={list(task_quality.keys())}")

        threshold_outcome = engine.finalize_personal_threshold()
        check("finalize_personal_threshold returns a well-formed outcome",
              threshold_outcome.get("status") in ("ok", "not_separated"), f"outcome={threshold_outcome}")
        if threshold_outcome["status"] == "ok":
            p = threshold_outcome["personal_high_load_p"]
            check("a successful personal threshold is applied to engine.thresholds",
                  engine.thresholds.high_load_p == p and engine.thresholds.cooldown_high_p == p,
                  f"personal_high_load_p={p} thresholds={engine.thresholds}")
        else:
            print(f"       (not_separated on this synthetic run -- structurally fine, "
                  f"outcome={threshold_outcome})")
    except Exception as e:
        check("Onboarding task-calibration flow raised no exception", False, repr(e))

    print("\n" + "=" * 60)
    print("ALL CHECKS PASSED" if all_passed else "SOME CHECKS FAILED")
    print("=" * 60)
    return all_passed


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
