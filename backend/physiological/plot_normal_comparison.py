# ============================================================
# plot_normal_comparison.py -- compares THIS user's own resting/normal
# baseline (already computed during Ring calibration, no new recording
# needed) against published normal physiological ranges.
#
# Data source: baselines/{user_id} in Firebase -- the per-feature mean
# from calibration_capture.py's resting-state capture (see
# firebase_service.py::load_baseline()). This is your ring's own
# "normal value" already on file.
#
# REFERENCE_RANGES below are pre-filled ONLY for resting heart rate,
# since that's essentially universal, uncontroversial medical knowledge
# (60-100 bpm; American Heart Association, and cited identically in
# essentially every HRV textbook/paper). AVNN's range is the direct
# mathematical consequence of that HR range (AVNN_ms = 60000 / HR), not
# a separate citation.
#
# The SD1 (short-term HRV) and SCL_mean (skin conductance level) ranges
# are left as None/placeholders on purpose -- normative values for these
# genuinely vary between studies/populations/recording conditions, and
# stating a precise number here without a specific citation you've
# actually checked would be worse than leaving it blank. Search
# ScienceDirect / Google Scholar for a specific paper reporting these
# (e.g. Shaffer & Ginsberg's HRV norms review is a commonly cited
# starting point for the HRV side; Boucsein's "Electrodermal Activity"
# textbook, or a paper citing it, for the EDA side), then fill in
# REFERENCE_RANGES below with the exact numbers and citation you're
# using -- the plot will pick them up automatically.
#
# Usage (run from the repo root):
#   python -m backend.physiological.plot_normal_comparison --user-id alice
# ============================================================

import argparse
import sys
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

# {feature: (low, high, unit, "Source citation")} -- None means "fill this
# in yourself once you've picked and checked a specific source."
REFERENCE_RANGES = {
    'MeanHR': (60.0, 100.0, 'bpm', 'American Heart Association / standard adult resting HR'),
    'AVNN':   (600.0, 1000.0, 'ms', 'Derived from 60-100 bpm (AVNN = 60000 / HR)'),
    'SD1':    None,   # e.g. (LOW, HIGH, 'ms', 'Shaffer & Ginsberg 2017, Frontiers in Public Health')
    'SCL_mean': None,  # e.g. (LOW, HIGH, 'uS', 'Boucsein 2012, Electrodermal Activity')
}


def plot_comparison(user_id: str, out_path: str) -> None:
    import matplotlib.pyplot as plt

    from backend.physiological.extract_features import FEATURE_COLS
    from backend.physiological.firebase_service import init_firebase, load_baseline

    init_firebase()
    baseline_mean, _ = load_baseline(user_id, FEATURE_COLS)
    if baseline_mean is None:
        raise SystemExit(f'No baseline on file for {user_id} -- calibrate first.')

    your_values = dict(zip(FEATURE_COLS, baseline_mean))

    features = [f for f in REFERENCE_RANGES if f in your_values]
    fig, axes = plt.subplots(1, len(features), figsize=(3.2 * len(features), 4.5))
    if len(features) == 1:
        axes = [axes]
    fig.suptitle(f'{user_id} — resting baseline vs. published normal range', fontweight='bold')

    for ax, feat in zip(axes, features):
        your_val = your_values[feat]
        ref = REFERENCE_RANGES[feat]

        if ref is not None:
            low, high, unit, source = ref
            ax.axhspan(low, high, color='#22c55e', alpha=0.18, label='Published normal range')
            in_range = low <= your_val <= high
            bar_color = '#22c55e' if in_range else '#ef4444'
            ax.set_title(f'{feat}\n({source})', fontsize=8)
        else:
            unit = ''
            bar_color = '#3b82f6'
            ax.set_title(f'{feat}\n(fill in REFERENCE_RANGES for this one)', fontsize=8)

        ax.bar(['Your Ring'], [your_val], color=bar_color, width=0.5)
        ax.set_ylabel(unit)
        ax.text(0, your_val, f'{your_val:.1f}', ha='center', va='bottom', fontweight='bold', fontsize=9)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')
    for feat in features:
        if REFERENCE_RANGES[feat] is None:
            print(f'  NOTE: {feat} has no reference range set yet -- edit REFERENCE_RANGES in this file.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user-id', required=True)
    parser.add_argument('--out', default=None)
    args = parser.parse_args()
    out = args.out or f'{args.user_id}_normal_comparison.png'
    plot_comparison(args.user_id, out)


if __name__ == '__main__':
    main()
