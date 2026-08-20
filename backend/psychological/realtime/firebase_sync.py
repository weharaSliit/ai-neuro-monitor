"""Pushes per-block physiological output records to Firebase Realtime
Database, for the EEG branch's fusion-ready output structure (see
results/methodology/06_realtime_hardware.md for the full field list).

CREDENTIAL HANDLING -- READ BEFORE USE: the service-account JSON is a live
credential (full admin access to the Firebase project). It must NEVER live
inside this repository -- not committed, not as a stray file in the project
directory, not pasted into any script. This module only ever reads it from
a filesystem path given via the FIREBASE_CREDENTIALS environment variable
(or an explicit --firebase-cred CLI argument that points outside the repo).
If a service-account key was ever pasted into a chat, a commit, or any
shared document, treat it as compromised and rotate it in the Firebase
console (Project Settings -> Service Accounts) before relying on it here.

Schema written: {root_path}/{session_id}/{window} (root_path defaults to
'phsycological', configurable via --firebase-path) -> one record per
25s block (matches the EEGOutput structure proposed for HRV/GSR fusion):
    timestamp_start, timestamp_end, task_state_score, task_state_label,
    task_state_trend, eeg_quality_score, eeg_quality_flag, eeg_missing,
    model_version, feature_set, window, skipped,
    prediction_probability, model_accuracy, signal_quality, model_confidence
"""

import time
from datetime import datetime, timezone
from pathlib import Path

TASK_STATE_LABEL_THRESHOLD = 0.5  # >=: high task-state; <: low

# Offline LOSO-evaluated AUC for each deployed feature_set, from this project's own
# model_comparison.csv files -- NOT a live/real-time-validated accuracy (see
# results/CURRENT_SYSTEM.md's own caveat: end-to-end live validation is not yet done).
# Stored per-record as fixed context alongside each epoch's prediction, not computed
# per-epoch -- there is no live ground-truth label to measure per-epoch accuracy against.
MODEL_ACCURACY_AUC = {
    'bipolar_only_v1': 0.706,  # results/models_25s_block_bipolar_only/model_comparison.csv (logistic_regression)
    'car_v1': 0.795,           # results/models_25s_block/model_comparison.csv (random_forest) -- NOT
                                # recommended for live 2-electrode hardware, see pipeline.py docstring
}


def _trend_direction(history_scores: list[float], lookback: int = 3) -> str:
    """'increasing'/'decreasing'/'stable' from the last `lookback` trusted
    calibrated_p values -- a simple slope-sign read, not a statistical test."""
    valid = [s for s in history_scores if s is not None][-lookback:]
    if len(valid) < 2:
        return 'stable'
    delta = valid[-1] - valid[0]
    if delta > 0.05:
        return 'increasing'
    if delta < -0.05:
        return 'decreasing'
    return 'stable'


def make_eeg_output_record(result: dict, window_sec: float, model_version: str,
                            feature_set: str, history_scores: list[float]) -> dict:
    """Maps a RealtimeInference.infer_block()/calibrate_block() result dict
    onto the fusion-ready EEGOutput schema. `result` is expected to already
    carry the quality_*/session_* fields RealtimeInference.infer_block adds.
    """
    now = time.time()
    ts_end = now
    ts_start = ts_end - window_sec

    record = {
        'timestamp_start': ts_start,
        'timestamp_end': ts_end,
        'timestamp_center': (ts_start + ts_end) / 2,
        'window': result.get('window'),
        'skipped': bool(result.get('skipped', False)),
        'model_version': model_version,
        'feature_set': feature_set,
        'eeg_missing': bool(result.get('skipped', False)),
        'eeg_quality_score': result.get('quality_quality_score'),
        'eeg_quality_flag': bool(result.get('quality_is_trusted', False)),
        # Same value as eeg_quality_score, under the name requested for the fusion table --
        # the Step-0 9-factor gate score (0-100), computed regardless of skip status.
        'signal_quality': result.get('quality_quality_score'),
        # Fixed per deployed model/feature_set, NOT computed per-epoch -- see MODEL_ACCURACY_AUC's
        # docstring above for why (no live ground truth to measure per-epoch accuracy against).
        'model_accuracy': MODEL_ACCURACY_AUC.get(feature_set),
        # True if the session's baseline came from --calibration-fallback best-available (no block
        # ever reached calibration_min_rating) -- any task_state_score below is not trustworthy.
        'baseline_degraded': bool(result.get('baseline_degraded', False)),
        # True if --mirror-ch1-to-ch2 was active (realtime_inference.py) -- with the default
        # bipolar-only model this freezes task_state_score at a constant value, not a real
        # prediction; see mirror_ch1_to_ch2()'s docstring there for the measured consequence.
        'ch2_mirrored': bool(result.get('ch2_mirrored', False)),
        # True if --reconstruct-ch2-from-ch1 was active -- CH2 is a fabricated derivative of
        # CH1, not a real T8 reading; see reconstruct_ch2_from_ch1()'s docstring there.
        'ch2_reconstructed': bool(result.get('ch2_reconstructed', False)),
    }

    if result.get('skipped'):
        record.update({
            'task_state_score': None, 'task_state_label': None, 'task_state_trend': None,
            'prediction_probability': None, 'model_confidence': None,
        })
    else:
        p = result.get('calibrated_p')
        # Margin-based heuristic (0=coin-flip, 1=maximally extreme), NOT a calibrated
        # probability of correctness -- this pipeline has no persisted calibrator (see
        # pipeline.py: calibrated_p is raw model output despite the name; offline nested
        # Platt scaling measured ECE 0.224 pre-calibration on this exact model). Treat this
        # as "how extreme was the raw score", not "how likely is this to be right".
        confidence = abs(p - 0.5) * 2 if p is not None else None
        record.update({
            'task_state_score': p,
            'task_state_label': int(p >= TASK_STATE_LABEL_THRESHOLD) if p is not None else None,
            'task_state_trend': _trend_direction(history_scores),
            'prediction_probability': p,
            'model_confidence': confidence,
            'high_load_alert': bool(result.get('high_load_alert', False)),
            'micro_break_recommended': bool(result.get('micro_break_recommended', False)),
            'fatigue_warning': bool(result.get('fatigue_warning', False)),
            'cooldown_logged': bool(result.get('cooldown_logged', False)),
        })
    return record


class FirebaseSync:
    """Thin wrapper: one instance per session, pushes one record per block
    to {root_path}/{session_id}/{window} (root_path defaults to
    'phsycological' -- matches this project's own established spelling,
    see the --firebase-path CLI flag to change it). Fails loudly on init
    (bad credential/DB URL should stop the session, not silently no-op),
    but a per-block push failure (e.g. transient network issue) is logged
    and skipped rather than crashing an otherwise-working live session.
    """

    def __init__(self, credential_path: str, database_url: str, session_id: str | None = None,
                 root_path: str = 'phsycological'):
        import firebase_admin
        from firebase_admin import credentials, db

        cred_path = Path(credential_path).expanduser().resolve()
        if not cred_path.is_file():
            raise FileNotFoundError(
                f'Firebase credential not found at {cred_path}. This must be a path OUTSIDE '
                f'the project repository (see module docstring) -- set it via --firebase-cred '
                f'or the FIREBASE_CREDENTIALS environment variable.'
            )

        cred = credentials.Certificate(str(cred_path))
        # Reuse an already-initialized default app if one exists (e.g. re-running
        # in the same interpreter/tests), otherwise this crashes on second init.
        try:
            self._app = firebase_admin.get_app()
        except ValueError:
            self._app = firebase_admin.initialize_app(cred, {'databaseURL': database_url})

        self.session_id = session_id or time.strftime('%Y%m%dT%H%M%S')
        self.root_path = root_path
        self._ref = db.reference(f'{root_path}/{self.session_id}', app=self._app)
        print(f'[firebase] writing to {root_path}/{self.session_id}/ at {database_url}')

    def push(self, record: dict) -> None:
        window = record.get('window')
        key = str(window) if window is not None else None
        try:
            if key is not None:
                self._ref.child(key).set(record)
            else:
                self._ref.push(record)
        except Exception as e:  # noqa: BLE001 -- one failed push shouldn't kill a live session
            print(f'[firebase] WARNING: push failed for window={window}: {e}')


# ═══════════════════════════════════════════════════════════════════
#  CLOUD FIRESTORE `fusion_engine` COLLECTION SYNC
#  (separate product from the RTDB sync above -- FirebaseSync pushes to
#  Realtime Database at {root_path}/{session_id}/{window}; this writes to
#  Cloud Firestore's `fusion_engine` collection, which is what
#  `fushion engin/fusion_engin.py::load_fusion_records()` actually reads.
#  The two DBs don't share data automatically -- a record pushed only via
#  FirebaseSync is invisible to fusion_engin.py, hence this second sync.)
# ═══════════════════════════════════════════════════════════════════

# IMPORTANT -- naming honesty (see results/CURRENT_SYSTEM.md Section 1):
# this project's model estimates task-state (cognitive load), not validated
# subjective stress -- self-report-based labels are near-chance for this
# EEG regardless of channel count. `prob_eeg` below is written only because
# fusion_engin.py's schema (MODALITIES = ["eeg", "hrv_gsr", "behav"]) reads
# that exact column name; do not read `prob_eeg` as "P(stress)". The same
# value is also written under the honestly-named `task_state_score_eeg` --
# prefer that field for anything that displays or reasons about what the
# number means, and treat `prob_eeg` as schema plumbing only.
FUSION_ENGINE_MODEL_ACC_KEY = 'model_accuracy'  # see MODEL_ACCURACY_AUC above


def make_fusion_engine_document(record: dict, session_id: str) -> dict:
    """Maps a make_eeg_output_record() record onto the fusion_engine
    Firestore schema fusion_engin.py expects for the "eeg" modality:
    prob_eeg, conf_eeg, model_acc_eeg, signal_quality_eeg, stress_label_eeg,
    timestamp_eeg (+ shared timestamp, session_id, window for grouping).

    `conf_eeg` is recomputed here as max(p, 1-p) -- NOT copied from
    `model_confidence` (that field is abs(p-0.5)*2, doubled, range [0,1]) --
    to match backend/physiological's conf_hrv_gsr convention (also
    max(prob_normal, prob_stress), range [0.5,1]). fusion_engin.py's
    compute_reliability_weight() multiplies conf_eeg and conf_hrv_gsr
    against the SAME min_confidence threshold as if they were on the same
    scale; mixing the doubled-margin definition in here silently penalized
    every EEG row far more harshly than an equivalent HRV/GSR row (caught by
    testing this integration against synthetic data: it collapsed EEG's
    usable-row count regardless of true prediction quality). This is still
    NOT a calibrated probability of correctness, same caveat as
    make_eeg_output_record()'s docstring -- just now on the same scale as
    the other modality's confidence.

    `signal_quality_eeg` is rescaled from the gate's 0-100 score to [0,1] to
    match compute_reliability_weight()'s assumption that all three factors
    (signal_quality * model_acc * conf) are independently in [0,1].

    `timestamp`/`timestamp_eeg` are converted from the raw Unix-epoch-
    seconds float `make_eeg_output_record()` produces (time.time()) to an
    ISO 8601 string -- fusion_engin.py's synchronize_timestamps() feeds
    these straight to pandas.to_datetime() with no `unit=` argument, which
    silently reads a bare float as nanoseconds-since-epoch, not seconds;
    every EEG row would land near 1970 and read as infinitely stale (also
    caught by testing this integration -- eeg usable dropped to 0/N until
    fixed). HRV/GSR's timestamp_hrv_gsr already uses datetime.now().isoformat(),
    which is why only the EEG side hit this.

    Returns None for `prob_eeg`/`conf_eeg` (not 0.0) when the block was
    skipped (task_state_score is None) -- handle_missing_values() in
    fusion_engin.py treats a real NaN as "missing", so a skipped block must
    not look like a confident prob_eeg=0.0 "definitely calm" reading.
    """
    p = record.get('task_state_score')
    conf = (0.5 + abs(p - 0.5)) if p is not None else None
    quality_0_100 = record.get('eeg_quality_score')
    quality_0_1 = (quality_0_100 / 100.0) if quality_0_100 is not None else None
    ts_end = record.get('timestamp_end')
    ts_end_iso = datetime.fromtimestamp(ts_end, tz=timezone.utc).isoformat() if ts_end is not None else None

    return {
        'session_id': session_id,
        'window': record.get('window'),
        'timestamp': ts_end_iso,
        'timestamp_eeg': ts_end_iso,
        'prob_eeg': p,
        'conf_eeg': conf,
        'model_acc_eeg': record.get(FUSION_ENGINE_MODEL_ACC_KEY),
        'signal_quality_eeg': quality_0_1,
        'stress_label_eeg': record.get('task_state_label'),
        # Honest duplicates -- not read by fusion_engin.py's MODALITIES loop,
        # kept alongside the schema-required names above so nothing downstream
        # has to reverse-engineer what prob_eeg/stress_label_eeg actually mean.
        'task_state_score_eeg': p,
        'task_state_label_eeg': record.get('task_state_label'),
        'eeg_missing': bool(record.get('eeg_missing', False)),
        'baseline_degraded': bool(record.get('baseline_degraded', False)),
        'model_version': record.get('model_version'),
        'feature_set': record.get('feature_set'),
    }


class FusionEngineSync:
    """One instance per session, pushes one document per block to Cloud
    Firestore's `fusion_engine` collection -- deterministic doc id
    `{session_id}_{window}` (via .set(doc, merge=True), not .add()) so a
    future HRV/GSR or behavioral writer keyed the same way can merge its
    own prob_{modality}/conf_{modality}/... fields into the SAME document
    instead of creating a separate row that never gets fused. No such
    writer exists yet (see fusion_engin.py's own coverage report at the
    time this was added: real EEG-only rows, 0.1% HRV/GSR) -- this is
    forward-compatible plumbing, not a claim that fusion is live today.

    Uses the SAME credential as FirebaseSync (a service account has access
    to both Realtime Database and Firestore under one Firebase project) --
    pass the identical --firebase-cred path, no separate credential needed.
    """

    def __init__(self, credential_path: str, session_id: str | None = None,
                 collection_name: str = 'fusion_engine'):
        import firebase_admin
        from firebase_admin import credentials, firestore

        cred_path = Path(credential_path).expanduser().resolve()
        if not cred_path.is_file():
            raise FileNotFoundError(
                f'Firebase credential not found at {cred_path}. Same credential-handling '
                f'rules as FirebaseSync above: must live OUTSIDE this repository.'
            )

        try:
            self._app = firebase_admin.get_app()
        except ValueError:
            cred = credentials.Certificate(str(cred_path))
            self._app = firebase_admin.initialize_app(cred)

        self.session_id = session_id or time.strftime('%Y%m%dT%H%M%S')
        self._collection = firestore.client(self._app).collection(collection_name)
        print(f'[firestore] writing to {collection_name}/{{doc_id}} '
              f'(session_id={self.session_id}) for fusion_engin.py')

    def push(self, record: dict) -> None:
        window = record.get('window')
        doc = make_fusion_engine_document(record, self.session_id)
        doc_id = f'{self.session_id}_{window}' if window is not None else None
        try:
            if doc_id is not None:
                self._collection.document(doc_id).set(doc, merge=True)
            else:
                self._collection.add(doc)
        except Exception as e:  # noqa: BLE001 -- one failed push shouldn't kill a live session
            print(f'[firestore] WARNING: push failed for window={window}: {e}')
