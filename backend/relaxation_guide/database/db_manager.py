"""
Database Manager Module for Relaxation Guide.
Provides pure Firebase Realtime Database persistence for user-wise personalization,
Contextual Thompson Sampling bandit distributions, ratings, and interventions.
SQLite connections have been completely removed.
"""

import os
import sys
import json
import time
from typing import Dict, Any, List, Optional
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.services import firebase_service


class DatabaseManager:
    def __init__(self):
        self.is_firebase = True
        self._local_users: Dict[str, Dict[str, Any]] = {}
        self._local_gamification: Dict[str, Dict[str, Any]] = {}
        self._local_ratings: Dict[str, List[Dict[str, Any]]] = {}
        self._local_interventions: Dict[str, List[Dict[str, Any]]] = {}

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        fb_user = firebase_service.get_user(user_id)
        if fb_user:
            return fb_user
        return self._local_users.get(user_id)

    def create_user(self, user_id: str, email: str = "", password: str = "", full_name: str = "Participant") -> Dict[str, Any]:
        user_data = {
            "user_id": user_id,
            "email": email or f"{user_id}@caps-research.org",
            "password": password,
            "full_name": full_name,
            "created_at": time.time()
        }
        self._local_users[user_id] = user_data
        return user_data

    def save_bandit_distribution(self, user_id: str, cluster_id: int, technique_id: str, alpha: float, beta: float):
        firebase_service.save_bandit_distribution(user_id, cluster_id, technique_id, alpha, beta)

    def load_bandit_distributions(self, user_id: str) -> Dict[int, Dict[str, Dict[str, float]]]:
        return firebase_service.get_bandit_distributions(user_id)

    def save_intervention(self, user_id: str, session_id: str, technique_id: str, pre_label: str, post_label: str, reward: float, recovery_pct: float, duration_sec: float = 30.0):
        rec = {
            "session_id": session_id,
            "technique_id": technique_id,
            "pre_stress_label": pre_label,
            "post_stress_label": post_label,
            "reward": float(reward),
            "recovery_percentage": float(recovery_pct),
            "duration_seconds": float(duration_sec),
            "timestamp": time.time()
        }
        firebase_service.save_relaxation_intervention(user_id, session_id, rec)
        if user_id not in self._local_interventions:
            self._local_interventions[user_id] = []
        self._local_interventions[user_id].append(rec)

    def save_rating(self, user_id: str, technique_id: str, sub_option_id: str, stars: int, timestamp: float):
        firebase_service.save_rating(user_id, technique_id, sub_option_id, stars, timestamp)
        rec = {"technique_id": technique_id, "sub_option_id": sub_option_id, "stars": stars, "timestamp": timestamp}
        if user_id not in self._local_ratings:
            self._local_ratings[user_id] = []
        self._local_ratings[user_id].append(rec)

    def load_ratings(self, user_id: str) -> List[Dict[str, Any]]:
        fb_ratings = firebase_service.get_ratings(user_id)
        if fb_ratings:
            return fb_ratings
        return self._local_ratings.get(user_id, [])

    def save_user_gamification(self, user_id: str, xp: int, streak: int, unlocked_badges: List[str]):
        rec = {"user_id": user_id, "xp": xp, "streak": streak, "unlocked_badges": unlocked_badges}
        self._local_gamification[user_id] = rec

    def load_user_gamification(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self._local_gamification.get(user_id)

    def get_past_interventions(self, user_id: str) -> List[Dict[str, Any]]:
        fb_interventions = firebase_service.get_relaxation_interventions(user_id)
        if fb_interventions:
            return fb_interventions
        return self._local_interventions.get(user_id, [])


db_manager = DatabaseManager()
