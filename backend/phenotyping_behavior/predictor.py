import numpy as np
import joblib
import os
from ema_service import calculate_z_score

# --- PATH SETUP ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Updated to point to the Step 8 Production Model
MODEL_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "models", "stress_engine.pkl"))
# v3.0: StandardScaler saved by s8_deploy_production.py
SCALER_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "models", "feature_scaler.pkl"))

class StressPredictor:
    def __init__(self):
        print(f"[INFO] Initializing Production Brain: {MODEL_PATH}")
        try:
            self.model = joblib.load(MODEL_PATH)
            print("[OK] Winner Model (One-Class SVM) loaded successfully")
        except Exception as e:
            print(f"[WARN] Warning: Could not load production model. Error: {e}")
            self.model = None

        # v3.0: Load the StandardScaler that was fitted on CMU training data.
        # This scaler transforms raw ms values to mean=0, std=1 so the OC-SVM
        # boundary works on relative deviations, not absolute millisecond values.
        try:
            self.scaler = joblib.load(SCALER_PATH)
            print(f"[OK] Feature scaler loaded (means: dwell={self.scaler.mean_[0]:.1f}ms, "
                  f"flight={self.scaler.mean_[1]:.1f}ms, scroll={self.scaler.mean_[2]:.1f})")
        except Exception as e:
            print(f"[WARN] Warning: Could not load feature scaler. Error: {e}")
            self.scaler = None

    def predict(self, firebase_metrics, user_baselines):
        """
        Decision Logic: Maps Android Sensors to Deployed Model Features.
        v3.0: Applies StandardScaler before OC-SVM prediction so that
              both desktop (CMU) and phone users are on the same scale.
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
        # v3.0: Scale features BEFORE prediction so the OC-SVM sees the same
        # distribution it was trained on (mean=0, std=1 per feature).
        # Without scaling: phone user at 145ms would be flagged as anomaly
        # because CMU desktop mean is 89ms. With scaling: both are compared
        # on the same relative scale.
        if self.scaler:
            feat_scaled = self.scaler.transform(feat_array)
        else:
            feat_scaled = feat_array  # Fallback if scaler not available

        # Output: 1 (Normal), -1 (Anomaly/Stress)
        model_prediction = self.model.predict(feat_scaled)[0]
        is_anomaly = bool(model_prediction == -1)

        # 3. Z-Score Validation — Multi-Feature Composite (Idiographic Baseline)
        # Research Gap 4: We check how far ALL three key signals deviate from
        # THIS user's personal baseline, then use the average deviation.
        # This is more sensitive than checking a single feature alone.

        # Dwell deviation from personal baseline
        # Default = typical mobile typing mean (145ms) and std (15ms) for uncalibrated users (Day 1-7)
        mean_dwell = user_baselines.get('avg_dwell', {}).get('mean', 145)
        std_dwell  = user_baselines.get('avg_dwell', {}).get('std',   15)
        z_dwell    = abs(calculate_z_score(dwell_time, mean_dwell, std_dwell))

        # Flight time deviation from personal baseline
        # Default = typical mobile typing mean (230ms) and std (25ms) for uncalibrated users (Day 1-7)
        mean_flight = user_baselines.get('avg_flight', {}).get('mean', 230)
        std_flight  = user_baselines.get('avg_flight', {}).get('std',   25)
        z_flight    = abs(calculate_z_score(flight_time, mean_flight, std_flight))

        # Scroll velocity deviation from personal baseline
        # Default = mobile empirical mean (45 px/sec, std 12) for uncalibrated users (Day 1-7)
        mean_scroll = user_baselines.get('scroll_velocity', {}).get('mean', 45)
        std_scroll  = user_baselines.get('scroll_velocity', {}).get('std',  12)
        z_scroll    = abs(calculate_z_score(scroll_velocity, mean_scroll, std_scroll))

        # Composite Z-score: average of all three deviations
        # If the user has no scroll data yet (z_scroll=0), still works correctly
        composite_z = round((z_dwell + z_flight + z_scroll) / 3.0, 4)

        # 4. Final Stress Classification (Dual-Layer Gate)
        # v3.0 FIX: Changed from OR to AND for Pre-Stress.
        # Rationale: After 7-day calibration, a phone user's normal typing (145ms)
        # differs from CMU desktop data (89ms), so the OC-SVM may flag them as anomaly.
        # But their personal Z-Score (composite_z) would be ~0.0 (perfectly normal).
        # Using AND ensures BOTH layers must agree before triggering Pre-Stress.
        #
        # Decision matrix:
        #   OC-SVM=Anomaly AND Z>2.0  -> High Stress    (both layers agree strongly)
        #   OC-SVM=Anomaly AND Z>1.0  -> Pre-Stress     (both layers agree)
        #   Z>2.0 (any OC-SVM)        -> Pre-Stress     (personal drift alone is enough)
        #   else                       -> Normal
        if is_anomaly and composite_z > 2.0:
            label = "High Confidence Stress"
            score = 0.9
        elif is_anomaly and composite_z > 1.0:
            label = "Pre-Stress (Digital Phenotype detected)"
            score = 0.6
        elif composite_z > 2.0:
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