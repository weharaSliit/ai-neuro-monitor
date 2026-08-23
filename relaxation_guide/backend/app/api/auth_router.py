"""
API Router for User Authentication.
Simple sign-up / sign-in flow — no email verification required.
All user data is saved directly to Firebase via DatabaseManager.
"""

from fastapi import APIRouter, HTTPException, status
from app.models.schemas import (
    SignUpRequest,
    SignInRequest,
    AuthResponse,
    UserProfileResponse
)
from app.services.gamification_service import gamification_service
from app.database.db_manager import db_manager

router = APIRouter(tags=["Authentication"])

@router.post("/auth/signup", response_model=AuthResponse)
def sign_up(req: SignUpRequest):
    """
    POST /auth/signup
    Registers a new user and immediately activates the account.
    No email verification required.
    """
    existing_user = db_manager.get_user_by_email(req.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists. Please sign in instead."
        )

    user_data = db_manager.create_user(req.email, req.password, req.full_name)
    user_id = user_data["user_id"]

    return AuthResponse(
        user_id=user_id,
        email=req.email,
        full_name=req.full_name,
        token=f"token_{user_id}_authorized",
        is_email_verified=True,
        verification_code=None,
        message="Registration successful! Welcome to Calm AI."
    )


@router.post("/auth/signin", response_model=AuthResponse)
def sign_in(req: SignInRequest):
    """
    POST /auth/signin
    Authenticates an existing user by email and password.
    """
    user = db_manager.get_user_by_email(req.email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No account found for this email. Please sign up first."
        )

    if user["password"] != req.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please check your credentials and try again."
        )

    user_id = user["user_id"]
    return AuthResponse(
        user_id=user_id,
        email=user["email"],
        full_name=user["full_name"],
        token=f"token_{user_id}_secret",
        is_email_verified=True,
        verification_code=None,
        message="Sign in successful."
    )


@router.get("/user/profile/{user_id}", response_model=UserProfileResponse)
def get_user_profile(user_id: str):
    """
    GET /user/profile/{user_id}
    Retrieves user stats, XP, streak, and badges.
    """
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
