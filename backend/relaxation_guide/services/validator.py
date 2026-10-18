"""
Validator Service for Relaxation Guide.
"""

import sys
from typing import Tuple, Optional
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import REWARD_MATRIX
from backend.relaxation_guide.services.thompson_bandit import thompson_bandit


class RewardValidator:
    def compute_reward_and_recovery(
        self,
        pre_label: str,
        post_label: str,
        star_rating: int = 5,
        duration_seconds: float = 30.0
    ) -> Tuple[float, float, str]:
        pair = (pre_label.lower(), post_label.lower())
        r_trans = REWARD_MATRIX.get(pair, 0.3)

        if star_rating <= 1:
            recovery_pct = 0.0
            transition_desc = "No Relief Reported (User rated 1 star - No Help)"
        elif star_rating == 2:
            recovery_pct = 40.0
            transition_desc = "Partial Relief (User rated 2 stars - Slight Relief)"
        elif pre_label == "stress" and post_label == "normal":
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

        if duration_seconds <= 30.0:
            s_speed = 1.0
        elif duration_seconds <= 60.0:
            s_speed = 0.8
        elif duration_seconds <= 120.0:
            s_speed = 0.5
        else:
            s_speed = 0.3

        s_stars = max(0.0, min(1.0, (star_rating - 1.0) / 4.0))

        if star_rating <= 1:
            r_combined = 0.10
        else:
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
        reward, recovery_pct, transition_desc = self.compute_reward_and_recovery(
            pre_label, post_label, star_rating, duration_seconds
        )

        thompson_bandit.update_distribution(user_id, cluster_id, technique_id, reward)

        cluster_dists = thompson_bandit._get_user_cluster_dists(user_id, cluster_id)
        if technique_id in cluster_dists:
            new_alpha = cluster_dists[technique_id]["alpha"]
            new_beta = cluster_dists[technique_id]["beta"]
        else:
            first_tech = next(iter(cluster_dists.values()))
            new_alpha = first_tech["alpha"]
            new_beta = first_tech["beta"]

        return reward, recovery_pct, transition_desc, new_alpha, new_beta


validator = RewardValidator()
