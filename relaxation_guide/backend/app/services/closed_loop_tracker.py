"""
Closed-Loop State Tracker Service.
Tracks state progression (stress -> pre-stress -> normal) across continuous intervention cycles.
Provides dynamic encouragement and guided follow-up recommendations when normal state is not yet reached.
"""

from typing import Dict, Any, List

class ClosedLoopTracker:
    def __init__(self):
        # User ID -> {'initial_state': str, 'current_state': str, 'cycles_completed': int, 'history': List[str]}
        self._user_loops: Dict[str, Dict[str, Any]] = {}

    def update_closed_loop(self, user_id: str, current_state: str) -> Dict[str, Any]:
        """
        Updates closed-loop monitor with latest signal state.
        Returns closed-loop guidance summary.
        """
        if user_id not in self._user_loops:
            self._user_loops[user_id] = {
                "initial_state": current_state,
                "current_state": current_state,
                "cycles_completed": 0,
                "history": [current_state]
            }


        loop = self._user_loops[user_id]
        loop["current_state"] = current_state
        loop["history"].append(current_state)
        loop["cycles_completed"] += 1

        is_normal = (current_state.lower() == "normal")

        if is_normal:
            guidance_msg = "🎯 Target Reached! Your autonomic nervous system has successfully returned to Normal Baseline state."
            next_action = "complete_loop"
        elif current_state.lower() == "pre-stress":
            guidance_msg = "📈 Great Progress! You transitioned from Stress to Pre-Stress. Let's do 1 quick soundscape session to achieve 100% Normal state."
            next_action = "suggest_soundscape"
        else:
            guidance_msg = "⚡ Closed-Loop Active: Acute stress detected. Stay calm and engage with the recommended technique below."
            next_action = "suggest_breathing"

        return {
            "user_id": user_id,
            "initial_state": loop["initial_state"],
            "current_state": current_state,
            "cycles_completed": loop["cycles_completed"],
            "is_target_reached": is_normal,
            "guidance_message": guidance_msg,
            "next_action": next_action
        }

# Global instance
closed_loop_tracker = ClosedLoopTracker()
