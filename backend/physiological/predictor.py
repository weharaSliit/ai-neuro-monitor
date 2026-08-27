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
    STRESS_DECISION_THRESHOLD
)

print("Loading model files...")
try:
    model        = joblib.load(MODEL_FILE)
    scaler       = joblib.load(SCALER_FILE)
    feature_cols = joblib.load(FEATURES_FILE)
    print(f"  Model: {type(model).__name__} ✓")
    print(f"  Features: {len(feature_cols)} ✓")
except FileNotFoundError as e:
    # Auth/user/EMA routes don't touch the ring model at all -- letting a
    # missing local model artifact take down the whole app (including
    # /login) couples two unrelated concerns. predict_window/predict_raw
    # below raise a clear error instead if actually called with no model.
    model = scaler = None
    feature_cols = []
    print(f"  WARNING: model artifacts not found ({e}) -- /predict, /calibrate, "
          f"and EMA/baseline routes will not work until MODEL_FILE/SCALER_FILE/"
          f"FEATURES_FILE (backend/common/config.py) point to real files. "
          f"Auth and other non-model routes are unaffected.")

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
    if model is None or scaler is None:
        raise RuntimeError(
            "physiological model artifacts not available on this machine -- "
            "see the WARNING printed at startup (predictor.py)"
        )
    X_scaled = scaler.transform(features_array)
    probs = model.predict_proba(X_scaled)[0]
    prob_normal, prob_stress = float(probs[0]), float(probs[1])
    prediction = 1 if prob_stress > STRESS_DECISION_THRESHOLD else 0
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
                 trend_threshold=0.35):

        self.feature_cols    = feature_cols_list
        self.baseline_mean   = baseline_mean
        self.window_size     = window_size
        self.trend_threshold = trend_threshold

        self.history          = []

    def update_baseline(self, baseline_mean):
        self.baseline_mean = baseline_mean

    # ── Direction helpers ─────────────────────────────────────

    def _rising(self, feature, min_count=3):
        """3 of last 4 windows show positive change."""
        if len(self.history) < 2:
            return False
        vals  = [w.get(feature, 0)
                 for w in self.history[-self.window_size:]]
        diffs = [vals[i]-vals[i-1]
                 for i in range(1, len(vals))]
        return sum(1 for d in diffs if d > 0) >= min_count

    def _falling(self, feature, min_count=3):
        """3 of last 4 windows show negative change."""
        if len(self.history) < 2:
            return False
        vals  = [w.get(feature, 0)
                 for w in self.history[-self.window_size:]]
        diffs = [vals[i]-vals[i-1]
                 for i in range(1, len(vals))]
        return sum(1 for d in diffs if d < 0) >= min_count

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
