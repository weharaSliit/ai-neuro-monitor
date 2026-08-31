"""Real-time block processor: raw ADC samples -> decision values.

Chain: raw codes -> uV conversion -> preprocess_block() [glitch/spike filter
-> uniform-250Hz-grid interpolation -> resample 250Hz->128Hz -> notch+bandpass]
-> quality gate (quality_gate.py, assessed on this SAME processed signal --
reject the block here if it fails) -> feature extraction (25s block,
matching the offline `random_forest` model exactly) -> model inference ->
baseline-relative normalization (needs a stored per-user Relax reference,
see `UserBaseline`) -> decision state.

IMPORTANT: preprocess_block() is computed ONCE per block and its output is
reused for BOTH the quality gate and feature extraction -- the gate used to
run its own separate, weaker internal filtering on raw codes, which
(confirmed against real captured hardware data) reported amplitude up to
~25x different from what the model actually receives. See quality_gate.py's
module docstring for the full story; do not reintroduce a second filtering
path for the gate.

A block that fails the quality gate is scored `is_trusted=False` and is
skipped entirely -- not fed to the model, not added to decision-state
history (so persistence-gated states aren't corrupted by a bad block), and
not used to update the baseline while still calibrating.

MODEL CHOICE, AND WHY THE DEFAULT CHANGED: the original offline model was
trained on T7/T8 after common-average-referencing (CAR) against SAM40's
full 32-channel montage -- a reference this 2-electrode hardware can never
reproduce (0.795 AUC offline, but NOT the signal distribution deployed
hardware actually produces; see results/methodology/03_feature_engineering.md).
The default model here is instead trained SOLELY on the bipolar
differential (T7-T8) feature set -- reference-agnostic by construction,
since (T7-REF)-(T8-REF) = T7-T8 regardless of what REF is. Its offline LOSO
ceiling is lower (0.706 AUC) but it is not trained on a reference the
hardware can't produce, so it is the honest choice for actual deployment.
The CAR-trained model remains available (results/models_25s_block/) for
offline-benchmark comparison, but should not be pointed at live hardware.

A z-score baseline-normalization variant was tested as a candidate to close
the 0.706-vs-0.795 gap further and REJECTED: at 25s-block granularity SAM40
provides only 3 Relax blocks per subject, and self-standardizing exactly
those 3 blocks against their own mean/std is a well-defined statistical
degeneracy (the 3 resulting z-scores are constrained to sum to ~0 and their
squares to sum to a fixed value, REGARDLESS of the actual signal) -- this
gives the model a trivially learnable artifact, not real signal, and
inflated LOSO AUC to ~0.996. Do not deploy it; see
results/methodology/03_feature_engineering.md for the reproduction.
"""

import sys
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'src'))

from sam40.decision import DecisionThresholds, compute_states  # noqa: E402
from sam40.derived_features import add_baseline_relative  # noqa: E402
from sam40.features import epoch_features  # noqa: E402
from sam40.preprocess import notch_then_bandpass  # noqa: E402

from .adc import code_to_microvolts  # noqa: E402
from .mqtt_client import RawSample  # noqa: E402
from .quality_gate import TrustedIoTEEGValidator  # noqa: E402
from .raw_cleaning import clean_raw_channel  # noqa: E402
from .resample import SOURCE_FS, TARGET_FS, resample_to_target  # noqa: E402

CHANNELS = ['T7', 'T8']
BLOCK_SEC = 25.0
BLOCK_SAMPLES_RAW = int(BLOCK_SEC * SOURCE_FS)  # samples to drain from the buffer per block
DERIVED_SUFFIXES = ['delta_rel_power', 'theta_rel_power', 'alpha_rel_power', 'beta_rel_power',
                     'gamma_rel_power', 'theta_alpha_ratio', 'beta_alpha_ratio', 'sample_entropy',
                     'hjorth_complexity']


@dataclass
class UserBaseline:
    """Per-user Relax-condition reference for baseline-relative features.
    Populate via record_calibration_block() during an initial rest period
    before real-time monitoring begins (mirrors add_baseline_relative()'s
    training-time use of SAM40's Relax condition).
    """
    blocks: list = field(default_factory=list)

    def add(self, raw_features: dict) -> None:
        self.blocks.append(raw_features)

    def mean(self) -> dict | None:
        if not self.blocks:
            return None
        return pd.DataFrame(self.blocks).mean().to_dict()


class AdaptiveBaselineTracker:
    """Tracks slow drift in what "calm" looks like over a session --
    MONITORING ONLY, does not feed back into calibrated_p or any decision
    output. Deliberately does NOT adapt from every block (that would let a
    genuine sustained high-load episode slowly get absorbed into the
    baseline and never trigger high_load_alert): only updates from blocks
    that already score at/below the session's own cooldown_low_p, i.e.
    blocks the model itself currently reads as calm. This is unsupervised
    (no ground-truth label used, none is available/trustworthy for this
    project, see the deployed model's Section 1 caveat) and self-
    referential (uses the model's own low-probability output as a calm
    proxy), so treat drift as a soft diagnostic, not a validated
    correction signal -- there is no labeled data in this project (yet)
    to confirm it tracks real electrode/hardware degradation rather than
    genuine low-arousal variation.

    Not wired into feature correction: the deployed bipolar-only model
    does not read baseline-relative (_blrel) features at all (see
    CURRENT_SYSTEM.md Section 3), so there is currently nothing for a
    drift correction to feed into without a separate, larger design
    decision (retraining on drift-corrected features, or altering the
    live feature vector in a way the model was never trained on).
    """

    def __init__(self, ema_alpha: float = 0.08, calm_threshold: float = 0.725):
        self.ema_alpha = ema_alpha
        self.calm_threshold = calm_threshold
        self._static_mean: dict | None = None   # frozen at end of calibration
        self._adaptive_mean: dict | None = None  # EMA, updated only from calm-looking blocks
        self.n_calm_updates = 0

    def initialize(self, static_mean: dict) -> None:
        """Call once, right after calibration ends -- seeds the adaptive
        mean from the same reference the static baseline uses."""
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
        """Mean absolute relative difference between the adaptive and static
        means, across all tracked features -- 0 = no drift detected yet."""
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
    """One block's raw ADC samples -> clean, filtered T7/T8 signal at 128Hz
    (shape (2, duration_sec*TARGET_FS)) -- the "[Clean EEG]" end of the
    chain, BEFORE feature extraction. `RealtimeInference` computes this
    ONCE per block and reuses it for both the quality gate (quality_gate.py)
    and epoch_features() -- exposed standalone (not just inlined) so other
    callers -- e.g. --log-preprocessed-csv in scripts/realtime_inference.py,
    or scripts/check_signal_quality.py's variable-length offline epochs --
    can inspect/log the actual post-preprocessing signal too.

    duration_sec: output grid span for the uniform-250Hz-grid interpolation
    step (see raw_cleaning.interpolate_to_uniform_grid). Defaults to
    BLOCK_SEC (25s, matching len(samples) for the live pipeline's fixed
    25s blocks) -- pass this explicitly when `samples` isn't a full 25s
    block, or the interpolation will stretch/extrapolate the wrong span.

    Chain: raw codes -> uV -> [glitch/spike filter + uniform-250Hz-grid
    interpolation, raw_cleaning.py -- corrects for IoT telemetry issues
    (spikes, WiFi/MQTT jitter/drops) SAM40's offline recordings never had]
    -> resample_to_target (250->128Hz) -> notch_then_bandpass -> [Clean EEG].
    """
    duration_sec = BLOCK_SEC if duration_sec is None else duration_sec
    millis = np.array([s.millis for s in samples], dtype=float)
    ch1_uv = code_to_microvolts(np.array([s.ch1_code for s in samples]))
    ch2_uv = code_to_microvolts(np.array([s.ch2_code for s in samples]))

    ch1_clean, _ = clean_raw_channel(millis, ch1_uv, target_fs=SOURCE_FS, duration_sec=duration_sec)
    ch2_clean, _ = clean_raw_channel(millis, ch2_uv, target_fs=SOURCE_FS, duration_sec=duration_sec)
    raw = np.stack([ch1_clean, ch2_clean], axis=0)  # (2, n_samples_at_250Hz), exactly duration_sec*SOURCE_FS long

    resampled = resample_to_target(raw, source_fs=SOURCE_FS, target_fs=TARGET_FS)  # -> 128Hz
    filtered = notch_then_bandpass(resampled, fs=TARGET_FS)
    # NOTE: no common-average-reference here -- see module docstring.
    return filtered


def _raw_codes(samples: list[RawSample]) -> tuple[np.ndarray, np.ndarray]:
    ch1 = np.array([s.ch1_code for s in samples], dtype=float)
    ch2 = np.array([s.ch2_code for s in samples], dtype=float)
    return ch1, ch2


class SessionQualityMonitor:
    """Tracks the rolling block-rejection rate over a session and classifies
    it against a literature-benchmark rejection-rate scale (not derived from
    this project's own data -- treat these bands as a starting reference, to
    be replaced once real per-user sessions with known-good/known-bad setups
    are available to calibrate against, per `06_realtime_hardware.md`):

        0%-20% rejection  (>=80% acceptance): CLEAN     -- normal baseline session
        20%-50% rejection (50%-80% acceptance): USABLE   -- minor artifacts (blink/muscle)
        >50% rejection    (<50% acceptance):  SETUP_FAILURE -- poor skin impedance,
                                                ungrounded/missing reference, or
                                                electrode movement

    Deliberately per-session, not per-block: a single bad block is expected
    and handled by the quality gate itself (see quality_gate.py); this
    monitor exists to catch the case where MOST blocks are bad, which means
    something is wrong with the setup, not the signal.
    """

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
                 quality_window_blocks: int = 8, calibration_min_rating: str = 'GOOD'):
        """calibration_min_rating: minimum SignalQualityGate rating a block
        must reach to be used as this user's baseline reference. Default
        'GOOD' (not just non-POOR) -- backed by every real-hardware quality
        reading collected during this project's live debugging: every
        genuinely clean epoch scored >=85.4 (GOOD), while every calibration
        block collected during a session that turned out to have a hardware
        fault topped out at 79.9 (QUESTIONABLE) and never once reached GOOD.
        The GOOD/QUESTIONABLE boundary (score 80) is a real, observed
        separator in that data, not an arbitrary pick -- see
        results/methodology/06_realtime_hardware.md for the full comparison.
        A bad baseline poisons the whole session (every _blrel feature AND
        the Itakura clean-reference derive from it), so calibration
        deliberately holds a stricter bar than a normal inference block.
        """
        artifact = joblib.load(Path(model_dir) / 'sam40_t7t8_state_model.joblib')
        self.model = artifact['model']
        self.feature_columns = artifact['feature_columns']
        self.thresholds = thresholds
        self.baseline = UserBaseline()
        self._history: list[dict] = []  # for persistence-aware decision states across blocks
        self.quality_validator = TrustedIoTEEGValidator(fs_raw=SOURCE_FS, fs_filtered=TARGET_FS, max_amplitude=7000.0)
        # first trusted calibration block's filtered T7/T8 signal, one Itakura reference per channel
        # (see quality_gate.py's validate_epoch -- CH2 gets its own Itakura check, not just CH1's)
        self._itakura_baseline_filtered_ch1: np.ndarray | None = None
        self._itakura_baseline_filtered_ch2: np.ndarray | None = None
        self.session_quality = SessionQualityMonitor(window_blocks=quality_window_blocks)
        self.calibration_min_rating = calibration_min_rating
        # (score, features, filtered T7 signal, filtered T8 signal) for every non-POOR calibration
        # attempt, whether or not it met calibration_min_rating -- candidates for
        # finalize_calibration's degraded fallback.
        self._calibration_attempts: list[tuple[float, dict, np.ndarray, np.ndarray]] = []
        self.baseline_degraded: bool = False
        self.baseline_degraded_score: float | None = None
        self.adaptive_baseline = AdaptiveBaselineTracker(calm_threshold=thresholds.cooldown_low_p)

    def calibrate_block(self, samples: list[RawSample]) -> dict:
        """Feed one Relax-period block into this user's baseline reference,
        gated by the Step-0 quality check PLUS the stricter
        calibration_min_rating bar (see __init__ docstring for why
        calibration needs a higher bar than a normal inference block; no
        clean-signal baseline exists yet during calibration for the full
        Itakura-distance check, so this uses the 9-factor gate score only).
        A block that fails is NOT used as baseline immediately, but (unless
        POOR) is kept as a candidate for finalize_calibration's optional
        degraded fallback.
        """
        ch1_codes, ch2_codes = _raw_codes(samples)
        filtered = preprocess_block(samples)  # the ACTUAL signal the model would see -- see quality_gate.py docstring
        feats = epoch_features(filtered, channel_names=CHANNELS, fs=TARGET_FS, include_bipolar=True)
        quality = self.quality_validator.assess_only(ch1_codes, ch2_codes, filtered[0], filtered[1])
        meets_bar = RATING_ORDER.get(quality['gate_rating'], -1) >= RATING_ORDER[self.calibration_min_rating]
        quality['is_trusted'] = meets_bar  # overrides assess_only's looser (non-POOR) default for calibration use
        if not meets_bar:
            if quality['gate_rating'] != 'POOR':
                self._calibration_attempts.append((quality['quality_score'], feats, filtered[0], filtered[1]))
            return quality
        self.baseline.add(feats)
        if self._itakura_baseline_filtered_ch1 is None:
            self._itakura_baseline_filtered_ch1 = filtered[0]
            self._itakura_baseline_filtered_ch2 = filtered[1]
        self.quality_validator.record_calibration_epoch(filtered[0])
        return quality

    def finalize_calibration(self, allow_degraded: bool = False) -> dict:
        """Call once after the calibration window ends. Three outcomes:
          'ok'      -- at least one block met calibration_min_rating; normal baseline in place.
          'degraded'-- none met the bar, but allow_degraded=True and at least one non-POOR
                       attempt exists: uses the SINGLE best-scoring attempt as baseline (explicitly
                       flagged via self.baseline_degraded, propagated into every subsequent
                       infer_block() result -- this is a fallback for keeping the pipeline
                       exercisable while a real hardware fault is being diagnosed, NOT a fix;
                       any resulting task_state_score should not be treated as trustworthy).
          'failed'  -- no usable calibration data at all (nothing non-POOR); caller should stop.
        """
        if self.baseline.blocks:
            self.adaptive_baseline.initialize(self.baseline.mean())
            return {'status': 'ok', 'baseline_degraded': False, 'n_blocks': len(self.baseline.blocks)}
        if allow_degraded and self._calibration_attempts:
            best_score, best_feats, best_filtered_ch1, best_filtered_ch2 = max(
                self._calibration_attempts, key=lambda t: t[0])
            self.baseline.add(best_feats)
            self._itakura_baseline_filtered_ch1 = best_filtered_ch1
            self._itakura_baseline_filtered_ch2 = best_filtered_ch2
            self.quality_validator.record_calibration_epoch(best_filtered_ch1)
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
        health = self.session_quality.update(quality['is_trusted'])

        if not quality['is_trusted']:
            # Untrusted blocks are neither scored nor added to decision-state
            # history -- a gap in `window` here means a block was skipped,
            # not that time stood still.
            return {
                'window': len(self._history), 'skipped': True, 'calibrated_p': None,
                'high_load_alert': False, 'micro_break_recommended': False,
                'fatigue_warning': False, 'cooldown_logged': False,
                'baseline_degraded': self.baseline_degraded,
                **{f'quality_{k}': v for k, v in quality.items()},
                **{f'session_{k}': v for k, v in health.items()},
            }

        raw_feats = epoch_features(filtered, channel_names=CHANNELS, fs=TARGET_FS, include_bipolar=True)
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

        row['raw_score'] = raw_score
        row['calibrated_p'] = raw_score  # see note in end_to_end_demo.py: no standalone calibrator persisted
        row['theta_ratio'] = np.mean([row['T7_theta_alpha_ratio'], row['T8_theta_alpha_ratio']])
        row['spectral_slope'] = np.mean([row['T7_spectral_slope'], row['T8_spectral_slope']])
        row['window'] = len(self._history)
        self._history.append(row)

        self.adaptive_baseline.maybe_update(raw_score, raw_feats)  # monitoring only -- see class docstring

        states = compute_states(pd.DataFrame(self._history), self.thresholds)
        result = states.iloc[-1].to_dict()
        result['skipped'] = False
        result['baseline_degraded'] = self.baseline_degraded
        result['baseline_drift'] = self.adaptive_baseline.drift()
        result['baseline_drift_n_calm_blocks'] = self.adaptive_baseline.n_calm_updates
        result.update({f'quality_{k}': v for k, v in quality.items()})
        result.update({f'session_{k}': v for k, v in health.items()})
        return result
