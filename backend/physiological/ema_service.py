# ============================================================
# ema_service.py
# EMA continual learning 
# ============================================================

import numpy as np
from datetime import datetime
from backend.common.config import EMA_ALPHA

def compute_ema_update(old_mean, new_session_mean, alpha=EMA_ALPHA):
    """
    Update baseline using Exponential Moving Average.
    new = alpha × session + (1-alpha) × old
    """
    updated = alpha * new_session_mean + (1 - alpha) * old_mean
    return updated

def compute_session_mean(windows_features):
    """
    Compute mean of each feature across all windows in a session.
    """
    if len(windows_features) == 0:
        return None
    return np.mean(windows_features, axis=0)

def build_ema_summary(old_mean, new_mean, feature_cols, alpha=EMA_ALPHA):
    """
    Build a human-readable EMA update summary.
    Returns dict with per-feature changes for display in app.
    """
    summary = {
        'alpha': alpha,
        'timestamp': datetime.now().isoformat(),
        'features': {}
    }

    key_features = ['AVNN', 'MeanHR', 'SCL_mean', 'SCR_count', 'SD1']

    for i, feat in enumerate(feature_cols):
        old_val = float(old_mean[i])
        new_val = float(new_mean[i])
        delta   = new_val - old_val

        # Approximate the session value used by EMA:
        # new = alpha * session + (1-alpha) * old  =>  session = (new - (1-alpha)*old)/alpha
        if alpha:
            session_est = (new_val - (1 - alpha) * old_val) / alpha
        else:
            session_est = new_val

        entry = {
            'old':   round(old_val, 3),
            'new':   round(new_val, 3),
            'delta': round(delta, 3),
            'formula': f"{alpha} × {round(float(session_est), 2)} + {1-alpha} × {round(old_val, 2)} = {round(new_val, 2)}"
        }

        summary['features'][feat] = entry

        if feat in key_features:
            summary['features'][feat]['highlight'] = True

    return summary

def interpret_ema_change(old_mean, new_mean, feature_cols):
    """
    Interpret what the EMA change means physiologically.
    Returns a human-readable interpretation string.
    """
    avnn_idx = feature_cols.index('AVNN') if 'AVNN' in feature_cols else None
    scl_idx  = feature_cols.index('SCL_mean') if 'SCL_mean' in feature_cols else None

    messages = []

    if avnn_idx is not None:
        avnn_change = new_mean[avnn_idx] - old_mean[avnn_idx]
        if avnn_change < -5:
            messages.append("Heart rate increased — higher stress load this session")
        elif avnn_change > 5:
            messages.append("Heart rate decreased — more relaxed than usual")

    if scl_idx is not None:
        scl_change = new_mean[scl_idx] - old_mean[scl_idx]
        if scl_change > 0.1:
            messages.append("GSR baseline rose — sympathetic activation higher")
        elif scl_change < -0.1:
            messages.append("GSR baseline dropped — calmer session than baseline")

    if not messages:
        messages.append("Baseline stable — consistent with previous sessions")

    return messages