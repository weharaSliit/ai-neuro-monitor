from flask import Flask, request, jsonify, g
from flask_cors import CORS
import numpy as np
import sys
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.phenotyping_behavior.firebase_service import (
    init_firebase, save_behavioral_window, get_user_baselines,
    save_stress_prediction, save_validation_label,
    get_latest_stress_prediction,             # T7-B: neuroadaptive bridge
    get_calibration_windows,                  # Objective 2: 7-day baseline
    set_user_calibration_status, create_user_profile
)
from backend.phenotyping_behavior.predictor import predictor
from backend.phenotyping_behavior.ema_service import update_personalized_baseline
from backend.common.auth import require_auth

app = Flask(__name__)
CORS(app)

# Initialize Firebase on startup
init_firebase()

@app.route('/behavior/predict', methods=['POST'])
@require_auth
def predict_behavioral_stress():
    data = request.json
    user_id = g.user_id

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
        'app_switch_rate': data.get('app_switch_rate', 0)
    }

    # 2. Context Filtering (Variable #25)
    # If walking or gaming, we mark data as invalid for baseline training
    is_valid = data.get('data_valid', True)

    # 3. Get Personalized Baseline (Objective 2)
    baselines = get_user_baselines(user_id)
    
    # 4. Perform Inference (Objective 1 Model)
    result = predictor.predict(window_features, baselines)

    # 5. Save Results to Firebase
    window_data = {**window_features, 'data_valid': is_valid}
    save_behavioral_window(user_id, window_data)
    save_stress_prediction(user_id, result)

    # 6. Continual Learning (Gap 3: EMA Update)
    # Only update if the window is Normal AND the context is valid
    if not result['is_anomaly'] and is_valid:
        update_personalized_baseline(user_id, window_features, False)

    return jsonify({
        "status": "success",
        "prediction": result['label'],
        "severity": result['score']
    })

@app.route('/behavior/label', methods=['POST'])
@require_auth
def submit_label():
    """
    Endpoint for Ground Truth Collection (Validation).
    Receives PSS-4 or SISS scores.
    """
    data = request.json
    user_id = g.user_id
    label_type = data.get('type') # 'pss4' or 'siss'
    score = data.get('score')
    
    save_validation_label(user_id, label_type, score)
    return jsonify({"status": "label saved"})
 
 
@app.route('/behavior/stress-summary', methods=['GET'])
@require_auth
def stress_summary():
    user_id = g.user_id

    latest = get_latest_stress_prediction(user_id)

    if not latest:
        return jsonify({
            "user_id":        user_id,
            "stress_level":   "unknown",
            "stress_score":   None,
            "trigger_guidance": False,
            "source":         "behavioral_phenotyping"
        })

    score = latest.get('stress_score', 0.0)
    label = latest.get('label', 'Normal')
    is_anomaly = latest.get('is_anomaly', False)

    # Map score to a simple 3-tier level for the neuroadaptive module
    if score >= 0.7:
        stress_level = "high"
    elif score >= 0.4:
        stress_level = "elevated"
    else:
        stress_level = "normal"

    # Decide whether to trigger guidance and what type
    trigger_guidance = score > 0.5
    if score >= 0.7:
        recommended_action = "mindfulness"  # high stress → deeper intervention
    elif score >= 0.5:
        recommended_action = "breathing"    # pre-stress → box breathing
    else:
        recommended_action = "none"

    return jsonify({
        "user_id":            user_id,
        "stress_level":       stress_level,
        "stress_score":       round(score, 3),
        "label":              label,
        "is_anomaly":         is_anomaly,
        "trigger_guidance":   trigger_guidance,
        "recommended_action": recommended_action,
        "timestamp":          latest.get('timestamp'),
        "source":             "behavioral_phenotyping"
    })

@app.route('/behavior/calibrate', methods=['POST'])
@require_auth
def calibrate_baseline():
    data = request.json or {}
    user_id   = g.user_id
    name      = data.get('name', user_id)
    # Use 50 as default for testing; bump to 200 for the real 28-day trial
    min_windows = int(data.get('min_windows', 50))

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
        'interaction_rate', 'scroll_velocity', 'app_switch_rate'
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

    print(f"[✅ CALIBRATE] {user_id} calibrated on {window_count} windows → {baselines}")

    return jsonify({
        "status":       "calibrated",
        "user_id":      user_id,
        "window_count": window_count,
        "baselines":    baselines
    })


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "Phenotyping Backend Online"})

if __name__ == '__main__':
    # Using a different port than your group member's physiological server
    # use_reloader=False -- see backend/psychological/app.py's app.run() comment.
    app.run(port=5002, debug=True, use_reloader=False)