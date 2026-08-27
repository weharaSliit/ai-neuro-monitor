import pandas as pd
import json
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

# ── CMU ──────────────────────────────────────────────────────────────
cmu = pd.read_csv(os.path.join(BASE, "data", "raw", "DSL-StrongPasswordData (1).csv"), nrows=3)
print("=" * 60)
print("CMU RAW COLUMNS")
print("=" * 60)
print(f"Total columns: {len(cmu.columns)}")
for c in cmu.columns:
    print(f"  {c}  -> sample value: {cmu[c].iloc[0]}")

# ── StudentLife Activity ──────────────────────────────────────────────
SL_BASE = os.path.join(BASE, "..", "..", "research_v3_studentlife")
act_path = os.path.join(SL_BASE, "data", "raw", "activity", "activity_u00.csv")
if os.path.exists(act_path):
    act = pd.read_csv(act_path, nrows=5, header=None)
    print("\n" + "=" * 60)
    print("STUDENTLIFE ACTIVITY RAW (activity_u00.csv) - first 5 rows")
    print("=" * 60)
    print(act.to_string())
else:
    print(f"Not found: {act_path}")

# ── StudentLife Stress ─────────────────────────────────────────────────
stress_path = os.path.join(SL_BASE, "data", "raw", "stress", "Stress_u00.json")
if os.path.exists(stress_path):
    with open(stress_path) as f:
        sdata = json.load(f)
    print("\n" + "=" * 60)
    print("STUDENTLIFE STRESS JSON (Stress_u00.json) - first 3 entries")
    print("=" * 60)
    for entry in sdata[:3]:
        print(entry)
else:
    print(f"Not found: {stress_path}")
