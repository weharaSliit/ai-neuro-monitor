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
import math
from pathlib import Path
# pyrefly: ignore [missing-import]
from flask import jsonify, request
from flask_cors import CORS

# --- MODULE PATH FIX ---
repo_root = Path(__file__).resolve().parents[2]
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.common.app_factory import create_app
from backend.common.config import STRESS_COLORS
from backend.common.auth import verify_token

from backend.relaxation_guide.config import TECHNIQUES, BASELINE_MARGIN, TECHNIQUE_FAMILY_OF
from backend.relaxation_guide.services import firebase_service
from backend.relaxation_guide.services.telemetry_aggregator import telemetry_aggregator
from backend.relaxation_guide.services.missing_value_handler import missing_value_handler
from backend.relaxation_guide.services.kmeans_clusterer import kmeans_clusterer
from backend.relaxation_guide.services.thompson_bandit import thompson_bandit
from backend.relaxation_guide.services.preference_learner import preference_learner
from backend.relaxation_guide.services.fallback_handler import fallback_handler
from backend.relaxation_guide.services.validator import validator
from backend.relaxation_guide.services.gamification_service import gamification_service
from backend.relaxation_guide.services.closed_loop_tracker import closed_loop_tracker, decide_step
from backend.relaxation_guide.services.context_builder import context_builder, DEFAULT_BASELINE as DEFAULT_CONTEXT_BASELINE
from backend.relaxation_guide.services.intervention_context import combine_intervention_context
from backend.relaxation_guide.services.simulator_service import simulator_service
from backend.relaxation_guide.database.db_manager import db_manager

app = create_app(__name__)
firebase_service.init_firebase()


def _normalized_stress_score(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    score = float(value)
    if not math.isfinite(score):
        return None
    if score > 1.0:
        score /= 100.0
    return min(1.0, max(0.0, score))


def _phenotyping_stress_score(prediction):
    for key in ("stress_score", " stress_score", "stress_probability", "probability"):
        score = _normalized_stress_score(prediction.get(key))
        if score is not None:
            return score
    return None


def _user_baseline(user_id, fusion_data=None, default=0.35):
    baseline = firebase_service.get_baseline(user_id)
    if baseline is None and fusion_data:
        baseline = fusion_data.get("user_baseline")
    try:
        return float(baseline) if baseline is not None else default
    except (TypeError, ValueError):
        return default


_PHENO_CACHE = {}
_PHENO_TTL_SEC = 10.0


def _cached_pheno(user_id):
    """Latest phenotyping prediction, cached for a few seconds (the app polls every 2 s)."""
    now = time.time()
    hit = _PHENO_CACHE.get(user_id)
    if hit and now - hit[0] < _PHENO_TTL_SEC:
        return hit[1]
    value = firebase_service.get_latest_phenotyping_prediction(user_id)
    _PHENO_CACHE[user_id] = (now, value)
    return value


def _baseline_from(fusion_data, default=0.35):
    try:
        b = fusion_data.get("user_baseline") if fusion_data else None
        return float(b) if b is not None else default
    except (TypeError, ValueError):
        return default


def _context_summary(ctx):
    """Plain-JSON view of the person-relative context for the app and the logs."""
    keys = ("ready", "baseline", "combined", "z_rel", "slope_per_min", "physio", "pheno",
            "disagreement", "has_both_streams", "rise_alarm")
    return {k: (round(ctx[k], 4) if isinstance(ctx.get(k), float) else ctx.get(k)) for k in keys if k in ctx}


def _reason_text(selection):
    """Short, honest explanation of why the technique was chosen."""
    if not selection:
        return None
    codes = selection.get("reason_codes", [])
    parts = []
    if "learned_from_you" in codes:
        parts.append("Chosen from what has worked for you in similar situations")
    else:
        parts.append("Chosen to fit your current stress pattern while the system learns what works for you")
    for c in codes:
        if c.startswith("rotated_from:"):
            old = TECHNIQUES.get(c.split(":", 1)[1], {}).get("title")
            if old:
                parts.append(f"switched away from {old}, which has been losing effect")
        elif c == "works_for_you":
            parts.append("it has been working well for you recently")
    return "; ".join(parts) + "."


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

    # Feed the person-relative context (smoothed level, slope, CUSUM) from both streams.
    pheno_prediction = _cached_pheno(user_id)
    pheno_score = _phenotyping_stress_score(pheno_prediction)
    has_live_pheno_pkt = bool(pheno_prediction.get("has_live_packet", False)) and pheno_score is not None
    if has_live_pk or has_live_pheno_pkt:
        context_builder.update(
            user_id,
            _normalized_stress_score(stress_prob) if has_live_pk else None,
            pheno_score if has_live_pheno_pkt else None,
            baseline=user_baseline if user_baseline is not None else DEFAULT_CONTEXT_BASELINE,
        )

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
    res_dict["raw_label"] = fusion_data.get("raw_label", fused_lbl)
    res_dict["confidence"] = stress_prob
    res_dict["active_session_id"] = fusion_data.get("active_session_id")
    res_dict["context"] = _context_summary(
        context_builder.snapshot(user_id, baseline=user_baseline if user_baseline is not None else DEFAULT_CONTEXT_BASELINE))
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
    pheno_prediction = firebase_service.get_latest_phenotyping_prediction(user_id)
    pheno_label = pheno_prediction.get("label")
    pheno_score = _phenotyping_stress_score(pheno_prediction)
    physio_score = _normalized_stress_score(stress_prob)

    telemetry_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=user_id,
        fused_stress_label=fused_lbl,
        stress_probability=stress_prob,
        seconds_since_last_packet=0.0
    )
    processed = missing_value_handler.process_telemetry(telemetry_payload)
    context_snapshot = context_builder.snapshot(user_id, baseline=_baseline_from(fusion_data))

    return jsonify({
        "user_id": user_id,
        "is_live": bool(probability_vector),
        "is_calibrated": firebase_service.baseline_exists(user_id) or ("baseline" in raw_prediction),
        "raw_stress_label": raw_stress_label,
        "physio_stress_label": fused_lbl,
        "physio_stress_score": physio_score,
        "physio_recovery_percentage": round((1.0 - physio_score) * 100.0, 1) if physio_score is not None else None,
        "has_live_physio_packet": bool(fusion_data.get("has_live_packet", False)),
        "pheno_stress_label": pheno_label,
        "pheno_stress_score": pheno_score,
        "pheno_stress_probability": pheno_score,
        "pheno_recovery_percentage": round((1.0 - pheno_score) * 100.0, 1) if pheno_score is not None else None,
        "has_live_pheno_packet": bool(pheno_prediction.get("has_live_packet", False)) and pheno_score is not None,
        "active_pheno_session_id": pheno_prediction.get("active_session_id"),
        "context": _context_summary(context_snapshot),
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

    fusion_data = telemetry_aggregator.read_fusion_engine_output(user_id)
    has_live_physio = bool(fusion_data.get("has_live_packet", False))
    physio_label = (
        fusion_data.get("fused_stress_label", "normal")
        if has_live_physio
        else telemetry_data.get('fused_stress_label', 'normal')
    )
    fused_label = physio_label
    stress_prob = float(
        fusion_data.get("stress_probability", 0.50)
        if has_live_physio
        else telemetry_data.get('stress_probability', 0.50)
    )
    physio_score = _normalized_stress_score(stress_prob)
    recommendation_physio_score = physio_score if physio_score is not None else 0.50
    dt_sec = float(telemetry_data.get('seconds_since_last_packet', 0.0))
    ts = float(telemetry_data.get('timestamp', time.time()))

    pheno_prediction = firebase_service.get_latest_phenotyping_prediction(user_id)
    pheno_label = pheno_prediction.get('label')
    pheno_prob = _phenotyping_stress_score(pheno_prediction)
    has_live_pheno = bool(pheno_prediction.get('has_live_packet', False)) and pheno_prob is not None

    # When the ring/earbud are not streaming but phenotyping is, the physiological value from the app
    # is only a placeholder (offline = 0 or a default). Use phenotyping alone instead of blending it
    # with that placeholder, which would pull a stressed reading toward "normal".
    use_physio = has_live_physio or not has_live_pheno

    # Same blend and thresholds as the FastAPI backend (see intervention_context.py).
    # Physiological and phenotyping readings stay separate for live recovery.
    if use_physio:
        fused_label, stress_prob = combine_intervention_context(
            physio_label,
            recommendation_physio_score,
            pheno_label if has_live_pheno else None,
            pheno_prob if has_live_pheno else None,
        )
    else:
        fused_label, stress_prob = combine_intervention_context(pheno_label or "normal", pheno_prob)

    telemetry_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=user_id,
        fused_stress_label=fused_label,
        stress_probability=stress_prob,
        seconds_since_last_packet=dt_sec
    )

    processed_signal = missing_value_handler.process_telemetry(telemetry_payload)

    # Person-relative, smoothed context from both streams (not a single raw reading).
    user_baseline = _user_baseline(user_id, fusion_data)
    context_builder.update(
        user_id,
        physio_score if use_physio else None,
        pheno_prob if has_live_pheno else None,
        baseline=user_baseline,
    )
    context_snapshot = context_builder.snapshot(user_id, baseline=user_baseline)
    context_vector = context_snapshot["vector"]
    streams_used = {"physiological": bool(use_physio and has_live_physio), "phenotyping": bool(has_live_pheno)}
    cluster_id = kmeans_clusterer.predict_cluster(context_vector)
    usage_7d = fallback_handler.get_all_7day_usage_counts(user_id)

    tech_id, blended_score, s_physio, s_pref, exec_ms, _ = thompson_bandit.select_technique(
        user_id, cluster_id, usage_7d, context_vector=context_vector
    )
    selection = thompson_bandit.get_last_selection(user_id)

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
        "physio_stress_label": physio_label,
        "physio_stress_score": physio_score,
        "pheno_stress_label": pheno_label,
        "pheno_stress_score": pheno_prob,
        "recommended_technique_id": tech_id,
        "selected_sub_option_id": selected_sub["id"],
        "context_cluster_id": cluster_id,
        "context": _context_summary(context_snapshot),
        "reason_codes": (selection or {}).get("reason_codes", []),
        "blended_score": round(blended_score, 4),
        "physiological_sample": round(s_physio, 4),
        "preference_score": round(s_pref, 4),
        "execution_time_ms": round(exec_ms, 2)
    }
    thompson_bandit.remember_context(user_id, session_id, cluster_id, context_vector, tech_id)

    try:
        firebase_service.save_relaxation_intervention(user_id, session_id, session_payload)
    except Exception as e:
        print(f"[Firebase Warning] Could not save intervention session to Firebase: {e}")

    return jsonify({
        "technique_id": tech_id,
        "title": tech_catalog["title"],
        "description": tech_catalog["description"],
        "fused_stress_label": fused_label,
        "stress_probability": stress_prob,
        "selected_sub_option": selected_sub,
        "available_sub_options": sub_options,
        "physio_stress_label": fusion_data.get("fused_stress_label", fused_label),
        "physio_stress_score": physio_score,
        "physio_recovery_percentage": round((1.0 - physio_score) * 100.0, 1) if physio_score is not None else None,
        "has_live_physio_packet": has_live_physio,
        "pheno_stress_label": pheno_label,
        "pheno_stress_score": pheno_prob,
        "pheno_recovery_percentage": round((1.0 - pheno_prob) * 100.0, 1) if pheno_prob is not None else None,
        "has_live_pheno_packet": has_live_pheno,
        "active_pheno_session_id": pheno_prediction.get("active_session_id"),
        "context_cluster_id": cluster_id,
        "session_id": session_id,
        "streams_used": streams_used,
        "context": _context_summary(context_snapshot),
        "reason": _reason_text(selection),
        "reason_codes": (selection or {}).get("reason_codes", []),
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
    cluster_id = kmeans_clusterer.predict_cluster(context_builder.snapshot(user_id)["vector"])

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
    # The web and the app may report the game id (e.g. water_lily_pond); the bandit learns per technique family.
    technique_id = TECHNIQUE_FAMILY_OF.get(technique_id, technique_id)
    pre_label = data.get('pre_stress_label', 'stress')
    post_label = data.get('post_stress_label', 'normal')
    star_rating = int(data.get('star_rating', 5))
    duration_sec = float(data.get('duration_seconds', 30.0))
    cluster_id = int(data.get('context_cluster_id', 0))
    session_key = data.get('session_id')
    stress_trajectory = data.get('stress_trajectory')

    # Context captured when this technique was recommended (so learning uses the same features).
    stored_ctx = thompson_bandit.pop_context(user_id, session_key)
    context_vector = None
    if stored_ctx and stored_ctx.get("technique_id") == technique_id:
        context_vector = stored_ctx["vector"]
        cluster_id = int(stored_ctx["cluster_id"])

    fusion_data = telemetry_aggregator.read_fusion_engine_output(user_id)
    user_baseline = firebase_service.get_baseline(user_id)
    if user_baseline is None:
        user_baseline = float(fusion_data.get("user_baseline", 0.25))

    reward, recovery_pct, transition_desc, alpha_updated, beta_updated = validator.validate_and_update(
        user_id, cluster_id, technique_id, pre_label, post_label, star_rating, duration_sec,
        trajectory=stress_trajectory, baseline=user_baseline, context_vector=context_vector
    )
    reward_components = validator.last_components

    fallback_handler.record_technique_use(user_id, technique_id)

    prob_stress = data.get('prob_stress')
    if prob_stress is None:
        prob_stress = data.get('stress_probability')
    if prob_stress is None:
        prob_stress = data.get('post_stress_prob')
    if prob_stress is None:
        prob_stress = fusion_data.get("stress_probability", 0.20 if post_label.lower() == "normal" else 0.70)
    prob_stress = float(prob_stress)
    if reward_components:
        # Measured end-of-session stress replaces the self-reported / looked-up value.
        prob_stress = float(reward_components["end_stress"])

    loop_res = closed_loop_tracker.update_closed_loop(
        user_id=user_id,
        current_state=post_label,
        prob_stress=prob_stress,
        user_baseline=user_baseline,
        last_technique_id=technique_id,
        context_vector=context_builder.snapshot(user_id, baseline=user_baseline)["vector"]
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
        "reward_components": reward_components,
        "context_vector": context_vector,
        "timestamp": time.time()
    }
    try:
        firebase_service.save_relaxation_intervention(user_id, val_session_id, val_payload)
    except Exception as e:
        print(f"[Firebase Warning] Could not save outcome to relaxation_intervention: {e}")

    try:
        db_manager.save_intervention(
            user_id, val_session_id, technique_id, pre_label, post_label,
            reward, recovery_pct, duration_sec
        )
    except Exception as e:
        print(f"[DB Warning] Could not store intervention locally: {e}")

    badges_payload = [b.dict() if hasattr(b, 'dict') else b for b in badge_items]

    # Closed-loop check: If baseline/normal state was NOT reached, compute alternative recommendation
    if reward_components:
        is_target_reached = prob_stress <= user_baseline + BASELINE_MARGIN
    else:
        is_target_reached = (post_label.lower() == "normal" and prob_stress <= user_baseline)
    alternative_rec = None

    if not is_target_reached:
        usage_7d = fallback_handler.get_all_7day_usage_counts(user_id)
        alt_context = context_builder.snapshot(user_id, baseline=user_baseline)["vector"]
        alt_cluster = kmeans_clusterer.predict_cluster(alt_context)
        alt_tech_id, alt_blended, alt_physio, alt_pref, alt_ms, _ = thompson_bandit.select_technique(
            user_id, alt_cluster, usage_7d, exclude_technique_ids=[technique_id], context_vector=alt_context
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
            "context_cluster_id": alt_cluster,
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
        "measured": bool(reward_components),
        "reward_components": ({k: (round(v, 4) if isinstance(v, float) else v)
                               for k, v in reward_components.items()} if reward_components else None),
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


@app.route('/loop/step', methods=['POST'])
def loop_step():
    """Mid-session check: keep going, switch technique, or stop (uses filtered stress level + slope)."""
    data = request.get_json() or {}
    user_id = data.get('user_id', 'user_default')
    technique_id = data.get('technique_id')
    elapsed = float(data.get('elapsed_seconds', 0.0))
    tried = [t for t in (data.get('tried_techniques') or []) if t]
    if technique_id and technique_id not in tried:
        tried.append(technique_id)

    fusion_data = telemetry_aggregator.read_fusion_engine_output(user_id)
    baseline = _user_baseline(user_id, fusion_data)
    ctx = context_builder.snapshot(user_id, baseline=baseline)
    decision = decide_step(ctx, elapsed)
    response = {"action": decision["action"], "reason": decision["reason"], "context": _context_summary(ctx)}

    if decision["action"] == "switch":
        cluster_id = kmeans_clusterer.predict_cluster(ctx["vector"])
        usage_7d = fallback_handler.get_all_7day_usage_counts(user_id)
        next_id, blended, s_physio, s_pref, _, _ = thompson_bandit.select_technique(
            user_id, cluster_id, usage_7d, exclude_technique_ids=tried, context_vector=ctx["vector"]
        )
        catalog = TECHNIQUES.get(next_id, TECHNIQUES["breathing_garden"])
        sub = catalog["sub_options"][0]
        pref_sub = preference_learner.get_preferred_sub_option(user_id, next_id)
        for so in catalog["sub_options"]:
            if so["id"] == pref_sub:
                sub = so
                break
        response["next_recommendation"] = {
            "technique_id": next_id,
            "title": catalog["title"],
            "description": catalog["description"],
            "selected_sub_option": sub,
            "available_sub_options": catalog["sub_options"],
            "context_cluster_id": cluster_id,
            "blended_score": round(blended, 4),
        }
    return jsonify(response), 200


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

    try:
        db_manager.save_rating(user_id, technique_id, sub_option_id, rating_stars, time.time())
    except Exception as e:
        print(f"[DB Warning] Could not store rating locally: {e}")

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


# Development only: simulated stress readings (no hardware, no Firebase writes).
# Start the backend with RELAXATION_DEV_SIM=1 to enable it; nothing changes otherwise.
if os.environ.get("RELAXATION_DEV_SIM") == "1":
    from backend.relaxation_guide.services import dev_simulation
    dev_simulation.install(app, firebase_service, telemetry_aggregator)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=True)
