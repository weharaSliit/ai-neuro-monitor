# obj2_task3_stress_decision.py
# Combines Z-scores into stress severity score 0-1
# Literature: IJCA 2023 — multi-feature fusion improves accuracy
#             Motion Sensors 2020 — 87.56% accuracy combined signals
import pandas as pd
import numpy as np
import os
os.makedirs("../outputs", exist_ok=True)

SCORES = "../outputs/anomaly_scores.csv"
OUT    = "../outputs/stress_predictions.csv"

print("=" * 60)
print("  TASK 3 — MULTI-FEATURE STRESS DECISION")
print("  Literature: IJCA 2023, Motion Sensors 2020")
print("=" * 60)

df     = pd.read_csv(SCORES)
z_cols = [c for c in df.columns if c.startswith("z_")]
print(f"Z-score features: {len(z_cols)}")

def stress_score(row):
    z_vals = [float(row[c]) for c in z_cols
              if not pd.isna(row.get(c, np.nan))]
    if not z_vals:
        return 0.0
    # Normalize to 0-1: Z capped at 10.0 → divide by 10
    normalised = [min(z / 10.0, 1.0) for z in z_vals]
    return round(float(np.mean(normalised)), 4)

def stress_level(score, n_anomalous):
    if n_anomalous == 0 or score < 0.10:   return "Normal"
    elif n_anomalous <= 1 or score < 0.25: return "Low"
    elif n_anomalous <= 3 or score < 0.50: return "Moderate"
    else:                                   return "High"

df["stress_score"] = df.apply(stress_score, axis=1)
df["stress_level"] = df.apply(
    lambda r: stress_level(r["stress_score"],
                           r.get("n_features_anomalous", 0)), axis=1)

# Results
print(f"\nStress level distribution:")
print(f"  {'Label':12} {'Normal%':>10} {'Low%':>8}"
      f" {'Moderate%':>11} {'High%':>8}")
print(f"  {'─'*55}")
for lbl in ["normal", "pre_stress", "stressed"]:
    sub = df[df["label"] == lbl]
    if len(sub) == 0:
        continue
    n = (sub["stress_level"] == "Normal").mean()   * 100
    l = (sub["stress_level"] == "Low").mean()      * 100
    m = (sub["stress_level"] == "Moderate").mean() * 100
    h = (sub["stress_level"] == "High").mean()     * 100
    print(f"  {lbl:12} {n:10.1f}% {l:8.1f}% {m:11.1f}% {h:8.1f}%")

n_score  = df[df["label"] == "normal"]["stress_score"].mean()
ps_score = (df[df["label"] == "pre_stress"]["stress_score"].mean()
            if "pre_stress" in df["label"].values else 0)
s_score  = df[df["label"] == "stressed"]["stress_score"].mean()

print(f"\nAverage stress score:")
print(f"  Normal:     {n_score:.4f}")
if "pre_stress" in df["label"].values:
    print(f"  Pre-stress: {ps_score:.4f}"
          f"  ← should be between normal and stressed")
print(f"  Stressed:   {s_score:.4f}")

if s_score > n_score:
    print(f"\n  ✅ Stress scores correctly ordered:")
    print(f"     normal ({n_score:.3f}) < stressed ({s_score:.3f})")
    if ps_score > n_score:
        print(f"     pre_stress ({ps_score:.3f}) sits in between"
              f" ← pre-stress detected")
else:
    print(f"\n  ⚠️  Scores not clearly ordered — check Z-score output")

df.to_csv(OUT, index=False)
print(f"\n✅ Saved: {OUT}")
print("Next: python obj2_task4_ema_updater.py")