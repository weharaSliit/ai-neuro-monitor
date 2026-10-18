"""
Train the context K-means and choose k with evidence.

For k = 2..K_MAX the script fits K-means (k-means++, several restarts) on standardised context
vectors [z_rel, slope, physio, pheno, disagreement] and reports

  - inertia (elbow),
  - silhouette score (higher = better separated clusters),
  - Davies-Bouldin index (lower = better),
  - stability: mean adjusted Rand index between fits on bootstrap resamples (clusters that change
    with every resample are not trustworthy).

Selection rule (fixed in advance): among k whose stability >= STABILITY_MIN choose the k with the
highest silhouette; if none is stable enough, choose the most stable k.

Training data: simulated contexts by default (until real sessions are logged). Pass --csv with
rows of the five context features to train on real data instead.

Usage (from the repo root):
    python -m backend.relaxation_guide.experiments.train_context_kmeans
    python -m backend.relaxation_guide.experiments.train_context_kmeans --csv my_contexts.csv
"""

import sys
import json
import argparse
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.experiments.simulator import generate_contexts

K_MIN, K_MAX = 2, 10
STABILITY_MIN = 0.70
N_INIT = 10
N_BOOT = 20
OUT_DIR = Path(__file__).resolve().parent / "results"
MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "kmeans_context.json"


def kmeans_pp_init(X: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    centers = [X[rng.integers(len(X))]]
    for _ in range(1, k):
        d2 = np.min(((X[:, None, :] - np.array(centers)[None, :, :]) ** 2).sum(-1), axis=1)
        probs = d2 / d2.sum() if d2.sum() > 0 else np.full(len(X), 1.0 / len(X))
        centers.append(X[rng.choice(len(X), p=probs)])
    return np.array(centers)


def kmeans_fit(X: np.ndarray, k: int, seed: int, n_init: int = N_INIT, iters: int = 100):
    best = None
    for i in range(n_init):
        rng = np.random.default_rng(seed * 1000 + i)
        C = kmeans_pp_init(X, k, rng)
        for _ in range(iters):
            labels = np.argmin(((X[:, None, :] - C[None, :, :]) ** 2).sum(-1), axis=1)
            newC = np.array([X[labels == j].mean(0) if np.any(labels == j) else C[j] for j in range(k)])
            if np.allclose(newC, C, atol=1e-6):
                break
            C = newC
        labels = np.argmin(((X[:, None, :] - C[None, :, :]) ** 2).sum(-1), axis=1)
        inertia = float(((X - C[labels]) ** 2).sum())
        if best is None or inertia < best[0]:
            best = (inertia, C, labels)
    return best


def silhouette(X: np.ndarray, labels: np.ndarray) -> float:
    D = np.sqrt(((X[:, None, :] - X[None, :, :]) ** 2).sum(-1))
    ks = np.unique(labels)
    if len(ks) < 2:
        return 0.0
    s = np.zeros(len(X))
    for i in range(len(X)):
        same = labels == labels[i]
        same[i] = False
        a = D[i, same].mean() if same.any() else 0.0
        b = min(D[i, labels == k].mean() for k in ks if k != labels[i])
        s[i] = 0.0 if max(a, b) == 0 else (b - a) / max(a, b)
    return float(s.mean())


def davies_bouldin(X: np.ndarray, labels: np.ndarray, C: np.ndarray) -> float:
    k = len(C)
    S = np.array([np.sqrt(((X[labels == j] - C[j]) ** 2).sum(1)).mean() if np.any(labels == j) else 0.0 for j in range(k)])
    worst = []
    for i in range(k):
        r = [(S[i] + S[j]) / max(1e-9, np.linalg.norm(C[i] - C[j])) for j in range(k) if j != i]
        worst.append(max(r))
    return float(np.mean(worst))


def adjusted_rand(a: np.ndarray, b: np.ndarray) -> float:
    ka, kb = np.unique(a), np.unique(b)
    table = np.array([[np.sum((a == i) & (b == j)) for j in kb] for i in ka], dtype=float)
    comb = lambda n: n * (n - 1) / 2.0
    sum_ij = comb(table).sum()
    sum_a = comb(table.sum(1)).sum()
    sum_b = comb(table.sum(0)).sum()
    expected = sum_a * sum_b / comb(table.sum())
    max_index = 0.5 * (sum_a + sum_b)
    return 1.0 if max_index == expected else float((sum_ij - expected) / (max_index - expected))


def stability(X: np.ndarray, k: int, C_full: np.ndarray, seed: int) -> float:
    rng = np.random.default_rng(seed)
    scores = []
    ref = np.argmin(((X[:, None, :] - C_full[None, :, :]) ** 2).sum(-1), axis=1)
    for b in range(N_BOOT):
        idx = rng.integers(0, len(X), len(X))
        _, C_b, _ = kmeans_fit(X[idx], k, seed + b + 1, n_init=3)
        lab_b = np.argmin(((X[:, None, :] - C_b[None, :, :]) ** 2).sum(-1), axis=1)
        scores.append(adjusted_rand(ref, lab_b))
    return float(np.mean(scores))


def choose_k(rows: List[Dict]) -> int:
    stable = [r for r in rows if r["stability_ari"] >= STABILITY_MIN]
    if stable:
        return max(stable, key=lambda r: r["silhouette"])["k"]
    return max(rows, key=lambda r: r["stability_ari"])["k"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="CSV of real context vectors (5 columns, no header)")
    ap.add_argument("--n", type=int, default=1200, help="simulated contexts when no CSV is given")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--k", type=int, help="pin k (e.g. after the policy-vs-k experiment) instead of the selection rule")
    args = ap.parse_args()

    if args.csv:
        X_raw = np.loadtxt(args.csv, delimiter=",")
        source = f"csv:{args.csv}"
    else:
        X_raw = generate_contexts(args.n, args.seed)
        source = "simulated"
    mean, std = X_raw.mean(0), X_raw.std(0)
    std = np.where(std < 1e-9, 1.0, std)
    X = (X_raw - mean) / std

    rows, fits = [], {}
    for k in range(K_MIN, K_MAX + 1):
        inertia, C, labels = kmeans_fit(X, k, args.seed)
        fits[k] = (C, labels)
        rows.append({
            "k": k,
            "inertia": inertia,
            "silhouette": silhouette(X, labels),
            "davies_bouldin": davies_bouldin(X, labels, C),
            "stability_ari": stability(X, k, C, args.seed),
        })
        print(f"k={k:2d}  inertia={inertia:8.1f}  silhouette={rows[-1]['silhouette']:.3f}  "
              f"DB={rows[-1]['davies_bouldin']:.3f}  stability(ARI)={rows[-1]['stability_ari']:.3f}")

    k_star = args.k if args.k else choose_k(rows)
    C_star, labels_star = fits[k_star]
    sizes = np.bincount(labels_star, minlength=k_star).tolist()

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "k": k_star,
            "centroids": C_star.tolist(),
            "mean": mean.tolist(),
            "std": std.tolist(),
            "features": ["z_rel", "slope_per_min", "physio", "pheno", "disagreement"],
            "training_source": source,
            "n_samples": int(len(X)),
            "cluster_sizes": sizes,
            "selection_rule": ("pinned by --k" if args.k else f"highest silhouette among k with stability ARI >= {STABILITY_MIN}"),
        }, f, indent=2)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / "kmeans_selection.json", "w", encoding="utf-8") as f:
        json.dump({"chosen_k": k_star, "source": source, "rows": rows}, f, indent=2)

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        ks = [r["k"] for r in rows]
        fig, ax = plt.subplots(1, 4, figsize=(15, 3.2))
        for a, key, title in zip(ax, ["inertia", "silhouette", "davies_bouldin", "stability_ari"],
                                 ["Inertia (elbow)", "Silhouette (higher = better)",
                                  "Davies-Bouldin (lower = better)", "Stability, bootstrap ARI"]):
            a.plot(ks, [r[key] for r in rows], marker="o")
            a.axvline(k_star, color="red", linestyle="--", linewidth=1)
            a.set_title(title, fontsize=9)
            a.set_xlabel("k")
        ax[3].axhline(STABILITY_MIN, color="gray", linestyle=":", linewidth=1)
        fig.suptitle(f"Choosing k for the context K-means (chosen k = {k_star})", fontsize=10)
        fig.tight_layout()
        fig.savefig(OUT_DIR / "kmeans_selection.png", dpi=150)
        print("figure:", OUT_DIR / "kmeans_selection.png")
    except Exception as e:  # plotting is optional
        print("plot skipped:", e)

    print(f"\nChosen k = {k_star}, cluster sizes = {sizes}\nModel saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()
