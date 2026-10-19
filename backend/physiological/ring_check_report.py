# ============================================================
# ring_check_report.py -- slide-ready figures and numbers for the ring check
# recorded on psy_web's "Ring check" tab.
#
#   python backend/physiological/ring_check_report.py --user ringcheck01            # newest run
#   python backend/physiological/ring_check_report.py --user ringcheck01 --run run_1760000000000
#   python backend/physiological/ring_check_report.py --file path/to/run.json --user ringcheck01
#
# Reads (read-only): ring_validation/{user}/{run}  (steps, Heart Rate app readings, the ring's
# live signal once a second) and physiological/predictions/{user}/{session} (the 60 s windows).
# Writes output/ring_check/{run}/ : hr_overlay.png, hr_agreement.png, gsr_steps.png,
# movement_contact.png, steps.csv, summary.json, summary.md.
# Needs: numpy, matplotlib. The analysis is the same as psy_web/src/lib/ringCheck.js.
# ============================================================
import argparse
import csv
import json
import statistics as st
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

DB = "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app"
WINDOW_S, SLIDE_S = 60, 20
OUT = Path(__file__).resolve().parents[2] / "output" / "ring_check"
ARTEFACTS = {"shake", "cold", "off"}


def get(path):
    with urllib.request.urlopen(f"{DB}/{path}.json", timeout=60) as r:
        return json.load(r)


def keys(path):
    with urllib.request.urlopen(f"{DB}/{path}.json?shallow=true", timeout=60) as r:
        d = json.load(r)
    return sorted(d) if isinstance(d, dict) else []


def window_time(iso, anchor_ms):
    """Window times are naive (UTC on the server, local on a laptop): the reading closest to the run."""
    if not iso:
        return None
    if iso.endswith("Z") or "+" in iso[10:] or "-" in iso[10:]:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000
    naive = datetime.fromisoformat(iso)
    cands = [naive.replace(tzinfo=timezone.utc).timestamp() * 1000, naive.timestamp() * 1000]
    return min(cands, key=lambda c: abs(c - anchor_ms))


def load_run(args):
    if args.file:
        run = json.loads(Path(args.file).read_text(encoding="utf-8"))
    else:
        rid = args.run or (keys(f"ring_validation/{args.user}") or [None])[-1]
        if not rid:
            raise SystemExit(f"No ring_validation runs for {args.user}")
        run = get(f"ring_validation/{args.user}/{rid}")
    if not run:
        raise SystemExit("Run not found")
    return run


def parse_samples(csv_text):
    rows = []
    for line in (csv_text or "").split("\n")[1:]:
        if not line:
            continue
        t, us, acc, finger, hr = (line.split(",") + [""] * 5)[:5]
        f = lambda v: None if v == "" else float(v)
        rows.append({"t": float(t), "us": f(us), "acc": f(acc), "finger": None if finger == "" else finger == "1", "hr": f(hr)})
    return rows


def load_windows(run, user):
    sid = run.get("session_id")
    if not sid:
        return []
    preds = get(f"physiological/predictions/{user}/{sid}") or {}
    quals = get(f"physiological/prediction_quality/{user}/{sid}") or {}
    q_by_idx = {}
    for q in quals.values():
        q_by_idx.setdefault(q.get("window_idx"), []).append(q)
    lo, hi = run["started_at"] - 2 * WINDOW_S * 1000, (run.get("ended_at") or run["started_at"] + 3_000_000) + 2 * WINDOW_S * 1000
    out = []
    for p in preds.values():
        t = window_time(p.get("timestamp"), run["started_at"])
        if t is None or not lo <= t <= hi:
            continue
        qs = q_by_idx.get(p.get("window_idx"), [])
        q = None
        if qs:
            best = min(qs, key=lambda x: abs((window_time(x.get("timestamp"), run["started_at"]) or 0) - t))
            q = best.get("signal_quality")
        f = p.get("features") or {}
        out.append({"t": t, "hr": f.get("MeanHR"), "scl": f.get("SCL_mean"), "q": q if q is not None else p.get("signal_quality"),
                    "prob": p.get("prob_stress"), "label": p.get("label") or p.get("stress_label"), "thr": p.get("threshold") or p.get("decision_threshold")})
    return sorted(out, key=lambda w: w["t"])


def mean(a):
    a = [x for x in a if x is not None]
    return float(np.mean(a)) if a else None


def median(a):
    a = [x for x in a if x is not None]
    return float(np.median(a)) if a else None


def pair_up(run, wins, samples):
    pairs = []
    for r in run.get("refs") or []:
        x = r["t"]
        cand = [w for w in wins if w["hr"] is not None and w["t"] - WINDOW_S * 1000 - 5000 <= x <= w["t"] + 5000]
        w = min(cand, key=lambda w: abs(w["t"] - WINDOW_S * 500 - x)) if cand else None
        live = median([s["hr"] for s in samples if s["hr"] is not None and abs(s["t"] - x) <= 10000])
        pairs.append({"t": x, "step": r.get("step"), "ref": r["bpm"], "win": w["hr"] if w else None, "live": live})
    return pairs


def agree(pairs, k):
    p = [r for r in pairs if r[k] is not None]
    if not p:
        return {"n": 0}
    ref = np.array([r["ref"] for r in p], float)
    ring = np.array([r[k] for r in p], float)
    err = ring - ref
    r = float(np.corrcoef(ref, ring)[0, 1]) if len(p) >= 3 and ref.std() > 0 and ring.std() > 0 else None
    return {"n": len(p), "bias": float(err.mean()), "mae": float(np.abs(err).mean()), "r": r,
            "sd_diff": float(err.std(ddof=1)) if len(p) > 1 else None,
            "within5": float((np.abs(err) <= 5).mean()), "within10": float((np.abs(err) <= 10).mean())}


def step_rows(run, wins, samples):
    rows = []
    for s in run["steps"]:
        end = s.get("end") or run.get("ended_at")
        ins = [x for x in samples if s["start"] <= x["t"] <= end]
        w = [x for x in wins if s["start"] < x["t"] <= end + 10000]
        expected = max(0, int((end - s["start"]) // (SLIDE_S * 1000)))
        rows.append({
            "step": s["key"], "label": s["label"], "seconds": round((end - s["start"]) / 1000),
            "hr_live": median([x["hr"] for x in ins]), "hr_window": mean([x["hr"] for x in w]),
            "gsr_us": mean([x["us"] for x in ins]), "scl_window": mean([x["scl"] for x in w]),
            "acc_mean": mean([x["acc"] for x in ins]), "acc_peak": max([x["acc"] or 0 for x in ins], default=None),
            "finger_off_pct": (sum(1 for x in ins if x["finger"] is False) / len(ins)) if ins else None,
            "quality": mean([x["q"] for x in w]), "stress_prob": mean([x["prob"] for x in w]),
            "stress_pct": (sum(1 for x in w if str(x["label"]).lower().startswith("stress")) / len(w)) if w else None, "windows_kept": len(w), "windows_expected": expected,
            "windows_withheld": max(0, expected - len(w)),
        })
    return rows


# ---------------- figures ----------------
def _bands(ax, run, t0):
    for i, s in enumerate(run["steps"]):
        a, b = (s["start"] - t0) / 60000, ((s.get("end") or run["ended_at"]) - t0) / 60000
        art = s["key"] in ARTEFACTS
        ax.axvspan(a, b, color="#e8a238" if art else ("#6e68b2" if i % 2 else "#888888"), alpha=0.16 if art else 0.07, lw=0)
        ax.text((a + b) / 2, 1.01, s["label"], transform=ax.get_xaxis_transform(), ha="center", va="bottom", fontsize=7.5, rotation=0)


def figs(run, wins, samples, pairs, ag_w, ag_l, rows, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    t0 = run["started_at"]
    mn = lambda t: (t - t0) / 60000

    fig, ax = plt.subplots(figsize=(14, 5))
    live = [(mn(samples[i]["t"]), median([s["hr"] for s in samples[i:i + 5]])) for i in range(0, len(samples), 5)]
    live = [p for p in live if p[1] is not None]
    if live:
        ax.plot(*zip(*live), color="#1f77b4", lw=1.2, label="Ring, live beats (5 s median)")
    hw = [(mn(w["t"]), w["hr"]) for w in wins if w["hr"] is not None]
    if hw:
        ax.plot(*zip(*hw), color="#2ca02c", lw=2, marker="o", ms=3, label="Ring, 60 s window")
    if pairs:
        ax.scatter([mn(p["t"]) for p in pairs], [p["ref"] for p in pairs], color="#d62728", s=55, zorder=5, label="Heart Rate app (reference)")
    _bands(ax, run, t0)
    ax.set_xlabel("minutes into the run")
    ax.set_ylabel("heart rate (bpm)")
    ax.set_xlim(0, mn(run["ended_at"] or samples[-1]["t"]))
    ax.legend(loc="upper left", fontsize=8)
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(out / "hr_overlay.png", dpi=160)
    plt.close(fig)

    fig, axes = plt.subplots(1, 3, figsize=(15, 4.6))
    for ax, k, title, ag in ((axes[0], "win", "Ring 60 s window vs app", ag_w), (axes[1], "live", "Ring live beats vs app", ag_l)):
        p = [r for r in pairs if r[k] is not None]
        if p:
            x = np.array([r["ref"] for r in p], float)
            y = np.array([r[k] for r in p], float)
            lo, hi = min(x.min(), y.min()) - 8, max(x.max(), y.max()) + 8
            ax.plot([lo, hi], [lo, hi], "k--", lw=1)
            ax.scatter(x, y, color="#2ca02c" if k == "win" else "#1f77b4", s=45, alpha=0.8)
            ax.set_xlim(lo, hi)
            ax.set_ylim(lo, hi)
        ax.set_xlabel("Heart Rate app (bpm)")
        ax.set_ylabel("ring (bpm)")
        r = ag.get("r")
        ax.set_title(f"{title}\nn={ag.get('n', 0)}  mean error {ag.get('mae', float('nan')):.1f} bpm  r={'-' if r is None else f'{r:.2f}'}", fontsize=9)
        ax.grid(alpha=0.2)
    p = [r for r in pairs if r["live"] is not None] or [r for r in pairs if r["win"] is not None]
    key = "live" if any(r["live"] is not None for r in pairs) else "win"
    if p:
        m = np.array([(r["ref"] + r[key]) / 2 for r in p], float)
        d = np.array([r[key] - r["ref"] for r in p], float)
        ax = axes[2]
        ax.scatter(m, d, color="#9467bd", s=45)
        ax.axhline(d.mean(), color="k", lw=1)
        if len(d) > 1:
            for sgn in (-1, 1):
                ax.axhline(d.mean() + sgn * 1.96 * d.std(ddof=1), color="k", ls="--", lw=0.8)
        ax.set_title(f"Bland-Altman ({'live beats' if key == 'live' else '60 s window'}): bias {d.mean():+.1f} bpm", fontsize=9)
        ax.set_xlabel("mean of ring and app (bpm)")
        ax.set_ylabel("ring - app (bpm)")
        ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(out / "hr_agreement.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(14, 4.4))
    us = [(mn(s["t"]), s["us"]) for s in samples if s["us"] is not None]
    if us:
        ax.plot(*zip(*us), color="#17a2b8", lw=1.1, label="Skin conductance, live (µS)")
    sw = [(mn(w["t"]), w["scl"]) for w in wins if w["scl"] is not None]
    if sw:
        ax.plot(*zip(*sw), color="#2ca02c", lw=2, marker="o", ms=3, label="Window level (µS)")
    _bands(ax, run, t0)
    ax.set_xlabel("minutes into the run")
    ax.set_ylabel("µS")
    ax.set_xlim(0, mn(run["ended_at"] or samples[-1]["t"]))
    ax.legend(loc="upper left", fontsize=8)
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(out / "gsr_steps.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(14, 3.8))
    acc = [(mn(s["t"]), s["acc"]) for s in samples if s["acc"] is not None]
    if acc:
        ax.plot(*zip(*acc), color="#8c564b", lw=1)
    off = [mn(s["t"]) for s in samples if s["finger"] is False]
    if off:
        ax.scatter(off, [0.02] * len(off), color="#d62728", s=5, label="finger off")
        ax.legend(loc="upper left", fontsize=8)
    _bands(ax, run, t0)
    ax.set_xlabel("minutes into the run")
    ax.set_ylabel("movement (g)")
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(out / "movement_contact.png", dpi=160)
    plt.close(fig)


def pred_fig(run, wins, thr, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    t0 = run["started_at"]
    fig, ax = plt.subplots(figsize=(14, 4.6))
    pw = [((w["t"] - t0) / 60000, w["prob"]) for w in wins if w["prob"] is not None]
    if pw:
        ax.plot(*zip(*pw), color="#6e68b2", lw=2, marker="o", ms=3, label="ring stress probability (per 60 s window)")
    if thr is not None:
        ax.axhline(thr, color="k", ls="--", lw=1, label=f"decision limit {thr:.2f}")
    _bands(ax, run, t0)
    ax.set_ylim(0, 1.02)
    ax.set_xlim(0, (run["ended_at"] - t0) / 60000)
    ax.set_xlabel("minutes into the run")
    ax.set_ylabel("stress probability")
    ax.legend(loc="upper left", fontsize=8)
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(out / "predictions.png", dpi=160)
    plt.close(fig)


def f(v, d=1):
    return "-" if v is None else f"{v:.{d}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    ap.add_argument("--run")
    ap.add_argument("--file")
    args = ap.parse_args()
    run = load_run(args)
    run.setdefault("user_id", args.user)
    samples = parse_samples(run.get("samples_csv"))
    wins = load_windows(run, run["user_id"])
    pairs = pair_up(run, wins, samples)
    ag_w, ag_l = agree(pairs, "win"), agree(pairs, "live")
    rows = step_rows(run, wins, samples)
    out = OUT / run["id"]
    out.mkdir(parents=True, exist_ok=True)
    figs(run, wins, samples, pairs, ag_w, ag_l, rows, out)
    th = get(f"physiological/personal_thresholds/{run['user_id']}") or {}
    thr = th.get("personal_stress_threshold")
    if thr is None:
        thr = next((w["thr"] for w in wins if w.get("thr") is not None), 0.6447)
    pred_fig(run, wins, thr, out)

    with open(out / "steps.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    by = {r["step"]: r for r in rows}
    hr_rest = (by.get("rest") or {}).get("hr_live") or (by.get("rest") or {}).get("hr_window")
    hr_walk = (by.get("walk") or {}).get("hr_live") or (by.get("walk") or {}).get("hr_window")
    art = [r for r in rows if r["step"] in ARTEFACTS]
    summary = {
        "run": run["id"], "user": run["user_id"], "session": run.get("session_id"),
        "heart_rate_vs_app_live": ag_l, "heart_rate_vs_app_window": ag_w,
        "walk_hr_rise_bpm": (hr_walk - hr_rest) if hr_rest and hr_walk else None,
        "mental_task_gsr_rise_uS": (by["quiz"]["gsr_us"] - by["rest"]["gsr_us"]) if by.get("quiz") and by.get("rest") and by["quiz"]["gsr_us"] is not None and by["rest"]["gsr_us"] is not None else None,
        "artefact_windows_expected": sum(r["windows_expected"] for r in art),
        "artefact_windows_withheld": sum(r["windows_withheld"] for r in art),
        "finger_off_pct_in_off_step": (by.get("off") or {}).get("finger_off_pct"),
        "shake_peak_g": (by.get("shake") or {}).get("acc_peak"),
        "app_readings": len(pairs),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    A = ag_l if ag_l.get("n") else ag_w
    md = [f"# Ring check: {run['user_id']} / {run['id']}", "",
          f"Heart Rate app readings: {len(pairs)}  ·  ring windows in the run: {len(wins)}", "",
          "## Heart rate vs Heart Rate app", "", "| ring value | n | mean error (bpm) | bias (bpm) | r | within 5 bpm | within 10 bpm |", "|---|---|---|---|---|---|---|"]
    for name, a in (("live beats", ag_l), ("60 s window", ag_w)):
        md.append(f"| {name} | {a.get('n', 0)} | {f(a.get('mae'))} | {f(a.get('bias'))} | {f(a.get('r'), 2)} | {f((a.get('within5') or 0) * 100, 0) if a.get('n') else '-'}% | {f((a.get('within10') or 0) * 100, 0) if a.get('n') else '-'}% |")
    md += ["", "## Per step", "", "| step | s | HR live | HR window | GSR µS | move avg/peak (g) | finger off | quality | stress prob | labelled Stress | windows kept / expected |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        md.append(f"| {r['label']} | {r['seconds']} | {f(r['hr_live'])} | {f(r['hr_window'])} | {f(r['gsr_us'], 2)} | {f(r['acc_mean'], 2)} / {f(r['acc_peak'], 2)} | {f((r['finger_off_pct'] or 0) * 100, 0)}% | {f(r['quality'], 2)} | {f(r['stress_prob'], 2)} | {f((r['stress_pct'] or 0) * 100, 0) if r['stress_pct'] is not None else '-'}% | {r['windows_kept']}/{r['windows_expected']} |")
    md += ["", "## Slide numbers", "",
           f"- Heart rate agreement ({'live beats' if ag_l.get('n') else '60 s window'}): mean error {f(A.get('mae'))} bpm, r = {f(A.get('r'), 2)}, n = {A.get('n', 0)}",
           f"- Heart rate rise walking vs rest: {f(summary['walk_hr_rise_bpm'], 0)} bpm",
           f"- Skin conductance rise on the mental task: {f(summary['mental_task_gsr_rise_uS'], 2)} µS",
           f"- Artefact windows withheld: {summary['artefact_windows_withheld']} of {summary['artefact_windows_expected']} expected (finger off for {f((summary['finger_off_pct_in_off_step'] or 0) * 100, 0)}% of the finger-off step; shake peak {f(summary['shake_peak_g'])} g)"]
    (out / "summary.md").write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md))
    print(f"\nFigures and tables in {out}")


if __name__ == "__main__":
    main()
