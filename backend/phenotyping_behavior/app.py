from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import joblib
import sys
import os
from pathlib import Path
from sklearn.svm import OneClassSVM
from sklearn.preprocessing import StandardScaler


# --- MODULE PATH FIX ---
if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

# Import your local services
from backend.phenotyping_behavior.firebase_service import (
    init_firebase, save_behavioral_window, get_user_baselines,
    save_stress_prediction, save_validation_label,
    get_latest_stress_prediction,             # T7-B: neuroadaptive bridge
    get_calibration_windows,                  # Objective 2: 7-day baseline
    set_user_calibration_status, create_user_profile,
    save_to_fusion_engine,                    # legacy fusion_engine table
    save_fusion_en_rtdb                       # fusion_en -- what fusion_engin.py/
                                               # fusion_live_session.py actually poll
)
from backend.phenotyping_behavior.predictor import predictor
from backend.phenotyping_behavior.ema_service import update_personalized_baseline

app = Flask(__name__)
CORS(app)

REFERENCE_BASELINES = {
    'avg_dwell':        {'mean': 88.246993,   'std': 31.837077},
    'dwell_std':        {'mean': 53.094011,   'std': 21.784443},
    'avg_flight':       {'mean': 220.281697,  'std': 79.034951},
    'flight_std':       {'mean': 132.677431,  'std': 54.43413},
    'interaction_rate': {'mean': 0.754617,    'std': 3.987897},
    'scroll_velocity':  {'mean': 1425.401759, 'std': 6497.52037},
    'tilt_angle':       {'mean': 59.0,        'std': 15.0},
    'cpm':              {'mean': 39.0,        'std': 12.0},
    'app_switch_rate':  {'mean': 0.019252,    'std': 0.200632},
}

def auto_seed_baseline(user_id):
    """If user has no baselines, seed the reference baseline and mark calibrated."""
    existing = get_user_baselines(user_id)
    if existing:
        return existing  # already has baselines
    print(f"[AUTO-SEED] {user_id}: No baselines found — seeding reference baseline")
    # Use .update() so we ONLY write baselines + calibration flag
    # without overwriting the user's display_name or other profile fields.
    from backend.phenotyping_behavior.firebase_service import _ref
    _ref(f'users/{user_id}').update({
        'baselines': REFERENCE_BASELINES,
        'is_calibrated': True,
        'calibrated_at': __import__('datetime').datetime.now().isoformat(),
    })
    print(f"[AUTO-SEED] {user_id}: Baseline seeded + is_calibrated=true")
    return REFERENCE_BASELINES

# Initialize Firebase on startup
init_firebase()

@app.route('/behavior/predict', methods=['POST'])
def predict_behavioral_stress():
    """
    Endpoint for Objective 3: Real-time Behavioral Inference.
    Handles Category A Features (Dwell, Flight, Interaction).
    """
    data = request.json
    user_id = data.get('user_id')
    # Required for fusion_en (user_id/session_id/window-keyed, matching the
    # EEG and HRV/GSR writers) -- see save_fusion_en_rtdb(), which just skips
    # that write (logging a warning) if this is missing, same as before this
    # field existed.
    session_id = data.get('session_id')

    # 1. Aggregation Logic (Custom Keyboard Data)
    # The phone sends raw arrays of timing; we calculate window stats here
    raw_dwells = data.get('dwell_times', [])
    raw_flights = data.get('flight_times', [])
    
    # Calculate feature statistics safely (handles scrolling & app switching without typing)
    avg_dwell = float(np.mean(raw_dwells)) if len(raw_dwells) > 0 else 0.0
    dwell_std = float(np.std(raw_dwells)) if len(raw_dwells) > 0 else 0.0
    avg_flight = float(np.mean(raw_flights)) if len(raw_flights) > 0 else 0.0
    flight_std = float(np.std(raw_flights)) if len(raw_flights) > 0 else 0.0

    window_features = {
        'avg_dwell': avg_dwell,
        'dwell_std': dwell_std,
        'avg_flight': avg_flight,
        'flight_std': flight_std,
        'interaction_rate': data.get('interaction_rate', 0),
        'scroll_velocity': data.get('scroll_velocity', 0),
        'tilt_angle': data.get('tilt_angle', 0),
        'cpm': data.get('cpm', 0),
        'app_switch_rate': data.get('app_switch_rate', 0),
        'unlocks_count': data.get('unlocks_count', 0)
    }

    # 2. Context Filtering (Variable #25)
    # If walking or gaming, we mark data as invalid for baseline training
    is_valid = data.get('data_valid', True)

    # 3. Get Personalized Baseline (Objective 2)
    # Auto-seeds reference baseline for new users with no baselines
    baselines = get_user_baselines(user_id)
    if not baselines:
        baselines = auto_seed_baseline(user_id)

    # 4. Perform Inference (Objective 1 Model)
    # user_id enables temporal drift confirmation (see predictor.py step 4b)
    result = predictor.predict(window_features, baselines, user_id)

    # 5. Save Results to Firebase
    window_data = {**window_features, 'data_valid': is_valid}
    save_behavioral_window(user_id, window_data)
    save_stress_prediction(user_id, result)

    # 5b. Write to shared fusion_engine table (legacy path, kept running
    #     alongside 5c for whatever else may still read it)
    #     Creates: fusion_engine/{display_name}/live_session_{YYYYMMDD}/{push-key}
    #     Fields: label, modality, prob_stress, prob_normal, confidence,
    #             signal_quality, model_accuracy, composite_z, timestamp
    try:
        save_to_fusion_engine(user_id, result, window_features, is_valid)
    except Exception as fe:
        print(f"[WARN] fusion_engine write failed (non-critical): {fe}")

    # 5c. Write to fusion_en -- the path fusion_engin.py's MODALITIES and
    #     fusion_live_session.py's live poll loop actually read for the
    #     "behav" modality (see save_fusion_en_rtdb()'s docstring).
    try:
        save_fusion_en_rtdb(user_id, session_id, result, window_features, is_valid)
    except Exception as fe:
        print(f"[WARN] fusion_en write failed (non-critical): {fe}")

    # Only update if the window is Normal AND the context is valid
    if not result['is_anomaly'] and is_valid:
        update_personalized_baseline(user_id, window_features, False)

    return jsonify({
        "status": "success",
        "prediction": result['label'],
        "severity": result['score']
    })

@app.route('/behavior/label', methods=['POST'])
def submit_label():
    """
    Endpoint for Ground Truth Collection (Validation).
    Receives PSS-4 or SISS scores.
    """
    data = request.json
    user_id = data.get('user_id')
    label_type = data.get('type') # 'pss4' or 'siss'
    score = data.get('score')
    
    save_validation_label(user_id, label_type, score)
    return jsonify({"status": "label saved"})
 
 
@app.route('/behavior/stress-summary', methods=['GET'])
def stress_summary():
    """
    T7-B: Neuroadaptive Integration Bridge.

    Called by the team's neuroadaptive guidance module to get the current
    behavioral stress state for a given user. This is the handshake point
    between the Behavioral Digital Phenotyping module (R26-DS-016) and the
    Downstream modules (e.g. Multimodal Fusion / Analytics).

    Usage:
        GET /behavior/stress-summary?user_id=chathurika_001

    Response (stress detected):
        {
            "user_id": "chathurika_001",
            "stress_level": "elevated",       # "normal" | "elevated" | "high"
            "stress_score": 0.6,              # 0.0 – 1.0
            "label": "Pre-Stress (Digital Phenotype detected)",
            "is_anomaly": true,
            "timestamp": "2026-08-02T14:30:00",
            "source": "behavioral_phenotyping"
        }

    Response (no data yet):
        { "user_id": "...", "stress_level": "unknown", "stress_score": null }
    """
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({"error": "user_id query param required"}), 400

    latest = get_latest_stress_prediction(user_id)

    if not latest:
        return jsonify({
            "user_id":        user_id,
            "stress_level":   "unknown",
            "stress_score":   None,
            "source":         "behavioral_phenotyping"
        })

    score = latest.get('stress_score', 0.0)
    label = latest.get('label', 'Normal')
    is_anomaly = latest.get('is_anomaly', False)

    # Map to a simple 3-tier level using `label` as the single source of truth,
    # NOT by re-thresholding `score`.
    #
    # `label` and `score` come from two different transforms of the same
    # underlying signals in predictor.py (label = discrete AND-gated rule on
    # is_anomaly + composite_z; score = continuous logistic blend of the same
    # two signals — see predictor.py step 5). Since v3.1, `score` is a real
    # continuous probability rather than a value that always lands exactly on
    # 0.9/0.6/0.1, so score-threshold bands can occasionally disagree with
    # label at the margins (e.g. composite_z just above 1.0 can score in the
    # high-0.3s, just under an "elevated" score cutoff, while label already
    # says Pre-Stress). `label` carries the deliberate AND-gate design meant
    # to avoid false positives, so tier follows it; `score` is still
    # returned below as the continuous magnitude for downstream consumers
    # that want finer-grained fusion (e.g. fusion_engine's prob_stress).
    if label == "High Confidence Stress":
        stress_level = "high"
    elif label.startswith("Pre-Stress"):
        stress_level = "elevated"
    else:
        stress_level = "normal"

    return jsonify({
        "user_id":            user_id,
        "stress_level":       stress_level,
        "stress_score":       round(score, 3),
        "label":              label,
        "is_anomaly":         is_anomaly,
        "timestamp":          latest.get('timestamp'),
        "source":             "behavioral_phenotyping"
    })

@app.route('/behavior/calibrate', methods=['POST'])
def calibrate_baseline():
    """
    Objective 2: Automatic 7-Day Baseline Initializer.

    Triggered after a participant completes the 7-day onboarding period.
    Reads ALL valid behavioral windows stored in Firebase for the user,
    computes the idiographic mean and std for every feature, and writes
    the resulting profile as the user's permanent personal baseline.

    After this endpoint runs successfully the user's profile is set to
    is_calibrated = True and EMA continual learning becomes active.

    Body (JSON):
        {
            "user_id": "chathurika_001",
            "name":    "Chathurika"          # optional, stored on first call
            "min_windows": 50               # optional override (default 50 test / 200 production)
        }

    Response (success):
        {
            "status": "calibrated",
            "window_count": 214,
            "baselines": { "avg_dwell": {"mean": 0.12, "std": 0.03}, ... }
        }

    Response (not enough data yet):
        { "status": "insufficient_data", "window_count": 37, "required": 50 }
    """
    data = request.json or {}
    user_id   = data.get('user_id')
    name      = data.get('name', user_id)
    # Use 50 as default for testing; bump to 200 for the real 28-day trial
    min_windows = int(data.get('min_windows', 50))

    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    # ── 1. Fetch all valid calibration windows from Firebase ──────────────────
    windows = get_calibration_windows(user_id)
    window_count = len(windows)

    if window_count < min_windows:
        return jsonify({
            "status":       "insufficient_data",
            "window_count": window_count,
            "required":     min_windows,
            "message":      f"Need {min_windows - window_count} more valid windows before calibration."
        }), 422

    # ── 2. Compute per-feature idiographic mean & std ─────────────────────────
    feature_keys = [
        'avg_dwell', 'dwell_std',
        'avg_flight', 'flight_std',
        'interaction_rate', 'scroll_velocity',
        'tilt_angle', 'cpm', 'app_switch_rate'
    ]

    baselines = {}
    for feature in feature_keys:
        values = [
            float(w[feature])
            for w in windows
            if feature in w and w[feature] is not None
        ]
        if len(values) >= 3:   # need at least 3 samples for a meaningful std
            baselines[feature] = {
                'mean': round(float(np.mean(values)), 6),
                'std':  round(float(max(np.std(values), 0.001)), 6)  # floor at 0.001
            }
        else:
            # Feature rarely collected — use a safe population default
            baselines[feature] = {'mean': 0.0, 'std': 1.0}

    # ── 3. Write the initial baseline profile & mark user as calibrated ────────
    create_user_profile(user_id, name, baselines)
    set_user_calibration_status(user_id, is_calibrated=True, window_count=window_count)

    # ── 4. Train Personalized OC-SVM on this user's calibration data ──────────
    # v4.1: Instead of relying solely on the global 20-user model, we train a
    # personal OC-SVM fitted ONLY on this user's normal typing. This is the
    # single most impactful change for accuracy: per-user models consistently
    # outperform population models in all research phases (SWELL F1=0.72 vs
    # pooled accuracy=0.49). The global model remains as a fallback.
    personal_model_msg = "skipped"
    try:
        # Extract the 5 features the model consumes from calibration windows
        model_features = ['avg_dwell', 'avg_flight', 'scroll_velocity', 'tilt_angle', 'cpm']
        # Population defaults for imputation (from Kaggle Mobile stats)
        pop_defaults = {'avg_dwell': 145, 'avg_flight': 230, 'scroll_velocity': 45, 'tilt_angle': 59.09, 'cpm': 39.40}

        rows = []
        for w in windows:
            row = [float(w.get(f, pop_defaults.get(f, 0)) or pop_defaults.get(f, 0)) for f in model_features]
            rows.append(row)

        if len(rows) >= 20:  # Need enough data for a meaningful personal boundary
            X_personal = np.array(rows)
            personal_scaler = StandardScaler()
            X_scaled = personal_scaler.fit_transform(X_personal)

            # Grid search for best nu (same approach as s8_deploy_production.py)
            best_nu, best_gamma = 0.05, 'scale'
            for nu_cand in [0.01, 0.03, 0.05, 0.08, 0.10, 0.15]:
                for gamma_cand in ['scale', 'auto', 0.01, 0.05, 0.1]:
                    clf = OneClassSVM(kernel='rbf', nu=nu_cand, gamma=gamma_cand).fit(X_scaled)
                    if (clf.predict(X_scaled) == 1).mean() >= (1.0 - nu_cand * 1.5):
                        best_nu = nu_cand
                        best_gamma = gamma_cand
                        break

            personal_model = OneClassSVM(kernel='rbf', nu=best_nu, gamma=best_gamma)
            personal_model.fit(X_scaled)

            # Save personalized model and scaler
            models_dir = os.path.abspath(os.path.join(
                os.path.dirname(__file__), '..', '..', 'phenotyping', 'models', 'personalized'
            ))
            os.makedirs(models_dir, exist_ok=True)
            joblib.dump(personal_model, os.path.join(models_dir, f"{user_id}_model.pkl"))
            joblib.dump(personal_scaler, os.path.join(models_dir, f"{user_id}_scaler.pkl"))

            # Invalidate predictor cache so it picks up the new model
            from backend.phenotyping_behavior.predictor import predictor as pred_instance
            if user_id in pred_instance._personal_models:
                del pred_instance._personal_models[user_id]

            personal_model_msg = f"trained (nu={best_nu}, gamma={best_gamma}, {len(rows)} samples)"
            print(f"[✅ PERSONAL MODEL] {user_id}: OC-SVM {personal_model_msg}")
        else:
            personal_model_msg = f"skipped (only {len(rows)} samples, need 20+)"
            print(f"[⚠️  PERSONAL MODEL] {user_id}: {personal_model_msg}")

    except Exception as e:
        personal_model_msg = f"failed ({e})"
        print(f"[WARN] Personal model training failed for {user_id}: {e}")

    print(f"[✅ CALIBRATE] {user_id} calibrated on {window_count} windows → {baselines}")

    return jsonify({
        "status":           "calibrated",
        "user_id":          user_id,
        "window_count":     window_count,
        "baselines":        baselines,
        "personal_model":   personal_model_msg
    })

@app.route('/behavior/evaluate', methods=['GET'])
def evaluate_accuracy_endpoint():
    """
    Objective 4: Live Accuracy & Validation Evaluation Suite.
    Evaluates both Subjective EMA Ground Truth (PSS-4/SISS) and Objective Multimodal Triangulation.

    Usage:
        GET /behavior/evaluate?user_id=<uuid>
        GET /behavior/evaluate?all=1         (evaluates all registered users)
    """
    user_id  = request.args.get('user_id')
    eval_all = request.args.get('all', '0') == '1'

    from evaluate_accuracy import init_firebase as _ef_init, run_evaluation, run_all_users, list_all_user_ids
    _ef_init()   # safe — no-op if already initialised

    if eval_all:
        results = run_all_users()
        return jsonify({"status": "success", "mode": "all_users", "results": results or {}})

    if not user_id:
        # Return list of known user IDs
        ids = list_all_user_ids()
        return jsonify({
            "status": "ok",
            "hint": "Pass ?user_id=<uuid> or ?all=1",
            "registered_users": ids
        })

    results = run_evaluation(user_id)
    return jsonify({"status": "success", "user_id": user_id, "results": results})


@app.route('/behavior/reference-baseline', methods=['GET'])
def reference_baseline():
    """
    Returns the population reference baseline used to auto-seed new users
    (see auto_seed_baseline()). This is the single source of truth for those
    numbers -- the frontend fetches from here instead of hardcoding its own
    copy, so recalibrating only requires updating REFERENCE_BASELINES above.
    """
    return jsonify({"baselines": REFERENCE_BASELINES})

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "Phenotyping Backend Online"})

if __name__ == '__main__':
    # Render.com injects $PORT — use it in production; default to 5001 locally.
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)