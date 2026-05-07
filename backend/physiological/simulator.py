# ============================================================
# simulator.py
# Streams WESAD subject data for simulation mode
# Loads real physiological data and extracts features
# ============================================================

import numpy as np
import pandas as pd
import os
import pickle
import time
from scipy.stats import skew, kurtosis
import pywt
from backend.common.config import (
    WESAD_PATH, WESAD_SUBJECTS,
    RESULTS_PATH, WINDOW_STEP_SEC
)

#  Load precomputed features for simulation 
def load_subject_features(subject_id):
    """
    Load precomputed features for a WESAD subject.
    Uses the wesad_features_selected.csv file.
    Returns features and labels for that subject.
    """
    csv_path = os.path.join(
        RESULTS_PATH, "objective1",
        "wesad_features_selected.csv"
    )

    df = pd.read_csv(csv_path)
    subject_df = df[df['subject_id'] == subject_id].copy()

    if len(subject_df) == 0:
        return None, None

    feature_cols = [
        c for c in subject_df.columns
        if c not in ['label', 'subject_id']
    ]

    X = subject_df[feature_cols].values
    y = subject_df['label'].values

    return X, y


def get_subject_windows(subject_id):
    """
    Get all windows for a subject with metadata.
    Returns list of window dicts for streaming.
    """
    X, y = load_subject_features(subject_id)

    if X is None:
        return []

    windows = []
    for i in range(len(X)):
        windows.append({
            'window_idx': i,
            'features':   X[i],
            'true_label': int(y[i]),
            'subject_id': subject_id
        })

    return windows


def get_simulation_subjects():
    """Return list of available simulation subjects."""
    return WESAD_SUBJECTS


def get_subject_summary(subject_id):
    """Get window count per class for a subject."""
    X, y = load_subject_features(subject_id)

    if X is None:
        return None

    return {
        'subject_id':    subject_id,
        'total_windows': len(y),
        'normal':        int((y == 0).sum()),
        'prestress':     int((y == 1).sum()),
        'stress':        int((y == 2).sum())
    }


def find_stress_transition_subject():
    """
    Find best subject for demo — one that shows
    clear Normal → Pre-stress → Stress transition.
    Returns subject_id with most pre-stress windows.
    """
    best_sid   = 2
    best_count = 0

    for sid in WESAD_SUBJECTS:
        X, y = load_subject_features(sid)
        if y is None:
            continue
        ps_count = (y == 1).sum()
        if ps_count > best_count:
            best_count = ps_count
            best_sid   = sid

    return best_sid