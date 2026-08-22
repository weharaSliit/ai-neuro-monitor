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
        print(f"[INFO] Initializing Production Brain: {MODEL_PATH}")
        try:
            self.model = joblib.load(MODEL_PATH)
            print("[OK] Winner Model (One-Class SVM) loaded successfully")
        except Exception as e:
            print(f"[WARN] Warning: Could not load production model. Error: {e}")
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

        # 3. Z-Score Validation — Multi-Feature Composite (Idiographic Baseline)
        # Research Gap 4: We check how far ALL three key signals deviate from
        # THIS user's personal baseline, then use the average deviation.
        # This is more sensitive than checking a single feature alone.

        # Dwell deviation from personal baseline
        mean_dwell = user_baselines.get('avg_dwell', {}).get('mean', 200)
        std_dwell  = user_baselines.get('avg_dwell', {}).get('std',   50)
        z_dwell    = abs(calculate_z_score(dwell_time, mean_dwell, std_dwell))

        # Flight time deviation from personal baseline
        mean_flight = user_baselines.get('avg_flight', {}).get('mean', 200)
        std_flight  = user_baselines.get('avg_flight', {}).get('std',   50)
        z_flight    = abs(calculate_z_score(flight_time, mean_flight, std_flight))

        # Scroll velocity deviation from personal baseline
        mean_scroll = user_baselines.get('scroll_velocity', {}).get('mean', 400)
        std_scroll  = user_baselines.get('scroll_velocity', {}).get('std',  150)
        z_scroll    = abs(calculate_z_score(scroll_velocity, mean_scroll, std_scroll))

        # Composite Z-score: average of all three deviations
        # If the user has no scroll data yet (z_scroll=0), still works correctly
        composite_z = round((z_dwell + z_flight + z_scroll) / 3.0, 4)

        # 4. Final Stress Classification (OC-SVM + composite Z-score gate)
        if is_anomaly and composite_z > 2.0:
            label = "High Confidence Stress"
            score = 0.9
        elif is_anomaly or composite_z > 1.5:
            label = "Pre-Stress (Digital Phenotype detected)"
            score = 0.6
        else:
            label = "Normal"
            score = 0.1

        return {
            "label":            label,
            "score":            score,
            "composite_z":      composite_z,
            "z_dwell":          round(z_dwell, 4),
            "z_flight":         round(z_flight, 4),
            "z_scroll":         round(z_scroll, 4),
            "is_anomaly":       is_anomaly,
            "phenotype_metric": "Composite (Dwell + Flight + Scroll)"
        }

predictor = StressPredictor()