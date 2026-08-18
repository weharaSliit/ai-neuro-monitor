#!/usr/bin/env python3
"""
Build a windowed, labeled T7/T8 feature table from SAM40.

Usage:
    python3 scripts/build_dataset.py [--channels T7 T8] [--window-sec 4.0] [--overlap 0.5]
    python3 scripts/build_dataset.py --channels T7 T8 --derived   # + baseline-relative & slope features
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from sam40.derived_features import add_baseline_relative, add_short_term_slopes  # noqa: E402
from sam40.pipeline import build_feature_dataset  # noqa: E402

# The subset of base features to derive baseline-relative/slope versions from --
# every band's relative power, the two cross-band ratios, sample entropy, and
# Hjorth complexity, per channel. Not applied to every single base feature
# (e.g. raw/log power, coherence, PLV/PLI) to avoid uncontrolled feature-count
# blowup on a 40-subject dataset.
DERIVED_FEATURE_SUFFIXES = [
    'delta_rel_power', 'theta_rel_power', 'alpha_rel_power', 'beta_rel_power', 'gamma_rel_power',
    'theta_alpha_ratio', 'beta_alpha_ratio', 'sample_entropy', 'hjorth_complexity',
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--channels', nargs='+', default=['T7', 'T8'])
    parser.add_argument('--source', choices=['raw', 'filtered'], default='filtered')
    parser.add_argument('--window-sec', type=float, default=4.0)
    parser.add_argument('--overlap', type=float, default=0.5)
    parser.add_argument('--rating-threshold', type=float, default=5.0)
    parser.add_argument('--derived', action='store_true',
                         help='Add baseline-relative and short-term-slope derived features '
                              '(on top of the base per-window features)')
    parser.add_argument('--bipolar', action='store_true',
                         help='Also extract the full feature set from the bipolar differential '
                              '(channel_a - channel_b) signal -- reference-agnostic, see features.py')
    parser.add_argument('--slope-k', type=int, default=3)
    parser.add_argument('--out', default=None,
                         help='Output CSV path (default: results/features_<channels>_<window>s.csv)')
    args = parser.parse_args()

    data_dir = ROOT / 'data' / 'SAM40' / ('raw_data' if args.source == 'raw' else 'filtered_data')
    scales_path = ROOT / 'data' / 'SAM40' / 'scales.xls'

    out = args.out
    if out is None:
        chan_tag = '-'.join(args.channels)
        suffix = ('_rich' if args.derived else '') + ('_bipolar' if args.bipolar else '')
        out = ROOT / 'results' / f'features_{chan_tag}_{args.window_sec}s{suffix}.csv'
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f'Loading trials from {data_dir} (source={args.source})')
    print(f'Channels: {args.channels}, window={args.window_sec}s, overlap={args.overlap}, '
          f'bipolar={args.bipolar}')

    df = build_feature_dataset(
        data_dir=data_dir,
        scales_path=scales_path,
        source=args.source,
        channels=args.channels,
        window_sec=args.window_sec,
        overlap=args.overlap,
        rating_threshold=args.rating_threshold,
        include_bipolar=args.bipolar,
    )

    if args.derived:
        deriv_cols = [f'{ch}_{suf}' for ch in args.channels for suf in DERIVED_FEATURE_SUFFIXES
                      if f'{ch}_{suf}' in df.columns]
        print(f'Adding baseline-relative + slope-{args.slope_k} features for {len(deriv_cols)} base columns...')
        df = add_baseline_relative(df, deriv_cols)
        df = add_short_term_slopes(df, deriv_cols, k=args.slope_k)

    df.to_csv(out, index=False)
    print(f'Wrote {len(df)} rows x {len(df.columns)} cols -> {out}')
    print(f'Subjects: {df.subject.nunique()}, tasks: {sorted(df.task.unique())}')
    print(f'label_task distribution:\n{df.label_task.value_counts()}')


if __name__ == '__main__':
    main()
