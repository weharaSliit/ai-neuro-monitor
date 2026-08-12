"""
AI Relaxation Chatbot Service.
Provides personalized stress coaching, conversational grounding, and interactive relaxation advice.
Integrates with Google Gemini API when available, with intelligent local fallback for offline/keyless testing.
"""

import os
import requests
from typing import Dict, Any, Optional
from app.config import TECHNIQUES

class RelaxationChatbot:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY", "")

    def generate_response(self, user_message: str, stress_label: str = "normal") -> Dict[str, Any]:
        """
        Generates conversational response to support the user based on real-time stress state.
        """
        user_msg_lower = user_message.lower()

        # Try Gemini API if key is present
        if self.api_key:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={self.api_key}"
                prompt = (
                    f"You are CAPS Relaxation AI, an empathetic, evidence-based stress reduction assistant. "
                    f"The user's current stress state is: {stress_label.upper()}. "
                    f"User message: '{user_message}'. "
                    f"Provide a brief (2-3 sentences), warm, comforting response, and suggest a soothing micro-exercise."
                )
                payload = {"contents": [{"parts": [{"text": prompt}]}]}
                res = requests.post(url, json=payload, timeout=5)
                if res.status_code == 200:
                    data = res.json()
                    reply_text = data["candidates"][0]["content"]["parts"][0]["text"]
                    return {
                        "reply": reply_text,
                        "suggested_action": self._determine_suggested_action(user_msg_lower, stress_label)
                    }
            except Exception:
                pass # Fall through to intelligent local engine

        # Intelligent Local NLP Engine
        return self._local_nlp_response(user_msg_lower, stress_label)

    def _local_nlp_response(self, text: str, stress_label: str) -> Dict[str, Any]:
        """Local response generator using psychological grounding techniques."""
        if "breath" in text or "anxious" in text or "panic" in text or stress_label == "stress":
            reply = (
                "I notice your physiological signals indicate heightened stress. Let's ground ourselves together: "
                "Take a deep breath in for 4 seconds, hold for 4 seconds, and exhale slowly. "
                "Would you like me to start the Breathing Garden exercise?"
            )
            suggested_action = "start_breathing_garden"
        elif "work" in text or "tired" in text or "focus" in text:
            reply = (
                "Work strain can build up quickly. A 60-second micro-break can reset your HRV variability. "
                "Try sitting back, dropping your shoulders away from your ears, and gazing at a distant wall."
            )
            suggested_action = "start_adaptive_environment"
        elif "music" in text or "sound" in text or "rain" in text or "ocean" in text:
            reply = (
                "Sensory soundscapes help lower GSR skin conductance levels quickly. "
                "I recommend launching our Rain Scene or Ocean Tides interactive soundscape!"
            )
            suggested_action = "start_soundscape"
        elif "game" in text or "how" in text or "help" in text:
            reply = (
                "CAPS uses real-time bio-feedback from your smart ring, earbud, and phone to select the exact "
                "relaxation game your nervous system needs right now. Select 'Start Intervention' on your dashboard anytime!"
            )
            suggested_action = "open_dashboard"
        else:
            reply = (
                f"I'm here with you. Your current state is {stress_label.upper()}. "
                "Remember to loosen your chin, un-clench your jaw, and let your body relax into your seat. "
                "How are you feeling right now?"
            )
            suggested_action = None

        return {"reply": reply, "suggested_action": suggested_action}

    def _determine_suggested_action(self, text: str, stress_label: str) -> Optional[str]:
        if "breath" in text:
            return "start_breathing_garden"
        if "music" in text or "sound" in text:
            return "start_soundscape"
        return None

# Global instance
chatbot_service = RelaxationChatbot()
