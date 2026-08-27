# ============================================================
# ema_service.py
# Baseline-adaptation DISPLAY formatting only.
#
# Used to compute/store an EMA blend from ordinary daily-session "Normal"
# windows (compute_session_mean/compute_ema_update, manually triggered via
# a "Recompute EMA" button). Removed: verified against real production data
# that it had NEVER actually fired for any real user (zero ema_history
# entries for any account), and the design itself was the wrong idea even if
# it had -- a regular session's "Normal" windows are captured during
# whatever the user happened to be doing, not a controlled resting
# measurement, so blending them into a personal baseline risked drifting it
# on noisy proxy data.
#
# The real adaptation-over-time mechanism is recalibration:
# backend/physiological/calibration_capture.py::save_calibration_windows()
# already blends each new (deliberate, sit-still-and-relaxed) calibration
# into the existing baseline via predictor.py's update_baseline_ema() --
# same EMA formula, fed by real controlled data instead. That's what now
# calls build_ema_summary()/interpret_ema_change() below to log/describe
# each blend for the "Continual Learning" screen, replacing the old
# session-triggered path entirely.
# ============================================================

from datetime import datetime
from backend.common.config import EMA_ALPHA


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

        # Reverse-calculate the raw new-calibration value from the EMA
        # formula: new = alpha × new_calibration + (1-alpha) × old
        # new_calibration = (new - (1-alpha) × old) / alpha
        if alpha and alpha > 0:
            new_calib_est = (
                new_val - (1 - alpha) * old_val
            ) / alpha
        else:
            new_calib_est = new_val

        entry = {
            'old':   round(old_val, 3),
            'new':   round(new_val, 3),
            'delta': round(delta, 3),
            'formula': (
                f"{alpha} × "
                f"{round(float(new_calib_est), 2)} + "
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
        "From a real recalibration — a controlled, sit-still measurement, "
        "not everyday activity."
    )

    return messages