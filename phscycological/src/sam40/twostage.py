"""Two-stage state + trend model, built on top of the calibrated state model.

    s_t = calibrated task-state probability for window t (from calibration.py)
    d_t = s_t - s_{t-k}   (trend: rising/recovering direction)

States: baseline_like, rising, elevated, recovering, uncertain. A raw
per-window state is never trusted alone -- it must persist across several
consecutive VALID (quality-gated) windows before being "committed"; single
noisy windows fall back to the previously committed state (or 'uncertain'
if none yet).

IMPORTANT LIMITATION (SAM40-specific): trend/persistence/alerts only make
sense within one continuous recording. SAM40's trials are isolated 25s
segments (~11-12 windows each at 4s/50% overlap) with no continuity across
trials, tasks, or subjects -- so every function here operates within
(subject, task, trial) groups only, never across them. This is a real
limitation for evaluating sustained multi-minute alert behavior; treat
results as a proof-of-mechanism, not a validated long-duration alert system.
"""

import numpy as np
import pandas as pd

STATES = ['baseline_like', 'rising', 'elevated', 'recovering', 'uncertain']
GROUP_COLS = ['subject', 'task', 'trial']


def add_trend(df: pd.DataFrame, score_col: str, k: int = 2, window_order_col: str = 'window') -> pd.DataFrame:
    """d_t = s_t - s_{t-k} within each (subject, task, trial), sorted by window."""
    df = df.sort_values(GROUP_COLS + [window_order_col]).reset_index(drop=True)
    df['trend'] = df.groupby(GROUP_COLS)[score_col].diff(k)
    return df


def _classify_row(s, d, q, quality_min, baseline_thresh, elevated_thresh, rising_thresh):
    if pd.isna(d) or q < quality_min:
        return 'uncertain'
    if s < baseline_thresh:
        return 'baseline_like'
    if d > rising_thresh:
        return 'rising'
    if d < -rising_thresh:
        return 'recovering'
    if s >= elevated_thresh:
        return 'elevated'
    return 'uncertain'


def raw_states(df: pd.DataFrame, score_col: str = 'calibrated_score', quality_col: str = 'quality',
                quality_min: float = 0.5, baseline_thresh: float = 0.6, elevated_thresh: float = 0.8,
                rising_thresh: float = 0.05) -> pd.Series:
    return df.apply(lambda r: _classify_row(r[score_col], r['trend'], r[quality_col],
                                             quality_min, baseline_thresh, elevated_thresh, rising_thresh),
                     axis=1)


def apply_persistence(df: pd.DataFrame, raw_state_col: str = 'raw_state', min_persistence: int = 2) -> pd.Series:
    """Commit a state only once it repeats >= min_persistence consecutive times within a trial;
    otherwise hold the previous committed state ('uncertain' before any state has persisted)."""
    df = df.sort_values(GROUP_COLS + ['window'])
    committed = np.empty(len(df), dtype=object)

    for _, idx in df.groupby(GROUP_COLS).groups.items():
        idx = list(idx)
        run_state, run_len, current = None, 0, 'uncertain'
        for pos, i in enumerate(idx):
            s = df.loc[i, raw_state_col]
            if s == run_state:
                run_len += 1
            else:
                run_state, run_len = s, 1
            if run_len >= min_persistence:
                current = run_state
            committed[df.index.get_loc(i)] = current
    return pd.Series(committed, index=df.index)


def alert_policy(df: pd.DataFrame, score_col: str = 'calibrated_score', quality_col: str = 'quality',
                  on_threshold: float = 0.75, off_threshold: float = 0.65, quality_min: float = 0.5,
                  min_on_duration: int = 2) -> pd.Series:
    """Hysteresis alert: p > on_threshold for >= min_on_duration windows -> ON,
    stays ON until p < off_threshold (off_threshold < on_threshold prevents oscillation)."""
    df = df.sort_values(GROUP_COLS + ['window'])
    alerts = np.zeros(len(df), dtype=bool)

    for _, idx in df.groupby(GROUP_COLS).groups.items():
        idx = list(idx)
        active, above_run = False, 0
        for i in idx:
            p, q = df.loc[i, score_col], df.loc[i, quality_col]
            ok = q >= quality_min
            if not active:
                if ok and p > on_threshold:
                    above_run += 1
                    if above_run >= min_on_duration:
                        active = True
                else:
                    above_run = 0
            else:
                if (not ok) or p < off_threshold:
                    active = False
                    above_run = 0
            alerts[df.index.get_loc(i)] = active
    return pd.Series(alerts, index=df.index)
