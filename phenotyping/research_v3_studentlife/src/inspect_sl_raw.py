import pandas as pd
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))

# ── StudentLife Activity ──────────────────────────────────────────────
act_path = os.path.join(BASE, "..", "data", "raw", "activity", "activity_u00.csv")
if os.path.exists(act_path):
    act = pd.read_csv(act_path, nrows=5, header=None)
    print("=" * 60)
    print("STUDENTLIFE ACTIVITY RAW (activity_u00.csv) - first 5 rows")
    print("=" * 60)
    print(act.to_string())
else:
    print(f"NOT FOUND: {act_path}")

# ── StudentLife Stress ─────────────────────────────────────────────────
stress_path = os.path.join(BASE, "..", "data", "raw", "stress", "Stress_u00.json")
if os.path.exists(stress_path):
    with open(stress_path) as f:
        sdata = json.load(f)
    print("\n" + "=" * 60)
    print("STUDENTLIFE STRESS JSON (Stress_u00.json) - first 3 entries")
    print("=" * 60)
    for entry in sdata[:3]:
        print(entry)
    print(f"\nTotal EMA entries for u00: {len(sdata)}")
    print(f"All keys in entry: {list(sdata[0].keys())}")
else:
    print(f"NOT FOUND: {stress_path}")
