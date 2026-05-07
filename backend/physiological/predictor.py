# ============================================================
# predictor.py
# Loads model and handles all prediction logic
# Personalized baseline + trend detector included
# ============================================================

import numpy as np
import joblib
from backend.common.config import (
    MODEL_FILE, SCALER_FILE, FEATURES_FILE,
    N_BASELINE_WIN, EMA_ALPHA
)

# Load model files once at startup 
print("Loading model files...")
model        = joblib.load(MODEL_FILE)
scaler       = joblib.load(SCALER_FILE)
feature_cols = joblib.load(FEATURES_FILE)
print(f"  Model: {type(model).__name__} ✓")
print(f"  Features: {len(feature_cols)} ✓")

#  Feature type definitions 
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


# Personalized normalization 
def compute_baseline(X_windows, y_windows=None,
                     n_windows=N_BASELINE_WIN):
    """
    Compute personal baseline from first N Normal windows.
    If no labels provided uses first N windows directly.
    """
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

    # Minimum std = 10% of absolute mean
    min_std = np.abs(b_mean) * 0.10
    min_std = np.where(min_std < 0.01, 0.01, min_std)
    b_std   = np.where(b_std < min_std, min_std, b_std)

    return b_mean, b_std


def update_baseline_ema(old_mean, old_std,
                        new_mean, new_std,
                        alpha=EMA_ALPHA):
    """
    Update baseline using EMA after each session.
    new = alpha × session + (1-alpha) × old
    """
    updated_mean = alpha * new_mean + (1 - alpha) * old_mean
    updated_std  = alpha * new_std  + (1 - alpha) * old_std
    return updated_mean, updated_std


def normalize_features(X, baseline_mean, baseline_std):
    """
    Normalize features by personal baseline.
    EDA features: ratio (value / mean)
    HRV + ACC:    z-score (value - mean) / std
    """
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


#  Main prediction function
def predict_window(features_array,
                   baseline_mean, baseline_std,
                   trend_history=None):
    """
    Predict stress class for one window.

    Parameters:
        features_array : numpy array shape (1, 22)
        baseline_mean  : personal baseline mean (22,)
        baseline_std   : personal baseline std (22,)
        trend_history  : list of recent feature dicts
                         for trend detection

    Returns:
        prediction     : int 0/1/2
        probabilities  : array [p_normal, p_pre, p_stress]
        trend_alert    : bool (pre-stress trend detected)
    """

    # Normalize by personal baseline
    X_norm   = normalize_features(
        features_array, baseline_mean, baseline_std
    )

    # Scale with population scaler
    X_scaled = scaler.transform(X_norm)

    # Predict
    prediction    = int(model.predict(X_scaled)[0])
    probabilities = model.predict_proba(X_scaled)[0]

    # Check trend detector
    trend_alert = False
    if trend_history is not None:
        trend_alert = detect_prestress_trend(
            trend_history
        )
        # Override Normal to Pre-stress if trend detected
        if trend_alert and prediction == 0:
            prediction = 1

    return prediction, probabilities, trend_alert


def predict_raw(features_array):
    """
    Simple prediction without personalization.
    Used for population-level prediction.
    """
    X_scaled      = scaler.transform(features_array)
    prediction    = int(model.predict(X_scaled)[0])
    probabilities = model.predict_proba(X_scaled)[0]
    return prediction, probabilities


#  Trend detector 
def detect_prestress_trend(history, window_size=5,
                           threshold=3):
    """
    Detect sustained pre-stress trend in recent windows.
    Returns True if 3 of 4 indicators show rising trend.
    """
    if len(history) < window_size:
        return False

    recent = history[-window_size:]
    triggered = 0

    # Indicator 1: SCL_mean rising
    if 'SCL_mean' in recent[0]:
        vals  = [w['SCL_mean'] for w in recent]
        diffs = [vals[i] - vals[i-1]
                 for i in range(1, len(vals))]
        if sum(d > 0 for d in diffs) >= 3:
            triggered += 1

    # Indicator 2: AVNN falling
    if 'AVNN' in recent[0]:
        vals  = [w['AVNN'] for w in recent]
        diffs = [vals[i] - vals[i-1]
                 for i in range(1, len(vals))]
        if sum(d < 0 for d in diffs) >= 3:
            triggered += 1

    # Indicator 3: SCR_count rising
    if 'SCR_count' in recent[0]:
        vals  = [w['SCR_count'] for w in recent]
        diffs = [vals[i] - vals[i-1]
                 for i in range(1, len(vals))]
        if sum(d > 0 for d in diffs) >= 3:
            triggered += 1

    # Indicator 4: deriv1_std rising
    if 'deriv1_std' in recent[0]:
        vals  = [w['deriv1_std'] for w in recent]
        diffs = [vals[i] - vals[i-1]
                 for i in range(1, len(vals))]
        if sum(d > 0 for d in diffs) >= 3:
            triggered += 1

    return triggered >= threshold


def build_feature_dict(features_array):
    """Convert features array to named dict for trend history."""
    return {
        feature_cols[i]: float(features_array[0, i])
        for i in range(len(feature_cols))
    }