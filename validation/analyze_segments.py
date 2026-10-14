"""Compare what the ring measured during named time segments (for example:
baseline, calm video, arousal video, limit test, recovery).

Inputs
  1. ring_windows_<user>.csv   from fetch_ring.py (one row per ring window)
  2. a segments log CSV with columns  segment, start, end
     (start and end are clock times HH:MM:SS, read from the on-screen clock;
      see segments_log_template.csv)

    python analyze_segments.py ring_windows_<user>.csv segments_log.csv

For each segment it prints the number of windows and the mean heart rate,
skin conductance and stress probability, compares each segment with the
first one (the baseline), and saves segments_result.csv and
segments_result.png for the slides.
"""
import csv
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def to_sec(hms):
    h, m, s = [int(x) for x in hms.strip().split(":")]
    return h * 3600 + m * 60 + s


def load_windows(path):
    rows = []
    with open(path, newline="", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            try:
                rows.append({"t": to_sec(r["time_local"]),
                             "hr": float(r["MeanHR"]),
                             "scl": float(r["SCL_mean"]),
                             "p": float(r["prob_stress"])})
            except (ValueError, KeyError):
                continue
    return rows


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    wins = load_windows(sys.argv[1])
    if not wins:
        raise SystemExit("no ring windows in the file; run fetch_ring.py first")

    segs = []
    with open(sys.argv[2], newline="", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            if r.get("segment") and r.get("start", "").strip() and r.get("end", "").strip():
                segs.append((r["segment"].strip(), to_sec(r["start"]), to_sec(r["end"])))
    if not segs:
        raise SystemExit("the segments log has no filled rows")

    out = []
    for name, a, b in segs:
        sel = [w for w in wins if a <= w["t"] <= b]
        if not sel:
            out.append({"segment": name, "windows": 0, "hr": None, "scl": None, "p": None})
            continue
        out.append({
            "segment": name, "windows": len(sel),
            "hr": round(float(np.mean([w["hr"] for w in sel])), 1),
            "scl": round(float(np.mean([w["scl"] for w in sel])), 2),
            "p": round(float(np.mean([w["p"] for w in sel])) * 100, 1),
            "hr_max": round(float(np.max([w["hr"] for w in sel])), 1),
            "p_max": round(float(np.max([w["p"] for w in sel])) * 100, 1),
        })

    base = next((o for o in out if o["hr"] is not None), None)
    print(f"{'Segment':26s}{'n':>4}{'HR bpm':>9}{'dHR':>7}{'SCL uS':>9}{'dSCL':>8}{'stress %':>10}{'max %':>8}")
    for o in out:
        if o["hr"] is None:
            print(f"{o['segment']:26s}{0:>4}   (no windows in this time range)")
            continue
        dhr = o["hr"] - base["hr"]
        dscl = o["scl"] - base["scl"]
        o["dhr"], o["dscl"] = round(dhr, 1), round(dscl, 2)
        print(f"{o['segment']:26s}{o['windows']:>4}{o['hr']:>9.1f}{dhr:>+7.1f}"
              f"{o['scl']:>9.2f}{dscl:>+8.2f}{o['p']:>10.1f}{o['p_max']:>8.1f}")

    with open(os.path.join(HERE, "segments_result.csv"), "w", newline="", encoding="utf8") as fh:
        keys = ["segment", "windows", "hr", "dhr", "scl", "dscl", "p", "p_max", "hr_max"]
        wr = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
        wr.writeheader(); wr.writerows(out)

    ok = [o for o in out if o["hr"] is not None]
    if ok:
        names = [o["segment"] for o in ok]
        fig, ax = plt.subplots(1, 3, figsize=(12, 3.8))
        for a_, key, title, col in ((ax[0], "hr", "Heart rate (bpm)", "#5E935A"),
                                    (ax[1], "scl", "Skin conductance (uS)", "#6E68B2"),
                                    (ax[2], "p", "Stress probability (%)", "#E56B4E")):
            a_.bar(names, [o[key] for o in ok], color=col)
            a_.set_title(title, fontsize=10)
            a_.tick_params(axis="x", labelrotation=30, labelsize=8)
        plt.tight_layout()
        plt.savefig(os.path.join(HERE, "segments_result.png"), dpi=170)
        print("\nsaved segments_result.csv and segments_result.png")


if __name__ == "__main__":
    main()
