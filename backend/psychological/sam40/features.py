"""Per-epoch feature extraction: band power, Hjorth parameters, spectral entropy,
time-domain stats, and inter-channel asymmetry.

Works on an arbitrary set of named channels, so the same code serves a
T7/T8-only model and a full 32-channel model.
"""

import numpy as np
from scipy.integrate import trapezoid
from scipy.signal import welch

from .channels import SFREQ

BANDS = {
    'delta': (0.5, 4),
    'theta': (4, 8),
    'alpha': (8, 13),
    'beta': (13, 30),
    'gamma': (30, 45),
}


def _band_powers(sig: np.ndarray, fs: int = SFREQ) -> dict:
    nperseg = min(len(sig), fs * 2)
    freqs, psd = welch(sig, fs=fs, nperseg=nperseg)
    # trapezoid() from scipy.integrate, not np.trapezoid -- the latter only
    # exists on numpy>=2.0 (added when np.trapz was deprecated), and the
    # deployed server hit AttributeError on an older numpy at /calibrate
    # time. scipy has provided integrate.trapezoid since 1.6.0, independent
    # of whatever numpy version is actually installed.
    total = trapezoid(psd, freqs)
    total = total if total > 0 else np.finfo(float).eps

    out = {}
    band_power = {}
    for band, (lo, hi) in BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        power = trapezoid(psd[mask], freqs[mask]) if mask.any() else 0.0
        band_power[band] = power
        out[f'{band}_power'] = power
        out[f'{band}_rel_power'] = power / total
        out[f'{band}_log_power'] = float(np.log(power + np.finfo(float).eps))
    out['total_power'] = total

    # Cross-band ratios: identical whether computed from raw or relative power
    # (the shared `total` denominator cancels), so just use raw band_power.
    eps = np.finfo(float).eps
    out['theta_alpha_ratio'] = band_power['theta'] / (band_power['alpha'] + eps)
    out['beta_alpha_ratio'] = band_power['beta'] / (band_power['alpha'] + eps)
    out['theta_beta_ratio'] = band_power['theta'] / (band_power['beta'] + eps)

    psd_norm = psd / psd.sum() if psd.sum() > 0 else psd
    psd_norm = psd_norm[psd_norm > 0]
    # len(psd_norm)<=1 (degenerate/flat/all-zero epoch: no PSD content, or all of it in one bin)
    # makes the log2(len) denominator 0 or -inf -- no real spectral distribution to measure
    # entropy over in that case, so define it as 0 rather than letting divide-by-zero through.
    out['spectral_entropy'] = (float(-(psd_norm * np.log2(psd_norm)).sum() / np.log2(len(psd_norm)))
                                if len(psd_norm) > 1 else 0.0)
    out['spectral_slope'] = _spectral_slope(freqs, psd)
    return out


def _spectral_slope(freqs: np.ndarray, psd: np.ndarray, fmin: float = 1.0, fmax: float = 45.0) -> float:
    """1/f aperiodic tilt: linear regression slope of log(power) on log(frequency).

    A simplified single-slope fit (not full FOOOF periodic/aperiodic
    decomposition) -- oscillatory peaks (alpha etc.) are left in, so this is
    a coarse arousal/fatigue proxy, not a clean aperiodic-exponent estimate.
    Steeper (more negative) slope is the conventional "flatter -> more
    aroused, steeper -> more idle/fatigued" direction reported in the 1/f-EEG
    literature.
    """
    mask = (freqs >= fmin) & (freqs <= fmax) & (psd > 0)
    if mask.sum() < 3:
        return 0.0
    log_f = np.log10(freqs[mask])
    log_p = np.log10(psd[mask])
    slope, _ = np.polyfit(log_f, log_p, 1)
    return float(slope)


_SAMPEN_BROADCAST_LIMIT = 1200  # samples; above this, O(n^2) broadcasting is too slow/memory-heavy


def _sample_entropy(sig: np.ndarray, m: int = 2, r_ratio: float = 0.2) -> float:
    """SampEn(m, r): -log(A/B), A/B = fraction of length-(m+1)/m template pairs
    that stay within tolerance r (self-matches excluded).

    Two implementations, chosen by window length:
      - short windows (<=1200 samples, e.g. 4-9s @128Hz): dense broadcasting,
        the O(n^2) distance matrix is trivial to hold in memory and fast.
      - longer windows (e.g. 25s+ @128Hz -> ~3200+ samples): a KD-tree
        radius-neighbor count instead -- brute-force broadcasting there would
        mean multi-GB distance matrices and multi-minute runtimes per window,
        infeasible at the trial-count scale used in this project.
    """
    sig = np.asarray(sig, dtype=float)
    n = len(sig)
    r = r_ratio * np.std(sig)
    if r == 0 or n <= m + 2:
        return 0.0

    if n <= _SAMPEN_BROADCAST_LIMIT:
        def _match_count(mm):
            templates = np.lib.stride_tricks.sliding_window_view(sig, mm)
            dist = np.abs(templates[:, None, :] - templates[None, :, :]).max(axis=2)
            np.fill_diagonal(dist, np.inf)
            return np.sum(dist <= r) / 2
    else:
        from scipy.spatial import cKDTree

        def _match_count(mm):
            templates = np.lib.stride_tricks.sliding_window_view(sig, mm)
            tree = cKDTree(templates)
            # Chebyshev (max-abs) distance <= r, p=inf; count includes self-matches (dist=0),
            # subtract those (each point matches itself once) before halving for unordered pairs.
            counts = tree.query_ball_point(templates, r=r, p=np.inf, return_length=True)
            return (counts.sum() - len(templates)) / 2

    b = _match_count(m)
    a = _match_count(m + 1)
    if b == 0 or a == 0:
        return 0.0
    return float(-np.log(a / b))


def _hjorth(sig: np.ndarray) -> dict:
    d1 = np.diff(sig)
    d2 = np.diff(d1)
    var0 = np.var(sig)
    var1 = np.var(d1)
    var2 = np.var(d2)

    activity = var0
    mobility = np.sqrt(var1 / var0) if var0 > 0 else 0.0
    d1_mobility = np.sqrt(var2 / var1) if var1 > 0 else 0.0
    complexity = d1_mobility / mobility if mobility > 0 else 0.0

    return {'hjorth_activity': activity, 'hjorth_mobility': mobility, 'hjorth_complexity': complexity}


def _time_domain(sig: np.ndarray) -> dict:
    return {
        'mean': np.mean(sig),
        'std': np.std(sig),
        'rms': np.sqrt(np.mean(sig ** 2)),
        'ptp': np.ptp(sig),
    }


def channel_features(sig: np.ndarray, fs: int = SFREQ) -> dict:
    """All single-channel features for one 1-D signal."""
    feats = {}
    feats.update(_band_powers(sig, fs=fs))
    feats.update(_hjorth(sig))
    feats.update(_time_domain(sig))
    feats['sample_entropy'] = _sample_entropy(sig)
    return feats


def _connectivity_features(epoch: np.ndarray, channel_names: list[str], fs: int = SFREQ) -> dict:
    """Coherence, PLV, and PLI between exactly two channels, per band.

    Coherence: magnitude-squared coherence averaged within each band.
    PLV/PLI: band-limited (bandpass -> Hilbert phase) phase synchrony
    measures -- PLV is sensitive to any consistent phase relationship
    (including near-zero-lag, which volume conduction can fake); PLI
    downweights near-zero-lag synchrony, so the two together help tell real
    inter-channel coupling apart from a shared-reference artifact.
    """
    from scipy.signal import coherence as _coherence
    from scipy.signal import hilbert

    from .preprocess import bandpass

    a_sig, b_sig = epoch[0], epoch[1]
    feats = {}

    nperseg = min(len(a_sig), fs * 2)
    freqs, cxy = _coherence(a_sig, b_sig, fs=fs, nperseg=nperseg)
    for band, (lo, hi) in BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        feats[f'coherence_{band}'] = float(cxy[mask].mean()) if mask.any() else 0.0

    nyquist = fs / 2
    for band, (lo, hi) in BANDS.items():
        high = min(hi, nyquist - 0.5)
        a_filt = bandpass(a_sig[None, :], low=lo, high=high, fs=fs)[0]
        b_filt = bandpass(b_sig[None, :], low=lo, high=high, fs=fs)[0]
        phase_diff = np.angle(hilbert(a_filt)) - np.angle(hilbert(b_filt))
        feats[f'plv_{band}'] = float(np.abs(np.mean(np.exp(1j * phase_diff))))
        feats[f'pli_{band}'] = float(np.abs(np.mean(np.sign(np.sin(phase_diff)))))

    return feats


def epoch_features(epoch: np.ndarray, channel_names: list[str], fs: int = SFREQ,
                    include_bipolar: bool = False) -> dict:
    """Flatten per-channel features into one row, prefixed by channel name.

    epoch: (n_channels, n_samples) matching channel_names order.

    include_bipolar (only for exactly 2 channels): also extracts the full
    single-channel feature set from the bipolar differential signal
    (channel_a - channel_b), prefixed 'bipolar_'. This is reference-
    agnostic by construction -- (T7-REF) - (T8-REF) = T7 - T8, so it's
    identical whether computed from a common-average-referenced signal (as
    trained on SAM40) or a single-ended 2-electrode signal referenced to
    anything else (as a real 2-electrode wearable would produce). Intended
    to make the model more robust to that referencing mismatch -- see
    src/realtime/pipeline.py's docstring for the underlying problem.
    """
    row = {}
    per_channel = {}
    for name, sig in zip(channel_names, epoch):
        cf = channel_features(sig, fs=fs)
        per_channel[name] = cf
        for feat_name, val in cf.items():
            row[f'{name}_{feat_name}'] = val

    if len(channel_names) == 2:
        a, b = channel_names
        for band in BANDS:
            pa = per_channel[a][f'{band}_rel_power']
            pb = per_channel[b][f'{band}_rel_power']
            row[f'asym_{band}_diff'] = pb - pa
            denom = pa + pb if (pa + pb) > 0 else np.finfo(float).eps
            row[f'asym_{band}_norm'] = (pb - pa) / denom
        row.update(_connectivity_features(epoch, channel_names, fs=fs))

        if include_bipolar:
            bipolar_sig = epoch[0] - epoch[1]
            for feat_name, val in channel_features(bipolar_sig, fs=fs).items():
                row[f'bipolar_{feat_name}'] = val

    return row
