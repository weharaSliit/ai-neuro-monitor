"""
============================================================
app.py -- Relaxation Guide & Adaptive Neural Stress Intervention API server.
Mirrors backend/physiological/app.py, backend/psychological/app.py,
and backend/phenotyping_behavior/app.py shape using Flask & CORS.
============================================================
"""

import sys
import os
import time
from pathlib import Path
from flask import jsonify, request, g
from flask_cors import CORS

# --- MODULE PATH FIX ---
repo_root = Path(__file__).resolve().parents[2]
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.common.app_factory import create_app
from backend.common.config import STRESS_COLORS
from backend.common.auth import verify_token

from backend.relaxation_guide.config import TECHNIQUES
from backend.relaxation_guide.services import firebase_service
from backend.relaxation_guide.services.telemetry_aggregator import telemetry_aggregator
from backend.relaxation_guide.services.missing_value_handler import missing_value_handler
from backend.relaxation_guide.services.kmeans_clusterer import kmeans_clusterer
from backend.relaxation_guide.services.thompson_bandit import thompson_bandit
from backend.relaxation_guide.services.preference_learner import preference_learner
from backend.relaxation_guide.services.fallback_handler import fallback_handler
from backend.relaxation_guide.services.validator import validator
from backend.relaxation_guide.services.gamification_service import gamification_service
from backend.relaxation_guide.services.closed_loop_tracker import closed_loop_tracker
from backend.relaxation_guide.services.simulator_service import simulator_service
from backend.relaxation_guide.database.db_manager import db_manager

app = create_app(__name__)
firebase_service.init_firebase()


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'running',
        'module': 'relaxation_guide',
        'framework': 'Flask',
        'version': '3.0.0'
    }), 200


@app.route('/auth/register', methods=['POST'])
def auth_register():
    data = request.get_json() or {}
    email = data.get('email', '')
    user_id = data.get('user_id') or email.split('@')[0] or 'user_default'
    full_name = data.get('full_name', 'Participant')

    firebase_service.save_baseline(user_id, 120)
    return jsonify({
        'user_id': user_id,
        'email': email,
        'full_name': full_name,
        'is_calibrated': True,
        'message': 'Registration completed and baseline calibration saved.'
    }), 200


@app.route('/auth/login', methods=['POST'])
def auth_login():
    data = request.get_json() or {}
    email = data.get('email', '')
    user_id = data.get('user_id') or email.split('@')[0] or 'user_default'
    full_name = data.get('full_name', 'Participant')

    is_calibrated = firebase_service.baseline_exists(user_id)
    return jsonify({
        'user_id': user_id,
        'email': email,
        'full_name': full_name,
        'is_calibrated': is_calibrated,
        'message': 'Login successful.'
    }), 200


@app.route('/telemetry/ingest', methods=['POST'])
def ingest_telemetry():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'user_default')
    fused_label = data.get('fused_stress_label', 'normal')
    stress_prob = float(data.get('stress_probability', 0.50))
    dt_sec = float(data.get('seconds_since_last_packet', 0.0))

    telemetry_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=user_id,
        fused_stress_label=fused_label,
        stress_probability=stress_prob,
        seconds_since_last_packet=dt_sec
    )
    processed = missing_value_handler.process_telemetry(telemetry_payload)
    return jsonify(processed.model_dump() if hasattr(processed, "model_dump") else processed.dict()), 200


@app.route('/telemetry/fusion-output', methods=['GET'])
@app.route('/telemetry/local-files', methods=['GET'])
def read_and_process_fusion_output():
    user_id = request.args.get('user_id', 'user_default')
    session_id = request.args.get('session_id')

    fusion_data = telemetry_aggregator.read_fusion_engine_output(user_id, session_id)
    fused_lbl = fusion_data.get("fused_stress_label", fusion_data.get("label", "normal"))
    stress_prob = float(fusion_data.get("stress_probability", fusion_data.get("probability", 0.50)))
    user_baseline = fusion_data.get("user_baseline")
    if user_baseline is not None:
        user_baseline = float(user_baseline)

    has_live_pk = bool(fusion_data.get("has_live_packet", False))
    is_calib = bool(fusion_data.get("is_calibrated", False))

    telemetry_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=user_id,
        fused_stress_label=fused_lbl,
        stress_probability=stress_prob,
        seconds_since_last_packet=0.0 if has_live_pk else 999.0,
        has_live_packet=has_live_pk,
        user_baseline=user_baseline
    )
    processed = missing_value_handler.process_telemetry(telemetry_payload)
    res_dict = processed.model_dump() if hasattr(processed, "model_dump") else processed.dict()
    res_dict["user_baseline"] = user_baseline
    res_dict["has_live_packet"] = has_live_pk
    res_dict["is_calibrated"] = is_calib
    return jsonify(res_dict), 200


@app.route('/telemetry/pipeline', methods=['GET'])
def get_fusion_pipeline():
    user_id = request.args.get('user_id', 'user_default')
    session_id = request.args.get('session_id')

    raw_prediction = firebase_service.get_latest_prediction(user_id, session_id)
    probability_vector = raw_prediction.get("probability_vector") or {}
    raw_stress_label = raw_prediction.get("stress_label")

    fusion_data = telemetry_aggregator.read_fusion_engine_output(user_id, session_id)
    fused_lbl = fusion_data.get("fused_stress_label", "normal")
    stress_prob = float(fusion_data.get("stress_probability", 0.50))

    telemetry_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=user_id,
        fused_stress_label=fused_lbl,
        stress_probability=stress_prob,
        seconds_since_last_packet=0.0
    )
    processed = missing_value_handler.process_telemetry(telemetry_payload)

    return jsonify({
        "user_id": user_id,
        "is_live": bool(probability_vector),
        "is_calibrated": firebase_service.baseline_exists(user_id) or ("baseline" in raw_prediction),
        "raw_stress_label": raw_stress_label,
        "user_baseline": fusion_data.get("user_baseline", raw_prediction.get("baseline", 0.35)),
        "probability_vector": {
            "eeg": probability_vector.get("eeg"),
            "hrv_gsr": probability_vector.get("hrv_gsr"),
            "behav": probability_vector.get("behav"),
            "fused": probability_vector.get("fused")
        },
        "processed": processed.model_dump() if hasattr(processed, "model_dump") else processed.dict()
    }), 200


@app.route('/intervention', methods=['POST'])
def get_personalized_intervention():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'user_default')
    telemetry_data = data.get('telemetry', {})
    
    if not telemetry_data:
        telemetry_data = data

    fused_label = telemetry_data.get('fused_stress_label', 'normal')
    stress_prob = float(telemetry_data.get('stress_probability', 0.50))
    dt_sec = float(telemetry_data.get('seconds_since_last_packet', 0.0))
    ts = float(telemetry_data.get('timestamp', time.time()))

    telemetry_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=user_id,
        fused_stress_label=fused_label,
        stress_probability=stress_prob,
        seconds_since_last_packet=dt_sec
    )

    processed_signal = missing_value_handler.process_telemetry(telemetry_payload)
    cluster_id = kmeans_clusterer.predict_cluster(processed_signal.features_flat)
    usage_7d = fallback_handler.get_all_7day_usage_counts(user_id)

    tech_id, blended_score, s_physio, s_pref, exec_ms, _ = thompson_bandit.select_technique(
        user_id, cluster_id, usage_7d
    )

    tech_catalog = TECHNIQUES.get(tech_id, TECHNIQUES["breathing_garden"])
    preferred_sub_id = preference_learner.get_preferred_sub_option(user_id, tech_id)
    sub_options = tech_catalog["sub_options"]

    selected_sub = sub_options[0]
    if preferred_sub_id:
        for so in sub_options:
            if so["id"] == preferred_sub_id:
                selected_sub = so
                break

    session_id = data.get('session_id') or telemetry_data.get('session_id') or f"session_{int(ts)}"
    session_payload = {
        "user_id": user_id,
        "session_id": session_id,
        "timestamp": ts,
        "fused_stress_label": fused_label,
        "stress_probability": stress_prob,
        "recommended_technique_id": tech_id,
        "selected_sub_option_id": selected_sub["id"],
        "context_cluster_id": cluster_id,
        "blended_score": round(blended_score, 4),
        "physiological_sample": round(s_physio, 4),
        "preference_score": round(s_pref, 4),
        "execution_time_ms": round(exec_ms, 2)
    }

    try:
        firebase_service.save_relaxation_intervention(user_id, session_id, session_payload)
    except Exception as e:
        print(f"[Firebase Warning] Could not save intervention session to Firebase: {e}")

    return jsonify({
        "technique_id": tech_id,
        "title": tech_catalog["title"],
        "description": tech_catalog["description"],
        "selected_sub_option": selected_sub,
        "available_sub_options": sub_options,
        "context_cluster_id": cluster_id,
        "blended_score": round(blended_score, 4),
        "physiological_sample": round(s_physio, 4),
        "preference_score": round(s_pref, 4),
        "execution_time_ms": round(exec_ms, 2)
    }), 200


@app.route('/fallback', methods=['POST'])
def handle_fallback():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'user_default')
    rejected_tech_id = data.get('rejected_technique_id', 'breathing_garden')

    telemetry_summary = telemetry_aggregator.read_fusion_engine_output(user_id)
    raw_lbl = telemetry_summary.get("fused_stress_label", "normal")
    prob_val = telemetry_summary.get("stress_probability", 0.50)

    payload = telemetry_aggregator.parse_fusion_payload(user_id, raw_lbl, prob_val)
    processed = missing_value_handler.process_telemetry(payload)
    cluster_id = kmeans_clusterer.predict_cluster(processed.features_flat)

    level, alt_ids, level2_reset, level3_prompts = fallback_handler.process_rejection(
        user_id, cluster_id, rejected_tech_id
    )

    level1_recommendations = []
    if level == 1:
        for alt_id in alt_ids:
            tech_cat = TECHNIQUES.get(alt_id, TECHNIQUES["guided_meditation"])
            pref_sub = preference_learner.get_preferred_sub_option(user_id, alt_id)
            sub_opts = tech_cat["sub_options"]
            sel_sub = sub_opts[0]
            if pref_sub:
                for so in sub_opts:
                    if so["id"] == pref_sub:
                        sel_sub = so
                        break

            level1_recommendations.append({
                "technique_id": alt_id,
                "title": tech_cat["title"],
                "description": tech_cat["description"],
                "selected_sub_option": sel_sub,
                "available_sub_options": sub_opts,
                "context_cluster_id": cluster_id,
                "blended_score": 0.70,
                "physiological_sample": 0.70,
                "preference_score": 0.70,
                "execution_time_ms": 1.0
            })

    return jsonify({
        "fallback_level": level,
        "level1_alternatives": level1_recommendations if level == 1 else None,
        "level2_breathing_reset": level2_reset if level == 2 else None,
        "level3_prompt_options": level3_prompts if level == 3 else None
    }), 200


@app.route('/validate', methods=['POST'])
def validate_intervention():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'user_default')
    technique_id = data.get('technique_id', 'breathing_garden')
    pre_label = data.get('pre_stress_label', 'stress')
    post_label = data.get('post_stress_label', 'normal')
    star_rating = int(data.get('star_rating', 5))
    duration_sec = float(data.get('duration_seconds', 30.0))
    cluster_id = int(data.get('context_cluster_id', 0))

    reward, recovery_pct, transition_desc, alpha_updated, beta_updated = validator.validate_and_update(
        user_id, cluster_id, technique_id, pre_label, post_label, star_rating, duration_sec
    )

    fallback_handler.record_technique_use(user_id, technique_id)

    fusion_data = telemetry_aggregator.read_fusion_engine_output(user_id)
    user_baseline = firebase_service.get_baseline(user_id)
    if user_baseline is None:
        user_baseline = float(fusion_data.get("user_baseline", 0.25))

    prob_stress = data.get('prob_stress')
    if prob_stress is None:
        prob_stress = data.get('stress_probability')
    if prob_stress is None:
        prob_stress = data.get('post_stress_prob')
    if prob_stress is None:
        prob_stress = fusion_data.get("stress_probability", 0.20 if post_label.lower() == "normal" else 0.70)
    prob_stress = float(prob_stress)

    loop_res = closed_loop_tracker.update_closed_loop(
        user_id=user_id,
        current_state=post_label,
        prob_stress=prob_stress,
        user_baseline=user_baseline,
        last_technique_id=technique_id
    )

    xp_earned, total_xp, is_normal, badge_items = gamification_service.record_intervention_outcome(
        user_id, technique_id, pre_label, post_label, reward
    )

    val_session_id = data.get('session_id') or f"session_{int(time.time())}"
    val_payload = {
        "user_id": user_id,
        "session_id": val_session_id,
        "technique_id": technique_id,
        "pre_stress_label": pre_label,
        "post_stress_label": post_label,
        "reward": reward,
        "recovery_percentage": recovery_pct,
        "recovery_duration_seconds": duration_sec,
        "star_rating": star_rating,
        "context_cluster_id": cluster_id,
        "timestamp": time.time()
    }
    try:
        firebase_service.save_relaxation_intervention(user_id, val_session_id, val_payload)
    except Exception as e:
        print(f"[Firebase Warning] Could not save outcome to relaxation_intervention: {e}")

    db_manager.log_intervention(
        user_id=user_id,
        technique_id=technique_id,
        sub_option_id="",
        cluster_id=cluster_id,
        pre_label=pre_label,
        post_label=post_label,
        reward=reward,
        recovery_pct=recovery_pct,
        timestamp=time.time()
    )

    badges_payload = [b.dict() if hasattr(b, 'dict') else b for b in badge_items]

    # Closed-loop check: If baseline/normal state was NOT reached, compute alternative recommendation
    is_target_reached = (post_label.lower() == "normal" and prob_stress <= user_baseline)
    alternative_rec = None

    if not is_target_reached:
        usage_7d = fallback_handler.get_all_7day_usage_counts(user_id)
        alt_tech_id, alt_blended, alt_physio, alt_pref, alt_ms, _ = thompson_bandit.select_technique(
            user_id, cluster_id, usage_7d, exclude_technique_ids=[technique_id]
        )
        alt_catalog = TECHNIQUES.get(alt_tech_id, TECHNIQUES["breathing_garden"])
        alt_pref_sub = preference_learner.get_preferred_sub_option(user_id, alt_tech_id)
        alt_sub_opts = alt_catalog["sub_options"]
        alt_sel_sub = alt_sub_opts[0]
        if alt_pref_sub:
            for so in alt_sub_opts:
                if so["id"] == alt_pref_sub:
                    alt_sel_sub = so
                    break

        alternative_rec = {
            "technique_id": alt_tech_id,
            "title": alt_catalog["title"],
            "description": alt_catalog["description"],
            "selected_sub_option": alt_sel_sub,
            "available_sub_options": alt_sub_opts,
            "context_cluster_id": cluster_id,
            "stress_probability": prob_stress,
            "blended_score": round(alt_blended, 4),
            "reason": f"Baseline not reached yet ({int(prob_stress * 100)}% Stress). Smart AI selected {alt_catalog['title']} for further recovery."
        }

        if isinstance(loop_res, dict):
            loop_res["next_recommended_technique_id"] = alt_tech_id
            loop_res["next_recommended_technique_name"] = alt_catalog["title"]
            loop_res["guidance_message"] = (
                f"⚡ Baseline Not Reached (Stress Prob: {int(prob_stress * 100)}%). "
                f"Smart AI recommends '{alt_catalog['title']}' to complete your baseline recovery."
            )

    return jsonify({
        "reward": reward,
        "recovery_percentage": recovery_pct,
        "transition": transition_desc,
        "alpha_updated": round(alpha_updated, 2),
        "beta_updated": round(beta_updated, 2),
        "message": f"Closed-loop reward signal {reward:+.2f} updated. Earned +{xp_earned} XP!",
        "xp_earned": xp_earned,
        "total_xp": total_xp,
        "is_normal": is_target_reached,
        "is_normal_reached": is_target_reached,
        "badges_earned": badges_payload,
        "unlocked_badges": badges_payload,
        "closed_loop_status": loop_res,
        "alternative_recommendation": alternative_rec
    }), 200


@app.route('/rating', methods=['POST'])
def submit_user_rating():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'user_default')
    technique_id = data.get('technique_id', 'breathing_garden')
    sub_option_id = data.get('sub_option_id', '')
    rating_stars = int(data.get('rating_stars', 5))

    decayed_score = preference_learner.record_rating(
        user_id, technique_id, sub_option_id, rating_stars
    )
    normalized_score = (rating_stars - 1.0) / 4.0

    db_manager.log_rating(user_id, technique_id, sub_option_id, rating_stars, time.time())

    return jsonify({
        "normalized_score": round(normalized_score, 2),
        "decayed_score": round(decayed_score, 4),
        "message": f"Successfully recorded {rating_stars}-star rating."
    }), 200


@app.route('/bandit/state', methods=['GET'])
def get_user_bandit_state():
    user_id = request.args.get('user_id', 'user_default')
    bandit_dists = thompson_bandit.get_user_bandit_state(user_id)
    pref_summary = preference_learner.get_user_preference_summary(user_id)
    return jsonify({
        "user_id": user_id,
        "clusters": bandit_dists,
        "preference_history": pref_summary
    }), 200


@app.route('/simulator/mode', methods=['GET', 'POST'])
def simulation_mode():
    if request.method == 'POST':
        data = request.get_json() or {}
        mode = data.get('mode', 'normal')
        simulator_service.set_simulation_mode(mode)
        return jsonify({"message": f"Simulator mode set to '{mode}'."}), 200

    return jsonify({
        "current_mode": simulator_service._current_mode,
        "available_modes": ["normal", "stress", "safety_override_test"]
    }), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=True)
