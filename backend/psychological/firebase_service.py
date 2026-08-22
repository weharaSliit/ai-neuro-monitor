import time

import os

from backend.common.firebase_config import FIREBASE_DB_URL, RTDB_NAMESPACES
from backend.psychological.realtime.firebase_sync import (
    FirebaseSync,
    make_eeg_fusion_session_record,
    make_fusion_engin_record,
)

RTDB_NAMESPACE = RTDB_NAMESPACES["psychological"]  # "psychological"


def resolve_credential_path():
    return os.environ.get("FIREBASE_CREDENTIALS")


class EegFirebaseSession:
    """Per-session Firebase writer. Five RTDB stores, all under this one
    session's id:
      - {RTDB_NAMESPACE}/{session_id}/{window}        derived output (see push())
      - {RTDB_NAMESPACE}/{session_id}/raw/{window}     full-resolution raw ADC codes +
                                                        uV per 25s block (see push_raw())
      - {RTDB_NAMESPACE}/{session_id}/live_raw         latest ~1s raw preview, overwritten
                                                        every push (see push_live_raw()) --
                                                        for a genuinely live dashboard
                                                        waveform, independent of the 25s
                                                        block/quality-gate cadence above
      - fusion_engin/{session_id}/{window}             EEG-only confidence/model_accuracy/
                                                        task_state_score/timestamp/
                                                        task_state_label (see push())
      - fusion_en_sessions/{session_id}/{window}       EEG's contribution to actual live
                                                        fusion (prob_eeg/conf_eeg/etc, keyed
                                                        by the shared fusion_window_key()
                                                        wall-clock bucket -- see push() and
                                                        make_eeg_fusion_session_record()).
                                                        fusion_live_session.py merges this
                                                        with fusion_en/{session_id} (the
                                                        ring's own writes) before fusing.
    Plus session-lifecycle tracking (started/ended) at fusion_engine/{session_id} --
    a SEPARATE store from fusion_engin above (note the trailing 'e'), holding
    just the session's own active/ended state, not per-window data. (Yet
    another separate store, fusion_en_sessions/{session_id}/ended, is set by
    the StressApp frontend directly -- not written here -- to tell
    fusion_live_session.py when to stop polling; see FusionSessionScreen.js's
    endSession().)
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._cred_path = resolve_credential_path()
        self.enabled = self._cred_path is not None
        if not self.enabled:
            print(
                f"[firebase] FIREBASE_CREDENTIALS not set -- Firebase sync disabled for "
                f"session={session_id} (predictions still work; nothing is written to "
                f"Firebase). This service never falls back to a checked-in key -- see "
                f"firebase_service.py's module docstring."
            )
            return
        self._rtdb = FirebaseSync(self._cred_path, FIREBASE_DB_URL, session_id=session_id, root_path=RTDB_NAMESPACE)
        self._raw_rtdb = FirebaseSync(
            self._cred_path, FIREBASE_DB_URL, session_id=session_id, root_path=RTDB_NAMESPACE, extra_path="raw"
        )
        self._live_raw_rtdb = FirebaseSync(
            self._cred_path, FIREBASE_DB_URL, session_id=session_id, root_path=RTDB_NAMESPACE, extra_path="live_raw"
        )
        self._fusion_engin_rtdb = FirebaseSync(
            self._cred_path, FIREBASE_DB_URL, session_id=session_id, root_path="fusion_engin"
        )
        self._fusion_en_sessions_rtdb = FirebaseSync(
            self._cred_path, FIREBASE_DB_URL, session_id=session_id, root_path="fusion_en_sessions"
        )

    def push(self, record: dict) -> None:
        if not self.enabled:
            return
        self._rtdb.push(record)
        self._fusion_engin_rtdb.push(make_fusion_engin_record(record))
        # merge(), not push() -- fusion_live_session.py separately mirrors
        # the fused cross-modality result onto this SAME window key (see
        # fusion_live_session.py::poll_once()); two set()s racing on one key
        # would let whichever landed second silently erase the other's
        # fields, .update() merges instead. See FirebaseSync.merge()'s
        # docstring.
        self._fusion_en_sessions_rtdb.merge(make_eeg_fusion_session_record(record))

    def push_raw(self, record: dict) -> None:
        if not self.enabled:
            return
        self._raw_rtdb.push(record)

    def push_live_raw(self, record: dict) -> None:
        if not self.enabled:
            return
        self._live_raw_rtdb.set(record)

    def _mark_session(self, **fields) -> None:
        if not self.enabled:
            return
        from firebase_admin import db
        try:
            db.reference(f"fusion_engine/{self.session_id}").update(fields)
        except Exception as e:  # noqa: BLE001 -- one failed write shouldn't kill a live session
            print(f"[firebase] WARNING: fusion_engine session write failed for {self.session_id}: {e}")

    def mark_session_started(self) -> None:
        self._mark_session(ended=False, started_at=time.time())

    def mark_session_ended(self) -> None:
        self._mark_session(ended=True, ended_at=time.time())
