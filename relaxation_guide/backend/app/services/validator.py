"""
Validator Service (Feature 3).
Computes reward signals based on pre- and post-intervention stress label transitions,
short-time stress reduction speed, and user 5-star feedback ratings.
Updates the Contextual Thompson Sampling bandit.
"""

from typing import Tuple, Optional
from app.config import REWARD_MATRIX
from app.services.thompson_bandit import thompson_bandit

class RewardValidator:
    def compute_reward_and_recovery(
        self,
        pre_label: str,
        post_label: str,
        star_rating: int = 5,
        duration_seconds: float = 30.0
    ) -> Tuple[float, float, str]:
        """
        Calculates multi-objective closed-loop reward combining:
        1. Pre->Post Stress Reduction Transition Matrix R_trans ∈ [-0.5, +1.0]
        2. Short-Time Stress Reduction Speed Metric S_speed ∈ [0.3, 1.0]
        3. User 5-Star Feedback Metric S_stars ∈ [0.0, 1.0]
        
        Formula:
        R_combined = 0.50 * R_trans + 0.25 * S_speed + 0.25 * S_stars
        """
        pair = (pre_label.lower(), post_label.lower())
        r_trans = REWARD_MATRIX.get(pair, 0.3)
        
        # Calculate human-readable recovery percentage
        if pre_label == "stress" and post_label == "normal":
            recovery_pct = 100.0
            transition_desc = "Complete Recovery (Stress -> Normal)"
        elif pre_label == "stress" and post_label == "pre-stress":
            recovery_pct = 70.0
            transition_desc = "Partial Recovery (Stress -> Pre-Stress)"
        elif pre_label == "pre-stress" and post_label == "normal":
            recovery_pct = 85.0
            transition_desc = "Early Intervention Success (Pre-Stress -> Normal)"
        elif pre_label == post_label:
            recovery_pct = 30.0
            transition_desc = f"No Change ({pre_label.capitalize()} -> {post_label.capitalize()})"
        else:
            recovery_pct = 0.0
            transition_desc = f"Deterioration ({pre_label.capitalize()} -> {post_label.capitalize()})"

        # 2. Short-time recovery speed metric (30s baseline)
        if duration_seconds <= 30.0:
            s_speed = 1.0  # Rapid recovery bonus
        elif duration_seconds <= 60.0:
            s_speed = 0.8
        elif duration_seconds <= 120.0:
            s_speed = 0.5
        else:
            s_speed = 0.3

        # 3. User 5-star rating metric: (Stars - 1) / 4 -> [0.0 to 1.0]
        s_stars = max(0.0, min(1.0, (star_rating - 1.0) / 4.0))

        # Combined Closed-Loop Reward Signal R_combined
        r_combined = (0.50 * r_trans) + (0.25 * s_speed) + (0.25 * s_stars)

        return r_combined, recovery_pct, transition_desc

    def validate_and_update(
        self,
        user_id: str,
        cluster_id: int,
        technique_id: str,
        pre_label: str,
        post_label: str,
        star_rating: int = 5,
        duration_seconds: float = 30.0
    ) -> Tuple[float, float, str, float, float]:
        """
        Validates intervention outcome, computes combined reward, and updates the bandit's Beta distribution.
        Returns: (reward, recovery_pct, transition_desc, new_alpha, new_beta)
        """
        reward, recovery_pct, transition_desc = self.compute_reward_and_recovery(
            pre_label, post_label, star_rating, duration_seconds
        )
        
        # Update Thompson Bandit Beta distribution for this context cluster
        thompson_bandit.update_distribution(user_id, cluster_id, technique_id, reward)
        
        # Retrieve updated distribution
        cluster_dists = thompson_bandit._get_user_cluster_dists(user_id, cluster_id)
        if technique_id in cluster_dists:
            new_alpha = cluster_dists[technique_id]["alpha"]
            new_beta = cluster_dists[technique_id]["beta"]
        else:
            first_tech = next(iter(cluster_dists.values()))
            new_alpha = first_tech["alpha"]
            new_beta = first_tech["beta"]
        
        return reward, recovery_pct, transition_desc, new_alpha, new_beta

# Global instance
validator = RewardValidator()
