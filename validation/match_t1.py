"""Build t1_log.csv (heart-rate validation) from what you wrote down.

You write, for each reading:  condition, time_local (HH:MM:SS from the clock),
phone_app_bpm, manual_bpm.  This script finds the ring window closest in time
and fills in the rest, so you never match values by hand.

    python match_t1.py t1_raw.csv ring_windows_<user>.csv

Input t1_raw.csv columns:  person, condition, time_local, phone_app_bpm, manual_bpm
Output t1_log.csv columns: person, condition, reading_no, ring_hr, ref_hr, notes

Rules
  ref_hr  = mean of the phone-app and manual counts when both are present and
            within 6 bpm of each other; if they differ more, the reading is
            skipped (re-take it); if only one is present it is used.
  ring_hr = MeanHR of the ring window whose time is closest to the reading,
            within 45 s; otherwise the reading is skipped.
"""
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_REF_DIFF = 6.0
MAX_MATCH_SEC = 45


def to_sec(hms):
    h, m, s = [int(x) for x in hms.strip().split(":")]
    return h * 3600 + m * 60 + s


def num(x):
    try:
        return float(str(x).strip())
    except ValueError:
        return None


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    wins = []
    with open(sys.argv[2], newline="", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            try:
                wins.append((to_sec(r["time_local"]), float(r["MeanHR"])))
            except (ValueError, KeyError):
                continue
    if not wins:
        raise SystemExit("no ring windows in the file; run fetch_ring.py first")

    out, counters, skipped = [], {}, []
    with open(sys.argv[1], newline="", encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            if not r.get("time_local", "").strip():
                continue
            cond = r["condition"].strip()
            t = to_sec(r["time_local"])
            a, b = num(r.get("phone_app_bpm")), num(r.get("manual_bpm"))
            if a is not None and b is not None:
                if abs(a - b) > MAX_REF_DIFF:
                    skipped.append(f"{cond} {r['time_local']}: phone {a:.0f} vs manual {b:.0f} differ by more than {MAX_REF_DIFF:.0f}, retake")
                    continue
                ref = (a + b) / 2
            else:
                ref = a if a is not None else b
            if ref is None:
                continue
            tw, hr = min(wins, key=lambda w: abs(w[0] - t))
            if abs(tw - t) > MAX_MATCH_SEC:
                skipped.append(f"{cond} {r['time_local']}: no ring window within {MAX_MATCH_SEC}s")
                continue
            counters[cond] = counters.get(cond, 0) + 1
            out.append({"person": r.get("person", "P1").strip() or "P1", "condition": cond,
                        "reading_no": counters[cond], "ring_hr": round(hr, 1),
                        "ref_hr": round(ref, 1),
                        "notes": f"ring window {tw // 3600:02d}:{(tw % 3600) // 60:02d}:{tw % 60:02d}"})

    path = os.path.join(HERE, "t1_log.csv")
    with open(path, "w", newline="", encoding="utf8") as fh:
        wr = csv.DictWriter(fh, fieldnames=["person", "condition", "reading_no", "ring_hr", "ref_hr", "notes"])
        wr.writeheader()
        wr.writerows(out)
    print(f"wrote {len(out)} matched readings to {path}")
    for s in skipped:
        print("  skipped:", s)
    for o in out:
        print(f"  {o['condition']:16s} #{o['reading_no']}  ring {o['ring_hr']:6.1f}   reference {o['ref_hr']:6.1f}   ({o['notes']})")


if __name__ == "__main__":
    main()
