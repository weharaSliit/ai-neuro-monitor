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

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class DecisionThresholds:
    """Probability thresholds updated 2026-08-28 from the 2026-08-18
    "sensitivity-optimized" set (threshold_set_C, 0.758/0.775/0.725) to the
    nested-LOSO-selected set (threshold_set_B) produced by
    scripts/nested_threshold_selection.py: outer LOSO x inner grouped CV,
    leakage-free Platt-calibrated inner scores, candidate thresholds =
    percentiles of that inner distribution, each scored against a
    false-alert-rate-capped sensitivity objective (high_load/break) or
    minimized false-recovery rate (cooldown), locked per outer fold and
    applied unchanged to the held-out subject. Values below are the mean
    locked threshold across all 40 outer folds (std < 0.006 on each --
    stable selection); see nested_threshold_per_fold.csv /
    nested_threshold_outer_predictions.csv in results/final_analysis/.

    KNOWN TRADEOFF, evaluated deliberately: this set was tried once before
    (2026-08-18) and reverted in favor of threshold_set_C specifically
    because pooled OUTER (truly held-out) sensitivity is only 29.4%
    (high_load) / 19.7% (break) at the target false-alert-rate cap -- i.e.
    it misses 70-80% of real high-load blocks in a subject the model
    wasn't tuned on. Re-adopted anyway as of 2026-08-28, prioritizing the
    lower false-alert rate / higher specificity this set buys over
    catching more true high-load blocks. If that tradeoff turns out wrong
    in practice, threshold_set_C (0.758 / 0.775 / cooldown_high 0.758 /
    cooldown_low 0.725) is the documented fallback. See
    results/CURRENT_SYSTEM.md Section 6 for the original A/B/C comparison.

    cooldown_high_p is not itself an output of the nested selection (that
    script only tunes cooldown_low_p, i.e. cooldown_t) -- kept equal to
    high_load_p here, same coupling threshold_set_C used ("was previously
    in a high-load state" = the same bar as the high-load alert itself).
    """
    high_load_p: float = 0.7933008189294708
    high_load_persistence_blocks: int = 3          # spec: ">=3 consecutive blocks"
    break_p: float = 0.8104568085102677
    break_persistence_blocks: int = 20              # spec: "sustained over 10 min"; blocks, not minutes -- see module docstring
    fatigue_theta_ratio_p75: float = None            # filled in per-series (75th percentile) if None
    fatigue_persistence_blocks: int = 60             # spec: "over 30 min"; blocks, not minutes -- see module docstring
    cooldown_high_p: float = 0.7933008189294708
    cooldown_low_p: float = 0.6962175275425009


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
