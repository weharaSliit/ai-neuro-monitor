# ============================================================
# predictor.py
# Loads model and handles all prediction logic
# Personalized baseline + feature-aware state machine
#
# Replaced simple trend detector with
# StressStateMachine that uses all 22 features
# grouped by their physiological pattern from
# exploratory analysis (
# ============================================================

import numpy as np
import joblib
from backend.common.config import (
    MODEL_FILE, SCALER_FILE, FEATURES_FILE,
    N_BASELINE_WIN, EMA_ALPHA
)

# ── Load model files once at startup ─────────────────────────
print("Loading model files...")
model        = joblib.load(MODEL_FILE)
scaler       = joblib.load(SCALER_FILE)
feature_cols = joblib.load(FEATURES_FILE)
print(f"  Model: {type(model).__name__} ✓")
print(f"  Features: {len(feature_cols)} ✓")

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
# Cell 5 findings: 18/22 features show pre-stress as distinct
# Pattern 1: monotonic N<PS<S (tonic EDA features)
MONOTONIC_UP = [
    'EDA_q75', 'EDA_mean', 'SCL_mean',
    'ACC_std', 'EDA_q10', 'EDA_q90'
]

# Pattern 2: peak at pre-stress then drop (phasic alarm)
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


# ── Main prediction function ──────────────────────────────────
def predict_window(features_array,
                   baseline_mean, baseline_std,
                   trend_history=None):
    X_norm        = normalize_features(
        features_array, baseline_mean, baseline_std
    )
    X_scaled      = scaler.transform(X_norm)
    prediction    = int(model.predict(X_scaled)[0])
    probabilities = model.predict_proba(X_scaled)[0]

    # Legacy trend detector kept for compatibility
    # State machine in app.py overrides this
    trend_alert = False
    if trend_history is not None:
        trend_alert = detect_prestress_trend(trend_history)
        if trend_alert and prediction == 0:
            prediction = 1

    return prediction, probabilities, trend_alert


def predict_raw(features_array):
    X_scaled      = scaler.transform(features_array)
    prediction    = int(model.predict(X_scaled)[0])
    probabilities = model.predict_proba(X_scaled)[0]
    return prediction, probabilities


def build_feature_dict(features_array):
    return {
        feature_cols[i]: float(features_array[0, i])
        for i in range(len(feature_cols))
    }


# ── Legacy trend detector (kept for reference) ────────────────
def detect_prestress_trend(history, window_size=5,
                           threshold=3):
    if len(history) < window_size:
        return False
    recent    = history[-window_size:]
    triggered = 0
    for feat, direction in [
        ('SCL_mean',   'up'),
        ('AVNN',       'down'),
        ('SCR_count',  'up'),
        ('deriv1_std', 'up')
    ]:
        if feat not in recent[0]:
            continue
        vals  = [w[feat] for w in recent]
        diffs = [vals[i]-vals[i-1]
                 for i in range(1, len(vals))]
        if direction == 'up':
            if sum(d > 0 for d in diffs) >= 3:
                triggered += 1
        else:
            if sum(d < 0 for d in diffs) >= 3:
                triggered += 1
    return triggered >= threshold


# ── Feature-aware stress state machine ───────────────────────
class StressStateMachine:
    """
    Context-aware stress classifier using all 22 features.

    Based on exploratory analysis findings (Cell 5):
      18/22 features (81.8%) distinguish pre-stress
      as a genuine intermediate physiological state.

    Three feature groups vote on each window:

    MONOTONIC_UP (6 features — tonic EDA):
      Rising = pre-stress onset signal
      Elevated but slowing = sustained stress

    PHASIC_PEAK (12 features — alarm response):
      Rising = pre-stress onset (alarm phase)
      Elevated + falling = stress (adaptation phase)
      Consistent with General Adaptation Syndrome

    TROUGH (4 features — HRV inverse):
      Falling = pre-stress (HR going up)
      Stable below baseline = sustained stress

    Correctly distinguishes:
      HR=95 rising from 65 → Pre-stress
      HR=95 falling from 101 → Stress
      Same value, different trajectory, different label
    """

    def __init__(self, feature_cols_list,
                 baseline_mean=None,
                 window_size=5,
                 ps_threshold=0.35,
                 st_threshold=0.25,
                 rec_threshold=0.40):

        self.feature_cols   = feature_cols_list
        self.baseline_mean  = baseline_mean
        self.window_size    = window_size
        self.ps_threshold   = ps_threshold
        self.st_threshold   = st_threshold
        self.rec_threshold  = rec_threshold

        self.state          = 'Normal'
        self.history        = []
        self.state_duration = 0

    def update_baseline(self, baseline_mean):
        self.baseline_mean = baseline_mean

    def reset(self):
        self.state          = 'Normal'
        self.history        = []
        self.state_duration = 0

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

    # ── Voting functions ──────────────────────────────────────

    def _prestress_votes(self, feat_dict):
        """
        Count features voting for pre-stress onset.
        Uses all three groups with their patterns.
        """
        votes_for     = 0
        votes_against = 0
        total         = 0

        # Group A: Monotonic — rising = pre-stress onset
        for feat in MONOTONIC_UP:
            if feat not in self.feature_cols:
                continue
            total += 1
            if self._rising(feat):
                votes_for += 1
            elif (self._above_baseline(feat_dict, feat, 0.20)
                  and not self._rising(feat)):
                votes_against += 1

        # Group B: Phasic — rising = alarm, falling = stress
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

    def _stress_votes(self, feat_dict):
        """
        Count features voting for sustained stress.
        Elevated but no longer in onset direction.
        """
        votes = 0
        total = 0

        # Group A: elevated but slowing
        for feat in MONOTONIC_UP:
            if feat not in self.feature_cols:
                continue
            total += 1
            if (self._above_baseline(feat_dict, feat, 0.15)
                    and not self._rising(feat)):
                votes += 1

        # Group B: elevated and falling from peak
        for feat in PHASIC_PEAK:
            if feat not in self.feature_cols:
                continue
            total += 1
            if (self._above_baseline(feat_dict, feat, 0.10)
                    and self._falling(feat)):
                votes += 1

        # Group C: below baseline and stabilizing
        for feat in TROUGH:
            if feat not in self.feature_cols:
                continue
            total += 1
            if (self._below_baseline(feat_dict, feat, 0.10)
                    and not self._falling(feat)):
                votes += 1

        return votes, total

    def _recovery_votes(self, feat_dict):
        """
        Count features voting for recovery to Normal.
        """
        votes = 0
        total = 0

        # Group A: falling back toward baseline
        for feat in MONOTONIC_UP:
            if feat not in self.feature_cols:
                continue
            total += 1
            if (self._falling(feat)
                    and not self._above_baseline(
                        feat_dict, feat, 0.05)):
                votes += 1

        # Group C: rising back toward baseline
        for feat in TROUGH:
            if feat not in self.feature_cols:
                continue
            total += 1
            if self._rising(feat):
                votes += 1

        return votes, total

    # ── Main process function ─────────────────────────────────

    def process_window(self, feat_dict,
                       model_prediction):
        """
        Process one window using all 22 features.

        Parameters:
            feat_dict        : {feature: value}
            model_prediction : XGBoost raw prediction

        Returns:
            prediction : corrected class (0/1/2)
            state      : current state string
            alert      : True if pre-stress detected
        """
        self.history.append(feat_dict)
        if len(self.history) > self.window_size + 3:
            self.history.pop(0)

        # Need enough history for direction detection
        if len(self.history) < self.window_size:
            self.state_duration += 1
            return model_prediction, self.state, False

        ps_for, ps_against, total = \
            self._prestress_votes(feat_dict)
        st_votes, st_total = \
            self._stress_votes(feat_dict)
        rec_votes, rec_total = \
            self._recovery_votes(feat_dict)

        ps_conf  = ps_for / total       if total     > 0 else 0
        st_conf  = st_votes / st_total  if st_total  > 0 else 0
        rec_conf = rec_votes / rec_total if rec_total > 0 else 0

        # ── State transitions ─────────────────────────────────

        if self.state == 'Normal':
            if ps_conf >= self.ps_threshold:
                self.state          = 'Prestress'
                self.state_duration = 1
                return 1, 'Prestress', True
            self.state_duration += 1
            return 0, 'Normal', False

        elif self.state == 'Prestress':
            self.state_duration += 1

            if ps_against > ps_for and \
               st_conf >= self.st_threshold:
                self.state          = 'Stress'
                self.state_duration = 1
                return 2, 'Stress', False

            elif ps_conf >= 0.25:
                return 1, 'Prestress', True

            elif st_conf >= self.st_threshold:
                self.state          = 'Stress'
                self.state_duration = 1
                return 2, 'Stress', False

            else:
                self.state          = 'Normal'
                self.state_duration = 1
                return 0, 'Normal', False

        elif self.state == 'Stress':
            self.state_duration += 1

            if rec_conf >= self.rec_threshold:
                self.state          = 'Normal'
                self.state_duration = 1
                return 0, 'Normal', False

            return 2, 'Stress', False

        return model_prediction, self.state, False