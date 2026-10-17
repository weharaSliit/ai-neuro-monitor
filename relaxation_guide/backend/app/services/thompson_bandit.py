"""
Contextual Thompson Sampling Bandit Service (Feature 2).
Maintains Beta(alpha, beta) distributions per user, context cluster, and technique.
Persists and loads all user-wise distributions from SQLite (db_manager).
Blends sampled values with user preference scores using 70/30 weight in under 200ms.
"""

import time
import numpy as np
from typing import Dict, Tuple, List, Optional
from app.config import TECHNIQUES, WEIGHT_PHYSIO, WEIGHT_PREF, HABITUATING_PENALTY_FACTOR, HABITUATING_USAGE_THRESHOLD
from app.services.preference_learner import preference_learner
from app.database.db_manager import db_manager
from app.services import firebase_service

class ThompsonBandit:
    def __init__(self):
        # User ID -> Cluster ID (0-9) -> Technique ID -> {'alpha': float, 'beta': float}
        self._user_distributions: Dict[str, Dict[int, Dict[str, Dict[str, float]]]] = {}

    def _get_user_cluster_dists(self, user_id: str, cluster_id: int) -> Dict[str, Dict[str, float]]:
        """Ensures Beta(alpha, beta) priors exist for all techniques in the given cluster, loading from Firebase/SQLite if saved."""
        if user_id not in self._user_distributions:
            self._user_distributions[user_id] = {}
            # Attempt to load user-wise distributions from Firebase first, then SQLite
            fb_dists = firebase_service.get_bandit_distributions(user_id)
            if fb_dists:
                self._user_distributions[user_id] = fb_dists
            else:
                sqlite_dists = db_manager.load_bandit_distributions(user_id)
                if sqlite_dists:
                    self._user_distributions[user_id] = sqlite_dists

        if cluster_id not in self._user_distributions[user_id]:
            # Initialize default prior Beta(1.0, 1.0) for all techniques in cluster
            self._user_distributions[user_id][cluster_id] = {
                tech_id: {"alpha": 1.0, "beta": 1.0}
                for tech_id in TECHNIQUES.keys()
            }

        return self._user_distributions[user_id][cluster_id]

    def select_technique(
        self,
        user_id: str,
        cluster_id: int,
        usage_history_7d: Optional[Dict[str, int]] = None,
        exclude_technique_ids: Optional[List[str]] = None
    ) -> Tuple[str, float, float, float, float, Dict[str, float]]:
        """
        Performs User-Wise Contextual Thompson Sampling selection:
        1. Samples S_physio ~ Beta(alpha, beta) for each technique in cluster_id.
        2. Retrieves user's normalized decayed preference score S_pref from PreferenceLearner.
        3. Computes Blended Value = 0.70 * S_physio + 0.30 * S_pref.
        4. Applies 10% habituation penalty if technique played > 5 times in 7 days.
        5. Selects technique with maximum blended value for THIS specific user.
        """
        start_time = time.time()
        cluster_dists = self._get_user_cluster_dists(user_id, cluster_id)
        usage_history = usage_history_7d or {}
        excluded = set(exclude_technique_ids or [])

        best_tech = None
        best_blended_score = -1.0
        best_physio_sample = 0.0
        best_pref_score = 0.0
        all_blended_scores = {}

        # Check user's historical fastest stress reduction speed from relaxation_intervention in Firebase
        history_boosts = firebase_service.get_fastest_recovery_technique_history(user_id)

        for tech_id, params in cluster_dists.items():
            if tech_id in excluded:
                continue
            alpha = params["alpha"] + history_boosts.get(tech_id, 0.0)
            beta = params["beta"]

            # Draw Thompson Sample from Beta distribution for user
            s_physio = float(np.random.beta(max(0.1, alpha), max(0.1, beta)))

            # Fetch user's decayed preference score
            s_pref = preference_learner.get_preference_score(user_id, tech_id)

            # 70/30 Blending Formula
            blended = (WEIGHT_PHYSIO * s_physio) + (WEIGHT_PREF * s_pref)

            # Habituation Penalty Check (> threshold uses in 7 days)
            uses_count = usage_history.get(tech_id, 0)
            if uses_count > HABITUATING_USAGE_THRESHOLD:
                blended *= HABITUATING_PENALTY_FACTOR # 10% penalty

            all_blended_scores[tech_id] = blended

            if blended > best_blended_score:
                best_blended_score = blended
                best_tech = tech_id
                best_physio_sample = s_physio
                best_pref_score = s_pref

        exec_time_ms = (time.time() - start_time) * 1000.0

        return best_tech, best_blended_score, best_physio_sample, best_pref_score, exec_time_ms, all_blended_scores

    def update_distribution(self, user_id: str, cluster_id: int, technique_id: str, reward: float):
        """
        Updates the Beta(alpha, beta) distribution for THIS user and persists to Firebase + SQLite:
        - Reward R in [0.0, 1.0]: alpha += R, beta += (1 - R)
        - Reward R < 0.0: beta += abs(R)
        """
        cluster_dists = self._get_user_cluster_dists(user_id, cluster_id)
        if technique_id in cluster_dists:
            if reward >= 0:
                cluster_dists[technique_id]["alpha"] += reward
                cluster_dists[technique_id]["beta"] += (1.0 - reward)
            else:
                cluster_dists[technique_id]["beta"] += abs(reward)

            alpha_val = cluster_dists[technique_id]["alpha"]
            beta_val = cluster_dists[technique_id]["beta"]

            # Persist user distribution update to SQLite
            db_manager.save_bandit_distribution(
                user_id,
                cluster_id,
                technique_id,
                alpha_val,
                beta_val
            )

            # Persist user distribution update to Firebase
            try:
                firebase_service.save_bandit_distribution(
                    user_id,
                    cluster_id,
                    technique_id,
                    alpha_val,
                    beta_val
                )
            except Exception as e:
                print(f"[Firebase Warning] Could not save bandit distribution to Firebase: {e}")

    def get_user_bandit_state(self, user_id: str) -> Dict[int, Dict[str, Dict[str, float]]]:
        """Returns current Beta distribution state across all 10 clusters for a user."""
        if user_id not in self._user_distributions:
            for c in range(10):
                self._get_user_cluster_dists(user_id, c)
        return self._user_distributions[user_id]

# Global instance
thompson_bandit = ThompsonBandit()
