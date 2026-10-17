import numpy as np
import joblib
import os
from collections import deque
from backend.phenotyping_behavior.ema_service import calculate_z_score

# --- PATH SETUP ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Global fallback model (trained on all 20 Kaggle users pooled together)
GLOBAL_MODEL_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "models", "stress_engine.pkl"))
GLOBAL_SCALER_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "models", "feature_scaler.pkl"))
# Directory where personalized per-user models are saved by /behavior/calibrate
PERSONAL_MODELS_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "phenotyping", "models", "personalized"))

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
        # ── Load global fallback model ────────────────────────────────────────
        print(f"[INFO] Initializing Production Brain: {GLOBAL_MODEL_PATH}")
        try:
            self.global_model = joblib.load(GLOBAL_MODEL_PATH)
            print("[OK] Global OC-SVM model loaded successfully")
        except Exception as e:
            print(f"[WARN] Could not load global model. Error: {e}")
            self.global_model = None

        # v4.1: Load the StandardScaler fitted on Kaggle Mobile Behavioral Biometrics
        # data (20 participants, real touchscreen: dwell/flight/scroll/tilt/cpm).
        # This scaler transforms raw values to mean=0, std=1 so the OC-SVM
        # boundary works on relative deviations, not absolute values.
        try:
            self.global_scaler = joblib.load(GLOBAL_SCALER_PATH)
            n_feats = len(self.global_scaler.mean_)
            print(f"[OK] Global scaler loaded ({n_feats} features)")
        except Exception as e:
            print(f"[WARN] Could not load global scaler. Error: {e}")
            self.global_scaler = None

        # v4.1: Cache for personalized per-user models (lazy-loaded on first predict)
        self._personal_models = {}   # user_id -> (model, scaler)

        # v3.2: Per-user rolling buffer of "in escalation band" flags, for
        # DriftTrendAnalyzer-style temporal confirmation (see DRIFT_CONFIRM_
        # WINDOWS above). In-memory only — resets on process restart.
        self._drift_buffers = {}

    def _get_user_model(self, user_id):
        """
        v4.1: Returns (model, scaler) for the given user. Checks for a
        personalized model first; if not found, falls back to the global model.
        Personalized models are cached in memory after first load.
        """
        if user_id in self._personal_models:
            return self._personal_models[user_id]

        # Check if personalized model exists on disk
        user_model_path = os.path.join(PERSONAL_MODELS_DIR, f"{user_id}_model.pkl")
        user_scaler_path = os.path.join(PERSONAL_MODELS_DIR, f"{user_id}_scaler.pkl")

        if os.path.exists(user_model_path) and os.path.exists(user_scaler_path):
            try:
                model = joblib.load(user_model_path)
                scaler = joblib.load(user_scaler_path)
                self._personal_models[user_id] = (model, scaler)
                print(f"[OK] Loaded personalized model for {user_id}")
                return (model, scaler)
            except Exception as e:
                print(f"[WARN] Failed to load personalized model for {user_id}: {e}")

        # Fallback to global
        return (self.global_model, self.global_scaler)

    def predict(self, firebase_metrics, user_baselines, user_id=None):
        """
        Decision Logic: Maps Android Sensors to Deployed Model Features.
        v4.1: Uses 5 features (dwell, flight, scroll, tilt, cpm) and loads
              a personalized per-user OC-SVM if available (trained by /calibrate).
              Falls back to the global 5-feature model otherwise.
        v3.2: user_id (optional) enables temporal drift confirmation — pass
              it to gate "Pre-Stress" behind DRIFT_CONFIRM_WINDOWS consecutive
              escalated windows instead of a single noisy one.
        """
        # Select model (personalized or global)
        model, scaler = self._get_user_model(user_id) if user_id else (self.global_model, self.global_scaler)

        if not model:
            return {"label": "Error", "score": 0.0, "confidence": 0.0, "is_anomaly": False}

        if not user_baselines:
            user_baselines = {}

        # 1. Feature Mapping (Android -> Deployed Model logic)
        # v4.1: 5 features — dwell, flight, scroll, tilt, cpm
        dwell_time      = float(firebase_metrics.get('avg_dwell', 0))
        flight_time     = float(firebase_metrics.get('avg_flight', 0))
        scroll_velocity = float(firebase_metrics.get('scroll_velocity', 0))
        cpm             = float(firebase_metrics.get('cpm', 0))

        # Tilt baseline (needed here, ahead of the other baselines below, as
        # the fallback value for a not-yet-available reading -- see tilt_angle).
        mean_tilt = user_baselines.get('tilt_angle', {}).get('mean', 59.09)
        std_tilt  = user_baselines.get('tilt_angle', {}).get('std',   8.0)

        # tilt_angle is JSON null when KeystrokeCollectorService.java's
        # accelerometer gravity filter hasn't warmed up yet (common right
        # after the service starts). `.get(key, default)` only applies the
        # default when the key is ABSENT, not when it's present with value
        # None, so `float(firebase_metrics.get('tilt_angle', 0))` would raise
        # TypeError on this. Substituting the baseline mean here reads as "no
        # deviation yet" (z_tilt below comes out ~0) instead of crashing, or
        # worse, silently defaulting to 0 -- which would read as a huge false
        # deviation against a real baseline mean of ~59 degrees.
        tilt_raw   = firebase_metrics.get('tilt_angle')
        tilt_angle = float(tilt_raw) if tilt_raw is not None else mean_tilt

        # Pre-fetch keystroke baselines needed both for OC-SVM zero-substitution
        # (step 1b) and for Z-score validation (step 3).
        mean_dwell  = user_baselines.get('avg_dwell',       {}).get('mean', 145)
        std_dwell   = user_baselines.get('avg_dwell',       {}).get('std',   30)
        mean_flight = user_baselines.get('avg_flight',      {}).get('mean', 225)
        std_flight  = user_baselines.get('avg_flight',      {}).get('std',   45)
        mean_scroll = user_baselines.get('scroll_velocity', {}).get('mean', 450)
        std_scroll  = user_baselines.get('scroll_velocity', {}).get('std',  200)
        mean_cpm    = user_baselines.get('cpm',             {}).get('mean', 39.40)
        std_cpm     = user_baselines.get('cpm',             {}).get('std',   9.0)

        # 1b. Zero-signal substitution for OC-SVM input.
        # PROBLEM: The AccessibilityService records dwell/flight/cpm as 0 in
        # scroll-only windows (the user scrolled but didn't type). Feeding 0 into
        # the OC-SVM produces a scaled value of (0 - 145) / 30 = -4.8 for dwell,
        # which lands far outside the normal cloud -> guaranteed anomaly -> false
        # "High Confidence Stress" from every non-typing window.
        # FIX: substitute the user's personal baseline mean when a feature is 0
        # (meaning "no signal", not "abnormally fast"). This gives z ~ 0 for that
        # feature in the OC-SVM, which is the correct interpretation.
        # The REAL zero-signal detection for Z-score computation is done in step 3
        # by simply excluding missing features from the composite.
        dwell_for_svm  = dwell_time  if dwell_time  > 0 else mean_dwell
        flight_for_svm = flight_time if flight_time > 0 else mean_flight
        scroll_for_svm = scroll_velocity if scroll_velocity > 0 else mean_scroll
        cpm_for_svm    = cpm         if cpm         > 0 else mean_cpm

        feat_array = np.array([[dwell_for_svm, flight_for_svm, scroll_for_svm, tilt_angle, cpm_for_svm]])

        # 2. Anomaly Detection (Objective 1 Winner)
        # Scale features BEFORE prediction so the OC-SVM sees the same
        # distribution it was trained on (mean=0, std=1 per feature).
        if scaler:
            feat_scaled = scaler.transform(feat_array)
        else:
            feat_scaled = feat_array  # Fallback if scaler not available

        # Output: 1 (Normal), -1 (Anomaly/Stress)
        model_prediction = model.predict(feat_scaled)[0]
        is_anomaly = bool(model_prediction == -1)

        # 3. Z-Score Validation — Multi-Feature Composite (Idiographic Baseline)
        # v4.2: Only include features that have a real signal (non-zero).
        # A scroll-only window has dwell=0, flight=0, cpm=0 — including those
        # features in the composite would compute z = (0-145)/30 = -4.8 for each,
        # inflating composite_z and triggering false Pre-Stress/High Confidence Stress.
        # Calibration and the baseline updater already filter out zero-signal
        # windows; the predictor must apply the same logic here.
        #
        # Tilt is always present (substituted with baseline mean when null, z ~ 0).
        z_tilt_raw = abs(calculate_z_score(tilt_angle, mean_tilt, std_tilt))
        # If no typing occurred this window (scroll-only), tilt alone must not
        # escalate to extreme stress (>2.0) simply because the phone was held upright.
        z_tilt = min(z_tilt_raw, 2.0) if (dwell_time <= 0 and flight_time <= 0 and cpm <= 0) else z_tilt_raw
        z_scores = {'tilt': z_tilt}

        if dwell_time > 0:
            z_scores['dwell'] = abs(calculate_z_score(dwell_time, mean_dwell, std_dwell))
        if flight_time > 0:
            z_scores['flight'] = abs(calculate_z_score(flight_time, mean_flight, std_flight))
        if scroll_velocity > 0:
            z_scores['scroll'] = abs(calculate_z_score(scroll_velocity, mean_scroll, std_scroll))
        if cpm > 0:
            z_scores['cpm'] = abs(calculate_z_score(cpm, mean_cpm, std_cpm))

        # Composite Z-score: average over present features only
        composite_z = round(sum(z_scores.values()) / len(z_scores), 4)

        # Expose individual z-scores for debugging/logging (0.0 when feature absent)
        z_dwell  = z_scores.get('dwell',  0.0)
        z_flight = z_scores.get('flight', 0.0)
        z_scroll = z_scores.get('scroll', 0.0)
        z_tilt   = z_scores.get('tilt',   0.0)
        z_cpm    = z_scores.get('cpm',    0.0)


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
        # The buffer is persisted to Firebase (phenotyping/drift_state/{user_id})
        # so it survives Render cold starts / deploys — preventing the confirmation
        # counter from silently resetting to 0 mid-session.
        if user_id is not None:
            is_escalation_band = 1.0 < composite_z <= 2.0
            if user_id not in self._drift_buffers:
                # First time seeing this user this process — restore from Firebase
                try:
                    from firebase_admin import db as fb_db
                    saved = fb_db.reference(f"phenotyping/drift_state/{user_id}").get()
                    if saved and isinstance(saved, list):
                        restored = deque(saved[-DRIFT_CONFIRM_WINDOWS:], maxlen=DRIFT_CONFIRM_WINDOWS)
                        self._drift_buffers[user_id] = restored
                        print(f"[drift] Restored buffer for {user_id}: {list(restored)}")
                    else:
                        self._drift_buffers[user_id] = deque(maxlen=DRIFT_CONFIRM_WINDOWS)
                except Exception as e:
                    print(f"[drift] Could not restore buffer for {user_id}: {e}")
                    self._drift_buffers[user_id] = deque(maxlen=DRIFT_CONFIRM_WINDOWS)
            buf = self._drift_buffers[user_id]
            buf.append(is_escalation_band)
            # Persist updated buffer to Firebase (non-blocking best-effort)
            try:
                from firebase_admin import db as fb_db
                fb_db.reference(f"phenotyping/drift_state/{user_id}").set(list(buf))
            except Exception:
                pass  # non-critical — in-memory buffer still works
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
        decision = float(model.decision_function(feat_scaled)[0])
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

        # 7. Signal Quality
        # Computed same as fusion engine: fraction of the 3 primary OC-SVM inputs present
        has_dwell  = dwell_time > 0
        has_flight = flight_time > 0
        has_scroll = scroll_velocity > 0
        signal_quality = round((int(has_dwell) + int(has_flight) + int(has_scroll)) / 3.0, 2)
        if not firebase_metrics.get('data_valid', True):
            signal_quality = round(signal_quality * 0.5, 2)

        return {
            "label":            label,
            "score":            score,
            "confidence":       confidence,
            "signal_quality":   signal_quality,
            "composite_z":      composite_z,
            "z_dwell":          round(z_dwell, 4),
            "z_flight":         round(z_flight, 4),
            "z_scroll":         round(z_scroll, 4),
            "z_tilt":           round(z_tilt, 4),
            "z_cpm":            round(z_cpm, 4),
            "raw_dwell":        dwell_time,
            "raw_flight":       flight_time,
            "raw_scroll":       scroll_velocity,
            "raw_tilt":         tilt_angle,
            "raw_cpm":          cpm,
            "is_anomaly":       is_anomaly,
            "model_type":       "personalized" if user_id and user_id in self._personal_models else "global",
            "phenotype_metric": "Composite (Dwell + Flight + Scroll + Tilt + CPM)"
        }

predictor = StressPredictor()