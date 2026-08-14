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
from typing import Optional

import numpy as np
from sklearn.covariance import LedoitWolf

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

MIN_SIGMA_DIST = 0.05   # same floor, in Mahalanobis-distance units, for
                         # FeatureSpaceBaseline's distance-CUSUM

# ── Shock detector (combined Shewhart+CUSUM scheme, Montgomery) ──────────
# CUSUM above is tuned for small SUSTAINED shifts and is deliberately slow
# (20s dwell) to stay false-alarm-free. A genuinely abrupt shift needs a
# different rule: a short-window "already way outside normal" check, at
# the cost of requiring a much bigger deviation to fire at all. Run
# alongside (not instead of) the CUSUM detectors.
SHOCK_WINDOW_N       = 3     # short window (~1.5s @ 0.5s stride) checked for a majority-over-bar pattern
SHOCK_SIGMA          = 4.0   # bar, in baseline-sigma units — higher than CUSUM's cumulative 5.0
                              # decision threshold since this has no accumulation to smooth noise
SHOCK_MAJORITY_FRACTION = 0.6   # fraction of SHOCK_WINDOW_N that must exceed the bar (0.6 of 3 -> 2 of 3)
SHOCK_CROSS_WINDOW_S = 3.0   # how close in time the p_emo-shock and feature-shock triggers must be
                              # to corroborate each other into a confirmed SUDDEN-SHIFT alarm


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


class _SustainGate:
    """
    Requires a raw (single-epoch) alarm to hold for most of the last
    `sustain_s` seconds before confirming it, so one noisy/artifact epoch
    can't fire an early warning alone. Shared by PersonalTrendMonitor
    (gates on p_emo deviation) and FeatureTrendMonitor (gates on
    multivariate feature-space deviation) — same logic, same behavior,
    kept in one place rather than duplicated.
    """

    def __init__(self, sustain_s: float = SUSTAIN_S, sustain_fraction: float = SUSTAIN_FRACTION):
        self.sustain_s = sustain_s
        self.sustain_fraction = sustain_fraction
        self._history: deque[_Sample] = deque()

    def reset(self):
        self._history.clear()

    def update(self, time_s: float, raw_alarm: bool, calibrating: bool) -> bool:
        self._history.append(_Sample(time_s, 1.0 if raw_alarm else 0.0))
        cutoff = time_s - self.sustain_s
        while self._history and self._history[0].t < cutoff:
            self._history.popleft()

        have_full_window = (self._history[0].t <= cutoff + 1e-6) if self._history else False
        if calibrating or not have_full_window:
            return False
        frac = float(np.mean([s.v for s in self._history]))
        return frac >= self.sustain_fraction


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
        self._gate = _SustainGate(sustain_s, sustain_fraction)

    def reset(self):
        self.fixed_baseline = FixedBaseline(calibration_s=self.calibration_s)
        self.rolling_baseline = RollingBaseline()
        self.cusum = CusumTrendDetector()
        self._gate.reset()

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
        sustained_alarm = self._gate.update(time_s, raw_alarm, calibrating)

        return TrendResult(
            calibrating=calibrating,
            baseline_mu=round(self.fixed_baseline.mu, 4),
            baseline_sigma=round(self.fixed_baseline.sigma, 4),
            rolling_baseline_mu=round(self.rolling_baseline.mu, 4),
            cusum=round(self.cusum.s, 4),
            trend_score=round(score, 3),
            trend_alarm=bool(sustained_alarm),
        )


class FeatureSpaceBaseline:
    """
    Multivariate counterpart to FixedBaseline: instead of baselining the
    single p_emo scalar, this baselines the deployed student model's full
    feature vector (see extract_student_features / feature_extraction.py —
    PSD band power, differential entropy, Hjorth parameters, spectral
    shape, nonlinear/entropy, T7-T8 connectivity), frozen once from the
    same ~30s calibration window as FixedBaseline.

    Rationale: p_emo only reflects what the classifier's single output
    neuron changed by. A user's EEG can drift meaningfully in a direction
    the classifier under-weights (e.g. a feature that wasn't very
    predictive in the training population) without moving p_emo much.
    Tracking multivariate distance from the personal baseline surfaces
    that drift directly — a second, independent corroborating signal
    alongside the p_emo-based CUSUM in PersonalTrendMonitor.

    Ledoit-Wolf shrinkage covariance is used instead of the raw sample
    covariance because the ~30-60s calibration window yields far fewer
    samples (~60-120 epochs) than feature dimensions (76) — an ordinary
    covariance estimate would be singular/ill-conditioned; shrinkage
    toward a scaled identity keeps it invertible and well-behaved.
    """

    def __init__(self,
                 calibration_s: float = CALIBRATION_S,
                 min_n: int = CALIBRATION_MIN_N,
                 max_extend_s: float = CALIBRATION_MAX_EXTEND_S):
        self.calibration_s = calibration_s
        self.min_n = min_n
        self.max_extend_s = max_extend_s
        self._samples: list[np.ndarray] = []
        self._t0: Optional[float] = None

        self.mean_: Optional[np.ndarray] = None
        self.precision_: Optional[np.ndarray] = None
        self.dist_mu: float = 1.0
        self.dist_sigma: float = 1.0
        self.frozen: bool = False

    def _mahalanobis(self, feat: np.ndarray) -> float:
        d = feat - self.mean_
        return float(np.sqrt(max(float(d @ self.precision_ @ d), 0.0)))

    def update(self, t: float, feat: np.ndarray) -> Optional[float]:
        """Feed one epoch's feature vector. Returns the Mahalanobis
        distance from the frozen baseline once ready, else None while
        still calibrating (mirrors FixedBaseline.update)."""
        feat = np.asarray(feat, dtype=np.float64)

        if self.frozen:
            return self._mahalanobis(feat)

        if self._t0 is None:
            self._t0 = t
        self._samples.append(feat)

        elapsed = t - self._t0
        window_closed = elapsed >= self.calibration_s
        enough_samples = len(self._samples) >= self.min_n
        past_max = elapsed >= self.max_extend_s

        if (window_closed and enough_samples) or (past_max and self._samples):
            self._freeze()
            return self._mahalanobis(feat)
        return None

    def _freeze(self):
        X = np.stack(self._samples)
        n = len(X)

        # Final baseline used for every future live epoch: fit on the
        # full calibration set.
        lw = LedoitWolf().fit(X)
        self.mean_ = lw.location_
        self.precision_ = lw.precision_

        # The "typical distance" reference must come from OUT-OF-SAMPLE
        # points, not the same points the covariance was fit on: for a
        # finite-sample covariance estimate, in-sample Mahalanobis
        # distances are systematically smaller than distances to a fresh,
        # equally-calm point (verified empirically — ~11% of genuinely
        # stationary fresh points already read >2sigma "elevated" against
        # an in-sample reference). Left uncorrected this makes the CUSUM
        # alarm far too often regardless of any real deviation. Leave-
        # one-out over the calibration set gives an honest reference
        # without sacrificing calibration data to a held-out split — the
        # LedoitWolf refits are cheap (~n calls, done once at freeze).
        loo_dists = np.empty(n)
        idx = np.arange(n)
        for i in range(n):
            lw_i = LedoitWolf().fit(X[idx != i])
            d = X[i] - lw_i.location_
            loo_dists[i] = float(np.sqrt(max(float(d @ lw_i.precision_ @ d), 0.0)))

        med = float(np.median(loo_dists))
        mad = float(np.median(np.abs(loo_dists - med)))
        self.dist_mu = med
        self.dist_sigma = max(MIN_SIGMA_DIST, 1.4826 * mad)
        self.frozen = True

    @property
    def ready(self) -> bool:
        return self.frozen


@dataclass
class FeatureTrendResult:
    calibrating: bool
    feature_dist: Optional[float]         # raw Mahalanobis distance from baseline; None while calibrating
    feature_dist_mu: Optional[float]      # calibration-period typical distance
    feature_dist_sigma: Optional[float]
    feature_trend_score: float            # CUSUM score, in baseline-distance-sigma units
    feature_trend_alarm: bool             # sustained multivariate deviation — corroborating signal


class FeatureTrendMonitor:
    """
    Multivariate counterpart to PersonalTrendMonitor: instead of watching
    p_emo, watches the full feature vector's Mahalanobis distance from
    this user's own frozen baseline, through the same CUSUM +
    sustained-gate design (see FeatureSpaceBaseline for why this is a
    useful complement to the p_emo-based signal, not a replacement).
    Meant to run alongside PersonalTrendMonitor as a second, independent
    corroborating signal. Unlike FixedBaseline, freezing here doesn't
    need an `is_calm` gate — it only depends on elapsed calibration time.
    """

    def __init__(self,
                 calibration_s: float = CALIBRATION_S,
                 sustain_s: float = SUSTAIN_S,
                 sustain_fraction: float = SUSTAIN_FRACTION):
        self.calibration_s = calibration_s
        self.sustain_s = sustain_s
        self.sustain_fraction = sustain_fraction

        self.baseline = FeatureSpaceBaseline(calibration_s=calibration_s)
        self.cusum = CusumTrendDetector()
        self._gate = _SustainGate(sustain_s, sustain_fraction)

    def reset(self):
        self.baseline = FeatureSpaceBaseline(calibration_s=self.calibration_s)
        self.cusum = CusumTrendDetector()
        self._gate.reset()

    def update(self, time_s: float, feat: np.ndarray) -> FeatureTrendResult:
        dist = self.baseline.update(time_s, feat)
        calibrating = not self.baseline.ready

        if calibrating or dist is None:
            score, raw_alarm = 0.0, False
        else:
            score, raw_alarm = self.cusum.update(dist, self.baseline.dist_mu, self.baseline.dist_sigma)

        sustained_alarm = self._gate.update(time_s, raw_alarm, calibrating)

        return FeatureTrendResult(
            calibrating=calibrating,
            feature_dist=round(dist, 4) if dist is not None else None,
            feature_dist_mu=round(self.baseline.dist_mu, 4) if self.baseline.ready else None,
            feature_dist_sigma=round(self.baseline.dist_sigma, 4) if self.baseline.ready else None,
            feature_trend_score=round(score, 3),
            feature_trend_alarm=bool(sustained_alarm),
        )


class ShewhartShockDetector:
    """
    Single-signal building block for ShockDetector: a short-window
    control-chart rule ("did a MAJORITY of the last `window_n` epochs sit
    above baseline_mu + shock_sigma*baseline_sigma") that reacts in a
    couple of seconds instead of CUSUM's 20s dwell — the classic Western
    Electric-style "k of n beyond limit" pattern, rather than requiring
    every single point.

    A strict "ALL n must exceed" rule was tried first and failed on real
    data: p_emo (the classifier's own output) is noisy enough epoch to
    epoch that a single random dip mid-shift resets an all-or-nothing
    streak, which pushed detection of a genuine, sustained shift out to
    120+ seconds in testing — worse than useless for something meant to
    react in seconds. Majority-of-n tolerates that per-epoch noise while
    still requiring several points, not just one.
    """

    def __init__(self, window_n: int = SHOCK_WINDOW_N, shock_sigma: float = SHOCK_SIGMA,
                 majority_fraction: float = SHOCK_MAJORITY_FRACTION):
        self.window_n = window_n
        self.shock_sigma = shock_sigma
        self.majority_fraction = majority_fraction
        self._recent: deque = deque(maxlen=window_n)

    def reset(self):
        self._recent.clear()

    def update(self, value: float, mu: float, sigma: float) -> tuple[float, bool]:
        sigma = max(sigma, MIN_SIGMA)
        over = value > mu + self.shock_sigma * sigma
        self._recent.append(over)

        raw_shock = (len(self._recent) == self.window_n and
                     sum(self._recent) >= self.majority_fraction * self.window_n)
        z = (value - mu) / sigma
        return z, raw_shock


@dataclass
class ShockResult:
    p_shock_raw: bool         # p_emo alone just Shewhart-triggered this epoch
    feature_shock_raw: bool   # feature-space distance alone just Shewhart-triggered this epoch
    shock_alarm: bool         # BOTH corroborate within the cross-validation window — confirmed
    p_shock_z: float
    feature_shock_z: float


class ShockDetector:
    """
    Fast, abrupt-transition complement to PersonalTrendMonitor +
    FeatureTrendMonitor. Runs a ShewhartShockDetector on p_emo AND one on
    the feature-space Mahalanobis distance (see FeatureSpaceBaseline), and
    only confirms a SUDDEN-SHIFT alarm when both have triggered within
    `cross_window_s` seconds of each other.

    This dual-signal requirement is what lets it use a window of a few
    epochs instead of CUSUM's 20s sustain without reopening the
    false-alarm problem: a genuine physiological shift should move both
    signals at roughly the same time, while a single noisy epoch or a
    sensor artifact on one channel is far less likely to also produce a
    matching excursion on the other, independent signal at the same time.

    Meant to run ALONGSIDE PersonalTrendMonitor/FeatureTrendMonitor, not
    replace them — those catch small sustained drift over minutes, this
    catches large abrupt jumps over seconds.
    """

    def __init__(self,
                 window_n: int = SHOCK_WINDOW_N,
                 shock_sigma: float = SHOCK_SIGMA,
                 cross_window_s: float = SHOCK_CROSS_WINDOW_S):
        self.cross_window_s = cross_window_s
        self.p_detector = ShewhartShockDetector(window_n, shock_sigma)
        self.f_detector = ShewhartShockDetector(window_n, shock_sigma)
        self._p_shock_times: deque = deque()
        self._f_shock_times: deque = deque()

    def reset(self):
        self.p_detector.reset()
        self.f_detector.reset()
        self._p_shock_times.clear()
        self._f_shock_times.clear()

    def _prune(self, times: deque, t: float):
        cutoff = t - self.cross_window_s
        while times and times[0] < cutoff:
            times.popleft()

    def update(self,
               time_s: float,
               p_emo: float, p_mu: Optional[float], p_sigma: Optional[float], p_calibrating: bool,
               feat_dist: Optional[float], f_mu: Optional[float], f_sigma: Optional[float],
               f_calibrating: bool) -> ShockResult:

        if p_calibrating or p_mu is None:
            p_z, p_raw = 0.0, False
        else:
            p_z, p_raw = self.p_detector.update(p_emo, p_mu, p_sigma)

        if f_calibrating or f_mu is None or feat_dist is None:
            f_z, f_raw = 0.0, False
        else:
            f_z, f_raw = self.f_detector.update(feat_dist, f_mu, f_sigma)

        if p_raw:
            self._p_shock_times.append(time_s)
        if f_raw:
            self._f_shock_times.append(time_s)
        self._prune(self._p_shock_times, time_s)
        self._prune(self._f_shock_times, time_s)

        shock_alarm = bool(self._p_shock_times) and bool(self._f_shock_times)

        return ShockResult(
            p_shock_raw=p_raw,
            feature_shock_raw=f_raw,
            shock_alarm=shock_alarm,
            p_shock_z=round(p_z, 3),
            feature_shock_z=round(f_z, 3),
        )
