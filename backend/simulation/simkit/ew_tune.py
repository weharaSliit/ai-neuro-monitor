"""Early-warning parameter tuning on HELD-OUT seeds, as the design requires:
choose parameters on the development seeds (500-519) only, then report them
once on fresh confirmation seeds (900-919) never used for choosing. The
pre-registered default run (seeds 100-119) is reported separately and unchanged.

Detectors are re-run on the stored per-block inputs (evaluate.py saves
ew_inputs for the ramp scenario), so no re-simulation is needed.

  PYTHONPATH=../..:. ../../venv/bin/python -m simkit.ew_tune
"""
import itertools
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from backend.common.early_warning import EWParams
from .evaluate import early_warning, ew_metrics

OUT = Path(__file__).resolve().parents[1] / "output" / "simkit"
TARGET_PROFILES = ("typical", "eeg_strong_ring_weak")


def rerun(run, params):
    inp = run["ew_inputs"]
    live = [dict(r) for r in inp["rows"]]
    engine = (SimpleNamespace(z_alert=inp["z_alert"], mu_rest_logit=inp["mu_rest_logit"], direction=inp["direction"], sigma=inp["sigma"])
              if inp["mu_rest_logit"] is not None else None)
    thr = {"calibration_status": inp["eeg_status"], "rest_scores": inp["eeg_rest"] or []}
    ring = {"limit": inp["ring_limit"], "rest": inp["ring_rest"] or []}
    early_warning(live, engine, thr, ring, inp["ring_present"], params)
    return ew_metrics(live, [tuple(p) for p in inp["periods"]])


def score(runs, params):
    agg = {}
    for prof in TARGET_PROFILES:
        rs = [rerun(r, params) for r in runs if r["profile"] == prof and "ew_inputs" in r]
        for comp in ("mind", "fused"):
            act = [m for m in rs if (m.get(f"{comp}_ew_limited_share") or 0) < 0.5]
            for k in ("ew_sensitivity", "ew_precision", "ew_false_per_hour_calm", "ew_lead_time_s"):
                v = [m[f"{comp}_{k}"] for m in act if m.get(f"{comp}_{k}") is not None]
                agg[f"{prof}.{comp}_{k}"] = float(np.mean(v)) if v else None
    sens = [v for k, v in agg.items() if k.endswith("ew_sensitivity") and v is not None]
    false = [v for k, v in agg.items() if k.endswith("false_per_hour_calm") and v is not None]
    prec = [v for k, v in agg.items() if k.endswith("ew_precision") and v is not None]
    feasible = all(f <= 2.0 for f in false) and all(p >= 0.5 for p in prec)
    return (float(np.mean(sens)) if sens else 0.0), feasible, agg


def main():
    dev = [r for r in json.loads((OUT / "results_ramp_dev.json").read_text())["runs"] if "error" not in r]
    conf = [r for r in json.loads((OUT / "results_ramp_confirm.json").read_text())["runs"] if "error" not in r]
    grid = []
    for n, kf, buf, rise, alpha in itertools.product((6, 8, 10), (0.5, 0.67), (0.5, 0.25, 0.0), (0.5, 0.25), (0.3, 0.5)):
        p = EWParams(n=n, k=max(2, round(kf * n)), buffer_spreads=buf, rise_spreads=rise, alpha=alpha)
        s, feas, agg = score(dev, p)
        grid.append((feas, s, p, agg))
    grid.sort(key=lambda g: (g[0], g[1]), reverse=True)
    best = grid[0]
    default = score(dev, EWParams())
    c_best, c_feas, c_agg = score(conf, best[2])
    c_def = score(conf, EWParams())
    res = {"chosen_on": "dev seeds 500-519", "confirmed_on": "seeds 900-919",
           "default_params": EWParams().__dict__, "chosen_params": best[2].__dict__,
           "dev": {"default": default[2], "chosen": best[3], "chosen_feasible": best[0]},
           "confirm": {"default": c_def[2], "chosen": c_agg, "chosen_feasible": c_feas},
           "top5_dev": [{"params": g[2].__dict__, "feasible": g[0], "mean_sensitivity": g[1]} for g in grid[:5]]}
    (OUT / "ew_tuning.json").write_text(json.dumps(res, indent=1, default=float))
    print("chosen on dev:", best[2], "feasible", best[0], f"mean sensitivity {best[1]:.2f} (default {default[0]:.2f})")
    print("\nconfirmation seeds (never used for choosing):")
    for k in sorted(c_agg):
        d, c = c_def[2][k], c_agg[k]
        fmt = lambda v: "—" if v is None else f"{v:.2f}"  # noqa: E731
        print(f"  {k:45s} default {fmt(d):>6s}  chosen {fmt(c):>6s}")


if __name__ == "__main__":
    main()
