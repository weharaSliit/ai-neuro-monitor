# ============================================================
# plot_waveform_overlap.py -- overlays YOUR ring's raw waveform directly
# on top of WESAD's raw WRIST (Empatica E4) waveform for the same
# channel, both z-score normalized so two signals in completely
# different physical units (raw ADC counts vs WESAD's own sensor units)
# can be visually compared on one axis. NOT labeled by Normal/Stress --
# just the raw signal shape, superimposed, per your request.
#
# Wrist (not chest) WESAD data on purpose -- same device placement/type
# (optical PPG + wrist/finger EDA) as your ring, matching the earlier
# reference image you shared, not the chest RespiBAN your MODEL was
# trained on (see plot_wesad_comparison.py for that comparison instead).
#
# REQUIRES a raw CSV from your ring first -- see mqtt_bridge.py's
# RING_RAW_LOG_PATH env var. The per-window Firebase data you've been
# using for the other plots doesn't have raw samples, only derived
# 60s-window features -- there's no raw waveform to overlay without a
# fresh RING_RAW_LOG_PATH recording.
#
# Usage (run from the repo root):
#   python -m backend.physiological.plot_waveform_overlap --csv ring_raw_log.csv --channel gsr
#   python -m backend.physiological.plot_waveform_overlap --csv ring_raw_log.csv --channel ppg --wesad-subject 3
#   python -m backend.physiological.plot_waveform_overlap --csv ring_raw_log.csv --channel acc
# ============================================================

import argparse
import csv
import sys
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

# Same sys.path pattern the physiological_signals notebooks use to import
# their own utils.config (not a notebook-only trick -- it's a real
# importable package, just laid out for notebook use).
_COMPONENT_PATH = Path(__file__).resolve().parents[2] / 'physiological_signals'
if str(_COMPONENT_PATH / 'src') not in sys.path:
    sys.path.insert(0, str(_COMPONENT_PATH / 'src'))

WESAD_WRIST_RATES = {'BVP': 64, 'EDA': 4, 'ACC': 32}
CHANNEL_MAP = {
    'gsr': ('gsr_adc', 'EDA', 'GSR (ring, raw ADC)  vs  EDA (WESAD wrist, uS)'),
    'ppg': ('ir', 'BVP', 'IR (ring, raw)  vs  BVP (WESAD wrist)'),
    'acc': (None, 'ACC', 'Accel magnitude (ring, g)  vs  Accel magnitude (WESAD wrist)'),
}


def _load_wesad_wrist_channel(subject_id: int, channel: str, duration_sec: float):
    import pickle

    import numpy as np
    from utils.config import WESAD_PATH

    pkl_path = Path(WESAD_PATH) / f'S{subject_id}' / f'S{subject_id}.pkl'
    if not pkl_path.exists():
        raise SystemExit(f'WESAD subject file not found at {pkl_path}')
    with open(pkl_path, 'rb') as f:
        data = pickle.load(f, encoding='latin1')

    wrist = data['signal']['wrist']
    fs = WESAD_WRIST_RATES[channel]
    if channel == 'ACC':
        raw = np.asarray(wrist['ACC'], dtype=float)
        sig = np.sqrt((raw ** 2).sum(axis=1))
    else:
        sig = np.asarray(wrist[channel], dtype=float).flatten()

    n = min(len(sig), int(duration_sec * fs))
    sig = sig[:n]
    ts = np.arange(len(sig)) / fs
    return ts, sig


def _zscore(x):
    import numpy as np

    x = np.asarray(x, dtype=float)
    mask = ~np.isnan(x)
    if mask.sum() == 0:
        return x
    mean, std = x[mask].mean(), x[mask].std()
    return (x - mean) / std if std > 0 else x - mean


def _bandpass_ppg(sig, fs, low_hz=0.5, high_hz=8.0):
    """Strips baseline wander and high-frequency noise from a raw PPG-ish
    signal (ring IR / WESAD BVP) before comparing shapes -- 0.5-8Hz covers
    30-480 bpm, generously wider than any real heart rate, so this removes
    artifacts without removing genuine pulse content. Without this, raw
    amplitude/noise-floor differences between the two sensors (not real
    physiological differences) are what dominates the comparison."""
    from scipy import signal as sp_signal
    import numpy as np

    sig = np.nan_to_num(np.asarray(sig, dtype=float), nan=np.nanmean(sig))
    nyq = fs / 2.0
    low = min(low_hz, nyq * 0.4)
    high = min(high_hz, nyq * 0.9)
    b, a = sp_signal.butter(4, [low / nyq, high / nyq], btype='band')
    return sp_signal.filtfilt(b, a, sig)


def _preprocess_gsr(gsr_adc, fs):
    """Reuses extract_features.py's OWN GSR preprocessing (IQR outlier
    clipping, detrend, Butterworth tonic/phasic decomposition) -- the
    exact same filtering the deployed model's features are computed
    from, not a separate ad-hoc filter -- so 'preprocessed' here means
    what the model actually sees, not just 'smoothed'. Ring-specific:
    converts raw Grove GSR ADC counts to conductance first."""
    from backend.physiological.extract_features import adc_to_conductance, preprocess_gsr
    from backend.common.config import GSR_CAL

    conductance = adc_to_conductance(gsr_adc, GSR_CAL)
    return preprocess_gsr(conductance, fs=fs)['filtered']


def _wesad_gsr_filter(eda_us, fs):
    """Same preprocess_gsr() filter as _preprocess_gsr() above, but for
    WESAD's EDA channel, which the Empatica E4 already reports directly
    in microsiemens -- no ADC->conductance conversion step needed (that
    part is specific to the ring's raw Grove GSR sensor)."""
    from backend.physiological.extract_features import preprocess_gsr

    return preprocess_gsr(eda_us, fs=fs)['filtered']


def _load_and_preprocess_ring(csv_path: str, channel: str):
    """Shared by plot_overlap() and plot_ring_only(): loads a raw CSV log
    (mqtt_bridge.py's RING_RAW_LOG_PATH) and applies the same
    channel-appropriate preprocessing either caller needs."""
    import numpy as np

    ring_field, _wesad_channel, ylabel = CHANNEL_MAP[channel]

    with open(csv_path, newline='') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f'No rows found in {csv_path}')

    def _f(r, key):
        v = r.get(key, '')
        return float(v) if v not in (None, '') else np.nan

    t0 = float(rows[0]['timestamp'])
    ts_ring = np.array([float(r['timestamp']) - t0 for r in rows])
    ring_fs = max(1.0, len(rows) / ts_ring[-1]) if ts_ring[-1] > 0 else 5.0

    if channel == 'acc':
        ax_v = np.array([_f(r, 'acc_x') for r in rows])
        ay_v = np.array([_f(r, 'acc_y') for r in rows])
        az_v = np.array([_f(r, 'acc_z') for r in rows])
        ring_sig = np.sqrt(np.nan_to_num(ax_v) ** 2 + np.nan_to_num(ay_v) ** 2 + np.nan_to_num(az_v) ** 2) / 9.81
        preprocess_note = 'raw magnitude (no filtering needed for this channel)'
    elif channel == 'gsr':
        ring_sig = _preprocess_gsr([_f(r, ring_field) for r in rows], fs=ring_fs)
        preprocess_note = "same tonic/phasic filter extract_features.py's model pipeline uses"
    else:  # ppg
        ring_sig = _bandpass_ppg([_f(r, ring_field) for r in rows], fs=ring_fs)
        preprocess_note = '0.5-8Hz bandpass (strips baseline wander + high-freq noise, keeps pulse content)'

    return ts_ring, ring_sig, ring_fs, ylabel, preprocess_note


def plot_ring_only(csv_path: str, channel: str, out_path: str) -> None:
    """Just your ring's own preprocessed signal, no WESAD overlay --
    plotted in its own real units (not z-scored, since there's nothing
    else on the axis to rescale against)."""
    import matplotlib.pyplot as plt

    ts_ring, ring_sig, _fs, ylabel, preprocess_note = _load_and_preprocess_ring(csv_path, channel)

    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(ts_ring, ring_sig, color='#1e293b', linewidth=0.9)
    ax.set_xlabel('Seconds')
    ax.set_ylabel(ylabel.split('vs')[0].strip())
    ax.set_title(f'Your ring, preprocessed -- {channel}\n({preprocess_note})', fontweight='bold', fontsize=10)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')


def plot_overlap(csv_path: str, channel: str, wesad_subject: int, out_path: str) -> None:
    import numpy as np
    import matplotlib.pyplot as plt

    _ring_field, wesad_channel, ylabel = CHANNEL_MAP[channel]
    ts_ring, ring_sig, ring_fs, _ylabel, preprocess_note = _load_and_preprocess_ring(csv_path, channel)

    duration = float(ts_ring[-1]) if len(ts_ring) else 0.0
    ts_wesad, wesad_sig_raw = _load_wesad_wrist_channel(wesad_subject, wesad_channel, duration)
    wesad_fs = WESAD_WRIST_RATES[wesad_channel]
    if channel == 'gsr':
        wesad_sig = _wesad_gsr_filter(wesad_sig_raw, wesad_fs)
    elif channel == 'ppg':
        wesad_sig = _bandpass_ppg(wesad_sig_raw, fs=wesad_fs)
    else:
        wesad_sig = wesad_sig_raw

    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.plot(ts_ring, _zscore(ring_sig), color='#1e293b', linewidth=0.8, label='Your ring (preprocessed)')
    ax.plot(ts_wesad, _zscore(wesad_sig), color='#ef4444', linewidth=0.6, alpha=0.7,
            label=f'WESAD S{wesad_subject} wrist (preprocessed)')
    ax.set_xlabel('Seconds')
    ax.set_ylabel('z-scored (units differ -- compare shape/pattern, not absolute scale)')
    ax.set_title(f'Preprocessed waveform overlap: {ylabel}\n'
                 f'({preprocess_note}) -- not labeled by condition, just the signal shape',
                 fontweight='bold', fontsize=10)
    ax.legend(fontsize=9)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')


def _rolling_mean(x_t, y, window_sec, step_sec=5.0):
    import numpy as np

    if len(x_t) == 0:
        return np.array([]), np.array([])
    out_t, out_y = [], []
    for center in np.arange(x_t[0], x_t[-1] + step_sec, step_sec):
        mask = (x_t >= center - window_sec / 2) & (x_t <= center + window_sec / 2)
        if mask.sum() >= 3:
            out_t.append(center)
            out_y.append(y[mask].mean())
    return np.array(out_t), np.array(out_y)


def plot_ring_trends(csv_path: str, out_path: str, window_sec: float = 60.0) -> None:
    """Ring-only, preprocessed SCL / Mean HR / Acc mean -- the same three
    quantities plot_raw_session.py's Firebase mode shows, but computed
    here directly from raw samples with a rolling WINDOW_SEC-wide average
    (matching the model's own 60s window definition of these features)
    instead of Firebase's sparser ~20s-apart snapshots. No WESAD overlay."""
    import numpy as np
    import matplotlib.pyplot as plt

    from backend.common.config import GSR_CAL
    from backend.physiological.extract_features import adc_to_conductance, preprocess_gsr

    with open(csv_path, newline='') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f'No rows found in {csv_path}')

    def _f(r, key):
        v = r.get(key, '')
        return float(v) if v not in (None, '') else np.nan

    t0 = float(rows[0]['timestamp'])
    ts = np.array([float(r['timestamp']) - t0 for r in rows])
    fs = max(1.0, len(rows) / ts[-1]) if ts[-1] > 0 else 5.0

    # SCL -- the tonic component of the exact same preprocess_gsr() filter
    # the deployed model's SCL_mean feature is computed from.
    conductance = adc_to_conductance([_f(r, 'gsr_adc') for r in rows], GSR_CAL)
    scl = preprocess_gsr(conductance, fs=fs)['tonic']

    # Mean HR -- flatten individual beats out with their own approximate
    # timestamps (same spreading logic as plot_raw_session.py's --csv
    # mode), convert each IBI to instantaneous bpm, then roll-average.
    beat_t, beat_hr = [], []
    for i, r in enumerate(rows):
        beats = [b for b in r.get('ibi_beats', '').split(';') if b]
        if not beats:
            continue
        span = (ts[i + 1] - ts[i]) if i + 1 < len(ts) else 1.0 / fs
        for j, b in enumerate(beats):
            ibi_ms = float(b)
            if ibi_ms > 0:
                beat_t.append(ts[i] + span * (j + 1) / len(beats))
                beat_hr.append(60000.0 / ibi_ms)
    hr_t, hr_y = _rolling_mean(np.array(beat_t), np.array(beat_hr), window_sec)

    # Acc mean -- rolling average of accelerometer magnitude, same window.
    ax_v = np.array([_f(r, 'acc_x') for r in rows])
    ay_v = np.array([_f(r, 'acc_y') for r in rows])
    az_v = np.array([_f(r, 'acc_z') for r in rows])
    acc_mag = np.sqrt(np.nan_to_num(ax_v) ** 2 + np.nan_to_num(ay_v) ** 2 + np.nan_to_num(az_v) ** 2) / 9.81
    acc_t, acc_y = _rolling_mean(ts, acc_mag, window_sec)

    fig, axes = plt.subplots(3, 1, figsize=(9, 7), sharex=True)
    fig.suptitle(f'{Path(csv_path).stem} — preprocessed ring trends ({window_sec:.0f}s rolling window, no WESAD)',
                 fontweight='bold', fontsize=10)

    axes[0].plot(acc_t, acc_y, color='black', marker='o', markersize=2)
    axes[0].set_ylabel('Acc mean (g)')

    axes[1].plot(hr_t, hr_y, color='#ef4444', marker='o', markersize=2)
    axes[1].set_ylabel('Mean HR (bpm)')

    axes[2].plot(ts, scl, color='#3b82f6', linewidth=0.9)
    axes[2].set_ylabel('SCL (uS)')
    axes[2].set_xlabel('Seconds')

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f'Saved {out_path}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', required=True, help='Raw log CSV from mqtt_bridge.py (RING_RAW_LOG_PATH)')
    parser.add_argument('--channel', choices=list(CHANNEL_MAP), help='Which raw signal to plot (not used with --trends)')
    parser.add_argument('--trends', action='store_true',
                        help='Plot SCL / Mean HR / Acc mean (rolling-window derived features) instead of a raw channel -- ring only, no WESAD')
    parser.add_argument('--window-sec', type=float, default=60.0, help='Rolling window width for --trends (default 60s)')
    parser.add_argument('--wesad-subject', type=int, default=2, help='WESAD subject id to compare against (default 2)')
    parser.add_argument('--no-wesad', action='store_true',
                        help="Just your ring's own preprocessed signal, skip the WESAD overlay entirely")
    parser.add_argument('--out', default=None)
    args = parser.parse_args()

    from datetime import datetime
    run_stamp = datetime.now().strftime('%Y%m%dT%H%M%S')
    if args.trends:
        out = args.out or f'{Path(args.csv).stem}_trends_{run_stamp}.png'
        plot_ring_trends(args.csv, out, window_sec=args.window_sec)
    elif not args.channel:
        parser.error('Pass --channel (with or without --no-wesad), or --trends')
    elif args.no_wesad:
        out = args.out or f'{Path(args.csv).stem}_ringonly_{args.channel}_{run_stamp}.png'
        plot_ring_only(args.csv, args.channel, out)
    else:
        out = args.out or f'{Path(args.csv).stem}_overlap_{args.channel}_{run_stamp}.png'
        plot_overlap(args.csv, args.channel, args.wesad_subject, out)


if __name__ == '__main__':
    main()
