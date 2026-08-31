import numpy as np
from backend.phenotyping_behavior.firebase_service import get_user_baselines, update_user_baselines

# Alpha = smoothing factor — aligned with research-validated value (Meegahapola 2023)
# 0.1 = slow, stable adaptation (validated in s2_ema_adaptive_engine.py research module)
# High alpha = adapts quickly; Low alpha = more stable baseline (0.1 is research-proven)
EMA_ALPHA = 0.1

# A window with no typing/scrolling that period reports 0.0 for these
# features (see app.py's `np.mean(raw_dwells) if len > 0 else 0.0`) -- that
# 0 means "not measured this window", not "measured as zero". Letting it
# through the EMA update would nudge the personal baseline toward 0 on every
# scroll-only/idle window, eventually collapsing mean and std to ~0 and
# making every future real keystroke read as a huge deviation.
ZERO_MEANS_NO_SIGNAL = {'avg_dwell', 'dwell_std', 'avg_flight', 'flight_std', 'scroll_velocity', 'cpm'}

def update_personalized_baseline(user_id, current_window_features, is_anomaly):
    """
    Methodology: Continual Learning via EMA.
    Rule: Only update baseline if the current window is 'Normal'.
    Ref: Meegahapola 2023 / Research Gap 3
    """
    
    # If the model detected an anomaly, we FREEZE the baseline.
    # We don't want the 'normal' profile to be corrupted by stress data.
    if is_anomaly:
        print(f"Window is anomalous. Baseline for {user_id} remains frozen.")
        return False

    # 1. Get existing baselines from Firebase
    baselines = get_user_baselines(user_id)
    if not baselines:
        print(f"No baseline found for user {user_id}. Skipping EMA update.")
        return False

    updated_baselines = {}

    # 2. Apply EMA formula to each feature
    # New_Mean = (Alpha * Current_Value) + ((1 - Alpha) * Old_Mean)
    for feature_name, stats in baselines.items():
        if feature_name not in current_window_features:
            continue
        current_val = current_window_features[feature_name]
        if current_val is None:
            continue
        if feature_name in ZERO_MEANS_NO_SIGNAL and float(current_val) <= 0:
            continue

        old_mean = stats['mean']

        new_mean = (EMA_ALPHA * current_val) + ((1 - EMA_ALPHA) * old_mean)

        # We also update the variance/std dev to account for rhythm changes
        # This ensures the 'tightness' of the One-Class SVM boundary stays accurate
        old_std = stats['std']
        current_dev = abs(current_val - old_mean)
        new_std = (EMA_ALPHA * current_dev) + ((1 - EMA_ALPHA) * old_std)

        updated_baselines[feature_name] = {
            'mean': round(float(new_mean), 6),
            'std': round(float(max(new_std, 0.001)), 6) # Prevent std from hitting zero
        }

    # 3. Save the evolved baseline back to Firebase
    if not updated_baselines:
        print(f"No features with real signal this window for {user_id}. Skipping EMA update.")
        return False
    update_user_baselines(user_id, updated_baselines)
    print(f"Baseline for {user_id} evolved successfully ✓")
    return True

def calculate_z_score(feature_val, mean, std):
    """
    Helper used by predictor to see how far the user is from their baseline.
    """
    return (feature_val - mean) / (std + 1e-6)