import json
import os

from backend.common.firebase_config import FIREBASE_DB_URL, FUSION_EN_ROOT, RTDB_NAMESPACES
from backend.psychological.realtime.firebase_sync import (
    FirebaseSync,
    make_eeg_fusion_record,
)

RTDB_NAMESPACE = RTDB_NAMESPACES["psychological"]  # "psychological"


def resolve_credential():
    """Prefers FIREBASE_CRED_JSON (the full service-account JSON as an env
    var value -- what a Render deploy needs, since there's no real
    filesystem to point a file path at; same pattern as
    backend/common/firebase_config.py::resolve_credential()) over
    FIREBASE_CREDENTIALS (a real file path, for local dev outside the repo).
    Returns None if neither is set -- this service still never falls back
    to a checked-in key, see the module docstring below."""
    cred_json = os.environ.get("FIREBASE_CRED_JSON")
    if cred_json:
        try:
            return json.loads(cred_json)
        except Exception as e:
            print(f"[firebase] Failed to parse FIREBASE_CRED_JSON: {e}")
    return os.environ.get("FIREBASE_CREDENTIALS")


class EegFirebaseSession:
    """Per-session Firebase writer. Four RTDB stores:
      - {RTDB_NAMESPACE}/{user_id}/{session_id}/{window}        derived output (see push())
      - {RTDB_NAMESPACE}/{user_id}/{session_id}/raw/{window}     full-resolution raw ADC codes +
                                                        uV per 25s block (see push_raw())
      - {RTDB_NAMESPACE}/{user_id}/{session_id}/live_raw         latest ~1s raw preview, overwritten
                                                        every push (see push_live_raw()) --
                                                        for a genuinely live dashboard
                                                        waveform, independent of the 25s
                                                        block/quality-gate cadence above
      - {FUSION_EN_ROOT}/{user_id}/{session_id}/{window}   EEG's raw contribution to live
                                                        fusion -- user-scoped like the three
                                                        stores above (a "session" now means one
                                                        login-to-logout span, not a bare
                                                        cross-app-boundary id, so the fusion table
                                                        is nested under whoever it belongs to, same
                                                        as everything else here; see
                                                        save_fusion_en_rtdb() for the ring's side
                                                        of this same path)
                                                        (prob_eeg/conf_eeg/etc, keyed by the
                                                        shared fusion_window_key() wall-clock
                                                        bucket -- see push() and
                                                        make_eeg_fusion_record()), written
                                                        DIRECTLY here so fusion_en holds both
                                                        modalities' data as soon as EITHER one
                                                        reports, not only once
                                                        fusion_live_session.py's separate merge
                                                        loop gets to it. That script still reads
                                                        this same path to compute and write back
                                                        the FUSED probability/label, and mirrors
                                                        its own summary (stress_label/
                                                        probability_vector, session_started/
                                                        session_ended) into
                                                        fusion_en_sessions/{user_id}/{session_id}
                                                        -- see backend/common/firebase_config.py
                                                        for the full schema.
    (fusion_en_sessions/{user_id}/{session_id}/session_ended is written
    directly by StressApp's AuthContext.logout() the moment the user logs
    out -- a session now means "logged in until logged out", not "however
    long the app happened to stay open" -- with fusion_live_session.py's own
    rotation logic as a fallback for the unclean-exit case (app killed
    without a logout). session_started/the rest of fusion_en_sessions is
    written by fusion_live_session.py itself, not this class.)
    """

    def __init__(self, session_id: str, user_id: str):
        self.session_id = session_id
        self.user_id = user_id
        self._cred = resolve_credential()
        self.enabled = self._cred is not None
        if not self.enabled:
            print(
                f"[firebase] Neither FIREBASE_CRED_JSON nor FIREBASE_CREDENTIALS is set -- "
                f"Firebase sync disabled for session={session_id} (predictions still work; "
                f"nothing is written to Firebase). This service never falls back to a "
                f"checked-in key -- see firebase_service.py's module docstring."
            )
            return
        # FirebaseSync joins root_path + session_id verbatim -- passing the
        # composite "{user_id}/{session_id}" here (not a new FirebaseSync
        # param) is what nests all four stores, including fusion_en, under
        # the logged-in user.
        user_session_id = f"{user_id}/{session_id}"
        self._rtdb = FirebaseSync(self._cred, FIREBASE_DB_URL, session_id=user_session_id, root_path=RTDB_NAMESPACE)
        self._raw_rtdb = FirebaseSync(
            self._cred, FIREBASE_DB_URL, session_id=user_session_id, root_path=RTDB_NAMESPACE, extra_path="raw"
        )
        self._live_raw_rtdb = FirebaseSync(
            self._cred, FIREBASE_DB_URL, session_id=user_session_id, root_path=RTDB_NAMESPACE, extra_path="live_raw"
        )
        self._fusion_en_rtdb = FirebaseSync(
            self._cred, FIREBASE_DB_URL, session_id=user_session_id, root_path=FUSION_EN_ROOT
        )

    def push(self, record: dict) -> None:
        if not self.enabled:
            return
        self._rtdb.push(record)
        # merge(), not push() -- the ring writes its own fields into this
        # SAME fusion_en/{session}/{window} key (save_fusion_en_rtdb()), and
        # fusion_live_session.py later writes the fused result back onto it
        # too; two set()s racing on one key would let whichever landed
        # second silently erase the other's fields, .update() merges
        # instead regardless of write order. See FirebaseSync.merge()'s
        # docstring.
        self._fusion_en_rtdb.merge(make_eeg_fusion_record(record))

    def push_raw(self, record: dict) -> None:
        if not self.enabled:
            return
        self._raw_rtdb.push(record)

    def push_live_raw(self, record: dict) -> None:
        if not self.enabled:
            return
        self._live_raw_rtdb.set(record)
