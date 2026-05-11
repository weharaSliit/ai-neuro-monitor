from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import sys
import os
from pathlib import Path

# --- MODULE PATH FIX ---
if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

# Import your local services
from firebase_service import init_firebase, save_behavioral_window, get_user_baselines, save_stress_prediction, save_validation_label
from predictor import predictor
from ema_service import update_personalized_baseline

app = Flask(__name__)
CORS(app)

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
    
    # 1. Aggregation Logic (Custom Keyboard Data)
    # The phone sends raw arrays of timing; we calculate window stats here
    raw_dwells = data.get('dwell_times', [])
    raw_flights = data.get('flight_times', [])
    
    # Critical Check: Variable #15 (Keystroke Count)
    if len(raw_dwells) < 10:
        return jsonify({"status": "ignored", "reason": "Insufficient data (Keystroke count < 10)"}), 200

    window_features = {
        'avg_dwell': float(np.mean(raw_dwells)),
        'dwell_std': float(np.std(raw_dwells)),
        'avg_flight': float(np.mean(raw_flights)),
        'flight_std': float(np.std(raw_flights)),
        'interaction_rate': data.get('interaction_rate', 0),
        'scroll_velocity': data.get('scroll_velocity', 0)
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
    return jsonify({"status": "label saved ✓"})

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "Phenotyping Backend Online ✓"})

if __name__ == '__main__':
    # Using a different port than your group member's physiological server
    app.run(port=5001, debug=True)