from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from backend.psychological.sam40.decision import DecisionThresholds, compute_states, compute_baseline_shift  # noqa: E402
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
SETTLING_TIME_SEC = 30.0
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


class RealtimeInference:
    def __init__(self, model_dir: Path, thresholds: DecisionThresholds = DecisionThresholds(),
                 quality_window_blocks: int = 8, calibration_min_rating: str = 'GOOD',
                 disable_quality_gate: bool = False):
        artifact = joblib.load(Path(model_dir) / 'sam40_t7t8_state_model.joblib')
        self.model = artifact['model']
        self.feature_columns = artifact['feature_columns']
        self.thresholds = thresholds
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
            if quality['gate_rating'] != 'POOR':
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
            return {'status': 'degraded', 'baseline_degraded': True, 'score': best_score}
        return {'status': 'failed', 'baseline_degraded': None}

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

        if elapsed_sec < SETTLING_TIME_SEC:
            quality['is_trusted'] = False
            quality['gate_rating'] = 'POOR'
            quality['reason'] = (f"session-elapsed {elapsed_sec:.0f}s < "
                                  f"SETTLING_TIME_SEC ({SETTLING_TIME_SEC:.0f}s) -- "
                                  f"electrode/contact settling window, not scored")

        if self.disable_quality_gate:
            quality['is_trusted'] = True
        if not quality['is_trusted']:
            print(f"[quality_gate] rejected: {quality}")
        health = self.session_quality.update(quality['is_trusted'])

        raw_feats_unprefixed = channel_features(filtered, fs=TARGET_FS)
        raw_feats = {f'bipolar_{k}': v for k, v in raw_feats_unprefixed.items()}

        if not quality['is_trusted']:
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
        result.update({f'quality_{k}': v for k, v in quality.items()})
        result.update({f'session_{k}': v for k, v in health.items()})
        return result
