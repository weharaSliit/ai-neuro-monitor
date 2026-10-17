# ============================================================
# predictor.py
# Loads the binary (Normal/Stress) model and handles all
# prediction logic — personalized baseline + feature-aware
# trend detection. WESAD simulation (3-class) has been removed;
# the real ring is the only deployment target.
# ============================================================

import numpy as np
import joblib
from backend.common.config import (
    MODEL_FILE, SCALER_FILE, FEATURES_FILE,
    N_BASELINE_WIN, EMA_ALPHA,
    STRESS_LABELS, TREND_RISING_THRESHOLD,
    STRESS_DECISION_THRESHOLD, RAW_DECISION_THRESHOLD,
    RAW_MODEL_FILE, RAW_SCALER_FILE, RAW_FEATURES_FILE
)

print("Loading model files...")
try:
    model        = joblib.load(MODEL_FILE)
    scaler       = joblib.load(SCALER_FILE)
    feature_cols = joblib.load(FEATURES_FILE)
    print(f"  Model: {type(model).__name__} ✓")
    print(f"  Features: {len(feature_cols)} ✓")
    raw_model        = joblib.load(RAW_MODEL_FILE)
    raw_scaler       = joblib.load(RAW_SCALER_FILE)
    raw_feature_cols = joblib.load(RAW_FEATURES_FILE)
    assert list(raw_feature_cols) == list(feature_cols)
except FileNotFoundError as e:
    # Auth/user/EMA routes don't touch the ring model at all -- letting a
    # missing local model artifact take down the whole app (including
    # /login) couples two unrelated concerns. predict_window/predict_raw
    # below raise a clear error instead if actually called with no model.
    model = scaler = raw_model = raw_scaler = None
    feature_cols = []
    print(f"  WARNING: model artifacts not found ({e}) -- /predict, /calibrate, "
          f"and EMA/baseline routes will not work until MODEL_FILE/SCALER_FILE/"
          f"FEATURES_FILE (backend/common/config.py) point to real files. "
          f"Auth and other non-model routes are unaffected.")

# pNN20 is a proportion (0-1) in the ring code but a percentage (0-95) in
# the WESAD training table. predict_raw() scores raw features, so it must
# convert; predict_window() does not need to, because normalize_features()
# divides the deviation by the same user's own baseline std (both in ring
# units), which cancels the scale.
PNN20_TRAIN_SCALE = 100.0

# A feature only votes "rising/falling" when it moved by more than ordinary
# calm variability over the whole window, not merely in the right direction
# in 3 of 4 steps. Without this, a slow steady drift (skin conductance
# creeping up while sitting still, five skin features voting together) kept
# the flag on in ~half of calm live windows. The net change must exceed
# TREND_MIN_RISE_SD of this user's baseline standard deviation, and at least
# TREND_MIN_RISE_REL of the baseline value.
TREND_MIN_RISE_REL = 0.05
TREND_MIN_RISE_SD = 0.5

# ── Feature type definitions ──────────────────────────────────
EDA_FEATURES = [
    'SCL_mean', 'SCL_std', 'SCL_slope',
    'EDA_mean', 'EDA_std', 'EDA_range', 'EDA_slope',
    'SCR_count', 'SCR_amp_mean', 'SCR_width_mean',
    'EDA_q10', 'EDA_q25', 'EDA_q75', 'EDA_q90',
    'deriv1_mean', 'deriv1_std', 'deriv2_mean',
    'wavelet_approx_mean', 'wavelet_approx_energy',
    'wavelet_d1_energy', 'wavelet_d2_energy',
    'wavelet_d3_energy'
]

# ── Feature groups from exploratory analysis ──────────────────
# Used only for trending_toward_stress direction voting (see
# StressStateMachine below) — never affects the hard Normal/
# Stress label, which comes from the model alone.
# Pattern 1: monotonic rise from Normal toward Stress (tonic EDA)
MONOTONIC_UP = [
    'EDA_q75', 'EDA_mean', 'SCL_mean',
    'ACC_std', 'EDA_q10', 'EDA_q90'
]

# Pattern 2: rises during onset, then falls once sustained (phasic alarm)
PHASIC_PEAK = [
    'MeanHR', 'SDHR', 'SCR_count',
    'SCR_width_mean', 'SCR_amp_mean',
    'EDA_slope', 'deriv1_std', 'deriv2_mean',
    'EDA_std', 'wavelet_d1_energy',
    'EDA_range', 'wavelet_d3_energy'
]

# Pattern 3: trough (fall during stress onset)
TROUGH = [
    'AVNN', 'pNN20', 'SD1', 'ACC_mean'
]


# ── Personalized normalization ────────────────────────────────
def compute_baseline(X_windows, y_windows=None,
                     n_windows=N_BASELINE_WIN):
    if y_windows is not None:
        normal_mask = (y_windows == 0)
        normal_wins = X_windows[normal_mask]
        if len(normal_wins) == 0:
            normal_wins = X_windows[:n_windows]
    else:
        normal_wins = X_windows[:n_windows]

    if len(normal_wins) > n_windows:
        normal_wins = normal_wins[:n_windows]

    b_mean = np.mean(normal_wins, axis=0)
    b_std  = np.std(normal_wins,  axis=0)

    min_std = np.abs(b_mean) * 0.10
    min_std = np.where(min_std < 0.01, 0.01, min_std)
    b_std   = np.where(b_std < min_std, min_std, b_std)

    return b_mean, b_std


def update_baseline_ema(old_mean, old_std,
                        new_mean, new_std,
                        alpha=EMA_ALPHA):
    updated_mean = alpha * new_mean + (1 - alpha) * old_mean
    updated_std  = alpha * new_std  + (1 - alpha) * old_std
    return updated_mean, updated_std


# Minimum required separation between this user's own resting and task
# prob_stress means before a personal threshold is trusted -- physiological's
# own copy of the same idea as backend/psychological/sam40/decision.py's
# compute_personal_threshold() (kept local, not shared, matching this
# project's existing pattern of physiological/psychological never sharing
# domain logic -- see backend/common/mqtt_bridge.py's module docstring for
# the same reasoning applied to transport code). EEG derives its floor from
# a real SAM40 LOSO population-percentile spread
# (MAX_THRESHOLD_SHIFT ~= 0.11); physiological has no equivalent calibrated
# percentile file for this WESAD-trained model, so this is a plain,
# documented default of the same order of magnitude, not a data-derived
# value -- revisit if a real percentile analysis for this model becomes
# available.
PERSONAL_THRESHOLD_MIN_SEPARATION = 0.10


# Midpoint threshold calibration -- same method as EEG
# (backend/psychological/sam40/decision.py midpoint_threshold_logit()), on
# prob_stress directly (ring scores sit mid-range, so no log-odds needed):
#   baseline   = median(resting scores)
#   task_level = mean(task scores after the ramp-up: first 2 x 60 s windows)
#   limit      = (baseline + task_level) / 2
#   personal   = task_level - baseline >= 1 x SD(rest), with the SD floored
#                at PERSONAL_THRESHOLD_MIN_SEPARATION (4 rest windows give a
#                noisy, sometimes ~0 SD).
TASK_RAMP_SKIP_WINDOWS = 2


# ABA drift check, same rule as EEG (sam40/decision.py
# MIN_RECOVERY_REVERSAL_SD): recovery must come back down from the task
# level by at least half the separation needed, or the rise is treated as
# slow drift (sweat build-up on the GSR electrodes, fatigue), not the task.
# Upward only here: prob_stress is autonomic arousal, which rises under load.
MIN_RECOVERY_REVERSAL = 0.5


def midpoint_stress_threshold(resting_scores, task_scores, skip=TASK_RAMP_SKIP_WINDOWS, recovery_scores=None):
    """Baseline, sustained task level, midpoint limit and whether it is
    personal (separated enough, and confirmed by recovery when recovery
    windows exist). None without rest or task scores.
    status: 'ok' | 'not_separated' | 'drift_suspected'."""
    if len(resting_scores) < 1 or len(task_scores) < 1:
        return None
    k = min(skip, len(task_scores) // 2)
    baseline = float(np.median(resting_scores))
    task_level = float(np.mean(task_scores[k:]))
    rest_sd = float(np.std(resting_scores, ddof=1)) if len(resting_scores) > 1 else 0.0
    needed = max(rest_sd, PERSONAL_THRESHOLD_MIN_SEPARATION)
    separated = bool(task_level - baseline >= needed)
    rec = [float(r) for r in (recovery_scores or []) if r is not None]
    recovery_level = float(np.median(rec)) if rec else None
    reversal = None if recovery_level is None else task_level - recovery_level
    aba = None if reversal is None else bool(reversal >= MIN_RECOVERY_REVERSAL * needed)
    personal = separated and aba is not False
    return {
        'baseline': baseline, 'task_level': task_level,
        'limit': max(0.0, min(1.0, (baseline + task_level) / 2.0)),
        'rest_sd': rest_sd, 'needed_separation': needed,
        'separated': personal,
        'recovery_level': recovery_level, 'reversal': reversal, 'aba_confirmed': aba,
        'status': 'ok' if personal else ('drift_suspected' if separated else 'not_separated'),
        'n_task_used': len(task_scores) - k, 'n_task_skipped': k,
    }


def compute_personal_stress_threshold(resting_scores, task_scores, recovery_scores=None):
    """Personal threshold by the midpoint method (midpoint_stress_threshold()
    above), or None when rest and the sustained task aren't separated enough
    or recovery shows drift (the caller then keeps the population
    STRESS_DECISION_THRESHOLD)."""
    m = midpoint_stress_threshold(resting_scores, task_scores, recovery_scores=recovery_scores)
    return m['limit'] if m and m['separated'] else None


def _old_compute_personal_stress_threshold(resting_scores, task_scores):
    """Personal STRESS_DECISION_THRESHOLD from a deliberate onboarding task
    (a short, known high-load period run right after baseline calibration):
    threshold = midpoint between this user's own resting and task
    prob_stress means, both scored via predict_window() (the same
    baseline-normalized path /predict actually uses -- see
    save_resting_scores()'s docstring, firebase_service.py). Returns None
    (caller keeps the fixed population STRESS_DECISION_THRESHOLD) if the
    two groups aren't separated by at least PERSONAL_THRESHOLD_MIN_SEPARATION.
    Clamped to [0, 1] -- a plain probability bound, since (unlike EEG) no
    calibrated population percentile range exists here to clamp against.
    """
    if len(resting_scores) < 1 or len(task_scores) < 1:
        return None

    resting_mean = float(np.mean(resting_scores))
    task_mean = float(np.mean(task_scores))
    if task_mean - resting_mean < PERSONAL_THRESHOLD_MIN_SEPARATION:
        return None

    midpoint = (resting_mean + task_mean) / 2.0
    return max(0.0, min(1.0, midpoint))


def normalize_features(X, baseline_mean, baseline_std):
    X_norm = X.copy().astype(np.float64)
    for i, feat in enumerate(feature_cols):
        val  = X[:, i]
        mean = baseline_mean[i]
        std  = baseline_std[i]
        if feat in EDA_FEATURES:
            if abs(mean) > 0.001:
                X_norm[:, i] = val / mean
            else:
                X_norm[:, i] = val - mean
        else:
            X_norm[:, i] = (val - mean) / std
    return X_norm


# ── Main prediction functions ──────────────────────────────────
def predict_window(features_array, baseline_mean, baseline_std,
                   state_machine=None, feat_dict=None):
    """
    Binary Normal/Stress prediction with personal baseline
    normalization applied first.

    trending_toward_stress reuses the state machine's rising-
    feature voting — it's a separate flag, never a label override.
    Requires this window's features to be recorded into the state
    machine's history first, which happens here.
    """
    if model is None or scaler is None:
        raise RuntimeError(
            "physiological model artifacts not available on this machine -- "
            "see the WARNING printed at startup (predictor.py)"
        )

    X_norm   = normalize_features(features_array, baseline_mean, baseline_std)
    X_scaled = scaler.transform(X_norm)

    probs = model.predict_proba(X_scaled)[0]
    prob_normal, prob_stress = float(probs[0]), float(probs[1])

    # ROC-derived cutoff, not the implicit 0.5 -- see STRESS_DECISION_THRESHOLD's
    # docstring in backend/common/config.py.
    prediction = 1 if prob_stress > STRESS_DECISION_THRESHOLD else 0
    confidence = max(prob_normal, prob_stress)

    trending_toward_stress = False
    if state_machine is not None and feat_dict is not None:
        state_machine.baseline_std = baseline_std
        state_machine.history.append(feat_dict)
        if len(state_machine.history) > state_machine.window_size + 3:
            state_machine.history.pop(0)

        if len(state_machine.history) >= state_machine.window_size:
            votes_for, votes_against, total_votes = \
                state_machine._trend_votes(feat_dict)
            conf = votes_for / total_votes if total_votes > 0 else 0
            trending_toward_stress = conf >= TREND_RISING_THRESHOLD

    return {
        'prediction':  prediction,
        'label':       STRESS_LABELS[prediction],
        'prob_normal': prob_normal,
        'prob_stress': prob_stress,
        'confidence':  confidence,
        'trending_toward_stress': trending_toward_stress
    }


def predict_raw(features_array):
    """Binary prediction with no personal baseline normalization yet."""
    if raw_model is None or raw_scaler is None:
        raise RuntimeError(
            "physiological model artifacts not available on this machine -- "
            "see the WARNING printed at startup (predictor.py)"
        )
    # Raw-feature (v2) model: needs the training units for pNN20.
    X = np.array(features_array, dtype=np.float64, copy=True)
    X[:, feature_cols.index('pNN20')] *= PNN20_TRAIN_SCALE
    X_scaled = raw_scaler.transform(X)
    probs = raw_model.predict_proba(X_scaled)[0]
    prob_normal, prob_stress = float(probs[0]), float(probs[1])
    prediction = 1 if prob_stress > RAW_DECISION_THRESHOLD else 0
    return {
        'prediction':  prediction,
        'label':       STRESS_LABELS[prediction],
        'prob_normal': prob_normal,
        'prob_stress': prob_stress,
        'confidence':  max(prob_normal, prob_stress),
        'trending_toward_stress': False
    }


def build_feature_dict(features_array):
    return {
        feature_cols[i]: float(features_array[0, i])
        for i in range(len(feature_cols))
    }


# ── Feature-aware trend voting ────────────────────────────────
class StressStateMachine:
    """
    Watches recent windows for a rising-toward-stress feature
    pattern, used only to compute trending_toward_stress — a flag
    reported alongside the model's Normal/Stress label, never a
    label override.

    Three feature groups vote on direction of change:

    MONOTONIC_UP (6 features — tonic EDA):
      Rising = stress-onset signal

    PHASIC_PEAK (12 features — alarm response):
      Rising = onset (alarm phase)

    TROUGH (4 features — HRV inverse):
      Falling = onset (HR going up)
    """

    def __init__(self, feature_cols_list,
                 baseline_mean=None,
                 window_size=5,
                 trend_threshold=0.35,
                 baseline_std=None):

        self.feature_cols    = feature_cols_list
        self.baseline_mean   = baseline_mean
        self.baseline_std    = baseline_std
        self.window_size     = window_size
        self.trend_threshold = trend_threshold

        self.history          = []

    def update_baseline(self, baseline_mean, baseline_std=None):
        self.baseline_mean = baseline_mean
        if baseline_std is not None:
            self.baseline_std = baseline_std

    def _min_change(self, feature, vals):
        """Smallest net change over the window that counts as a real move."""
        if self.baseline_mean is not None and feature in self.feature_cols:
            i = self.feature_cols.index(feature)
            scale = TREND_MIN_RISE_REL * abs(float(self.baseline_mean[i]))
            if self.baseline_std is not None:
                scale = max(scale, TREND_MIN_RISE_SD * float(self.baseline_std[i]))
            return scale
        return TREND_MIN_RISE_REL * abs(sum(vals) / len(vals))

    # ── Direction helpers ─────────────────────────────────────

    def _rising(self, feature, min_count=3):
        """3 of last 4 windows show positive change."""
        if len(self.history) < 2:
            return False
        vals  = [w.get(feature, 0)
                 for w in self.history[-self.window_size:]]
        diffs = [vals[i]-vals[i-1]
                 for i in range(1, len(vals))]
        return (sum(1 for d in diffs if d > 0) >= min_count
                and vals[-1] - vals[0] > self._min_change(feature, vals))

    def _falling(self, feature, min_count=3):
        """3 of last 4 windows show negative change."""
        if len(self.history) < 2:
            return False
        vals  = [w.get(feature, 0)
                 for w in self.history[-self.window_size:]]
        diffs = [vals[i]-vals[i-1]
                 for i in range(1, len(vals))]
        return (sum(1 for d in diffs if d < 0) >= min_count
                and vals[0] - vals[-1] > self._min_change(feature, vals))

    def _above_baseline(self, feat_dict, feature,
                        threshold=0.10):
        """Feature is threshold% above personal baseline."""
        if self.baseline_mean is None:
            return False
        if feature not in self.feature_cols:
            return False
        idx   = self.feature_cols.index(feature)
        base  = self.baseline_mean[idx]
        value = feat_dict.get(feature, base)
        if base == 0:
            return False
        return (value - base) / abs(base) > threshold

    def _below_baseline(self, feat_dict, feature,
                        threshold=0.10):
        """Feature is threshold% below personal baseline."""
        if self.baseline_mean is None:
            return False
        if feature not in self.feature_cols:
            return False
        idx   = self.feature_cols.index(feature)
        base  = self.baseline_mean[idx]
        value = feat_dict.get(feature, base)
        if base == 0:
            return False
        return (base - value) / abs(base) > threshold

    # ── Voting ─────────────────────────────────────────────────

    def _trend_votes(self, feat_dict):
        """
        Count features voting for a rising-toward-stress trend.
        Uses all three groups with their patterns.
        """
        votes_for     = 0
        votes_against = 0
        total         = 0

        # Group A: Monotonic — rising = onset
        for feat in MONOTONIC_UP:
            if feat not in self.feature_cols:
                continue
            total += 1
            if self._rising(feat):
                votes_for += 1
            elif (self._above_baseline(feat_dict, feat, 0.20)
                  and not self._rising(feat)):
                votes_against += 1

        # Group B: Phasic — rising = alarm
        for feat in PHASIC_PEAK:
            if feat not in self.feature_cols:
                continue
            total += 1
            if self._rising(feat):
                votes_for += 1
            elif (self._above_baseline(feat_dict, feat, 0.15)
                  and self._falling(feat)):
                votes_against += 1

        # Group C: Trough — falling = HR going up = onset
        for feat in TROUGH:
            if feat not in self.feature_cols:
                continue
            total += 1
            if self._falling(feat):
                votes_for += 1
            elif (self._below_baseline(feat_dict, feat, 0.15)
                  and self._rising(feat)):
                votes_against += 1

        return votes_for, votes_against, total
