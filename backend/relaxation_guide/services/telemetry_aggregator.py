"""
Telemetry Aggregator Service.
Ingests single fused_stress_label and stress_probability received from teammates' multimodal data fusion engine via Firebase Realtime Database.
"""

import os
import sys
import json
import time
from typing import Dict, Any, Optional
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.models.schemas import TelemetryPayload
from backend.relaxation_guide.services import firebase_service


class TelemetryAggregator:
    def __init__(self):
        self.fusion_output_path = os.getenv("FUSION_ENGINE_OUTPUT_PATH", "../fusion_engine/output.json")

    def read_fusion_engine_output(self, user_id: str = "user_default", session_id: Optional[str] = None) -> Dict[str, Any]:
        fb_prediction = firebase_service.get_latest_prediction(user_id, session_id)
        has_live_packet = bool(fb_prediction.get("has_live_packet", False)) if isinstance(fb_prediction, dict) else False

        if fb_prediction and isinstance(fb_prediction, dict) and has_live_packet:
            raw_label_val = (
                fb_prediction.get("label") or
                fb_prediction.get("stress_label") or
                fb_prediction.get("fused_label") or
                fb_prediction.get("fused_stress_label") or
                "normal"
            )
            if isinstance(raw_label_val, dict):
                raw_label_val = raw_label_val.get("label") or raw_label_val.get("fused_label") or "normal"
            raw_label_str = str(raw_label_val).strip()
            raw_label_lower = raw_label_str.lower()

            raw_prob_val = None
            prob_vector = fb_prediction.get("probability_vector")
            if isinstance(prob_vector, dict) and isinstance(prob_vector.get("fused"), (int, float)):
                raw_prob_val = float(prob_vector["fused"])

            if raw_prob_val is None:
                for k in ["confidence", "fused_probability", "fused_stress_probability", "stress_probability", "probability", "prob_stress"]:
                    v = fb_prediction.get(k)
                    if isinstance(v, (int, float)):
                        raw_prob_val = float(v)
                        break

            if raw_prob_val is None:
                raw_prob_val = 0.50

            prob_stress = float(raw_prob_val)
            if prob_stress > 1.0:
                prob_stress = prob_stress / 100.0

            # Read exact user baseline dynamically from Firebase for this user and session
            user_baseline = firebase_service.get_baseline(user_id, session_id)
            if user_baseline is None:
                raw_baseline = fb_prediction.get("baseline") or fb_prediction.get("user_baseline")
                if isinstance(raw_baseline, (int, float)):
                    user_baseline = float(raw_baseline) / 100.0 if float(raw_baseline) > 1.0 else float(raw_baseline)

            # Label mapping from fusion engine:
            # High Confidence Stress -> high_stress / stress
            # Low Confidence Stress -> low_stress / stress
            if "high" in raw_label_lower or raw_label_lower == "stress":
                label = "stress"
            elif "low" in raw_label_lower:
                label = "low_stress"
            else:
                label = "normal"

            is_calibrated = True
            active_sid = fb_prediction.get("active_session_id") or session_id
            return {
                "fused_stress_label": label,
                "raw_label": raw_label_str,
                "stress_probability": prob_stress,
                "confidence": prob_stress,
                "user_baseline": None,
                "is_calibrated": True,
                "has_live_packet": True,
                "active_session_id": active_sid
            }

        # Active session exists but has NOT received any reading packet yet!
        active_sid = fb_prediction.get("active_session_id") if isinstance(fb_prediction, dict) else session_id
        return {
            "fused_stress_label": "normal",
            "stress_probability": 0.0,
            "user_baseline": None,
            "is_calibrated": True,
            "has_live_packet": False,
            "message": f"Awaiting first reading in active session '{active_sid}'" if active_sid else "Awaiting live telemetry stream..."
        }

        if os.path.exists(self.fusion_output_path):
            try:
                with open(self.fusion_output_path, "r") as f:
                    data = json.load(f)
                    fused_label = data.get("fused_stress_label", data.get("stress_label", "normal")).lower()
                    prob_stress = float(data.get("stress_probability", data.get("probability", 0.50)))
                    return {
                        "fused_stress_label": fused_label,
                        "stress_probability": prob_stress,
                        "is_calibrated": True,
                        "has_live_packet": True
                    }
            except Exception as e:
                print(f"Warning: Error reading fusion engine output file: {e}")

        return {
            "fused_stress_label": "normal",
            "stress_probability": 0.15,
            "is_calibrated": True,
            "has_live_packet": False
        }

    def parse_fusion_payload(
        self,
        user_id: str,
        fused_stress_label: str,
        stress_probability: float,
        seconds_since_last_packet: float = 0.0,
        has_live_packet: bool = True,
        user_baseline: Optional[float] = None
    ) -> TelemetryPayload:
        if user_baseline is None:
            user_baseline = firebase_service.get_baseline(user_id) or 0.35
        return TelemetryPayload(
            user_id=user_id,
            timestamp=time.time(),
            fused_stress_label=fused_stress_label,
            stress_probability=stress_probability,
            seconds_since_last_packet=seconds_since_last_packet,
            has_live_packet=has_live_packet,
            user_baseline=user_baseline
        )


telemetry_aggregator = TelemetryAggregator()
