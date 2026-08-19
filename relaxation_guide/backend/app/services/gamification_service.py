"""
Gamification Service.
Manages XP points, badges unlocking logic, streak calculation, and user rewards per user account.
Persists all user stats to SQLite via db_manager.
"""

from typing import Dict, List, Tuple, Any
from app.config import BADGES_CATALOG, NORMAL_ACHIEVED_XP
from app.models.schemas import BadgeItem
from app.database.db_manager import db_manager

class GamificationService:
    def __init__(self):
        # User ID -> {'xp': int, 'streak': int, 'consecutive_normal': int, 'unlocked_badge_ids': List[str], 'categories_used': Set[str]}
        self._user_stats: Dict[str, Dict[str, Any]] = {}

    def _get_or_init_user(self, user_id: str) -> Dict[str, Any]:
        """Loads user gamification stats from SQLite or initializes defaults for a new user."""
        if user_id not in self._user_stats:
            sqlite_stats = db_manager.load_user_gamification(user_id)
            if sqlite_stats:
                self._user_stats[user_id] = {
                    "xp": sqlite_stats["xp"],
                    "streak": sqlite_stats["streak"],
                    "consecutive_normal": 0,
                    "unlocked_badge_ids": sqlite_stats.get("unlocked_badges", sqlite_stats.get("unlocked_badge_ids", ["streak_legend"])),
                    "categories_used": set()
                }
            else:
                self._user_stats[user_id] = {
                    "xp": 0,
                    "streak": 1,
                    "consecutive_normal": 0,
                    "unlocked_badge_ids": ["streak_legend"], # Default starter badge
                    "categories_used": set()
                }
                # Save initial default stats for user in SQLite
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
        """
        Calculates XP points earned, evaluates badge unlock criteria, and updates streak.
        Returns: (xp_earned, total_xp, is_normal_reached, unlocked_badge_items)
        """
        stats = self._get_or_init_user(user_id)
        xp_earned = 0
        is_normal_reached = (post_label.lower() == "normal")

        if is_normal_reached:
            xp_earned += NORMAL_ACHIEVED_XP
            stats["consecutive_normal"] += 1
            stats["streak"] += 1
        else:
            stats["consecutive_normal"] = 0

        # Additional XP based on positive reward
        if reward > 0:
            xp_earned += int(reward * 50)

        stats["xp"] += xp_earned
        stats["categories_used"].add(technique_id)

        # --- Badge Evaluation Criteria ---
        # 1. 100% Recovery Champion (Stress -> Normal)
        if pre_label == "stress" and post_label == "normal":
            if "recovery_champ" not in stats["unlocked_badge_ids"]:
                stats["unlocked_badge_ids"].append("recovery_champ")

        # 2. Vagus Shield (3 consecutive recoveries to normal)
        if stats["consecutive_normal"] >= 3:
            if "vagus_shield" not in stats["unlocked_badge_ids"]:
                stats["unlocked_badge_ids"].append("vagus_shield")

        # 3. Zen Master (Tried all 5 technique categories)
        if len(stats["categories_used"]) >= 5:
            if "zen_master" not in stats["unlocked_badge_ids"]:
                stats["unlocked_badge_ids"].append("zen_master")

        # Save updated user stats to SQLite
        db_manager.save_user_gamification(
            user_id,
            stats["xp"],
            stats["streak"],
            stats["unlocked_badge_ids"]
        )

        # Build full BadgeItem list for user profile / response
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
        """Returns (total_xp, streak_days, badge_items)."""
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

# Global instance
gamification_service = GamificationService()
