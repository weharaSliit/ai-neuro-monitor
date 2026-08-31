"""
Gamification Service for Relaxation Guide.
"""

import sys
from typing import Dict, List, Tuple, Any
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import BADGES_CATALOG, NORMAL_ACHIEVED_XP
from backend.relaxation_guide.models.schemas import BadgeItem
from backend.relaxation_guide.database.db_manager import db_manager


class GamificationService:
    def __init__(self):
        self._user_stats: Dict[str, Dict[str, Any]] = {}

    def _get_or_init_user(self, user_id: str) -> Dict[str, Any]:
        if user_id not in self._user_stats:
            saved_stats = db_manager.load_user_gamification(user_id)
            if saved_stats:
                self._user_stats[user_id] = {
                    "xp": saved_stats["xp"],
                    "streak": saved_stats["streak"],
                    "consecutive_normal": 0,
                    "unlocked_badge_ids": saved_stats.get("unlocked_badges", saved_stats.get("unlocked_badge_ids", ["streak_legend"])),
                    "categories_used": set()
                }
            else:
                self._user_stats[user_id] = {
                    "xp": 0,
                    "streak": 1,
                    "consecutive_normal": 0,
                    "unlocked_badge_ids": ["streak_legend"],
                    "categories_used": set()
                }
                db_manager.save_user_gamification(
                    user_id,
                    self._user_stats[user_id]["xp"],
                    self._user_stats[user_id]["streak"],
                    self._user_stats[user_id]["unlocked_badge_ids"]
                )

        return self._user_stats[user_id]

    def record_intervention_outcome(
        self,
        user_id: str,
        technique_id: str,
        pre_label: str,
        post_label: str,
        reward: float
    ) -> Tuple[int, int, bool, List[BadgeItem]]:
        stats = self._get_or_init_user(user_id)
        xp_earned = 0
        is_normal_reached = (post_label.lower() == "normal")

        if is_normal_reached:
            xp_earned += NORMAL_ACHIEVED_XP
            stats["consecutive_normal"] += 1
            stats["streak"] += 1
        else:
            stats["consecutive_normal"] = 0

        if reward > 0:
            xp_earned += int(reward * 50)

        stats["xp"] += xp_earned
        stats["categories_used"].add(technique_id)

        if pre_label == "stress" and post_label == "normal":
            if "recovery_champ" not in stats["unlocked_badge_ids"]:
                stats["unlocked_badge_ids"].append("recovery_champ")

        if stats["consecutive_normal"] >= 3:
            if "vagus_shield" not in stats["unlocked_badge_ids"]:
                stats["unlocked_badge_ids"].append("vagus_shield")

        if len(stats["categories_used"]) >= 5:
            if "zen_master" not in stats["unlocked_badge_ids"]:
                stats["unlocked_badge_ids"].append("zen_master")

        db_manager.save_user_gamification(
            user_id,
            stats["xp"],
            stats["streak"],
            stats["unlocked_badge_ids"]
        )

        badge_items = []
        for b in BADGES_CATALOG:
            is_unlocked = b["id"] in stats["unlocked_badge_ids"]
            badge_items.append(BadgeItem(
                id=b["id"],
                title=b["title"],
                icon=b["icon"],
                description=b["description"],
                unlocked=is_unlocked
            ))

        return xp_earned, stats["xp"], is_normal_reached, badge_items

    def get_user_badges_and_stats(self, user_id: str) -> Tuple[int, int, List[BadgeItem]]:
        stats = self._get_or_init_user(user_id)
        badge_items = []
        for b in BADGES_CATALOG:
            is_unlocked = b["id"] in stats["unlocked_badge_ids"]
            badge_items.append(BadgeItem(
                id=b["id"],
                title=b["title"],
                icon=b["icon"],
                description=b["description"],
                unlocked=is_unlocked
            ))
        return stats["xp"], stats["streak"], badge_items


gamification_service = GamificationService()
