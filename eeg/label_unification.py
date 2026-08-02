import os
from pathlib import Path
import numpy as np
import pandas as pd
from collections import deque
from typing import Dict, List, Optional, Tuple
from scipy.signal import resample as scipy_resample

_HERE = Path(__file__).resolve().parent          # …/eeg/
_DATA = _HERE / "data"

# ─────────────────────────────────────────────
#  CONSTANTS
# ─────────────────────────────────────────────

# DEAP participant ratings table (from official DEAP metadata XLS)
DEAP_RATINGS_XLS = str(_DATA / "deap-dataset" / "Metadata" / "participant_ratings.xls")

# SAM40 self-reported stress ratings XLS and raw EEG folder
SAM40_SCALES_XLS   = str(_DATA / "SAM40" / "scales.xls")
SAM40_RAW_DATA_DIR = str(_DATA / "SAM40" / "raw_data")

# Sampling-rate alignment
# DEAP is recorded at 128 Hz; SAM40 at 256 Hz.
# All EEG is resampled to EEG_TARGET_SFREQ before stacking so arrays share
# a common time dimension.  Trials are then truncated to EEG_TARGET_SAMPLES
# (= SAM40 trial length: 3200 samples = 12.5 s at 256 Hz).
DEAP_SFREQ         = 128   # Hz
SAM40_SFREQ        = 256   # Hz
EEG_TARGET_SFREQ   = 256   # Hz  — unified sampling rate
EEG_TARGET_SAMPLES = 3200  # samples at EEG_TARGET_SFREQ (12.5 s)

# DEAP channel indices (0-based in the standard 32-ch layout)
T7_CH_INDEX = 6   # channel 7  in DEAP (0-indexed = 6)
T8_CH_INDEX = 23  # channel 24 in DEAP (0-indexed = 23)

# Thresholds
DEAP_VALENCE_THRESHOLD  = 5.0   # midpoint of 1-9 scale
DEAP_AROUSAL_THRESHOLD  = 5.0
SAM40_STRESS_THRESHOLD  = 5.0   # midpoint of 1-10 scale (global fallback only)

# SAM40 per-subject normalization.
# Global threshold (5.0) ignores response-style bias: one person's 5 is
# another's 7. Z-score normalization removes this by expressing each score
# relative to the subject's own stress-task distribution (mean ± std computed
# over their 9 stress trials, excluding relaxation which is 0 by design).
# z > 0.0 = above own mean = stressed relative to personal baseline.
SAM40_Z_SCORE_THRESHOLD = 0.0   # z > threshold → emotional stress label = 1
SAM40_PERC_MIN_TRIAL    = 2     # trial within a task at which perceived stress
                                 # can first fire (trial 1 = acute; trial 2+ = sustained)

# Perceived stress rolling window
# How many consecutive epochs with emotional_stress=1 before we label
# perceived_stress=1 at that moment.
# At 256 Hz with 2-second epochs → 1 window = 2 s
# 10 consecutive stressed epochs = 20 seconds of sustained emotional stress
PERCEIVED_WINDOW_SIZE         = 10   # number of epochs
PERCEIVED_STRESS_RATIO_MIN    = 0.6  # 60% of window must be emotional-stress=1

# Pre-stage stress: the build-up phase immediately before perceived stress fires.
# y_pre_stage = 1 when y_emo = 1 AND y_perc = 0 within a trial that will
# eventually reach perceived stress.  These epochs carry the RISING EEG signature
# of stress accumulation and are the primary target for early-warning detection.
# Derived automatically from (y_emo, y_perc) — no additional labelling needed.
PERCEIVED_TIME_DECAY_RATE     = 1.0  # exp decay per normalized inter-trial gap
                                      # e.g. 1.0 → trial 1 median-gap back ≈ 0.37 weight
DEAP_DOMINANCE_THRESHOLD      = 5.0  # midpoint of 1-9 scale; low dominance ↔ loss of control

# Continuous stress score: S = α·A + β·(9-V) + γ·(9-D), normalised to [0, 1].
# Motivation: high arousal + low valence alone does not uniquely indicate stress —
# fear, anger, and disgust occupy the same VAD quadrant. A weighted continuous score
# is more defensible than a hard binary threshold and avoids the peer-reviewer
# criticism "authors equate negative affect with stress without physiological validation."
# Dominance helps separate loss-of-control states (stress, fear; low D) from
# control-asserting ones (anger; high D). γ=0 degrades gracefully when D is absent.
# α=β=0.4, γ=0.2 weight arousal and valence equally while giving modest dominance
# credit; tune via validate_perceived_threshold() against a labelled stress proxy.
STRESS_SCORE_ALPHA     = 0.4   # arousal weight
STRESS_SCORE_BETA      = 0.4   # negative-valence weight  (9 - V)
STRESS_SCORE_GAMMA     = 0.2   # low-dominance weight     (9 - D); 0 → ignore dominance
STRESS_SCORE_THRESHOLD = 0.5   # S ∈ [0,1]; ≥ threshold → emotional stress label = 1

# SAM40 task codes used internally
SAM40_TASK_RELAXATION = "relaxation"
SAM40_TASK_STROOP     = "stroop"
SAM40_TASK_ARITHMETIC = "arithmetic"
SAM40_TASK_MIRROR     = "mirror"

# Tasks that induce acute / emotional stress
SAM40_STRESS_TASKS = {SAM40_TASK_STROOP, SAM40_TASK_ARITHMETIC, SAM40_TASK_MIRROR}

# Map internal task name → raw_data filename prefix
SAM40_FILE_PREFIX = {
    SAM40_TASK_RELAXATION : "Relax",
    SAM40_TASK_ARITHMETIC : "Arithmetic",
    SAM40_TASK_MIRROR     : "Mirror_image",
    SAM40_TASK_STROOP     : "Stroop",
}

# Canonical trial order for loading (relaxation first, then stress tasks)
SAM40_TRIAL_ORDER = [
    (SAM40_TASK_RELAXATION, 1), (SAM40_TASK_RELAXATION, 2), (SAM40_TASK_RELAXATION, 3),
    (SAM40_TASK_ARITHMETIC, 1), (SAM40_TASK_ARITHMETIC, 2), (SAM40_TASK_ARITHMETIC, 3),
    (SAM40_TASK_MIRROR,     1), (SAM40_TASK_MIRROR,     2), (SAM40_TASK_MIRROR,     3),
    (SAM40_TASK_STROOP,     1), (SAM40_TASK_STROOP,     2), (SAM40_TASK_STROOP,     3),
]


def _align_eeg(eeg: np.ndarray, src_sfreq: int) -> np.ndarray:
    """Resample (n_trials, n_ch, T) from src_sfreq to EEG_TARGET_SFREQ, then truncate."""
    if src_sfreq != EEG_TARGET_SFREQ:
        n_out = int(eeg.shape[2] * EEG_TARGET_SFREQ / src_sfreq)
        eeg = scipy_resample(eeg, n_out, axis=2).astype(np.float32)
    return eeg[:, :, :EEG_TARGET_SAMPLES]


# ─────────────────────────────────────────────
#  DEAP RATINGS LOADER
# ─────────────────────────────────────────────

def load_deap_ratings(xls_path: str = DEAP_RATINGS_XLS) -> pd.DataFrame:
    df = pd.read_excel(xls_path)
    return df.sort_values(['Participant_id', 'Trial']).reset_index(drop=True)


def get_subject_ratings(ratings_df: pd.DataFrame, participant_id: int) -> pd.DataFrame:
    return (
        ratings_df[ratings_df['Participant_id'] == participant_id]
        .sort_values('Trial')
        .reset_index(drop=True)
    )


# ─────────────────────────────────────────────
#  DEAP LABEL FUNCTIONS
# ─────────────────────────────────────────────

def deap_stress_score(
    valence: float,
    arousal: float,
    dominance: Optional[float] = None,
    alpha: float = STRESS_SCORE_ALPHA,
    beta: float  = STRESS_SCORE_BETA,
    gamma: float = STRESS_SCORE_GAMMA,
) -> float:
    """
    Continuous stress intensity S ∈ [0, 1].

    S = (α·A + β·(9−V) [+ γ·(9−D)]) / (9·Σweights)

    Returns a graded score rather than a hard binary decision, avoiding the
    scientific pitfall of equating the full high-arousal/low-valence quadrant
    (which includes fear, anger, disgust) with stress specifically.
    Including dominance (γ > 0) down-weights anger (high D) and up-weights
    loss-of-control states (stress, fear; low D).
    """
    score        = alpha * arousal + beta * (9.0 - valence)
    sum_weights  = alpha + beta
    if dominance is not None and gamma > 0.0:
        score       += gamma * (9.0 - dominance)
        sum_weights += gamma
    return float(score / (9.0 * sum_weights))


def deap_emotional_stress_label(
    valence: float,
    arousal: float,
    dominance: Optional[float] = None,
    valence_threshold: float   = DEAP_VALENCE_THRESHOLD,
    arousal_threshold: float   = DEAP_AROUSAL_THRESHOLD,
    dominance_threshold: float = DEAP_DOMINANCE_THRESHOLD,
    use_probabilistic_score: bool = False,
    stress_score_threshold: float = STRESS_SCORE_THRESHOLD,
    alpha: float = STRESS_SCORE_ALPHA,
    beta: float  = STRESS_SCORE_BETA,
    gamma: float = STRESS_SCORE_GAMMA,
) -> int:
    if use_probabilistic_score:
        # Continuous score mode: avoids hard VAD thresholds. The score weights
        # all three dimensions (arousal, negative valence, low dominance) so that
        # anger (high D) yields a lower score than stress/fear (low D) at the same A/V.
        score = deap_stress_score(valence, arousal, dominance, alpha, beta, gamma)
        return int(score >= stress_score_threshold)

    # Binary rule (default, backward-compatible)
    high_arousal  = arousal   > arousal_threshold
    low_valence   = valence   < valence_threshold
    if dominance is not None:
        # Low dominance (feeling out of control) is a strong stress correlate.
        # All three conditions together give a tighter stress quadrant.
        low_dominance = dominance < dominance_threshold
        return int(high_arousal and low_valence and low_dominance)
    return int(high_arousal and low_valence)


def deap_perceived_stress_label(
    emotional_label_sequence: List[int],
    window_size: int = PERCEIVED_WINDOW_SIZE,
    stress_ratio_min: float = PERCEIVED_STRESS_RATIO_MIN,
    start_times: Optional[List[float]] = None,
    time_decay_rate: float = PERCEIVED_TIME_DECAY_RATE,
) -> int:
    if len(emotional_label_sequence) < window_size:
        return 0

    window_labels = emotional_label_sequence[-window_size:]

    if start_times is None or len(start_times) < window_size:
        # Fallback: uniform weighting (original behaviour)
        stress_ratio = sum(window_labels) / window_size
    else:
        # Time-weighted: trials separated by a long gap contribute less.
        # Gaps are normalised by the median gap so the decay rate is
        # scale-independent of the Start_time units in the XLS.
        window_times = np.asarray(start_times[-window_size:], dtype=np.float64)
        gaps = np.diff(window_times)
        pos_gaps = gaps[gaps > 0]
        median_gap = float(np.median(pos_gaps)) if len(pos_gaps) > 0 else 1.0
        norm_gaps = gaps / median_gap
        # elapsed[k] = normalised time from window position k to the last position
        elapsed = np.zeros(window_size)
        for k in range(window_size - 1):
            elapsed[k] = float(np.sum(norm_gaps[k:]))
        weights = np.exp(-time_decay_rate * elapsed)
        weights /= weights.sum()
        stress_ratio = float(np.dot(weights, window_labels))

    return int(stress_ratio >= stress_ratio_min)


def validate_perceived_threshold(
    ratings_df: pd.DataFrame,
    valence_thresholds: Optional[List[float]]   = None,
    arousal_thresholds: Optional[List[float]]   = None,
    dominance_thresholds: Optional[List[float]] = None,
) -> pd.DataFrame:
    """
    Sweep valence/arousal/dominance thresholds and measure how well the resulting
    per-subject emotional_stress_ratio correlates with a continuous stress proxy.

    Stress proxy per subject = mean(arousal - valence + (9 - dominance)) / 9
    (higher → more stressed: high arousal, low valence, low dominance)

    Returns a DataFrame sorted by pearson_r descending:
        val_thresh, aro_thresh, dom_thresh, pearson_r, pos_rate
    """
    from scipy.stats import pearsonr

    val_range = valence_thresholds   or [3.5, 4.0, 4.5, 5.0, 5.5, 6.0]
    aro_range = arousal_thresholds   or [3.5, 4.0, 4.5, 5.0, 5.5, 6.0]
    dom_range = dominance_thresholds or [4.0, 4.5, 5.0, 5.5, 6.0, None]

    # Continuous per-subject stress proxy derived from the three VAD dimensions
    subj_proxy = (
        ratings_df
        .groupby('Participant_id')
        .apply(lambda g: float(
            ((g['Arousal'] - g['Valence'] + (9 - g['Dominance'])) / 9).mean()
        ))
    )

    records = []
    for vt in val_range:
        for at in aro_range:
            for dt in dom_range:
                tmp = ratings_df.copy()
                tmp['y_emo'] = tmp.apply(
                    lambda r: deap_emotional_stress_label(
                        r['Valence'], r['Arousal'],
                        dominance          = r['Dominance'] if dt is not None else None,
                        valence_threshold  = vt,
                        arousal_threshold  = at,
                        dominance_threshold= dt if dt is not None else DEAP_DOMINANCE_THRESHOLD,
                    ),
                    axis=1,
                )
                subj_ratio = tmp.groupby('Participant_id')['y_emo'].mean()
                common = subj_ratio.index.intersection(subj_proxy.index)
                if len(common) < 4:
                    continue
                r_val, _ = pearsonr(subj_ratio[common], subj_proxy[common])
                records.append({
                    'val_thresh': vt,
                    'aro_thresh': at,
                    'dom_thresh': dt,
                    'pearson_r' : round(float(r_val), 4),
                    'pos_rate'  : round(float(tmp['y_emo'].mean()), 4),
                })

    return (
        pd.DataFrame(records)
        .sort_values('pearson_r', ascending=False)
        .reset_index(drop=True)
    )


def process_deap_subject(
    subject_data: Dict,
    window_size: int = PERCEIVED_WINDOW_SIZE,
    stress_ratio_min: float = PERCEIVED_STRESS_RATIO_MIN,
    valence_threshold: float = DEAP_VALENCE_THRESHOLD,
    arousal_threshold: float = DEAP_AROUSAL_THRESHOLD,
    dominance_threshold: float = DEAP_DOMINANCE_THRESHOLD,
    use_dominance: bool = True,
    time_decay_rate: float = PERCEIVED_TIME_DECAY_RATE,
    subject_ratings: Optional[pd.DataFrame] = None,
    use_probabilistic_score: bool = False,
    stress_score_alpha: float = STRESS_SCORE_ALPHA,
    stress_score_beta: float  = STRESS_SCORE_BETA,
    stress_score_gamma: float = STRESS_SCORE_GAMMA,
    stress_score_threshold: float = STRESS_SCORE_THRESHOLD,
) -> Dict[str, np.ndarray]:
    # """
    # Full label extraction for one DEAP subject.

    # DEAP file structure (after loading .dat files):
    #     data   : shape (40 trials, 40 channels, 8064 samples)
    #     labels : shape (40 trials, 4)  → columns: valence, arousal, dominance, liking

    # Parameters
    # ----------
    # subject_data : dict
    #     Loaded from DEAP .dat file. Keys: 'data', 'labels'.
    # window_size : int
    #     Rolling window for perceived stress.
    # stress_ratio_min : float
    #     Threshold fraction for perceived stress.
    # valence_threshold, arousal_threshold : float
    #     Cutoff values on 1-9 scale.

    # Returns
    # -------
    # dict with keys:
    #     'eeg_t7t8'           : np.ndarray (n_trials, 2, n_samples) — T7 and T8 channels
    #     'eeg_full'           : np.ndarray (n_trials, 32, n_samples) — all 32 EEG channels
    #     'emotional_labels'   : np.ndarray (n_trials,) — binary emotional stress per trial
    #     'perceived_labels'   : np.ndarray (n_trials,) — binary perceived stress per trial
    #     'valence_raw'        : np.ndarray (n_trials,) — original valence scores
    #     'arousal_raw'        : np.ndarray (n_trials,) — original arousal scores
    # """
    eeg_data = subject_data['data']    # (40, 40, 8064)
    n_trials = eeg_data.shape[0]

    # EEG only channels are 0..31 (channels 32-39 are peripheral signals in DEAP)
    eeg_only = _align_eeg(eeg_data[:, :32, :], DEAP_SFREQ)   # (40, 32, EEG_TARGET_SAMPLES)
    eeg_t7t8 = _align_eeg(eeg_data[:, [T7_CH_INDEX, T8_CH_INDEX], :], DEAP_SFREQ)  # (40, 2, EEG_TARGET_SAMPLES)

    if subject_ratings is not None:
        # Use official participant_ratings.xls as the label source (sorted by Trial)
        r = subject_ratings.sort_values('Trial').reset_index(drop=True)
        valence_scores     = r['Valence'].to_numpy(dtype=np.float32)
        arousal_scores     = r['Arousal'].to_numpy(dtype=np.float32)
        dominance_scores   = r['Dominance'].to_numpy(dtype=np.float32)
        liking_scores      = r['Liking'].to_numpy(dtype=np.float32)
        familiarity_scores = r['Familiarity'].to_numpy(dtype=np.float32)
        # Start_time enables time-weighted perceived stress (scale-independent)
        start_times_arr = (
            r['Start_time'].to_numpy(dtype=np.float64)
            if 'Start_time' in r.columns else None
        )
    else:
        raw_labels = subject_data['labels']  # (40, 4)
        valence_scores     = raw_labels[:, 0]
        arousal_scores     = raw_labels[:, 1]
        dominance_scores   = raw_labels[:, 2] if raw_labels.shape[1] > 2 else None
        liking_scores      = raw_labels[:, 3] if raw_labels.shape[1] > 3 else None
        familiarity_scores = None
        start_times_arr    = None

    # ── Step 1: Per-trial emotional stress labels ──
    # When use_dominance=True and dominance is available, require low dominance
    # (loss of control) as a third condition alongside high arousal + low valence.
    dom_iter = (
        dominance_scores if (use_dominance and dominance_scores is not None)
        else [None] * n_trials
    )
    emotional_labels = np.array([
        deap_emotional_stress_label(
            v, a, d,
            valence_threshold        = valence_threshold,
            arousal_threshold        = arousal_threshold,
            dominance_threshold      = dominance_threshold,
            use_probabilistic_score  = use_probabilistic_score,
            stress_score_threshold   = stress_score_threshold,
            alpha                    = stress_score_alpha,
            beta                     = stress_score_beta,
            gamma                    = stress_score_gamma,
        )
        for v, a, d in zip(valence_scores, arousal_scores, dom_iter)
    ], dtype=np.int32)

    # Continuous score is always computed (regardless of labelling mode) so
    # callers can inspect raw stress intensity, plot distributions, or tune
    # the threshold post-hoc without re-running the full pipeline.
    dom_for_score = (
        dominance_scores if dominance_scores is not None else [None] * n_trials
    )
    stress_scores_continuous = np.array([
        deap_stress_score(v, a, d, stress_score_alpha, stress_score_beta, stress_score_gamma)
        for v, a, d in zip(valence_scores, arousal_scores, dom_for_score)
    ], dtype=np.float32)

    # ── Step 2: Per-trial latent sustained stress targets (rolling window, self-supervised) ──
    # Trials are ordered in time — trial 0 happened before trial 1, etc.
    # When start_times_arr is available, gaps between trials modulate weights
    # so a long break reduces the carry-over of past emotional stress state.
    perceived_labels = np.full(n_trials, -1, dtype=np.int32)  # -1 = SAM40 sentinel
    label_history = []
    time_history  = []

    for i in range(n_trials):
        label_history.append(int(emotional_labels[i]))
        if start_times_arr is not None:
            time_history.append(start_times_arr[i])
        perceived_labels[i] = deap_perceived_stress_label(
            label_history, window_size, stress_ratio_min,
            start_times    = time_history if time_history else None,
            time_decay_rate= time_decay_rate,
        )

    return {
        'eeg_t7t8'                : eeg_t7t8,
        'eeg_full'                : eeg_only,
        'emotional_labels'        : emotional_labels,
        'perceived_labels'        : perceived_labels,
        'stress_scores_continuous': stress_scores_continuous,
        'valence_raw'             : valence_scores,
        'arousal_raw'             : arousal_scores,
        'dominance_raw'           : dominance_scores,
        'liking_raw'              : liking_scores,
        'familiarity_raw'         : familiarity_scores,
    }


# ─────────────────────────────────────────────
#  SAM40 SCALES LOADER
# ─────────────────────────────────────────────

def load_sam40_scales(xls_path: str = SAM40_SCALES_XLS) -> pd.DataFrame:
    """
    Parse scales.xls into long form with columns:
        subject_id (int), task (str), trial (int 1-3), score (float 1-10)

    XLS layout (two merged header rows):
        Row 0: Subject No. | Trial_1 (x3) | Trial_2 (x3) | Trial_3 (x3)
        Row 1:             | Maths | Symmetry | Stroop  (repeated per trial group)
        Rows 2+: data

    Task mapping:  Maths → arithmetic,  Symmetry → mirror,  Stroop → stroop
    Relaxation is NOT in the scales (always stress = 0).
    """
    raw = pd.read_excel(xls_path, header=None)
    data = raw.iloc[2:].reset_index(drop=True)

    # Column layout: [subject, t1_arith, t1_mirror, t1_stroop,
    #                          t2_arith, t2_mirror, t2_stroop,
    #                          t3_arith, t3_mirror, t3_stroop]
    records = []
    for _, row in data.iterrows():
        subj = int(row[0])
        col_offset = 1
        for trial in range(1, 4):
            for task in [SAM40_TASK_ARITHMETIC, SAM40_TASK_MIRROR, SAM40_TASK_STROOP]:
                records.append({
                    'subject_id': subj,
                    'task'      : task,
                    'trial'     : trial,
                    'score'     : float(row[col_offset]),
                })
                col_offset += 1

    return pd.DataFrame(records)


def load_sam40_subject_from_raw(
    raw_data_dir: str,
    subject_id: int,
    scales_df: pd.DataFrame,
) -> Dict:
    """
    Load one SAM40 subject's EEG from raw .mat files and pair with XLS scores.

    Returns dict compatible with process_sam40_subject():
        'eeg'    : np.ndarray  (12, 32, n_samples) — 12 trials in SAM40_TRIAL_ORDER
        'scores' : list of {'task', 'trial', 'score'} — one per trial, same order
    """
    import scipy.io as sio

    idx = scales_df.set_index(['subject_id', 'task', 'trial'])['score']

    eeg_list = []
    scores   = []

    for task, trial in SAM40_TRIAL_ORDER:
        prefix = SAM40_FILE_PREFIX[task]
        fname  = f"{prefix}_sub_{subject_id}_trial{trial}.mat"
        fpath  = os.path.join(raw_data_dir, fname)
        mat    = sio.loadmat(fpath)
        eeg_list.append(mat['Data'].astype(np.float32))  # (32, n_samples)

        if task == SAM40_TASK_RELAXATION:
            score = 0.0
        else:
            score = float(idx.loc[(subject_id, task, trial)])

        scores.append({'task': task, 'trial': trial, 'score': score})

    return {
        'eeg'    : np.stack(eeg_list, axis=0),  # (12, 32, n_samples)
        'scores' : scores,
    }


def load_all_sam40_subjects(
    raw_data_dir: str = SAM40_RAW_DATA_DIR,
    scales_path: str  = SAM40_SCALES_XLS,
    subject_ids: Optional[List[int]] = None,
) -> List[Dict]:
    """
    Load all (or selected) SAM40 subjects from raw_data/ + scales.xls.
    Returns list of dicts ready for build_unified_dataset(sam40_subjects=...).
    """
    scales_df   = load_sam40_scales(scales_path)
    subject_ids = subject_ids or list(range(1, 41))
    return [
        load_sam40_subject_from_raw(raw_data_dir, sid, scales_df)
        for sid in subject_ids
    ]


# ─────────────────────────────────────────────
#  SAM40 LABEL FUNCTIONS
# ─────────────────────────────────────────────

def sam40_emotional_stress_label(
    stress_score: float,
    task_type: Optional[str] = None,
    score_threshold: float = SAM40_STRESS_THRESHOLD,
) -> int:
    # """
    # Map a SAM40 stress score (and optionally task type) to an emotional stress label.

    # Two-layer logic:
    #   1. Relaxation task is ALWAYS label 0 (regardless of score).
    #      Subjects are resting — no acute stress is induced.
    #   2. For cognitive tasks: score > threshold → label 1.

    # Parameters
    # ----------
    # stress_score : float
    #     Subjective stress rating (1–10). Higher = more stressed.
    # task_type : str or None
    #     One of: 'relaxation', 'stroop', 'arithmetic', 'mirror'.
    #     If None, only the score threshold is used.
    # score_threshold : float
    #     Cutoff above which the score counts as stressed. Default 5.0.

    # Returns
    # -------
    # int
    #     1 = emotional stress present, 0 = not stressed.

    # Examples
    # --------
    # >>> sam40_emotional_stress_label(stress_score=8, task_type='stroop')
    # 1   # cognitive task + high score → stressed

    # >>> sam40_emotional_stress_label(stress_score=8, task_type='relaxation')
    # 0   # relaxation overrides high score → not stressed

    # >>> sam40_emotional_stress_label(stress_score=3, task_type='arithmetic')
    # 0   # cognitive task but low score → not stressed
    # """
    # Relaxation always maps to 0
    if task_type == SAM40_TASK_RELAXATION:
        return 0

    return int(stress_score > score_threshold)


def sam40_perceived_stress_label(
    stress_score: float,
    task_type: str,
    trial_number: int,
    trials_per_task: int = 3,
    score_threshold: float = SAM40_STRESS_THRESHOLD,
    min_trial_for_perceived: int = 2,
) -> int:
    # """
    # Derive a latent sustained stress auxiliary target from SAM40 trial context.

    # Perceived stress in SAM40 reflects SUSTAINED cognitive load.
    # We model it using two joint conditions:
    #   1. The task must be a stress-inducing type (not relaxation).
    #   2. The stress score must be above threshold.
    #   3. The subject must be in trial >= min_trial_for_perceived
    #      (perceived stress needs time to accumulate — early in trial 1
    #       the subject may still be acute-reacting, not yet perceiving sustained stress).

    # Parameters
    # ----------
    # stress_score : float
    #     Subjective stress rating (1–10).
    # task_type : str
    #     Task name.
    # trial_number : int
    #     Which trial (1-indexed, within this task session).
    # trials_per_task : int
    #     Total trials per task in SAM40 (default 3).
    # score_threshold : float
    #     Score threshold for stress.
    # min_trial_for_perceived : int
    #     Minimum trial number before perceived stress can be flagged.

    # Returns
    # -------
    # int
    #     1 = perceived stress pre-detected, 0 = not yet.
    # """
    # Relaxation cannot induce perceived stress
    if task_type == SAM40_TASK_RELAXATION:
        return 0

    is_stress_task  = task_type in SAM40_STRESS_TASKS
    is_high_score   = stress_score > score_threshold
    is_sustained    = trial_number >= min_trial_for_perceived

    return int(is_stress_task and is_high_score and is_sustained)


def process_sam40_subject(
    subject_eeg: np.ndarray,
    subject_scores: List[Dict],
    t7_ch_index: int = T7_CH_INDEX,
    t8_ch_index: int = T8_CH_INDEX,
    score_threshold: float           = SAM40_STRESS_THRESHOLD,
    use_subject_normalization: bool  = True,
    z_score_threshold: float         = SAM40_Z_SCORE_THRESHOLD,
    enable_sam40_perceived: bool     = True,
    perc_min_trial: int              = SAM40_PERC_MIN_TRIAL,
) -> Dict[str, np.ndarray]:
    # """
    # Full label extraction for one SAM40 subject.
    #
    # Per-subject z-score normalization (use_subject_normalization=True):
    #   μ and σ are computed from the subject's 9 stress-task scores only
    #   (relaxation excluded — it is always 0 by design, not a genuine rating).
    #   Label = 1 when z = (score − μ) / σ > z_score_threshold.
    #   This removes response-style bias: a "5" from a chronically low-rater
    #   is treated differently from a "5" from a chronically high-rater.
    #
    # Perceived stress re-enabled (enable_sam40_perceived=True):
    #   Trial 1 of a stress task → acute response; perceived_label = 0.
    #   Trial ≥ perc_min_trial  → sustained cognitive load accumulated;
    #   perceived_label = 1 iff above-threshold score.
    #   This mirrors the real phenomenology: perceived stress builds over time.
    # """
    n_trials  = subject_eeg.shape[0]
    aligned   = _align_eeg(subject_eeg, SAM40_SFREQ)
    eeg_t7t8  = aligned[:, [t7_ch_index, t8_ch_index], :]
    eeg_full  = aligned
    raw_scores = np.array([info['score'] for info in subject_scores], dtype=np.float64)

    # ── Per-subject z-score normalization ──────────────────────────────────
    # Compute μ / σ from stress-task scores only. Relaxation scores (=0 by
    # design) would artificially pull the mean down and inflate σ.
    if use_subject_normalization:
        stress_idx  = [i for i, info in enumerate(subject_scores)
                       if info['task'] != SAM40_TASK_RELAXATION]
        stress_vals = raw_scores[stress_idx]
        if len(stress_vals) >= 2 and stress_vals.std() > 1e-6:
            subj_mu    = float(stress_vals.mean())
            subj_sigma = float(stress_vals.std())
        else:
            subj_mu    = float(score_threshold)
            subj_sigma = 1.0
        z_scores = (raw_scores - subj_mu) / subj_sigma
    else:
        subj_mu    = float(score_threshold)
        subj_sigma = 1.0
        z_scores   = np.full(n_trials, np.nan)

    emotional_labels = np.zeros(n_trials, dtype=np.int32)
    perceived_labels = np.zeros(n_trials, dtype=np.int32)
    task_types       = []
    trial_numbers    = []

    for i, trial_info in enumerate(subject_scores):
        task  = trial_info['task']
        trial = trial_info['trial']
        score = float(raw_scores[i])
        z     = float(z_scores[i])

        task_types.append(task)
        trial_numbers.append(trial)

        # ── Emotional label ──
        if task == SAM40_TASK_RELAXATION:
            emotional_labels[i] = 0
        elif use_subject_normalization:
            emotional_labels[i] = int(z > z_score_threshold)
        else:
            emotional_labels[i] = sam40_emotional_stress_label(score, task, score_threshold)

        # ── Perceived / latent sustained stress target ──
        # Trial progression: trial 1 = acute (label=0), trial ≥ 2 = sustained
        # cognitive load where perceived stress accumulates (label=1 if stressed).
        if not enable_sam40_perceived:
            perceived_labels[i] = -1  # legacy sentinel
        elif task == SAM40_TASK_RELAXATION:
            perceived_labels[i] = 0
        else:
            is_stress_task = task in SAM40_STRESS_TASKS
            is_sustained   = trial >= perc_min_trial
            is_high        = (z > z_score_threshold) if use_subject_normalization \
                             else (score > score_threshold)
            perceived_labels[i] = int(is_stress_task and is_high and is_sustained)

    return {
        'eeg_t7t8'          : eeg_t7t8,
        'eeg_full'          : eeg_full,
        'emotional_labels'  : emotional_labels,
        'perceived_labels'  : perceived_labels,
        'task_types'        : task_types,
        'trial_numbers'     : trial_numbers,
        'scores_raw'        : raw_scores.astype(np.float32),
        'z_scores'          : z_scores.astype(np.float32),
        'subj_mu'           : subj_mu,
        'subj_sigma'        : subj_sigma,
    }


# ─────────────────────────────────────────────
#  UNIFIED DATASET BUILDER
# ─────────────────────────────────────────────

class UnifiedStressDataset:
    # """
    # Merges processed DEAP and SAM40 data into a single training-ready dataset.

    # Each sample carries:
    #     X_full   : full 32-channel EEG features  → feeds the TEACHER model
    #     X_t7t8   : T7 and T8 only features       → feeds the STUDENT model
    #     y_emo    : emotional stress label (0 or 1)
    #     y_perc   : latent sustained stress target (0 or 1; self-supervised auxiliary)
    #     source   : 'deap' or 'sam40'             → for analysis / ablation

    # Two-task design aligns with research goals
    # -------------------------------------------
    #     emotional stress  → teacher & student both predict this directly
    #                         (T7/T8 carry strong signal for temporal lobe emotions)

    #     latent sustained stress (self-supervised auxiliary)
    #                       → teacher learns this auxiliary representation from full EEG
    #                         student inherits it via knowledge distillation
    #                         (T7/T8 alone are weaker here — distillation bridges the gap)
    #                         NOT a ground truth label — derived via rolling-window
    #                         self-supervision over the emotional stress history
    # """

    def __init__(self):
        self.X_full_list        : List[np.ndarray] = []
        self.X_t7t8_list        : List[np.ndarray] = []
        self.y_emo_list         : List[int]         = []
        self.source_list        : List[str]         = []
        self.subject_id_list    : List[int]         = []
        self.trial_idx_list     : List[int]         = []
        self.metadata_list      : List[Dict]        = []

    def add_deap_subject(self, processed: Dict, subject_id: int) -> None:
        # """
        # Add all trials from one processed DEAP subject.

        # Parameters
        # ----------
        # processed : dict
        #     Output of process_deap_subject().
        # subject_id : int
        #     DEAP subject number (1–32).
        # """
        n_trials = len(processed['emotional_labels'])
        for i in range(n_trials):
            emo  = int(processed['emotional_labels'][i])
            self.X_full_list.append(processed['eeg_full'][i])
            self.X_t7t8_list.append(processed['eeg_t7t8'][i])
            self.y_emo_list.append(emo)
            self.source_list.append('deap')
            self.subject_id_list.append(subject_id)
            self.trial_idx_list.append(len(self.trial_idx_list))
            meta = {
                'subject'     : subject_id,
                'trial'       : i,
                'dataset'     : 'deap',
                'valence_raw' : float(processed['valence_raw'][i]),
                'arousal_raw' : float(processed['arousal_raw'][i]),
            }
            if processed.get('dominance_raw') is not None:
                meta['dominance_raw']   = float(processed['dominance_raw'][i])
            if processed.get('liking_raw') is not None:
                meta['liking_raw']      = float(processed['liking_raw'][i])
            if processed.get('familiarity_raw') is not None:
                meta['familiarity_raw'] = float(processed['familiarity_raw'][i])
            self.metadata_list.append(meta)

    def add_sam40_subject(self, processed: Dict, subject_id: int) -> None:
        # """
        # Add all trials from one processed SAM40 subject.

        # Parameters
        # ----------
        # processed : dict
        #     Output of process_sam40_subject().
        # subject_id : int
        #     SAM40 subject number (1–40).
        # """
        n_trials = len(processed['emotional_labels'])
        for i in range(n_trials):
            emo  = int(processed['emotional_labels'][i])
            self.X_full_list.append(processed['eeg_full'][i])
            self.X_t7t8_list.append(processed['eeg_t7t8'][i])
            self.y_emo_list.append(emo)
            self.source_list.append('sam40')
            # SAM40 subject IDs offset by 100 to avoid collision with DEAP (1-32)
            self.subject_id_list.append(subject_id + 100)
            self.trial_idx_list.append(len(self.trial_idx_list))
            self.metadata_list.append({
                'subject'    : subject_id,
                'trial'      : i,
                'dataset'    : 'sam40',
                'task'       : processed['task_types'][i],
                'trial_num'  : processed['trial_numbers'][i],
                'score_raw'  : float(processed['scores_raw'][i]),
            })

    def build(self) -> Dict[str, np.ndarray]:
        # """
        # Finalise and return the unified dataset arrays.

        # Returns
        # -------
        # dict with keys:
        #     'X_full'   : (N, 32, T) — full EEG for teacher
        #     'X_t7t8'   : (N, 2,  T) — T7/T8 EEG for student
        #     'y_emo'    : (N,)       — emotional stress labels
        #     'source'   : (N,)       — 'deap' or 'sam40'
        # """
        return {
            'X_full'     : np.stack(self.X_full_list,    axis=0),
            'X_t7t8'     : np.stack(self.X_t7t8_list,   axis=0),
            'y_emo'      : np.array(self.y_emo_list,     dtype=np.int32),
            'source'     : np.array(self.source_list),
            'subject_id' : np.array(self.subject_id_list, dtype=np.int32),
            'trial_idx'  : np.array(self.trial_idx_list, dtype=np.int32),
        }

    def label_statistics(self) -> Dict:
        # """
        # Print and return label distribution statistics.
        # Useful for checking class balance before training.
        # """
        y_emo = np.array(self.y_emo_list)
        src   = np.array(self.source_list)

        total = len(y_emo)
        stats = {
            'total_samples'          : total,
            'emotional_stress_pos'   : int(y_emo.sum()),
            'emotional_stress_neg'   : int((y_emo == 0).sum()),
            'emotional_stress_ratio' : float(y_emo.mean()),
            'deap_samples'           : int((src == 'deap').sum()),
            'sam40_samples'          : int((src == 'sam40').sum()),
        }

        print("\n" + "="*55)
        print("  UNIFIED DATASET — LABEL STATISTICS")
        print("="*55)
        print(f"  Total samples          : {stats['total_samples']}")
        print(f"  DEAP samples           : {stats['deap_samples']}")
        print(f"  SAM40 samples          : {stats['sam40_samples']}")
        print("-"*55)
        print("  EMOTIONAL STRESS (y_emo)")
        print(f"    Positive (stressed)  : {stats['emotional_stress_pos']}")
        print(f"    Negative             : {stats['emotional_stress_neg']}")
        print(f"    Positive ratio       : {stats['emotional_stress_ratio']:.2%}")
        print("="*55 + "\n")

        return stats


# ─────────────────────────────────────────────
#  EPOCH-LEVEL LABEL ASSIGNMENT
# ─────────────────────────────────────────────

class EpochLabelAssigner:
    # """
    # Assigns emotional stress labels and latent sustained stress targets at the individual EPOCH level.

    # After segmenting continuous EEG into 2-second windows, each window
    # needs both labels. This class maintains a rolling buffer so perceived
    # stress can be tracked across epochs within a trial or session.

    # Usage
    # -----
    # assigner = EpochLabelAssigner()
    # for epoch in trial_epochs:
    #     emotional_label  = <from dataset-level label for this trial>
    #     emo, perc = assigner.assign(emotional_label)
    #     # emo  → label for THIS epoch
    #     # perc → rolling latent sustained stress target for THIS epoch
    # assigner.reset()  # call between subjects / trials if needed
    # """

    def __init__(
        self,
        window_size: int = PERCEIVED_WINDOW_SIZE,
        stress_ratio_min: float = PERCEIVED_STRESS_RATIO_MIN,
    ):
        self.window_size      = window_size
        self.stress_ratio_min = stress_ratio_min
        self._buffer          = deque(maxlen=window_size)

    def assign(self, emotional_label: int) -> Tuple[int, int, int]:
        # """
        # Process one epoch and return (emotional, perceived, pre_stage) labels.
        #
        # pre_stage = 1 when emotional_label=1 AND perceived_label=0:
        #   the build-up phase where stress is accumulating but not yet sustained.
        # """
        self._buffer.append(emotional_label)

        if len(self._buffer) < self.window_size:
            perceived_label = 0
        else:
            ratio = sum(self._buffer) / self.window_size
            perceived_label = int(ratio >= self.stress_ratio_min)

        pre_stage_label = int(emotional_label == 1 and perceived_label == 0)
        return emotional_label, perceived_label, pre_stage_label

    def reset(self) -> None:
        """Clear rolling buffer between sessions or subjects."""
        self._buffer.clear()


# ─────────────────────────────────────────────
#  FULL PIPELINE ENTRY POINT
# ─────────────────────────────────────────────

def build_unified_dataset(
    deap_subjects: Optional[List[Dict]]     = None,
    sam40_subjects: Optional[List[Dict]]    = None,
    perceived_window_size: int              = PERCEIVED_WINDOW_SIZE,
    perceived_stress_ratio: float           = PERCEIVED_STRESS_RATIO_MIN,
    deap_valence_threshold: float           = DEAP_VALENCE_THRESHOLD,
    deap_arousal_threshold: float           = DEAP_AROUSAL_THRESHOLD,
    sam40_score_threshold: float            = SAM40_STRESS_THRESHOLD,
    deap_ratings_path: Optional[str]        = DEAP_RATINGS_XLS,
    sam40_raw_dir: Optional[str]            = None,
    sam40_scales_path: Optional[str]        = SAM40_SCALES_XLS,
    sam40_subject_ids: Optional[List[int]]          = None,
    sam40_use_subject_normalization: bool           = True,
    sam40_z_score_threshold: float                  = SAM40_Z_SCORE_THRESHOLD,
    sam40_enable_perceived: bool                    = True,
    sam40_perc_min_trial: int                       = SAM40_PERC_MIN_TRIAL,
    use_probabilistic_score: bool                   = False,
    stress_score_alpha: float               = STRESS_SCORE_ALPHA,
    stress_score_beta: float                = STRESS_SCORE_BETA,
    stress_score_gamma: float               = STRESS_SCORE_GAMMA,
    stress_score_threshold: float           = STRESS_SCORE_THRESHOLD,
) -> Tuple[Dict[str, np.ndarray], Dict]:
    # """
    # End-to-end pipeline: raw DEAP + SAM40 subjects → unified dataset.

    # Parameters
    # ----------
    # deap_subjects : list of dicts, optional
    #     Each dict has keys 'data' and 'labels' (DEAP .dat file format).
    # sam40_subjects : list of dicts, optional
    #     Each dict has keys 'eeg' (np.ndarray) and 'scores' (list of dicts).
    # perceived_window_size : int
    #     Rolling window size (in epochs) for perceived stress.
    # perceived_stress_ratio : float
    #     Minimum fraction of stressed epochs in window to flag perceived stress.
    # deap_valence_threshold : float
    #     DEAP valence cutoff (default 5 = midpoint of 1-9 scale).
    # deap_arousal_threshold : float
    #     DEAP arousal cutoff (default 5).
    # sam40_score_threshold : float
    #     SAM40 stress score cutoff (default 5 = midpoint of 1-10 scale).

    # Returns
    # -------
    # dataset : dict
    #     Unified arrays ready for model training (see UnifiedStressDataset.build).
    # stats : dict
    #     Label distribution statistics.
    # """
    builder = UnifiedStressDataset()

    ratings_df = load_deap_ratings(deap_ratings_path) if deap_ratings_path else None

    # ── Process DEAP subjects ──
    if deap_subjects:
        print(f"Processing {len(deap_subjects)} DEAP subjects...")
        if ratings_df is not None:
            print(f"  Using participant_ratings.xls: {deap_ratings_path}")
        for idx, subject_data in enumerate(deap_subjects, start=1):
            subject_ratings = (
                get_subject_ratings(ratings_df, idx) if ratings_df is not None else None
            )
            processed = process_deap_subject(
                subject_data,
                window_size              = perceived_window_size,
                stress_ratio_min         = perceived_stress_ratio,
                valence_threshold        = deap_valence_threshold,
                arousal_threshold        = deap_arousal_threshold,
                subject_ratings          = subject_ratings,
                use_probabilistic_score  = use_probabilistic_score,
                stress_score_alpha       = stress_score_alpha,
                stress_score_beta        = stress_score_beta,
                stress_score_gamma       = stress_score_gamma,
                stress_score_threshold   = stress_score_threshold,
            )
            builder.add_deap_subject(processed, subject_id=idx)
            print(f"  DEAP subject {idx:02d} → "
                  f"y_emo +: {processed['emotional_labels'].sum()}/40")

    # ── Auto-load SAM40 from raw_data/ + scales.xls when a directory is given ──
    if sam40_raw_dir and not sam40_subjects:
        print(f"Loading SAM40 subjects from: {sam40_raw_dir}")
        print(f"  Using scales.xls: {sam40_scales_path}")
        sam40_subjects = load_all_sam40_subjects(
            raw_data_dir = sam40_raw_dir,
            scales_path  = sam40_scales_path,
            subject_ids  = sam40_subject_ids,
        )

    # ── Process SAM40 subjects ──
    if sam40_subjects:
        print(f"Processing {len(sam40_subjects)} SAM40 subjects...")
        for idx, subject_data in enumerate(sam40_subjects, start=1):
            processed = process_sam40_subject(
                subject_data['eeg'],
                subject_data['scores'],
                score_threshold           = sam40_score_threshold,
                use_subject_normalization = sam40_use_subject_normalization,
                z_score_threshold         = sam40_z_score_threshold,
                enable_sam40_perceived    = sam40_enable_perceived,
                perc_min_trial            = sam40_perc_min_trial,
            )
            builder.add_sam40_subject(processed, subject_id=idx)
            n = len(processed['emotional_labels'])
            print(f"  SAM40 subject {idx:02d} → "
                  f"y_emo +: {processed['emotional_labels'].sum()}/{n}")

    # ── Build final arrays ──
    dataset = builder.build()
    stats   = builder.label_statistics()

    return dataset, stats


# ─────────────────────────────────────────────
#  QUICK TEST WITH SYNTHETIC DATA
# ─────────────────────────────────────────────

if __name__ == "__main__":

    print("=" * 55)
    print("  LABEL UNIFICATION — UNIT TESTS")
    print("=" * 55)

    # ── deap_stress_score() continuous score tests ──
    print("\n[DEAP] Continuous stress score tests (deap_stress_score):")
    score_cases = [
        # (V, A, D,    lo_bound, hi_bound, note)
        (2, 8, 2, 0.75, 1.00, "Textbook stress: high A, low V, low D → high score"),
        (8, 8, 2, 0.40, 0.75, "Anger: high A, high V, low D → mid-high (V penalty lowers it)"),
        (8, 2, 8, 0.00, 0.30, "Calm: low A, high V, high D → low score"),
        (5, 5, 5, 0.40, 0.60, "Neutral ratings → near midpoint"),
        (2, 8, None, 0.65, 1.00, "No dominance (γ ignored): high A + low V → high score"),
    ]
    for entry in score_cases:
        v, a, d, lo, hi, note = entry
        s = deap_stress_score(v, a, d)
        ok = lo <= s <= hi
        status = "PASS" if ok else "FAIL"
        if not ok: all_pass = False
        d_str = str(d) if d is not None else "None"
        print(f"  [{status}] V={v} A={a} D={d_str} → S={s:.3f}  [{lo:.2f},{hi:.2f}]  | {note}")

    # ── Probabilistic label mode — same cases, now as binary via score threshold ──
    print("\n[DEAP] Probabilistic label mode (use_probabilistic_score=True, threshold=0.5):")
    prob_cases = [
        (2, 8, 2, 1, "High stress score → label 1"),
        (8, 2, 8, 0, "Low stress score  → label 0"),
        (8, 8, 2, 1, "Anger (high A, high V, low D): score ≈ 0.57 → label 1 at 0.5 threshold"),
        (8, 2, 8, 0, "Calm: score near 0.2 → label 0"),
    ]
    for v, a, d, expected, note in prob_cases:
        result = deap_emotional_stress_label(v, a, d, use_probabilistic_score=True)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL": all_pass = False
        print(f"  [{status}] V={v} A={a} D={d} → {result}  | {note}")

    # ── DEAP emotional label tests (2-condition: arousal + valence) ──
    print("\n[DEAP] Emotional stress label tests (no dominance):")
    cases_deap = [
        (3, 7, 1, "High arousal + low valence  → STRESS"),
        (8, 7, 0, "High arousal + high valence → Excited"),
        (2, 2, 0, "Low arousal + low valence   → Sad/Bored"),
        (8, 2, 0, "Low arousal + high valence  → Calm"),
        (5, 5, 0, "Both at threshold (not >)  → Not stressed"),
        (4, 6, 1, "Just inside stress quadrant → STRESS"),
    ]
    all_pass = True
    for valence, arousal, expected, note in cases_deap:
        result = deap_emotional_stress_label(valence, arousal)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL": all_pass = False
        print(f"  [{status}] V={valence} A={arousal} → {result}  | {note}")

    # ── DEAP emotional label tests with dominance (3-condition) ──
    print("\n[DEAP] Emotional stress label tests (with dominance):")
    cases_dom = [
        (3, 7, 4, 1, "High arousal + low valence + low dominance   → STRESS"),
        (3, 7, 7, 0, "High arousal + low valence + HIGH dominance  → Excited/Angry, not stress"),
        (3, 7, 5, 0, "Dominance at threshold (not <) → Not stressed"),
        (8, 7, 3, 0, "High arousal + high valence + low dominance  → Excited, not stress"),
    ]
    for valence, arousal, dominance, expected, note in cases_dom:
        result = deap_emotional_stress_label(valence, arousal, dominance=dominance)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL": all_pass = False
        print(f"  [{status}] V={valence} A={arousal} D={dominance} → {result}  | {note}")

    # ── DEAP perceived label tests — uniform weighting ──
    print("\n[DEAP] Perceived stress label tests (uniform, window=5, ratio=0.7):")
    perc_cases = [
        ([0, 0, 0, 0, 0], 0, "All calm  → no perceived stress"),
        ([1, 1, 1, 1, 1], 1, "All stressed → perceived stress"),
        ([0, 1, 1, 1, 1], 1, "4/5 stressed (80%) → perceived stress"),
        ([0, 0, 1, 1, 1], 0, "3/5 stressed (60%) → not yet"),
        ([1, 1],          0, "Only 2 epochs → buffer not full"),
    ]
    for seq, expected, note in perc_cases:
        result = deap_perceived_stress_label(seq, window_size=5, stress_ratio_min=0.7)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL": all_pass = False
        print(f"  [{status}] seq={seq} → {result}  | {note}")

    # ── DEAP perceived label tests — time-weighted ──
    # Scenario: 5 trials all stressed, but trials 0-3 happened long ago (large gap
    # before trial 4). Heavy decay should still flag perceived stress since all=1.
    # Second scenario: 4/5 stressed, but the 4 stressed ones were long before the
    # current trial — with strong decay their effective weight drops below 0.7.
    print("\n[DEAP] Perceived stress label tests (time-weighted, window=5, ratio=0.7):")
    seq_all1    = [1, 1, 1, 1, 1]
    times_even  = [0.0, 1.0, 2.0, 3.0, 4.0]       # equal gaps → same as uniform
    times_burst = [0.0, 0.1, 0.2, 0.3, 100.0]     # long gap before last trial
    # All stressed + even gaps → same as uniform (expect 1)
    r1 = deap_perceived_stress_label(seq_all1, 5, 0.7, start_times=times_even)
    s1 = "PASS" if r1 == 1 else "FAIL"
    if s1 == "FAIL": all_pass = False
    print(f"  [{s1}] all-stressed + even gaps → {r1}  | expect 1")
    # 4 stressed early + 1 non-stressed most recent: long gap means the 4 stressed
    # trials decay heavily; effective weight of recent 0 pulls ratio below threshold
    seq_decay   = [1, 1, 1, 1, 0]
    r2 = deap_perceived_stress_label(seq_decay, 5, 0.7, start_times=times_burst, time_decay_rate=2.0)
    print(f"  [INFO] 4x stressed (distant) + 1 calm (recent) + decay=2 → {r2}  "
          f"(likely 0; recent calm trial dominates)")

    # ── SAM40 emotional label tests ──
    print("\n[SAM40] Emotional stress label tests:")
    cases_sam40 = [
        (8, 'stroop',      1, "High score + stroop task   → STRESS"),
        (8, 'relaxation',  0, "High score + relaxation    → Not stressed"),
        (3, 'arithmetic',  0, "Low score + arithmetic     → Not stressed"),
        (7, 'mirror',      1, "High score + mirror task   → STRESS"),
        (5, 'stroop',      0, "Score at threshold (not >) → Not stressed"),
    ]
    for score, task, expected, note in cases_sam40:
        result = sam40_emotional_stress_label(score, task)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL": all_pass = False
        print(f"  [{status}] score={score} task={task} → {result}  | {note}")

    # ── SAM40 perceived label tests ──
    print("\n[SAM40] Perceived stress label tests:")
    perc_sam40 = [
        (8, 'stroop',      3, 1, "Trial 3, high score, cognitive → PERCEIVED"),
        (8, 'stroop',      1, 0, "Trial 1, high score, too early → Not yet"),
        (8, 'relaxation',  3, 0, "Trial 3, relaxation            → Not stressed"),
        (3, 'arithmetic',  3, 0, "Trial 3, low score             → Not stressed"),
    ]
    for score, task, trial, expected, note in perc_sam40:
        result = sam40_perceived_stress_label(score, task, trial)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL": all_pass = False
        print(f"  [{status}] score={score} task={task} trial={trial} → {result}  | {note}")

    # ── SAM40 per-subject z-score normalization tests ──
    print("\n[SAM40] Per-subject z-score normalization tests:")
    # Two synthetic subjects: same absolute score (6) but very different baselines.
    # Subject A: consistently low rater → 6 is far above their mean → stressed.
    # Subject B: consistently high rater → 6 is below their mean → not stressed.
    rng_t = np.random.default_rng(0)
    fake_eeg_12 = rng_t.standard_normal((12, 32, 64)).astype(np.float32)

    subj_A_scores = (
        [{'task': 'relaxation', 'trial': t, 'score': 0.0} for t in range(1, 4)] +
        [{'task': 'stroop',     'trial': t, 'score': s}   for t, s in zip(range(1, 4), [2, 3, 6])] +
        [{'task': 'arithmetic', 'trial': t, 'score': s}   for t, s in zip(range(1, 4), [2, 3, 2])] +
        [{'task': 'mirror',     'trial': t, 'score': s}   for t, s in zip(range(1, 4), [2, 3, 3])]
    )  # stress scores: [2,3,6, 2,3,2, 2,3,3] — mean≈2.9, score=6 is high

    subj_B_scores = (
        [{'task': 'relaxation', 'trial': t, 'score': 0.0} for t in range(1, 4)] +
        [{'task': 'stroop',     'trial': t, 'score': s}   for t, s in zip(range(1, 4), [8, 9, 6])] +
        [{'task': 'arithmetic', 'trial': t, 'score': s}   for t, s in zip(range(1, 4), [8, 9, 8])] +
        [{'task': 'mirror',     'trial': t, 'score': s}   for t, s in zip(range(1, 4), [8, 9, 9])]
    )  # stress scores: [8,9,6, 8,9,8, 8,9,9] — mean≈8.2, score=6 is LOW for them

    pA = process_sam40_subject(fake_eeg_12, subj_A_scores, use_subject_normalization=True)
    pB = process_sam40_subject(fake_eeg_12, subj_B_scores, use_subject_normalization=True)

    # Find the stroop trial=3 (score=6) in each subject
    stroop3_idx = next(
        i for i, s in enumerate(subj_A_scores)
        if s['task'] == 'stroop' and s['trial'] == 3
    )
    emoA = pA['emotional_labels'][stroop3_idx]
    emoB = pB['emotional_labels'][stroop3_idx]
    okA = emoA == 1  # subject A: 6 >> their mean → stressed
    okB = emoB == 0  # subject B: 6 << their mean → not stressed
    print(f"  [{'PASS' if okA else 'FAIL'}] Subject A (low rater): score=6 → emo={emoA}  "
          f"μ={pA['subj_mu']:.1f} σ={pA['subj_sigma']:.1f}  | expect 1")
    print(f"  [{'PASS' if okB else 'FAIL'}] Subject B (high rater): score=6 → emo={emoB}  "
          f"μ={pB['subj_mu']:.1f} σ={pB['subj_sigma']:.1f}  | expect 0")
    if not okA: all_pass = False
    if not okB: all_pass = False

    # ── SAM40 perceived labels re-enabled: trial progression test ──
    print("\n[SAM40] Re-enabled perceived labels (trial progression):")
    perc_prog = [
        # trial 1 → acute response, not yet sustained
        (stroop3_idx - 2, 0, "stroop trial 1: acute only → perc=0"),
        # trial 2 → sustained begins
        (stroop3_idx - 1, None, "stroop trial 2: depends on score vs threshold"),
        # trial 3 → full sustained (score=6 > subj A mean)
        (stroop3_idx,     1, "stroop trial 3: sustained + high z → perc=1 for subj A"),
    ]
    relaxation_idx = 0  # relaxation always 0
    r_perc = pA['perceived_labels'][relaxation_idx]
    print(f"  [{'PASS' if r_perc == 0 else 'FAIL'}] relaxation trial 1 → perc={r_perc}  | expect 0")
    if r_perc != 0: all_pass = False

    t1_perc = pA['perceived_labels'][stroop3_idx - 2]
    print(f"  [{'PASS' if t1_perc == 0 else 'FAIL'}] stroop trial 1 → perc={t1_perc}  | expect 0 (acute, not sustained)")
    if t1_perc != 0: all_pass = False

    t3_perc = pA['perceived_labels'][stroop3_idx]
    print(f"  [{'PASS' if t3_perc == 1 else 'FAIL'}] stroop trial 3 (subj A) → perc={t3_perc}  | expect 1 (sustained + stressed)")
    if t3_perc != 1: all_pass = False

    sentinel_count = int((pA['perceived_labels'] == -1).sum())
    print(f"  [{'PASS' if sentinel_count == 0 else 'FAIL'}] no -1 sentinels when enable_sam40_perceived=True  "
          f"(found {sentinel_count})")
    if sentinel_count != 0: all_pass = False

    # ── Epoch-level rolling assigner test ──
    print("\n[Epoch Assigner] Rolling window test:")
    assigner = EpochLabelAssigner(window_size=5, stress_ratio_min=0.7)
    sequence = [1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1]
    print("  epoch | emo | perc | note")
    print("  ------|-----|------|------------------------------")
    for ep_i, emo in enumerate(sequence):
        emo_out, perc_out, pre_out = assigner.assign(emo)
        note = ""
        if ep_i < 4:
            note = "buffer filling"
        elif perc_out == 1:
            note = "perceived stress triggered"
        else:
            note = "below threshold"
        print(f"    {ep_i+1:3d}  |  {emo_out}  |  {perc_out}   | {note}")

    # ── Synthetic dataset build test ──
    print("\n[Pipeline] Synthetic dataset build test:")
    rng = np.random.default_rng(42)

    # Fake DEAP subject: 40 trials, 40 channels, 256 samples at 128 Hz.
    # _align_eeg resamples 128→256 Hz → 512 samples, matching fake_sam40 below.
    fake_deap = {
        'data'  : rng.standard_normal((40, 40, 256)).astype(np.float32),
        'labels': rng.uniform(1, 9, (40, 4)).astype(np.float32),
    }

    # Fake SAM40 subject: 12 trials, 32 channels, 512 samples at 256 Hz.
    # 512 < EEG_TARGET_SAMPLES so no truncation; matches resampled DEAP output.
    tasks_seq = (
        [{'task': 'relaxation', 'trial': t, 'score': rng.uniform(1, 4)} for t in range(1, 4)] +
        [{'task': 'stroop',     'trial': t, 'score': rng.uniform(5, 10)} for t in range(1, 4)] +
        [{'task': 'arithmetic', 'trial': t, 'score': rng.uniform(4, 9)}  for t in range(1, 4)] +
        [{'task': 'mirror',     'trial': t, 'score': rng.uniform(3, 8)}  for t in range(1, 4)]
    )
    fake_sam40 = {
        'eeg'    : rng.standard_normal((12, 32, 512)).astype(np.float32),
        'scores' : tasks_seq,
    }

    dataset, stats = build_unified_dataset(
        deap_subjects     = [fake_deap],
        sam40_subjects    = [fake_sam40],
        deap_ratings_path = None,   # synthetic test — no XLS available
    )

    print("\n  Final dataset shapes:")
    for key, val in dataset.items():
        if isinstance(val, np.ndarray):
            print(f"    {key:12s} : {val.shape}  dtype={val.dtype}")

    overall = "ALL TESTS PASSED" if all_pass else "SOME TESTS FAILED"
    print(f"\n{'='*55}")
    print(f"  {overall}")
    print(f"{'='*55}\n")