import numpy as np
import joblib
import os
from ema_service import calculate_z_score

# --- PATH SETUP ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Updated to point to the Step 8 Production Model
MODEL_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "models", "stress_engine.pkl"))

class StressPredictor:
    def __init__(self):
        print(f"🚀 Initializing Production Brain: {MODEL_PATH}")
        try:
            self.model = joblib.load(MODEL_PATH)
            print("Winner Model (One-Class SVM) loaded successfully ✓")
        except Exception as e:
            print(f"⚠️ Warning: Could not load production model. Error: {e}")
            self.model = None

    def predict(self, firebase_metrics, user_baselines):
        """
        Decision Logic: Maps Android Sensors to Deployed Model Features.
        """
        if not self.model:
            return {"label": "Error", "score": 0.0, "is_anomaly": False}
            
        if not user_baselines:
            user_baselines = {}

        # 1. Feature Mapping (Android -> Deployed Model logic)
        # s8_deploy_production.py expected: ["dwell_time", "flight_time", "scroll_velocity"]
        dwell_time = float(firebase_metrics.get('avg_dwell', 0))
        flight_time = float(firebase_metrics.get('avg_flight', 0))
        scroll_velocity = float(firebase_metrics.get('scroll_velocity', 0))

        feat_array = np.array([[dwell_time, flight_time, scroll_velocity]])

        # 2. Anomaly Detection (Objective 1 Winner)
        # Output: 1 (Normal), -1 (Anomaly/Stress)
        model_prediction = self.model.predict(feat_array)[0]
        is_anomaly = bool(model_prediction == -1)

        # 3. Z-Score Validation (The "Digital Phenotype" Deviation)
        # We check how far the current Dwell Time is from the user's baseline
        # Pull baseline for avg_dwell (Objective 2 Task 1)
        mean_dwell = user_baselines.get('avg_dwell', {}).get('mean', 200)
        std_dwell = user_baselines.get('avg_dwell', {}).get('std', 50)
        
        z_score_dwell = abs(calculate_z_score(dwell_time, mean_dwell, std_dwell))

        # 4. Final Stress Classification
        if is_anomaly and z_score_dwell > 2.0:
            label = "High Confidence Stress"
            score = 0.9
        elif is_anomaly or z_score_dwell > 1.5:
            label = "Pre-Stress (Digital Phenotype detected)"
            score = 0.6
        else:
            label = "Normal"
            score = 0.1

        return {
            "label": label,
            "score": score,
            "avg_z": round(float(z_score_dwell), 4),
            "is_anomaly": is_anomaly,
            "phenotype_metric": "Dwell Time"
        }

predictor = StressPredictor()