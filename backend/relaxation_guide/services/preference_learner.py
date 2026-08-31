"""
Preference Learner Service for Relaxation Guide.
"""

import sys
import time
import math
from typing import Dict, List, Any, Optional
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import DECAY_FACTOR, DECAY_HALF_LIFE_DAYS
from backend.relaxation_guide.database.db_manager import db_manager
from backend.relaxation_guide.services import firebase_service


class PreferenceLearner:
    def __init__(self):
        self._user_ratings: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        self._preferred_sub_options: Dict[str, Dict[str, str]] = {}

    def _ensure_user_loaded(self, user_id: str):
        if user_id not in self._user_ratings:
            self._user_ratings[user_id] = {}
            self._preferred_sub_options[user_id] = {}

            fb_ratings = firebase_service.get_ratings(user_id)
            if fb_ratings:
                for r in fb_ratings:
                    tech_id = r.get("technique_id")
                    sub_id = r.get("sub_option_id", "")
                    stars = r.get("stars", 5)
                    ts = r.get("timestamp", time.time())
                    if tech_id:
                        if tech_id not in self._user_ratings[user_id]:
                            self._user_ratings[user_id][tech_id] = []
                        self._user_ratings[user_id][tech_id].append({
                            "stars": stars,
                            "sub_option_id": sub_id,
                            "timestamp": ts
                        })
                        self._preferred_sub_options[user_id][tech_id] = sub_id

            saved_ratings = db_manager.load_ratings(user_id)
            for r in saved_ratings:
                tech_id = r.get("technique_id")
                if tech_id and tech_id not in self._user_ratings[user_id]:
                    self._user_ratings[user_id][tech_id] = [r]
                    self._preferred_sub_options[user_id][tech_id] = r.get("sub_option_id", "")

    def record_rating(
        self,
        user_id: str,
        technique_id: str,
        sub_option_id: str,
        rating_stars: int
    ) -> float:
        self._ensure_user_loaded(user_id)
        if technique_id not in self._user_ratings[user_id]:
            self._user_ratings[user_id][technique_id] = []

        now = time.time()
        self._user_ratings[user_id][technique_id].append({
            "stars": max(1, min(5, rating_stars)),
            "sub_option_id": sub_option_id,
            "timestamp": now
        })

        self._preferred_sub_options[user_id][technique_id] = sub_option_id

        try:
            firebase_service.save_rating(user_id, technique_id, sub_option_id, rating_stars, now)
        except Exception as e:
            print(f"[Firebase Warning] Could not save rating to Firebase: {e}")

        return self.get_preference_score(user_id, technique_id)

    def get_preference_score(self, user_id: str, technique_id: str) -> float:
        self._ensure_user_loaded(user_id)
        if user_id not in self._user_ratings or technique_id not in self._user_ratings[user_id]:
            return 0.5

        ratings = self._user_ratings[user_id][technique_id]
        if not ratings:
            return 0.5

        now = time.time()
        total_weighted_score = 0.0
        total_weights = 0.0

        for entry in ratings:
            r_norm = (entry["stars"] - 1.0) / 4.0
            elapsed_days = (now - entry["timestamp"]) / (24 * 3600)
            weight = math.pow(DECAY_FACTOR, elapsed_days)

            total_weighted_score += (r_norm * weight)
            total_weights += weight

        if total_weights <= 0:
            return 0.5

        return max(0.0, min(1.0, total_weighted_score / total_weights))

    def get_preferred_sub_option(self, user_id: str, technique_id: str) -> Optional[str]:
        self._ensure_user_loaded(user_id)
        return self._preferred_sub_options.get(user_id, {}).get(technique_id)

    def get_user_preference_summary(self, user_id: str) -> Dict[str, Any]:
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


preference_learner = PreferenceLearner()
