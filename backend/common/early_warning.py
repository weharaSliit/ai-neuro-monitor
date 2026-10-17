"""
Early warning: "rising towards high load" -- for the MIND (EEG) and the FUSED
value. The body (HRV/GSR) keeps its own prediction-vs-limit rule; no trend.

Per component, with its calibrated baseline b, high-load limit th and rest
spread s (mind: oriented log-odds; fused: fusion scale):

  warning band   b + 0.5 s  <=  value  <  th
  every block, over the last N = 6 blocks (~2.5 min):
    enough data   >= N-1 valid blocks (gate-rejected blocks don't count)
    in the band   the EWMA (alpha 0.3) of the valid values is in the band
    considerable  >= 4 of the valid blocks at/above b + 0.5 s
    rising        Theil-Sen slope > 0 and slope x (N-1) >= 0.5 s
    persistence   all of the above on 2 consecutive blocks -> EARLY WARNING
  clear           slope <= 0 and EWMA below the band on 2 consecutive blocks,
                  or escalation to HIGH (the existing 2-of-3 rule wins)
  cooldown        7 blocks (~3 min) after a warning clears
  states          normal / early_warning / high / recovering / limited
  limited         the component's calibration can't support a band
                  (mind: not_separated / drift_suspected; fused: stale or
                  missing ring baseline) -- no warnings, says why

Mirrored exactly in psy_web/src/lib/earlyWarning.js (same rules, same
Theil-Sen) -- tests in test_early_warning.py check both on the same inputs.
This module only computes; the deployed services do not call it yet.
"""
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class EWParams:
    n: int = 6                 # window, blocks
    k: int = 4                 # "considerable number" at/above the band floor
    buffer_spreads: float = 0.5
    rise_spreads: float = 0.5
    alpha: float = 0.3         # EWMA
    persist: int = 2
    clear_blocks: int = 2
    cooldown_blocks: int = 7


DEFAULT = EWParams()


def theil_sen(xs, ys):
    """Median of all pairwise slopes (robust trend)."""
    slopes = sorted((ys[j] - ys[i]) / (xs[j] - xs[i])
                    for i in range(len(xs)) for j in range(i + 1, len(xs)) if xs[j] != xs[i])
    if not slopes:
        return 0.0
    m = len(slopes)
    return slopes[m // 2] if m % 2 else 0.5 * (slopes[m // 2 - 1] + slopes[m // 2])


class EarlyWarning:
    def __init__(self, baseline, limit, spread, params: EWParams = DEFAULT):
        self.p = params
        self.b, self.th, self.s = float(baseline), float(limit), float(spread)
        self.lo = self.b + params.buffer_spreads * self.s
        self.rise = params.rise_spreads * self.s
        self.win = deque(maxlen=params.n)
        self.ewma = None
        self.state = "normal"
        self.hits = self.clear_hits = self.cooldown = 0

    def _stats(self):
        pts = [(i, v) for i, v in enumerate(self.win) if v is not None]
        vals = [v for _, v in pts]
        slope = theil_sen([i for i, _ in pts], vals) if len(pts) >= 3 else 0.0
        return vals, slope

    def update(self, value, valid=True, suppressed=None, high_alert=False):
        """One block. value on the component's scale; suppressed = reason
        string (or None); high_alert = the existing 2-of-3 rule's verdict."""
        p = self.p
        ok = valid and value is not None
        self.win.append(float(value) if ok else None)
        if ok:
            self.ewma = value if self.ewma is None else p.alpha * value + (1 - p.alpha) * self.ewma
        vals, slope = self._stats()
        enough = len(vals) >= p.n - 1
        above = sum(v >= self.lo for v in vals)
        in_band = self.ewma is not None and self.lo <= self.ewma < self.th
        rising = slope > 0 and slope * (p.n - 1) >= self.rise
        cond = enough and in_band and above >= p.k and rising
        zone = None if self.ewma is None else ("above" if self.ewma >= self.th else "band" if self.ewma >= self.lo else "below")
        reason = None
        if high_alert:
            self.state, self.hits, self.clear_hits = "high", 0, 0
        elif suppressed:
            self.state, self.hits, self.clear_hits, reason = "limited", 0, 0, suppressed
        else:
            if self.state == "high":
                self.state = "recovering" if (self.ewma is not None and self.ewma >= self.lo) else "normal"
            elif self.state == "limited":
                self.state = "normal"
            if self.state in ("normal", "recovering"):
                if self.state == "recovering" and (self.ewma is None or self.ewma < self.lo):
                    self.state = "normal"
                if self.cooldown:
                    self.cooldown -= 1
                self.hits = self.hits + 1 if (cond and self.cooldown == 0) else 0
                if self.hits >= p.persist:
                    self.state, self.hits, self.clear_hits = "early_warning", 0, 0
            elif self.state == "early_warning":
                below = self.ewma is not None and self.ewma < self.lo
                self.clear_hits = self.clear_hits + 1 if (slope <= 0 and below) else 0
                if self.clear_hits >= p.clear_blocks:
                    self.state, self.clear_hits, self.cooldown = "normal", 0, p.cooldown_blocks
            if not enough and self.state == "normal":
                reason = "not enough valid blocks"
        return {"state": self.state, "ewma": self.ewma, "slope": slope, "blocks_above": above,
                "n_valid": len(vals), "zone": zone, "reason": reason, "band": (self.lo, self.th)}


def mind_led(mind_state, body_value, body_limit=0.5):
    """Pre-stress signature: mind in early warning / high while the body is
    still below its own limit (body_value on the fusion scale)."""
    return mind_state in ("early_warning", "high") and body_value is not None and body_value < body_limit
