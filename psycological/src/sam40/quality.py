"""Heuristic per-window signal-quality score, Q_t in [0, 1].

SAM40 has no ground-truth artifact/contact-quality annotations, so this is
an UNVALIDATED PROXY built from already-computed features (no raw signal
reload needed): flatline (near-zero variance), extreme amplitude (motion/
clipping proxy), and gamma-band dominance (muscle/EMG contamination proxy).
Thresholds are percentile-based on this dataset's own distribution, not
calibrated against any external quality standard -- treat Q_t as a relative
"how typical is this window" signal, not a validated absolute measure.
"""

import numpy as np
import pandas as pd


def compute_quality_score(df: pd.DataFrame, channels: list[str],
                           flat_pct: float = 0.01, amp_pct: float = 0.99,
                           gamma_dominance_threshold: float = 0.5) -> pd.Series:
    """Q_t per row, in [0, 1]. Each violated criterion (per channel) halves the score."""
    q = pd.Series(1.0, index=df.index)
    for ch in channels:
        activity = df[f'{ch}_hjorth_activity']  # = signal variance
        ptp = df[f'{ch}_ptp']
        gamma_rel = df[f'{ch}_gamma_rel_power']

        flat_penalty = (activity < activity.quantile(flat_pct)).astype(float)
        high_amp_penalty = (ptp > ptp.quantile(amp_pct)).astype(float)
        muscle_penalty = (gamma_rel > gamma_dominance_threshold).astype(float)

        ch_penalty = np.clip(flat_penalty + high_amp_penalty + muscle_penalty, 0, 1)
        q = q * (1 - 0.5 * ch_penalty)
    return q.clip(0, 1)
