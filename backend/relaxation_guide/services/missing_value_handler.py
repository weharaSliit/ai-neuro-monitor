"""
Missing Value Handler & Safety Override Module for Relaxation Guide.
"""

import sys
import time
from typing import Dict, Any, Optional
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import (
    LOCF_MAX_SECONDS,
    NORMAL_ASSUME_MAX_SECONDS,
    ALERT_TIMEOUT_SECONDS,
    SAFETY_PROBABILITY_THRESHOLD
)
from backend.relaxation_guide.models.schemas import TelemetryPayload, ProcessedSignalResult
from backend.relaxation_guide.services import firebase_service


class MissingValueHandler:
    def __init__(self):
        self._last_observations: Dict[str, TelemetryPayload] = {}

    def process_telemetry(self, telemetry: TelemetryPayload) -> ProcessedSignalResult:
        user_id = telemetry.user_id
        dt = telemetry.seconds_since_last_packet
        is_calibrated = telemetry.is_calibrated or firebase_service.baseline_exists(user_id)

        effective_label = telemetry.fused_stress_label
        stress_prob = telemetry.stress_probability

        is_safety_override = False
        is_locf_applied = False
        is_alert_triggered = False

        user_baseline = getattr(telemetry, "user_baseline", None)
        if user_baseline is None:
            user_baseline = firebase_service.get_baseline(user_id)

        if not is_calibrated:
            if "high" in effective_label or effective_label == "stress" or stress_prob >= 0.50:
                effective_label = "stress"
            else:
                effective_label = "normal"

            summary_msg = f"CALIBRATION / STREAM ACTIVE: Effective state evaluated to '{effective_label}' (fused_prob={stress_prob:.2f})."
            self._last_observations[user_id] = telemetry
            return ProcessedSignalResult(
                user_id=user_id,
                effective_label=effective_label,
                is_safety_override=False,
                is_locf_applied=False,
                is_alert_triggered=False,
                features_flat=[stress_prob, max(0.0, 1.0 - stress_prob)],
                message=summary_msg,
                has_live_packet=telemetry.has_live_packet,
                user_baseline=user_baseline
            )

        if dt > 0:
            if dt <= LOCF_MAX_SECONDS:
                if user_id in self._last_observations:
                    last_obs = self._last_observations[user_id]
                    stress_prob = getattr(last_obs, "stress_probability", stress_prob)
                    effective_label = getattr(last_obs, "fused_stress_label", effective_label)
                    is_locf_applied = True
            elif LOCF_MAX_SECONDS < dt <= NORMAL_ASSUME_MAX_SECONDS:
                effective_label = "normal"
            elif dt > ALERT_TIMEOUT_SECONDS:
                is_alert_triggered = True
                effective_label = "normal"

        if effective_label == "normal":
            if stress_prob > SAFETY_PROBABILITY_THRESHOLD:
                effective_label = "stress"
                is_safety_override = True

        self._last_observations[user_id] = telemetry

        summary_msg = f"Effective state: '{effective_label}' (fused_prob={stress_prob:.2f})."
        if is_safety_override:
            summary_msg += " [SAFETY OVERRIDE TRIGGERED]"
        if is_locf_applied:
            summary_msg += " [LOCF Applied]"
        if is_alert_triggered:
            summary_msg += " [ALERT: Data Loss > 10s]"

        return ProcessedSignalResult(
            user_id=user_id,
            effective_label=effective_label,
            is_safety_override=is_safety_override,
            is_locf_applied=is_locf_applied,
            is_alert_triggered=is_alert_triggered,
            features_flat=[stress_prob, max(0.0, 1.0 - stress_prob)],
            message=summary_msg,
            has_live_packet=telemetry.has_live_packet,
            user_baseline=user_baseline
        )


missing_value_handler = MissingValueHandler()
