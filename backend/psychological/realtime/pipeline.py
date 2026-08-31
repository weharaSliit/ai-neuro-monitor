from collections import deque
from dataclasses import dataclass, field, replace
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from backend.psychological.sam40.decision import (  # noqa: E402
    DecisionThresholds, compute_baseline_shift, compute_personal_threshold, compute_states,
)
from backend.psychological.sam40.derived_features import add_baseline_relative  # noqa: E402
from backend.psychological.sam40.features import channel_features, epoch_features  # noqa: E402
from backend.psychological.sam40.preprocess import notch_then_bandpass  # noqa: E402

from .adc import (  # noqa: E402
    bipolar_code_to_microvolts, clip_physiological_uv, code_to_microvolts, raw_magnitude_ok,
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


def preprocess_bipolar_block(samples: list[BipolarRawSample], duration_sec: float | None = None) -> np.ndarray:
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
    detrended_uv = raw_uv - np.mean(raw_uv)  # BEFORE any clamping -- see docstring
    wide_despiked_uv = np.clip(detrended_uv, -WIDE_DESPIKE_UV, WIDE_DESPIKE_UV)

    # clean_raw_channel()'s MAD-based despike (ceiling 10,000uV) + grid
    # interpolation now run on an ALREADY-bounded signal -- its own
    # max_spike_fraction bail-out is no longer load-bearing for keeping the
    # filter's input sane, since wide_despiked_uv already guarantees that.
    clean, _ = clean_raw_channel(millis, wide_despiked_uv, target_fs=SOURCE_FS, duration_sec=duration_sec)
    resampled = resample_to_target(clean, source_fs=SOURCE_FS, target_fs=TARGET_FS)  # -> 128Hz
    filtered = notch_then_bandpass(resampled, fs=TARGET_FS, low=BIPOLAR_HIGHPASS_HZ)  # see BIPOLAR_HIGHPASS_HZ docstring

    # Tight physiological clamp LAST -- a final safety net against residual
    # filter-transient excursions, not the first thing the raw signal sees.
    filtered = clip_physiological_uv(filtered)
    return filtered


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
        self.personal_high_load_p: float | None = None

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
            shift = compute_baseline_shift(self._calibration_scores)
            if shift is not None:
                self.baseline_shift = shift
                self.thresholds_personalized = True
            return {
                'status': 'ok', 'baseline_degraded': False, 'n_blocks': len(self.baseline.blocks),
                'thresholds_personalized': self.thresholds_personalized,
                'resting_calibrated_p': (float(np.mean(self._calibration_scores))
                                          if self._calibration_scores else None),
                'baseline_shift': self.baseline_shift,
            }
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

        filtered = preprocess_bipolar_block(samples)  # the ACTUAL signal the model would see
        feats = channel_features(filtered, fs=TARGET_FS)  # unprefixed -- see infer_bipolar_block()
        quality = self.quality_validator.assess_only_single(raw_code, filtered)

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
            self._calibration_attempts_bipolar.append((quality['quality_score'], feats, filtered))
            return quality
        self.baseline.add({f'bipolar_{k}': v for k, v in feats.items()})
        if self._itakura_baseline_filtered_bipolar is None:
            self._itakura_baseline_filtered_bipolar = filtered
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
            shift = compute_baseline_shift(self._calibration_scores)
            if shift is not None:
                self.baseline_shift = shift
                self.thresholds_personalized = True
            return {
                'status': 'ok', 'baseline_degraded': False, 'n_blocks': len(self.baseline.blocks),
                'thresholds_personalized': self.thresholds_personalized,
                'resting_calibrated_p': (float(np.mean(self._calibration_scores))
                                          if self._calibration_scores else None),
                'baseline_shift': self.baseline_shift,
            }
        if allow_degraded and self._calibration_attempts_bipolar:
            best_score, best_feats, best_filtered = max(
                self._calibration_attempts_bipolar, key=lambda t: t[0])
            self.baseline.add({f'bipolar_{k}': v for k, v in best_feats.items()})
            self._itakura_baseline_filtered_bipolar = best_filtered
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
            return {'status': 'degraded', 'baseline_degraded': True, 'score': best_score}
        return {'status': 'failed', 'baseline_degraded': None}

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

        filtered = preprocess_bipolar_block(samples)
        feats = channel_features(filtered, fs=TARGET_FS)
        quality = self.quality_validator.assess_only_single(raw_code, filtered)

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
        threshold = compute_personal_threshold(self._calibration_scores, self._task_scores)
        outcome = {
            'status': 'ok' if threshold is not None else 'not_separated',
            'personal_high_load_p': threshold,
            'resting_mean': float(np.mean(self._calibration_scores)) if self._calibration_scores else None,
            'task_mean': float(np.mean(self._task_scores)) if self._task_scores else None,
            'n_task_blocks': len(self._task_scores),
        }
        if threshold is not None:
            self.personal_high_load_p = threshold
            self.thresholds = replace(self.thresholds, high_load_p=threshold, cooldown_high_p=threshold)
        return outcome

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

    def infer_bipolar_block(self, samples: list[BipolarRawSample]) -> dict:
        raw_code = _raw_bipolar_codes(samples)
        elapsed_sec = self._bipolar_blocks_processed * BLOCK_SEC
        self._bipolar_blocks_processed += 1

        # Cheap early reject BEFORE the filter chain runs -- see adc.py's
        # MAX_RAW_UV docstring. No raw_feats/filtered signal to report here
        # (that's the point -- this skips the filter pass entirely), unlike
        # the settling-window/quality-gate rejections below which still run
        # preprocessing for the live feature readout.
        if not (self.disable_quality_gate or raw_magnitude_ok(bipolar_code_to_microvolts(raw_code))):
            print(f"[quality_gate] rejected: raw signal exceeds MAX_RAW_UV, filter chain skipped")
            health = self.session_quality.update(False)
            return {
                'window': len(self._history), 'skipped': True, 'calibrated_p': None,
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
                'window': len(self._history), 'skipped': True, 'calibrated_p': None,
                'high_load_alert': False, 'micro_break_recommended': False,
                'fatigue_warning': False, 'cooldown_logged': False,
                'baseline_degraded': self.baseline_degraded,
                'quality_is_trusted': False, 'quality_gate_rating': 'POOR', 'quality_quality_score': 0.0,
                'quality_reason': 'dropped-packet gap exceeds MAX_GAP_SEC -- interpolation would fabricate signal',
                **{f'session_{k}': v for k, v in health.items()},
            }

        filtered = preprocess_bipolar_block(samples)  # computed ONCE, reused for both the gate and feature extraction
        baseline_filtered = (self._itakura_baseline_filtered_bipolar
                              if self._itakura_baseline_filtered_bipolar is not None else filtered)
        quality = self.quality_validator.validate_epoch_single(raw_code, filtered, baseline_filtered)
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
        raw_feats_unprefixed = channel_features(filtered, fs=TARGET_FS)
        raw_feats = {f'bipolar_{k}': v for k, v in raw_feats_unprefixed.items()}

        if (self._delta_power_reject_threshold is not None
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

        if not quality['is_trusted']:
            return {
                'window': len(self._history), 'skipped': True, 'calibrated_p': None,
                'high_load_alert': False, 'micro_break_recommended': False,
                'fatigue_warning': False, 'cooldown_logged': False,
                'baseline_degraded': self.baseline_degraded,
                'wave_uv': wave_uv,
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
        row['theta_ratio'] = raw_feats_unprefixed['theta_alpha_ratio']
        row['spectral_slope'] = raw_feats_unprefixed['spectral_slope']
        row['window'] = len(self._history)
        self._history.append(row)

        self.adaptive_baseline.maybe_update(calibrated_p, raw_feats)

        states = compute_states(pd.DataFrame(self._history), self.thresholds)
        result = states.iloc[-1].to_dict()
        result['skipped'] = False
        result['baseline_degraded'] = self.baseline_degraded
        result['baseline_drift'] = self.adaptive_baseline.drift()
        result['baseline_drift_n_calm_blocks'] = self.adaptive_baseline.n_calm_updates
        result['wave_uv'] = wave_uv
        result.update({f'quality_{k}': v for k, v in quality.items()})
        result.update({f'session_{k}': v for k, v in health.items()})
        return result
