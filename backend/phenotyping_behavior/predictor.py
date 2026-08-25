import numpy as np
import joblib
import os
from collections import deque
from backend.phenotyping_behavior.ema_service import calculate_z_score

# --- PATH SETUP ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Updated to point to the Step 8 Production Model
MODEL_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "models", "stress_engine.pkl"))
# v3.0: StandardScaler saved by s8_deploy_production.py
SCALER_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "models", "feature_scaler.pkl"))

# v3.1: Continuous probability blend weights (see predict() step 5).
# Reasonable defaults chosen without labeled ground truth; retune with
# evaluate_accuracy.py once enough PSS-4/SISS validation samples exist.
# NOTE on SVM_STEEPNESS: decision_function() magnitude is NOT bounded like a
# margin in [-1,1] — for RBF OC-SVM it can range from single digits to the
# hundreds depending on how far a point sits from the training distribution
# (observed range in manual testing: +3 for a near-boundary point to -86 for
# a far outlier). 0.05 keeps the sigmoid from saturating to a hard 0/1 across
# that whole observed range, so svm_term stays genuinely graded.
SVM_STEEPNESS = 0.05  # sigmoid steepness applied to OC-SVM decision_function()
Z_CENTER      = 1.5   # composite_z midpoint between Elevated (1.0) and Pre-Stress (2.0)

# v3.2: Temporal drift confirmation — ported from
# phenotyping/research_v5_continual_learning/src/s4_drift_trend_analyzer.py's
# DriftTrendAnalyzer, which was designed and validated in a standalone
# simulation but never wired into production. A single noisy window landing
# in the Pre-Stress escalation band (composite_z in (1.0, 2.0]) can be one-off
# sensor/typing noise; require it to persist across DRIFT_CONFIRM_WINDOWS
# consecutive windows before actually reporting "Pre-Stress" to the user.
# "High Confidence Stress" (composite_z > 2.0 AND is_anomaly) bypasses this
# entirely — an extreme single-window deviation is reported immediately,
# mirroring DriftTrendAnalyzer's separate immediate PEAK_STRESS_ANOMALY path.
DRIFT_CONFIRM_WINDOWS = 3

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

        # v3.2: Per-user rolling buffer of "in escalation band" flags, for
        # DriftTrendAnalyzer-style temporal confirmation (see DRIFT_CONFIRM_
        # WINDOWS above). In-memory only — resets on process restart (e.g.
        # Render.com free-tier sleep/wake) and is NOT shared across multiple
        # worker processes if the backend ever scales beyond one. Acceptable
        # for now since the whole point is debouncing noise within a single
        # live session; move this to Firebase-backed storage (a short rolling
        # history under data_logs) if multi-worker deployment or restart
        # persistence becomes necessary.
        self._drift_buffers = {}

    def predict(self, firebase_metrics, user_baselines, user_id=None):
        """
        Decision Logic: Maps Android Sensors to Deployed Model Features.
        v3.0: Applies StandardScaler before OC-SVM prediction so that
              both desktop (CMU) and phone users are on the same scale.
        v3.2: user_id (optional) enables temporal drift confirmation — pass
              it to gate "Pre-Stress" behind DRIFT_CONFIRM_WINDOWS consecutive
              escalated windows instead of a single noisy one.
        """
        if not self.model:
            return {"label": "Error", "score": 0.0, "confidence": 0.0, "is_anomaly": False}
            
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

        # 4. Final Stress Label (Dual-Layer Gate) — explainable, rule-based
        # v3.0 FIX: Changed from OR to AND for Pre-Stress.
        # Rationale: After 7-day calibration, a phone user's normal typing (145ms)
        # differs from CMU desktop data (89ms), so the OC-SVM may flag them as anomaly.
        # But their personal Z-Score (composite_z) would be ~0.0 (perfectly normal).
        # Using AND ensures BOTH layers must agree before triggering Pre-Stress.
        #
        # Decision matrix (label only — NOT the probability, see step 5):
        #   OC-SVM=Anomaly AND Z>2.0  -> High Stress    (both layers agree strongly)
        #   OC-SVM=Anomaly AND Z>1.0  -> Pre-Stress     (both layers agree)
        #   Z>2.0 (any OC-SVM)        -> Pre-Stress     (personal drift alone is enough)
        #   else                       -> Normal
        if is_anomaly and composite_z > 2.0:
            label = "High Confidence Stress"
        elif is_anomaly and composite_z > 1.0:
            label = "Pre-Stress (Digital Phenotype detected)"
        elif composite_z > 2.0:
            label = "Pre-Stress (Digital Phenotype detected)"
        else:
            label = "Normal"

        # 4b. Temporal Drift Confirmation (see DRIFT_CONFIRM_WINDOWS above).
        # "Pre-Stress" only survives if the last DRIFT_CONFIRM_WINDOWS windows
        # were ALL in the escalation band (1.0 < composite_z <= 2.0) — a
        # single elevated window gets reported as "Normal" instead until it
        # persists. "High Confidence Stress" is never downgraded here.
        if user_id is not None:
            is_escalation_band = 1.0 < composite_z <= 2.0
            buf = self._drift_buffers.setdefault(user_id, deque(maxlen=DRIFT_CONFIRM_WINDOWS))
            buf.append(is_escalation_band)
            if label == "Pre-Stress (Digital Phenotype detected)":
                if not (len(buf) == DRIFT_CONFIRM_WINDOWS and all(buf)):
                    label = "Normal"

        # 5. Continuous Stress Probability — model-derived, NOT a hardcoded constant.
        # PREVIOUSLY: `score` was one of three literal numbers (0.9/0.6/0.1) picked
        # by which if/elif branch above fired. Integration partners consume this
        # value as `prob_stress` in the shared fusion_engine table, expecting a real
        # probabilistic signal comparable to their model's predict_proba() output —
        # not a 3-value rule-based label dressed up as a float.
        #
        # FIX: derive score from two continuous signals the model/user data actually
        # produce, each squashed through a logistic function into [0, 1]:
        #   z_term   -> composite_z (this user's PERSONAL deviation), centered at
        #               Z_CENTER so 0.5 sits between the Elevated and Pre-Stress
        #               thresholds. This is the PRIMARY driver of the probability —
        #               it's the idiographic signal this whole project is built on.
        #   svm_term -> OC-SVM's own decision_function(): signed distance from the
        #               learned population boundary (more negative = more
        #               anomalous). This is the model's real confidence signal,
        #               previously unused entirely.
        #
        # z_term and svm_term are combined MULTIPLICATIVELY, not averaged:
        #   score = z_term * (0.5 + 0.5 * svm_term)
        # svm_term only ever modulates z_term within a [0.5x, 1.0x] range — it can
        # dampen the score toward half, or boost it toward full, but can never by
        # itself push a personally-calm user (low z_term) into a high score. This
        # mirrors why the label logic above uses AND rather than OR: a user whose
        # typing differs from the CMU population but matches their OWN baseline
        # (composite_z ~ 0) must not be flagged as stressed just because the
        # population-level OC-SVM disagrees with their idiographic norm. A naive
        # average of the two terms was tested and DOES produce that false positive
        # (a user sitting exactly at their calibrated baseline scored 0.59 — above
        # the 0.5 guidance-trigger threshold); the multiplicative form does not.
        decision = float(self.model.decision_function(feat_scaled)[0])
        svm_term = 1.0 / (1.0 + np.exp(SVM_STEEPNESS * decision))
        z_term   = 1.0 / (1.0 + np.exp(-(composite_z - Z_CENTER)))
        score    = round(float(z_term * (0.5 + 0.5 * svm_term)), 4)

        # 6. Confidence — how far THIS probability is from the point of
        # maximum uncertainty (0.5), rather than a second hand-tuned formula.
        # PREVIOUSLY (in firebase_service.py) confidence was computed from
        # composite_z alone, through separate hardcoded divisors (/6.0, /4.0)
        # that duplicated information `score` already encodes and ignored the
        # OC-SVM signal entirely. Deriving it from `score` instead means: one
        # signal (score) drives both "what's the probability" and "how sure
        # are we" — score=0.5 (fully ambiguous) -> confidence=0.5 (floor);
        # score near 0 or 1 (clearly one class or the other) -> confidence
        # near 1.0. No separate constants to justify or maintain.
        confidence = round(float(0.5 + abs(score - 0.5)), 4)

        return {
            "label":            label,
            "score":            score,
            "confidence":       confidence,
            "composite_z":      composite_z,
            "z_dwell":          round(z_dwell, 4),
            "z_flight":         round(z_flight, 4),
            "z_scroll":         round(z_scroll, 4),
            "is_anomaly":       is_anomaly,
            "phenotype_metric": "Composite (Dwell + Flight + Scroll)"
        }

predictor = StressPredictor()