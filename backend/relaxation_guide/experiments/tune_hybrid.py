"""
Tune the hybrid policy's hand-set hyper-parameters on TUNING seeds (disjoint from the evaluation
seeds used in run_policy_comparison.py), so the reported comparison is not tuned on its own test data.

Grid:  SHRINKAGE_N0 (how fast the continuous model takes over from the cluster prior)
       HABIT_USE_COEF (penalty per recent use)  and  HABIT_DECLINE_GAIN (penalty for declining reward)
Score: mean stress reduction beyond natural recovery in late sessions, averaged over the effect settings.

Usage (repo root):  python -m backend.relaxation_guide.experiments.tune_hybrid
"""

import sys
import json
import itertools
from pathlib import Path

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.experiments import run_policy_comparison as rpc
from backend.relaxation_guide.experiments import simulator as sim
from backend.relaxation_guide.services import contextual_policy as cp
from backend.relaxation_guide.services.kmeans_clusterer import kmeans_clusterer

TUNE_SEEDS = [1000, 1001, 1002, 1003]
N_USERS, N_SESSIONS, N_LATE = 15, 40, 10
GRID = {
    "SHRINKAGE_N0": [2.0, 4.0, 8.0],
    "HABIT_USE_COEF": [0.0, 0.01, 0.03],
    "HABIT_DECLINE_GAIN": [0.0, 1.0],
}
OUT = Path(__file__).resolve().parent / "results" / "hybrid_tuning.json"


def score(params) -> float:
    for k, v in params.items():
        setattr(cp, k, v)
    km = lambda ctx: kmeans_clusterer.predict_cluster(ctx["vector"])
    vals = []
    for setting in sim.EFFECT_SETTINGS:
        for s in TUNE_SEEDS:
            res = rpc.run_one(setting, s, N_USERS, N_SESSIONS, ["hybrid"], km)
            vals.append(res["hybrid"]["reduction"][:, -N_LATE:].mean())
    return float(np.mean(vals))


def main():
    keys = list(GRID)
    rows = []
    for combo in itertools.product(*[GRID[k] for k in keys]):
        params = dict(zip(keys, combo))
        sc = score(params)
        rows.append({**params, "score": sc})
        print(params, f"-> {sc:.4f}")
    best = max(rows, key=lambda r: r["score"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"best": best, "grid": rows, "tune_seeds": TUNE_SEEDS}, indent=2), encoding="utf-8")
    print("\nBest:", best)


if __name__ == "__main__":
    main()
