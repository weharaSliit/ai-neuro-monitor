"""
Telemetry Aggregator Service.
Ingests single fused_stress_label and stress_probability received from teammates' multimodal data fusion engine via Firebase Realtime Database.
"""

import os
import json
import time
import glob
from typing import Dict, Any, Optional
from app.models.schemas import TelemetryPayload
from app.services import firebase_service

class TelemetryAggregator:
    def __init__(self):
        # Path to output JSON file produced by teammates' multimodal fusion engine (fallback)
        self.fusion_output_path = os.getenv("FUSION_ENGINE_OUTPUT_PATH", "../fusion_engine/output.json")

    def read_fusion_engine_output(self, user_id: str = "user_default", session_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Reads fusion engine output from Firebase Realtime DB (predictions/{user_id}/{session_id}).
        Falls back to local file if Firebase is not yet populated.
        """
        # 1. Primary: Attempt to read latest prediction inputs from fusion_en_sessions in Firebase Realtime DB
        fb_prediction = firebase_service.get_latest_prediction(user_id, session_id)
        if fb_prediction and any(k in fb_prediction for k in ["stress_label", "probability", "fused_stress_label", "stress_probability", "label", "prob_stress", "prediction"]):
            raw_label_val = fb_prediction.get("fused_stress_label") or fb_prediction.get("stress_label") or fb_prediction.get("label") or "Normal"
            raw_label = str(raw_label_val).lower().strip()

            raw_prob_val = fb_prediction.get("fused_stress_probability")
            if raw_prob_val is None:
                raw_prob_val = fb_prediction.get("stress_probability")
            if raw_prob_val is None:
                raw_prob_val = fb_prediction.get("probability")
            if raw_prob_val is None:
                # Real fusion engine schema: fusion_en_sessions/{user}/{session}/{window}/
                # probability_vector/{eeg,hrv_gsr,behav,fused} -- "fused" is the weighted
                # multimodal output (see fusion_live_session.py's poll_once()).
                prob_vector = fb_prediction.get("probability_vector")
                if isinstance(prob_vector, dict):
                    raw_prob_val = prob_vector.get("fused")
            if raw_prob_val is None:
                raw_prob_val = fb_prediction.get("prob_stress", 0.50)

            prob_stress = float(raw_prob_val)
            if prob_stress > 1.0:
                prob_stress = prob_stress / 100.0

            trend_alert = bool(fb_prediction.get("trend_alert", False))

            # Exact Pipeline Color Threshold Synchronization:
            # >= 0.60 (60% Red) -> "stress"
            # 0.35 to 0.60 (35%-60% Orange) -> "pre-stress"
            # < 0.35 (< 35% Green) -> "normal"
            if raw_label in ["high_stress", "stress", "high", "acute"] or prob_stress >= 0.60:
                label = "stress"
            elif prob_stress >= 0.35 or raw_label in ["pre-stress", "pre_stress", "medium"]:
                label = "pre-stress"
            else:
                label = "normal"

            is_calibrated = firebase_service.baseline_exists(user_id)
            return {
                "fused_stress_label": label,
                "stress_probability": prob_stress,
                "is_calibrated": is_calibrated,
                "has_live_packet": True,
                "active_session_id": fb_prediction.get("session_id"),
                "raw_label": str(raw_label_val),
            }

        # 2. Fallback: Read local JSON file if present
        if os.path.exists(self.fusion_output_path):
            try:
                with open(self.fusion_output_path, "r") as f:
                    local_data = json.load(f)
                    local_data.setdefault("has_live_packet", False)
                    return local_data
            except Exception:
                pass
        
        fallback_files = glob.glob("../**/fusion*output.json", recursive=True)
        if fallback_files:
            try:
                with open(fallback_files[0], "r") as f:
                    local_data = json.load(f)
                    local_data.setdefault("has_live_packet", False)
                    return local_data
            except Exception:
                pass

        return {
            "fused_stress_label": "normal",
            "stress_probability": 0.50,
            "is_calibrated": firebase_service.baseline_exists(user_id),
            "has_live_packet": False,
        }

    def parse_fusion_payload(
        self,
        user_id: str = "user_default",
        fused_stress_label: str = "normal",
        stress_probability: float = 0.50,
        seconds_since_last_packet: float = 0.0,
        is_calibrated: Optional[bool] = None,
        has_live_packet: bool = False,
        active_session_id: Optional[str] = None,
        raw_label: Optional[str] = None
    ) -> TelemetryPayload:
        """
        Parses single fused_stress_label and stress_probability inputs from teammate fusion engine output.
        """
        raw_label = fused_stress_label.lower().strip() if fused_stress_label else "normal"
        if raw_label in ["stress", "high", "acute", "high_stress"]:
            clean_label = "stress"
        elif raw_label in ["pre-stress", "pre_stress", "medium", "moderate"]:
            clean_label = "pre-stress"
        else:
            clean_label = "normal"

        clean_prob = max(0.0, min(1.0, float(stress_probability)))
        
        # Check baseline existence in Firebase if is_calibrated not explicitly passed
        if is_calibrated is None:
            is_calibrated = firebase_service.baseline_exists(user_id)

        return TelemetryPayload(
            user_id=user_id,
            timestamp=time.time(),
            fused_stress_label=clean_label,
            stress_probability=clean_prob,
            seconds_since_last_packet=seconds_since_last_packet,
            is_calibrated=is_calibrated,
            has_live_packet=has_live_packet,
            active_session_id=active_session_id,
            raw_label=raw_label or fused_stress_label
        )

# Global instance
telemetry_aggregator = TelemetryAggregator()
