# ============================================================
# ema_service.py
# EMA continual learning
# compute_session_mean now uses ONLY Normal windows
# This prevents acute stress responses from contaminating
# the resting baseline estimate
# ============================================================

import numpy as np
from datetime import datetime
from backend.common.config import EMA_ALPHA


def compute_ema_update(old_mean, new_session_mean,
                       alpha=EMA_ALPHA):
    """
    Update baseline using Exponential Moving Average.
    new = alpha × session + (1-alpha) × old

    alpha = 0.2 means:
      20% from new session
      80% from historical baseline
    Adapts gradually — one session cannot cause sudden jump.
    """
    return alpha * new_session_mean + (1 - alpha) * old_mean


def compute_session_mean(windows_features,
                         predictions=None):
    """
    Compute mean of each feature using ONLY Normal windows.

    Why only Normal windows:
        Stress and pre-stress windows reflect acute responses.
        They do not represent the person's true resting state.
        Using all windows biases baseline toward stress state.

        Example:
            Session: 39 Normal + 18 Stress windows
            All windows AVNN mean:    798ms  (pulled down by stress)
            Normal only AVNN mean:    820ms  (true resting state)

        The person's resting physiology did not change
        just because they had a stressful meeting.
        Only update baseline from calm (Normal) windows.

        One stressful session → baseline stays stable ✓
        Sustained change over weeks → baseline adapts ✓

    Parameters:
        windows_features : numpy array (n_windows, n_features)
        predictions      : list of int predictions per window
                           0=Normal, 1=Pre-stress, 2=Stress
                           If None — use all windows

    Returns:
        numpy array of feature means
        OR None if not enough Normal windows
    """
    if windows_features is None or len(windows_features) == 0:
        return None

    # If predictions provided — filter to Normal windows only
    if predictions is not None and len(predictions) > 0:
        normal_indices = [
            i for i, p in enumerate(predictions)
            if p == 0
        ]

        if len(normal_indices) >= 3:
            normal_windows = windows_features[normal_indices]
            print(f"  EMA: using {len(normal_indices)} Normal "
                  f"windows of {len(windows_features)} total")
            return np.mean(normal_windows, axis=0)
        else:
            print(f"  EMA: only {len(normal_indices)} Normal "
                  f"windows found — minimum 3 required")
            print(f"  EMA: baseline NOT updated this session")
            return None

    # No predictions — fall back to all windows
    print(f"  EMA: no predictions provided — "
          f"using all {len(windows_features)} windows")
    return np.mean(windows_features, axis=0)


def build_ema_summary(old_mean, new_mean,
                      feature_cols, alpha=EMA_ALPHA):
    """
    Build human-readable EMA update summary.
    Returns dict with per-feature changes for display.
    """
    summary = {
        'alpha':     alpha,
        'timestamp': datetime.now().isoformat(),
        'features':  {}
    }

    key_features = [
        'AVNN', 'MeanHR', 'SCL_mean', 'SCR_count', 'SD1'
    ]

    for i, feat in enumerate(feature_cols):
        old_val = float(old_mean[i])
        new_val = float(new_mean[i])
        delta   = new_val - old_val

        # Reverse-calculate session value from EMA formula:
        # new = alpha × session + (1-alpha) × old
        # session = (new - (1-alpha) × old) / alpha
        if alpha and alpha > 0:
            session_est = (
                new_val - (1 - alpha) * old_val
            ) / alpha
        else:
            session_est = new_val

        entry = {
            'old':   round(old_val, 3),
            'new':   round(new_val, 3),
            'delta': round(delta, 3),
            'formula': (
                f"{alpha} × "
                f"{round(float(session_est), 2)} + "
                f"{1-alpha} × "
                f"{round(old_val, 2)} = "
                f"{round(new_val, 2)}"
            )
        }

        summary['features'][feat] = entry

        if feat in key_features:
            summary['features'][feat]['highlight'] = True

    return summary


def interpret_ema_change(old_mean, new_mean, feature_cols):
    """
    Interpret what the EMA change means physiologically.
    Returns list of human-readable messages.
    """
    avnn_idx = (
        feature_cols.index('AVNN')
        if 'AVNN' in feature_cols else None
    )
    scl_idx = (
        feature_cols.index('SCL_mean')
        if 'SCL_mean' in feature_cols else None
    )
    hr_idx = (
        feature_cols.index('MeanHR')
        if 'MeanHR' in feature_cols else None
    )

    messages = []

    if avnn_idx is not None:
        avnn_change = new_mean[avnn_idx] - old_mean[avnn_idx]
        if avnn_change < -5:
            messages.append(
                "Heart rate increased — higher resting "
                "stress load detected this session"
            )
        elif avnn_change > 5:
            messages.append(
                "Heart rate decreased — resting state "
                "more relaxed than previous baseline"
            )

    if scl_idx is not None:
        scl_change = new_mean[scl_idx] - old_mean[scl_idx]
        if scl_change > 0.1:
            messages.append(
                "GSR baseline rose — sympathetic "
                "activation higher during rest"
            )
        elif scl_change < -0.1:
            messages.append(
                "GSR baseline dropped — calmer "
                "resting state than previous baseline"
            )

    if not messages:
        messages.append(
            "Baseline stable — resting physiology "
            "consistent with previous sessions"
        )

    messages.append(
        "Only Normal-class windows used for this update. "
        "Stress responses did not affect the baseline."
    )

    return messages