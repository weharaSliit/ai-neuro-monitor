"""
API Router for Validation (POST /validate), User Rating (POST /rating), and User Analytics (GET /user/analytics/{user_id}).
Tracks fast stress reduction speed and 5-star feedback to determine best-suited relaxation methods per user.
"""

import time
from fastapi import APIRouter
from app.models.schemas import (
    ValidationRequest,
    ValidationResponse,
    RatingRequest,
    RatingResponse,
    UserAnalyticsResponse
)
from app.services.validator import validator
from app.services.preference_learner import preference_learner
from app.services.fallback_handler import fallback_handler
from app.services.gamification_service import gamification_service
from app.services.closed_loop_tracker import closed_loop_tracker
from app.database.db_manager import db_manager

router = APIRouter(tags=["Validation & Rating"])

@router.post("/validate", response_model=ValidationResponse)
def validate_intervention_outcome(req: ValidationRequest):
    """
    POST /validate
    Computes combined closed-loop reward incorporating:
    1. Pre->Post stress reduction transition
    2. Short-time recovery speed
    3. User 5-star feedback rating
    Updates Thompson Bandit Beta parameters and gamification XP/badges.
    """
    cluster_id = req.context_cluster_id if req.context_cluster_id is not None else 0
    star_rating = req.star_rating or 5
    duration_sec = req.duration_seconds or 30.0

    reward, recovery_pct, transition_desc, alpha_updated, beta_updated = validator.validate_and_update(
        req.user_id, cluster_id, req.technique_id, req.pre_stress_label, req.post_stress_label, star_rating, duration_sec
    )
    
    # Record completion timestamp
    fallback_handler.record_technique_use(req.user_id, req.technique_id)
    
    # Evaluate gamification rewards & badges
    xp_earned, total_xp, is_normal, badge_items = gamification_service.record_intervention_outcome(
        req.user_id, req.technique_id, req.pre_stress_label, req.post_stress_label, reward
    )
    
    # Update closed-loop tracker state
    closed_loop_tracker.update_closed_loop(req.user_id, req.post_stress_label)

    # Import firebase_service to log outcome to relaxation_intervention
    from app.services import firebase_service
    val_session_id = getattr(req, 'session_id', None) or f"session_{int(time.time())}"
    val_payload = {
        "user_id": req.user_id,
        "session_id": val_session_id,
        "technique_id": req.technique_id,
        "pre_stress_label": req.pre_stress_label,
        "post_stress_label": req.post_stress_label,
        "reward": reward,
        "recovery_percentage": recovery_pct,
        "recovery_duration_seconds": duration_sec,
        "star_rating": star_rating,
        "context_cluster_id": cluster_id,
        "timestamp": time.time()
    }
    try:
        firebase_service.save_relaxation_intervention(req.user_id, val_session_id, val_payload)
    except Exception as e:
        print(f"[Firebase Warning] Could not save outcome to relaxation_intervention: {e}")

    # Log to persistent DB
    db_manager.log_intervention(
        user_id=req.user_id,
        technique_id=req.technique_id,
        sub_option_id="",
        cluster_id=cluster_id,
        pre_label=req.pre_stress_label,
        post_label=req.post_stress_label,
        reward=reward,
        recovery_pct=recovery_pct,
        timestamp=time.time()
    )

    # Closed-loop check: If baseline/normal state was NOT reached, compute alternative recommendation
    is_target_reached = (req.post_stress_label.lower() == "normal")
    alternative_rec = None

    if not is_target_reached:
        from app.config import TECHNIQUES
        from app.services.thompson_bandit import thompson_bandit
        usage_7d = fallback_handler.get_all_7day_usage_counts(req.user_id)
        alt_tech_id, alt_blended, alt_physio, alt_pref, alt_ms, _ = thompson_bandit.select_technique(
            req.user_id, cluster_id, usage_7d, exclude_technique_ids=[req.technique_id]
        )
        alt_catalog = TECHNIQUES.get(alt_tech_id, TECHNIQUES["breathing_garden"])
        alt_pref_sub = preference_learner.get_preferred_sub_option(req.user_id, alt_tech_id)
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
            "blended_score": round(alt_blended, 4),
            "reason": f"Baseline not reached yet. Smart AI selected {alt_catalog['title']} for further recovery."
        }

    return ValidationResponse(
        reward=reward,
        recovery_percentage=recovery_pct,
        transition=transition_desc,
        alpha_updated=round(alpha_updated, 2),
        beta_updated=round(beta_updated, 2),
        message=f"Closed-loop reward signal {reward:+.2f} updated. Earned +{xp_earned} XP!",
        xp_earned=xp_earned,
        total_xp=total_xp,
        is_normal_reached=is_target_reached,
        unlocked_badges=badge_items,
        closed_loop_status=closed_loop_tracker._user_loops.get(req.user_id, {}),
        alternative_recommendation=alternative_rec
    )

@router.post("/rating", response_model=RatingResponse)
def submit_user_rating(req: RatingRequest):
    """
    POST /rating
    Stores 1-5 star user feedback, updates preference weights, and logs rating to SQLite.
    """
    decayed_score = preference_learner.record_rating(
        req.user_id, req.technique_id, req.sub_option_id, req.rating_stars
    )
    
    normalized_score = (req.rating_stars - 1.0) / 4.0
    
    db_manager.log_rating(
        user_id=req.user_id,
        technique_id=req.technique_id,
        sub_option_id=req.sub_option_id,
        stars=req.rating_stars,
        timestamp=time.time()
    )

    return RatingResponse(
        normalized_score=round(normalized_score, 4),
        decayed_score=round(decayed_score, 4),
        message=f"Recorded {req.rating_stars}-star rating. Updated preference score to {decayed_score:.2f}."
    )

@router.get("/user/analytics/{user_id}")
def get_user_best_suited_technique_analytics(user_id: str):
    """
    GET /user/analytics/{user_id}
    Retrieves user-wise analytics identifying the BEST SUITED relaxation method
    based on short-time stress reduction speed and 5-star user feedback.
    """
    analytics = db_manager.get_best_suited_technique_analytics(user_id)
    return analytics
