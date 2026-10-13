import time
from pathlib import Path

from backend.common.fusion import fusion_window_key
from backend.psychological.sam40.decision import PERSONAL_SIGMA_PRIOR

TASK_STATE_LABEL_THRESHOLD = 0.5

# Fusion prior a_m for each model: its POOLED LOSO AUC on SAM40, as the
# paper defines a_m (Sect. "Combining EEG and GSR/HRV"). bipolar_only_v1
# was 0.706 here, which is the MEAN PER-PERSON AUC -- a different metric
# from the one the paper's fusion rule specifies.
MODEL_ACCURACY_AUC = {
    'bipolar_only_v1': 0.632,
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
                            high_load_p: float | None = None,
                            capture_end_ts: float | None = None) -> dict:
    # capture_end_ts: when the block's last sample was recorded, supplied by
    # mqtt_bridge.py. timestamp_end drives this block's fusion grid cell
    # (make_eeg_fusion_record() -> fusion_window_key()), so it must be the
    # capture time, not this server's processing time, which lags capture
    # by bridge queueing + network + Render latency. Falls back to
    # processing time for callers that don't send it.
    now = time.time()
    ts_end = capture_end_ts if capture_end_ts is not None else now
    ts_start = ts_end - window_sec

    record = {
        'timestamp_start': ts_start,
        'timestamp_end': ts_end,
        'timestamp_center': (ts_start + ts_end) / 2,
        # Which clock timestamp_end came from, and the processing time --
        # processed - end is this block's end-to-end delivery latency.
        'timestamp_source': 'capture' if capture_end_ts is not None else 'server',
        'timestamp_processed': now,
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
        # Why a block was rejected, and the UNCLAMPED filtered signal's real
        # size (the model's clamped input always reads ptp <= 200 uV).
        'eeg_quality_reason': result.get('quality_reason'),
        'eeg_out_of_range_fraction': result.get('quality_out_of_range_fraction'),
        'eeg_ptp_uv_unclamped': result.get('quality_ptp_uV_unclamped'),
        'eeg_std_uv_unclamped': result.get('quality_std_uV_unclamped'),
        # Every individual quality check, so a rejection can be traced to
        # the check that caused it (None where a check didn't run).
        'eeg_quality_checks': {
            k: result.get(f'quality_{k}') for k in (
                'gate_rating', 'snr_db', 'itakura_distance', 'itakura_skipped',
                'kurtosis', 'skew', 'std_uV', 'peak_to_peak_uV', 'ml_rating',
            )
        },
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
            # Personal Scale (sam40/decision.py): distance above this
            # session's own rest, in units of resting noise. The alert is
            # z >= PERSONAL_K_ALERT, i.e. task_state_score >= effective_high_load_p.
            'task_state_z': result.get('task_state_z'),
            'personal_rest_mean': result.get('mu_rest'),
            'personal_sigma': result.get('personal_sigma'),
            # Onboarding responsiveness (None = task not done yet). False =
            # this model isn't tracking load for this person -> no fusion
            # weight (make_eeg_fusion_record()).
            'eeg_responsive': result.get('eeg_responsive'),
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

    def update(self, record: dict) -> None:
        """Plain shallow update on THIS ref's own node (RTDB's standard
        merge semantics) -- distinct from merge() above, which is
        specifically for a window-keyed CHILD under a per-session
        container and unconditionally requires record['window']. Use this
        one for a ref that already points at the exact node to update
        (e.g. a per-user profile node), where set() would wipe sibling
        fields written by an earlier, separate call."""
        try:
            self._ref.update(record)
        except Exception as e:
            print(f'[firebase] WARNING: update failed for session_id={self.session_id}: {e}')

    def get(self) -> dict | None:
        try:
            return self._ref.get()
        except Exception as e:  
            print(f'[firebase] WARNING: get failed for session_id={self.session_id}: {e}')
            return None

def eeg_fusion_exclusion(record: dict) -> str | None:
    """Why this block must NOT enter fusion, or None if it may. A block
    excluded here is written with prob_eeg=None, which fusion_engin.py
    treats as "EEG not reporting" (weight 0) -- the fused result then rests
    on HRV/GSR alone instead of on a load score known to be uninformative:
      - skipped: rejected by the quality gate, no score at all
      - not_responsive: the onboarding task showed this model doesn't track
        load for this person (chance-level on SAM40 -- see
        sam40/decision.py::task_response_z())
      - degraded_baseline: no rest block cleared the quality bar, so
        mu_rest (and every z measured from it) rests on a weak block
      - no_personal_baseline: no scoreable rest block at all"""
    if record.get('skipped'):
        return 'skipped'
    if record.get('eeg_responsive') is False:
        return 'not_responsive'
    if record.get('baseline_degraded'):
        return 'degraded_baseline'
    if record.get('personal_rest_mean') is None:
        return 'no_personal_baseline'
    return None


def make_eeg_fusion_record(record: dict) -> dict:
    excluded = eeg_fusion_exclusion(record)
    p = None if excluded else record.get('task_state_score')
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
        # This block's OWN real capture-end time, not a fresh time.time()
        # read here -- see fusion_window_key()'s docstring for why bucketing
        # by real capture time (rather than whatever moment this write
        # happens to complete at) matters.
        'window': fusion_window_key(record.get('timestamp_end')),
        'timestamp_eeg': record.get('timestamp_end'),
        'prob_eeg': p,
        # Fusion confidence c_m = max(p, 1-p) -- the paper's fusion rule
        # (Sect. "Combining EEG and GSR/HRV"; paper/analysis/
        # fusion_comparison.py) and what the GSR/HRV side already sends
        # (physiological/predictor.py: max(prob_normal, prob_stress)). Was
        # model_confidence (|p - 0.5| * 2), a different scale from the
        # other modality's, so the two weights weren't comparable.
        'conf_eeg': None if p is None else max(p, 1.0 - p),
        'model_acc_eeg': record.get('model_accuracy'),
        'signal_quality_eeg': record.get('eeg_quality_score'),
        'stress_label_eeg': stress_label_eeg,
        'threshold_eeg': threshold,
        # Personal Scale sigma -- fusion_engin.py's fused_relative_index
        # normalizes (prob - threshold) by this, so EEG's term is exactly
        # z - PERSONAL_K_ALERT: distance from the alert in units of this
        # person's resting noise.
        'threshold_scale_eeg': record.get('personal_sigma') or PERSONAL_SIGMA_PRIOR,
        # Why EEG has no prob this window (None = it does). Purely
        # diagnostic; fusion only looks at prob_eeg.
        'eeg_excluded_reason': excluded,
        'z_eeg': None if excluded else record.get('task_state_z'),
    }
