"""Early-warning study summary (ramp scenario), checked against the criteria
fixed in criteria.json["early_warning"] before the run.

  PYTHONPATH=../..:. ../../venv/bin/python -m simkit.ew_summary
"""
import json
import math
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parents[1] / "output" / "simkit"
CRIT = json.loads((Path(__file__).with_name("criteria.json")).read_text())["early_warning"]
METRICS = ["ew_sensitivity", "ew_lead_time_s", "ew_precision", "ew_false_per_hour_calm", "ew_limited_share",
           "ew_in_plateau", "high_in_plateau", "ew_warnings"]
T95 = {n: t for n, t in [(2, 12.71), (3, 4.30), (4, 3.18), (5, 2.78), (6, 2.57), (8, 2.36), (10, 2.26), (15, 2.14), (20, 2.09)]}


def ci(xs):
    xs = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    if not xs:
        return {"mean": None, "lo": None, "hi": None, "n": 0}
    m = float(np.mean(xs))
    if len(xs) < 2:
        return {"mean": m, "lo": None, "hi": None, "n": 1}
    t = T95[min(T95, key=lambda k: abs(k - len(xs)))]
    h = t * float(np.std(xs, ddof=1)) / math.sqrt(len(xs))
    return {"mean": m, "lo": m - h, "hi": m + h, "n": len(xs)}


def summarize():
    runs = [r for r in json.loads((OUT / "results_ramp.json").read_text())["runs"] if "error" not in r]
    out = {}
    for prof in dict.fromkeys(r["profile"] for r in runs):
        rs = [r for r in runs if r["profile"] == prof]
        row = {}
        for comp in ("mind", "fused"):
            active = [r for r in rs if (r.get(f"{comp}_ew_limited_share") or 0) < 0.5]
            for m in METRICS:
                pool = rs if m == "ew_limited_share" else active
                row[f"{comp}_{m}"] = ci([r.get(f"{comp}_{m}") for r in pool])
            row[f"{comp}_active_runs"] = len(active)
        row["mind_led_share_of_fused_high"] = ci([r.get("mind_led_share_of_fused_high") for r in rs])
        checks = []
        for metric, (op, target) in CRIT["pass_criteria"].get(prof, {}).items():
            v = row[metric]["mean"]
            ok = v is not None and (v >= target if op == ">=" else v <= target)
            checks.append({"metric": metric, "op": op, "target": target, "value": v, "pass": ok})
        row["checks"] = checks
        out[prof] = row
    (OUT / "summary_ramp.json").write_text(json.dumps(out, indent=1, default=float))
    return out


def f(c, pct=False, sec=False):
    if not c or c["mean"] is None:
        return "   —   "
    v = c["mean"]
    return f"{100 * v:4.0f}%" if pct else f"{v:5.0f}s" if sec else f"{v:5.2f}"


if __name__ == "__main__":
    s = summarize()
    print(f"{'profile':22s} {'active':>6s} | mind: sens  lead   prec  false/h | fused: sens  lead   prec  false/h | mind-led | plateau warn/high (fused)")
    for p, r in s.items():
        print(f"{p:22s} {r['mind_active_runs']:2d}/{r['fused_active_runs']:2d} | "
              f"{f(r['mind_ew_sensitivity'], True)} {f(r['mind_ew_lead_time_s'], sec=True)} {f(r['mind_ew_precision'], True)} {f(r['mind_ew_false_per_hour_calm'])} | "
              f"{f(r['fused_ew_sensitivity'], True)} {f(r['fused_ew_lead_time_s'], sec=True)} {f(r['fused_ew_precision'], True)} {f(r['fused_ew_false_per_hour_calm'])} | "
              f"{f(r['mind_led_share_of_fused_high'], True)} | {f(r['fused_ew_in_plateau'])} / {f(r['fused_high_in_plateau'])}")
    n = sum(len(r["checks"]) for r in s.values())
    ok = sum(c["pass"] for r in s.values() for c in r["checks"])
    print(f"\npre-registered early-warning criteria: {ok} of {n} pass")
    for p, r in s.items():
        for c in r["checks"]:
            print(f"  {p:20s} {c['metric']:30s} {c['value'] if c['value'] is None else round(c['value'], 2)} {c['op']} {c['target']}  {'PASS' if c['pass'] else 'FAIL'}")
