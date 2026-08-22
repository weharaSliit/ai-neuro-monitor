"""Stress-trend analysis from out-of-fold window-level stress scores.

Three levels, per the SAM40 trend questions:
  a) within-trial trend  -- does the score rise over the 25s of one trial?
  b) task-level trend     -- does the score rise from Relax -> SCWT/Arithmetic/Mirror?
  c) trial-level trend    -- does the score change across repeated trials 1->2->3
                              of the same task (habituation vs sensitization)?
"""

import numpy as np
import pandas as pd

from .labels import ALL_TASKS


def within_trial_trend(scored: pd.DataFrame, subject: int, task: str, trial: int) -> pd.DataFrame:
    """Stress score over time for one specific trial recording."""
    sel = scored[
        (scored.subject == subject) & (scored.task == task) & (scored.trial == trial)
    ].sort_values('window_start_sec')
    return sel[['window_start_sec', 'task_state_score']].reset_index(drop=True)


def task_level_trend(scored: pd.DataFrame) -> pd.DataFrame:
    """Mean (+ SEM) stress score per task, ordered Relax -> stress tasks."""
    grouped = scored.groupby('task')['task_state_score'].agg(['mean', 'sem', 'count']).reset_index()
    order = {t: i for i, t in enumerate(ALL_TASKS)}
    grouped['order'] = grouped.task.map(order)
    return grouped.sort_values('order').drop(columns='order').reset_index(drop=True)


def trial_level_trend(scored: pd.DataFrame) -> pd.DataFrame:
    """Mean stress score per (task, trial) -- habituation/sensitization across repeats."""
    grouped = scored.groupby(['task', 'trial'])['task_state_score'].agg(['mean', 'sem', 'count'])
    return grouped.reset_index()


def smooth(series: pd.Series, window: int = 3) -> pd.Series:
    return series.rolling(window=window, min_periods=1, center=True).mean()


def rating_correlation(scored: pd.DataFrame) -> float:
    """Pearson correlation between window-mean task_state_score and self-reported rating,
    aggregated to one point per (subject, task, trial)."""
    per_trial = scored.groupby(['subject', 'task', 'trial']).agg(
        task_state_score=('task_state_score', 'mean'),
        rating=('rating', 'first'),
    ).dropna()
    return float(np.corrcoef(per_trial.task_state_score, per_trial.rating)[0, 1])
