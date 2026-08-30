import time
from pathlib import Path

from backend.common.fusion import fusion_window_key

TASK_STATE_LABEL_THRESHOLD = 0.5

MODEL_ACCURACY_AUC = {
    'bipolar_only_v1': 0.706,  
    'car_v1': 0.795,           
}

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


def _lookup_model_accuracy(feature_set: str) -> float:
    try:
        return MODEL_ACCURACY_AUC[feature_set]
    except KeyError:
        raise KeyError(
            f"Unrecognized feature_set {feature_set!r} -- no validated accuracy is "
            f"registered for it in MODEL_ACCURACY_AUC ({sorted(MODEL_ACCURACY_AUC)}). "
            f"Register this feature_set's own LOSO-validated accuracy there rather "
            f"than letting this fall back to None/0.0."
        ) from None


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
                            feature_set: str, history_scores: list[float],
                            high_load_p: float | None = None) -> dict:
    now = time.time()
    ts_end = now
    ts_start = ts_end - window_sec

    record = {
        'timestamp_start': ts_start,
        'timestamp_end': ts_end,
        'timestamp_center': (ts_start + ts_end) / 2,
        'window': result.get('window'),
        'skipped': bool(result.get('skipped', False)),
        # This session's EFFECTIVE high_load_p at the moment of this block --
        # personal_high_load_p if finalize_personal_threshold() succeeded for
        # this user, else the population default (engine.thresholds.high_load_p
        # either way -- see app.py's /predict route, the only caller that
        # passes this). Read by make_eeg_fusion_record() below for the
        # fusion engine's own weighted-threshold combination (see
        # fushion engin/fusion_engin.py::compute_realtime_multimodal_fusion()).
        'effective_high_load_p': high_load_p,
        'model_version': model_version,
        'feature_set': feature_set,
        'eeg_missing': bool(result.get('skipped', False)),
        'eeg_quality_score': result.get('quality_quality_score'),
        'eeg_quality_flag': bool(result.get('quality_is_trusted', False)),
        'signal_quality': result.get('quality_quality_score'),
        'model_accuracy': _lookup_model_accuracy(feature_set),
        'baseline_degraded': bool(result.get('baseline_degraded', False)),
        'ch2_mirrored': bool(result.get('ch2_mirrored', False)),
        'ch2_reconstructed': bool(result.get('ch2_reconstructed', False)),
        # Downsampled PREPROCESSED (filtered, uV-scale) waveform for the
        # live dashboard -- see pipeline.py::_downsample_wave(). Present
        # even for a skipped/rejected block (still real signal, just not
        # trusted enough to score) so the dashboard can show what a
        # rejected block actually looked like, not just a pass/fail flag.
        'wave_uv': result.get('wave_uv'),
    }

    if result.get('T7_total_power') is not None or result.get('bipolar_delta_power') is not None:
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
    def __init__(self, credential: str | dict, database_url: str, session_id: str | None = None,
                 root_path: str = 'psychological', extra_path: str | None = None):

        import firebase_admin
        from firebase_admin import credentials, db
        if isinstance(credential, dict):
            cred = credentials.Certificate(credential)
        else:
            cred_path = Path(credential).expanduser().resolve()
            if not cred_path.is_file():
                raise FileNotFoundError(
                    f'Firebase credential not found at {cred_path}. This must be a path OUTSIDE '
                    f'the project repository (see module docstring) -- set it via --firebase-cred '
                    f'or the FIREBASE_CREDENTIALS environment variable.'
                )
            cred = credentials.Certificate(str(cred_path))
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
        except Exception as e:  
            print(f'[firebase] WARNING: push failed for window={window}: {e}')

    def merge(self, record: dict) -> None:

        window = record.get('window')
        key = str(window) if window is not None else None
        if key is None:
            raise ValueError('merge() requires record["window"] -- there is no keyless push() equivalent')
        try:
            self._ref.child(key).update(record)
        except Exception as e:  
            print(f'[firebase] WARNING: merge failed for window={window}: {e}')

    def set(self, record: dict) -> None:
        try:
            self._ref.set(record)
        except Exception as e:  
            print(f'[firebase] WARNING: set failed for session_id={self.session_id}: {e}')

    def get(self) -> dict | None:
        try:
            return self._ref.get()
        except Exception as e:  
            print(f'[firebase] WARNING: get failed for session_id={self.session_id}: {e}')
            return None

def make_eeg_fusion_record(record: dict) -> dict:
    skipped = bool(record.get('skipped'))
    p = None if skipped else record.get('task_state_score')
    # This user's own effective high_load_p (personal if calibrated, else
    # population default) -- see make_eeg_output_record()'s
    # 'effective_high_load_p' field. Consumed by fusion_engin.py's
    # weighted-threshold combination, not just its probability one.
    threshold = record.get('effective_high_load_p')
    # stress_label_eeg (fusion-facing) is derived from p vs. THIS
    # modality's own effective threshold (personal-else-population), NOT
    # task_state_label's fixed TASK_STATE_LABEL_THRESHOLD=0.5 cutoff --
    # that field is a deliberately different, non-personalized, non-gated
    # raw per-block indicator used elsewhere (see EegSummaryScreen.js's own
    # docstring on why its "Current State" card avoids task_state_label in
    # favor of the persistence-gated high_load_alert). Matches
    # stress_label_hrv_gsr's personal-else-population rule
    # (backend/physiological/app.py's /predict: `1 if prob_stress >
    # personal_threshold else 0`) so both modalities' FUSION-facing labels
    # follow the same effective-threshold rule, not two different ones.
    stress_label_eeg = (
        'unknown' if p is None or threshold is None
        else ('high_task_state' if p >= threshold else 'low_task_state')
    )
    return {
        'window': fusion_window_key(),
        'timestamp_eeg': record.get('timestamp_end'),
        'prob_eeg': p,
        'conf_eeg': None if p is None else record.get('model_confidence'),
        'model_acc_eeg': record.get('model_accuracy'),
        'signal_quality_eeg': record.get('eeg_quality_score'),
        'stress_label_eeg': stress_label_eeg,
        'threshold_eeg': threshold,
    }
