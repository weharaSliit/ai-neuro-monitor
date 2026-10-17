"""Pull the ring's recent windows for one user from the live database.

Use during or after a validation session, so you do not have to read values off
the phone screen.

    python fetch_ring.py --user wehara --minutes 40

Writes ring_windows_<user>.csv (one row per window) and ring_gsr_<user>.json
(the processed GSR preview of each window, used by analyze_t2.py).

The database is read through its public REST address, the same one the app uses.
"""
import argparse
import csv
import datetime as dt
import json
import os
import urllib.parse
import urllib.request

DB = "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app"
HERE = os.path.dirname(os.path.abspath(__file__))


def get(path, shallow=False, timeout=90):
    url = f"{DB}/{path}.json" + ("?shallow=true" if shallow else "")
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf8"))


def parse_ts(s):
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True, help="username exactly as registered")
    ap.add_argument("--minutes", type=float, default=60, help="how far back to keep")
    a = ap.parse_args()

    u = urllib.parse.quote(a.user)
    sessions = get(f"physiological/predictions/{u}", shallow=True)
    if not sessions:
        raise SystemExit(f"no ring data found for user {a.user!r}")
    latest = sorted(sessions.keys())[-1]          # session ids sort by date/time
    wins = get(f"physiological/predictions/{u}/{urllib.parse.quote(latest)}")

    now = dt.datetime.now(dt.timezone.utc)
    cut = now - dt.timedelta(minutes=a.minutes)
    rows, gsr = [], []
    for wid, w in wins.items():
        if not isinstance(w, dict) or "timestamp" not in w:
            continue
        ts = parse_ts(w["timestamp"])
        if ts < cut:
            continue
        f = w.get("features", {})
        rows.append({
            "time_local": ts.astimezone().strftime("%H:%M:%S"),
            "time_utc": ts.isoformat(),
            "window_idx": w.get("window_idx"),
            "MeanHR": round(f.get("MeanHR", float("nan")), 1),
            "AVNN": round(f.get("AVNN", float("nan")), 1),
            "SCL_mean": round(f.get("SCL_mean", float("nan")), 3),
            "prob_stress": round(w.get("prob_stress", float("nan")), 3),
            "label": w.get("label"),
        })
        if w.get("wave_gsr"):
            gsr.append({"time_utc": ts.isoformat(), "wave_gsr": w["wave_gsr"]})
    rows.sort(key=lambda r: r["time_utc"])
    gsr.sort(key=lambda r: r["time_utc"])

    out_csv = os.path.join(HERE, f"ring_windows_{a.user}.csv")
    with open(out_csv, "w", newline="", encoding="utf8") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["time_local"])
        wr.writeheader()
        wr.writerows(rows)
    out_json = os.path.join(HERE, f"ring_gsr_{a.user}.json")
    json.dump(gsr, open(out_json, "w"))

    print(f"session {latest}: {len(rows)} windows in the last {a.minutes:g} min")
    for r in rows[-12:]:
        print(f"  {r['time_local']}  idx {r['window_idx']:>4}  HR {r['MeanHR']:>6}  "
              f"SCL {r['SCL_mean']:>6}  p={r['prob_stress']}  {r['label']}")
    print("saved", out_csv, "and", out_json)


if __name__ == "__main__":
    main()
