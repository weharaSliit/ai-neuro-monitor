# ============================================================
# migrate_wehara_password.py
# One-off script: gives Wehara a password under her EXISTING
# user_id="Wehara" so she can log in through the new /login route.
#
# Her session/baseline/prediction data (baselines/Wehara,
# sessions/Wehara/..., predictions/Wehara/..., pss4/Wehara/...)
# was written directly by save_baseline/save_prediction/etc. without
# ever requiring a users/Wehara record to exist first — so it's
# expected that users/Wehara may not exist yet even though her real
# data does. This script either creates that record (if missing) or
# adds password_hash to it (if it exists but has none) — either way,
# it never touches any of her existing session/baseline/prediction
# data, since those live at separate Firebase paths keyed by the
# same user_id="Wehara", untouched by this script either way.
#
# Run once, locally (not over HTTP — avoids sending her real
# password in plaintext over the LAN, since API_BASE is plain http://):
#   python migrate_wehara_password.py
# ============================================================

import getpass
import sys
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from werkzeug.security import generate_password_hash
from backend.physiological.firebase_service import (
    init_firebase, get_user, create_user_with_password, set_password_hash
)

USER_ID = "Wehara"

init_firebase()
user = get_user(USER_ID)

if user and user.get("password_hash"):
    print(f"'{USER_ID}' already has a password set — aborting to avoid overwriting it.")
    sys.exit(0)

pw = getpass.getpass(f"Set a password for '{USER_ID}': ")
if len(pw) < 6:
    print("Password must be at least 6 characters — aborting.")
    sys.exit(1)

if user is None:
    print(f"No users/{USER_ID} record yet (expected — her data was written "
          f"without one) — creating it now.")
    create_user_with_password(USER_ID, USER_ID, generate_password_hash(pw))
else:
    set_password_hash(USER_ID, generate_password_hash(pw))

print(f"Done. '{USER_ID}' can now log in via POST /login.")
