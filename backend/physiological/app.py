import os
import sys

# Forces line buffering regardless of `python -u`/PYTHONUNBUFFERED -- same
# fix as the bridge scripts (backend/common/mqtt_bridge.py's identical
# comment). Without it, print()s from run_calibration_capture()'s
# background thread (app.py's /calibrate/start) sit queued in stdout's
# default block buffer instead of showing up live in Render's log viewer --
# a whole calibration attempt could finish before anything appeared, or
# some lines might never flush at all depending on buffer/thread timing.
sys.stdout.reconfigure(line_buffering=True)

from flask import jsonify, request, g
from werkzeug.security import generate_password_hash, check_password_hash
import re
import threading
from pathlib import Path
from firebase_admin import db

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.app_factory import create_app
from backend.common.config import (
    STRESS_COLORS,
    STRESS_LABELS,
    N_BASELINE_WIN,
    CALIBRATION_SOFT_AGE_DAYS, CALIBRATION_HARD_AGE_DAYS
)
from backend.common.auth import generate_token, require_auth
from backend.physiological.firebase_service import (
    init_firebase,
    create_user, get_user, list_users,
    create_user_with_password, set_password_hash,
    load_baseline, load_baseline_meta,
    load_personal_stress_threshold,
    save_prediction, get_session_predictions,
    get_recent_sessions,
    compute_baseline_drift, compute_baseline_drift_history,
    save_pss4, get_pss4_history,
    _ref,
    save_prediction_quality,
    save_fusion_en_rtdb,
    label_session_ground_truth_rtdb,
    get_device_status
)
from backend.physiological.predictor import (
    predict_window, predict_raw,
    feature_cols, StressStateMachine, STRESS_DECISION_THRESHOLD
)
from backend.common.config import (
    RAW_DECISION_THRESHOLD
)
from backend.physiological.extract_features import (
    extract_features, compute_signal_quality
)
from backend.physiological.calibration_capture import (
    save_calibration_windows, run_calibration_capture, run_task_calibration_capture
)

app = create_app(__name__)
init_firebase()

ring_sessions = {}

_calibration_sessions = {}

# user_id -> {'status': ..., ...} -- separate from _calibration_sessions
# above (baseline capture progress) so a threshold-task capture in
# progress never overwrites/gets overwritten by a concurrent baseline
# capture's own status polling. Mirrors backend/psychological/app.py's
# identical split.
_threshold_sessions = {}

# Guards the check-then-set in /calibrate/start and /calibrate/threshold/
# start below -- app.run() is started with threaded=True (see bottom of
# this file), so two near-simultaneous requests for the same user (a
# double-tap, a retry racing the original) can genuinely land on separate
# threads at the same time. Without this lock both requests can read
# _calibration_sessions.get(user_id) before either has written its own
# update, both pass the "already in progress" check, and both proceed --
# the second one resets window_idx back to 0 and starts a second capture
# thread competing with the first for the same status dict. Observed live
# as calibration progress reading "1/2" then suddenly "0/2".
_session_start_lock = threading.Lock()

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
    with _session_start_lock:
        current = _calibration_sessions.get(user_id)
        if current and current.get('status') in ('settling', 'capturing', 'saving'):
            return jsonify({'error': 'Calibration already in progress'}), 409

        _calibration_sessions[user_id] = {
            'status': 'settling', 'window_idx': 0, 'n_windows': N_BASELINE_WIN
        }

    def on_progress(status, extra):
        entry = {'status': status, 'n_windows': N_BASELINE_WIN}
        # Live per-window values for the calibration graphs: keep the last
        # list across every later status update (saving/done/skipped).
        prev_blocks = _calibration_sessions.get(user_id, {}).get('blocks')
        if extra.get('blocks') is not None:
            entry['blocks'] = extra['blocks']
        elif prev_blocks:
            entry['blocks'] = prev_blocks
        if status == 'window_captured':
            entry['status'] = 'capturing'
            entry['window_idx'] = extra['window_idx']
        elif status == 'window_skipped':
            entry['status'] = 'capturing'
            entry['window_idx'] = _calibration_sessions.get(
                user_id, {}
            ).get('window_idx', 0)
        elif status == 'error':
            # 'message', not 'error' -- CalibrateBreathingCard.js reads
            # ringState.message specifically; this used to be named 'error'
            # here, which that field never matched, so the real reason
            # (e.g. "insufficient clean heart-rate data -- check ring
            # contact/fit and retry") never reached the screen and it fell
            # through to the generic "Calibration failed" every time.
            entry['message'] = extra.get('message', 'Unknown error')
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


# -- /calibrate/threshold/start + /status -- personal STRESS_DECISION_THRESHOLD
# from a deliberate onboarding task (mirrors backend/psychological/app.py's
# /calibrate/threshold -- same idea, physiological's own on-demand-capture
# shape since this modality has no equivalent to EEG's already-warm,
# always-on mqtt_bridge.py session to submit pre-captured blocks to).
# Call only after /calibrate (or /calibrate/start) has already saved a
# baseline for this user -- run_task_calibration_capture() (calibration_capture.py)
# needs the resting scores that call saves.
@app.route('/calibrate/threshold/start', methods=['POST'])
@require_auth
def calibrate_threshold_start():
    user_id = g.user_id
    with _session_start_lock:
        current = _threshold_sessions.get(user_id)
        if current and current.get('status') in ('capturing', 'saving'):
            return jsonify({'error': 'Threshold calibration already in progress'}), 409

        _threshold_sessions[user_id] = {'status': 'capturing'}

    def on_progress(status, extra):
        if status == 'error':
            entry = {'status': 'error', 'error': extra.get('message', 'Unknown error')}
        elif status == 'done':
            # extra IS run_task_calibration_capture()'s outcome dict, which
            # already carries its own semantic 'status' ('ok'/'not_separated')
            # -- that must win over the generic phase-status 'done', not get
            # overwritten by it (an earlier version of this line did
            # entry.update(extra) THEN entry['status']=status, which clobbered
            # 'ok'/'not_separated' back to 'done' every time, so the frontend
            # could never actually see a successful personalization).
            entry = {'status': status, **extra}
        else:  # 'capturing' / 'window_skipped' / 'saving'
            entry = {'status': status, **extra}
        # Keep the live per-window values across every later status update.
        prev = _threshold_sessions.get(user_id, {})
        for k in ('blocks', 'resting_scores'):
            if k not in entry and prev.get(k):
                entry[k] = prev[k]
        _threshold_sessions[user_id] = entry

    def worker():
        run_task_calibration_capture(user_id, on_progress=on_progress)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({'status': 'started'})


@app.route('/calibrate/threshold/status', methods=['GET'])
@require_auth
def calibrate_threshold_status():
    state = _threshold_sessions.get(g.user_id, {'status': 'idle'})
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
        features_2d, motion_rejected, feat_dict, hrv_is_fallback, wave_dict = \
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

    # ── HRV fallback rejection ─────────────────────────────────
    # Previously silent: too little clean IBI data made extract_hrv_features()
    # substitute fixed placeholder values (AVNN: 800.0 etc.), which used to
    # get fed straight into the model as if they were a real reading --
    # capable of producing a confident-looking Normal/Stress label built on
    # fabricated features. Rejected the same way motion_rejected already is.
    if hrv_is_fallback:
        return jsonify({
            'hrv_fallback': True,
            'window_idx':   window_idx,
            'message':      'Window rejected — insufficient clean IBI data',
            'hint':         'Ensure MAX30102 has stable skin contact'
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

    # ── Personal STRESS_DECISION_THRESHOLD override, if this user has one ──
    # (see /calibrate/threshold/start + calibration_capture.py::
    # run_task_calibration_capture()) -- re-derives prediction/label from
    # the SAME prob_stress predict_window()/predict_raw() already computed,
    # just against this user's own threshold instead of the fixed
    # population one. confidence is max(prob_normal, prob_stress) either
    # way, so it's unaffected and left as-is.
    personal_threshold = load_personal_stress_threshold(user_id)
    if personal_threshold is not None:
        result = dict(result)
        result['prediction'] = 1 if result['prob_stress'] > personal_threshold else 0
        result['label'] = STRESS_LABELS[result['prediction']]
    # This user's EFFECTIVE threshold either way -- passed to
    # save_fusion_en_rtdb() below for the fusion engine's own
    # weighted-threshold combination (see fusion_engin.py::
    # compute_realtime_multimodal_fusion()), alongside EEG's own
    # effective_high_load_p.
    effective_threshold = personal_threshold if personal_threshold is not None else (
        RAW_DECISION_THRESHOLD if b_mean is None else STRESS_DECISION_THRESHOLD)

    # ── Save structured data only ──────────────────────────────
    save_prediction(
        user_id, session_id, window_idx,
        result['prediction'], result['label'],
        result['prob_normal'], result['prob_stress'],
        result['trending_toward_stress'], feat_dict,
        wave_dict
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
        feat_dict, effective_threshold
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
    ring_prob_stress = data.get('ring_prob_stress')
    eeg_prob_stress  = data.get('eeg_prob_stress')

    score = save_pss4(user_id, session_id, q1, q2, q3, q4, ring_prob_stress, eeg_prob_stress)
    label_session_ground_truth_rtdb(user_id, session_id, score)

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


# ── Response builders shared by the owner-only routes below and their
# /admin/... counterparts -- same data, the only difference between the two
# is which caller is allowed to reach it (self only vs any authenticated
# admin caller, see the /admin/ routes' own docstring further down).
def _history_response(user_id):
    return {
        'user_id':  user_id,
        'sessions': get_recent_sessions(user_id, limit=10),
        'pss4':     get_pss4_history(user_id)
    }


def _session_detail_response(user_id, session_id):
    return {
        'user_id':     user_id,
        'session_id':  session_id,
        'predictions': get_session_predictions(user_id, session_id)
    }


def _baseline_response(user_id):
    b_mean, b_std = load_baseline(user_id, feature_cols)
    meta = load_baseline_meta(user_id)

    if b_mean is None:
        return {'exists': False}

    age_days = meta.get('age_days')
    return {
        'exists':   True,
        'user_id':  user_id,
        'updated_at': meta.get('updated_at'),
        'age_days': age_days,
        'is_stale_soft': age_days is not None and age_days > CALIBRATION_SOFT_AGE_DAYS,
        'is_stale_hard': age_days is not None and age_days > CALIBRATION_HARD_AGE_DAYS,
        # None until the onboarding threshold task has actually separated
        # Rest from Task for this user (see compute_personal_stress_threshold()) --
        # exposed here (not just written) so the Fusion dashboard can show
        # what this user's stress threshold actually got personalized to.
        'personal_stress_threshold': load_personal_stress_threshold(user_id),
        # Piggybacks on this same call (not a separate endpoint/round-trip)
        # since CalibrationBanner already fetches this response on every
        # poll -- see compute_baseline_drift()'s docstring for what this
        # actually measures and its real limitation (can't tell "baseline
        # went stale" apart from "genuinely been stressed lately").
        'drift': compute_baseline_drift(user_id),
        'baseline': {
            feature_cols[i]: {
                'mean': float(b_mean[i]),
                'std':  float(b_std[i])
            }
            for i in range(len(feature_cols))
        }
    }


def _ema_history_response(user_id):
    ref  = _ref(f'ema_history/{user_id}')
    data = ref.get() or {}
    return {'user_id': user_id, 'ema_history': data}


@app.route('/history/<user_id>', methods=['GET'])
@require_auth
def get_history(user_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
    return jsonify(_history_response(user_id))


@app.route('/history/<user_id>/<session_id>',
           methods=['GET'])
@require_auth
def get_session_detail(user_id, session_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
    return jsonify(_session_detail_response(user_id, session_id))


@app.route('/baseline/<user_id>', methods=['GET'])
@require_auth
def get_baseline(user_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
    return jsonify(_baseline_response(user_id))


@app.route('/ema/history/<user_id>', methods=['GET'])
@require_auth
def get_ema_history(user_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
    return jsonify(_ema_history_response(user_id))


# -- /baseline/<user_id>/drift-history -- weekly-bucketed drift trend, for
# ProfileScreen.js's chart. Separate from /baseline/<user_id> above (which
# already carries the single current drift verdict for the calibration
# banner) since this one does more work (scans up to 200 recent sessions)
# and isn't needed on every poll the way the banner's check is.
@app.route('/baseline/<user_id>/drift-history', methods=['GET'])
@require_auth
def get_baseline_drift_history(user_id):
    if user_id != g.user_id:
        return jsonify({'error': 'Forbidden — token does not match requested user'}), 403
    return jsonify({'user_id': user_id, 'weeks': compute_baseline_drift_history(user_id)})


# ── Admin routes ──────────────────────────────────────────────────────
# Same data as the owner-only routes above, but for ANY user_id -- no
# ownership check, only @require_auth (a valid token, still required).
# Deliberate: no admin/role concept exists anywhere in this backend (by
# design, for a small research app with few accounts) -- any logged-in
# account can view any other account's data through these routes, matching
# StressApp's new post-login "User App / Admin App" chooser. Read-only;
# never touches the viewed user's own session/token.
@app.route('/admin/history/<user_id>', methods=['GET'])
@require_auth
def admin_get_history(user_id):
    return jsonify(_history_response(user_id))


@app.route('/admin/history/<user_id>/<session_id>', methods=['GET'])
@require_auth
def admin_get_session_detail(user_id, session_id):
    return jsonify(_session_detail_response(user_id, session_id))


@app.route('/admin/baseline/<user_id>', methods=['GET'])
@require_auth
def admin_get_baseline(user_id):
    return jsonify(_baseline_response(user_id))


@app.route('/admin/ema/history/<user_id>', methods=['GET'])
@require_auth
def admin_get_ema_history(user_id):
    return jsonify(_ema_history_response(user_id))


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
    print(f"  POST /calibrate/threshold/start  (auth required) — personal threshold task trigger")
    print(f"  GET  /calibrate/threshold/status (auth required) — poll threshold task progress")
    print(f"  POST /predict           ← binary (Normal/Stress) + trend")
    print(f"  GET  /devices/<device_id>/status")
    print(f"  POST /pss4")
    print(f"  GET  /history/<user_id>")
    print(f"  GET  /baseline/<user_id>")
    print(f"  GET  /ema/history/<user_id>  ← baseline-adaptation log (written on recalibration)")
    print(f"  GET  /admin/history/<user_id>, /admin/history/<user_id>/<session_id>,")
    print(f"       /admin/baseline/<user_id>, /admin/ema/history/<user_id>")
    print(f"       ← same data, any user_id, no ownership check (StressApp's Admin App)")
    print("=" * 50)
    # Render.com injects $PORT -- use it in production; default to 5050
    # locally (see backend/phenotyping_behavior/app.py's identical pattern).
    port = int(os.environ.get('PORT', 5050))
    app.run(
        host='0.0.0.0',
        port=port,
        debug=True,
        use_reloader=False,
        threaded=True
    )
