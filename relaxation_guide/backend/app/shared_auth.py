"""
Bridges this FastAPI service into StressApp's one shared login system
(backend/common/auth.py) instead of minting its own identity/token story.

One StressApp login (backend/physiological's /register + /login, the only
module with those routes) issues a signed token that every backend module
verifies against the same STRESSAPP_SECRET_KEY -- this service included.
For that to work at runtime, this process and backend/physiological's must
be started with the same STRESSAPP_SECRET_KEY env var (see backend/.env).
"""

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.common.auth import verify_token  # noqa: E402

from fastapi import Header, HTTPException, status  # noqa: E402


def require_auth(authorization: str = Header(default="")) -> str:
    """FastAPI dependency: verifies the shared StressApp Bearer token and
    returns the user_id it was issued for. 401s if missing/invalid/expired."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or malformed Authorization header")
    user_id = verify_token(authorization[len("Bearer "):].strip())
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    return user_id


def require_self(path_user_id: str, token_user_id: str) -> None:
    """Ownership check for routes that still take user_id in the path: the
    path value is a convenience, never the source of truth for identity --
    it must match the authenticated token's user_id or the request is
    rejected. Mirrors backend/common/auth.py's require_auth convention."""
    if path_user_id != token_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized for this user")
