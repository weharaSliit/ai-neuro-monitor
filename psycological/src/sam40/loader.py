"""Discover and load SAM40 trial recordings from the raw/filtered .mat files."""

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import scipy.io as sio

from .channels import TRIAL_SAMPLES

FILENAME_RE = re.compile(r'^(?P<task>.+)_sub_(?P<subject>\d+)_trial(?P<trial>\d+)\.mat$')

# 'Data' for raw_data/*.mat, 'Clean_data' for filtered_data/*.mat
MAT_KEY_BY_SOURCE = {
    'raw': 'Data',
    'filtered': 'Clean_data',
}


@dataclass(frozen=True)
class TrialInfo:
    path: Path
    subject: int
    task: str
    trial: int


def discover_trials(data_dir: Path) -> list[TrialInfo]:
    """List every trial recording found under data_dir (raw_data or filtered_data)."""
    trials = []
    for path in sorted(data_dir.glob('*.mat')):
        m = FILENAME_RE.match(path.name)
        if not m:
            continue
        trials.append(TrialInfo(
            path=path,
            subject=int(m.group('subject')),
            task=m.group('task'),
            trial=int(m.group('trial')),
        ))
    return trials


def load_trial_data(trial: TrialInfo, source: str = 'filtered') -> np.ndarray:
    """Load one trial as a (32, 3200) float64 array, channels in Coordinates.locs order."""
    mat = sio.loadmat(trial.path, squeeze_me=True)
    key = MAT_KEY_BY_SOURCE[source]
    data = mat[key]
    if data.shape != (32, TRIAL_SAMPLES):
        raise ValueError(f'{trial.path}: expected (32, {TRIAL_SAMPLES}), got {data.shape}')
    return data
