"""T1 - heart-rate agreement between the ring and a reference pulse oximeter.

Input: a CSV with columns  person, condition, reading_no, ring_hr, ref_hr
(ring_hr = the ring's MeanHR for the window; ref_hr = the oximeter's average
over the same 60 s).  See t1_log_template.csv.

    python analyze_t1.py t1_log.csv

Prints a table per condition and overall (n, bias, mean absolute error, SD of
differences, 95% limits of agreement, correlation) and saves t1_result.png
(Bland-Altman plot + scatter) and t1_result.csv.
"""
import csv
import math
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PASS_MAE = 5.0   # bpm


def load(path):
    rows = []
    with open(path, newline="", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            try:
                rows.append({"person": r["person"], "condition": r["condition"],
                             "ring": float(r["ring_hr"]), "ref": float(r["ref_hr"])})
            except (ValueError, KeyError):
                continue          # skip empty template rows
    return rows


def stats(ring, ref):
    ring, ref = np.asarray(ring), np.asarray(ref)
    d = ring - ref
    n = len(d)
    sd = d.std(ddof=1) if n > 1 else float("nan")
    r = np.corrcoef(ring, ref)[0, 1] if n > 2 else float("nan")
    return dict(n=n, bias=d.mean(), mae=np.abs(d).mean(), sd=sd,
                lo=d.mean() - 1.96 * sd if n > 1 else float("nan"),
                hi=d.mean() + 1.96 * sd if n > 1 else float("nan"), r=r)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    rows = load(sys.argv[1])
    if not rows:
        raise SystemExit("no complete rows in the file")
    conds = []
    for r in rows:
        if r["condition"] not in conds:
            conds.append(r["condition"])

    out = []
    print(f"{'Condition':24s}{'n':>4}{'bias':>8}{'MAE':>8}{'SD':>8}{'LoA low':>9}{'LoA high':>9}{'r':>7}")
    for c in conds + ["ALL"]:
        sel = rows if c == "ALL" else [r for r in rows if r["condition"] == c]
        s = stats([r["ring"] for r in sel], [r["ref"] for r in sel])
        out.append({"condition": c, **{k: round(float(v), 2) for k, v in s.items()}})
        print(f"{c:24s}{s['n']:>4}{s['bias']:>8.2f}{s['mae']:>8.2f}{s['sd']:>8.2f}"
              f"{s['lo']:>9.2f}{s['hi']:>9.2f}{s['r']:>7.2f}")
    overall = out[-1]
    verdict = "PASS" if overall["mae"] < PASS_MAE else "REVIEW"
    print(f"\nOverall mean absolute error {overall['mae']:.2f} bpm "
          f"(target < {PASS_MAE:g}) -> {verdict}")

    with open(os.path.join(HERE, "t1_result.csv"), "w", newline="", encoding="utf8") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
        wr.writeheader(); wr.writerows(out)

    ring = np.array([r["ring"] for r in rows]); ref = np.array([r["ref"] for r in rows])
    mean, diff = (ring + ref) / 2, ring - ref
    colors = {"": "#2E8B83"}
    palette = ["#2E8B83", "#6BAED6", "#F08A6B", "#7A8F5C", "#B08968"]
    fig, ax = plt.subplots(1, 2, figsize=(11, 4.6))
    for i, c in enumerate(conds):
        m = np.array([r["condition"] == c for r in rows])
        ax[0].scatter(mean[m], diff[m], s=46, color=palette[i % len(palette)], label=c)
        ax[1].scatter(ref[m], ring[m], s=46, color=palette[i % len(palette)], label=c)
    b, sd = diff.mean(), diff.std(ddof=1) if len(diff) > 1 else 0
    ax[0].axhline(b, color="#1F6D67"); ax[0].axhline(b + 1.96 * sd, ls="--", color="grey")
    ax[0].axhline(b - 1.96 * sd, ls="--", color="grey"); ax[0].axhline(0, color="#ccc", lw=0.8)
    ax[0].set(xlabel="Mean of ring and oximeter (bpm)", ylabel="Ring - oximeter (bpm)",
              title=f"Bland-Altman (bias {b:+.1f}, limits {b-1.96*sd:.1f} to {b+1.96*sd:.1f})")
    lo, hi = min(ref.min(), ring.min()) - 3, max(ref.max(), ring.max()) + 3
    ax[1].plot([lo, hi], [lo, hi], color="#999", ls="--")
    ax[1].set(xlabel="Oximeter heart rate (bpm)", ylabel="Ring heart rate (bpm)",
              title=f"Agreement (MAE {overall['mae']:.1f} bpm, r = {overall['r']:.2f})",
              xlim=(lo, hi), ylim=(lo, hi))
    ax[0].legend(fontsize=8)
    plt.tight_layout()
    plt.savefig(os.path.join(HERE, "t1_result.png"), dpi=170)
    print("saved t1_result.png and t1_result.csv")


if __name__ == "__main__":
    main()
