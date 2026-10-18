"""
Simulated population for offline evaluation of intervention policies.

IMPORTANT (state this in the thesis): the technique effects below are ASSUMED, not measured.
Natural recovery speed and noise levels are plausible values to be re-fitted on WESAD / pilot
data. Because of that, every comparison is run under several effect settings (see
`EFFECT_SETTINGS`) so conclusions do not hinge on one assumption.
"""

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import NATURAL_RECOVERY_TAU_SEC, SESSION_WINDOW_SEC

ARMS = ["breath_slow", "breath_box", "body_scan", "visual_calm", "cognitive_game", "soundscape"]
SAMPLE_SEC = 10.0

# How strongly effects depend on stress level / physio-vs-behaviour disagreement.
EFFECT_SETTINGS: Dict[str, Dict[str, float]] = {
    "weak_context": {"arm_spread": 0.20, "stress_gain": 0.10, "disagree_gain": 0.10, "user_spread": 0.10},
    "medium_context": {"arm_spread": 0.20, "stress_gain": 0.30, "disagree_gain": 0.25, "user_spread": 0.15},
    "strong_context": {"arm_spread": 0.15, "stress_gain": 0.50, "disagree_gain": 0.40, "user_spread": 0.20},
}


@dataclass
class SimUser:
    user_id: int
    baseline: float
    tau: float
    noise: float
    effects: np.ndarray            # (n_arms,) user-specific base effect in [0, 1]
    stress_gain: np.ndarray        # (n_arms,) how effect changes with stress level
    disagree_gain: np.ndarray      # (n_arms,) how effect changes with physio-pheno disagreement
    fatigue: np.ndarray            # (n_arms,) per-use fatigue strength
    use_memory: np.ndarray = field(default_factory=lambda: np.zeros(len(ARMS)))


def make_population(n_users: int, setting: str, seed: int) -> List[SimUser]:
    cfg = EFFECT_SETTINGS[setting]
    rng = np.random.default_rng(seed)
    arm_mean = np.clip(0.45 + rng.normal(0, cfg["arm_spread"], len(ARMS)), 0.1, 0.9)
    arm_stress = rng.uniform(-1, 1, len(ARMS)) * cfg["stress_gain"]
    arm_disagree = rng.uniform(-1, 1, len(ARMS)) * cfg["disagree_gain"]
    users = []
    for u in range(n_users):
        users.append(SimUser(
            user_id=u,
            baseline=float(rng.uniform(0.2, 0.4)),
            tau=float(NATURAL_RECOVERY_TAU_SEC * np.exp(rng.normal(0, 0.3))),
            noise=float(rng.uniform(0.02, 0.05)),
            effects=np.clip(arm_mean + rng.normal(0, cfg["user_spread"], len(ARMS)), 0.05, 0.95),
            stress_gain=arm_stress + rng.normal(0, 0.05, len(ARMS)),
            disagree_gain=arm_disagree + rng.normal(0, 0.05, len(ARMS)),
            fatigue=rng.uniform(0.03, 0.12, len(ARMS)),
        ))
    return users


def draw_context(user: SimUser, rng: np.random.Generator) -> Dict:
    """A pre-intervention moment: elevated stress, with the two streams not always agreeing."""
    physio = float(np.clip(user.baseline + rng.gamma(2.0, 0.14), 0.05, 0.98))
    pheno = float(np.clip(physio + rng.normal(0, 0.15), 0.02, 0.98))
    combined = 0.65 * physio + 0.35 * pheno
    scale = 0.15
    z = (combined - user.baseline) / scale
    slope = float(rng.normal(0.08, 0.15))
    return {
        "physio": physio, "pheno": pheno, "combined": combined, "baseline": user.baseline,
        "z_rel": z, "slope_per_min": slope, "disagreement": physio - pheno,
        "vector": [z, slope, physio, pheno, physio - pheno],
    }


def effect_rate(user: SimUser, arm: int, ctx: Dict) -> float:
    """Extra recovery rate (1/sec) added by a technique in this context, after fatigue."""
    e = user.effects[arm]
    e *= 1.0 + user.stress_gain[arm] * np.tanh(ctx["z_rel"] / 2.0)
    e *= 1.0 + user.disagree_gain[arm] * np.tanh(ctx["disagreement"] * 3.0)
    e *= np.exp(-user.fatigue[arm] * user.use_memory[arm])
    return float(max(0.0, e)) / 400.0


def run_session(user: SimUser, arm: int, ctx: Dict, rng: np.random.Generator,
                window: float = SESSION_WINDOW_SEC, noiseless: bool = False) -> Dict:
    """Stress trajectory for one session: exponential approach to baseline, faster with the technique."""
    s0, b = ctx["combined"], user.baseline
    rate = 1.0 / user.tau + effect_rate(user, arm, ctx)
    ts = np.arange(0.0, window + 1e-9, SAMPLE_SEC)
    clean = b + (s0 - b) * np.exp(-rate * ts)
    obs = clean if noiseless else np.clip(clean + rng.normal(0, user.noise, len(ts)), 0.0, 1.0)
    improve = float(np.clip((s0 - clean[-1]) / max(1e-6, s0 - b), 0.0, 1.0))
    stars = 1 + 4 * improve + (0.0 if noiseless else rng.normal(0, 0.6))
    return {
        "t": ts, "stress": obs, "clean": clean, "stars": int(np.clip(round(stars), 1, 5)),
        "duration": float(window),
    }


def natural_session(user: SimUser, ctx: Dict, window: float = SESSION_WINDOW_SEC) -> Dict:
    s0, b = ctx["combined"], user.baseline
    ts = np.arange(0.0, window + 1e-9, SAMPLE_SEC)
    return {"t": ts, "stress": b + (s0 - b) * np.exp(-ts / user.tau)}


def register_use(user: SimUser, arm: int, decay: float = 0.8) -> None:
    user.use_memory *= decay
    user.use_memory[arm] += 1.0


def time_to_baseline(t: np.ndarray, stress: np.ndarray, baseline: float, margin: float) -> Tuple[float, bool]:
    hit = np.where(stress <= baseline + margin)[0]
    if len(hit) == 0:
        return float(t[-1]), True   # censored at the window
    return float(t[hit[0]]), False


def generate_contexts(n: int, seed: int = 0) -> np.ndarray:
    """Context vectors for training the K-means model (simulated until real sessions exist)."""
    rng = np.random.default_rng(seed)
    users = make_population(max(20, n // 40), "medium_context", seed)
    rows = []
    for i in range(n):
        u = users[i % len(users)]
        rows.append(draw_context(u, rng)["vector"])
    return np.array(rows, dtype=float)
