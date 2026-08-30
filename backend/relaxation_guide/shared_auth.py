"""
Bridges this service into StressApp's one shared login system
(backend/common/auth.py) instead of minting its own identity/token story.

One StressApp login (backend/physiological's /register + /login, the only
module with those routes) issues a signed token that every backend module
verifies against the same STRESSAPP_SECRET_KEY -- this service included.
"""

import sys
from pathlib import Path
from flask import request, jsonify

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.common.auth import verify_token, require_auth as flask_require_auth


def get_authenticated_user_id() -> str:
    """Verifies the shared StressApp Bearer token and returns user_id, or None if invalid."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[len("Bearer "):].strip()
    return verify_token(token)


def check_auth_or_401():
    """Flask helper to enforce authentication."""
    user_id = get_authenticated_user_id()
    if not user_id:
        return jsonify({"error": "Missing or invalid authorization token"}), 401
    return None
