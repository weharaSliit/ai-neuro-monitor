# ============================================================
# plot_raw_session.py -- WESAD-style multi-panel plot of THIS ring's own
# data, for side-by-side comparison against a reference figure like
# WESAD's own raw Empatica E4 plots (Acc mag / Temp / BVP / IBI / EDA).
#
# Two modes, depending on what data you have:
#
#   --csv <path>
#       Raw-resolution plot from a local raw sample log (see
#       mqtt_bridge.py's RING_RAW_LOG_PATH -- set that env var and run
#       the bridge locally during a recording session to produce this
#       file). Panels: accelerometer magnitude, raw IR (this ring's PPG
#       proxy -- there's no continuous BVP waveform transmitted, only
#       the raw IR reading used for on-device beat detection), raw GSR
#       ADC, and individual IBI beats. Comparable density/shape to a
#       WESAD raw-signal figure.
#
#   --user-id X --session-id Y
#       Coarser plot built from whatever's ALREADY stored in Firebase --
#       one point per ~20s sliding window (SLIDE_INTERVAL_SEC,
#       mqtt_bridge.py), not a continuous waveform, since only derived
#       per-window features (not raw samples) are ever written there.
#       No new recording needed, but visually much sparser than the CSV
#       mode or a WESAD reference plot -- use this only if you can't
#       get a fresh raw-logged recording before your demo.
#
# Requires matplotlib (not in backend/physiological/requirements.txt --
# this is a local analysis tool, not part of the deployed Flask service,
# so it's deliberately not added to that deployment's dependencies):
#   pip install matplotlib
#
# Usage (run from the repo root):
#   python -m backend.physiological.plot_raw_session --csv ring_raw_log.csv
#   python -m backend.physiological.plot_raw_session --user-id alice --session-id wearable01_20260831T120000
# ============================================================

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))


def plot_from_csv(csv_path: str, out_path: str) -> None:
    import matplotlib.pyplot as plt
    import numpy as np

    with open(csv_path, newline='') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f'No rows found in {csv_path}')

    def _f(r, key):
        v = r.get(key, '')
        return float(v) if v not in (None, '') else np.nan

    t0 = float(rows[0]['timestamp'])
    ts = np.array([float(r['timestamp']) - t0 for r in rows])
    ir = np.array([_f(r, 'ir') for r in rows])
    gsr = np.array([_f(r, 'gsr_adc') for r in rows])
    acc_x = np.array([_f(r, 'acc_x') for r in rows])
    acc_y = np.array([_f(r, 'acc_y') for r in rows])
    acc_z = np.array([_f(r, 'acc_z') for r in rows])
    acc_mag = np.sqrt(np.nan_to_num(acc_x) ** 2 + np.nan_to_num(acc_y) ** 2 + np.nan_to_num(acc_z) ** 2) / 9.81

    # Spread each message's beats evenly across that message's own publish
    # interval instead of stamping them all at the message's arrival time --
    # closer to their real timing without the device timestamping each beat
    # individually (see mqtt_bridge.py's log_raw_sample()).
    ibi_t, ibi_v = [], []
    for i, r in enumerate(rows):
        beats = [b for b in r.get('ibi_beats', '').split(';') if b]
        if not beats:
            continue
        span = (ts[i + 1] - ts[i]) if i + 1 < len(ts) else 0.2
        for j, b in enumerate(beats):
            ibi_t.append(ts[i] + span * (j + 1) / len(beats))
            ibi_v.append(float(b))

    fig, axes = plt.subplots(4, 1, figsize=(9, 10), sharex=True)
    fig.suptitle(Path(csv_path).stem, fontweight='bold')

    axes[0].plot(ts, acc_mag, color='black', linewidth=0.6)
    axes[0].set_ylabel('Acc mag (g)')

    axes[1].plot(ts, ir, color='#22c55e', linewidth=0.6)
    axes[1].set_ylabel('IR (raw PPG)')

    axes[2].plot(ibi_t, ibi_v, color='#ef4444', linewidth=0.8, marker='.', markersize=2)
    axes[2].set_ylabel('IBI (ms)')

    axes[3].plot(ts, gsr, color='#3b82f6', linewidth=0.8)
    axes[3].set_ylabel('GSR (raw ADC)')
    axes[3].set_xlabel('Seconds')

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path} ({len(rows)} samples, {ts[-1]:.0f}s span)')


def plot_from_firebase(user_id: str, session_id: str, out_path: str) -> None:
    import matplotlib.pyplot as plt

    from backend.physiological.firebase_service import get_session_predictions, init_firebase
    from backend.physiological.plot_normal_comparison import REFERENCE_RANGES

    init_firebase()
    preds = get_session_predictions(user_id, session_id)
    rows = sorted(preds.values(), key=lambda p: p.get('window_idx', 0))
    if not rows:
        raise SystemExit(f'No predictions found for {user_id}/{session_id}')

    t0 = None
    ts, hr, scl, acc_mean = [], [], [], []
    for r in rows:
        try:
            sec = datetime.fromisoformat(r['timestamp']).timestamp()
        except Exception:
            continue
        if t0 is None:
            t0 = sec
        ts.append(sec - t0)
        feat = r.get('features', {})
        hr.append(feat.get('MeanHR'))
        scl.append(feat.get('SCL_mean'))
        acc_mean.append(feat.get('ACC_mean'))

    fig, axes = plt.subplots(3, 1, figsize=(9, 7), sharex=True)
    fig.suptitle(f'{user_id} / {session_id}  (per-window features, ~20s resolution -- not raw)', fontweight='bold', fontsize=10)

    axes[0].plot(ts, acc_mean, marker='o', markersize=3, color='black')
    axes[0].set_ylabel('Acc mean (g)')

    # Reference-range overlay: a shaded band across the WHOLE session,
    # from the same REFERENCE_RANGES dict plot_normal_comparison.py uses
    # (single source of truth for the citation/numbers, not duplicated
    # here) -- shows visually that the measured line stayed inside the
    # published normal range for the whole recording, not just as a
    # single before/after bar.
    def _overlay_range(ax, feat_key):
        ref = REFERENCE_RANGES.get(feat_key)
        if ref is None or not ts:
            return
        low, high, unit, source = ref
        ax.axhspan(low, high, color='#22c55e', alpha=0.15, zorder=0,
                   label=f'Published normal range ({source})')
        ax.legend(fontsize=6, loc='upper right')

    axes[1].plot(ts, hr, marker='o', markersize=3, color='#ef4444', zorder=2)
    axes[1].set_ylabel('Mean HR (bpm)')
    _overlay_range(axes[1], 'MeanHR')

    axes[2].plot(ts, scl, marker='o', markersize=3, color='#3b82f6', zorder=2)
    axes[2].set_ylabel('SCL (µS)')
    axes[2].set_xlabel('Seconds')
    _overlay_range(axes[2], 'SCL_mean')

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path} ({len(rows)} windows, {ts[-1]:.0f}s span)')
    if REFERENCE_RANGES.get('SCL_mean') is None:
        print('  NOTE: SCL_mean has no reference range set yet -- edit REFERENCE_RANGES '
              'in plot_normal_comparison.py to also shade that band on the SCL panel.')


def list_sessions(user_id: str, limit: int = 20) -> None:
    """Prints this user's most recent session ids (from sessions/{user_id}
    -- the same index save_prediction() writes window_count into, see
    firebase_service.py::get_recent_sessions()) so --session-id doesn't
    require digging through the Firebase console by hand."""
    from backend.physiological.firebase_service import get_recent_sessions, init_firebase

    init_firebase()
    sessions = get_recent_sessions(user_id, limit=limit)
    if not sessions:
        print(f'No sessions found for {user_id}.')
        return
    print(f'Most recent sessions for {user_id} (oldest first):')
    for session_id, meta in sessions.items():
        n_windows = meta.get('window_count', '?') if isinstance(meta, dict) else '?'
        print(f'  {session_id}   ({n_windows} windows)')
    print('\nUse the one you want with --session-id, e.g.:')
    last_id = list(sessions.keys())[-1]
    print(f'  python -m backend.physiological.plot_raw_session --user-id {user_id} --session-id {last_id}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', help='Path to a raw log CSV from mqtt_bridge.py (RING_RAW_LOG_PATH)')
    parser.add_argument('--user-id', help='Firebase user_id (use with --session-id, or alone with --list-sessions)')
    parser.add_argument('--session-id', help='Firebase session_id (use with --user-id)')
    parser.add_argument('--list-sessions', action='store_true',
                        help='List recent session ids for --user-id instead of plotting')
    parser.add_argument('--out', default=None, help='Output PNG path (default: derived from input)')
    args = parser.parse_args()

    # Timestamped by default (only when --out isn't given explicitly) --
    # re-running the same user/session later (e.g. to see more windows
    # accumulate) used to silently overwrite the previous PNG at the same
    # deterministic name, losing the earlier snapshot. Each run now gets
    # its own file unless you explicitly ask to reuse one via --out.
    run_stamp = datetime.now().strftime('%Y%m%dT%H%M%S')

    if args.list_sessions:
        if not args.user_id:
            parser.error('--list-sessions requires --user-id')
        list_sessions(args.user_id)
    elif args.csv:
        out = args.out or f'{Path(args.csv).stem}_{run_stamp}.png'
        plot_from_csv(args.csv, out)
    elif args.user_id and args.session_id:
        out = args.out or f'{args.user_id}_{args.session_id}_{run_stamp}.png'
        plot_from_firebase(args.user_id, args.session_id, out)
    else:
        parser.error('Pass either --csv <path>, --user-id with --session-id, or --user-id with --list-sessions')


if __name__ == '__main__':
    main()
