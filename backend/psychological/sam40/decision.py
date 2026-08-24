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
