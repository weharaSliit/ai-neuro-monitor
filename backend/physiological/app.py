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
from flask import send_file

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

app = Flask(__name__)
CORS(app)
init_firebase()

active_simulations = {}


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status':   'running',
        'model':    'XGBoost 22 features',
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


@app.route('/calibrate', methods=['POST'])
def calibrate():
    data    = request.json
    user_id = data.get('user_id', 'user_001')
    windows = np.array(data.get('windows', []))

    if len(windows) == 0:
        return jsonify({'error': 'No windows provided'}), 400

    if windows.ndim != 2 or windows.shape[1] != len(feature_cols):
        got = windows.shape[1] if windows.ndim == 2 else None
        return jsonify({
            'error':               'Invalid windows shape',
            'expected_n_features': len(feature_cols),
            'got_n_features':      got,
            'hint':                'Send windows as a list of 22-value arrays.'
        }), 400

    b_mean, b_std = compute_baseline(windows)

    if baseline_exists(user_id):
        old_mean, old_std = load_baseline(user_id, feature_cols)
        if old_mean is not None:
            new_mean, new_std = update_baseline_ema(
                old_mean, old_std, b_mean, b_std
            )
            b_mean, b_std = new_mean, new_std

    save_baseline(user_id, b_mean, b_std, feature_cols)

    return jsonify({
        'success':      True,
        'user_id':      user_id,
        'baseline_set': True,
        'n_windows':    len(windows),
        'sample_values': {
            'AVNN_mean':     float(b_mean[0]),
            'SCL_mean_mean': float(
                b_mean[feature_cols.index('SCL_mean')]
            )
        }
    })


@app.route('/predict', methods=['POST'])
def predict():
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

    features_2d   = features.reshape(1, -1)
    b_mean, b_std = load_baseline(user_id, feature_cols)

    if b_mean is None:
        prediction, probs = predict_raw(features_2d)
        trend_alert = False
    else:
        prediction, probs, trend_alert = predict_window(
            features_2d, b_mean, b_std, trend_history
        )

    features_dict = build_feature_dict(features_2d)
    save_prediction(
        user_id, session_id, window_idx,
        prediction, probs, trend_alert, features_dict
    )

    return jsonify({
        'prediction':    prediction,
        'label':         STRESS_LABELS[prediction],
        'color':         STRESS_COLORS[prediction],
        'probabilities': {
            'normal':    float(probs[0]),
            'prestress': float(probs[1]),
            'stress':    float(probs[2])
        },
        'trend_alert':   trend_alert,
        'window_idx':    window_idx
    })


@app.route('/simulate/start', methods=['POST'])
def start_simulation():
    data       = request.json
    user_id    = data.get('user_id', 'demo_user')
    subject_id = int(data.get('subject_id', 2))

    if subject_id not in WESAD_SUBJECTS:
        return jsonify({'error': 'Invalid subject'}), 400

    windows = get_subject_windows(subject_id)
    if not windows:
        return jsonify({'error': 'Subject data not found'}), 404

    session_id = start_session(user_id)

    active_simulations[user_id] = {
        'windows':        windows,
        'current_idx':    0,
        'session_id':     session_id,
        'subject_id':     subject_id,
        'running':        True,
        'trend_history':  [],
        'state_machine':  None  # initialized on first window
    }

    return jsonify({
        'success':       True,
        'session_id':    session_id,
        'total_windows': len(windows),
        'subject_id':    subject_id,
        'summary':       get_subject_summary(subject_id)
    })



@app.route('/simulate/next', methods=['POST'])
def next_simulation_window():
    from backend.physiological.predictor import (
        StressStateMachine
    )

    data    = request.json
    user_id = data.get('user_id', 'demo_user')

    if user_id not in active_simulations:
        return jsonify({'error': 'No active simulation'}), 404

    sim = active_simulations[user_id]

    if sim['current_idx'] >= len(sim['windows']):
        return jsonify({
            'done': True,
            'message': 'Simulation complete'
        })

    window     = sim['windows'][sim['current_idx']]
    features   = window['features'].reshape(1, -1)
    true_label = window['true_label']

    b_mean, b_std = load_baseline(user_id, feature_cols)

    # ── Initialize state machine on first window ──────────────
    if sim['state_machine'] is None:
        sim['state_machine'] = StressStateMachine(
            feature_cols_list = feature_cols,
            baseline_mean     = b_mean,
            window_size       = 5,
            ps_threshold      = 0.35,
            st_threshold      = 0.25,
            rec_threshold     = 0.40
        )
    else:
        # Update baseline if it changed (EMA)
        if b_mean is not None:
            sim['state_machine'].update_baseline(b_mean)

    sm = sim['state_machine']

    # ── Get raw XGBoost prediction ────────────────────────────
    if b_mean is not None:
        raw_pred, probs, _ = predict_window(
            features, b_mean, b_std, []
        )
    else:
        raw_pred, probs = predict_raw(features)

    # ── Apply state machine correction ───────────────────────
    feat_dict = build_feature_dict(features)

    corrected_pred, current_state, trend_alert = \
        sm.process_window(feat_dict, raw_pred)

    # Final prediction uses state machine result
    prediction = corrected_pred

    # ── Update legacy trend history (kept for compatibility) ──
    sim['trend_history'].append(feat_dict)
    if len(sim['trend_history']) > 5:
        sim['trend_history'].pop(0)

    # ── Save prediction to Firebase ───────────────────────────
    save_prediction(
        user_id, sim['session_id'],
        sim['current_idx'],
        prediction, probs, trend_alert, feat_dict
    )

    features_array = [
        float(feat_dict.get(f, 0.0)) for f in feature_cols
    ]

    sim['current_idx'] += 1
    progress = sim['current_idx'] / len(sim['windows'])

    return jsonify({
        'window_idx':    sim['current_idx'] - 1,
        'prediction':    prediction,
        'label':         STRESS_LABELS[prediction],
        'color':         STRESS_COLORS[prediction],
        'true_label':    true_label,
        'true_name':     STRESS_LABELS[true_label],
        'raw_prediction': raw_pred,
        'raw_label':     STRESS_LABELS[raw_pred],
        'state':         current_state,
        'probabilities': {
            'normal':    float(probs[0]),
            'prestress': float(probs[1]),
            'stress':    float(probs[2])
        },
        'trend_alert':   trend_alert,
        'progress':      float(progress),
        'done':          sim['current_idx'] >= len(sim['windows']),
        'features': {
            'AVNN':      float(feat_dict.get('AVNN', 0)),
            'MeanHR':    float(feat_dict.get('MeanHR', 0)),
            'SCL_mean':  float(feat_dict.get('SCL_mean', 0)),
            'SCR_count': float(feat_dict.get('SCR_count', 0))
        },
        'features_array': features_array
    })


@app.route('/simulate/stop', methods=['POST'])
def stop_simulation():
    data    = request.json
    user_id = data.get('user_id', 'demo_user')

    if user_id in active_simulations:
        sim = active_simulations[user_id]
        end_session(user_id, sim['session_id'])
        del active_simulations[user_id]

    return jsonify({'success': True, 'stopped': True})


@app.route('/simulate/subjects', methods=['GET'])
def get_subjects():
    subjects = []
    for sid in WESAD_SUBJECTS:
        summary = get_subject_summary(sid)
        if summary:
            subjects.append(summary)
    return jsonify({'subjects': subjects})


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
        'Normal'     if score <= 6  else
        'Pre-stress' if score <= 12 else
        'Stress'
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


@app.route('/demo/best_subject', methods=['GET'])
def best_demo_subject():
    sid = find_stress_transition_subject()
    return jsonify({
        'subject_id': sid,
        'reason':     'Most pre-stress windows for demo'
    })



# now uses only Normal-class windows for session mean
# Prevents acute stress responses from contaminating baseline
@app.route('/ema/update', methods=['POST'])
def ema_update():
    from backend.physiological.ema_service import (
        compute_session_mean,
        compute_ema_update,
        build_ema_summary,
        interpret_ema_change,
    )

    data       = request.get_json(silent=True) or {}
    user_id    = data.get('user_id', 'kasun')
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
            # FIX: collect prediction per window
            prediction_list.append(
                int(pred.get('prediction', 0))
            )

    if len(feature_arrays) == 0:
        return jsonify({'error': 'No features found'}), 400

    feature_arrays = np.array(feature_arrays)

    normal_count = sum(
        1 for p in prediction_list if p == 0
    )

    # FIX: pass predictions — only Normal windows used
    session_mean = compute_session_mean(
        feature_arrays,
        predictions=prediction_list
    )

    # Session had fewer than 3 Normal windows
    # Do not update baseline — stressful session
    if session_mean is None:
        return jsonify({
            'success':  True,
            'updated':  False,
            'user_id':  user_id,
            'session_id': session_id,
            'alpha':    EMA_ALPHA,
            'n_windows': len(feature_arrays),
            'n_normal_used': normal_count,
            'reason':   'Fewer than 3 Normal windows in session',
            'message':  (
                f'Baseline unchanged. Session had only '
                f'{normal_count} Normal windows (minimum 3 required). '
                f'One stressful session should not shift '
                f'your personal resting baseline.'
            ),
            'interpretation': [
                f'Session contained {len(feature_arrays)} windows '
                f'total, {normal_count} classified as Normal.',
                'Minimum 3 Normal windows required for baseline update.',
                'Your resting baseline remains stable.',
                'This is correct — acute stress responses should '
                'not permanently change your personal baseline.',
                'Sustained change over multiple sessions will '
                'gradually update the baseline as intended.'
            ],
            'comparison': []
        })

    # Normal update path
    new_mean       = compute_ema_update(old_mean, session_mean)
    summary        = build_ema_summary(
        old_mean, new_mean, feature_cols
    )
    interpretation = interpret_ema_change(
        old_mean, new_mean, feature_cols
    )

    save_baseline(
        user_id, new_mean, old_std, feature_cols
    )
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
        'success':       True,
        'updated':       True,
        'user_id':       user_id,
        'session_id':    session_id,
        'alpha':         EMA_ALPHA,
        'n_windows':     len(feature_arrays),
        'n_normal_used': normal_count,
        'comparison':    comparison,
        'interpretation': interpretation,
    })


@app.route('/ema/history/<user_id>', methods=['GET'])
def get_ema_history(user_id):
    ref  = _ref(f'ema_history/{user_id}')
    data = ref.get() or {}
    return jsonify({
        'user_id':    user_id,
        'ema_history': data
    })

@app.route('/exploratory/plot/<plot_name>',
           methods=['GET'])
def serve_plot(plot_name):
    allowed = [
        'plot_pca', 'plot_tsne', 'plot_radar',
        'plot_distributions', 'plot_patterns',
        'plot_subjects'
    ]

    if plot_name not in allowed:
        return jsonify({'error': 'Plot not found'}), 404

    plot_path = Path(__file__).resolve().parents[2] / \
        'physiological_signals' / 'results' / \
        'objective1' / 'exploratory_plots' / \
        f'{plot_name}.png'

    if not plot_path.exists():
        return jsonify({
            'error': f'{plot_name}.png not found.'
        }), 404

    
    from flask import make_response
    with open(str(plot_path), 'rb') as f:
        image_data = f.read()

    response = make_response(image_data)
    response.headers['Content-Type']  = 'image/png'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


@app.route('/exploratory/plots/list',
           methods=['GET'])
def list_plots():
    """Check which plots are available."""
    plots_dir = Path(__file__).resolve().parents[2] / \
        'physiological_signals' / 'results' / \
        'objective1' / 'exploratory_plots'

    available = []
    for name in [
        'plot_pca', 'plot_tsne', 'plot_radar',
        'plot_distributions', 'plot_patterns',
        'plot_subjects'
    ]:
        path = plots_dir / f'{name}.png'
        available.append({
            'name':      name,
            'available': path.exists(),
            'size_kb':   path.stat().st_size // 1024
                         if path.exists() else 0
        })

    return jsonify({'plots': available})

@app.route('/exploratory/analysis', methods=['GET'])
def exploratory_analysis():
    """
    Compute exploratory analysis live from WESAD features CSV.
    Returns all pattern data for the app to visualize.
    """
    import pandas as pd
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler
    from pathlib import Path

    try:
        # Load features CSV
        csv_path = Path(__file__).resolve().parents[2] / \
            'physiological_signals' / 'results' / \
            'objective1' / 'wesad_features_selected.csv'

        df = pd.read_csv(csv_path)

        feat_cols = [
            c for c in df.columns
            if c not in ['label', 'subject_id']
        ]
        X        = df[feat_cols].values
        y        = df['label'].values
        subjects = df['subject_id'].values

        # ── Class counts ──────────────────────────────────
        n_normal    = int((y == 0).sum())
        n_prestress = int((y == 1).sum())
        n_stress    = int((y == 2).sum())

        # ── Pattern analysis (Cell 5 logic) ───────────────
        monotonic_up   = []
        phasic_peak    = []
        trough         = []
        other          = []
        feature_patterns = []

        for feat in feat_cols:
            idx = feat_cols.index(feat)
            m0  = float(np.mean(X[y == 0, idx]))
            m1  = float(np.mean(X[y == 1, idx]))
            m2  = float(np.mean(X[y == 2, idx]))

            if m0 < m1 < m2:
                pattern = 'N<PS<S (monotonic up)'
                monotonic_up.append({
                    'name':      feat,
                    'normal':    round(m0, 4),
                    'prestress': round(m1, 4),
                    'stress':    round(m2, 4)
                })
            elif m0 > m1 > m2:
                pattern = 'N>PS>S (monotonic down)'
                other.append(feat)
            elif m1 > m2 and m1 > m0:
                pattern = 'PS peak (alarm response)'
                phasic_peak.append({
                    'name':      feat,
                    'normal':    round(m0, 4),
                    'prestress': round(m1, 4),
                    'stress':    round(m2, 4)
                })
            elif m1 < m2 and m1 < m0:
                pattern = 'PS trough'
                trough.append({
                    'name':      feat,
                    'normal':    round(m0, 4),
                    'prestress': round(m1, 4),
                    'stress':    round(m2, 4)
                })
            else:
                pattern = 'mixed'
                other.append(feat)

            feature_patterns.append({
                'name':      feat,
                'normal':    round(m0, 4),
                'prestress': round(m1, 4),
                'stress':    round(m2, 4),
                'pattern':   pattern
            })

        distinct_count = (
            len(monotonic_up) +
            len(phasic_peak)  +
            len(trough)
        )
        distinct_pct = distinct_count / len(feat_cols) * 100

        # ── PCA variance ──────────────────────────────────
        scaler   = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        pca      = PCA(n_components=2, random_state=42)
        pca.fit(X_scaled)
        pca_variance = float(
            sum(pca.explained_variance_ratio_) * 100
        )

        # ── Per-subject SCL_mean ordinal ──────────────────
        scl_idx      = feat_cols.index('SCL_mean') \
                       if 'SCL_mean' in feat_cols else None
        subject_scl  = []
        consistent   = 0

        if scl_idx is not None:
            for sid in sorted(np.unique(subjects)):
                smask = subjects == sid
                m0s   = float(np.mean(
                    X[smask & (y == 0), scl_idx]
                )) if (smask & (y == 0)).sum() > 0 else None
                m1s   = float(np.mean(
                    X[smask & (y == 1), scl_idx]
                )) if (smask & (y == 1)).sum() > 0 else None
                m2s   = float(np.mean(
                    X[smask & (y == 2), scl_idx]
                )) if (smask & (y == 2)).sum() > 0 else None

                if None not in [m0s, m1s, m2s]:
                    ordinal = bool(m0s < m1s < m2s)
                    if ordinal:
                        consistent += 1
                    subject_scl.append({
                        'id':        f'S{sid}',
                        'normal':    round(m0s, 3),
                        'prestress': round(m1s, 3),
                        'stress':    round(m2s, 3),
                        'ordinal':   ordinal
                    })

        return jsonify({
            'success':          True,
            'total_windows':    len(X),
            'total_features':   len(feat_cols),
            'total_subjects':   int(len(np.unique(subjects))),
            'n_normal':         n_normal,
            'n_prestress':      n_prestress,
            'n_stress':         n_stress,
            'distinct_count':   distinct_count,
            'distinct_pct':     round(distinct_pct, 1),
            'monotonic_count':  len(monotonic_up),
            'phasic_count':     len(phasic_peak),
            'trough_count':     len(trough),
            'other_count':      len(other),
            'pca_variance':     round(pca_variance, 1),
            'subject_consistent': consistent,
            'monotonic_features': monotonic_up,
            'phasic_features':    phasic_peak,
            'feature_patterns':   feature_patterns,
            'subject_scl':        subject_scl,
        })

    except FileNotFoundError:
        return jsonify({
            'error': 'Features CSV not found. '
                     'Run notebook 04 first.'
        }), 404
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500

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
    print(f"  POST /ema/update")
    print(f"  GET  /ema/history/<user_id>")
    print("=" * 50)
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True
    )