import numpy as np
import joblib
import os
from .ema_service import calculate_z_score

# --- PATH SETUP ---
# Points to where your research scripts saved the models
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Navigate to phenotyping/outputs/models/
MODEL_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "outputs", "models", "behavior_svm_s002.joblib"))

class StressPredictor:
    def __init__(self):
        print(f"Loading behavioral model from: {MODEL_PATH}")
        try:
            self.model = joblib.load(MODEL_PATH)
            print("One-Class SVM loaded successfully ✓")
        except Exception as e:
            print(f"⚠️ Warning: Could not load model file. Error: {e}")
            self.model = None

    def predict(self, window_features, user_baselines):
        """
        Decision Logic: Combined Anomaly Detection + Z-Score Deviation.
        Ref: Gjoreski et al. (2017) / Objective 2 Task 3
        """
        if not self.model or not user_baselines:
            return {"label": "Error", "score": 0.0, "is_anomaly": False}

        # 1. Prepare Features for Model
        # Order: avg_dwell, dwell_std, avg_flight, flight_std
        feat_array = np.array([[
            window_features.get('avg_dwell', 0),
            window_features.get('dwell_std', 0),
            window_features.get('avg_flight', 0),
            window_features.get('flight_std', 0)
        ]])

        # 2. Layer 1: One-Class SVM Anomaly Check
        # Output: 1 (Normal), -1 (Anomaly)
        model_prediction = self.model.predict(feat_array)[0]
        is_anomaly = (model_prediction == -1)

        # 3. Layer 2: Z-Score Severity Calculation (Pre-Stress Detection)
        # We calculate the average Z-score across all 4 features
        z_scores = []
        for feat in ['avg_dwell', 'dwell_std', 'avg_flight', 'flight_std']:
            val = window_features.get(feat, 0)
            mean = user_baselines[feat]['mean']
            std = user_baselines[feat]['std']
            z_scores.append(abs(calculate_z_score(val, mean, std)))
        
        avg_z = np.mean(z_scores)

        # 4. Final Decision Logic (Gap 4: Pre-Stress Escalation)
        if is_anomaly and avg_z > 2.0:
            label = "High Confidence Stress"
            score = 0.9
        elif is_anomaly and 1.0 <= avg_z <= 2.0:
            label = "Pre-Stress (Escalation)"
            score = 0.5
        elif not is_anomaly and avg_z > 1.5:
            # Subtle change the model missed but Z-score caught
            label = "Possible Pre-Stress"
            score = 0.3
        else:
            label = "Normal"
            score = 0.1

        return {
            "label": label,
            "score": score,
            "avg_z": round(float(avg_z), 4),
            "is_anomaly": is_anomaly
        }

# Global instance for the app to use
predictor = StressPredictor()