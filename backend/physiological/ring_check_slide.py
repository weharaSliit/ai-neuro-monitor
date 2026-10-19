# ============================================================
# ring_check_slide.py -- one slide-ready diagram of the ring proof of concept
# (four panels, 16:9) from a ring check run saved by psy_web's Ring check tab.
#
#   python backend/physiological/ring_check_slide.py --user ringcheck01 [--run run_...]
#
# Writes output/ring_check/<run>/slide_validation.png. All numbers come from the run
# (same analysis as ring_check_report.py).
# ============================================================
import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ring_check_report as rc  # noqa: E402

NAVY, TEAL, PURPLE, ORANGE, RED, GREY = "#1f2a44", "#4a9a8a", "#7c6fb8", "#e08a3c", "#d6453d", "#9aa5b1"


def card(ax, title, big, sub):
    ax.set_facecolor("#f6faf9")
    for sp in ax.spines.values():
        sp.set_color("#cfe3de")
    pos = ax.get_position()
    fig = ax.figure
    fig.text(pos.x0, pos.y1 + 0.108, title, fontsize=13, fontweight="bold", color=NAVY, va="bottom")
    fig.text(pos.x0, pos.y1 + 0.050, big, fontsize=22, fontweight="bold", color=TEAL, va="bottom")
    fig.text(pos.x0, pos.y1 + 0.012, sub, fontsize=10, color="#55606e", va="bottom")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    ap.add_argument("--run")
    ap.add_argument("--file")
    args = ap.parse_args()
    run = rc.load_run(args)
    run.setdefault("user_id", args.user)
    samples = rc.parse_samples(run.get("samples_csv"))
    wins = rc.load_windows(run, run["user_id"])
    pairs = rc.pair_up(run, wins, samples)
    ag = rc.agree(pairs, "live")
    rows = {r["step"]: r for r in rc.step_rows(run, wins, samples)}
    out = rc.OUT / run["id"]
    out.mkdir(parents=True, exist_ok=True)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.family": "DejaVu Sans"})
    fig, axes = plt.subplots(2, 2, figsize=(13.33, 7.0))
    fig.subplots_adjust(left=0.06, right=0.97, top=0.78, bottom=0.09, hspace=0.95, wspace=0.28)
    a1, a2, a3, a4 = axes.ravel()

    # 1. agreement with the Heart Rate app
    card(a1, "Heart rate agrees with a reference app", f"r = {ag['r']:.2f}",
         f"mean error {ag['mae']:.1f} bpm  ·  {ag['n']} readings  ·  ring vs Heart Rate app")
    p = [r for r in pairs if r["live"] is not None]
    x = np.array([r["ref"] for r in p], float)
    y = np.array([r["live"] for r in p], float)
    lo, hi = min(x.min(), y.min()) - 6, max(x.max(), y.max()) + 6
    a1.plot([lo, hi], [lo, hi], "--", color=GREY, lw=1.2)
    a1.fill_between([lo, hi], [lo - 5, hi - 5], [lo + 5, hi + 5], color=TEAL, alpha=0.12, lw=0)
    a1.scatter(x, y, s=70, color=TEAL, edgecolor="white", zorder=3)
    a1.set_xlim(lo, hi)
    a1.set_ylim(lo, hi)
    a1.set_xlabel("Heart Rate app (bpm)")
    a1.set_ylabel("Ring (bpm)")
    a1.text(0.97, 0.05, "shaded band = within 5 bpm", transform=a1.transAxes, ha="right", fontsize=9, color="#55606e")

    # 2. walking raises heart rate
    rest, walk = rows["rest"]["hr_live"], rows["walk"]["hr_live"]
    card(a2, "Heart rate rises when walking", f"+{walk - rest:.0f} bpm", "walking vs resting, ring live beats")
    bars = a2.bar(["Rest", "Walk"], [rest, walk], color=[GREY, ORANGE], width=0.55)
    for b, v in zip(bars, (rest, walk)):
        a2.text(b.get_x() + b.get_width() / 2, v + 4, f"{v:.0f}", ha="center", fontsize=13, fontweight="bold", color=NAVY)
    a2.set_ylim(0, max(rest, walk) * 1.25)
    a2.set_ylabel("Heart rate (bpm)")

    # 3. shaking the hand: windows withheld
    sh = rows["shake"]
    n_exp, n_kept = sh["windows_expected"], sh["windows_kept"]
    card(a3, "Hand shaking is rejected", f"{n_exp - n_kept} of {n_exp} windows", "withheld by the motion quality gate")
    a3.set_xlim(0, n_exp)
    a3.set_ylim(0, 1)
    a3.axis("off")
    for i in range(n_exp):
        kept = i < n_kept
        a3.add_patch(plt.Rectangle((i + 0.08, 0.3), 0.84, 0.42, color=TEAL if kept else "#f3d4d1", ec=RED if not kept else TEAL, lw=1.5))
        if not kept:
            a3.plot([i + 0.25, i + 0.75], [0.4, 0.62], color=RED, lw=2.5)
            a3.plot([i + 0.25, i + 0.75], [0.62, 0.4], color=RED, lw=2.5)
    a3.text(n_exp / 2, 0.12, f"peak movement {sh['acc_peak']:.1f} g  ·  each box = one 60 s window", ha="center", fontsize=10, color="#55606e")

    # 4. finger off: skin conductance collapses
    st = {s_["key"]: s_ for s_ in run["steps"]}
    med = lambda k: float(np.median([x["us"] for x in samples if st[k]["start"] <= x["t"] <= st[k]["end"] and x["us"] is not None]))
    before, off = med("settle2"), med("off")     # median over each step: robust to the brief spikes
    card(a4, "Taking the ring off is detected", f"{before:.1f} → {off:.1f} µS", "skin conductance, median of the last still step → median with the ring off")
    t_a, t_b = st["settle2"]["start"], run["ended_at"]
    seg = [s for s in samples if t_a <= s["t"] <= t_b and s["us"] is not None]
    tt = [(s["t"] - t_a) / 1000 for s in seg]
    a4.axvspan((st["off"]["start"] - t_a) / 1000, (t_b - t_a) / 1000, color="#f3d4d1", alpha=0.7, lw=0)
    a4.plot(tt, [s["us"] for s in seg], color=PURPLE, lw=2)
    a4.text((st["off"]["start"] - t_a) / 1000 + 38, a4.get_ylim()[1] * 0.55, "ring off", color=RED, fontsize=12, fontweight="bold", va="center")
    a4.set_xlabel("seconds")
    a4.set_ylabel("Skin conductance (µS)")
    a4.set_ylim(0, max(s["us"] for s in seg) * 1.15)

    fig.suptitle("HRV / GSR ring: proof of concept", fontsize=18, fontweight="bold", color=NAVY, x=0.06, ha="left", y=0.975)
    fig.savefig(out / "slide_validation.png", dpi=200, facecolor="white")
    print(f"Saved {out / 'slide_validation.png'}")


if __name__ == "__main__":
    main()
