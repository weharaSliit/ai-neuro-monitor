import sys

# Windows consoles default to the cp1252 codepage, which can't encode the
# checkmark/arrow characters used in this backend's startup log lines and
# crashes the process with UnicodeEncodeError before Flask ever starts.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from flask import Flask, jsonify, request, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import numpy as np
import re
import threading
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
from backend.common.auth import generate_token, require_auth
from backend.physiological.firebase_service import (
    init_firebase,
    create_user, get_user, list_users,
    create_user_with_password, set_password_hash,
    save_baseline, load_baseline,
    save_prediction, get_session_predictions,
    get_recent_sessions,
    save_pss4, get_pss4_history,
    save_ema_update, _ref,
    save_prediction_quality,
    save_fusion_en_rtdb,
    label_session_ground_truth_rtdb,
    get_device_status
)
from backend.physiological.predictor import (
    predict_window, predict_raw,
    feature_cols, StressStateMachine
)
from backend.physiological.extract_features import (
    extract_features, compute_signal_quality
)
from backend.physiological.calibration_capture import (
    save_calibration_windows, run_calibration_capture
)

app = Flask(__name__)
CORS(app)
init_firebase()

ring_sessions = {}  

_calibration_sessions = {}

USER_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{3,30}$')

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status':   'running',
        'model':    'XGBoost binary (Normal/Stress)',
        'features': len(feature_cols),
        'firebase': 'connected'
    })

@app.route('/register', methods=['POST'])
def register():
    data     = request.json or {}
    user_id  = (data.get('user_id') or '').strip()
    password = data.get('password') or ''
    name     = (data.get('name') or user_id).strip()

    if not USER_ID_PATTERN.match(user_id):
        return jsonify({
            'error': 'user_id must be 3-30 characters: letters, numbers, _ or -'
        }), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    existing = get_user(user_id)
    if existing and existing.get('password_hash'):
        return jsonify({'error': 'Username already taken'}), 409

    password_hash = generate_password_hash(password)
    if existing is None:
        create_user_with_password(user_id, name, password_hash)
    else:
        set_password_hash(user_id, password_hash)

    return jsonify({
        'success': True,
        'user_id': user_id,
        'name':    name,
        'token':   generate_token(user_id)
    }), 201


@app.route('/login', methods=['POST'])
def login():
    data     = request.json or {}
    user_id  = (data.get('user_id') or '').strip()
    password = data.get('password') or ''

    user = get_user(user_id)
    if not user or 'password_hash' not in user or \
            not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid username or password'}), 401

    return jsonify({
        'success': True,
        'user_id': user_id,
        'name':    user.get('name', user_id),
        'token':   generate_token(user_id)
    })


@app.route('/users', methods=['GET'])
@require_auth
def get_users():
    users = {
        uid: {k: v for k, v in record.items() if k != 'password_hash'}
        for uid, record in list_users().items()
    }
    return jsonify({'users': users})

@app.route('/calibrate', methods=['POST'])
@require_auth
def calibrate():
    data = request.json
    user_id = g.user_id
    raw_windows = data.get('windows', [])

    try:
        result = save_calibration_windows(user_id, raw_windows)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({
            'error':   'Feature extraction failed',
            'details': str(e)
        }), 500

    return jsonify(result)

@app.route('/calibrate/start', methods=['POST'])
@require_auth
def calibrate_start():
    user_id = g.user_id
    current = _calibration_sessions.get(user_id)
    if current and current.get('status') in ('settling', 'capturing', 'saving'):
        return jsonify({'error': 'Calibration already in progress'}), 409

    _calibration_sessions[user_id] = {
        'status': 'settling', 'window_idx': 0, 'n_windows': N_BASELINE_WIN
    }

    def on_progress(status, extra):
        entry = {'status': status, 'n_windows': N_BASELINE_WIN}
        if status == 'window_captured':
            entry['status'] = 'capturing'
            entry['window_idx'] = extra['window_idx']
        elif status == 'window_skipped':
            entry['status'] = 'capturing'
            entry['window_idx'] = _calibration_sessions.get(
                user_id, {}
            ).get('window_idx', 0)
        elif status == 'error':
            entry['error'] = extra.get('message', 'Unknown error')
        else:
            entry.update(extra)
            entry['status'] = status
        _calibration_sessions[user_id] = entry

    def worker():
        run_calibration_capture(user_id, on_progress=on_progress)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({'status': 'started'})


@app.route('/calibrate/status', methods=['GET'])
@require_auth
def calibrate_status():
    state = _calibration_sessions.get(g.user_id, {'status': 'idle'})
    return jsonify(state)

@app.route('/predict', methods=['POST'])
@require_auth
def predict():
    data = request.json

    # ── Parse request ─────────────────────────────────────────
    user_id         = g.user_id
    session_id      = data.get('session_id', 'session_001')
    window_idx      = data.get('window_idx', 0)
    ibi_array       = data.get('ibi_array', [])
    gsr_adc_array   = data.get('gsr_adc_array', [])
    acc_array       = data.get('acc_array', [])
    gsr_calibration = data.get('gsr_calibration', 2048)
    actual_fs       = data.get('actual_fs', 50)

    # ── Validate inputs ───────────────────────────────────────
    if len(ibi_array) < 10:
        return jsonify({
            'error': 'ibi_array too short — minimum 10 IBI values',
            'hint':  'Ensure MAX30102 is detecting R-peaks correctly'
        }), 400
    
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
    try:
        if b_mean is None:

            result = predict_raw(features_2d)
        else:
            sm.update_baseline(b_mean)
            result = predict_window(features_2d, b_mean, b_std, sm, feat_dict)
    except RuntimeError as e:
        return jsonify({'error': 'Model unavailable', 'details': str(e)}), 503

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

    save_fusion_en_rtdb(
        user_id, session_id, window_idx,
        result['confidence'], signal_quality,
        result['prob_normal'], result['prob_stress'],
        result['label'], result['trending_toward_stress'],
        feat_dict
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
@require_auth
def submit_pss4():
    data       = request.json
    user_id    = g.user_id
    session_id = data.get('session_id', 'session_001')
    q1 = int(data.get('q1', 0))
    q2 = int(data.get('q2', 0))
    q3 = int(data.get('q3', 0))
    q4 = int(data.get('q4', 0))

    score = save_pss4(user_id, session_id, q1, q2, q3, q4)
    label_session_ground_truth_rtdb(session_id, score)

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
@require_auth
def get_history(user_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
    return jsonify({
        'user_id':  user_id,
        'sessions': get_recent_sessions(user_id, limit=10),
        'pss4':     get_pss4_history(user_id)
    })


@app.route('/history/<user_id>/<session_id>',
           methods=['GET'])
@require_auth
def get_session_detail(user_id, session_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
    return jsonify({
        'user_id':     user_id,
        'session_id':  session_id,
        'predictions': get_session_predictions(
            user_id, session_id
        )
    })


@app.route('/baseline/<user_id>', methods=['GET'])
@require_auth
def get_baseline(user_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
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
@require_auth
def ema_update():
    from backend.physiological.ema_service import (
        compute_session_mean,
        compute_ema_update,
        build_ema_summary,
        interpret_ema_change,
    )

    data       = request.get_json(silent=True) or {}
    user_id    = g.user_id
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
@require_auth
def get_ema_history(user_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
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
    print(f"  POST /register          ← create account")
    print(f"  POST /login             ← issue auth token")
    print(f"  GET  /users              (auth required)")
    print(f"  POST /calibrate         ← real-ring baseline capture (auth required)")
    print(f"  POST /calibrate/start    (auth required) — live in-app capture trigger")
    print(f"  GET  /calibrate/status   (auth required) — poll capture progress")
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
        port=5050,
        debug=True,
        use_reloader=False, 
        threaded=True 
    )
