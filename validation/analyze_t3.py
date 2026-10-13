"""T3 - quality gates and latency, summarised across users.

Input: a CSV with columns  person, test, attempt, outcome, seconds
  test    = motion | finger_off | latency
  outcome = for motion / finger_off: rejected (the window was refused) or
            scored (it was wrongly scored anyway); for latency leave empty
  seconds = for latency only: time from the event to the value appearing on
            screen, measured with a stopwatch

    python analyze_t3.py t3_log.csv
"""
import csv
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    rows = []
    with open(sys.argv[1], newline="", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            if r.get("test", "").strip() and (r.get("outcome", "").strip() or r.get("seconds", "").strip()):
                rows.append(r)
    if not rows:
        raise SystemExit("no filled rows")

    out = []
    for test in ("motion", "finger_off"):
        sel = [r for r in rows if r["test"] == test]
        if not sel:
            continue
        rej = sum(1 for r in sel if r["outcome"].strip().lower() == "rejected")
        people = sorted({r["person"] for r in sel})
        out.append((test, f"{rej} of {len(sel)} attempts rejected, {len(people)} people"))
        for p in people:
            ps = [r for r in sel if r["person"] == p]
            pr = sum(1 for r in ps if r["outcome"].strip().lower() == "rejected")
            out.append(("", f"   {p}: {pr} of {len(ps)}"))
    lat = []
    for r in rows:
        if r["test"] == "latency" and r["seconds"].strip():
            try:
                lat.append(float(r["seconds"]))
            except ValueError:
                pass
    if lat:
        out.append(("latency", f"n={len(lat)}  median {st.median(lat):.1f} s  "
                               f"worst {max(lat):.1f} s  best {min(lat):.1f} s"))
    width = max(len(a) for a, _ in out)
    for a, b in out:
        print(f"{a:<{width}}  {b}")
    with open(os.path.join(HERE, "t3_result.txt"), "w", encoding="utf8") as fh:
        for a, b in out:
            fh.write(f"{a}: {b}\n")
    print("\nsaved t3_result.txt")


if __name__ == "__main__":
    main()
