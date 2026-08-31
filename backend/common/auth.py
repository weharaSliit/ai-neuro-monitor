# ============================================================
# auth.py — login token generation/verification
#
# Single service issues and verifies its own tokens, so a signed,
# timestamped token (itsdangerous) is enough — no cross-service
# claims/standard needed, which is all a JWT library would add here.
#
# One StressApp login covers every backend module — physiological/,
# phenotyping_behavior/, psychological/, and backend/relaxation_guide's
# service (see backend/relaxation_guide/shared_auth.py) all verify the
# same token against the same SECRET_KEY here, so a user logs in once (via
# physiological/'s /login, the only module with /register+/login) and the
# resulting Bearer token is valid everywhere. generate_token/verify_token
# stay Flask-free (Flask is only imported inside require_auth, lazily) so
# that non-Flask services can reuse the token logic without pulling Flask
# in as a dependency; require_auth below lives here (not copy-pasted per
# Flask module) so that stays true by construction instead of by convention.
# ============================================================

from functools import wraps

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


def require_auth(view_func):
    """Flask-only. Verifies Authorization: Bearer <token>, sets g.user_id.
    Every user-scoped route decorated with this derives user_id from
    g.user_id rather than trusting whatever the client puts in the request
    body/path — the request's own user_id (where routes still take one) is
    only used as an ownership check, never as the source of truth."""
    from flask import g, jsonify, request

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return jsonify({'error': 'Missing or malformed Authorization header'}), 401
        user_id = verify_token(header[len('Bearer '):].strip())
        if user_id is None:
            return jsonify({'error': 'Invalid or expired token'}), 401
        g.user_id = user_id
        return view_func(*args, **kwargs)
    return wrapper
