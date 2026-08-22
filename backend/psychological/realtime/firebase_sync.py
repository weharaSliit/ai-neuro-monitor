import time
from pathlib import Path

from backend.common.fusion import fusion_window_key

TASK_STATE_LABEL_THRESHOLD = 0.5  # >=: high task-state; <: low

MODEL_ACCURACY_AUC = {
    'bipolar_only_v1': 0.706,  # results/models_25s_block_bipolar_only/model_comparison.csv (logistic_regression)
    'car_v1': 0.795,           # results/models_25s_block/model_comparison.csv (random_forest) -- NOT
                                # recommended for live 2-electrode hardware, see pipeline.py docstring
}

# The deployed bipolar-only model's full feature set, computed from the T7-T8
# differential signal -- suffix order matches sam40.features.channel_features()'s
# own insertion order (band powers -> Hjorth -> time-domain -> sample entropy),
# same as psycological/results/features_bipolar_only_25s_block.csv's header
# (that CSV is generated from the same function). `result` in
# make_eeg_output_record() carries these prefixed 'bipolar_' -- see
# sam40.features.epoch_features(..., include_bipolar=True).
BIPOLAR_FEATURE_SUFFIXES = [
    'delta_power', 'delta_rel_power', 'delta_log_power',
    'theta_power', 'theta_rel_power', 'theta_log_power',
    'alpha_power', 'alpha_rel_power', 'alpha_log_power',
    'beta_power', 'beta_rel_power', 'beta_log_power',
    'gamma_power', 'gamma_rel_power', 'gamma_log_power',
    'total_power',
    'theta_alpha_ratio', 'beta_alpha_ratio', 'theta_beta_ratio',
    'spectral_entropy', 'spectral_slope',
    'hjorth_activity', 'hjorth_mobility', 'hjorth_complexity',
    'mean', 'std', 'rms', 'ptp',
    'sample_entropy',
]


def _trend_direction(history_scores: list[float], lookback: int = 3) -> str:
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
        'signal_quality': result.get('quality_quality_score'),
        'model_accuracy': MODEL_ACCURACY_AUC.get(feature_set),
        'baseline_degraded': bool(result.get('baseline_degraded', False)),
        'ch2_mirrored': bool(result.get('ch2_mirrored', False)),
        'ch2_reconstructed': bool(result.get('ch2_reconstructed', False)),
    }

    # Populated whenever pipeline.infer_block() extracted features at all --
    # which is now every block, trusted or not (see pipeline.py's infer_block
    # docstring comment above raw_feats). This gives the dashboard a live
    # 29-feature reading on every 25s block instead of only on blocks that
    # pass the quality gate; task_state_score/label below stay gated on trust
    # -- untrusted features are fine to LOOK at, just not to score with.
    if result.get('T7_total_power') is not None:
        record['features_eeg'] = {
            't7_power': result.get('T7_total_power'),
            't8_power': result.get('T8_total_power'),
            't7_hjorth_complexity': result.get('T7_hjorth_complexity'),
            't8_hjorth_complexity': result.get('T8_hjorth_complexity'),
            'bipolar': {
                suffix: result.get(f'bipolar_{suffix}') for suffix in BIPOLAR_FEATURE_SUFFIXES
            },
        }

    if result.get('skipped'):
        record.update({
            'task_state_score': None, 'task_state_label': None, 'task_state_trend': None,
            'prediction_probability': None, 'model_confidence': None,
        })
    else:
        p = result.get('calibrated_p')
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
    def __init__(self, credential_path: str, database_url: str, session_id: str | None = None,
                 root_path: str = 'psychological', extra_path: str | None = None):
        """extra_path: optional child segment appended after the session id
        (e.g. 'raw') -- lets two FirebaseSync instances share the same
        session root but write window-keyed children under different
        sub-paths (psychological/{session}/{window} vs.
        psychological/{session}/raw/{window}), instead of needing a whole
        separate top-level root_path per sub-store."""
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
        full_path = f'{root_path}/{self.session_id}' + (f'/{extra_path}' if extra_path else '')
        self._ref = db.reference(full_path, app=self._app)
        print(f'[firebase] writing to {full_path}/ at {database_url}')

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

    def merge(self, record: dict) -> None:
        """Like push(), but .update()s the keyed child instead of set()-ing
        it -- for a path another process ALSO writes fields into for the
        same window key (e.g. fusion_en_sessions/{session_id}/{window}: EEG
        writes its own prob_eeg/etc here via push() above, but
        fusion_live_session.py separately mirrors the fused cross-modality
        result onto the SAME key). Two set()s racing on one key is a
        guaranteed clobber -- whichever lands second wins outright and
        erases the other's fields entirely; two update()s merge instead,
        regardless of write order."""
        window = record.get('window')
        key = str(window) if window is not None else None
        if key is None:
            raise ValueError('merge() requires record["window"] -- there is no keyless push() equivalent')
        try:
            self._ref.child(key).update(record)
        except Exception as e:  # noqa: BLE001 -- one failed merge shouldn't kill a live session
            print(f'[firebase] WARNING: merge failed for window={window}: {e}')

    def set(self, record: dict) -> None:
        """Overwrites this ref's root value entirely -- for a single
        'latest snapshot' node (e.g. a live raw-signal preview) rather than
        push()'s keyed/appended children. No history is kept at this path;
        every call replaces the previous value."""
        try:
            self._ref.set(record)
        except Exception as e:  # noqa: BLE001 -- one failed write shouldn't kill a live session
            print(f'[firebase] WARNING: set failed for session_id={self.session_id}: {e}')

def make_fusion_engin_record(record: dict) -> dict:
    """EEG-only record for the fusion_engin/{session_id}/{window} path --
    deliberately just these 5 fields (not the full derived-output record
    already at psychological/{session_id}/{window}): confidence,
    model_accuracy, task_state_score, timestamp, task_state_label.

    confidence here is model_confidence from make_eeg_output_record()
    (abs(p-0.5)*2, range [0,1]) -- NOT recomputed on a different scale,
    unlike the old cross-modality fusion_en record this replaces (which
    had to reconcile EEG's and the ring's differing confidence
    conventions; this path only ever holds EEG's own values now)."""
    return {
        'confidence': record.get('model_confidence'),
        'model_accuracy': record.get('model_accuracy'),
        'task_state_score': record.get('task_state_score'),
        'timestamp': record.get('timestamp_end'),
        'task_state_label': record.get('task_state_label'),
        'window': record.get('window'),
    }


def make_eeg_fusion_session_record(record: dict) -> dict:
    """EEG's contribution to fusion_en_sessions/{session_id}/{window} --
    fusion_engin.py's compute_fusion_for_records() schema (prob_eeg,
    conf_eeg, model_acc_eeg, signal_quality_eeg, stress_label_eeg), which
    fusion_live_session.py merges with the ring's fusion_en/{session_id}
    windows before running the actual weighted fusion. See that merge
    (fusion_live_session.py::merge_eeg_into_windows()) for why this lives
    at a SEPARATE path from fusion_en rather than written directly there:
    the ring keys fusion_en by fusion_window_key() (see backend/common/
    fusion.py) via save_fusion_en_rtdb(), while EEG's own natural window
    index is a monotonic 25s-block counter -- writing directly into
    fusion_en under EEG's own key would essentially never land on the same
    key the ring uses. Keying THIS record by fusion_window_key() instead
    (same shared 60s wall-clock bucket) is what makes the later merge
    possible; window here is deliberately NOT record['window'] (EEG's own
    block index).

    prob_eeg is task_state_score, matching fusion_engin.py's naming --
    still cognitive load, NOT validated stress (see this module's other
    docstrings). None on a skipped block, so handle_missing_values() in
    fusion_engin.py correctly zeroes EEG's reliability weight for that
    fusion window instead of fusing in an untrusted reading.
    """
    skipped = bool(record.get('skipped'))
    p = None if skipped else record.get('task_state_score')
    label = record.get('task_state_label')
    return {
        'window': fusion_window_key(),
        'timestamp_eeg': record.get('timestamp_end'),
        'prob_eeg': p,
        'conf_eeg': None if p is None else record.get('model_confidence'),
        'model_acc_eeg': record.get('model_accuracy'),
        'signal_quality_eeg': record.get('eeg_quality_score'),
        'stress_label_eeg': (
            'unknown' if p is None
            else ('high_task_state' if label == 1 else 'low_task_state')
        ),
    }
