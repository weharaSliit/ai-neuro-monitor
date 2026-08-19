"""
Multi-Member Telemetry Signal Generator & Simulator for Calm AI.
Simulates single fused_stress_label and stress_probability received from teammates' fusion engine.
"""

import time
import numpy as np
from typing import Dict, Any
from app.models.schemas import TelemetryPayload

class SignalSimulator:
    def __init__(self):
        self._current_mode = "normal"
        self._last_packet_time = time.time()

    def set_simulation_mode(self, mode: str):
        if mode in ["normal", "pre-stress", "stress", "safety_override_test"]:
            self._current_mode = mode

    def generate_telemetry(self, user_id: str = "user_default", dt_seconds: float = 0.0) -> TelemetryPayload:
        """Generates real-time synthetic TelemetryPayload for a user."""
        detailed = self.generate_detailed_telemetry(user_id, dt_seconds)
        return detailed["telemetry"]

    def generate_detailed_telemetry(self, user_id: str = "user_default", dt_seconds: float = 0.0) -> Dict[str, Any]:
        """
        Generates single fused_stress_label and stress_probability payload.
        """
        now = time.time()
        mode = self._current_mode

        if mode == "normal":
            fused_label = "normal"
            stress_prob = float(np.random.normal(0.15, 0.02))
        elif mode == "pre-stress":
            fused_label = "pre-stress"
            stress_prob = float(np.random.normal(0.55, 0.03))
        elif mode == "stress":
            fused_label = "stress"
            stress_prob = float(np.random.normal(0.88, 0.03))
        elif mode == "safety_override_test":
            fused_label = "normal"
            stress_prob = 0.82  # Label is 'normal' BUT probability > 0.75 -> Triggers Safety Override!
        else:
            fused_label = "normal"
            stress_prob = 0.15

        telemetry = TelemetryPayload(
            user_id=user_id,
            timestamp=now,
            fused_stress_label=fused_label,
            stress_probability=stress_prob,
            seconds_since_last_packet=dt_seconds
        )

        return {
            "telemetry": telemetry,
            "fusion_engine_output": {
                "fused_stress_label": fused_label,
                "stress_probability": stress_prob
            },
            "member4_calm_ai": {
                "component": "Member 4 (Calm AI Closed-Loop)",
                "combined_effective_label": fused_label,
                "is_safety_override": mode == "safety_override_test"
            }
        }

# Global instance
simulator_service = SignalSimulator()
