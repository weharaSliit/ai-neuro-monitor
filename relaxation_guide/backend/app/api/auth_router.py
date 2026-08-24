"""
API Router for user-scoped data (profile, calibration status).

No sign-up/sign-in here: identity is StressApp's own login (backend/
physiological's /register + /login). Every route below requires that same
shared Bearer token (see app/shared_auth.py) and checks it against the
path user_id, rather than trusting the path value on its own.
"""

from fastapi import APIRouter, Depends
from app.models.schemas import UserProfileResponse
from app.services.gamification_service import gamification_service
from app.services import firebase_service
from app.database.db_manager import db_manager
from app.shared_auth import require_auth, require_self

router = APIRouter(tags=["Authentication"])


@router.get("/user/profile/{user_id}", response_model=UserProfileResponse)
def get_user_profile(user_id: str, token_user_id: str = Depends(require_auth)):
    """
    GET /user/profile/{user_id}
    Retrieves user stats, XP, streak, and badges.
    """
    require_self(user_id, token_user_id)
    user = db_manager.get_user_by_id(user_id)
    user_email = user["email"] if user else f"{user_id}@caps-research.org"
    user_full_name = user["full_name"] if user else user_id.replace("user_", "").replace("guest_", "").capitalize()

    xp, streak, badge_items = gamification_service.get_user_badges_and_stats(user_id)
    history = db_manager.get_intervention_history(user_id)

    return UserProfileResponse(
        user_id=user_id,
        email=user_email,
        full_name=user_full_name,
        xp_points=xp,
        streak_days=streak,
        badges=badge_items,
        recent_interventions_count=len(history)
    )


@router.get("/user/calibration-status/{user_id}")
def get_calibration_status(user_id: str, token_user_id: str = Depends(require_auth)):
    """
    GET /user/calibration-status/{user_id}
    Durable, cross-device "has this user finished the one-time onboarding
    flow" signal (privacy consent + personalization survey + permissions +
    2-min baseline calibration all funnel into this single gate). The
    frontend uses this on login to decide whether to show that flow again
    or skip straight to the Dashboard for a returning user.
    """
    require_self(user_id, token_user_id)
    return {"user_id": user_id, "is_calibrated": firebase_service.baseline_exists(user_id)}


@router.post("/user/calibration-status/{user_id}")
def complete_calibration(user_id: str, token_user_id: str = Depends(require_auth)):
    """
    POST /user/calibration-status/{user_id}
    Persists that this user has completed the 2-min baseline calibration,
    so get_calibration_status() returns True for them from now on.
    """
    require_self(user_id, token_user_id)
    firebase_service.save_baseline(user_id)
    return {"user_id": user_id, "is_calibrated": True}
