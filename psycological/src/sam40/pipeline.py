"""End-to-end: raw/filtered SAM40 trials -> windowed, labeled feature table."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .channels import CHANNEL_NAMES, SFREQ
from .features import epoch_features
from .labels import binary_label_from_rating, binary_label_from_task, load_ratings
from .loader import discover_trials, load_trial_data
from .preprocess import epoch, preprocess_trial


def build_feature_dataset(
    data_dir: Path,
    scales_path: Path,
    source: str = 'filtered',
    channels: list[str] | None = None,
    window_sec: float = 4.0,
    overlap: float = 0.5,
    rating_threshold: float = 5.0,
    include_bipolar: bool = False,
) -> pd.DataFrame:
    """Build one row per (subject, task, trial, window) with features + labels.

    channels: which channels to KEEP for feature extraction (e.g. ['T7', 'T8']).
    Preprocessing (filter + common-average reference) always uses the full
    32-channel montage first, since re-referencing needs the whole head.
    """
    channels = channels or ['T7', 'T8']
    chan_idx = [CHANNEL_NAMES.index(c) for c in channels]

    ratings = load_ratings(scales_path)
    trials = discover_trials(data_dir)

    rows = []
    for trial in trials:
        raw = load_trial_data(trial, source=source)
        clean = preprocess_trial(raw)
        selected = clean[chan_idx, :]

        windows = epoch(selected, window_sec=window_sec, overlap=overlap, fs=SFREQ)

        rating_row = ratings[
            (ratings.subject == trial.subject)
            & (ratings.task == trial.task)
            & (ratings.trial == trial.trial)
        ]
        rating = float(rating_row.rating.iloc[0]) if len(rating_row) else float('nan')

        for w_idx, w in enumerate(windows):
            feats = epoch_features(w, channel_names=channels, fs=SFREQ, include_bipolar=include_bipolar)
            feats.update({
                'subject': trial.subject,
                'task': trial.task,
                'trial': trial.trial,
                'window': w_idx,
                'window_start_sec': w_idx * window_sec * (1 - overlap),
                'rating': rating,
                'label_task': binary_label_from_task(trial.task),
                'label_rating': (
                    binary_label_from_rating(rating, threshold=rating_threshold)
                    if rating == rating else None  # NaN for Relax trials
                ),
            })
            rows.append(feats)

    return pd.DataFrame(rows)
