#(Detecting the 1.0-1.5 escalation)


class DriftTrendAnalyzer:
    """
    Research Goal: Isolate the 'Pre-Stress' Escalation Phase.
    Logic: Trigger alert only if 3 consecutive windows are in the 1.0-1.5 band.
    """
    def __init__(self, window_size=3):
        self.buffer = []
        self.window_size = window_size

    def analyze_drift(self, z_score):
        # Check for Pre-Stress Escalation (The 'Golden Band')
        is_drifting = (abs(z_score) >= 1.0) and (abs(z_score) <= 1.5)
        is_peak = (abs(z_score) > 1.5)

        self.buffer.append(is_drifting)
        if len(self.buffer) > self.window_size:
            self.buffer.pop(0)

        # Trigger Logic
        if all(self.buffer) and len(self.buffer) == self.window_size:
            return "PRE-STRESS_ESCALATION_DETECTED"
        elif is_peak:
            return "PEAK_STRESS_ANOMALY"
        return "STABLE"