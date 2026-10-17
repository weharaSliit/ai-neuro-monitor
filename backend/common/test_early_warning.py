"""Tests for early_warning.py (and the shared vectors psy_web's
earlyWarning.js is checked against: test_vectors_early_warning.json).

  venv/bin/python -m backend.common.test_early_warning
"""
import json
import math
from pathlib import Path

from backend.common.early_warning import EarlyWarning, mind_led, theil_sen

VECTORS = Path(__file__).with_name("test_vectors_early_warning.json")


def run(values, valid=None, suppressed=None, high=None, b=0.0, th=2.0, s=1.0):
    ew = EarlyWarning(b, th, s)
    out = []
    for i, v in enumerate(values):
        out.append(ew.update(v, valid=True if valid is None else valid[i],
                             suppressed=None if suppressed is None else suppressed[i],
                             high_alert=False if high is None else high[i])["state"])
    return out


CASES = {
    # flat at rest -> never warns
    "flat_rest": dict(values=[0.1, -0.2, 0.0, 0.2, -0.1, 0.1, 0.0, -0.1, 0.1, 0.0]),
    # slow ramp from rest into the band (limit 2.0, band from 0.5) -> warns before the limit
    "ramp_into_band": dict(values=[0.0, 0.1, 0.0, 0.3, 0.6, 0.8, 1.0, 1.1, 1.3, 1.4, 1.5, 1.6]),
    # one spike only -> no warning
    "single_spike": dict(values=[0.0, 0.1, 1.8, 0.0, 0.1, 0.0, 0.1, 0.0, 0.1, 0.0]),
    # plateau in the band, not rising -> no warning
    "flat_plateau": dict(values=[1.0, 1.1, 0.9, 1.0, 1.1, 1.0, 0.9, 1.0, 1.1, 1.0]),
    # ramp, then the 2-of-3 rule fires HIGH, then falls back through the band (recovering) to normal
    "escalate_recover": dict(values=[0.0, 0.2, 0.5, 0.8, 1.0, 1.2, 1.4, 2.2, 2.4, 1.2, 0.9, 0.3, 0.1, 0.0, 0.0, 0.1, 0.0],
                             high=[False] * 7 + [True, True] + [False] * 8),
    # gappy data: too few valid blocks -> no decision
    "gappy": dict(values=[0.0, 0.3, 0.6, 0.9, 1.2, 1.4, 1.5, 1.6],
                  valid=[True, False, True, False, True, False, True, False]),
    # suppressed (calibration not separated) -> limited, never warns
    "suppressed": dict(values=[0.0, 0.1, 0.0, 0.3, 0.6, 0.8, 1.0, 1.1, 1.3, 1.4],
                       suppressed=["calibration not separated"] * 10),
}


def main():
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        print(("[PASS] " if cond else "[FAIL] ") + name + (f" -- {detail}" if detail and not cond else ""))
        ok = ok and cond

    check("Theil-Sen of a line is its slope", math.isclose(theil_sen([0, 1, 2, 3], [1, 3, 5, 7]), 2.0))
    check("Theil-Sen ignores one outlier", math.isclose(theil_sen([0, 1, 2, 3, 4], [0, 1, 20, 3, 4]), 1.0))
    res = {k: run(**v) for k, v in CASES.items()}
    check("flat rest never warns", "early_warning" not in res["flat_rest"], res["flat_rest"])
    r = res["ramp_into_band"]
    check("a slow ramp into the band warns before the limit", "early_warning" in r, r)
    check("a single spike doesn't warn", "early_warning" not in res["single_spike"], res["single_spike"])
    check("a flat plateau in the band doesn't warn", "early_warning" not in res["flat_plateau"], res["flat_plateau"])
    e = res["escalate_recover"]
    check("warning, then HIGH, then recovering, then normal",
          "early_warning" in e and e.index("early_warning") < e.index("high") and "recovering" in e and e[-1] == "normal", e)
    check("gappy data doesn't warn", "early_warning" not in res["gappy"], res["gappy"])
    check("suppressed component is 'limited'", set(res["suppressed"]) == {"limited"}, res["suppressed"])
    check("mind-led = mind warning while the body is below its limit",
          mind_led("early_warning", 0.3) and not mind_led("early_warning", 0.7) and not mind_led("normal", 0.3))
    VECTORS.write_text(json.dumps({k: {**v, "expected": res[k]} for k, v in CASES.items()}, indent=1))
    print("vectors written for the JS port:", VECTORS.name)
    print("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED")
    return ok


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
