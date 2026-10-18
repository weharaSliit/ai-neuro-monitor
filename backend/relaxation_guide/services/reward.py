"""
Multi-objective, recovery-aware reward for the relaxation guide.

Instead of a state-transition lookup, the reward is computed from the measured stress
trajectory of the session:

  uplift  - excess stress (area above the user's baseline) REMOVED beyond what natural recovery
            would have removed anyway (stress often falls by itself, so a technique only gets
            credit for the extra improvement),
  speed   - how early the user reached their baseline (never reached = 0, i.e. censored),
  rating  - the user's own 1-5 rating,
  effort  - shorter sessions cost the user less.

All parts are in [0, 1]; the weights live in config.py and are tuned in the offline experiment.
The same trajectory also gives a measured recovery percentage: the share of the starting
excess stress that is gone at the end of the session.
"""

import sys
import math
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import (
    REWARD_W_UPLIFT,
    REWARD_W_SPEED,
    REWARD_W_RATING,
    REWARD_W_EFFORT,
    NATURAL_RECOVERY_TAU_SEC,
    BASELINE_MARGIN,
    SESSION_WINDOW_SEC,
)

MIN_POINTS = 4


def _excess_area(t: np.ndarray, stress: np.ndarray, baseline: float) -> float:
    y = np.maximum(0.0, stress - baseline)
    return float(np.sum((y[1:] + y[:-1]) * np.diff(t)) / 2.0)   # trapezoid rule (numpy 1.x/2.x safe)


def prepare_trajectory(points: Optional[Sequence]) -> Optional[Dict[str, np.ndarray]]:
    """Accepts [{'t': sec, 'p': stress}, ...] (t may be epoch seconds) -> arrays with t starting at 0."""
    if not points:
        return None
    rows = []
    for pt in points:
        try:
            t = float(pt["t"] if isinstance(pt, dict) else pt[0])
            p = float(pt["p"] if isinstance(pt, dict) else pt[1])
        except (KeyError, TypeError, ValueError, IndexError):
            continue
        if math.isfinite(t) and math.isfinite(p):
            rows.append((t, min(1.0, max(0.0, p))))
    if len(rows) < MIN_POINTS:
        return None
    rows.sort(key=lambda r: r[0])
    t = np.array([r[0] for r in rows]) - rows[0][0]
    s = np.array([r[1] for r in rows])
    if t[-1] <= 0:
        return None
    return {"t": t, "stress": s}


def compute_reward(
    trajectory: Dict[str, np.ndarray],
    baseline: float,
    star_rating: int,
    tau: float = NATURAL_RECOVERY_TAU_SEC,
) -> Dict[str, float]:
    t, s = trajectory["t"], trajectory["stress"]
    duration = float(t[-1])
    s0 = float(np.mean(s[:min(3, len(s))]))          # smoothed start of the session
    s_end = float(np.mean(s[-min(3, len(s)):]))      # smoothed end of the session
    excess0 = max(1e-6, s0 - baseline)

    # Counterfactual: what natural recovery alone would have done from the same start.
    natural = baseline + (s0 - baseline) * np.exp(-t / max(1.0, tau))
    area_obs = _excess_area(t, s, baseline)
    area_nat = _excess_area(t, natural, baseline)
    if area_nat <= 1e-9:
        uplift_raw = 0.0
    else:
        uplift_raw = float(np.clip((area_nat - area_obs) / area_nat, -1.0, 1.0))
    uplift = 0.5 * (1.0 + uplift_raw)

    reached = np.where(s <= baseline + BASELINE_MARGIN)[0]
    if len(reached) == 0 or s0 <= baseline + BASELINE_MARGIN:
        speed = 0.0 if s0 > baseline + BASELINE_MARGIN else 1.0
        time_to_baseline = None if s0 > baseline + BASELINE_MARGIN else 0.0
    else:
        time_to_baseline = float(t[reached[0]])
        speed = float(np.clip(1.0 - time_to_baseline / SESSION_WINDOW_SEC, 0.0, 1.0))

    rating = float(np.clip((star_rating - 1) / 4.0, 0.0, 1.0))
    effort = float(np.clip(1.0 - duration / SESSION_WINDOW_SEC, 0.0, 1.0))

    reward = (
        REWARD_W_UPLIFT * uplift
        + REWARD_W_SPEED * speed
        + REWARD_W_RATING * rating
        + REWARD_W_EFFORT * effort
    )
    recovery_pct = float(np.clip((s0 - s_end) / excess0, 0.0, 1.0) * 100.0)

    return {
        "reward": float(np.clip(reward, 0.0, 1.0)),
        "uplift": uplift,
        "uplift_raw": uplift_raw,
        "speed": speed,
        "rating": rating,
        "effort": effort,
        "recovery_pct": recovery_pct,
        "start_stress": s0,
        "end_stress": s_end,
        "time_to_baseline": time_to_baseline,
        "duration": duration,
    }
