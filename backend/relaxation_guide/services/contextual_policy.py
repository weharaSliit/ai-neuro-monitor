"""
Contextual personalised policy for the relaxation guide.

Decision = shrinkage between two Thompson-Sampling views of the same question
"how well will technique t work for this user, right now?":

  * cluster view    - Beta(alpha, beta) belief per (user, context cluster, technique)
                      (what the system already learned; good with little data)
  * continuous view - Bayesian linear model per (user, technique) on the continuous context
                      [1, z_rel, slope, physio, pheno, disagreement]
                      (no bins / no thresholds; good once data accumulates)

The weight of the continuous view grows with the user's own data for that technique:
    w = n / (n + N0)          (cold start -> cluster prior; more data -> continuous model)

On top of that, an ADAPTIVE habituation penalty replaces the fixed "10% after 5 uses" rule:
it grows with recent (time-decayed) use and with a falling reward trend of that technique.

This module is pure numpy (no Firebase / DB) so it can be tested and simulated offline.
State can be saved and restored with to_dict() / from_dict().
"""

import sys
import time
from collections import deque
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import (
    LINTS_PRIOR_LAMBDA,
    LINTS_NOISE_V,
    SHRINKAGE_N0,
    HABIT_HALF_LIFE_HOURS,
    HABIT_USE_COEF,
    HABIT_DECLINE_GAIN,
    HABIT_MAX_PENALTY,
    WEIGHT_PHYSIO,
    WEIGHT_PREF,
)


def linear_features(vector: Sequence[float]) -> np.ndarray:
    """[z_rel, slope, physio, pheno, disagreement] -> bounded design vector with intercept."""
    z, slope, physio, pheno, dis = [float(v) for v in vector]
    return np.array([
        1.0,
        float(np.clip(z, -3.0, 3.0)) / 3.0,
        float(np.clip(slope, -0.5, 0.5)) * 2.0,
        float(np.clip(physio, 0.0, 1.0)),
        float(np.clip(pheno, 0.0, 1.0)),
        float(np.clip(dis, -1.0, 1.0)),
    ])


class _LinearArm:
    def __init__(self, dim: int, lam: float = LINTS_PRIOR_LAMBDA):
        self.A = lam * np.eye(dim)
        self.b = np.zeros(dim)
        self.n = 0

    def posterior(self):
        A_inv = np.linalg.inv(self.A)
        return A_inv @ self.b, A_inv

    def sample_reward(self, x: np.ndarray, rng: np.random.Generator) -> float:
        mu, A_inv = self.posterior()
        cov = (LINTS_NOISE_V ** 2) * (A_inv + A_inv.T) / 2.0
        theta = rng.multivariate_normal(mu, cov)
        return float(x @ theta)

    def mean_reward(self, x: np.ndarray) -> float:
        mu, _ = self.posterior()
        return float(x @ mu)

    def update(self, x: np.ndarray, reward: float) -> None:
        self.A += np.outer(x, x)
        self.b += reward * x
        self.n += 1


class ContextualPolicy:
    def __init__(self, arms: Sequence[str], seed: Optional[int] = None, adaptive_habituation: bool = True):
        self.arms = list(arms)
        self.dim = 6
        self.rng = np.random.default_rng(seed)
        self.adaptive_habituation = adaptive_habituation
        self.beta: Dict[int, Dict[str, Dict[str, float]]] = {}
        self.linear: Dict[str, _LinearArm] = {a: _LinearArm(self.dim) for a in self.arms}
        self.events: Dict[str, deque] = {a: deque(maxlen=30) for a in self.arms}   # (timestamp, reward)

    # ---------- cluster (Beta) view ----------
    def _beta_for(self, cluster_id: int) -> Dict[str, Dict[str, float]]:
        if cluster_id not in self.beta:
            self.beta[cluster_id] = {a: {"alpha": 1.0, "beta": 1.0} for a in self.arms}
        for a in self.arms:
            self.beta[cluster_id].setdefault(a, {"alpha": 1.0, "beta": 1.0})
        return self.beta[cluster_id]

    # ---------- adaptive habituation ----------
    def habituation_penalty(self, arm: str, now: float) -> float:
        ev = self.events[arm]
        if not ev:
            return 0.0
        half_life = HABIT_HALF_LIFE_HOURS * 3600.0
        decayed_use = sum(0.5 ** (max(0.0, now - ts) / half_life) for ts, _ in ev)
        rewards = [r for _, r in ev]
        decline = 0.0
        if len(rewards) >= 4:
            recent = float(np.mean(rewards[-3:]))
            earlier = float(np.mean(rewards[max(0, len(rewards) - 8):-3]))
            decline = max(0.0, earlier - recent)
        use_term = HABIT_USE_COEF * decayed_use
        decline_term = HABIT_DECLINE_GAIN * decline * min(1.0, decayed_use / 3.0)
        return float(min(HABIT_MAX_PENALTY, use_term + decline_term))

    # ---------- decision ----------
    def select(
        self,
        cluster_id: int,
        vector: Sequence[float],
        now: Optional[float] = None,
        exclude: Optional[Sequence[str]] = None,
        pref_scores: Optional[Dict[str, float]] = None,
        cluster_dists: Optional[Dict[str, Dict[str, float]]] = None,
        boosts: Optional[Dict[str, float]] = None,
    ) -> Dict:
        now = time.time() if now is None else now
        x = linear_features(vector)
        dists = cluster_dists if cluster_dists is not None else self._beta_for(cluster_id)
        excluded = set(exclude or [])
        known = [a for a in self.arms if a in dists]
        candidates = [a for a in known if a not in excluded] or known
        pref_scores = pref_scores or {}
        boosts = boosts or {}

        details = {}
        best, best_score = None, -1e9
        for a in candidates:
            alpha = dists[a]["alpha"] + boosts.get(a, 0.0)
            s_cluster = float(self.rng.beta(max(0.1, alpha), max(0.1, dists[a]["beta"])))
            n = self.linear[a].n
            w = n / (n + SHRINKAGE_N0)
            s_linear = float(np.clip(self.linear[a].sample_reward(x, self.rng), 0.0, 1.0))
            s_ctx = (1.0 - w) * s_cluster + w * s_linear
            pref = float(pref_scores.get(a, 0.5))
            blended = WEIGHT_PHYSIO * s_ctx + WEIGHT_PREF * pref
            pen = self.habituation_penalty(a, now) if self.adaptive_habituation else 0.0
            score = blended * (1.0 - pen)
            details[a] = {
                "cluster_sample": s_cluster, "linear_sample": s_linear, "weight_continuous": w,
                "context_score": s_ctx, "preference": pref, "habituation_penalty": pen,
                "raw_score": blended, "score": score, "n_obs": n,
            }
            if score > best_score:
                best, best_score = a, score

        return {"technique_id": best, "score": best_score, "details": details,
                "reason_codes": self._reason_codes(best, details)}

    @staticmethod
    def _reason_codes(best: str, details: Dict[str, Dict]) -> List[str]:
        d = details[best]
        codes = ["learned_from_you" if d["weight_continuous"] >= 0.4 else "still_learning"]
        raw_best = max(details, key=lambda a: details[a]["raw_score"])
        if raw_best != best and details[raw_best]["habituation_penalty"] >= 0.10:
            codes.append(f"rotated_from:{raw_best}")
        elif d["habituation_penalty"] < 0.05 and d["n_obs"] > 0:
            codes.append("works_for_you")
        return codes

    # ---------- learning ----------
    def update(
        self,
        arm: str,
        cluster_id: int,
        vector: Sequence[float],
        reward: float,
        now: Optional[float] = None,
        update_beta: bool = True,
    ) -> None:
        now = time.time() if now is None else now
        reward = float(np.clip(reward, 0.0, 1.0))
        if update_beta:
            d = self._beta_for(cluster_id)[arm]
            d["alpha"] += reward
            d["beta"] += 1.0 - reward
        self.linear[arm].update(linear_features(vector), reward)
        self.events[arm].append((now, reward))

    # ---------- persistence ----------
    def to_dict(self) -> Dict:
        return {
            "arms": self.arms,
            "linear": {a: {"A": m.A.tolist(), "b": m.b.tolist(), "n": m.n} for a, m in self.linear.items()},
            "events": {a: [list(e) for e in ev] for a, ev in self.events.items()},
        }

    @classmethod
    def from_dict(cls, data: Dict, seed: Optional[int] = None) -> "ContextualPolicy":
        pol = cls(data["arms"], seed=seed)
        for a, m in data.get("linear", {}).items():
            if a in pol.linear:
                pol.linear[a].A = np.array(m["A"], dtype=float)
                pol.linear[a].b = np.array(m["b"], dtype=float)
                pol.linear[a].n = int(m["n"])
        for a, ev in data.get("events", {}).items():
            if a in pol.events:
                pol.events[a].extend((float(t), float(r)) for t, r in ev)
        return pol
