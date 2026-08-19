"""
API Router for User Authentication and Email Authorization.
Provides strict authentication (/auth/signup, /auth/signin, /auth/verify-email, /auth/resend-code)
and user profile tracking backed by Firebase Firestore / SQLite DatabaseManager.
"""

from fastapi import APIRouter, HTTPException, status
from app.models.schemas import (
    SignUpRequest,
    SignInRequest,
    VerifyEmailRequest,
    ResendCodeRequest,
    AuthResponse,
    UserProfileResponse
)
from app.services.gamification_service import gamification_service
from app.services.email_service import email_service
from app.database.db_manager import db_manager

router = APIRouter(tags=["Authentication & Authorization"])

@router.post("/auth/signup", response_model=AuthResponse)
def sign_up(req: SignUpRequest):
    """
    POST /auth/signup - Registers a new user account.
    Generates a 6-digit email authorization code required to complete registration.
    """
    existing_user = db_manager.get_user_by_email(req.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address is already registered. Please sign in instead."
        )

    user_data = db_manager.create_user(req.email, req.password, req.full_name)
    user_id = user_data["user_id"]
    code = user_data["verification_code"]

    # Dispatch email with verification code
    email_service.send_verification_code(req.email, code, req.full_name)

    return AuthResponse(
        user_id=user_id,
        email=req.email,
        full_name=req.full_name,
        token=f"token_{user_id}_pending",
        is_email_verified=False,
        verification_code=code,
        message=f"Registration successful! Authorization code sent to {req.email}."
    )

@router.post("/auth/verify-email", response_model=AuthResponse)
def verify_email(req: VerifyEmailRequest):
    """
    POST /auth/verify-email - Validates 6-digit authorization code to activate account.
    """
    user = db_manager.get_user_by_email(req.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found. Please sign up first."
        )

    success = db_manager.verify_user_email(req.email, req.code)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email authorization code. Please check your confirmation code and try again."
        )

    user_id = user["user_id"]
    return AuthResponse(
        user_id=user_id,
        email=user["email"],
        full_name=user["full_name"],
        token=f"token_{user_id}_authorized",
        is_email_verified=True,
        verification_code=None,
        message="Email authorization verified successfully! Welcome to CAPS."
    )

@router.post("/auth/resend-code")
def resend_code(req: ResendCodeRequest):
    """
    POST /auth/resend-code - Resends a new 6-digit authorization code.
    """
    user = db_manager.get_user_by_email(req.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found. Please sign up first."
        )

    new_code = db_manager.resend_verification_code(req.email)
    email_service.send_verification_code(req.email, new_code, user.get("full_name", "Participant"))
    return {
        "email": req.email,
        "verification_code": new_code,
        "message": f"A new authorization code ({new_code}) has been dispatched to {req.email}."
    }

@router.post("/auth/signin", response_model=AuthResponse)
def sign_in(req: SignInRequest):
    """
    POST /auth/signin - Authenticates existing user.
    Strict enforcement: rejects unregistered emails, incorrect passwords, or unverified email authorization.
    """
    user = db_manager.get_user_by_email(req.email)

    # 1. Reject unregistered users
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account not registered. Please create an account before signing in."
        )

    # 2. Reject incorrect password
    if user["password"] != req.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password. Please check your credentials and try again."
        )

    # 3. Reject unverified email authorization
    if not user.get("is_email_verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email authorization pending. Please enter your 6-digit confirmation code to authorize your email address."
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
    GET /user/profile/{user_id} - Retrieves user stats, XP, streak, and badges.
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

@router.post("/auth/send-verification-batch")
def send_verification_code_batch():
    """
    POST /auth/send-verification-batch - Dispatches user-wise email authorization codes to all registered users.
    """
    users = db_manager.get_all_users()
    dispatched = []

    for u in users:
        email = u["email"]
        code = u.get("verification_code") or "123456"
        name = u.get("full_name", "Participant")
        email_service.send_verification_code(email, code, name)
        dispatched.append({
            "user_id": u["user_id"],
            "email": email,
            "full_name": name,
            "verification_code": code,
            "is_email_verified": u["is_email_verified"]
        })

    return {
        "count": len(dispatched),
        "message": f"Successfully dispatched user-wise authorization emails to {len(dispatched)} participants.",
        "users": dispatched
    }

@router.post("/auth/send-verification-user/{user_id}")
def send_verification_code_for_user(user_id: str):
    """
    POST /auth/send-verification-user/{user_id} - Sends user-wise authorization code to a specific user.
    """
    user = db_manager.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{user_id}' not found in database."
        )

    email = user["email"]
    code = user.get("verification_code") or "123456"
    name = user.get("full_name", "Participant")
    email_service.send_verification_code(email, code, name)

    return {
        "user_id": user_id,
        "email": email,
        "full_name": name,
        "verification_code": code,
        "message": f"User-wise authorization code dispatched to {email}."
    }
