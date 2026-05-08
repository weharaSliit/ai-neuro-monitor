import numpy as np
import joblib
import os
from .ema_service import calculate_z_score

# --- PATH SETUP ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Updated to point to the Step 8 Production Model
MODEL_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "outputs", "models", "final_stress_model_s002.joblib"))

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
        Decision Logic: Maps Android Sensors to SWELL-KW Behavioral Phenotypes.
        """
        if not self.model or not user_baselines:
            return {"label": "Error", "score": 0.0, "is_anomaly": False}

        # 1. Feature Mapping (Android -> SWELL-KW logic)
        # SWELL-KW expected: [SnKeyStrokes, SnChars, ErrorKeyRatio]
        # Android provides: [keystrokeCount, typing_speed, typing_rhythm_ms]
        
        keystrokes = float(firebase_metrics.get('keystrokeCount', 0))
        chars = float(firebase_metrics.get('typing_speed', 0)) # WPM as proxy
        error_ratio = 0.02 # Placeholder until backspace tracking is added

        feat_array = np.array([[keystrokes, chars, error_ratio]])

        # 2. Anomaly Detection (Objective 1 Winner)
        # Output: 1 (Normal), -1 (Anomaly/Stress)
        model_prediction = self.model.predict(feat_array)[0]
        is_anomaly = (model_prediction == -1)

        # 3. Z-Score Validation (The "Digital Phenotype" Deviation)
        # We check how far the current Typing Rhythm (ms) is from the user's baseline
        rhythm_val = float(firebase_metrics.get('typing_rhythm_ms', 0))
        
        # Pull baseline for rhythm (Objective 2 Task 1)
        mean_rhythm = user_baselines.get('typing_rhythm_ms', {}).get('mean', 200)
        std_rhythm = user_baselines.get('typing_rhythm_ms', {}).get('std', 50)
        
        z_score_rhythm = abs(calculate_z_score(rhythm_val, mean_rhythm, std_rhythm))

        # 4. Final Stress Classification
        if is_anomaly and z_score_rhythm > 2.0:
            label = "High Confidence Stress"
            score = 0.9
        elif is_anomaly or z_score_rhythm > 1.5:
            label = "Pre-Stress (Digital Phenotype detected)"
            score = 0.6
        else:
            label = "Normal"
            score = 0.1

        return {
            "label": label,
            "score": score,
            "avg_z": round(float(z_score_rhythm), 4),
            "is_anomaly": is_anomaly,
            "phenotype_metric": "Typing Rhythm"
        }

predictor = StressPredictor()