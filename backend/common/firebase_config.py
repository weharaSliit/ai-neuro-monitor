# ============================================================
# firebase_config.py — single source of truth for every Firebase
# configuration value used anywhere in this codebase.
#
# Every module talks to ONE Firebase project: stress-monitor-c39ee.
# What differs per module is the RTDB namespace it writes under (or,
# for psychological/, the whole credential-handling policy) -- this
# file is the one place that's defined, instead of four.
#
# Who uses what:
#   backend/physiological/         imports FIREBASE_CRED_FILE,
#                                   FIREBASE_DB_URL, RTDB_NAMESPACES,
#                                   FIRESTORE_FUSION_COLLECTION
#                                   (via backend/common/config.py's
#                                   re-export, see that file)
#   backend/phenotyping_behavior/  same, via common.config (sys.path hack)
#   backend/psychological/ (EEG)   IS a backend/ module (integrated from the
#                                   standalone phscycological/ folder) but
#                                   deliberately imports ONLY the non-secret
#                                   values here (FIREBASE_DB_URL,
#                                   RTDB_NAMESPACES, FIRESTORE_FUSION_COLLECTION)
#                                   via backend/psychological/firebase_service.py
#                                   -- NOT FIREBASE_CRED_FILE/resolve_credential().
#                                   Its credential is read ONLY from
#                                   $FIREBASE_CREDENTIALS, outside the repo,
#                                   with no fallback to the checked-in key --
#                                   a deliberately stricter policy carried
#                                   over unchanged from phscycological/,
#                                   kept intentionally different on
#                                   integration, not a gap. Writes RTDB under
#                                   'phsycological' (established spelling,
#                                   RTDB_NAMESPACES["psychological"] below).
#                                   phscycological/ itself (research/training
#                                   code, src/sam40/ etc.) was NOT moved and
#                                   still runs standalone with its own CLI-flag
#                                   credential handling, independent of this file.
#   fushion engin/fusion_engin.py  reads Cloud Firestore's
#                                   FIRESTORE_FUSION_COLLECTION directly
#                                   (its own default parameter, kept
#                                   standalone/portable by design) --
#                                   the value must match the one here.
#   StressApp/.../firebase.js      mobile client SDK, same FIREBASE_DB_URL,
#                                   no admin credential (client-side).
# ============================================================

import json
import os
from pathlib import Path

# ── Shared project identity ──────────────────────────────────
FIREBASE_PROJECT_ID = "stress-monitor-c39ee"
FIREBASE_DB_URL = "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/"

# Cloud Firestore collection fushion engin/fusion_engin.py reads --
# a SEPARATE database product from FIREBASE_DB_URL above (same project).
# Do not confuse with the RTDB 'fusion_engine/{user_id}/{session_id}'
# path below -- same name, different product, see RTDB_NAMESPACES' note.
FIRESTORE_FUSION_COLLECTION = "fusion_engine"

# ── Credential resolution ────────────────────────────────────
# backend/physiological/ and backend/phenotyping_behavior/ share ONE
# service-account key -- a single group credential, not one per module.
_CONFIG_DIR = Path(__file__).resolve().parent
FIREBASE_CRED_FILE = str(_CONFIG_DIR / "serviceAccountKey.json")

# Cloud-hosting alternative: a full service-account JSON passed via an
# env var instead of a file on disk (e.g. a Render/Railway/Cloud Run
# secret) -- takes priority over FIREBASE_CRED_FILE when both are set,
# see resolve_credential() below.
FIREBASE_CRED_DICT = None
if "FIREBASE_CRED_JSON" in os.environ:
    try:
        FIREBASE_CRED_DICT = json.loads(os.environ["FIREBASE_CRED_JSON"])
    except Exception as e:
        print(f"Warning: Failed to parse FIREBASE_CRED_JSON env var: {e}")


def resolve_credential():
    """Returns whatever firebase_admin.credentials.Certificate() should be
    called with -- a dict (FIREBASE_CRED_JSON env var) if present,
    otherwise the checked-in FIREBASE_CRED_FILE path."""
    return FIREBASE_CRED_DICT if FIREBASE_CRED_DICT else FIREBASE_CRED_FILE


# ── Realtime Database namespace registry ─────────────────────
# Every module writes under its own top-level RTDB key, in the SAME
# database (FIREBASE_DB_URL above). Import your module's entry here
# instead of hardcoding the literal string.
RTDB_NAMESPACES = {
    "physiological":        "physiological",   # backend/physiological/ -- HRV/GSR ring
    "phenotyping_behavior": "phenotyping",      # backend/phenotyping_behavior/ -- keystroke/app-usage
    "psychological":        "phsycological",    # psychological/ -- EEG (reference only, see module docstring above)
}

# fusion_engine/{user_id}/{session_id} (RTDB, written by
# backend/physiological/firebase_service.py::save_fusion_signal) is
# deliberately NOT in RTDB_NAMESPACES -- it's a cross-modality feed
# meant to sit at the RTDB root so other modules can read/write it too
# (see that function's _global_ref() docstring).


# ── Shared init helper (optional -- existing modules keep their own
#    init_firebase() wrappers; this is here for new code to reuse) ──
def init_firebase_app():
    """Idempotently initializes the one firebase_admin app every
    backend/ module shares. firebase_admin itself no-ops if an app
    already exists; this just centralizes which credential/URL it's
    created with the first time."""
    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        cred = credentials.Certificate(resolve_credential())
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
    return firebase_admin.get_app()
