"""
Fallback Handler Service for Relaxation Guide.
"""

import sys
import time
from typing import Dict, List, Any, Tuple
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import TECHNIQUES, REJECTION_REWARD, HABITUATING_USAGE_THRESHOLD
from backend.relaxation_guide.services.thompson_bandit import thompson_bandit


class FallbackHandler:
    def __init__(self):
        self._user_rejection_history: Dict[str, Dict[str, int]] = {}
        self._technique_usage_timestamps: Dict[str, Dict[str, List[float]]] = {}

    def record_technique_use(self, user_id: str, technique_id: str):
        if user_id not in self._technique_usage_timestamps:
            self._technique_usage_timestamps[user_id] = {}
        if technique_id not in self._technique_usage_timestamps[user_id]:
            self._technique_usage_timestamps[user_id][technique_id] = []

        self._technique_usage_timestamps[user_id][technique_id].append(time.time())

    def get_7day_usage_count(self, user_id: str, technique_id: str) -> int:
        if user_id not in self._technique_usage_timestamps:
            return 0
        if technique_id not in self._technique_usage_timestamps[user_id]:
            return 0

        now = time.time()
        seven_days_sec = 7 * 24 * 3600
        timestamps = self._technique_usage_timestamps[user_id][technique_id]

        recent = [t for t in timestamps if (now - t) <= seven_days_sec]
        return len(recent)

    def get_all_7day_usage_counts(self, user_id: str) -> Dict[str, int]:
        return {
            tech_id: self.get_7day_usage_count(user_id, tech_id)
            for tech_id in TECHNIQUES.keys()
        }

    def process_rejection(
        self,
        user_id: str,
        cluster_id: int,
        rejected_technique_id: str
    ) -> Tuple[int, List[str], Dict[str, Any], List[Dict[str, str]]]:
        if user_id not in self._user_rejection_history:
            self._user_rejection_history[user_id] = {}
        self._user_rejection_history[user_id][rejected_technique_id] = \
            self._user_rejection_history[user_id].get(rejected_technique_id, 0) + 1

        rejection_count = self._user_rejection_history[user_id][rejected_technique_id]

        thompson_bandit.update_distribution(user_id, cluster_id, rejected_technique_id, REJECTION_REWARD)

        usage_7d = self.get_all_7day_usage_counts(user_id)
        _, _, _, _, _, all_scores = thompson_bandit.select_technique(user_id, cluster_id, usage_7d)

        sorted_alternatives = sorted(
            [tech for tech in all_scores.keys() if tech != rejected_technique_id],
            key=lambda t: all_scores[t],
            reverse=True
        )

        level1_alternatives = sorted_alternatives[:2]

        level2_breathing_reset = {
            "title": "30-Second Guided Breathing Reset",
            "duration_seconds": 30,
            "instructions": "Inhale deeply for 4 seconds... Hold for 4 seconds... Exhale slowly for 6 seconds.",
            "animation_type": "pulse_circle"
        }

        level3_prompt_options = [
            {"id": "quiet_moment", "label": "A Quiet Moment", "action": "pause_notifications_5m"},
            {"id": "continue_work", "label": "Continue Work", "action": "dismiss_intervention"},
            {"id": "suggest_later", "label": "Suggest Again Later", "action": "snooze_15m"}
        ]

        level = 1 if rejection_count == 1 else (2 if rejection_count == 2 else 3)

        return level, level1_alternatives, level2_breathing_reset, level3_prompt_options


fallback_handler = FallbackHandler()
