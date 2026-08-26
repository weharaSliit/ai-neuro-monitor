"""
Missing Value Handler Service (Feature 1).
Handles signal loss, LOCF imputation, state fallback, system alerts, and safety overrides based strictly on single fused_stress_label and stress_probability inputs.
"""

from typing import Dict, Any, Tuple
from app.models.schemas import TelemetryPayload, ProcessedSignalResult
from app.config import (
    LOCF_MAX_SECONDS,
    NORMAL_ASSUME_MAX_SECONDS,
    ALERT_TIMEOUT_SECONDS,
    SAFETY_PROBABILITY_THRESHOLD
)

class MissingValueHandler:
    def __init__(self):
        # Store last known valid telemetry packet per user for LOCF
        self._last_observations: Dict[str, TelemetryPayload] = {}

    def process_telemetry(self, telemetry: TelemetryPayload) -> ProcessedSignalResult:
        """
        Processes incoming telemetry according to Missing Value Handler rules:
        1. Checks 2-minute baseline calibration status (is_calibrated).
        2. During calibration: Defaults to 'normal' state and bypasses false alerts/safety overrides.
        3. After calibration:
           - LOCF imputation within 3 seconds.
           - Assume 'normal' state between 3 to 10 seconds timeout.
           - Trigger alert notification after 10 seconds data loss during active streaming.
           - Safety override: If fused label is 'normal' but calibrated stress_probability > 0.75, force label to 'stress'.
        """
        user_id = telemetry.user_id
        dt = telemetry.seconds_since_last_packet
        is_calibrated = getattr(telemetry, "is_calibrated", True)
        
        is_locf_applied = False
        is_alert_triggered = False
        is_safety_override = False
        effective_label = telemetry.fused_stress_label or "normal"
        stress_prob = telemetry.stress_probability
        msg_parts = []

        # --- Rule 0: Handling 2-Minute Baseline Calibration Phase ---
        if not is_calibrated:
            raw_l = (telemetry.fused_stress_label or "").lower()
            if raw_l in ["high_stress", "stress", "high", "acute"] or stress_prob >= 0.60:
                effective_label = "stress"
            elif stress_prob >= 0.35 or raw_l in ["pre-stress", "pre_stress"]:
                effective_label = "pre-stress"
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
                message=summary_msg
            )

        # --- Rule 1, 2, 3: Data Loss & LOCF Logic (Calibrated Telemetry) ---
        if dt > 0:
            if dt <= LOCF_MAX_SECONDS:
                # Apply LOCF if available
                if user_id in self._last_observations:
                    last_obs = self._last_observations[user_id]
                    stress_prob = getattr(last_obs, "stress_probability", stress_prob)
                    effective_label = getattr(last_obs, "fused_stress_label", effective_label)
                    is_locf_applied = True
            elif LOCF_MAX_SECONDS < dt <= NORMAL_ASSUME_MAX_SECONDS:
                # Fallback to 'normal' state during transient signal drop
                effective_label = "normal"
            elif dt > ALERT_TIMEOUT_SECONDS:
                # Trigger system alert for severe data loss
                is_alert_triggered = True
                effective_label = "normal"

        # --- Rule 4: Safety Override Logic based strictly on calibrated stress_probability ---
        if effective_label == "normal":
            if stress_prob > SAFETY_PROBABILITY_THRESHOLD:
                effective_label = "stress"
                is_safety_override = True

        # Store current payload as last observation for future LOCF
        self._last_observations[user_id] = telemetry

        # Message summary
        if is_safety_override:
            msg_parts.append(f"CRITICAL: Safety Override engaged! Calibrated stress probability ({stress_prob:.2f} > 0.75) overrides 'normal' label to 'stress'.")
        if is_locf_applied:
            msg_parts.append(f"LOCF applied for missing packet (dt={dt:.1f}s <= 3s).")
        if dt > ALERT_TIMEOUT_SECONDS:
            msg_parts.append(f"SYSTEM ALERT: Data loss threshold exceeded (dt={dt:.1f}s > 10s).")

        summary_msg = " | ".join(msg_parts) if msg_parts else "Telemetry processed cleanly."

        # 2-element vector for K-Means Context Clusterer: [stress_prob, 1.0 - stress_prob]
        prob_flat_vec = [stress_prob, max(0.0, 1.0 - stress_prob)]

        return ProcessedSignalResult(
            user_id=user_id,
            effective_label=effective_label,
            is_safety_override=is_safety_override,
            is_locf_applied=is_locf_applied,
            is_alert_triggered=is_alert_triggered,
            features_flat=prob_flat_vec,
            message=summary_msg
        )

# Global singleton instance
missing_value_handler = MissingValueHandler()
