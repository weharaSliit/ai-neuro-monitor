# ============================================================
# firebase_service.py -- Firebase I/O for the EEG (psychological)
# backend service.
#
# CREDENTIAL POLICY -- DELIBERATELY STRICTER than backend/physiological/
# and backend/phenotyping_behavior/: those two share ONE checked-in
# service-account key (backend/common/serviceAccountKey.json). This
# module does NOT use that key. EEG's own code has, from the start,
# treated an in-repo credential as a security incident (see
# realtime/firebase_sync.py's module docstring, carried over unchanged
# from phscycological/). Integrating this service into backend/ keeps
# that stricter policy rather than silently relaxing it: the credential
# here is read ONLY from the FIREBASE_CREDENTIALS environment variable
# (a path outside this repository), never from a checked-in file, and
# there is no fallback to backend/common/serviceAccountKey.json.
#
# Every other Firebase config value (project, RTDB URL, this module's
# RTDB namespace, the Firestore fusion collection name) IS shared via
# backend/common/firebase_config.py -- only the secret itself is kept
# separate.
# ============================================================

import os

from backend.common.firebase_config import FIREBASE_DB_URL, FIRESTORE_FUSION_COLLECTION, RTDB_NAMESPACES
from backend.psychological.realtime.firebase_sync import (
    FirebaseSync,
    FusionEngineSync,
    make_fusion_engine_document,
)

# "phsycological" -- established spelling, see backend/common/firebase_config.py's registry.
RTDB_NAMESPACE = RTDB_NAMESPACES["psychological"]


def resolve_credential_path():
    """Returns the EEG credential path from $FIREBASE_CREDENTIALS, or None
    if unset. Callers MUST treat None as "Firebase disabled" -- never fall
    back to backend/common/serviceAccountKey.json (see module docstring)."""
    return os.environ.get("FIREBASE_CREDENTIALS")


class EegFirebaseSession:
    """One instance per session_id. Lazily wires up the sync targets this
    service writes to per block:
      - RTDB {RTDB_NAMESPACE}/{session_id}/{window}      (derived EEG output record)
      - Cloud Firestore FIRESTORE_FUSION_COLLECTION       (fusion_engine, for fusion_engin.py)
      - RTDB fusion_en/{session_id}/{window}              (RTDB mirror, for RTDB-only readers)
      - RTDB {RTDB_NAMESPACE}_raw/{session_id}/{window}   (raw signal, see push_raw())
    all from ONE record via make_eeg_output_record()/make_fusion_engine_document(),
    matching the mapping already validated in
    backend/psychological/realtime/firebase_sync.py.

    If $FIREBASE_CREDENTIALS isn't set, this no-ops (logs once) rather than
    raising -- predictions must keep working even with Firebase sync off.
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        cred_path = resolve_credential_path()
        self.enabled = cred_path is not None
        if not self.enabled:
            print(
                f"[firebase] FIREBASE_CREDENTIALS not set -- Firebase sync disabled for "
                f"session={session_id} (predictions still work; nothing is written to "
                f"Firebase). This service never falls back to a checked-in key -- see "
                f"firebase_service.py's module docstring."
            )
            return
        self._rtdb = FirebaseSync(cred_path, FIREBASE_DB_URL, session_id=session_id, root_path=RTDB_NAMESPACE)
        self._fusion_firestore = FusionEngineSync(
            cred_path, session_id=session_id, collection_name=FIRESTORE_FUSION_COLLECTION
        )
        self._fusion_en_rtdb = FirebaseSync(cred_path, FIREBASE_DB_URL, session_id=session_id, root_path="fusion_en")
        # Kept as a SEPARATE sibling path (not nested under RTDB_NAMESPACE's own
        # {window} record) so a large raw-signal payload never bloats the small
        # derived-output record fusion_engin.py and the StressApp EEG screen
        # already read -- those two consumers are unaffected by this addition.
        self._raw_rtdb = FirebaseSync(
            cred_path, FIREBASE_DB_URL, session_id=session_id, root_path=f"{RTDB_NAMESPACE}_raw"
        )

    def push(self, record: dict) -> None:
        if not self.enabled:
            return
        self._rtdb.push(record)
        self._fusion_firestore.push(record)
        self._fusion_en_rtdb.push(make_fusion_engine_document(record, session_id=self.session_id))

    def push_raw(self, record: dict) -> None:
        """record: {'window': int, 'millis': [...], 'ch1_code': [...], 'ch2_code': [...],
        'ch1_uv': [...], 'ch2_uv': [...]} -- same RAW_FIELDS shape as
        realtime/csv_logger.py's local CSV logging, just to Firebase instead
        of a local file, per-block rather than per-sample (one push, not
        6250 individual RTDB writes)."""
        if not self.enabled:
            return
        self._raw_rtdb.push(record)
