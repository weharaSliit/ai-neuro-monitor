import os
from collections import deque
from dataclasses import dataclass, field, replace
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.signal import detrend

from backend.psychological.sam40.decision import (  # noqa: E402
    MIN_TASK_RESPONSE_Z, PERSONAL_K_ALERT, PERSONAL_SCALE, PERSONAL_SIGMA_LOGIT, PERSONAL_SIGMA_PRIOR,
    DecisionThresholds, compute_states, personal_decision_thresholds, personal_decision_thresholds_logit,
    inv_logit, midpoint_threshold_logit, personal_sigma_logit, personal_z, personal_z_level, plausible_logit_score,
    rest_level_logit, task_response_z,
    task_response_z_logit,
)
from backend.psychological.sam40.derived_features import add_baseline_relative  # noqa: E402
from backend.psychological.sam40.features import channel_features, epoch_features  # noqa: E402
from backend.psychological.sam40.preprocess import notch_then_bandpass  # noqa: E402

from .adc import (  # noqa: E402
    CLIP_UV, bipolar_code_to_microvolts, clip_physiological_uv, code_to_microvolts, raw_magnitude_ok,
    raw_out_of_range_mask,
)
from .mqtt_client import BipolarRawSample, RawSample  # noqa: E402
from .quality_gate import TrustedIoTEEGValidator  # noqa: E402
from .raw_cleaning import clean_raw_channel, timing_ok  # noqa: E402
from .resample import SOURCE_FS, TARGET_FS, resample_to_target  # noqa: E402

CHANNELS = ['T7', 'T8']
BLOCK_SEC = 25.0
BLOCK_SAMPLES_RAW = int(BLOCK_SEC * SOURCE_FS)  # samples to drain from the buffer per block
# Was 30.0 -- with N_CALIBRATION_BLOCKS=3 blocks at BLOCK_SEC=25s each
# (elapsed_sec 0/25/50, see calibrate_bipolar_block()'s in_settling_window
# check below), a 30s window meant blocks 1 AND 2 (elapsed 0s and 25s) were
# BOTH always rejected regardless of actual signal quality -- 25s missed
# the block-2 cutoff by a mere 5s, wasting 50 of every 75s calibration
# attempt on data that could never count, and leaving only ONE real block
# (elapsed=50s) to determine pass/fail for the whole attempt. Aligning
# this to exactly BLOCK_SEC lets block 2 (elapsed=25s, no longer < 25s)
# clear settling too -- 2 of 3 captured blocks now actually count instead
# of 1, for the SAME total 75s capture time (not slower), and a noisy
# single block no longer fails an otherwise-good attempt outright.
SETTLING_TIME_SEC = 25.0

# ── Per-session amplitude calibration ─────────────────────────────────
# The model's strongest features are absolute (log band powers, ptp,
# power), learned on SAM40's lab amplifiers (block SD ~6.4 uV). A headband
# whose signal is many times smaller (contact, electrode spacing, front-end
# gain) puts every block far below that range and the score collapses to
# ~0.001 whatever the person is doing, even though the relative features
# (band shares, ratios) look normal. During rest calibration the session's
# own rest SD is measured; if it sits below the training range, every block
# of the session is multiplied by ONE gain (training mean SD / rest SD)
# before features are computed. One fixed gain keeps rest-vs-task
# differences within the session; the quality gate still judges the real,
# unscaled signal, and the stored waveform stays in real uV.
# EEG_AMPLITUDE_CALIBRATION=0 turns it off.
AMPLITUDE_CALIBRATION = os.environ.get('EEG_AMPLITUDE_CALIBRATION', '1') != '0'
# Two-way and range-gated: the gain is applied only when the session's rest
# SD is outside the training mean +- 2 SD (SAM40-like sessions keep 1.0, so
# the published results are unchanged), scaling a quiet session up AND a loud
# one down. Measured robustly: only clean rest blocks (rules below), and
# 1.4826 x MAD per block instead of the SD, so one blink or clench during
# calibration can't inflate it and scale the whole session down too far.
GAIN_MIN, GAIN_MAX = 0.1, 10.0   # a gain at the cap usually means bad contact/units: calibration marked degraded
MIN_REST_STD_UV = 0.05           # below this the input is flat/disconnected: not EEG, no gain
REST_CLEAN_MAX_CLIP = 0.01       # > 1% of samples beyond +-CLIP_UV -> not a clean rest block
REST_CLEAN_RMS_FACTOR = 3.0      # RMS > 3 x the median rest RMS -> artefact (clench, movement)
REST_CLEAN_MAX_DELTA_REL = 0.5   # delta share > 0.5 -> blink / drift
MAX_AMPLITUDE_GAIN = GAIN_MAX


def robust_sd(x: np.ndarray) -> float:
    """1.4826 x median absolute deviation: equals the SD for Gaussian EEG,
    but a few large artefact samples barely move it."""
    x = np.asarray(x, dtype=float)
    return float(1.4826 * np.median(np.abs(x - np.median(x))))
DERIVED_SUFFIXES = ['delta_rel_power', 'theta_rel_power', 'alpha_rel_power', 'beta_rel_power',
                     'gamma_rel_power', 'theta_alpha_ratio', 'beta_alpha_ratio', 'sample_entropy',
                     'hjorth_complexity']


@dataclass
class UserBaseline:
    blocks: list = field(default_factory=list)

    def add(self, raw_features: dict) -> None:
        self.blocks.append(raw_features)

    def mean(self) -> dict | None:
        if not self.blocks:
            return None
        return pd.DataFrame(self.blocks).mean().to_dict()


class AdaptiveBaselineTracker:

    def __init__(self, ema_alpha: float = 0.08, calm_threshold: float = 0.725):
        self.ema_alpha = ema_alpha
        self.calm_threshold = calm_threshold
        self._static_mean: dict | None = None   # frozen at end of calibration
        self._adaptive_mean: dict | None = None  # EMA, updated only from calm-looking blocks
        self.n_calm_updates = 0

    def initialize(self, static_mean: dict) -> None:
        self._static_mean = dict(static_mean)
        self._adaptive_mean = dict(static_mean)

    def maybe_update(self, calibrated_p: float, features: dict) -> None:
        if self._adaptive_mean is None or calibrated_p > self.calm_threshold:
            return  # not initialized yet, or this block doesn't look calm -- don't adapt from it
        a = self.ema_alpha
        for k in self._adaptive_mean:
            if k in features:
                self._adaptive_mean[k] = (1 - a) * self._adaptive_mean[k] + a * features[k]
        self.n_calm_updates += 1

    def drift(self) -> float | None:
        if self._static_mean is None or self.n_calm_updates == 0:
            return None
        diffs = []
        for k, static_v in self._static_mean.items():
            adaptive_v = self._adaptive_mean.get(k)
            if adaptive_v is None or static_v == 0:
                continue
            diffs.append(abs(adaptive_v - static_v) / (abs(static_v) + 1e-9))
        return float(np.mean(diffs)) if diffs else None


def preprocess_block(samples: list[RawSample], duration_sec: float | None = None) -> np.ndarray:
    duration_sec = BLOCK_SEC if duration_sec is None else duration_sec
    millis = np.array([s.millis for s in samples], dtype=float)
    ch1_uv = clip_physiological_uv(code_to_microvolts(np.array([s.ch1_code for s in samples])))
    ch2_uv = clip_physiological_uv(code_to_microvolts(np.array([s.ch2_code for s in samples])))

    ch1_clean, _ = clean_raw_channel(millis, ch1_uv, target_fs=SOURCE_FS, duration_sec=duration_sec)
    ch2_clean, _ = clean_raw_channel(millis, ch2_uv, target_fs=SOURCE_FS, duration_sec=duration_sec)
    raw = np.stack([ch1_clean, ch2_clean], axis=0)  # (2, n_samples_at_250Hz), exactly duration_sec*SOURCE_FS long

    resampled = resample_to_target(raw, source_fs=SOURCE_FS, target_fs=TARGET_FS)  # -> 128Hz
    filtered = notch_then_bandpass(resampled, fs=TARGET_FS)
    return filtered


WIDE_DESPIKE_UV = 2000.0  # hard pre-filter bound -- see preprocess_bipolar_block()'s docstring

# SAM40 (the model's training corpus) uses a 0.5Hz bandpass low edge, which
# notch_then_bandpass() defaults to. On real wearable02 captures this
# session, the live signal carries far more slow drift/residual-offset
# energy than SAM40's clean lab recordings do (attributed to imperfect
# electrode contact + the single hardware-bipolar channel having no
# reference channel to cancel drift against) -- a 0.5Hz cutoff lets enough
# of that drift through to still clamp a meaningful fraction of samples at
# CLIP_UV even after filtering. Empirically raising the cutoff to 1.0Hz
# measurably reduced the clamped-sample fraction (39% -> 21%) on a real
# capture with no observed downside on prediction stability. This is a
# real-time-only deviation from SAM40's 0.5Hz training assumption -- traded
# off deliberately since the alternative (feeding the model a signal that's
# 39% flat-clamped) is worse than a slightly-mismatched high-pass edge.
BIPOLAR_HIGHPASS_HZ = 1.0

# Filter edge handling for 25 s blocks. Each block is filtered on its own,
# and scipy's default filtfilt padding (~0.2 s) is far shorter than the
# 1 Hz high-pass takes to settle, so any electrode drift across the block
# rang at both edges. Tested on blocks of ~8 uV EEG + a 3 mV drift: RMS
# 23.6 uV and every out-of-range sample at the block edges, vs 6.2 uV and
# none with a linear detrend + 3 s odd-reflection padding (as good as
# carrying the previous block as context, without keeping state).
EDGE_PAD_SEC = 3.0


def preprocess_bipolar_block_unclamped(samples: list[BipolarRawSample], duration_sec: float | None = None) -> np.ndarray:
    """Order matters here: detrend -> WIDE despike (hard, unconditional) ->
    loose MAD despike + grid interpolation -> resample -> filter ->
    physiological clamp (tight), NOT clamp-first. A hard +-CLIP_UV clamp
    applied to a non-zero-mean signal turns a large-but-real offset into a
    flat brick wall before detrending ever gets a chance to remove it
    cleanly, and it also creates sharp, flat-topped clipping -- a nonlinear
    operation whose harmonics land inside the 0.5-45Hz passband, which the
    downstream bandpass filter cannot distinguish from genuine oscillatory
    content.

    The WIDE despike (hard np.clip to +-WIDE_DESPIKE_UV, unconditional) is a
    SEPARATE stage from clean_raw_channel()'s MAD-based remove_spikes(),
    not a replacement for it: remove_spikes() has its own max_spike_fraction
    (0.5) bail-out -- "if more than half the block is flagged, this isn't
    sparse glitches, it's a sustained fault; return values UNCHANGED" (see
    its own docstring) -- which means on data corrupted badly enough,
    remove_spikes() alone does NOT bound the signal at all, and an
    unbounded, still-huge-magnitude detrended signal reaches the filter
    regardless of detrending. WIDE_DESPIKE_UV is unconditional specifically
    so the filter is guaranteed a bounded input even when remove_spikes()'s
    own bail-out fires. This absorbs large hardware-shock excursions while
    still preserving the signal's organic shape (unlike the tight +-100uV
    clamp, which would flatten far more of it) -- see CLIP_UV's own
    docstring for the final, tight clamp still applied after filtering.
    """
    duration_sec = BLOCK_SEC if duration_sec is None else duration_sec
    millis = np.array([s.millis for s in samples], dtype=float)
    raw_uv = bipolar_code_to_microvolts(np.array([s.code for s in samples]))
    # Sparse hardware glitch samples (beyond MAX_RAW_UV, at most
    # MAX_RAW_OUT_FRACTION of the block -- raw_magnitude_ok() rejects more)
    # are replaced by linear interpolation from their neighbours FIRST, so a
    # single ~245 mV sample can't tilt the detrend line below.
    bad = raw_out_of_range_mask(raw_uv)
    if bad.any() and not bad.all():
        idx = np.arange(len(raw_uv))
        raw_uv = raw_uv.copy()
        raw_uv[bad] = np.interp(idx[bad], idx[~bad], raw_uv[~bad])
    # Linear detrend (not just the mean) BEFORE any clamping -- see the
    # docstring and EDGE_PAD_SEC: drift left in as a ramp rings at the edges.
    detrended_uv = detrend(raw_uv, type='linear')
    wide_despiked_uv = np.clip(detrended_uv, -WIDE_DESPIKE_UV, WIDE_DESPIKE_UV)

    # clean_raw_channel()'s MAD-based despike (ceiling 10,000uV) + grid
    # interpolation now run on an ALREADY-bounded signal -- its own
    # max_spike_fraction bail-out is no longer load-bearing for keeping the
    # filter's input sane, since wide_despiked_uv already guarantees that.
    clean, _ = clean_raw_channel(millis, wide_despiked_uv, target_fs=SOURCE_FS, duration_sec=duration_sec)
    resampled = resample_to_target(clean, source_fs=SOURCE_FS, target_fs=TARGET_FS)  # -> 128Hz
    filtered = notch_then_bandpass(resampled, fs=TARGET_FS, low=BIPOLAR_HIGHPASS_HZ,  # see BIPOLAR_HIGHPASS_HZ
                                   padlen=min(int(EDGE_PAD_SEC * TARGET_FS), len(resampled) - 1))

    return filtered


def preprocess_bipolar_block(samples: list[BipolarRawSample], duration_sec: float | None = None) -> np.ndarray:
    """The model's input: preprocess_bipolar_block_unclamped() + the tight
    physiological clamp LAST -- a final safety net against residual
    filter-transient excursions, not the first thing the raw signal sees.
    The quality gate must NOT be given this: on a clamped block every
    excursion reads as ptp=200 uV, and the gate can't measure what it is
    meant to judge (see quality_gate.py MAX_OUT_OF_RANGE_FRACTION)."""
    return clip_physiological_uv(preprocess_bipolar_block_unclamped(samples, duration_sec))


def _raw_codes(samples: list[RawSample]) -> tuple[np.ndarray, np.ndarray]:
    ch1 = np.array([s.ch1_code for s in samples], dtype=float)
    ch2 = np.array([s.ch2_code for s in samples], dtype=float)
    return ch1, ch2


def _raw_bipolar_codes(samples: list[BipolarRawSample]) -> np.ndarray:
    return np.array([s.code for s in samples], dtype=float)


# Points per block for the live dashboard's waveform preview -- NOT raw ADC
# samples (those never leave this process, let alone reach Firebase -- see
# firebase_service.py's module docstring), this decimates the already-
# PREPROCESSED (filtered, uV-scale) signal infer_bipolar_block() computes
# for scoring anyway. 200 points over one BLOCK_SEC=25s block is plenty to
# see the waveform's real shape/character on a small chart without pushing
# a 3200-sample (TARGET_FS=128Hz * 25s) array to Firebase every block.
WAVE_PREVIEW_POINTS = 200


def _downsample_wave(filtered: np.ndarray, target_points: int = WAVE_PREVIEW_POINTS) -> list[float]:
    n = len(filtered)
    if n <= target_points:
        return [round(float(v), 2) for v in filtered]
    step = n / target_points
    idx = (np.arange(target_points) * step).astype(int)
    return [round(float(v), 2) for v in filtered[idx]]


class SessionQualityMonitor:
    def __init__(self, window_blocks: int = 8):
        self.window_blocks = window_blocks
        self._results: deque = deque(maxlen=window_blocks)

    def update(self, is_trusted: bool) -> dict:
        self._results.append(bool(is_trusted))
        n = len(self._results)
        rejected = sum(1 for r in self._results if not r)
        rejection_rate = rejected / n if n else 0.0

        if n < 3:
            band, message = 'INSUFFICIENT_DATA', 'Not enough blocks yet to assess session quality.'
        elif rejection_rate <= 0.20:
            band, message = 'CLEAN', 'Normal baseline session.'
        elif rejection_rate <= 0.50:
            band, message = 'USABLE', 'Minor artifacts (blink/muscle) -- proceed, but watch for degradation.'
        else:
            band, message = ('SETUP_FAILURE',
                              'Check electrode contact/skin prep, verify reference is connected, '
                              'and check for movement -- most recent blocks are being rejected.')

        return {
            'window_blocks': n, 'rejected_in_window': rejected,
            'rejection_rate': round(rejection_rate, 3), 'band': band, 'message': message,
        }


RATING_ORDER = {'POOR': 0, 'QUESTIONABLE': 1, 'GOOD': 2}

# Rejects the specific real-hardware failure mode traced on this project's
# own captured sessions: bipolar_delta_power landing far above the SAM40
# training distribution (mean~6.14, std~3.42 uV^2) single-handedly drove
# 93-98% of the model's decision-function magnitude, collapsing
# predict_proba to numerical underflow (~1e-37..1e-67) on blocks the
# quality gate itself rated GOOD -- excess delta-band power at that
# magnitude is a residual motion/drift/poor-contact artifact, not real
# neural activity, not something the amplitude/SNR/Itakura checks in
# quality_gate.py were built to catch (they weren't designed around any
# single extracted feature).
#
# 30 standard deviations, not a tighter bound: chosen against real
# evidence on both sides with a wide, deliberate safety margin, not a
# value that rides close to either. Every genuinely-good block captured on
# real hardware so far (13 blocks, 2 sessions) measured z~=-1.79 --
# collapsed near the same value because live delta power sits far BELOW
# even the SAM40 mean under calm conditions on this hardware, not just
# near it. Every block from the one session whose model output actually
# collapsed (5 blocks) measured z=157-299. 30 SD sits ~9x beyond SAM40's
# OWN population mean+std (a proxy for how far real biological delta-power
# variation plausibly extends, since that population is real EEG, not
# artifact) while staying >=5x below the lowest confirmed failure --
# deliberately biased toward the safe/good side of the gap rather than the
# arithmetic midpoint, since there is no real captured data yet on
# moderately-elevated-but-legitimate delta power (e.g. blinking, motion)
# to rule out a live artifact reaching higher than this project's own
# small "very calm" sample ever did. A judgment call given how sparse real
# hardware data still is here -- same honest framing as
# backend/physiological/predictor.py's PERSONAL_THRESHOLD_MIN_SEPARATION
# -- revisit once more real sessions (ideally spanning genuinely varied
# real states) are collected.
DELTA_POWER_IMPLAUSIBLE_SD = 30.0

# A model probability closer than this to 0 or 1 is a saturation artifact,
# not confidence -- same value as fushion engin/fusion_engin.py's
# EXTREME_PROB_EPS (the paper's fusion plausibility rule).
PLAUSIBLE_SCORE_EPS = 1e-6

# Provisional scores. A block rejected by a SOFT quality check (some of the
# signal out of range, the delta-power plausibility check, or the
# post-gate SNR/Itakura/kurtosis checks) is still not trusted -- it never
# enters the decision states or task_state_score -- but its model output is
# kept as a clearly-flagged provisional score, so a demo with imperfect
# contact still shows a reading, and fusion can use it at reduced weight
# (firebase_sync.py EEG_FUSION_POLICY). HARD faults get none: hardware
# magnitude/timing faults, the settling window, more than
# PROVISIONAL_MAX_OUT_OF_RANGE of the signal out of range, or a saturated
# model output (outside PLAUSIBLE_SCORE_EPS).
PROVISIONAL_MAX_OUT_OF_RANGE = 0.20


def provisional_quality(out_of_range_fraction: float | None) -> float:
    """0-50 quality for a provisional score: half of a clean block's at
    best, falling linearly to 0 at PROVISIONAL_MAX_OUT_OF_RANGE."""
    oor = out_of_range_fraction or 0.0
    return round(50.0 * max(0.0, 1.0 - oor / PROVISIONAL_MAX_OUT_OF_RANGE), 1)


class RealtimeInference:
    def __init__(self, model_dir: Path, thresholds: DecisionThresholds = DecisionThresholds(),
                 quality_window_blocks: int = 8, calibration_min_rating: str = 'QUESTIONABLE',
                 disable_quality_gate: bool = False):
        # calibration_min_rating was 'GOOD' (score>=80) -- stricter than what
        # LIVE prediction itself ever requires. infer_bipolar_block() (via
        # quality_gate.py::validate_epoch_single()) only requires
        # gate_rating != 'POOR' (i.e. QUESTIONABLE or better) as its first
        # filter, then applies its own separate SNR/Itakura/time-domain
        # checks -- it never re-checks the 0-100 score against GOOD.
        # Calibration was holding blocks to a HIGHER bar than the inference
        # it exists to support, backwards for bipolar-differential wearable02
        # signal (naturally lower amplitude than a referential montage,
        # already accounted for in assess_epoch_single()'s own scoring, not
        # in this bar). Lowered to QUESTIONABLE -- consistent with, not
        # stricter than, live inference for the same signal.
        artifact = joblib.load(Path(model_dir) / 'sam40_t7t8_state_model.joblib')
        self.model = artifact['model']
        self.feature_columns = artifact['feature_columns']
        self.thresholds = thresholds
        # Derived from the model's OWN fitted training statistics (not a
        # hardcoded raw uV^2 number) so this stays correct if the model is
        # ever retrained -- see DELTA_POWER_IMPLAUSIBLE_SD's docstring.
        # None (check skipped) if this model doesn't expose a StandardScaler
        # the same way, or doesn't have this feature at all, rather than
        # guessing at a bound that wouldn't mean anything for a different
        # model shape.
        self._delta_power_reject_threshold: float | None = None
        try:
            scaler = self.model.named_steps['standardscaler']
            idx = self.feature_columns.index('bipolar_delta_power')
            self._delta_power_reject_threshold = float(
                scaler.mean_[idx] + DELTA_POWER_IMPLAUSIBLE_SD * scaler.scale_[idx]
            )
        except (AttributeError, KeyError, ValueError, IndexError):
            pass
        # Training amplitude for the per-session gain (AMPLITUDE_CALIBRATION):
        # target = the model's own training mean of bipolar_std; a session
        # is rescaled only when its rest SD is below mean - 2 SD.
        self._train_std_mean: float | None = None
        self._train_std_low: float | None = None
        self._train_std_high: float | None = None
        try:
            scaler = self.model.named_steps['standardscaler']
            idx = self.feature_columns.index('bipolar_std')
            self._train_std_mean = float(scaler.mean_[idx])
            self._train_std_low = float(scaler.mean_[idx] - 2 * scaler.scale_[idx])
            self._train_std_high = float(scaler.mean_[idx] + 2 * scaler.scale_[idx])
        except (AttributeError, KeyError, ValueError, IndexError):
            pass
        self.amplitude_gain: float = 1.0
        self.rest_std_uv: float | None = None
        self.amplitude_capped: bool = False
        self.n_clean_rest_for_gain: int = 0
        self._cal_signals_bipolar: list[np.ndarray] = []   # trusted rest blocks, unclamped uV
        self.baseline = UserBaseline()
        self._history: list[dict] = []  # for persistence-aware decision states across blocks
        self.quality_validator = TrustedIoTEEGValidator(fs_raw=SOURCE_FS, fs_filtered=TARGET_FS, max_amplitude=7000.0)
        self._itakura_baseline_filtered_ch1: np.ndarray | None = None
        self._itakura_baseline_filtered_ch2: np.ndarray | None = None
        self.session_quality = SessionQualityMonitor(window_blocks=quality_window_blocks)
        self.calibration_min_rating = calibration_min_rating
        self.disable_quality_gate = disable_quality_gate
        self._calibration_attempts: list[tuple[float, dict, np.ndarray, np.ndarray]] = []
        self.baseline_degraded: bool = False
        self.baseline_degraded_score: float | None = None
        self.adaptive_baseline = AdaptiveBaselineTracker(calm_threshold=thresholds.cooldown_low_p)
        self._calibration_scores: list[float] = []
        self.thresholds_personalized: bool = False
        self.baseline_shift: float = 0.0
        self._itakura_baseline_filtered_bipolar: np.ndarray | None = None
        self._calibration_attempts_bipolar: list[tuple[float, dict, np.ndarray]] = []
        self._bipolar_blocks_processed: int = 0
        self._task_scores: list[float] = []
        self._recovery_scores: list[float] = []
        self.personal_high_load_p: float | None = None
        # Personal Scale (sam40/decision.py): mu_rest from THIS session's
        # rest blocks, sigma = the SAM40-derived prior. eeg_responsive comes
        # from the onboarding task (this session's, or the user's last one,
        # restored by calibration_service.py) -- None = not checked yet.
        self.mu_rest: float | None = None            # mean rest score (probability), for display
        self.personal_scale: str = PERSONAL_SCALE     # 'logit' | 'probability' (sam40/decision.py)
        self.mu_rest_logit: float | None = None       # resting level on the log-odds scale
        self.sigma_source: str = 'prior'              # 'personal' = own rest SD (sam40/decision.py)
        # Where the high-load limit sits on the z scale (sent to fusion as
        # z_alert_eeg): 0.84 until the task runs (provisional limit), then
        # the midpoint between baseline and the sustained task level.
        self.z_alert: float = PERSONAL_K_ALERT
        self.threshold_method: str = 'provisional (rest + 0.84 sigma)'
        self.limit_logit: float | None = None
        self.sigma: float = PERSONAL_SIGMA_LOGIT if PERSONAL_SCALE == 'logit' else PERSONAL_SIGMA_PRIOR
        self.task_response_z: float | None = None
        self.eeg_responsive: bool | None = None
        self.n_implausible_rest_blocks: int = 0
        self._live_blocks: int = 0  # infer_bipolar_block() calls, scored or not -> Firebase key
        self._itakura_ref_from_live: bool = False  # see infer_bipolar_block()

    def _plausible(self, s: float | None) -> bool:
        """Score usable for the Personal Scale: within LOGIT_PLAUSIBLE_BOUND
        on the log-odds scale, within PLAUSIBLE_SCORE_EPS on probability."""
        if self.personal_scale == 'logit':
            return plausible_logit_score(s)
        return s is not None and PLAUSIBLE_SCORE_EPS <= s <= 1.0 - PLAUSIBLE_SCORE_EPS

    def personal_z(self, score: float | None) -> float | None:
        """Distance of a score above this person's resting level, in the
        Personal Scale's own spreads (log-odds or probability)."""
        if self.personal_scale == 'logit':
            return personal_z_level(score, self.mu_rest_logit, self.sigma)
        return personal_z(score, self.mu_rest, self.sigma)

    def continue_block_numbering(self, previous: "RealtimeInference") -> None:
        """Start this engine's Firebase block keys after `previous`'s last
        one -- used when a live session is recalibrated, so the new engine
        doesn't reuse (and overwrite) block 0, 1, ... of the same session."""
        self._live_blocks = max(self._live_blocks, getattr(previous, "_live_blocks", 0))

    def start_block_numbering_at(self, n: int) -> None:
        """Same purpose, when the previous engine is gone (API restarted):
        start after the highest block number already stored for the session."""
        self._live_blocks = max(self._live_blocks, int(n))

    def _model_features(self, unclamped: np.ndarray) -> dict:
        """Features the model sees: the block times this session's
        amplitude gain (1.0 unless AMPLITUDE_CALIBRATION rescaled it), then
        the usual +-100 uV clamp. Unprefixed, like channel_features()."""
        x = unclamped * self.amplitude_gain if self.amplitude_gain != 1.0 else unclamped
        return channel_features(clip_physiological_uv(x), fs=TARGET_FS)

    def _fit_amplitude_gain(self, rest_signals: list[np.ndarray]) -> None:
        """Sets amplitude_gain from the rest blocks (see
        AMPLITUDE_CALIBRATION) and, if it changed, rebuilds the rest
        baseline and rest scores at the new scale so mu_rest matches what
        live blocks will be scored on."""
        self.amplitude_gain = 1.0
        self.amplitude_capped = False
        if not rest_signals:
            return
        # Clean rest blocks only (clipping, RMS outliers, blink/drift).
        clip_frac = [float(np.mean(np.abs(s) > CLIP_UV)) for s in rest_signals]
        rms = [float(np.sqrt(np.mean(np.square(s)))) for s in rest_signals]
        delta_rel = [channel_features(clip_physiological_uv(s), fs=TARGET_FS)['delta_rel_power'] for s in rest_signals]
        med_rms = float(np.median(rms))
        clean = [s for s, c, r, dr in zip(rest_signals, clip_frac, rms, delta_rel)
                 if c <= REST_CLEAN_MAX_CLIP and r <= REST_CLEAN_RMS_FACTOR * med_rms and dr <= REST_CLEAN_MAX_DELTA_REL]
        self.n_clean_rest_for_gain = len(clean)
        if not clean:
            return                       # nothing trustworthy to measure: no gain
        self.rest_std_uv = float(np.median([robust_sd(s) for s in clean]))
        if (not AMPLITUDE_CALIBRATION or self._train_std_mean is None or self.rest_std_uv < MIN_REST_STD_UV
                or self._train_std_low <= self.rest_std_uv <= self._train_std_high):
            return                       # in the training range (or flat): gain stays 1.0
        raw_gain = self._train_std_mean / self.rest_std_uv
        self.amplitude_gain = float(min(GAIN_MAX, max(GAIN_MIN, raw_gain)))
        if self.amplitude_gain != raw_gain:
            self.amplitude_capped = True
            self.baseline_degraded = True
            print(f"[amplitude] gain {raw_gain:.2f} capped to {self.amplitude_gain:.2f} -- rest SD "
                  f"{self.rest_std_uv:.2f} uV is far outside training; check contact/units. Baseline marked degraded.")
        else:
            print(f"[amplitude] rest SD {self.rest_std_uv:.2f} uV outside training range -> gain {self.amplitude_gain:.2f}")
        self.baseline = UserBaseline()
        self._calibration_scores = []
        for sig in rest_signals:
            feats = self._model_features(sig)
            self.baseline.add({f'bipolar_{k}': v for k, v in feats.items()})
            score = self._score_calibration_bipolar_block(feats)
            if score is not None:
                self._calibration_scores.append(score)
        self.adaptive_baseline.initialize(self.baseline.mean())

    def _apply_personal_scale(self) -> None:
        """Sets mu_rest from the scored rest blocks and moves every decision
        threshold onto the personal scale. The raw model score is used
        as-is (baseline_shift stays 0): mu_rest absorbs this person's offset
        instead of shifting the probability."""
        self.baseline_shift = 0.0
        # Same plausibility rule as fusion (fusion_engin.py EXTREME_PROB_EPS):
        # rest scores like 1e-63 or 1e-133 (seen on real wearable02 sessions)
        # are the model saturating on out-of-distribution input, not a calm
        # brain -- a mu_rest built from them would make every later z
        # meaningless. With no plausible rest block there is no personal
        # baseline: population thresholds stay and EEG is kept out of fusion
        # (make_eeg_fusion_record(): 'no_personal_baseline').
        plausible = [s for s in self._calibration_scores if self._plausible(s)]
        self.n_implausible_rest_blocks = len(self._calibration_scores) - len(plausible)
        if not plausible:
            return
        self.mu_rest = float(np.mean(plausible))
        if self.personal_scale == 'logit':
            self.mu_rest_logit = rest_level_logit(plausible)
            self.sigma, self.sigma_source = personal_sigma_logit(plausible)
            self.thresholds = personal_decision_thresholds_logit(self.thresholds, self.mu_rest_logit, self.sigma)
        else:
            self.thresholds = personal_decision_thresholds(self.thresholds, self.mu_rest, self.sigma)
        self.personal_high_load_p = self.thresholds.high_load_p
        self.thresholds_personalized = True

    def _personal_outcome(self) -> dict:
        return {
            'n_implausible_rest_blocks': self.n_implausible_rest_blocks,
            'thresholds_personalized': self.thresholds_personalized,
            'resting_calibrated_p': self.mu_rest,
            'mu_rest': self.mu_rest,
            'sigma': self.sigma,
            'personal_scale': self.personal_scale,
            'mu_rest_logit': self.mu_rest_logit,
            'sigma_source': self.sigma_source,
            'personal_high_load_p': self.personal_high_load_p,
            'baseline_shift': self.baseline_shift,
            'amplitude_gain': self.amplitude_gain,
            'rest_std_uv': self.rest_std_uv,
            'amplitude_capped': self.amplitude_capped,
            'n_clean_rest_for_gain': self.n_clean_rest_for_gain,
            # Per-block rest scores behind mu_rest (in capture order, at the
            # session's amplitude gain) -- for calibration graphs. Includes
            # implausible ones, which mu_rest excludes.
            'rest_scores': [float(x) for x in self._calibration_scores],
        }

    def calibrate_block(self, samples: list[RawSample]) -> dict:
        ch1_codes, ch2_codes = _raw_codes(samples)
        filtered = preprocess_block(samples)  # the ACTUAL signal the model would see -- see quality_gate.py docstring
        feats = epoch_features(filtered, channel_names=CHANNELS, fs=TARGET_FS, include_bipolar=True)
        quality = self.quality_validator.assess_only(ch1_codes, ch2_codes, filtered[0], filtered[1])
        meets_bar = self.disable_quality_gate or (
            RATING_ORDER.get(quality['gate_rating'], -1) >= RATING_ORDER[self.calibration_min_rating])
        quality['is_trusted'] = meets_bar  # overrides assess_only's looser (non-POOR) default for calibration use
        if not meets_bar:
            if quality['gate_rating'] != 'POOR':
                self._calibration_attempts.append((quality['quality_score'], feats, filtered[0], filtered[1]))
            return quality
        self.baseline.add(feats)
        if self._itakura_baseline_filtered_ch1 is None:
            self._itakura_baseline_filtered_ch1 = filtered[0]
            self._itakura_baseline_filtered_ch2 = filtered[1]
        score = self._score_calibration_block(feats)
        if score is not None:
            self._calibration_scores.append(score)
        return quality

    def _score_calibration_block(self, feats: dict) -> float | None:
        row = dict(feats)
        for ch in CHANNELS:
            for suf in DERIVED_SUFFIXES:
                row[f'{ch}_{suf}_blrel'] = 0.0
                row[f'{ch}_{suf}_slope3'] = 0.0
        missing = [c for c in self.feature_columns if c not in row]
        if missing:
            return None
        X = np.array([[row[c] for c in self.feature_columns]])
        return float(self.model.predict_proba(X)[:, 1][0])

    def finalize_calibration(self, allow_degraded: bool = False) -> dict:
        if self.baseline.blocks:
            self.adaptive_baseline.initialize(self.baseline.mean())
            self._apply_personal_scale()
            return {'status': 'ok', 'baseline_degraded': False, 'n_blocks': len(self.baseline.blocks),
                    **self._personal_outcome()}
        if allow_degraded and self._calibration_attempts:
            best_score, best_feats, best_filtered_ch1, best_filtered_ch2 = max(
                self._calibration_attempts, key=lambda t: t[0])
            self.baseline.add(best_feats)
            self._itakura_baseline_filtered_ch1 = best_filtered_ch1
            self._itakura_baseline_filtered_ch2 = best_filtered_ch2
            self.baseline_degraded = True
            self.baseline_degraded_score = best_score
            self.adaptive_baseline.initialize(self.baseline.mean())
            return {'status': 'degraded', 'baseline_degraded': True, 'score': best_score}
        return {'status': 'failed', 'baseline_degraded': None}

    def calibrate_bipolar_block(self, samples: list[BipolarRawSample]) -> dict:
        raw_code = _raw_bipolar_codes(samples)
        elapsed_sec = self._bipolar_blocks_processed * BLOCK_SEC
        self._bipolar_blocks_processed += 1

        # Cheap early reject BEFORE the filter chain runs -- see adc.py's
        # MAX_RAW_UV docstring for why this is checked in addition to, not
        # instead of, the tighter checks below.
        if not (self.disable_quality_gate or raw_magnitude_ok(bipolar_code_to_microvolts(raw_code))):
            return {
                "is_trusted": False, "gate_rating": "POOR", "quality_score": 0.0,
                "reason": f"raw signal exceeds MAX_RAW_UV -- unambiguous hardware fault, filter chain skipped",
            }
        millis = np.array([s.millis for s in samples], dtype=float)
        if not (self.disable_quality_gate or timing_ok(millis)):
            return {
                "is_trusted": False, "gate_rating": "POOR", "quality_score": 0.0,
                "reason": "dropped-packet gap exceeds MAX_GAP_SEC -- interpolation would fabricate signal, filter chain skipped",
            }

        # Gate, Itakura reference and ML classifier judge the UNCLAMPED
        # filtered signal; features come from the clamped one (the model's
        # input). The two are identical for any block the gate accepts.
        unclamped = preprocess_bipolar_block_unclamped(samples)
        filtered = clip_physiological_uv(unclamped)  # the ACTUAL signal the model would see
        feats = channel_features(filtered, fs=TARGET_FS)  # unprefixed -- see infer_bipolar_block()
        quality = self.quality_validator.assess_only_single(raw_code, unclamped)

        in_settling_window = elapsed_sec < SETTLING_TIME_SEC
        if in_settling_window:
            quality['gate_rating'] = 'POOR'
            quality['reason'] = (f"session-elapsed {elapsed_sec:.0f}s < "
                                  f"SETTLING_TIME_SEC ({SETTLING_TIME_SEC:.0f}s) -- "
                                  f"electrode/contact settling window, not scored")

        meets_bar = self.disable_quality_gate or (
            (not in_settling_window)
            and RATING_ORDER.get(quality['gate_rating'], -1) >= RATING_ORDER[self.calibration_min_rating]
        )
        quality['is_trusted'] = meets_bar
        if not meets_bar:
            # Every non-passing block is a legitimate degraded-fallback
            # candidate, ranked by its real quality_score -- including a
            # settling-window rejection, whose gate_rating is forced to
            # POOR just above regardless of how good the underlying signal
            # actually was. The two truly-unusable cases (raw-magnitude /
            # timing hardware faults) already returned before reaching this
            # line, so everything that gets here has real feats/filtered
            # data worth keeping as a last resort.
            #
            # This used to be gated on `quality['gate_rating'] != 'POOR'`,
            # which made sense back when calibration_min_rating was 'GOOD'
            # (a QUESTIONABLE-but-not-GOOD block legitimately had
            # gate_rating != 'POOR' and would qualify). Once the bar was
            # lowered to 'QUESTIONABLE' -- the lowest rating above POOR --
            # "not meets_bar" became synonymous with gate_rating=='POOR' in
            # every case (forced or genuine), so that guard silently made
            # this append permanently unreachable: finalize_calibration_
            # bipolar()'s allow_degraded path had nothing to fall back to,
            # and a fully-rejected calibration hard-failed instead of
            # degrading gracefully like it was designed to.
            self._calibration_attempts_bipolar.append((quality['quality_score'], feats, unclamped))
            return quality
        self.baseline.add({f'bipolar_{k}': v for k, v in feats.items()})
        self._cal_signals_bipolar.append(unclamped)
        if self._itakura_baseline_filtered_bipolar is None:
            self._itakura_baseline_filtered_bipolar = unclamped
        self.quality_validator.record_calibration_epoch(unclamped)
        score = self._score_calibration_bipolar_block(feats)
        if score is not None:
            self._calibration_scores.append(score)
        return quality

    def _score_calibration_bipolar_block(self, feats: dict) -> float | None:
        row = {f'bipolar_{k}': v for k, v in feats.items()}
        missing = [c for c in self.feature_columns if c not in row]
        if missing:
            return None
        X = np.array([[row[c] for c in self.feature_columns]])
        return float(self.model.predict_proba(X)[:, 1][0])

    def finalize_calibration_bipolar(self, allow_degraded: bool = False) -> dict:
        if self.baseline.blocks:
            self.adaptive_baseline.initialize(self.baseline.mean())
            self._fit_amplitude_gain(self._cal_signals_bipolar)
            self._apply_personal_scale()
            return {'status': 'ok', 'baseline_degraded': False, 'n_blocks': len(self.baseline.blocks),
                    **self._personal_outcome()}
        if allow_degraded and self._calibration_attempts_bipolar:
            best_score, best_feats, best_filtered = max(
                self._calibration_attempts_bipolar, key=lambda t: t[0])
            self.baseline.add({f'bipolar_{k}': v for k, v in best_feats.items()})
            self._itakura_baseline_filtered_bipolar = best_filtered
            self.quality_validator.record_calibration_epoch(best_filtered)
            self.baseline_degraded = True
            self.baseline_degraded_score = best_score
            self.adaptive_baseline.initialize(self.baseline.mean())
            # Give finalize_personal_threshold() (the onboarding arithmetic-
            # task threshold, run right after calibration) at least ONE real
            # resting probability to compare the task blocks against --
            # without this, _calibration_scores stays permanently empty on
            # every degraded calibration, so compute_personal_threshold()
            # always hits its `len(resting_scores) < 1` early-return
            # regardless of how good the task blocks were. best_score above
            # is a 0-100 SIGNAL QUALITY score (see _calibration_attempts_
            # bipolar's append site), not a model probability, so it can't
            # be reused here -- best_feats (the same block already chosen
            # as the baseline reference) is rescored through the model
            # itself to get a real, comparable probability.
            resting_score = self._score_calibration_bipolar_block(best_feats)
            if resting_score is not None:
                self._calibration_scores.append(resting_score)
            self._fit_amplitude_gain([best_filtered])
            self._apply_personal_scale()
            return {'status': 'degraded', 'baseline_degraded': True, 'score': best_score,
                    **self._personal_outcome()}
        return {'status': 'failed', 'baseline_degraded': None}

    def preview_block_score(self, samples: list[BipolarRawSample], use_gain: bool) -> dict:
        """Score ONE block for psy_web's live calibration graph without
        touching any state (baseline, scores, block counters). Rest blocks
        (use_gain=False) are scored like calibrate_bipolar_block() does --
        clamped signal, before any gain is fitted; task/recovery blocks
        (use_gain=True) like score_threshold_task_block(), at this session's
        amplitude gain. The values that count are still the ones the
        batch /calibrate and /calibrate/threshold calls compute."""
        raw_code = _raw_bipolar_codes(samples)
        if not (self.disable_quality_gate or raw_magnitude_ok(bipolar_code_to_microvolts(raw_code))):
            return {"score": None, "trusted": False, "reason": "raw signal exceeds MAX_RAW_UV"}
        millis = np.array([s.millis for s in samples], dtype=float)
        if not (self.disable_quality_gate or timing_ok(millis)):
            return {"score": None, "trusted": False, "reason": "dropped-packet gap exceeds MAX_GAP_SEC"}
        unclamped = preprocess_bipolar_block_unclamped(samples)
        feats = self._model_features(unclamped) if use_gain else channel_features(
            clip_physiological_uv(unclamped), fs=TARGET_FS)
        quality = self.quality_validator.assess_only_single(raw_code, unclamped)
        trusted = self.disable_quality_gate or (
            RATING_ORDER.get(quality['gate_rating'], -1) >= RATING_ORDER[self.calibration_min_rating])
        return {"score": self._score_calibration_bipolar_block(feats), "trusted": bool(trusted),
                "gate_rating": quality.get('gate_rating')}

    def score_threshold_task_block(self, samples: list[BipolarRawSample]) -> dict:
        """Scores one block captured during a DELIBERATE high-load task
        (e.g. a timed mental-arithmetic quiz) run immediately after
        resting-baseline calibration -- used only to derive this user's
        personal high_load_p (see finalize_personal_threshold() /
        sam40.decision.compute_personal_threshold()). Never added to
        self.baseline or the Itakura reference -- this is deliberately
        NOT resting data. Same quality-gating shape as
        calibrate_bipolar_block() (raw-magnitude/timing early-rejects,
        then the quality gate) so a task block that's actually just
        signal noise can't masquerade as evidence the user reached high
        load; unlike calibrate_bipolar_block(), there's no settling-window
        check here since this always runs after calibration already
        cleared it (elapsed_sec is already comfortably > SETTLING_TIME_SEC
        by construction)."""
        raw_code = _raw_bipolar_codes(samples)
        if not (self.disable_quality_gate or raw_magnitude_ok(bipolar_code_to_microvolts(raw_code))):
            return {
                "is_trusted": False, "gate_rating": "POOR", "quality_score": 0.0,
                "reason": "raw signal exceeds MAX_RAW_UV -- unambiguous hardware fault, filter chain skipped",
            }
        millis = np.array([s.millis for s in samples], dtype=float)
        if not (self.disable_quality_gate or timing_ok(millis)):
            return {
                "is_trusted": False, "gate_rating": "POOR", "quality_score": 0.0,
                "reason": "dropped-packet gap exceeds MAX_GAP_SEC -- interpolation would fabricate signal, filter chain skipped",
            }

        unclamped = preprocess_bipolar_block_unclamped(samples)
        feats = self._model_features(unclamped)   # at this session's amplitude gain
        quality = self.quality_validator.assess_only_single(raw_code, unclamped)

        meets_bar = self.disable_quality_gate or (
            RATING_ORDER.get(quality['gate_rating'], -1) >= RATING_ORDER[self.calibration_min_rating])
        quality['is_trusted'] = meets_bar

        # Deliberately scored regardless of meets_bar (unlike
        # calibrate_bipolar_block()'s trusted/degraded split) -- even with
        # N_THRESHOLD_TASK_BLOCKS=14 blocks total (raised from 2 -- see
        # mqtt_bridge.py's comment), dropping every low-quality block to a
        # quality gate would still needlessly shrink finalize_personal_
        # threshold()'s sample when a noisy block still carries a usable
        # score. The real safety net here is compute_personal_threshold()'s
        # own
        # separation gate: a noisy/rejected block mostly adds variance to
        # task_mean, and if that variance means resting and task scores
        # aren't meaningfully separated, that gate already returns
        # 'not_separated' and the population default is kept -- exactly the
        # outcome that matters, without needing a second gate here too. The
        # two truly-unusable cases (raw-magnitude / timing hardware faults)
        # already returned above, before any score could be computed at
        # all, so this can't be fooled by an outright garbage reading.
        score = self._score_calibration_bipolar_block(feats)
        if score is not None:
            self._task_scores.append(score)
        quality['score'] = score
        return quality

    def score_recovery_block(self, samples: list[BipolarRawSample]) -> float | None:
        """Scores one recovery-rest block (after the high-load task) the
        same way as a task block, kept separately: recovery doesn't change
        either threshold, it shows whether the score came back down."""
        raw_code = _raw_bipolar_codes(samples)
        if not (self.disable_quality_gate or raw_magnitude_ok(bipolar_code_to_microvolts(raw_code))):
            return None
        millis = np.array([s.millis for s in samples], dtype=float)
        if not (self.disable_quality_gate or timing_ok(millis)):
            return None
        score = self._score_calibration_bipolar_block(self._model_features(preprocess_bipolar_block_unclamped(samples)))
        if score is not None:
            self._recovery_scores.append(score)
        return score

    def recovery_outcome(self) -> dict:
        """Recovery-rest summary: mean score, its z vs own rest, and whether
        it came back below the high-load limit (z < PERSONAL_K_ALERT)."""
        plausible = [s for s in self._recovery_scores if self._plausible(s)]
        if not self._recovery_scores:
            return {}
        mean = float(np.mean(plausible)) if plausible else None
        z = self.personal_z(mean) if mean is not None else None
        return {
            'recovery_scores': [float(x) for x in self._recovery_scores],
            'recovery_mean': mean,
            'recovery_z': z,
            'recovered': None if z is None else bool(z < self.z_alert),
            'n_recovery_blocks': len(self._recovery_scores),
        }

    def finalize_personal_threshold(self) -> dict:
        """Computes and APPLIES this user's personal high_load_p from
        resting (self._calibration_scores, already populated by
        calibrate_bipolar_block()) vs. task (self._task_scores, from
        score_threshold_task_block() above) scores -- see
        compute_personal_threshold()'s docstring for the method. Call
        after calibration is finalized and all task blocks are scored.

        On success, REPLACES self.thresholds' high_load_p/cooldown_high_p
        (the same coupling threshold_set_B already uses -- see
        DecisionThresholds' own docstring) with the personal value,
        immediately effective for every infer_bipolar_block() call on
        this engine from here on. On failure (not enough separation --
        see compute_personal_threshold()), self.thresholds is left
        untouched, i.e. still whatever population default it was
        constructed with."""
        # Personal Scale: the threshold itself already came from this
        # session's rest blocks (_apply_personal_scale()); the task only
        # checks that the model responds to load for this person at all.
        # 'ok' = responsive, 'not_separated' = not responsive (same status
        # vocabulary the apps already read), in which case EEG gets no
        # fusion weight (make_eeg_fusion_record()) and the person should
        # re-seat the electrodes and repeat -- not fall back to a population
        # threshold, which live data showed scores never reach.
        plausible_task = [s for s in self._task_scores if self._plausible(s)]
        midpoint = None
        if self.personal_scale == 'logit':
            # Midpoint method (sam40/decision.py midpoint_threshold_logit()):
            # baseline = median rest, task level = mean of the task after the
            # ramp-up, limit = their midpoint, responsive if the task sits
            # >= 1 rest SD above baseline.
            rest_ok = [s for s in self._calibration_scores if self._plausible(s)]
            midpoint = midpoint_threshold_logit(rest_ok, plausible_task, sigma=self.sigma)
            z_task = (None if midpoint is None or self.mu_rest_logit is None
                      else (midpoint['task_level_logit'] - self.mu_rest_logit) / self.sigma)
            self.task_response_z = z_task
            self.eeg_responsive = None if midpoint is None else midpoint['responsive']
            if self.eeg_responsive:
                lim = midpoint['limit_logit']
                self.limit_logit = lim
                self.z_alert = (lim - self.mu_rest_logit) / self.sigma
                limit_p = inv_logit(lim)
                self.thresholds = replace(self.thresholds, high_load_p=limit_p, cooldown_high_p=limit_p,
                                          break_p=max(self.thresholds.break_p, limit_p))
                self.personal_high_load_p = limit_p
                self.threshold_method = 'midpoint (median rest, sustained task)'
        else:
            z_task = (task_response_z([self.mu_rest], plausible_task, self.sigma)
                      if self.mu_rest is not None else None)
            self.task_response_z = z_task
            self.eeg_responsive = None if z_task is None else z_task >= MIN_TASK_RESPONSE_Z
        return {
            'threshold_method': self.threshold_method,
            'z_alert': self.z_alert,
            **({k: midpoint[k] for k in ('baseline_logit', 'task_level_logit', 'limit_logit', 'rest_sd_logit',
                                         'separation_sd', 'n_task_used', 'n_task_skipped')} if midpoint else {}),
            'baseline': None if not midpoint else inv_logit(midpoint['baseline_logit']),
            'task_level': None if not midpoint else inv_logit(midpoint['task_level_logit']),
            'status': 'ok' if self.eeg_responsive else 'not_separated',
            'responsive': self.eeg_responsive,
            'task_response_z': z_task,
            'min_task_response_z': MIN_TASK_RESPONSE_Z,
            'personal_high_load_p': self.personal_high_load_p if self.eeg_responsive else None,
            'resting_mean': self.mu_rest,
            'task_mean': float(np.mean(plausible_task)) if plausible_task else None,
            'n_task_blocks': len(self._task_scores),
            # Per-block scores behind the means above, for calibration graphs.
            'task_scores': [float(x) for x in self._task_scores],
            'rest_scores': [float(x) for x in self._calibration_scores],
            'sigma': self.sigma,
            'personal_scale': self.personal_scale,
            'n_implausible_task_blocks': len(self._task_scores) - len(plausible_task),
        }

    def infer_block(self, samples: list[RawSample]) -> dict:
        ch1_codes, ch2_codes = _raw_codes(samples)
        filtered = preprocess_block(samples)  # computed ONCE, reused for both the gate and feature extraction
        baseline_filtered_ch1 = (self._itakura_baseline_filtered_ch1
                                  if self._itakura_baseline_filtered_ch1 is not None else filtered[0])
        baseline_filtered_ch2 = (self._itakura_baseline_filtered_ch2
                                  if self._itakura_baseline_filtered_ch2 is not None else filtered[1])
        quality = self.quality_validator.validate_epoch(ch1_codes, ch2_codes, filtered[0], filtered[1],
                                                          baseline_filtered_ch1, baseline_filtered_ch2)
        if self.disable_quality_gate:
            quality['is_trusted'] = True
        if not quality['is_trusted']:
            print(f"[quality_gate] rejected: {quality}")
        health = self.session_quality.update(quality['is_trusted'])

        raw_feats = epoch_features(filtered, channel_names=CHANNELS, fs=TARGET_FS, include_bipolar=True)

        if not quality['is_trusted']:
            # Untrusted blocks are neither scored nor added to decision-state
            # history -- a gap in `window` here means a block was skipped,
            # not that time stood still.
            return {
                'window': len(self._history), 'skipped': True, 'calibrated_p': None,
                'high_load_alert': False, 'micro_break_recommended': False,
                'fatigue_warning': False, 'cooldown_logged': False,
                'baseline_degraded': self.baseline_degraded,
                **raw_feats,
                **{f'quality_{k}': v for k, v in quality.items()},
                **{f'session_{k}': v for k, v in health.items()},
            }

        row = dict(raw_feats)

        baseline_mean = self.baseline.mean()
        deriv_cols = [f'{ch}_{suf}' for ch in CHANNELS for suf in DERIVED_SUFFIXES]
        for col in deriv_cols:
            row[f'{col}_blrel'] = (row[col] - baseline_mean[col]) if baseline_mean else 0.0
            row[f'{col}_slope3'] = 0.0  # single block -- no within-block window sequence to slope

        missing = [c for c in self.feature_columns if c not in row]
        if missing:
            raise RuntimeError(f'Feature mismatch vs. trained model, missing: {missing}')

        X = np.array([[row[c] for c in self.feature_columns]])
        raw_score = float(self.model.predict_proba(X)[:, 1][0])
        calibrated_p = max(0.0, min(1.0, raw_score - self.baseline_shift))

        row['raw_score'] = raw_score
        row['calibrated_p'] = calibrated_p
        row['theta_ratio'] = np.mean([row['T7_theta_alpha_ratio'], row['T8_theta_alpha_ratio']])
        row['spectral_slope'] = np.mean([row['T7_spectral_slope'], row['T8_spectral_slope']])
        row['window'] = len(self._history)
        self._history.append(row)
        self.adaptive_baseline.maybe_update(calibrated_p, raw_feats)  # monitoring only -- see class docstring

        states = compute_states(pd.DataFrame(self._history), self.thresholds)
        result = states.iloc[-1].to_dict()
        result['skipped'] = False
        result['baseline_degraded'] = self.baseline_degraded
        result['baseline_drift'] = self.adaptive_baseline.drift()
        result['baseline_drift_n_calm_blocks'] = self.adaptive_baseline.n_calm_updates
        result.update({f'quality_{k}': v for k, v in quality.items()})
        result.update({f'session_{k}': v for k, v in health.items()})
        return result

    def _provisional_score(self, raw_feats: dict, quality: dict, elapsed_sec: float) -> dict:
        """See PROVISIONAL_MAX_OUT_OF_RANGE. Empty dict = no provisional score."""
        if self.disable_quality_gate or elapsed_sec < SETTLING_TIME_SEC:
            return {}
        oor = quality.get('out_of_range_fraction') or 0.0
        if oor > PROVISIONAL_MAX_OUT_OF_RANGE:
            return {}
        if any(c not in raw_feats for c in self.feature_columns):
            return {}
        X = np.array([[raw_feats[c] for c in self.feature_columns]])
        p = float(self.model.predict_proba(X)[:, 1][0])
        if not (PLAUSIBLE_SCORE_EPS <= p <= 1.0 - PLAUSIBLE_SCORE_EPS):
            return {}   # saturated: the model is outside its range, not confident
        return {
            'provisional_score': p,
            'provisional_z': self.personal_z(p),
            'provisional_quality': provisional_quality(oor),
        }

    def infer_bipolar_block(self, samples: list[BipolarRawSample]) -> dict:
        raw_code = _raw_bipolar_codes(samples)
        elapsed_sec = self._bipolar_blocks_processed * BLOCK_SEC
        self._bipolar_blocks_processed += 1
        # 'window' is this block's Firebase key (FirebaseSync.push), so every
        # live block -- scored OR rejected -- gets its own sequential number.
        # It used to be len(self._history) (scored blocks only), so every
        # rejected block before the first scored one was written to key 0,
        # each overwriting the last, and a session's rejection history was lost.
        block_no = self._live_blocks
        self._live_blocks += 1

        # Cheap early reject BEFORE the filter chain runs -- see adc.py's
        # MAX_RAW_UV docstring. No raw_feats/filtered signal to report here
        # (that's the point -- this skips the filter pass entirely), unlike
        # the settling-window/quality-gate rejections below which still run
        # preprocessing for the live feature readout.
        if not (self.disable_quality_gate or raw_magnitude_ok(bipolar_code_to_microvolts(raw_code))):
            print(f"[quality_gate] rejected: raw signal exceeds MAX_RAW_UV, filter chain skipped")
            health = self.session_quality.update(False)
            return {
                'window': block_no, 'skipped': True, 'calibrated_p': None,
                'high_load_alert': False, 'micro_break_recommended': False,
                'fatigue_warning': False, 'cooldown_logged': False,
                'baseline_degraded': self.baseline_degraded,
                'quality_is_trusted': False, 'quality_gate_rating': 'POOR', 'quality_quality_score': 0.0,
                'quality_reason': 'raw signal exceeds MAX_RAW_UV -- unambiguous hardware fault',
                **{f'session_{k}': v for k, v in health.items()},
            }
        millis = np.array([s.millis for s in samples], dtype=float)
        if not (self.disable_quality_gate or timing_ok(millis)):
            print(f"[quality_gate] rejected: dropped-packet gap exceeds MAX_GAP_SEC, filter chain skipped")
            health = self.session_quality.update(False)
            return {
                'window': block_no, 'skipped': True, 'calibrated_p': None,
                'high_load_alert': False, 'micro_break_recommended': False,
                'fatigue_warning': False, 'cooldown_logged': False,
                'baseline_degraded': self.baseline_degraded,
                'quality_is_trusted': False, 'quality_gate_rating': 'POOR', 'quality_quality_score': 0.0,
                'quality_reason': 'dropped-packet gap exceeds MAX_GAP_SEC -- interpolation would fabricate signal',
                **{f'session_{k}': v for k, v in health.items()},
            }

        # Gate on the UNCLAMPED filtered signal, features on the clamped one
        # -- see calibrate_bipolar_block().
        unclamped = preprocess_bipolar_block_unclamped(samples)
        filtered = clip_physiological_uv(unclamped)
        # A degraded calibration's reference is the best of several BAD
        # blocks -- comparing clean blocks against it rejects them on the
        # Itakura distance. Until a live block passes every other check, the
        # block is compared against itself (Itakura skipped); that first
        # passing block then becomes the reference (below).
        ref_trusted = (self._itakura_baseline_filtered_bipolar is not None
                       and (not self.baseline_degraded or self._itakura_ref_from_live))
        baseline_filtered = self._itakura_baseline_filtered_bipolar if ref_trusted else unclamped
        quality = self.quality_validator.validate_epoch_single(raw_code, unclamped, baseline_filtered)
        if not ref_trusted:
            quality['itakura_skipped'] = 'no trusted reference block yet (degraded calibration)'
        # Computed regardless of what quality decides below -- seeing what a
        # REJECTED block's waveform actually looked like is exactly the
        # diagnostic visibility a "why does this keep failing" investigation
        # needs, not just a pass/fail verdict with no signal to look at.
        wave_uv = _downsample_wave(filtered)

        if elapsed_sec < SETTLING_TIME_SEC:
            quality['is_trusted'] = False
            quality['gate_rating'] = 'POOR'
            quality['reason'] = (f"session-elapsed {elapsed_sec:.0f}s < "
                                  f"SETTLING_TIME_SEC ({SETTLING_TIME_SEC:.0f}s) -- "
                                  f"electrode/contact settling window, not scored")

        # Computed here (not after the trust decision below) so this block's
        # own delta_power can feed the plausibility check next -- neither the
        # amplitude/SNR/Itakura checks above nor gate_rating='GOOD' catch
        # this; see DELTA_POWER_IMPLAUSIBLE_SD's docstring for why a
        # dedicated feature-level check is needed.
        # Model features at this session's amplitude gain (AMPLITUDE_CALIBRATION);
        # `filtered` / wave_uv above stay in real, unscaled uV.
        raw_feats_unprefixed = self._model_features(unclamped)
        raw_feats = {f'bipolar_{k}': v for k, v in raw_feats_unprefixed.items()}

        # Only when nothing earlier already rejected the block: an
        # out-of-range or settling rejection is the more basic cause, and
        # overwriting its reason would blame delta power instead.
        if (self._delta_power_reject_threshold is not None
                and quality.get('is_trusted', True) and not quality.get('reason')
                and raw_feats_unprefixed['delta_power'] > self._delta_power_reject_threshold):
            quality['is_trusted'] = False
            quality['gate_rating'] = 'POOR'
            quality['reason'] = (
                f"bipolar_delta_power={raw_feats_unprefixed['delta_power']:.1f}uV^2 exceeds "
                f"{self._delta_power_reject_threshold:.1f}uV^2 ({DELTA_POWER_IMPLAUSIBLE_SD:.0f} SD "
                f"above this model's own training mean) -- residual motion/drift/poor-contact "
                f"artifact, not scored"
            )

        if self.disable_quality_gate:
            quality['is_trusted'] = True
        if not quality['is_trusted']:
            print(f"[quality_gate] rejected: {quality}")
        health = self.session_quality.update(quality['is_trusted'])
        if quality['is_trusted'] and not ref_trusted and not self.disable_quality_gate:
            self._itakura_baseline_filtered_bipolar = unclamped
            self._itakura_ref_from_live = True

        if not quality['is_trusted']:
            provisional = self._provisional_score(raw_feats, quality, elapsed_sec)
            return {
                'window': block_no, 'skipped': True, 'calibrated_p': None,
                'high_load_alert': False, 'micro_break_recommended': False,
                'fatigue_warning': False, 'cooldown_logged': False,
                'baseline_degraded': self.baseline_degraded,
                'wave_uv': wave_uv,
                'eeg_responsive': self.eeg_responsive,
                'mu_rest': self.mu_rest,
                'personal_sigma': self.sigma,
                'personal_z_alert': self.z_alert,
                'amplitude_gain': self.amplitude_gain,
                **provisional,
                **raw_feats,
                **{f'quality_{k}': v for k, v in quality.items()},
                **{f'session_{k}': v for k, v in health.items()},
            }

        row = dict(raw_feats)
        missing = [c for c in self.feature_columns if c not in row]
        if missing:
            raise RuntimeError(f'Feature mismatch vs. trained model, missing: {missing}')

        X = np.array([[row[c] for c in self.feature_columns]])
        raw_score = float(self.model.predict_proba(X)[:, 1][0])
        calibrated_p = max(0.0, min(1.0, raw_score - self.baseline_shift))

        row['raw_score'] = raw_score
        row['calibrated_p'] = calibrated_p
        row['task_state_z'] = self.personal_z(raw_score)
        row['theta_ratio'] = raw_feats_unprefixed['theta_alpha_ratio']
        row['spectral_slope'] = raw_feats_unprefixed['spectral_slope']
        row['window'] = len(self._history)
        self._history.append(row)

        self.adaptive_baseline.maybe_update(calibrated_p, raw_feats)

        states = compute_states(pd.DataFrame(self._history), self.thresholds)
        result = states.iloc[-1].to_dict()
        result['skipped'] = False
        result['window'] = block_no  # see block_no above; row['window'] stays the scored-history index
        result['baseline_degraded'] = self.baseline_degraded
        result['baseline_drift'] = self.adaptive_baseline.drift()
        result['baseline_drift_n_calm_blocks'] = self.adaptive_baseline.n_calm_updates
        result['wave_uv'] = wave_uv
        result['eeg_responsive'] = self.eeg_responsive
        result['mu_rest'] = self.mu_rest
        result['personal_sigma'] = self.sigma
        result['personal_scale'] = self.personal_scale
        result['personal_z_alert'] = self.z_alert
        result['amplitude_gain'] = self.amplitude_gain
        result.update({f'quality_{k}': v for k, v in quality.items()})
        result.update({f'session_{k}': v for k, v in health.items()})
        return result
