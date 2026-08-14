# ============================================================
# app.py — Main Flask server
# All API endpoints for the real-ring stress detection pipeline.
# WESAD simulation mode has been removed — the real ring is the
# only deployment target.
# ============================================================

from flask import Flask, jsonify, request
from flask_cors import CORS
import numpy as np
import sys
from pathlib import Path
from firebase_admin import db

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.config import (
    STRESS_COLORS,
    EMA_ALPHA, N_BASELINE_WIN
)
from backend.physiological.firebase_service import (
    init_firebase,
    create_user, list_users,
    save_baseline, load_baseline, baseline_exists,
    save_prediction, get_session_predictions,
    get_recent_sessions,
    save_pss4, get_pss4_history,
    save_ema_update, _ref,
    save_prediction_quality,
    save_fusion_signal,
    get_device_status
)
from backend.physiological.predictor import (
    predict_window, predict_raw,
    compute_baseline, update_baseline_ema,
    feature_cols, StressStateMachine
)
from backend.physiological.extract_features import (
    extract_features, compute_signal_quality
)

app = Flask(__name__)
CORS(app)
init_firebase()

ring_sessions = {}  # per-user state machines, kept warm across windows


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status':   'running',
        'model':    'XGBoost binary (Normal/Stress)',
        'features': len(feature_cols),
        'firebase': 'connected'
    })


@app.route('/users', methods=['GET'])
def get_users():
    return jsonify({'users': list_users()})


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


# ── /calibrate — real-ring baseline capture ───────────────────
# Extracts features from N raw sensor windows, then computes/
# EMA-merges/saves a personal baseline for user_id.
#
# REQUEST FORMAT:
#   {
#     "user_id": "Wehara",
#     "windows": [
#       {"ibi_array": [...], "gsr_adc_array": [...], "acc_array": [...],
#        "gsr_calibration": 2048, "actual_fs": 5},
#       ...  (N_BASELINE_WIN windows, collected while resting)
#     ]
#   }
@app.route('/calibrate', methods=['POST'])
def calibrate():
    data    = request.json
    user_id = data.get('user_id', 'Wehara')
    raw_windows = data.get('windows', [])

    if len(raw_windows) == 0:
        return jsonify({'error': 'No windows provided'}), 400

    feature_rows = []
    for i, w in enumerate(raw_windows):
        try:
            features_2d, motion_rejected, feat_dict = extract_features(
                w.get('ibi_array', []),
                w.get('gsr_adc_array', []),
                w.get('acc_array', []),
                w.get('gsr_calibration', 2048),
                actual_fs=w.get('actual_fs', 50)
            )
        except Exception as e:
            return jsonify({
                'error':   f'Feature extraction failed on window {i}',
                'details': str(e)
            }), 500

        if motion_rejected:
            return jsonify({
                'error': f'Window {i} rejected for movement — '
                         f'sit still for the whole calibration period'
            }), 400

        feature_rows.append(features_2d[0])

    windows_array = np.array(feature_rows)
    b_mean, b_std = compute_baseline(windows_array)

    if baseline_exists(user_id):
        old_mean, old_std = load_baseline(user_id, feature_cols)
        if old_mean is not None:
            b_mean, b_std = update_baseline_ema(old_mean, old_std, b_mean, b_std)

    save_baseline(user_id, b_mean, b_std, feature_cols)

    return jsonify({
        'success':      True,
        'user_id':      user_id,
        'baseline_set': True,
        'n_windows':    len(windows_array),
        'sample_values': {
            'AVNN_mean':     float(b_mean[0]),
            'SCL_mean_mean': float(b_mean[feature_cols.index('SCL_mean')])
        }
    })


# ── /predict — real-ring binary prediction ─────────────────────
# Binary (Normal/Stress) — model trained directly on WESAD data
# relabeled to match the ring's real task (see
# notebooks/05_binary_relabel_retrain.ipynb).
#
# Real traffic reaches this via mqtt_bridge.py (ESP32 -> Mosquitto
# -> bridge -> here). Also works standalone for manual testing
# (Postman / MQTT Explorer + curl).
#
# REQUEST FORMAT:
#   {
#     "user_id":         "Wehara",
#     "session_id":      "live_session_1",
#     "window_idx":      0,
#     "ibi_array":       [812, 798, 821, ...],    ms
#     "gsr_adc_array":   [1992, 1985, 2010, ...], 0-4095
#     "acc_array":       [0.93, 0.94, 0.92, ...], g
#     "gsr_calibration": 2048,                    ADC int
#     "actual_fs":       5                        Hz — real GSR/ACC
#                                                  sample rate, NOT
#                                                  WESAD's 50Hz
#   }
#
# MOTION REJECTION:
#   If >10% of ACC samples exceed 1.2g, window rejected.
#   Returns motion_rejected: true in response.
#
# DB RULE: raw sensor arrays above are never written to Firebase —
# they exist only in this request. Only extracted features + the
# prediction go to predictions/, and only probability/confidence/
# signal_quality go to the separate prediction_quality/ table.
@app.route('/predict', methods=['POST'])
def predict():
    data = request.json

    # ── Parse request ─────────────────────────────────────────
    user_id         = data.get('user_id', 'Wehara')
    session_id      = data.get('session_id', 'session_001')
    window_idx      = data.get('window_idx', 0)
    ibi_array       = data.get('ibi_array', [])
    gsr_adc_array   = data.get('gsr_adc_array', [])
    acc_array       = data.get('acc_array', [])
    gsr_calibration = data.get('gsr_calibration', 2048)
    actual_fs       = data.get('actual_fs', 50)

    # ── Validate inputs ───────────────────────────────────────
    if len(ibi_array) < 4:
        return jsonify({
            'error': 'ibi_array too short — minimum 4 IBI values',
            'hint':  'Ensure MAX30102 is detecting R-peaks correctly'
        }), 400

    # Floor lowered from 100 (assumed WESAD's 50Hz) — the real ring
    # runs ~5Hz, so a full 60s window is only ~300 samples. 20 is
    # just a floor to catch a truncated/degraded window, not a
    # target — normal windows will be far above this.
    if len(gsr_adc_array) < 20:
        return jsonify({
            'error': 'gsr_adc_array too short — minimum 20 samples',
            'hint':  f'Send more GSR samples — got {len(gsr_adc_array)} at ~{actual_fs}Hz'
        }), 400

    if len(acc_array) < 10:
        return jsonify({
            'error': 'acc_array too short — minimum 10 samples',
            'hint':  'Send ACC magnitude array from MPU-6050'
        }), 400

    # ── Extract features from raw arrays ───────────────────────
    try:
        features_2d, motion_rejected, feat_dict = \
            extract_features(
                ibi_array,
                gsr_adc_array,
                acc_array,
                gsr_calibration,
                actual_fs=actual_fs
            )
    except Exception as e:
        return jsonify({
            'error':   'Feature extraction failed',
            'details': str(e)
        }), 500

    # ── Motion rejection ──────────────────────────────────────
    if motion_rejected:
        return jsonify({
            'motion_rejected': True,
            'window_idx':      window_idx,
            'message':         'Window rejected — too much movement',
            'hint':            'Keep hand still during measurement'
        })

    signal_quality = compute_signal_quality(
        ibi_array, gsr_adc_array, acc_array,
        motion_rejected, actual_fs=actual_fs
    )

    # ── Load personal baseline ────────────────────────────────
    b_mean, b_std = load_baseline(user_id, feature_cols)

    # ── State machine kept warm per user ──────────────────────
    if user_id not in ring_sessions:
        ring_sessions[user_id] = StressStateMachine(
            feature_cols_list = feature_cols,
            baseline_mean     = b_mean,
            window_size       = 5,
            trend_threshold   = 0.35
        )
    sm = ring_sessions[user_id]

    # ── Predict (binary) ───────────────────────────────────────
    if b_mean is None:
        # No personal baseline yet — raw model output,
        # no trend detection (nothing to compare against).
        result = predict_raw(features_2d)
    else:
        sm.update_baseline(b_mean)
        result = predict_window(features_2d, b_mean, b_std, sm, feat_dict)

    # ── Save structured data only ──────────────────────────────
    save_prediction(
        user_id, session_id, window_idx,
        result['prediction'], result['label'],
        result['prob_normal'], result['prob_stress'],
        result['trending_toward_stress'], feat_dict
    )
    save_prediction_quality(
        user_id, session_id, window_idx,
        result['confidence'], signal_quality,
        result['prob_normal'], result['prob_stress'],
        result['trending_toward_stress']
    )
    save_fusion_signal(
        user_id, session_id, window_idx,
        result['confidence'], signal_quality,
        result['prob_normal'], result['prob_stress'],
        result['label'], result['trending_toward_stress']
    )

    return jsonify({
        'prediction':             result['prediction'],
        'label':                   result['label'],
        'color':                   STRESS_COLORS[result['prediction']],
        'confidence':               result['confidence'],
        'signal_quality':            signal_quality,
        'trending_toward_stress':     result['trending_toward_stress'],
        'probabilities': {
            'normal': result['prob_normal'],
            'stress': result['prob_stress']
        },
        'window_idx':      window_idx,
        'motion_rejected': False,
        # Key sensor readings for live graph display
        'features': {
            'AVNN':        float(feat_dict.get('AVNN', 0)),
            'MeanHR':      float(feat_dict.get('MeanHR', 0)),
            'SCL_mean':    float(feat_dict.get('SCL_mean', 0)),
            'SCR_count':   float(feat_dict.get('SCR_count', 0))
        }
    })


@app.route('/devices/<device_id>/status', methods=['GET'])
def device_status(device_id):
    return jsonify(get_device_status(device_id))


@app.route('/pss4', methods=['POST'])
def submit_pss4():
    data       = request.json
    user_id    = data.get('user_id', 'user_001')
    session_id = data.get('session_id', 'session_001')
    q1 = int(data.get('q1', 0))
    q2 = int(data.get('q2', 0))
    q3 = int(data.get('q3', 0))
    q4 = int(data.get('q4', 0))

    score = save_pss4(user_id, session_id, q1, q2, q3, q4)

    level = (
        'Normal' if score <= 6 else
        'Stress' if score <= 12 else
        'High Stress'
    )

    return jsonify({
        'success':   True,
        'score':     score,
        'level':     level,
        'max_score': 16
    })


@app.route('/history/<user_id>', methods=['GET'])
def get_history(user_id):
    return jsonify({
        'user_id':  user_id,
        'sessions': get_recent_sessions(user_id, limit=10),
        'pss4':     get_pss4_history(user_id)
    })


@app.route('/history/<user_id>/<session_id>',
           methods=['GET'])
def get_session_detail(user_id, session_id):
    return jsonify({
        'user_id':     user_id,
        'session_id':  session_id,
        'predictions': get_session_predictions(
            user_id, session_id
        )
    })


@app.route('/baseline/<user_id>', methods=['GET'])
def get_baseline(user_id):
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


@app.route('/ema/update', methods=['POST'])
def ema_update():
    from backend.physiological.ema_service import (
        compute_session_mean,
        compute_ema_update,
        build_ema_summary,
        interpret_ema_change,
    )

    data       = request.get_json(silent=True) or {}
    user_id    = data.get('user_id', 'Wehara')
    session_id = data.get('session_id', '')

    old_mean, old_std = load_baseline(user_id, feature_cols)
    if old_mean is None:
        return jsonify({'error': 'No baseline found'}), 400

    predictions_data = get_session_predictions(
        user_id, session_id
    )
    if not predictions_data:
        return jsonify({'error': 'No predictions found'}), 400

    feature_arrays  = []
    prediction_list = []

    for key, pred in predictions_data.items():
        if 'features' in pred:
            row = [
                pred['features'].get(f, 0.0)
                for f in feature_cols
            ]
            feature_arrays.append(row)
            prediction_list.append(
                int(pred.get('prediction', 0))
            )

    if len(feature_arrays) == 0:
        return jsonify({'error': 'No features found'}), 400

    feature_arrays = np.array(feature_arrays)
    normal_count   = sum(
        1 for p in prediction_list if p == 0
    )

    session_mean = compute_session_mean(
        feature_arrays,
        predictions=prediction_list
    )

    if session_mean is None:
        return jsonify({
            'success':        True,
            'updated':        False,
            'user_id':        user_id,
            'session_id':     session_id,
            'alpha':          EMA_ALPHA,
            'n_windows':      len(feature_arrays),
            'n_normal_used':  normal_count,
            'reason':         'Fewer than 3 Normal windows in session',
            'message': (
                f'Baseline unchanged. Session had only '
                f'{normal_count} Normal windows '
                f'(minimum 3 required).'
            ),
            'interpretation': [
                f'Session contained {len(feature_arrays)} windows '
                f'total, {normal_count} classified as Normal.',
                'Minimum 3 Normal windows required.',
                'Your resting baseline remains stable.',
            ],
            'comparison': []
        })

    new_mean       = compute_ema_update(old_mean, session_mean)
    summary        = build_ema_summary(
        old_mean, new_mean, feature_cols
    )
    interpretation = interpret_ema_change(
        old_mean, new_mean, feature_cols
    )

    save_baseline(user_id, new_mean, old_std, feature_cols)
    save_ema_update(
        user_id, session_id,
        old_mean, new_mean, feature_cols, EMA_ALPHA
    )

    key_features = [
        'AVNN', 'MeanHR', 'SCL_mean', 'SCR_count', 'SD1'
    ]
    comparison = []
    for feat in key_features:
        if feat in feature_cols:
            i = feature_cols.index(feat)
            comparison.append({
                'feature': feat,
                'old':     round(float(old_mean[i]), 3),
                'new':     round(float(new_mean[i]), 3),
                'delta':   round(
                    float(new_mean[i] - old_mean[i]), 3
                ),
                'formula': (
                    f"{EMA_ALPHA} × "
                    f"{round(float(session_mean[i]), 2)} + "
                    f"{1-EMA_ALPHA} × "
                    f"{round(float(old_mean[i]), 2)} = "
                    f"{round(float(new_mean[i]), 2)}"
                )
            })

    return jsonify({
        'success':        True,
        'updated':        True,
        'user_id':        user_id,
        'session_id':     session_id,
        'alpha':          EMA_ALPHA,
        'n_windows':      len(feature_arrays),
        'n_normal_used':  normal_count,
        'comparison':     comparison,
        'interpretation': interpretation,
    })


@app.route('/ema/history/<user_id>', methods=['GET'])
def get_ema_history(user_id):
    ref  = _ref(f'ema_history/{user_id}')
    data = ref.get() or {}
    return jsonify({
        'user_id':     user_id,
        'ema_history': data
    })


if __name__ == '__main__':
    print("=" * 50)
    print("STRESS DETECTION API SERVER")
    print("=" * 50)
    print(f"Model: XGBoost binary (Normal/Stress), {len(feature_cols)} features")
    print(f"Endpoints:")
    print(f"  GET  /health")
    print(f"  POST /calibrate         ← real-ring baseline capture")
    print(f"  POST /predict           ← binary (Normal/Stress) + trend")
    print(f"  GET  /devices/<device_id>/status")
    print(f"  POST /pss4")
    print(f"  GET  /history/<user_id>")
    print(f"  GET  /baseline/<user_id>")
    print(f"  POST /ema/update")
    print(f"  GET  /ema/history/<user_id>")
    print("=" * 50)
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True
    )
