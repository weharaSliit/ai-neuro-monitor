"""
trend_detector.py — personal-baseline CUSUM trend/changepoint detector.

WHY THIS EXISTS
----------------
spiral_predictor.py's SpiralLSTM predicts risk K_AHEAD=20 epochs (10s)
ahead. That target is built from DEAP/SAM40 labels that are constant
across an entire ~60s trial (one self-report rating per trial, replicated
onto every 0.5s epoch) — so "K_AHEAD epochs ahead" almost always fetches
the SAME static label as the current epoch. There is no real within-trial
onset signal in the training data, which is why lead-time can't just be
extended by raising K_AHEAD (SEQ_LEN+K_AHEAD is hard-capped around 80
epochs / 40s by DEAP trial length), and why spiral_report.json's lead-time
analysis is empty (all-null).

This module sidesteps that broken-label problem entirely: instead of
classifying "will epoch t+K be labeled stressed", it identifies each
user's own resting baseline in the first ~30 seconds of a session, freezes
it, and then watches the ALREADY-VALIDATED per-epoch p_emo signal for a
SUSTAINED deviation above that fixed personal reference, using a CUSUM
(cumulative sum) control chart — a standard early-shift-detection
technique from statistical process control. It needs no onset-timed
labels, only ~30s of resting data, and can flag a slow-building trend
minutes before p_emo alone would cross the STRESSED threshold.

Baseline design — fixed reference + slow drift monitor
--------------------------------------------------------
The PRIMARY reference used for detection is a FixedBaseline: identified
once from the first CALIBRATION_S (~30s) of the session and then frozen.
This is deliberate — "learn what calm looks like for this user in ~30s,
then watch for meaningful, sustained increases relative to THAT", rather
than a continuously-drifting reference that could slowly absorb a real
building stress trend and erase the very contrast we're trying to detect.

A secondary RollingBaseline (10-minute window, CALM-only epochs) still
runs in parallel purely as a slow drift monitor (exposed via
TrendResult.rolling_baseline_mu) — it does not gate the alarm. This keeps
the online-personalization signal available (e.g. for future dashboard
display of "your resting level has drifted from X to Y this session")
without letting it mask a genuine sustained rise.
"""

from collections import deque
from dataclasses import dataclass

import numpy as np

# ── tunable constants (standard CUSUM/SPC defaults — see Montgomery, ─────
#    "Introduction to Statistical Quality Control": k=0.5σ, h=4-5σ) ──────

CALIBRATION_S           = 30.0   # fixed subject-specific baseline window
CALIBRATION_MIN_N       = 40     # minimum valid epochs before the baseline may freeze (~20s)
CALIBRATION_MAX_EXTEND_S = 60.0  # hard cap — freeze anyway if samples are sparse (dropouts etc.)

ROLLING_WINDOW_S    = 600.0  # secondary drift-monitoring window (CALM epochs only)
ROLLING_MIN_N       = 20
ROLLING_REFRESH_S   = 15.0

CUSUM_SLACK_SIGMA    = 0.5   # k: allowance, in units of baseline sigma
CUSUM_DECISION_SIGMA = 5.0   # h: alarm threshold, in units of baseline sigma
CUSUM_RESET_SIGMA    = 0.5   # cumulative sum decays toward 0 once value drops back this close to baseline

SUSTAIN_S        = 20.0   # an alarm must persist this long before PRE-STAGE fires
SUSTAIN_FRACTION = 0.7    # ...for at least this fraction of the sustain window

MIN_SIGMA = 0.02   # floor on baseline sigma so near-zero-noise segments don't
                    # make CUSUM hypersensitive to tiny fluctuations


@dataclass
class TrendResult:
    calibrating: bool
    baseline_mu: float
    baseline_sigma: float
    rolling_baseline_mu: float   # secondary slow drift-monitor, informational only
    cusum: float
    trend_score: float      # cusum expressed in sigma units — comparable across users
    trend_alarm: bool       # sustained-drift early warning


@dataclass
class _Sample:
    t: float
    v: float


class FixedBaseline:
    """
    Subject-specific baseline identified ONCE from the first
    `calibration_s` seconds of a session, then frozen for the rest of the
    session. This is the primary reference for pre-stage detection: learn
    what "calm" looks like for this user quickly, then watch for
    meaningful, sustained deviation from that fixed point.

    If too few valid samples arrive in the nominal window (e.g. dry-
    electrode dropouts), the window extends up to `max_extend_s` rather
    than freezing on too little data.
    """

    def __init__(self,
                 calibration_s: float = CALIBRATION_S,
                 min_n: int = CALIBRATION_MIN_N,
                 max_extend_s: float = CALIBRATION_MAX_EXTEND_S):
        self.calibration_s = calibration_s
        self.min_n = min_n
        self.max_extend_s = max_extend_s
        self._samples: list[float] = []
        self._t0: float | None = None
        self.mu: float = 0.15
        self.sigma: float = 0.10
        self.frozen: bool = False

    def update(self, t: float, value: float):
        if self.frozen:
            return
        if self._t0 is None:
            self._t0 = t
        self._samples.append(value)

        elapsed = t - self._t0
        window_closed = elapsed >= self.calibration_s
        enough_samples = len(self._samples) >= self.min_n
        past_max = elapsed >= self.max_extend_s

        if (window_closed and enough_samples) or (past_max and self._samples):
            vals = np.array(self._samples, dtype=np.float64)
            med = float(np.median(vals))
            mad = float(np.median(np.abs(vals - med)))
            self.mu = med
            self.sigma = max(MIN_SIGMA, 1.4826 * mad)
            self.frozen = True

    @property
    def ready(self) -> bool:
        return self.frozen


class RollingBaseline:
    """
    Secondary, continuously-updated resting-state baseline (mu, sigma)
    re-estimated online from recent CALM-only epochs. Used only as a slow
    drift monitor (see module docstring) — it does NOT feed the CUSUM
    alarm, so a genuine sustained rise can't slowly get absorbed into
    "the new normal" and disappear.
    """

    def __init__(self, window_s: float = ROLLING_WINDOW_S, min_n: int = ROLLING_MIN_N):
        self.window_s = window_s
        self.min_n = min_n
        self._buf: deque[_Sample] = deque()
        self.mu: float = 0.15
        self.sigma: float = 0.10
        self.ready: bool = False
        self._last_refresh_t: float = -1e9

    def add_calm_sample(self, t: float, value: float):
        self._buf.append(_Sample(t, value))
        cutoff = t - self.window_s
        while self._buf and self._buf[0].t < cutoff:
            self._buf.popleft()

    def maybe_refresh(self, t: float):
        if t - self._last_refresh_t < ROLLING_REFRESH_S:
            return
        self._last_refresh_t = t
        if len(self._buf) < self.min_n:
            return
        vals = np.array([s.v for s in self._buf], dtype=np.float64)
        med = float(np.median(vals))
        mad = float(np.median(np.abs(vals - med)))
        self.mu = med
        self.sigma = max(MIN_SIGMA, 1.4826 * mad)
        self.ready = True


class CusumTrendDetector:
    """One-sided CUSUM for detecting a sustained upward shift from baseline."""

    def __init__(self,
                 slack_sigma: float = CUSUM_SLACK_SIGMA,
                 decision_sigma: float = CUSUM_DECISION_SIGMA,
                 reset_sigma: float = CUSUM_RESET_SIGMA):
        self.slack_sigma = slack_sigma
        self.decision_sigma = decision_sigma
        self.reset_sigma = reset_sigma
        self.s = 0.0

    def update(self, value: float, mu: float, sigma: float) -> tuple[float, bool]:
        sigma = max(sigma, MIN_SIGMA)
        k = self.slack_sigma * sigma
        h = self.decision_sigma * sigma

        self.s = max(0.0, self.s + (value - mu - k))
        if value <= mu + self.reset_sigma * sigma:
            # back near baseline — let the accumulator decay rather than
            # hard-reset, so brief dips don't erase a real building trend
            self.s *= 0.5

        score_sigma = self.s / sigma
        alarm = self.s > h
        return score_sigma, alarm


class PersonalTrendMonitor:
    """
    Combines FixedBaseline (primary, ~30s) + RollingBaseline (secondary
    drift monitor) + CusumTrendDetector + a sustained-duration gate into
    the single per-epoch call used by StressInferenceEngine.
    """

    def __init__(self,
                 calibration_s: float = CALIBRATION_S,
                 sustain_s: float = SUSTAIN_S,
                 sustain_fraction: float = SUSTAIN_FRACTION):
        self.calibration_s = calibration_s
        self.sustain_s = sustain_s
        self.sustain_fraction = sustain_fraction

        self.fixed_baseline = FixedBaseline(calibration_s=calibration_s)
        self.rolling_baseline = RollingBaseline()
        self.cusum = CusumTrendDetector()
        self._alarm_history: deque[_Sample] = deque()

    def reset(self):
        self.fixed_baseline = FixedBaseline(calibration_s=self.calibration_s)
        self.rolling_baseline = RollingBaseline()
        self.cusum = CusumTrendDetector()
        self._alarm_history.clear()

    def update(self, time_s: float, p_emo: float, is_calm: bool) -> TrendResult:
        self.fixed_baseline.update(time_s, p_emo)

        if is_calm:
            self.rolling_baseline.add_calm_sample(time_s, p_emo)
        self.rolling_baseline.maybe_refresh(time_s)

        calibrating = not self.fixed_baseline.ready

        if calibrating:
            score, raw_alarm = 0.0, False
        else:
            score, raw_alarm = self.cusum.update(
                p_emo, self.fixed_baseline.mu, self.fixed_baseline.sigma
            )

        # sustained-duration gate: require the raw CUSUM alarm to hold for
        # most of the last `sustain_s` seconds before calling it PRE-STAGE,
        # so a single noisy/artifact epoch can't fire an early warning
        self._alarm_history.append(_Sample(time_s, 1.0 if raw_alarm else 0.0))
        cutoff = time_s - self.sustain_s
        while self._alarm_history and self._alarm_history[0].t < cutoff:
            self._alarm_history.popleft()

        have_full_window = (self._alarm_history[0].t <= cutoff + 1e-6) if self._alarm_history else False
        if calibrating or not have_full_window:
            sustained_alarm = False
        else:
            frac = float(np.mean([s.v for s in self._alarm_history]))
            sustained_alarm = frac >= self.sustain_fraction

        return TrendResult(
            calibrating=calibrating,
            baseline_mu=round(self.fixed_baseline.mu, 4),
            baseline_sigma=round(self.fixed_baseline.sigma, 4),
            rolling_baseline_mu=round(self.rolling_baseline.mu, 4),
            cusum=round(self.cusum.s, 4),
            trend_score=round(score, 3),
            trend_alarm=bool(sustained_alarm),
        )
