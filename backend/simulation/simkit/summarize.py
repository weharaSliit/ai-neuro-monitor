"""Per-profile summary of the multi-seed evaluation: mean, SD and 95% CI of
every metric, calibration outcome shares, fusion weights, and the pass
criteria fixed in criteria.json (SIMULATED -- software-in-the-loop)."""
import json
import math
from pathlib import Path

import numpy as np
from scipy import stats as st

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "output" / "simkit"
METRICS = [f"{k}_{m}" for k in ("mind", "body", "fused", "fused_equal") for m in ("alert_rate_demand", "false_alarm_rate_calm")]
TIMES = [f"{k}_{m}" for k in ("mind", "body", "fused") for m in ("time_to_alert_s", "time_to_clear_s")]


def ci(vals):
    a = np.array([v for v in vals if v is not None and not (isinstance(v, float) and math.isnan(v))], float)
    if len(a) == 0:
        return {"n": 0, "mean": None, "sd": None, "lo": None, "hi": None}
    if len(a) == 1:
        return {"n": 1, "mean": float(a[0]), "sd": 0.0, "lo": float(a[0]), "hi": float(a[0])}
    h = st.t.ppf(0.975, len(a) - 1) * a.std(ddof=1) / math.sqrt(len(a))
    return {"n": int(len(a)), "mean": float(a.mean()), "sd": float(a.std(ddof=1)), "lo": float(a.mean() - h), "hi": float(a.mean() + h)}


def summarize(results=None, name="results.json"):
    results = results or json.loads((OUT / name).read_text())
    runs = [r for r in results["runs"] if "error" not in r]
    crit = json.loads((HERE / "criteria.json").read_text())["pass_criteria"]
    out = {}
    for p in results["meta"]["profiles"]:
        rs = [r for r in runs if r["profile"] == p]
        s = {m: ci([r.get(m) for r in rs]) for m in METRICS + ["gate_rejection_rate", "w_eeg_mean", "w_ring_mean", "fused_equals_mind_share"]}
        for m in TIMES:   # per demand period; 'none' = no alert in that period (counted separately)
            vals = [x for r in rs for x in (r.get(m) or [])]
            s[m] = ci([x for x in vals if x is not None])
            s[m]["none_share"] = (sum(x is None for x in vals) / len(vals)) if vals else None
        n = len(rs)
        st_e = [r.get("eeg_status") for r in rs]
        s["eeg_status_ok_share"] = {"mean": st_e.count("ok") / n if n else None}
        s["eeg_status_not_ok_share"] = {"mean": 1 - st_e.count("ok") / n if n else None}
        s["eeg_status_counts"] = {k: st_e.count(k) for k in sorted(set(map(str, st_e)))}
        ok = [r for r in rs if r.get("eeg_status") == "ok"]
        s["eeg_direction_minus_share_of_ok"] = {"mean": (sum(r.get("eeg_direction") == -1 for r in ok) / len(ok)) if ok else None}
        s["ring_status_counts"] = {k: [r.get("ring_status") for r in rs].count(k) for k in sorted(set(str(r.get("ring_status")) for r in rs))}
        checks = []
        for metric, (op, val) in crit.get(p, {}).items():
            v = s.get(metric, {}).get("mean")
            ok_ = None if v is None else {">=": v >= val, "<=": v <= val, ">": v > val}[op]
            checks.append({"metric": metric, "op": op, "target": val, "value": v, "pass": ok_})
        s["checks"] = checks
        s["n_runs"] = n
        out[p] = s
    (OUT / name.replace("results", "summary")).write_text(json.dumps(out, indent=1, default=float))
    return out


if __name__ == "__main__":
    import sys
    s = summarize(name=sys.argv[1] if len(sys.argv) > 1 else "results.json")
    f = lambda d: "   —   " if not d or d.get("mean") is None else f"{100 * d['mean']:3.0f}% [{100 * d['lo']:3.0f},{100 * d['hi']:3.0f}]"  # noqa: E731
    print(f"{'profile':22s} {'EEG calibration':32s} | alert in demand: mind / body / fused        | false alarm in calm: mind / body / fused     | w_eeg")
    for p, x in s.items():
        print(f"{p:22s} {str(x['eeg_status_counts']):32s} | {f(x['mind_alert_rate_demand'])} {f(x['body_alert_rate_demand'])} {f(x['fused_alert_rate_demand'])} | "
              f"{f(x['mind_false_alarm_rate_calm'])} {f(x['body_false_alarm_rate_calm'])} {f(x['fused_false_alarm_rate_calm'])} | "
              f"{'—' if x['w_eeg_mean']['mean'] is None else round(x['w_eeg_mean']['mean'], 2)} | equal weights: {f(x['fused_equal_alert_rate_demand'])} {f(x['fused_equal_false_alarm_rate_calm'])}")
    print()
    for p, x in s.items():
        print(p, "ring", x["ring_status_counts"], "| checks:", ", ".join(f"{c['metric']} {c['value'] if c['value'] is None else round(c['value'], 2)} {c['op']} {c['target']} {'PASS' if c['pass'] else 'FAIL'}" for c in x["checks"]))
