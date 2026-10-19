"""
Five everyday situations (SIMULATED) to verify the concept: mental demand and
physical arousal rise, fall and overlap by different amounts and gradually
(simkit.session.SITUATIONS), for several different virtual users (different
real SAM40 subjects, resting heart rate / skin level, time constants). Each
user is calibrated first exactly as the live stimulator does (four_state_session.run),
then lives through the situation; every reading is scored by the deployed
backend code and combined into the app's four states (2 of the last 3 above
each component's own limit).

  exam_revision      reading (moderate) -> hard problems (mind high, body calm) -> break
  viva_presentation  nervous wait -> presenting / questions (mind + body high) -> afterwards
  stairs_coffee      seated after stairs (body high, mind calm) -> coffee chat (moderate) -> settle
  relaxing_break     calm with a small notification bump -> must stay Relaxed (no false alarms)
  busy_workday       focused email -> deadline call -> rushing to a meeting -> lunch

  DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib venv/bin/python backend/simulation/situation_cases.py [--users 10]
Writes output/situations/situations.png, situations.md, situations.json.
"""
import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

SIM = Path(__file__).resolve().parent
sys.path.insert(0, str(SIM))
import four_state_session as fs  # noqa: E402
from simkit.session import SITUATIONS  # noqa: E402

OUT = SIM / "output" / "situations"
SEED0 = 7000


def _job(args):
    key, seed = args
    return key, fs.run(seed, plan=SITUATIONS[key]["plan"], sim_phase=lambda n: n)


def figure(examples, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    n = len(examples)
    fig, axes = plt.subplots(n * 3, 1, figsize=(15, 4.2 * n), gridspec_kw={"height_ratios": [1.6, 1.0, 0.32] * n, "hspace": 0.95})
    for i, (key, res) in enumerate(examples):
        a_sc, a_gt, a_st = axes[3 * i], axes[3 * i + 1], axes[3 * i + 2]
        live = res["live"]
        t = np.array([r["t"] for r in live]) / 60
        for name, s, e, expect in res["periods"]:
            for ax in (a_sc, a_gt):
                ax.axvspan(s / 60, e / 60, color=fs.COLORS.get(expect, "#dddddd") if expect else "#eeeeee", alpha=0.15, lw=0)
            a_sc.text((s + e) / 120, 1.03, name.replace("_", " "), ha="center", va="bottom", fontsize=8, transform=a_sc.get_xaxis_transform())
        a_sc.plot(t, [r["mind"] for r in live], color="#5b8def", lw=1.5, label="mind (EEG), own scale")
        a_sc.plot(t, [r["body"] for r in live], color="#f0a04b", lw=1.5, label="body (ring), own scale")
        a_sc.axhline(0.5, color="k", ls="--", lw=1)
        a_sc.set_ylim(0, 1)
        a_sc.set_ylabel("score")
        a_sc.set_title(f"{i + 1}. {SITUATIONS[key]['title']}  (SAM40 subject {res['eeg_subject']}, seed {res['seed']})",
                       fontsize=11, loc="left", pad=16)
        a_sc.legend(fontsize=7, loc="upper right")
        a_gt.plot(t, [r["mind_demand"] for r in live], color="#5b8def", lw=2, label="mental demand (truth)")
        a_gt.plot(t, [r["body_demand"] for r in live], color="#f0a04b", lw=2, label="physical arousal (truth)")
        a_gt.plot(t, [r["load_skin"] for r in live], color="#f0a04b", lw=0.8, ls=":", label="skin response (slow)")
        a_gt.set_ylim(-0.05, 1.05)
        a_gt.set_ylabel("truth")
        a_gt.legend(fontsize=7, loc="upper right", ncol=3)
        for r in live:
            a_st.axvspan((r["t"] - fs.BLOCK_S) / 60, r["t"] / 60, ymin=0.5, ymax=1, color=fs.COLORS[r["state"]], lw=0)
            a_st.axvspan((r["t"] - fs.BLOCK_S) / 60, r["t"] / 60, ymin=0, ymax=0.5,
                         color=fs.COLORS.get(r["expect"], "#ffffff") if r["expect"] else "#ffffff", lw=0)
        a_st.set_yticks([0.25, 0.75], ["expected", "detected"], fontsize=7)
        a_st.set_ylim(0, 1)
        a_st.set_xlim(a_sc.get_xlim())
        a_gt.set_xlim(a_sc.get_xlim())
    axes[-1].set_xlabel("minutes into the situation (after calibration)")
    fig.legend(handles=[Patch(color=fs.COLORS[k], label=v) for k, v in fs.LABELS.items()] + [Patch(color="#eeeeee", label="in-between (not scored)")],
               loc="lower center", ncol=5, fontsize=9, bbox_to_anchor=(0.5, -0.01))
    fig.suptitle("MindPulse: five everyday situations (SIMULATED: real SAM40 EEG + WESAD-sized body, scored by the deployed backend)",
                 fontsize=12, y=1.0)
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=10, help="virtual users per situation")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [(k, SEED0 + i) for k in SITUATIONS for i in range(args.users)]
    with ProcessPoolExecutor(args.workers) as ex:
        res = list(ex.map(_job, jobs))
    by = {k: [r for kk, r in res if kk == k] for k in SITUATIONS}

    def calibrated(r):
        return r["calibration"]["eeg_status"] == "ok" and r["calibration"]["ring"].get("status") == "ok"

    # example user per situation: the first one whose calibrations both passed (as the app requires)
    examples = [(k, next((r for r in rs if calibrated(r)), rs[0])) for k, rs in by.items()]
    figure(examples, OUT / "situations.png")

    L = ["# Five everyday situations (SIMULATED)", "",
         f"{args.users} virtual users per situation (profile 'responsive': real SAM40 EEG of a responsive subject, "
         "WESAD-sized body response, resting levels from real ring users). Each is calibrated as the live stimulator does, "
         "then scored by the deployed backend; state = mind x body, each 2 of the last 3 above its own limit.", "",
         f"Scored after the first {fs.GRACE_S // 60} min of each segment (onset / recovery); in-between segments are shown, not scored.", ""]
    summary = {}
    for k, rs in by.items():
        ok = [r for r in rs if calibrated(r)]
        L += [f"## {SITUATIONS[k]['title']} (`{k}`)", "",
              f"Calibration passed (EEG and ring ok): {len(ok)}/{len(rs)} users. Table: those users.", "",
              "| Segment | Mind / body (truth) | Expected | Correct after 2 min | Correct last 3 min | Users reaching it | Mind | Body | HR | Detected share |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        summary[k] = {}
        for name, dur, m0, m1, b0, b1, exp in SITUATIONS[k]["plan"]:
            ms = [r["metrics"][name] for r in ok]
            hit = [m["hit_rate"] for m in ms if m["hit_rate"] is not None]
            end = [m["end_share"] for m in ms if m["end_share"] is not None]
            reach = sum(m["time_to_state_s"] is not None for m in ms)
            share = {s: np.mean([m["state_share"].get(s, 0) for m in ms]) for s in fs.LABELS} if ms else {}
            mean = lambda key: (np.mean([m[key] for m in ms if m[key] is not None])  # noqa: E731
                                if any(m[key] is not None for m in ms) else float("nan"))
            fmt = lambda v: f"{v:.0%}" if v == v else "-"  # noqa: E731
            num = lambda v, d=2: f"{v:.{d}f}" if v == v else "too short to score"  # noqa: E731
            truth = f"{m0:g}{'→' + format(m1, 'g') if m1 != m0 else ''} / {b0:g}{'→' + format(b1, 'g') if b1 != b0 else ''}"
            L.append(f"| {name} | {truth} | {fs.LABELS[exp] if exp else 'in-between'} | "
                     f"{fmt(np.mean(hit)) if hit else '-'} | {fmt(np.mean(end)) if end else '-'} | "
                     f"{f'{reach}/{len(ms)}' if exp else '-'} | {num(mean('mind_mean'))} | {num(mean('body_mean'))} | {num(mean('hr_mean'), 0)} | "
                     + ", ".join(f"{fs.LABELS[s].split(' /')[0]} {v:.0%}" for s, v in share.items() if v >= 0.05) + " |")
            summary[k][name] = {"expected": exp, "hit": float(np.mean(hit)) if hit else None, "end": float(np.mean(end)) if end else None,
                                "reach": reach, "n": len(ms), "share": share}
        L.append("")
    tot = [v for k in summary for v in summary[k].values() if v["expected"] and v["hit"] is not None]
    L += ["## Overall", "",
          f"Scored segments: {len(tot)}; mean correct after the first 2 min {np.mean([v['hit'] for v in tot]):.0%}, "
          f"in the last 3 min {np.mean([v['end'] for v in tot if v['end'] is not None]):.0%}.", ""]
    (OUT / "situations.md").write_text("\n".join(L) + "\n")
    (OUT / "situations.json").write_text(json.dumps(
        {"users": args.users, "summary": summary,
         "runs": [{"situation": k, "seed": r["seed"], "eeg_subject": r["eeg_subject"], "calibration": {
             "eeg": r["calibration"]["eeg_status"], "eeg_attempts": r["calibration"]["eeg_attempts"],
             "ring": r["calibration"]["ring"].get("status")}, "metrics": r["metrics"]} for k, r in res]}, default=float, indent=1))
    print("\n".join(L))


if __name__ == "__main__":
    main()
