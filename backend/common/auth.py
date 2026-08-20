# ============================================================
# auth.py — login token generation/verification
#
# Single service issues and verifies its own tokens, so a signed,
# timestamped token (itsdangerous) is enough — no cross-service
# claims/standard needed, which is all a JWT library would add here.
# ============================================================

from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from backend.common.config import SECRET_KEY, AUTH_TOKEN_MAX_AGE_SECONDS

_serializer = URLSafeTimedSerializer(SECRET_KEY, salt="stressapp-auth")


def generate_token(user_id):
    return _serializer.dumps({"user_id": user_id})


def verify_token(token):
    """Returns the user_id if the token is valid and unexpired, else None."""
    try:
        data = _serializer.loads(token, max_age=AUTH_TOKEN_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    return data.get("user_id")
