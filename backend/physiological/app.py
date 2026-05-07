# ============================================================
# app.py — Main Flask server
# All API endpoints for stress detection demo
# ============================================================

from flask import Flask, jsonify, request
from flask_cors import CORS
import numpy as np
import threading
import time
import json
import sys
from pathlib import Path
from firebase_admin import db

# When running this file directly ( `python app.py` from this folder),
# ensure the repository root is on sys.path so `import backend.*` works.
if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.config import (
    STRESS_LABELS, STRESS_COLORS,
    EMA_ALPHA, N_BASELINE_WIN,
    WESAD_SUBJECTS, WINDOW_STEP_SEC
)
from backend.physiological.firebase_service import (
    init_firebase,
    create_user, get_user, list_users,
    save_baseline, load_baseline, baseline_exists,
    start_session, end_session,
    save_prediction, get_session_predictions,
    get_recent_sessions,
    save_pss4, get_pss4_history,
    save_ema_update, _ref
)
from backend.physiological.predictor import (
    predict_window, predict_raw,
    compute_baseline, update_baseline_ema,
    normalize_features, build_feature_dict,
    feature_cols
)
from backend.physiological.simulator import (
    get_subject_windows, get_simulation_subjects,
    get_subject_summary, find_stress_transition_subject
)

# ── App setup ─────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ── Initialize Firebase ───────────────────────────────────────
init_firebase()

# Active simulation state 
active_simulations = {}


# Health check 
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status':   'running',
        'model':    'XGBoost 22 features',
        'features': len(feature_cols),
        'firebase': 'connected'
    })


#  User endpoints 
@app.route('/users', methods=['GET'])
def get_users():
    users = list_users()
    return jsonify({'users': users})


@app.route('/users', methods=['POST'])
def create_new_user():
    data    = request.json
    user_id = data.get('user_id', 'user_001')
    name    = data.get('name', 'User')
    create_user(user_id, name)
    return jsonify({
        'success': True,
        'user_id': user_id,
        'name':    name
    })


# Calibration endpoint 
@app.route('/calibrate', methods=['POST'])
def calibrate():
    """
    Receive first session windows for baseline calibration.
    Body: {user_id, windows: [[f1,f2,...,f22], ...]}
    """
    data    = request.json
    user_id = data.get('user_id', 'user_001')
    windows = np.array(data.get('windows', []))

    if len(windows) == 0:
        return jsonify({'error': 'No windows provided'}), 400

    # Validate window feature length
    if windows.ndim != 2 or windows.shape[1] != len(feature_cols):
        got = windows.shape[1] if windows.ndim == 2 else None
        return jsonify({
            'error': 'Invalid windows shape',
            'expected_n_features': len(feature_cols),
            'got_n_features': got,
            'hint': 'Send windows as a list of 22-value arrays ordered like feature_cols (use /simulate/next features_array).'
        }), 400

    # Compute personal baseline
    b_mean, b_std = compute_baseline(windows)

    # Check if existing baseline — apply EMA update
    if baseline_exists(user_id):
        old_mean, old_std = load_baseline(
            user_id, feature_cols
        )
        if old_mean is not None:
            new_mean, new_std = update_baseline_ema(
                old_mean, old_std, b_mean, b_std
            )
            b_mean, b_std = new_mean, new_std

    # Save to Firebase
    save_baseline(user_id, b_mean, b_std, feature_cols)

    return jsonify({
        'success':      True,
        'user_id':      user_id,
        'baseline_set': True,
        'n_windows':    len(windows),
        'sample_values': {
            'AVNN_mean':    float(b_mean[0]),
            'SCL_mean_mean': float(
                b_mean[feature_cols.index('SCL_mean')]
            )
        }
    })


#  Prediction endpoint 
@app.route('/predict', methods=['POST'])
def predict():
    """
    Predict stress class for one window.
    Body: {user_id, session_id, window_idx,
           features: [f1,f2,...,f22],
           trend_history: [{feat: val}, ...]}
    """
    data          = request.json
    user_id       = data.get('user_id', 'user_001')
    session_id    = data.get('session_id', 'session_001')
    window_idx    = data.get('window_idx', 0)
    features      = np.array(data.get('features', []))
    trend_history = data.get('trend_history', [])

    if len(features) != len(feature_cols):
        return jsonify({
            'error': f'Expected {len(feature_cols)} features'
        }), 400

    features_2d = features.reshape(1, -1)

    # Load personal baseline
    b_mean, b_std = load_baseline(user_id, feature_cols)

    if b_mean is None:
        # No calibration — use raw prediction
        prediction, probs = predict_raw(features_2d)
        trend_alert = False
    else:
        prediction, probs, trend_alert = predict_window(
            features_2d, b_mean, b_std, trend_history
        )

    label = STRESS_LABELS[prediction]
    color = STRESS_COLORS[prediction]

    # Save to Firebase
    features_dict = build_feature_dict(features_2d)
    save_prediction(
        user_id, session_id, window_idx,
        prediction, probs, trend_alert, features_dict
    )

    return jsonify({
        'prediction':   prediction,
        'label':        label,
        'color':        color,
        'probabilities': {
            'normal':    float(probs[0]),
            'prestress': float(probs[1]),
            'stress':    float(probs[2])
        },
        'trend_alert':  trend_alert,
        'window_idx':   window_idx
    })


# Simulation endpoint 
@app.route('/simulate/start', methods=['POST'])
def start_simulation():
    """
    Start streaming WESAD subject data.
    Body: {user_id, subject_id}
    Returns: {session_id, total_windows, summary}
    """
    data       = request.json
    user_id    = data.get('user_id', 'demo_user')
    subject_id = int(data.get('subject_id', 2))

    if subject_id not in WESAD_SUBJECTS:
        return jsonify({'error': 'Invalid subject'}), 400

    # Get subject windows
    windows = get_subject_windows(subject_id)
    if not windows:
        return jsonify({'error': 'Subject data not found'}), 404

    # Start Firebase session
    session_id = start_session(user_id)

    # Store simulation state
    active_simulations[user_id] = {
        'windows':      windows,
        'current_idx':  0,
        'session_id':   session_id,
        'subject_id':   subject_id,
        'running':      True,
        'trend_history': []
    }

    summary = get_subject_summary(subject_id)

    return jsonify({
        'success':       True,
        'session_id':    session_id,
        'total_windows': len(windows),
        'subject_id':    subject_id,
        'summary':       summary
    })


@app.route('/simulate/next', methods=['POST'])
def next_simulation_window():
    """
    Get next window prediction in simulation.
    Body: {user_id}
    Returns: prediction + features for this window
    """
    data    = request.json
    user_id = data.get('user_id', 'demo_user')

    if user_id not in active_simulations:
        return jsonify({'error': 'No active simulation'}), 404

    sim = active_simulations[user_id]

    if sim['current_idx'] >= len(sim['windows']):
        return jsonify({'done': True, 'message': 'Simulation complete'})

    # Get current window
    window     = sim['windows'][sim['current_idx']]
    features   = window['features'].reshape(1, -1)
    true_label = window['true_label']

    # Load baseline
    b_mean, b_std = load_baseline(user_id, feature_cols)

    if b_mean is not None:
        prediction, probs, trend_alert = predict_window(
            features, b_mean, b_std,
            sim['trend_history']
        )
    else:
        prediction, probs = predict_raw(features)
        trend_alert = False

    # Update trend history
    feat_dict = build_feature_dict(features)
    sim['trend_history'].append(feat_dict)
    if len(sim['trend_history']) > 5:
        sim['trend_history'].pop(0)

    # Save prediction
    save_prediction(
        user_id, sim['session_id'],
        sim['current_idx'],
        prediction, probs, trend_alert, feat_dict
    )

    # Provide a stable ordered feature array (matches `feature_cols`)
    features_array = [float(feat_dict.get(f, 0.0)) for f in feature_cols]

    # Advance index
    sim['current_idx'] += 1
    progress = sim['current_idx'] / len(sim['windows'])

    return jsonify({
        'window_idx':   sim['current_idx'] - 1,
        'prediction':   prediction,
        'label':        STRESS_LABELS[prediction],
        'color':        STRESS_COLORS[prediction],
        'true_label':   true_label,
        'true_name':    STRESS_LABELS[true_label],
        'probabilities': {
            'normal':    float(probs[0]),
            'prestress': float(probs[1]),
            'stress':    float(probs[2])
        },
        'trend_alert':  trend_alert,
        'progress':     float(progress),
        'done':         sim['current_idx'] >= len(sim['windows']),
        'features': {
            'AVNN':     float(feat_dict.get('AVNN', 0)),
            'MeanHR':   float(feat_dict.get('MeanHR', 0)),
            'SCL_mean': float(feat_dict.get('SCL_mean', 0)),
            'SCR_count': float(feat_dict.get('SCR_count', 0))
        },
        'features_array': features_array
    })


@app.route('/simulate/stop', methods=['POST'])
def stop_simulation():
    """Stop active simulation."""
    data    = request.json
    user_id = data.get('user_id', 'demo_user')

    if user_id in active_simulations:
        sim = active_simulations[user_id]
        end_session(user_id, sim['session_id'])
        del active_simulations[user_id]

    return jsonify({'success': True, 'stopped': True})


@app.route('/simulate/subjects', methods=['GET'])
def get_subjects():
    """Get list of available simulation subjects with summaries."""
    subjects = []
    for sid in WESAD_SUBJECTS:
        summary = get_subject_summary(sid)
        if summary:
            subjects.append(summary)
    return jsonify({'subjects': subjects})


# PSS-4 endpoint 
@app.route('/pss4', methods=['POST'])
def submit_pss4():
    """
    Submit PSS-4 questionnaire answers.
    Body: {user_id, session_id, q1, q2, q3, q4}
    Each question: 0-4 (Never to Very Often)
    """
    data       = request.json
    user_id    = data.get('user_id', 'user_001')
    session_id = data.get('session_id', 'session_001')
    q1 = int(data.get('q1', 0))
    q2 = int(data.get('q2', 0))
    q3 = int(data.get('q3', 0))
    q4 = int(data.get('q4', 0))

    score = save_pss4(user_id, session_id, q1, q2, q3, q4)

    if score <= 6:
        level = 'Normal'
    elif score <= 12:
        level = 'Pre-stress'
    else:
        level = 'Stress'

    return jsonify({
        'success':    True,
        'score':      score,
        'level':      level,
        'max_score':  16
    })


# History endpoints 
@app.route('/history/<user_id>', methods=['GET'])
def get_history(user_id):
    """Get recent session history for a user."""
    sessions = get_recent_sessions(user_id, limit=10)
    pss4     = get_pss4_history(user_id)

    return jsonify({
        'user_id':  user_id,
        'sessions': sessions,
        'pss4':     pss4
    })


@app.route('/history/<user_id>/<session_id>',
           methods=['GET'])
def get_session_detail(user_id, session_id):
    """Get predictions for a specific session."""
    predictions = get_session_predictions(
        user_id, session_id
    )
    return jsonify({
        'user_id':    user_id,
        'session_id': session_id,
        'predictions': predictions
    })


#  Baseline endpoint 
@app.route('/baseline/<user_id>', methods=['GET'])
def get_baseline(user_id):
    """Get current personal baseline for a user."""
    b_mean, b_std = load_baseline(user_id, feature_cols)

    if b_mean is None:
        return jsonify({'exists': False})

    return jsonify({
        'exists':   True,
        'user_id':  user_id,
        'baseline': {
            feature_cols[i]: {
                'mean': float(b_mean[i]),
                'std':  float(b_std[i])
            }
            for i in range(len(feature_cols))
        }
    })


#  Demo helper endpoint 
@app.route('/demo/best_subject', methods=['GET'])
def best_demo_subject():
    """Returns best subject for viva demo."""
    sid = find_stress_transition_subject()
    return jsonify({
        'subject_id': sid,
        'reason':     'Most pre-stress windows for demo'
    })


# ── EMA update endpoint ───────────────────────────────────────
@app.route('/ema/update', methods=['POST'])
def ema_update():
    """
    Called after simulation ends.
    Computes EMA update from session windows.
    Returns before/after comparison for display.
    Body: {user_id, session_id}
    """
    from backend.physiological.ema_service import (
        compute_session_mean,
        compute_ema_update,
        build_ema_summary,
        interpret_ema_change,
    )

    data = request.get_json(silent=True) or {}
    user_id    = data.get('user_id', 'kasun')
    session_id = data.get('session_id', '')

    # Load current baseline
    old_mean, old_std = load_baseline(user_id, feature_cols)

    if old_mean is None:
        return jsonify({'error': 'No baseline found'}), 400

    # Get all predictions from this session
    predictions = get_session_predictions(user_id, session_id)

    if not predictions:
        return jsonify({'error': 'No predictions found'}), 400

    # Extract feature arrays from saved predictions
    feature_arrays = []
    for key, pred in predictions.items():
        if 'features' in pred:
            row = [pred['features'].get(f, 0.0) for f in feature_cols]
            feature_arrays.append(row)

    if len(feature_arrays) == 0:
        return jsonify({'error': 'No features found'}), 400

    feature_arrays = np.array(feature_arrays)

    # Compute session mean
    session_mean = compute_session_mean(feature_arrays)
    if session_mean is None:
        return jsonify({'error': 'Session mean could not be computed'}), 400

    # Compute EMA update
    new_mean = compute_ema_update(old_mean, session_mean)

    # Build summary for display
    summary = build_ema_summary(old_mean, new_mean, feature_cols)
    interpretation = interpret_ema_change(old_mean, new_mean, feature_cols)

    # Save updated baseline to Firebase
    save_baseline(user_id, new_mean, old_std, feature_cols)

    # Save EMA history
    save_ema_update(user_id, session_id, old_mean, new_mean, feature_cols, EMA_ALPHA)

    # Build key features comparison for app display
    key_features = ['AVNN', 'MeanHR', 'SCL_mean', 'SCR_count', 'SD1']
    comparison = []
    for feat in key_features:
        if feat in feature_cols:
            i = feature_cols.index(feat)
            comparison.append({
                'feature': feat,
                'old':     round(float(old_mean[i]), 3),
                'new':     round(float(new_mean[i]), 3),
                'delta':   round(float(new_mean[i] - old_mean[i]), 3),
                'formula': f"{EMA_ALPHA} × {round(float(session_mean[i]), 2)} + {1-EMA_ALPHA} × {round(float(old_mean[i]), 2)} = {round(float(new_mean[i]), 2)}"
            })

    return jsonify({
        'success':        True,
        'user_id':        user_id,
        'session_id':     session_id,
        'alpha':          EMA_ALPHA,
        'n_windows':      len(feature_arrays),
        'comparison':     comparison,
        'interpretation': interpretation,
        'updated':        True
    })


@app.route('/ema/history/<user_id>', methods=['GET'])
def get_ema_history(user_id):
    """Get full EMA history for a user."""
    ref  = _ref(f'ema_history/{user_id}')
    data = ref.get() or {}
    return jsonify({'user_id': user_id, 'ema_history': data})

# Run server 
if __name__ == '__main__':
    print("=" * 50)
    print("STRESS DETECTION API SERVER")
    print("=" * 50)
    print(f"Model: XGBoost, 22 features")
    print(f"Endpoints:")
    print(f"  GET  /health")
    print(f"  POST /calibrate")
    print(f"  POST /predict")
    print(f"  POST /simulate/start")
    print(f"  POST /simulate/next")
    print(f"  POST /simulate/stop")
    print(f"  GET  /simulate/subjects")
    print(f"  POST /pss4")
    print(f"  GET  /history/<user_id>")
    print(f"  GET  /baseline/<user_id>")
    print("=" * 50)
    app.run(
        host='0.0.0.0',
        port=5000, # my port
        debug=True
    )