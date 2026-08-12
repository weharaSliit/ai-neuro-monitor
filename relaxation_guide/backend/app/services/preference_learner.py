"""
Preference Learner Service (Feature 4).
Stores 1-5 star user ratings per technique and sub-option.
Applies exponential decay (0.95 factor, 7-day half life) and normalizes scores to 0-1 range.
"""

import time
import math
from typing import Dict, List, Any, Optional
from app.config import DECAY_FACTOR, DECAY_HALF_LIFE_DAYS
from app.database.db_manager import db_manager

class PreferenceLearner:
    def __init__(self):
        # User ID -> Technique ID -> List of rating entries: {'stars': int, 'sub_option': str, 'timestamp': float}
        self._user_ratings: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        # User ID -> Technique ID -> Preferred sub_option_id
        self._preferred_sub_options: Dict[str, Dict[str, str]] = {}

    def _ensure_user_loaded(self, user_id: str):
        """Loads user ratings from SQLite if not currently in memory."""
        if user_id not in self._user_ratings:
            self._user_ratings[user_id] = {}
            self._preferred_sub_options[user_id] = {}

            saved_ratings = db_manager.load_user_ratings(user_id)
            for r in saved_ratings:
                tech_id = r["technique_id"]
                if tech_id not in self._user_ratings[user_id]:
                    self._user_ratings[user_id][tech_id] = []
                self._user_ratings[user_id][tech_id].append(r)
                self._preferred_sub_options[user_id][tech_id] = r["sub_option_id"]

    def record_rating(
        self,
        user_id: str,
        technique_id: str,
        sub_option_id: str,
        rating_stars: int
    ) -> float:
        """
        Records a 1-5 star rating for a technique & sub-option.
        Calculates and returns normalized decayed preference score.
        """
        self._ensure_user_loaded(user_id)
        if technique_id not in self._user_ratings[user_id]:
            self._user_ratings[user_id][technique_id] = []

        now = time.time()
        self._user_ratings[user_id][technique_id].append({
            "stars": max(1, min(5, rating_stars)),
            "sub_option_id": sub_option_id,
            "timestamp": now
        })

        # Store sub-option choice as preferred default for future game selection
        self._preferred_sub_options[user_id][technique_id] = sub_option_id

        return self.get_preference_score(user_id, technique_id)

    def get_preference_score(self, user_id: str, technique_id: str) -> float:
        """
        Computes exponentially decayed normalized preference score S_pref in [0.0, 1.0].
        """
        self._ensure_user_loaded(user_id)
        if user_id not in self._user_ratings or technique_id not in self._user_ratings[user_id]:
            return 0.5 # Neutral prior if no ratings recorded yet

        ratings = self._user_ratings[user_id][technique_id]
        if not ratings:
            return 0.5

        now = time.time()
        total_weighted_score = 0.0
        total_weights = 0.0

        for entry in ratings:
            r_norm = (entry["stars"] - 1.0) / 4.0  # 1-5 -> 0.0-1.0
            elapsed_days = (now - entry["timestamp"]) / (24 * 3600)
            weight = math.pow(DECAY_FACTOR, elapsed_days)
            
            total_weighted_score += (r_norm * weight)
            total_weights += weight

        if total_weights <= 0:
            return 0.5

        return max(0.0, min(1.0, total_weighted_score / total_weights))

    def get_preferred_sub_option(self, user_id: str, technique_id: str) -> Optional[str]:
        """Returns the user's previously preferred sub-option ID for a technique, if any."""
        self._ensure_user_loaded(user_id)
        return self._preferred_sub_options.get(user_id, {}).get(technique_id)

    def get_user_preference_summary(self, user_id: str) -> Dict[str, Any]:
        """Returns complete user preference summary for API diagnostics."""
        self._ensure_user_loaded(user_id)
        summary = {}
        if user_id in self._user_ratings:
            for tech_id in self._user_ratings[user_id]:
                summary[tech_id] = {
                    "preference_score": self.get_preference_score(user_id, tech_id),
                    "preferred_sub_option": self.get_preferred_sub_option(user_id, tech_id),
                    "ratings_count": len(self._user_ratings[user_id][tech_id])
                }
        return summary

# Global instance
preference_learner = PreferenceLearner()
