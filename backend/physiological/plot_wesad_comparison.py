# ============================================================
# plot_wesad_comparison.py -- compares a live Ring session against the
# ACTUAL WESAD training data (physiological_signals/results/objective1/
# wesad_features_selected.csv -- the real CSV 05_model_training.ipynb
# trains on), not a textbook estimate. WESAD's features here come from
# the CHEST RespiBAN device (ECG-derived HRV, chest EDA -- see
# 03_preprocessing_pipeline.ipynb), NOT the wrist Empatica E4 -- keep
# that in mind when writing this up: this shows whether your ring's
# live readings fall inside the same range your MODEL was trained on,
# which is a different (and for your classifier, more directly
# relevant) claim than "matches wrist-PPG reference data."
#
# Two modes:
#   --mode overlap    (default) Live session plotted as a line over
#                      time, with WESAD's Normal/Stress condition
#                      ranges (mean +/- 1 std, computed from the real
#                      training data) as shaded bands behind it.
#   --mode separate    WESAD's Normal-vs-Stress boxplot next to the
#                      live session's trend line, side by side, same
#                      y-axis scale.
#
# Usage (run from the repo root):
#   python -m backend.physiological.plot_wesad_comparison --user-id alice --session-id session_...
#   python -m backend.physiological.plot_wesad_comparison --user-id alice --session-id session_... --mode separate
# ============================================================

import argparse
import sys
from datetime import datetime
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

WESAD_CSV = (Path(__file__).resolve().parents[2]
             / 'physiological_signals' / 'results' / 'objective1' / 'wesad_features_selected.csv')

# Feature -> (display label, unit) for the three panels shown.
COMPARE_FEATURES = {
    'MeanHR':   ('Mean Heart Rate', 'bpm'),
    'SD1':      ('Short-term HRV (SD1)', 'ms'),
    'SCL_mean': ('Skin Conductance Level', 'uS'),
}


def _load_live_session(user_id, session_id):
    from backend.physiological.firebase_service import get_session_predictions, init_firebase

    init_firebase()
    preds = get_session_predictions(user_id, session_id)
    rows = sorted(preds.values(), key=lambda p: p.get('window_idx', 0))
    if not rows:
        raise SystemExit(f'No predictions found for {user_id}/{session_id}')

    t0 = None
    out = {'ts': [], **{f: [] for f in COMPARE_FEATURES}}
    for r in rows:
        try:
            sec = datetime.fromisoformat(r['timestamp']).timestamp()
        except Exception:
            continue
        if t0 is None:
            t0 = sec
        out['ts'].append(sec - t0)
        feat = r.get('features', {})
        for f in COMPARE_FEATURES:
            out[f].append(feat.get(f))
    return out


def _load_wesad_stats():
    import pandas as pd

    if not WESAD_CSV.exists():
        raise SystemExit(f'WESAD features CSV not found at {WESAD_CSV} -- run the physiological_signals '
                          f'preprocessing notebooks first (03_preprocessing_pipeline.ipynb onward).')
    df = pd.read_csv(WESAD_CSV)
    stats = {}
    for f in COMPARE_FEATURES:
        if f not in df.columns:
            continue
        normal = df.loc[df['label'] == 0, f].dropna()
        stress = df.loc[df['label'] == 1, f].dropna()
        stats[f] = {
            'normal': normal, 'stress': stress,
            'normal_mean': normal.mean(), 'normal_std': normal.std(),
            'stress_mean': stress.mean(), 'stress_std': stress.std(),
        }
    return stats


def plot_overlap(user_id, session_id, out_path):
    import matplotlib.pyplot as plt

    live = _load_live_session(user_id, session_id)
    wesad = _load_wesad_stats()
    features = [f for f in COMPARE_FEATURES if f in wesad]

    fig, axes = plt.subplots(len(features), 1, figsize=(9, 3 * len(features)), sharex=False)
    if len(features) == 1:
        axes = [axes]
    fig.suptitle(f'{user_id} / {session_id}  vs. WESAD training data (chest RespiBAN)', fontweight='bold', fontsize=11)

    for ax, feat in zip(axes, features):
        label, unit = COMPARE_FEATURES[feat]
        s = wesad[feat]
        ax.axhspan(s['normal_mean'] - s['normal_std'], s['normal_mean'] + s['normal_std'],
                   color='#22c55e', alpha=0.18, label=f'WESAD Normal (mean±std, n={len(s["normal"])})')
        ax.axhspan(s['stress_mean'] - s['stress_std'], s['stress_mean'] + s['stress_std'],
                   color='#ef4444', alpha=0.15, label=f'WESAD Stress (mean±std, n={len(s["stress"])})')
        ax.plot(live['ts'], live[feat], color='#1e293b', marker='o', markersize=3,
                linewidth=1.4, zorder=3, label='Your live session')
        ax.set_title(f'{label} ({feat})', fontsize=10)
        ax.set_ylabel(unit)
        ax.legend(fontsize=7, loc='upper right')
    axes[-1].set_xlabel('Seconds into session')

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')


def plot_separate(user_id, session_id, out_path):
    import matplotlib.pyplot as plt

    live = _load_live_session(user_id, session_id)
    wesad = _load_wesad_stats()
    features = [f for f in COMPARE_FEATURES if f in wesad]

    fig, axes = plt.subplots(len(features), 2, figsize=(9, 3 * len(features)))
    if len(features) == 1:
        axes = [axes]
    fig.suptitle(f'{user_id} / {session_id}  vs. WESAD training data (chest RespiBAN)', fontweight='bold', fontsize=11)

    for row, feat in zip(axes, features):
        label, unit = COMPARE_FEATURES[feat]
        s = wesad[feat]
        left, right = row

        left.boxplot([s['normal'], s['stress']], tick_labels=['WESAD\nNormal', 'WESAD\nStress'])
        left.set_title(f'{label} — WESAD distribution', fontsize=9)
        left.set_ylabel(unit)

        right.plot(live['ts'], live[feat], color='#1e293b', marker='o', markersize=3, linewidth=1.4)
        right.set_title(f'{label} — your live session', fontsize=9)
        right.set_xlabel('Seconds')
        right.set_ylim(left.get_ylim())  # same scale as the WESAD boxplot for a fair visual comparison

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user-id', required=True)
    parser.add_argument('--session-id', required=True)
    parser.add_argument('--mode', choices=['overlap', 'separate'], default='overlap')
    parser.add_argument('--out', default=None)
    args = parser.parse_args()
    # Timestamped by default (only when --out isn't given explicitly) --
    # same reasoning as plot_raw_session.py: re-running later shouldn't
    # silently overwrite an earlier snapshot of the same user/session.
    run_stamp = datetime.now().strftime('%Y%m%dT%H%M%S')
    out = args.out or f'{args.user_id}_{args.session_id}_wesad_{args.mode}_{run_stamp}.png'
    if args.mode == 'overlap':
        plot_overlap(args.user_id, args.session_id, out)
    else:
        plot_separate(args.user_id, args.session_id, out)


if __name__ == '__main__':
    main()
