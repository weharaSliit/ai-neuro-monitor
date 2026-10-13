"""T2 - GSR response to known stimuli.

Inputs
  1. ring_gsr_<user>.json   from fetch_ring.py (processed GSR preview per window)
  2. a stimulus log CSV with columns  stimulus, repeat, time_local
     (time_local = clock time HH:MM:SS at which the stimulus STARTED, taken from
     the laptop or phone clock; see t2_log_template.csv)

    python analyze_t2.py ring_gsr_wehara.json t2_log.csv

For every stimulus the script finds the window that contains it, measures the
baseline just before, the peak after, the rise and the delay until the signal
first moves, and saves t2_result.png and t2_result.csv.

A response counts as detected when the rise is at least 3x the baseline noise
and at least 0.03 uS, with the peak inside 15 s of the stimulus.  The delay is
limited by the preview resolution (about 0.75 s per point).
"""
import csv
import datetime as dt
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WINDOW_S = 60.0
BASE_PRE = (15.0, 2.0)     # baseline: from 15 s to 2 s before the stimulus
RESP_MAX = 15.0            # look for the peak within 15 s after
MIN_RISE = 0.03            # uS
NOISE_K = 3.0


def to_utc_today(hms, ref):
    h, m, s = [int(x) for x in hms.split(":")]
    local = ref.astimezone().replace(hour=h, minute=m, second=s, microsecond=0)
    return local.astimezone(dt.timezone.utc)


def build_series(windows):
    """Return arrays (t_seconds_utc_epoch, value) merged across windows; newer
    windows overwrite older ones where they overlap."""
    pts = {}
    for w in windows:
        end = dt.datetime.fromisoformat(w["time_utc"]).timestamp()
        v = np.asarray(w["wave_gsr"], dtype=float)
        n = len(v)
        t = end - WINDOW_S + (np.arange(n) + 0.5) * (WINDOW_S / n)
        for ti, vi in zip(t, v):
            pts[round(ti, 2)] = vi
    ts = np.array(sorted(pts))
    return ts, np.array([pts[t] for t in ts])


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    windows = json.load(open(sys.argv[1]))
    if not windows:
        raise SystemExit("no GSR previews in the file; run fetch_ring.py during or just after the session")
    ts, val = build_series(windows)
    ref = dt.datetime.fromisoformat(windows[-1]["time_utc"])

    log = []
    with open(sys.argv[2], newline="", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            if r.get("time_local", "").strip():
                log.append(r)
    if not log:
        raise SystemExit("the stimulus log has no times filled in")

    results, fig_data = [], []
    for r in log:
        t0 = to_utc_today(r["time_local"].strip(), ref).timestamp()
        pre = (ts >= t0 - BASE_PRE[0]) & (ts <= t0 - BASE_PRE[1])
        post = (ts >= t0) & (ts <= t0 + RESP_MAX)
        if pre.sum() < 3 or post.sum() < 3:
            results.append({"stimulus": r["stimulus"], "repeat": r["repeat"],
                            "baseline": "", "peak": "", "rise": "", "delay_s": "", "detected": "no data"})
            continue
        base = float(np.median(val[pre]))
        noise = float(np.std(val[pre]))
        peak_i = int(np.argmax(val[post]))
        peak = float(val[post][peak_i])
        rise = peak - base
        thr = max(NOISE_K * noise, MIN_RISE)
        detected = rise >= thr
        delay = ""
        if detected:
            above = np.where(val[post] >= base + thr)[0]
            delay = round(float(ts[post][above[0]] - t0), 1)
        results.append({"stimulus": r["stimulus"], "repeat": r["repeat"],
                        "baseline": round(base, 3), "peak": round(peak, 3),
                        "rise": round(rise, 3), "delay_s": delay,
                        "detected": "yes" if detected else "no"})
        seg = (ts >= t0 - 20) & (ts <= t0 + 30)
        fig_data.append((r["stimulus"] + " " + r["repeat"], ts[seg] - t0, val[seg]))

    print(f"{'Stimulus':22s}{'rep':>4}{'base':>9}{'peak':>9}{'rise':>9}{'delay s':>9}{'detected':>10}")
    for x in results:
        print(f"{x['stimulus']:22s}{str(x['repeat']):>4}{str(x['baseline']):>9}{str(x['peak']):>9}"
              f"{str(x['rise']):>9}{str(x['delay_s']):>9}{x['detected']:>10}")
    ok = sum(1 for x in results if x["detected"] == "yes")
    print(f"\nResponses detected: {ok} of {len(results)}")

    with open(os.path.join(HERE, "t2_result.csv"), "w", newline="", encoding="utf8") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(results[0].keys()))
        wr.writeheader(); wr.writerows(results)

    if fig_data:
        n = len(fig_data)
        cols = min(3, n); rows_n = (n + cols - 1) // cols
        fig, axes = plt.subplots(rows_n, cols, figsize=(4.2 * cols, 2.9 * rows_n), squeeze=False)
        for ax, (name, t, v) in zip(axes.ravel(), fig_data):
            ax.plot(t, v, color="#2E8B83", lw=1.6)
            ax.axvline(0, color="#F08A6B", ls="--", lw=1)
            ax.set_title(name, fontsize=9); ax.set_xlabel("seconds from stimulus", fontsize=8)
            ax.set_ylabel("GSR (uS)", fontsize=8)
        for ax in axes.ravel()[n:]:
            ax.axis("off")
        plt.tight_layout()
        plt.savefig(os.path.join(HERE, "t2_result.png"), dpi=170)
        print("saved t2_result.png and t2_result.csv")


if __name__ == "__main__":
    main()
