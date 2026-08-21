"""
SAM40 self-reported stress ratings (data/SAM40/scales.xls).

The sheet has a two-row header: Trial_{1,2,3} blocks, each split into
Maths / Symmetry / Stroop columns, one row per subject (1..40). There is
no rating for the Relax condition (it isn't a stress-inducing task).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

# Maps SAM40 task name (as used in raw_data/filtered_data filenames) to the
# corresponding scales.xls sub-column name. Relax has no rating column.
TASK_TO_SCALE_COLUMN = {
    'Arithmetic': 'Maths',
    'Mirror_image': 'Symmetry',
    'Stroop': 'Stroop',
}

STRESS_TASKS = tuple(TASK_TO_SCALE_COLUMN.keys())
ALL_TASKS = ('Relax',) + STRESS_TASKS


def load_ratings(scales_path: Path) -> pd.DataFrame:
    """Return a tidy DataFrame: subject, task, trial, rating (1-10 scale)."""
    raw = pd.read_excel(scales_path, sheet_name='scales', header=[0, 1])
    subject_col = raw.columns[0]
    raw[subject_col] = raw[subject_col].ffill()
    raw = raw.dropna(subset=[subject_col])

    rows = []
    for _, row in raw.iterrows():
        subject = int(row[subject_col])
        for trial in (1, 2, 3):
            trial_col = f'Trial_{trial}'
            for task, scale_col in TASK_TO_SCALE_COLUMN.items():
                rating = row[(trial_col, scale_col)]
                rows.append({
                    'subject': subject,
                    'task': task,
                    'trial': trial,
                    'rating': float(rating),
                })
    return pd.DataFrame(rows)


def binary_label_from_task(task: str) -> int:
    """Coarse label: Relax = 0 (calm), any stress-inducing task = 1."""
    return 0 if task == 'Relax' else 1


def binary_label_from_rating(rating: float, threshold: float = 5.0) -> int:
    """Label from the subject's own self-reported stress rating for that trial (1-10 scale)."""
    return int(rating > threshold)
