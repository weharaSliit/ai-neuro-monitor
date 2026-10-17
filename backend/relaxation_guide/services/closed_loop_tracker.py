"""
Closed-Loop State Tracker Service for Relaxation Guide.
Implements Recursive Multi-Step Adaptation Cascade until baseline condition is achieved.
"""

from typing import Dict, Any, List, Optional
from backend.relaxation_guide.services.thompson_bandit import thompson_bandit
from backend.relaxation_guide.services.kmeans_clusterer import KMeansClusterer
from backend.relaxation_guide.config import TECHNIQUES
from backend.relaxation_guide.services import firebase_service

kmeans_clusterer = KMeansClusterer()

MAX_HISTORY = 50


class ClosedLoopTracker:
    def __init__(self):
        self._user_loops: Dict[str, Dict[str, Any]] = {}

    def _load_loop(self, user_id: str) -> None:
        """Restore a user's loop from Firebase so a server restart doesn't reset the cascade."""
        if user_id in self._user_loops:
            return
        saved = firebase_service.get_closed_loop_state(user_id)
        if saved:
            saved.setdefault("history", [])
            saved.setdefault("tried_techniques", [])
            self._user_loops[user_id] = saved

    def update_closed_loop(
        self,
        user_id: str,
        current_state: str,
        prob_stress: float = 0.50,
        user_baseline: float = 0.35,
        last_technique_id: Optional[str] = None
    ) -> Dict[str, Any]:
        # Strict check against individual user baseline fetched from Firebase
        is_baseline_reached = (prob_stress <= user_baseline) or (current_state.lower() == "normal" and prob_stress <= user_baseline)

        self._load_loop(user_id)

        # Initialize or reset closed loop cascade
        if user_id not in self._user_loops or is_baseline_reached:
            self._user_loops[user_id] = {
                "initial_state": current_state,
                "current_state": current_state,
                "cycles_completed": 0,
                "history": [current_state],
                "tried_techniques": []
            }

        loop = self._user_loops[user_id]
        loop["current_state"] = current_state
        loop["history"] = (loop["history"] + [current_state])[-MAX_HISTORY:]
        loop["cycles_completed"] += 1

        if last_technique_id and last_technique_id not in loop["tried_techniques"]:
            loop["tried_techniques"].append(last_technique_id)

        if is_baseline_reached:
            guidance_msg = f"🎯 Target Reached! Live stress probability ({prob_stress * 100:.1f}%) has returned to your personal baseline ({user_baseline * 100:.1f}%)."
            next_action = "complete_loop"
            next_tech_id = None
            next_tech_name = None
        else:
            cascade_step = loop["cycles_completed"] + 1
            cluster_id = kmeans_clusterer.predict_cluster([prob_stress, max(0.0, 1.0 - prob_stress)])

            next_tech_id, _, _, _, _, _ = thompson_bandit.select_technique(
                user_id=user_id,
                cluster_id=cluster_id,
                exclude_technique_ids=loop["tried_techniques"]
            )

            tech_obj = TECHNIQUES.get(next_tech_id, {})
            next_tech_name = tech_obj.get("title", tech_obj.get("name", next_tech_id))

            guidance_msg = (
                f"⚡ Closed-Loop Adaptive Cascade (Step {cascade_step}): Baseline not yet reached "
                f"({prob_stress * 100:.1f}% > target {user_baseline * 100:.1f}%). "
                f"System dynamically recommending secondary technique: '{next_tech_name}' to complete baseline recovery."
            )
            next_action = "continue_cascade"

        firebase_service.save_closed_loop_state(user_id, loop)

        return {
            "user_id": user_id,
            "initial_state": loop["initial_state"],
            "current_state": current_state,
            "cycles_completed": loop["cycles_completed"],
            "tried_techniques": loop["tried_techniques"],
            "is_target_reached": is_baseline_reached,
            "guidance_message": guidance_msg,
            "next_action": next_action,
            "next_recommended_technique_id": next_tech_id,
            "next_recommended_technique_name": next_tech_name
        }


closed_loop_tracker = ClosedLoopTracker()
