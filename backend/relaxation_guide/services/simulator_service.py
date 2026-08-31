"""
Simulator Service for Relaxation Guide.
"""

import sys
import time
import numpy as np
from typing import Dict, Any
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.models.schemas import TelemetryPayload


class SignalSimulator:
    def __init__(self):
        self._current_mode = "normal"
        self._last_packet_time = time.time()

    def set_simulation_mode(self, mode: str):
        if mode in ["normal", "stress", "safety_override_test"]:
            self._current_mode = mode

    def generate_telemetry(self, user_id: str = "user_default", dt_seconds: float = 0.0) -> TelemetryPayload:
        detailed = self.generate_detailed_telemetry(user_id, dt_seconds)
        return detailed["telemetry"]

    def generate_detailed_telemetry(self, user_id: str = "user_default", dt_seconds: float = 0.0) -> Dict[str, Any]:
        now = time.time()
        mode = self._current_mode

        fb_fusion = None
        if mode == "normal":
            try:
                from backend.relaxation_guide.services.telemetry_aggregator import telemetry_aggregator
                fb_fusion = telemetry_aggregator.read_fusion_engine_output(user_id)
            except Exception:
                fb_fusion = None

        if fb_fusion and ("fused_stress_label" in fb_fusion or "stress_probability" in fb_fusion):
            fused_label = fb_fusion.get("fused_stress_label", "normal")
            stress_prob = float(fb_fusion.get("stress_probability", 0.15))
        elif mode == "normal":
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
            stress_prob = 0.82
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


simulator_service = SignalSimulator()
