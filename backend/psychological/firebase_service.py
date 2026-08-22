import os

from backend.common.firebase_config import FIREBASE_DB_URL, FUSION_EN_ROOT, RTDB_NAMESPACES
from backend.psychological.realtime.firebase_sync import (
    FirebaseSync,
    make_eeg_fusion_record,
)

RTDB_NAMESPACE = RTDB_NAMESPACES["psychological"]  # "psychological"


def resolve_credential_path():
    return os.environ.get("FIREBASE_CREDENTIALS")


class EegFirebaseSession:
    """Per-session Firebase writer. Four RTDB stores, all under this one
    session's id:
      - {RTDB_NAMESPACE}/{session_id}/{window}        derived output (see push())
      - {RTDB_NAMESPACE}/{session_id}/raw/{window}     full-resolution raw ADC codes +
                                                        uV per 25s block (see push_raw())
      - {RTDB_NAMESPACE}/{session_id}/live_raw         latest ~1s raw preview, overwritten
                                                        every push (see push_live_raw()) --
                                                        for a genuinely live dashboard
                                                        waveform, independent of the 25s
                                                        block/quality-gate cadence above
      - {FUSION_EN_ROOT}/{session_id}/{window}        EEG's raw contribution to live fusion
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
                                                        its own summary (fused_stress_label/
                                                        fused_stress_probability, session started/
                                                        ended) into fusion_en_sessions -- see
                                                        backend/common/firebase_config.py for the
                                                        full schema.
    (fusion_en_sessions/{session_id}/ended is set by the StressApp frontend
    directly -- not written here -- to tell fusion_live_session.py when to
    pause; the rest of fusion_en_sessions is written by fusion_live_session.py
    itself, not this class -- see FusionSessionScreen.js's endSession().)
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
        self._fusion_en_rtdb = FirebaseSync(
            self._cred_path, FIREBASE_DB_URL, session_id=session_id, root_path=FUSION_EN_ROOT
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
