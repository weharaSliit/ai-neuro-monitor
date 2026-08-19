"""
Telemetry Aggregator Service.
Ingests single fused_stress_label and stress_probability received from teammates' multimodal data fusion engine.
"""

import os
import json
import time
import glob
from typing import Dict, Any, Optional
from app.models.schemas import TelemetryPayload

class TelemetryAggregator:
    def __init__(self):
        # Path to output JSON file produced by teammates' multimodal fusion engine
        self.fusion_output_path = os.getenv("FUSION_ENGINE_OUTPUT_PATH", "../fusion_engine/output.json")

    def read_fusion_engine_output(self) -> Dict[str, Any]:
        """Reads output JSON file from teammates' multimodal fusion engine if present."""
        if os.path.exists(self.fusion_output_path):
            try:
                with open(self.fusion_output_path, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        
        # Check fallback directory paths for fusion engine output
        fallback_files = glob.glob("../**/fusion*output.json", recursive=True)
        if fallback_files:
            try:
                with open(fallback_files[0], "r") as f:
                    return json.load(f)
            except Exception:
                pass

        return {}

    def parse_fusion_payload(
        self,
        user_id: str = "user_default",
        fused_stress_label: str = "normal",
        stress_probability: float = 0.50,
        seconds_since_last_packet: float = 0.0
    ) -> TelemetryPayload:
        """
        Parses single fused_stress_label and stress_probability inputs from teammate fusion engine output.
        """
        clean_label = fused_stress_label.lower().strip() if fused_stress_label else "normal"
        clean_prob = max(0.0, min(1.0, float(stress_probability)))

        return TelemetryPayload(
            user_id=user_id,
            timestamp=time.time(),
            fused_stress_label=clean_label,
            stress_probability=clean_prob,
            seconds_since_last_packet=seconds_since_last_packet
        )

# Global instance
telemetry_aggregator = TelemetryAggregator()

