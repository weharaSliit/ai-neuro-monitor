from backend.phenotyping_behavior.ema_service import calculate_z_score

# The One-Class SVM formerly loaded here (phenotyping/models/stress_engine.pkl,
# built by phenotyping/s8_deploy_production.py) was fit on 500
# np.random.normal(loc=[120, 200, 45], scale=[15, 20, 5]) FAKE samples, not
# real behavioral data -- confirmed by inspecting its support vectors, which
# cluster exactly on that synthetic distribution. No real-data-trained
# replacement with the same (dwell_time, flight_time, scroll_velocity) raw-ms
# feature schema exists anywhere in the repo (the CMU/StudentLife research
# models use different feature counts/semantics and pre-normalized inputs;
# the raw datasets needed to retrain a compatible one aren't present either
# -- see phenotyping/research_v2_cmu, research_v3_studentlife, research_v4_swell).
#
# Classification below is therefore driven ENTIRELY by composite_z -- each
# user's real, idiographic baseline (mean/std of their own past windows,
# maintained by /behavior/calibrate + ema_service.py, no model file involved)
# -- rather than faking a same-shaped model to keep a two-signal blend that
# was never real to begin with. This is honest but weaker for a brand-new
# user with no calibrated baseline yet (see the class docstring below); it
# is NOT a stand-in for retraining a real population-level model once enough
# real Firebase-collected windows accumulate from the Android
# KeystrokeCollectorService.

class StressPredictor:
    """Idiographic-baseline-only stress classifier for the phenotyping
    (keystroke/scroll) modality. See module docstring for why this doesn't
    load a population-level model."""

    def predict(self, firebase_metrics, user_baselines):
        """
        Decision Logic: composite Z-score deviation from this user's own
        real, previously-calibrated baseline (no model file involved).
        """
        if not user_baselines:
            user_baselines = {}

        dwell_time = float(firebase_metrics.get('avg_dwell', 0))
        flight_time = float(firebase_metrics.get('avg_flight', 0))
        scroll_velocity = float(firebase_metrics.get('scroll_velocity', 0))

        # Z-Score Validation — Multi-Feature Composite (Idiographic Baseline)
        # Research Gap 4: we check how far ALL three key signals deviate from
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

        # Final Stress Classification -- composite Z-score alone (same
        # thresholds the old model+z blend used for its z-only branches).
        is_anomaly = composite_z > 1.5
        if composite_z > 2.0:
            label = "High Confidence Stress"
            score = 0.9
        elif is_anomaly:
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