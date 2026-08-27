import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class DecisionThresholds:
    high_load_p: float = 0.758
    high_load_persistence_blocks: int = 3          # spec: ">=3 consecutive blocks"
    break_p: float = 0.775
    break_persistence_blocks: int = 20              # spec: "sustained over 10 min"; blocks, not minutes -- see module docstring
    fatigue_theta_ratio_p75: float = None            # filled in per-series (75th percentile) if None
    fatigue_persistence_blocks: int = 60             # spec: "over 30 min"; blocks, not minutes -- see module docstring
    cooldown_high_p: float = 0.758
    cooldown_low_p: float = 0.725

# Lives INSIDE backend/psychological/ (not the separate psycological/
# research tree, 3 parents up) so it deploys with this service regardless
# of Render root-directory scoping -- a monorepo service configured with
# root=backend/psychological would never see the research tree at all,
# and this constant is loaded at import time, so that would crash the
# whole service on startup rather than just this one calculation. Same
# reasoning as firebase_service.py's FIREBASE_CRED_JSON pattern (avoid
# runtime dependencies on files outside this service's own directory).
_PERCENTILES_JSON = Path(__file__).resolve().parent / "population_percentiles.json"


def _load_population_percentiles(json_path: Path = _PERCENTILES_JSON) -> tuple[float, float, float]:
    try:
        with open(json_path) as f:
            data = json.load(f)
        return float(data["P5"]), float(data["P50"]), float(data["P95"])
    except (FileNotFoundError, KeyError, json.JSONDecodeError) as e:
        raise RuntimeError(
            f"Could not load population calibrated_p percentiles from {json_path} "
            f"(expected JSON keys P5/P50/P95) -- this file is required to compute "
            f"personalized baseline shifts; if the SAM40 LOSO analysis pipeline was "
            f"rerun (see results/CURRENT_SYSTEM.md Section 6 in the psycological/ "
            f"research tree), copy its new percentiles into this file rather than "
            f"hardcoding a replacement value here."
        ) from e


POPULATION_P5, POPULATION_MEDIAN_P, POPULATION_P95 = _load_population_percentiles()
# high_load_p (DecisionThresholds above) was chosen independently via a
# separate sensitivity/specificity comparison and happens to land near
# POPULATION_MEDIAN_P -- see that dataclass's own docstring; the two are not
# derived from each other.
MAX_THRESHOLD_SHIFT = (POPULATION_P95 - POPULATION_P5) / 2  # ~0.11, from the loaded percentiles


def compute_baseline_shift(resting_scores: list[float]) -> float | None:
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
