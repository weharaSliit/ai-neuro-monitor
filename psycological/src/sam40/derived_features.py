"""Cross-window derived features: baseline-relative normalization and
short-term slopes. Unlike everything in features.py, these need context
beyond a single window's raw signal -- a per-subject Relax reference and
neighboring windows within the same trial -- so they're computed as a
post-processing pass over the already-built feature table.
"""

import numpy as np
import pandas as pd


def add_baseline_relative(df: pd.DataFrame, feature_cols: list[str]) -> pd.DataFrame:
    """For each subject, subtract that subject's own mean Relax-condition value.

    Individual differences in absolute EEG feature levels are large; a
    Relax-referenced value ("how far from THIS person's own calm baseline")
    is more comparable across subjects than the raw feature. Relax windows
    themselves get values near zero, by construction.
    """
    df = df.copy()
    baseline = df[df.task == 'Relax'].groupby('subject')[feature_cols].mean()
    baseline_aligned = baseline.reindex(df.subject).reset_index(drop=True)
    for col in feature_cols:
        df[f'{col}_blrel'] = df[col].to_numpy() - baseline_aligned[col].to_numpy()
    return df


def add_baseline_zscore(df: pd.DataFrame, feature_cols: list[str], min_std: float = 1e-6) -> pd.DataFrame:
    """Z = (X - mean_rest) / std_rest, per subject -- not just mean-centering
    (add_baseline_relative above), also scales by the subject's own resting
    variability. Intended to help cancel reference-scheme differences (e.g.
    CAR during SAM40 training vs. single-ended on 2-electrode hardware): a
    DC/scale shift from a different reference gets normalized out the same
    way individual anatomical differences do.

    CAVEAT: SAM40 has only 3 Relax trials per subject -- std_rest here is
    estimated from as few as 3 samples at 25s-block granularity (more at
    4s-window granularity, where each Relax trial contributes ~11 windows).
    A 3-sample std is unstable; treat 25s-block z-scores with that in mind,
    or z-score using the window-level (not block-level) feature table's
    Relax windows even when the model itself trains on 25s blocks.
    """
    df = df.copy()
    relax = df[df.task == 'Relax'].groupby('subject')[feature_cols]
    mean_aligned = relax.mean().reindex(df.subject).reset_index(drop=True)
    std_aligned = relax.std().reindex(df.subject).reset_index(drop=True).clip(lower=min_std)
    for col in feature_cols:
        df[f'{col}_zscore'] = (df[col].to_numpy() - mean_aligned[col].to_numpy()) / std_aligned[col].to_numpy()
    return df


def add_short_term_slopes(df: pd.DataFrame, feature_cols: list[str], k: int = 3) -> pd.DataFrame:
    """Slope of each feature over the last k windows within the same (subject, task, trial).

    (value[i] - value[i-k]) / k, computed after sorting by window index within
    each trial. The first k windows of each trial have no history yet -- filled
    with 0 ("no detected change") rather than left as NaN, since most model
    families here (everything except hist_gb) can't train on NaN features.
    """
    df = df.sort_values(['subject', 'task', 'trial', 'window']).reset_index(drop=True)
    grouped = df.groupby(['subject', 'task', 'trial'], sort=False)
    for col in feature_cols:
        shifted = grouped[col].shift(k)
        df[f'{col}_slope{k}'] = ((df[col] - shifted) / k).fillna(0.0)
    return df
