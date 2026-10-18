"""
Context Builder for Relaxation Guide.

Turns the raw stress readings (fusion engine + phenotyping, each a probability) into a
person-relative context:
  - an exponentially smoothed stress level per stream,
  - the user's own baseline and variability (so 0.6 means "how far above MY normal"),
  - the stress slope over the last ~90 s,
  - the physiological / phenotyping disagreement,
  - a CUSUM alarm that fires when stress has risen beyond the user's own normal variation.
"""

import sys
import math
import time
from collections import deque
from pathlib import Path
from typing import Deque, Dict, List, Optional, Tuple

import numpy as np

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import (
    CONTEXT_EWMA_ALPHA,
    CONTEXT_HISTORY_LEN,
    CONTEXT_SLOPE_WINDOW_SEC,
    CONTEXT_MIN_SCALE,
    CONTEXT_CUSUM_K,
    CONTEXT_CUSUM_H,
)

DEFAULT_BASELINE = 0.35

# Fixed scaling so features are comparable before K-means / the linear model use them.
FEATURE_NAMES = ["z_rel", "slope_per_min", "physio", "pheno", "disagreement"]


def default_context_vector(score: float, baseline: float = DEFAULT_BASELINE) -> List[float]:
    """Context for callers that only know one stress score (no history, no second stream)."""
    score = float(min(1.0, max(0.0, score)))
    z = (score - baseline) / max(CONTEXT_MIN_SCALE, 0.15)
    return [z, 0.0, score, score, 0.0]


class _UserState:
    def __init__(self) -> None:
        self.samples: Deque[Tuple[float, float]] = deque(maxlen=CONTEXT_HISTORY_LEN)  # (t, combined)
        self.physio_ewma: Optional[float] = None
        self.pheno_ewma: Optional[float] = None
        self.combined_ewma: Optional[float] = None
        self.cusum: float = 0.0
        self.n: int = 0
        self.mean: float = 0.0   # Welford running mean / variance of the smoothed combined score
        self.m2: float = 0.0


class ContextBuilder:
    def __init__(self) -> None:
        self._users: Dict[str, _UserState] = {}

    def _state(self, user_id: str) -> _UserState:
        if user_id not in self._users:
            self._users[user_id] = _UserState()
        return self._users[user_id]

    @staticmethod
    def _ewma(prev: Optional[float], value: float) -> float:
        return value if prev is None else CONTEXT_EWMA_ALPHA * value + (1.0 - CONTEXT_EWMA_ALPHA) * prev

    def update(
        self,
        user_id: str,
        physio_score: Optional[float],
        pheno_score: Optional[float] = None,
        baseline: Optional[float] = None,
        timestamp: Optional[float] = None,
    ) -> Dict:
        """Add one reading (either stream may be missing) and return the current context."""
        st = self._state(user_id)
        t = float(timestamp if timestamp is not None else time.time())
        base = DEFAULT_BASELINE if baseline is None else float(baseline)

        if physio_score is not None:
            st.physio_ewma = self._ewma(st.physio_ewma, float(physio_score))
        if pheno_score is not None:
            st.pheno_ewma = self._ewma(st.pheno_ewma, float(pheno_score))

        physio = st.physio_ewma if st.physio_ewma is not None else st.pheno_ewma
        pheno = st.pheno_ewma if st.pheno_ewma is not None else st.physio_ewma
        if physio is None:
            return self.snapshot(user_id, baseline=base)

        # Streams are blended only for the level; they also stay separate as features.
        combined_raw = (0.65 * physio + 0.35 * pheno) if st.pheno_ewma is not None and st.physio_ewma is not None else physio
        st.combined_ewma = combined_raw
        st.samples.append((t, combined_raw))

        st.n += 1
        delta = combined_raw - st.mean
        st.mean += delta / st.n
        st.m2 += delta * (combined_raw - st.mean)

        scale = self._scale(st)
        z = (combined_raw - base) / scale
        st.cusum = max(0.0, st.cusum + (z - CONTEXT_CUSUM_K))
        return self.snapshot(user_id, baseline=base)

    @staticmethod
    def _scale(st: _UserState) -> float:
        if st.n < 8:
            return max(CONTEXT_MIN_SCALE, 0.15)
        return max(CONTEXT_MIN_SCALE, math.sqrt(st.m2 / max(1, st.n - 1)))

    def _slope_per_min(self, st: _UserState) -> float:
        if len(st.samples) < 3:
            return 0.0
        now = st.samples[-1][0]
        window = [(t, v) for t, v in st.samples if now - t <= CONTEXT_SLOPE_WINDOW_SEC]
        if len(window) < 3:
            return 0.0
        ts = np.array([t - now for t, _ in window], dtype=float)
        vs = np.array([v for _, v in window], dtype=float)
        if np.ptp(ts) < 1e-6:
            return 0.0
        slope_per_sec = float(np.polyfit(ts, vs, 1)[0])
        return slope_per_sec * 60.0

    def snapshot(self, user_id: str, baseline: Optional[float] = None) -> Dict:
        st = self._state(user_id)
        base = DEFAULT_BASELINE if baseline is None else float(baseline)
        if st.combined_ewma is None:
            return {
                "ready": False,
                "baseline": base,
                "vector": default_context_vector(base, base),
                "combined": base,
            }
        physio = st.physio_ewma if st.physio_ewma is not None else st.pheno_ewma
        pheno = st.pheno_ewma if st.pheno_ewma is not None else st.physio_ewma
        scale = self._scale(st)
        z = (st.combined_ewma - base) / scale
        slope = self._slope_per_min(st)
        disagreement = (physio - pheno) if (st.physio_ewma is not None and st.pheno_ewma is not None) else 0.0
        return {
            "ready": True,
            "baseline": base,
            "scale": scale,
            "combined": st.combined_ewma,
            "z_rel": z,
            "slope_per_min": slope,
            "physio": physio,
            "pheno": pheno,
            "disagreement": disagreement,
            "has_both_streams": st.physio_ewma is not None and st.pheno_ewma is not None,
            "rise_alarm": st.cusum > CONTEXT_CUSUM_H,
            "cusum": st.cusum,
            "vector": [z, slope, physio, pheno, disagreement],
        }

    def reset_alarm(self, user_id: str) -> None:
        self._state(user_id).cusum = 0.0


context_builder = ContextBuilder()
