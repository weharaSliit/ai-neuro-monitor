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
    cluster_id = 0
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

    return ValidationResponse(
        reward=reward,
        recovery_percentage=recovery_pct,
        transition=transition_desc,
        alpha_updated=round(alpha_updated, 2),
        beta_updated=round(beta_updated, 2),
        message=f"Closed-loop reward signal {reward:+.2f} updated. Earned +{xp_earned} XP!",
        xp_earned=xp_earned,
        total_xp=total_xp,
        is_normal_reached=is_normal,
        unlocked_badges=badge_items
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
