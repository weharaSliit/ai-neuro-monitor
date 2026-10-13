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
from backend.psychological.realtime.pipeline import (
    BLOCK_SEC, RealtimeInference, preprocess_bipolar_block, preprocess_bipolar_block_unclamped,
)
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

    # 8. Personal Scale decision rule + fusion gating -----------------------
    # Scores are injected directly (synthetic blocks can't be steered to a
    # chosen model output), so this checks the rule itself.
    print("\n[8] Personal Scale: mu_rest, z, responsiveness, fusion exclusion")
    try:
        from backend.psychological.realtime.firebase_sync import make_eeg_fusion_record, make_eeg_output_record
        from backend.psychological.sam40.decision import (
            MIN_TASK_RESPONSE_Z, PERSONAL_K_ALERT, PERSONAL_SIGMA_PRIOR, personal_z,
        )

        def engine_with(rest, task=None):
            e = RealtimeInference(MODEL_DIR)
            e.baseline.add({"x": 0.0})  # finalize's "ok" path only needs a non-empty baseline
            e._calibration_scores = list(rest)
            e.finalize_calibration_bipolar()
            if task is not None:
                e._task_scores = list(task)
                return e, e.finalize_personal_threshold()
            return e, None

        e, _ = engine_with([0.30, 0.34])
        check("mu_rest is the mean of this session's rest scores", abs(e.mu_rest - 0.32) < 1e-9, f"mu_rest={e.mu_rest}")
        check("alert threshold is mu_rest + K*sigma (z >= K)",
              abs(e.thresholds.high_load_p - (0.32 + PERSONAL_K_ALERT * PERSONAL_SIGMA_PRIOR)) < 1e-9,
              f"high_load_p={e.thresholds.high_load_p}")
        check("no probability shift is applied", e.baseline_shift == 0.0, f"baseline_shift={e.baseline_shift}")
        check("z = (s - mu_rest)/sigma", abs(personal_z(0.32 + PERSONAL_SIGMA_PRIOR, e.mu_rest) - 1.0) < 1e-9)

        e, _ = engine_with([1e-63, 2e-40])
        check("saturated rest scores (< 1e-6) give no personal baseline",
              e.mu_rest is None and not e.thresholds_personalized and e.n_implausible_rest_blocks == 2,
              f"mu_rest={e.mu_rest}")

        _, out = engine_with([0.30, 0.30], task=[0.30 + 0.6 * PERSONAL_SIGMA_PRIOR] * 3)
        check("task >= 0.5 sigma above rest -> responsive ('ok')",
              out["status"] == "ok" and out["responsive"] is True, f"outcome={out}")
        _, out = engine_with([0.30, 0.30], task=[0.30 + 0.2 * PERSONAL_SIGMA_PRIOR] * 3)
        check("task < 0.5 sigma above rest -> not responsive ('not_separated')",
              out["status"] == "not_separated" and out["responsive"] is False
              and out["task_response_z"] < MIN_TASK_RESPONSE_Z, f"outcome={out}")

        base = {"window": 0, "skipped": False, "calibrated_p": 0.35, "task_state_z": 0.19,
                "mu_rest": 0.32, "personal_sigma": PERSONAL_SIGMA_PRIOR, "quality_quality_score": 99.0,
                "quality_is_trusted": True}

        def fusion_for(**over):
            rec = make_eeg_output_record({**base, **over}, 25.0, "bipolar_only_v1", "bipolar_only_v1",
                                         [0.35], high_load_p=0.455, capture_end_ts=1.8e9)
            return make_eeg_fusion_record(rec)

        f = fusion_for(eeg_responsive=None)
        check("responsiveness unknown -> EEG enters fusion with personal threshold and sigma scale",
              f["prob_eeg"] == 0.35 and f["threshold_eeg"] == 0.455
              and f["threshold_scale_eeg"] == PERSONAL_SIGMA_PRIOR and f["eeg_excluded_reason"] is None, f"{f}")
        for over, reason in [({"eeg_responsive": False}, "not_responsive"),
                             ({"baseline_degraded": True}, "degraded_baseline"),
                             ({"mu_rest": None}, "no_personal_baseline")]:
            f = fusion_for(**over)
            check(f"{reason} -> no EEG prob in fusion", f["prob_eeg"] is None and f["eeg_excluded_reason"] == reason, f"{f}")
    except Exception as e:
        check("Personal Scale checks raised no exception", False, repr(e))

    # 9. Quality gate judges the UNCLAMPED filtered signal --------------------
    print("\n[9] quality gate on the unclamped filtered signal")
    try:
        gate = SignalQualityGate(fs_raw=SOURCE_FS, fs_filtered=TARGET_FS)
        rng9 = np.random.default_rng(9)
        n9 = int(BLOCK_SEC * SOURCE_FS)
        t9 = np.arange(n9) / SOURCE_FS

        def block_from_uv(uv):
            return [BipolarRawSample(millis=i * 4, code=int(c)) for i, c in enumerate(microvolts_to_bipolar_code(uv))]

        eeg_uv = 4 * np.sin(2 * np.pi * 10 * t9) + rng9.normal(0, 4, n9) + 300.0      # ~SAM40 range
        big_uv = 400 * np.sin(2 * np.pi * 7 * t9) + rng9.normal(0, 300, n9)           # ~your interference
        for name, uv in (("in-range EEG", eeg_uv), ("out-of-range", big_uv)):
            unc = preprocess_bipolar_block_unclamped(block_from_uv(uv))
            clamped = preprocess_bipolar_block(block_from_uv(uv))
            score, rating, det = gate.assess_epoch_single(np.zeros(n9) + 1.0, unc)
            if name == "in-range EEG":
                check("in-range EEG is not POOR on the unclamped signal", rating != "POOR",
                      f"score={score} det={det}")
                check("in-range EEG: clamping changes nothing (gate and model see the same signal)",
                      np.allclose(unc, clamped))
            else:
                check("out-of-range signal is POOR with an explicit out-of-range reason",
                      rating == "POOR" and "beyond" in (det.get("reason") or ""), f"det={det}")
                check("reported ptp is the real unclamped size, not the 200 uV clamp",
                      det["ptp_uV_unclamped"] > 1000, f"ptp={det['ptp_uV_unclamped']}")
    except Exception as e:
        check("Unclamped quality-gate checks raised no exception", False, repr(e))

    print("\n" + "=" * 60)
    print("ALL CHECKS PASSED" if all_passed else "SOME CHECKS FAILED")
    print("=" * 60)
    return all_passed


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
