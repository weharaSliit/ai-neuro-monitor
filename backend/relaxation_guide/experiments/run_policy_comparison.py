"""
Offline comparison of intervention policies on a simulated population.

All policies see the SAME users, the SAME stress episodes (contexts) and the SAME noise, so the
comparison is paired. Learners are trained with the reward computed by the real reward module
(services/reward.py) from the noisy stress trajectory, exactly as in the app.

Outcomes are judged on the noiseless true trajectory, independent of any reward:
  reduction   = 1 - (excess stress area with technique / excess stress area with natural recovery)
  time_to_base= seconds until stress is within the margin of the user's baseline (censored at window)
  regret      = reduction of the best technique (oracle) minus reduction of the chosen one

Policies
  random, fixed_best, threshold_rules   - reference points (threshold_rules = the old hand-set cut-offs)
  ts_bins10                              - Thompson Sampling on 10 fixed stress bins (previous system)
  ts_kmeans                              - Thompson Sampling on trained K-means clusters
  lin_ts, lin_ucb                        - continuous-context bandits (no clusters)
  hybrid                                 - PROPOSED: cluster prior + continuous linear TS + adaptive habituation
  hybrid_no_adapt_habit                  - ablation: hybrid without the adaptive habituation penalty
  hybrid_old_reward                      - ablation: hybrid trained with the old state-transition reward

Usage (repo root):
    python -m backend.relaxation_guide.experiments.run_policy_comparison
    python -m backend.relaxation_guide.experiments.run_policy_comparison --seeds 20 --users 30 --sessions 40
    python -m backend.relaxation_guide.experiments.run_policy_comparison --k-sweep
"""

import sys
import json
import argparse
import time
from pathlib import Path
from typing import Callable, Dict, List

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import BASELINE_MARGIN
from backend.relaxation_guide.experiments import simulator as sim
from backend.relaxation_guide.experiments.train_context_kmeans import kmeans_fit
from backend.relaxation_guide.services.contextual_policy import ContextualPolicy, linear_features
from backend.relaxation_guide.services.kmeans_clusterer import kmeans_clusterer
from backend.relaxation_guide.services.reward import compute_reward, prepare_trajectory
from backend.relaxation_guide.services.validator import RewardValidator

OUT_DIR = Path(__file__).resolve().parent / "results"
ARMS = sim.ARMS
N_ARMS = len(ARMS)
_old_reward = RewardValidator()


# ---------------------------------------------------------------- policies
class RandomPolicy:
    name = "random"

    def __init__(self, seed): self.rng = np.random.default_rng(seed)
    def select(self, ctx, now): return int(self.rng.integers(N_ARMS))
    def update(self, ctx, arm, reward, now): pass


class FixedPolicy:
    name = "fixed_best"

    def __init__(self, arm): self.arm = arm
    def select(self, ctx, now): return self.arm
    def update(self, ctx, arm, reward, now): pass


class ThresholdRules:
    """The old style of decision: hand-set stress cut-offs, each mapped to a fixed technique."""
    name = "threshold_rules"

    def select(self, ctx, now):
        s = ctx["combined"]
        if s >= 0.75: return 0
        if s >= 0.60: return 1
        if s >= 0.45: return 2
        if s >= 0.30: return 3
        return 4

    def update(self, ctx, arm, reward, now): pass


class BetaClusterPolicy:
    """Thompson Sampling with Beta beliefs per cluster (the previous system's core)."""

    def __init__(self, name, cluster_fn: Callable[[Dict], int], seed):
        self.name = name
        self.cluster_fn = cluster_fn
        self.rng = np.random.default_rng(seed)
        self.dists: Dict[int, np.ndarray] = {}

    def _d(self, c):
        if c not in self.dists:
            self.dists[c] = np.ones((N_ARMS, 2))
        return self.dists[c]

    def select(self, ctx, now):
        d = self._d(self.cluster_fn(ctx))
        return int(np.argmax(self.rng.beta(d[:, 0], d[:, 1])))

    def update(self, ctx, arm, reward, now):
        d = self._d(self.cluster_fn(ctx))
        d[arm, 0] += reward
        d[arm, 1] += 1.0 - reward


class LinTS:
    name = "lin_ts"

    def __init__(self, seed, lam=2.0, v=0.25):
        self.rng = np.random.default_rng(seed)
        self.v = v
        self.A = [lam * np.eye(6) for _ in range(N_ARMS)]
        self.b = [np.zeros(6) for _ in range(N_ARMS)]

    def select(self, ctx, now):
        x = linear_features(ctx["vector"])
        scores = []
        for a in range(N_ARMS):
            Ai = np.linalg.inv(self.A[a])
            theta = self.rng.multivariate_normal(Ai @ self.b[a], self.v ** 2 * (Ai + Ai.T) / 2)
            scores.append(x @ theta)
        return int(np.argmax(scores))

    def update(self, ctx, arm, reward, now):
        x = linear_features(ctx["vector"])
        self.A[arm] += np.outer(x, x)
        self.b[arm] += reward * x


class LinUCB:
    name = "lin_ucb"

    def __init__(self, alpha=0.5, lam=2.0):
        self.alpha = alpha
        self.A = [lam * np.eye(6) for _ in range(N_ARMS)]
        self.b = [np.zeros(6) for _ in range(N_ARMS)]

    def select(self, ctx, now):
        x = linear_features(ctx["vector"])
        scores = []
        for a in range(N_ARMS):
            Ai = np.linalg.inv(self.A[a])
            scores.append(x @ Ai @ self.b[a] + self.alpha * np.sqrt(x @ Ai @ x))
        return int(np.argmax(scores))

    def update(self, ctx, arm, reward, now):
        x = linear_features(ctx["vector"])
        self.A[arm] += np.outer(x, x)
        self.b[arm] += reward * x


class HybridPolicy:
    """The proposed system: services/contextual_policy.ContextualPolicy driven by trained K-means clusters."""

    def __init__(self, name, cluster_fn, seed, adaptive_habituation=True, old_reward=False):
        self.name = name
        self.cluster_fn = cluster_fn
        self.old_reward = old_reward
        self.policy = ContextualPolicy(ARMS, seed=seed, adaptive_habituation=adaptive_habituation)

    def select(self, ctx, now):
        res = self.policy.select(self.cluster_fn(ctx), ctx["vector"], now=now)
        return ARMS.index(res["technique_id"])

    def update(self, ctx, arm, reward, now):
        self.policy.update(ARMS[arm], self.cluster_fn(ctx), ctx["vector"], reward, now=now)


# ---------------------------------------------------------------- helpers
def bin10(ctx) -> int:
    return int(min(9, max(0, ctx["combined"] * 10)))


def label_of(score: float) -> str:
    return "stress" if score >= 0.60 else "pre-stress" if score >= 0.35 else "normal"


def excess_area(t, s, base) -> float:
    y = np.maximum(0.0, np.asarray(s) - base)
    return float(np.sum((y[1:] + y[:-1]) * np.diff(t)) / 2.0)


def evaluate_arm(user, arm, ctx):
    """Noiseless outcome of using `arm` now: relative reduction vs natural recovery, time to baseline."""
    rng = np.random.default_rng(0)
    run = sim.run_session(user, arm, ctx, rng, noiseless=True)
    nat = sim.natural_session(user, ctx)
    a_obs = excess_area(run["t"], run["clean"], user.baseline)
    a_nat = excess_area(nat["t"], nat["stress"], user.baseline)
    reduction = 1.0 - a_obs / max(1e-9, a_nat)
    ttb, _ = sim.time_to_baseline(run["t"], run["clean"], user.baseline, BASELINE_MARGIN)
    return reduction, ttb


def reward_for(policy, user, ctx, run, arm) -> float:
    if getattr(policy, "old_reward", False):
        r, _, _ = _old_reward.compute_reward_and_recovery(
            label_of(ctx["combined"]), label_of(float(np.mean(run["stress"][-3:]))), run["stars"], run["duration"])
        return float(np.clip(r, 0.0, 1.0))
    traj = prepare_trajectory(list(zip(run["t"], run["stress"])))
    return compute_reward(traj, user.baseline, run["stars"])["reward"]


def best_fixed_arm(setting: str, seed: int) -> int:
    users = sim.make_population(40, setting, seed + 999)
    rng = np.random.default_rng(seed + 999)
    scores = np.zeros(N_ARMS)
    for u in users:
        for _ in range(5):
            ctx = sim.draw_context(u, rng)
            for a in range(N_ARMS):
                scores[a] += evaluate_arm(u, a, ctx)[0]
    return int(np.argmax(scores))


def run_one(setting: str, seed: int, n_users: int, n_sessions: int, policy_names: List[str],
            cluster_fn_kmeans) -> Dict[str, Dict[str, np.ndarray]]:
    fixed_arm = best_fixed_arm(setting, seed)
    results = {p: {"reduction": np.zeros((n_users, n_sessions)),
                   "ttb": np.zeros((n_users, n_sessions)),
                   "regret": np.zeros((n_users, n_sessions)),
                   "distinct": np.zeros(n_users)} for p in policy_names}
    for pname in policy_names:
        users = sim.make_population(n_users, setting, seed)
        for ui, user in enumerate(users):
            ctx_rng = np.random.default_rng(seed * 100003 + ui)
            policy = make_policy(pname, seed * 31 + ui, fixed_arm, cluster_fn_kmeans)
            used = set()
            for t in range(n_sessions):
                now = 1.0e9 + t * 6 * 3600.0           # a session every ~6 hours
                ctx = sim.draw_context(user, ctx_rng)
                arm = policy.select(ctx, now)
                noise_rng = np.random.default_rng(seed * 7919 + ui * 131 + t)
                run = sim.run_session(user, arm, ctx, noise_rng)
                policy.update(ctx, arm, reward_for(policy, user, ctx, run, arm), now)

                outcomes = [evaluate_arm(user, a, ctx) for a in range(N_ARMS)]
                red, ttb = outcomes[arm]
                results[pname]["reduction"][ui, t] = red
                results[pname]["ttb"][ui, t] = ttb
                results[pname]["regret"][ui, t] = max(o[0] for o in outcomes) - red
                used.add(arm)
                sim.register_use(user, arm)
            results[pname]["distinct"][ui] = len(used)
    return results


def make_policy(name: str, seed: int, fixed_arm: int, cluster_fn_kmeans):
    if name == "random": return RandomPolicy(seed)
    if name == "fixed_best": return FixedPolicy(fixed_arm)
    if name == "threshold_rules": return ThresholdRules()
    if name == "ts_bins10": return BetaClusterPolicy("ts_bins10", bin10, seed)
    if name == "ts_kmeans": return BetaClusterPolicy("ts_kmeans", cluster_fn_kmeans, seed)
    if name == "lin_ts": return LinTS(seed)
    if name == "lin_ucb": return LinUCB()
    if name == "hybrid": return HybridPolicy("hybrid", cluster_fn_kmeans, seed)
    if name == "hybrid_no_adapt_habit": return HybridPolicy(name, cluster_fn_kmeans, seed, adaptive_habituation=False)
    if name == "hybrid_old_reward": return HybridPolicy(name, cluster_fn_kmeans, seed, old_reward=True)
    raise ValueError(name)


# ---------------------------------------------------------------- statistics
def mean_ci(x: np.ndarray):
    x = np.asarray(x, dtype=float)
    m = x.mean()
    if len(x) < 2:
        return m, m, m
    half = 1.96 * x.std(ddof=1) / np.sqrt(len(x))
    return m, m - half, m + half


def paired_p(a: np.ndarray, b: np.ndarray) -> float:
    try:
        from scipy.stats import wilcoxon
        if np.allclose(a, b):
            return 1.0
        return float(wilcoxon(a, b).pvalue)
    except Exception:
        return float("nan")


def summarize(per_seed: List[Dict], policy_names: List[str], n_late: int):
    """per_seed: list over seeds of results dict. Metrics use the last n_late sessions (after learning)."""
    rows = {}
    for p in policy_names:
        red = np.array([r[p]["reduction"][:, -n_late:].mean() for r in per_seed])
        ttb = np.array([r[p]["ttb"][:, -n_late:].mean() for r in per_seed])
        reg = np.array([r[p]["regret"].sum(axis=1).mean() for r in per_seed])   # cumulative per user
        dist = np.array([r[p]["distinct"].mean() for r in per_seed])
        rows[p] = {"reduction": red, "ttb": ttb, "regret": reg, "distinct": dist}
    return rows


def format_table(rows, policy_names, ref="hybrid"):
    lines = ["| policy | stress reduction vs natural (late) | time to baseline s (late) | cumulative regret | techniques used | p vs " + ref + " |",
             "|---|---|---|---|---|---|"]
    for p in policy_names:
        r = rows[p]
        m, lo, hi = mean_ci(r["reduction"])
        tm, tlo, thi = mean_ci(r["ttb"])
        rm, rlo, rhi = mean_ci(r["regret"])
        pv = "-" if p == ref else f"{paired_p(r['reduction'], rows[ref]['reduction']):.3g}"
        lines.append(f"| {p} | {m:.3f} [{lo:.3f}, {hi:.3f}] | {tm:.0f} [{tlo:.0f}, {thi:.0f}] | "
                     f"{rm:.2f} [{rlo:.2f}, {rhi:.2f}] | {r['distinct'].mean():.1f} | {pv} |")
    return "\n".join(lines)


def learning_curve_plot(curves, path, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    for p, c in curves.items():
        w = 5
        sm = np.convolve(c, np.ones(w) / w, mode="valid")
        ax.plot(range(w, len(c) + 1), sm, label=p, linewidth=2.2 if p == "hybrid" else 1.2)
    ax.set_xlabel("session number")
    ax.set_ylabel("stress reduction beyond natural recovery")
    ax.set_title(title, fontsize=10)
    ax.legend(fontsize=7, ncol=2)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=8)
    ap.add_argument("--users", type=int, default=15)
    ap.add_argument("--sessions", type=int, default=40)
    ap.add_argument("--k-sweep", action="store_true", help="vary the number of K-means clusters for the hybrid policy")
    ap.add_argument("--settings", nargs="*", default=list(sim.EFFECT_SETTINGS))
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    n_late = max(5, args.sessions // 4)

    if args.k_sweep:
        run_k_sweep(args, n_late)
        return

    policy_names = ["random", "fixed_best", "threshold_rules", "ts_bins10", "ts_kmeans",
                    "lin_ts", "lin_ucb", "hybrid", "hybrid_no_adapt_habit", "hybrid_old_reward"]
    km = lambda ctx: kmeans_clusterer.predict_cluster(ctx["vector"])
    print(f"K-means model: k={kmeans_clusterer.k}, trained={kmeans_clusterer.is_trained}")

    report = ["# Policy comparison (simulated population)\n",
              f"seeds={args.seeds}, users/seed={args.users}, sessions/user={args.sessions}; "
              f"'late' = last {n_late} sessions. Values: mean [95% CI over seeds].\n",
              "Technique effects are ASSUMED (simulation). Higher reduction / lower time / lower regret is better.\n"]
    all_json = {}
    for setting in args.settings:
        t0 = time.time()
        per_seed = [run_one(setting, s, args.users, args.sessions, policy_names, km) for s in range(args.seeds)]
        rows = summarize(per_seed, policy_names, n_late)
        table = format_table(rows, policy_names)
        print(f"\n=== {setting} ({time.time() - t0:.0f}s) ===\n{table}")
        report += [f"\n## {setting}\n", table + "\n"]
        curves = {p: np.mean([r[p]["reduction"].mean(axis=0) for r in per_seed], axis=0) for p in policy_names}
        try:
            learning_curve_plot(curves, OUT_DIR / f"learning_curve_{setting}.png",
                                f"Learning curves ({setting})")
        except Exception as e:
            print("plot skipped:", e)
        all_json[setting] = {p: {k: v.tolist() for k, v in rows[p].items()} for p in policy_names}

    (OUT_DIR / "policy_comparison.md").write_text("\n".join(report), encoding="utf-8")
    (OUT_DIR / "policy_comparison.json").write_text(json.dumps(all_json, indent=2), encoding="utf-8")
    print("\nSaved:", OUT_DIR / "policy_comparison.md")


def run_k_sweep(args, n_late):
    """Hybrid policy performance as a function of the number of K-means clusters."""
    ks = [1, 2, 3, 4, 6, 10]
    report = ["# Hybrid policy vs number of clusters k (simulated)\n"]
    X_raw = sim.generate_contexts(1200, 7)
    mean, std = X_raw.mean(0), np.where(X_raw.std(0) < 1e-9, 1.0, X_raw.std(0))
    Xs = (X_raw - mean) / std
    for setting in args.settings:
        rows = {}
        for k in ks:
            if k == 1:
                fn = lambda ctx: 0
            else:
                _, C, _ = kmeans_fit(Xs, k, 7, n_init=5)
                fn = (lambda C_: (lambda ctx: int(np.argmin(np.linalg.norm(
                    C_ - (np.array(ctx["vector"]) - mean) / std, axis=1)))))(C)
            per_seed = []
            for s in range(args.seeds):
                users_results = run_one(setting, s, args.users, args.sessions, ["hybrid"], fn)
                per_seed.append(users_results)
            rows[k] = summarize(per_seed, ["hybrid"], n_late)["hybrid"]
        lines = [f"\n## {setting}\n", "| k | reduction (late) | cumulative regret |", "|---|---|---|"]
        for k in ks:
            m, lo, hi = mean_ci(rows[k]["reduction"])
            rm, rlo, rhi = mean_ci(rows[k]["regret"])
            lines.append(f"| {k} | {m:.3f} [{lo:.3f}, {hi:.3f}] | {rm:.2f} [{rlo:.2f}, {rhi:.2f}] |")
        print("\n".join(lines))
        report += lines
    (OUT_DIR / "k_sweep.md").write_text("\n".join(report), encoding="utf-8")
    print("Saved:", OUT_DIR / "k_sweep.md")


if __name__ == "__main__":
    main()
