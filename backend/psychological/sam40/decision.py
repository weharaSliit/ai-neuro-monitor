"""Decision-value computation: converts a calibrated P(Demand) time series
(+ spectral slope, theta ratio) into trigger STATES. Stops at the decision
value / flag -- no notification/app-action integration (out of scope; that
layer belongs to whatever application consumes these flags).

IMPORTANT DATA LIMITATION: the "sustained over 10 minutes" / "over 30
minutes" conditions in the original spec need continuous recordings far
longer than anything available in this project. SAM40 trials are exactly
25s (one block each, no room for "consecutive blocks" within a trial at
all). STEW's 150s recordings are the longest continuous data available --
2.5 minutes, not 10-30. Every duration threshold below is expressed in
BLOCKS (not minutes) so it stays meaningful at whatever timescale the
input series actually spans; results computed on STEW should be read as
"mechanism demonstrated at 150s scale," not validated at the spec's
literal 10/30-minute targets.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class DecisionThresholds:
    """Probability thresholds updated 2026-08-18 from the original hand-picked
    0.70/0.75/0.30 to the "sensitivity-optimized" set (threshold_set_C) chosen
    from scripts/nested_threshold_selection.py + scripts/threshold_set_comparison.py's
    A/B/C comparison: percentile-based candidates (50th-70th of the deployed
    bipolar-only model's calibrated LOSO score distribution) scored against
    false-alert-rate-capped sensitivity, a deliberate middle ground between
    the original (way oversensitive: 95% of sessions alert, 0 cooldown events
    ever since 0.30 is never reached) and the strict nested-selected set
    (highest specificity but misses more true high-load subjects). See
    results/CURRENT_SYSTEM.md Section 6 for the full A/B/C comparison this
    was chosen from, including known limits (persistence-duration blocks
    below are still unvalidated at literal minute timescales).
    """
    high_load_p: float = 0.758
    high_load_persistence_blocks: int = 3          # spec: ">=3 consecutive blocks"
    break_p: float = 0.775
    break_persistence_blocks: int = 20              # spec: "sustained over 10 min"; blocks, not minutes -- see module docstring
    fatigue_theta_ratio_p75: float = None            # filled in per-series (75th percentile) if None
    fatigue_persistence_blocks: int = 60             # spec: "over 30 min"; blocks, not minutes -- see module docstring
    cooldown_high_p: float = 0.758
    cooldown_low_p: float = 0.725


# Robust, LOSO-derived population statistics -- NOT the single-session
# replay-test per-condition numbers (Relax=0.508, Mirror=0.594,
# Arithmetic=0.759, Stroop=0.739) documented in results/CURRENT_SYSTEM.md
# Section 6, which explicitly validate the code path only ("This validates
# the code path, not real-hardware signal quality"), not real per-condition
# population behavior.
#
# Loaded from the analysis pipeline's own output artifact rather than
# copy-pasted as literals here, so these track whatever the LOSO run last
# produced instead of a snapshot that silently drifts out of sync with it.
_PERCENTILES_CSV = (
    Path(__file__).resolve().parents[3]
    / "psycological" / "results" / "final_analysis" / "calibrated_p_percentiles.csv"
)


def _load_population_percentiles(csv_path: Path = _PERCENTILES_CSV) -> tuple[float, float, float]:
    try:
        row = pd.read_csv(csv_path).iloc[0]
        return float(row["P5"]), float(row["P50"]), float(row["P95"])
    except (FileNotFoundError, KeyError, IndexError) as e:
        raise RuntimeError(
            f"Could not load population calibrated_p percentiles from {csv_path} "
            f"(expected columns P5/P50/P95, one data row) -- this file is required "
            f"to compute personalized baseline shifts; regenerate it via the SAM40 "
            f"LOSO analysis pipeline (see results/CURRENT_SYSTEM.md Section 6) "
            f"rather than hardcoding a replacement value here."
        ) from e


POPULATION_P5, POPULATION_MEDIAN_P, POPULATION_P95 = _load_population_percentiles()
# high_load_p (DecisionThresholds above) was chosen independently via a
# separate sensitivity/specificity comparison and happens to land near
# POPULATION_MEDIAN_P -- see that dataclass's own docstring; the two are not
# derived from each other.
MAX_THRESHOLD_SHIFT = (POPULATION_P95 - POPULATION_P5) / 2  # ~0.11, from the loaded percentiles


def compute_baseline_shift(resting_scores: list[float]) -> float | None:
    """Measures how far THIS user's own resting-state calibrated_p sits from
    the population norm, from the blocks scored during their EXISTING
    Relax-only calibration window (BaselineCalibrationScreen.js explicitly
    walks the user through a guided-breathing calm-state protocol before
    this data is collected -- calibration happening while the user is
    actually calm is a real, deliberate premise of this app, not an
    assumption made here). No extra calibration time: these are the same
    blocks calibrate_block() already processes for the feature baseline,
    just also run through the model.

    The correction is applied to calibrated_p ITSELF (pipeline.py's
    infer_block(), row['calibrated_p'] = raw_score - baseline_shift), not to
    the decision thresholds -- so every consumer of calibrated_p (fusion's
    prob_eeg, the live UI, history charts, compute_states() below) sees a
    baseline-corrected number consistently, not just the alert flags. A user
    who runs "hot" at rest would otherwise look chronically elevated to
    every one of those consumers even while genuinely calm; subtracting
    their own resting offset fixes that at the source instead of only at
    the alert-threshold comparison.

    POPULATION_MEDIAN_P (0.758) is used as the reference point: it's the
    population's own OVERALL median calibrated_p (P50 in
    calibrated_p_percentiles.csv, results/CURRENT_SYSTEM.md Section 6) --
    high_load_p was chosen to land almost exactly on it (not by design), so
    it doubles as a convenient, already-validated "typical" reference. A
    user whose resting mean equals it gets shift=0 (no correction, exactly
    today's behavior); a user who reads higher/lower than that at rest gets
    a positive/negative correction.

    shift is clamped to +-MAX_THRESHOLD_SHIFT (half the population's observed
    P5-P95 spread) so a short, noisy calibration window can't push the
    correction beyond the range the population data has ever actually shown
    to be meaningful -- this bounds trust in a small sample, not a claim
    about the "true" personal offset.

    Returns None (caller should apply no correction, i.e. shift=0.0) if the
    resting-mean estimate isn't precise enough to trust, judged by its own
    standard error rather than a fixed block count: the calibration protocol
    (mqtt_bridge.py's N_CALIBRATION_BLOCKS) only ever captures 3 Relax-period
    blocks total, so a fixed minimum count high enough to mean anything in
    the usual statistical sense (e.g. 30) would make personalization
    unreachable by design, while a low fixed count (e.g. 2) can't tell a
    tight, consistent pair of readings apart from two readings that
    happened to disagree wildly. Comparing the sample's own standard error
    against MAX_THRESHOLD_SHIFT instead asks the question that actually
    matters here -- "is this estimate's own uncertainty smaller than the
    correction it would produce" -- using data already in hand rather than
    an arbitrary extra constant.
    """
    if len(resting_scores) < 2:
        return None  # variance needs at least 2 points to exist at all

    resting_mean = float(np.mean(resting_scores))
    resting_sem = float(np.std(resting_scores, ddof=1)) / np.sqrt(len(resting_scores))
    if resting_sem > MAX_THRESHOLD_SHIFT:
        return None

    shift = resting_mean - POPULATION_MEDIAN_P
    return max(-MAX_THRESHOLD_SHIFT, min(MAX_THRESHOLD_SHIFT, shift))


def compute_states(series: pd.DataFrame, thresholds: DecisionThresholds = DecisionThresholds()) -> pd.DataFrame:
    """series: rows ordered by time, columns calibrated_p, spectral_slope, theta_ratio.
    Returns series with added boolean/flag columns for each trigger condition.
    """
    df = series.reset_index(drop=True).copy()
    p = df.calibrated_p.to_numpy()

    # 1. High Load Alert: P >= high_load_p for >= N consecutive blocks
    above = p >= thresholds.high_load_p
    run = np.zeros(len(p), dtype=int)
    for i in range(len(p)):
        run[i] = (run[i - 1] + 1) if (i > 0 and above[i]) else int(above[i])
    df['high_load_alert'] = run >= thresholds.high_load_persistence_blocks

    # 2. Micro-Break Recommendation: P >= break_p sustained for >= N blocks
    above_break = p >= thresholds.break_p
    run_break = np.zeros(len(p), dtype=int)
    for i in range(len(p)):
        run_break[i] = (run_break[i - 1] + 1) if (i > 0 and above_break[i]) else int(above_break[i])
    df['micro_break_recommended'] = run_break >= thresholds.break_persistence_blocks

    # 3. Fatigue Warning: spectral slope steepening (more negative, trending down)
    #    + high theta ratio (above this series' own 75th percentile), sustained.
    if 'spectral_slope' in df.columns and 'theta_ratio' in df.columns:
        slope_steepening = df.spectral_slope.diff().fillna(0) < 0
        theta_thresh = thresholds.fatigue_theta_ratio_p75 or df.theta_ratio.quantile(0.75)
        high_theta = df.theta_ratio >= theta_thresh
        fatigue_raw = (slope_steepening & high_theta).to_numpy()
        run_fatigue = np.zeros(len(p), dtype=int)
        for i in range(len(p)):
            run_fatigue[i] = (run_fatigue[i - 1] + 1) if (i > 0 and fatigue_raw[i]) else int(fatigue_raw[i])
        df['fatigue_warning'] = run_fatigue >= thresholds.fatigue_persistence_blocks
    else:
        df['fatigue_warning'] = False

    # 4. Task Completion / Cooldown: shift from P>=cooldown_high_p to P<=cooldown_low_p
    was_high = pd.Series(p).shift(1) >= thresholds.cooldown_high_p
    df['cooldown_logged'] = was_high.to_numpy() & (p <= thresholds.cooldown_low_p)

    return df
