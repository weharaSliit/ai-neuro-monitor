"""
Suitability Checker Service.
Evaluates whether a selected relaxation technique is suitable for the user's current stress level.
If unsuitable, generates an empathetic caution popup warning and recommends the optimal alternative.
"""

from typing import Dict, Any
from app.config import TECHNIQUES

class SuitabilityChecker:
    def check_suitability(
        self,
        user_id: str,
        technique_id: str,
        current_stress_label: str,
        stress_probability: float = 0.5
    ) -> Dict[str, Any]:
        """
        Evaluates technique suitability:
        - If current_stress_label is 'stress':
          High-intensity or passive games may not provide immediate recovery.
          Optimal recommendation is 'guided_meditation' or 'breathing_garden'.
        - If current_stress_label is 'pre-stress':
          'focus_arcade' or 'adaptive_environment' recommended.
        - If 'normal':
          All methods suitable.
        """
        current = current_stress_label.lower()
        is_suitable = True
        warning_title = ""
        warning_message = ""
        recommended_technique_id = technique_id

        if current == "stress" and technique_id not in ["breathing_garden", "guided_meditation"]:
            is_suitable = False
            recommended_technique_id = "guided_meditation"
            warning_title = "⚠️ Calm AI Suitability Warning"
            warning_message = (
                f"Your live stress score indicates acute stress. "
                f"The '{TECHNIQUES.get(technique_id, {}).get('title', technique_id)}' technique may not provide optimal recovery right now. "
                f"Calm AI recommends starting with 'Guided Meditation & Breathwork' for immediate autonomic baseline restoration."
            )
        elif current == "pre-stress" and technique_id == "cognitive_destress":
            is_suitable = False
            recommended_technique_id = "focus_arcade"
            warning_title = "⚠️ Mild Stress Caution"
            warning_message = (
                f"Your probability signals show pre-stress tension. 'Focus & Flow Arcade' is recommended "
                f"to channel your attention and guide your nervous system back to 100% Normal baseline."
            )

        recommended_info = TECHNIQUES.get(recommended_technique_id, TECHNIQUES["breathing_garden"])

        return {
            "is_suitable": is_suitable,
            "current_stress_label": current_stress_label,
            "requested_technique_id": technique_id,
            "recommended_technique_id": recommended_technique_id,
            "recommended_title": recommended_info["title"],
            "warning_title": warning_title,
            "warning_message": warning_message
        }

# Global instance
suitability_checker = SuitabilityChecker()
