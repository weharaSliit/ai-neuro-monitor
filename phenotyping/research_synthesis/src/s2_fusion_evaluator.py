#Purpose: This implements your Core Novelty. 
# It simulates what happens when the "Micro" (Keys) and "Macro" (Activity) are combined via the Physical Noise Gate.

import pandas as pd
import numpy as np

def simulate_late_fusion(key_score, activity_var, stationary_perc):
    """
    Implements the 'Context Gate' Logic:
    If user is moving (Physical Noise), ignore the keyboard drift.
    """
    # 1. Z-Score Escalation Band (1.0 - 1.5)
    is_key_drifting = (key_score >= 1.0) & (key_score <= 1.5)
    
    # 2. Context Gate (Stationary check)
    is_clean_context = (stationary_perc > 0.8) & (activity_var < 0.2)
    
    # 3. Final Decision
    if is_key_drifting and is_clean_context:
        return "PRE-STRESS_ALERT"
    elif is_key_drifting and not is_clean_context:
        return "PHYSICAL_NOISE_REJECTED"
    else:
        return "NORMAL"

print("🧪 [S2] Fusion Logic Initialized.")
# Example usage in research:
# df['fusion_label'] = df.apply(lambda x: simulate_late_fusion(x.key_z, x.act_var, x.stat_p), axis=1)