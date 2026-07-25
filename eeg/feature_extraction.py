import sys
import numpy as np
from pathlib import Path
from scipy.signal import welch, butter, filtfilt, hilbert
from typing import Dict, List, Optional, Tuple


# ─────────────────────────────────────────────
#  CONSTANTS
# ─────────────────────────────────────────────

EEG_CHANNELS: List[str] = [
    'Fp1', 'AF3', 'F7',  'F3',  'FC1', 'FC5',
    'T7',  'C3',  'CP1', 'CP5', 'P7',  'P3',
    'PZ',  'PO3', 'O1',  'OZ',  'O2',  'PO4',
    'P4',  'P8',  'CP6', 'CP2', 'C4',  'T8',
    'FC6', 'FC2', 'F4',  'F8',  'AF4', 'Fp2',
    'Fz',  'Cz',
]

T7_INDEX: int = EEG_CHANNELS.index('T7')   # 6
T8_INDEX: int = EEG_CHANNELS.index('T8')   # 23

# Frontal asymmetry indices (for perceived stress proxy feature)
FP1_INDEX: int = EEG_CHANNELS.index('Fp1')   # 0
FP2_INDEX: int = EEG_CHANNELS.index('Fp2')   # 29
AF3_INDEX: int = EEG_CHANNELS.index('AF3')   # 1
AF4_INDEX: int = EEG_CHANNELS.index('AF4')   # 28
STUDENT_CHANNEL_NAMES: List[str] = ['T7', 'T8']

UNIFIED_OUTPUT_DIR: Path = Path(
    "/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/Research"
    "/ai-neuro-monitor/eeg/data/unified_output"
)

SAMPLING_RATE_HZ: float = 256.0
LOG_EPS:          float = 1e-10    # floor for log to prevent log(0)

# ── Frequency bands ───────────────────────────────────────────
BANDS: Dict[str, Tuple[float, float]] = {
    'delta' : (0.5,  4.0),
    'theta' : (4.0,  8.0),
    'alpha' : (8.0, 13.0),
    'beta'  : (13.0, 30.0),
    'gamma' : (30.0, 45.0),
}
BAND_NAMES: List[str] = list(BANDS.keys())   # ordered: δ θ α β γ

# ── Welch PSD ─────────────────────────────────────────────────
WELCH_NPERSEG_FRAC: float = 1.0   # nperseg = int(frac × W) = full epoch window
WELCH_NOVERLAP_FRAC: float = 0.5  # 50% overlap

# ── Butterworth bandpass for DE ───────────────────────────────
BP_ORDER: int = 4

# ── Extended feature dimensions (student T7+T8 only) ─────────
N_BASE_PER_CH:     int = 15   # PSD(5) + DE(5) + Hjorth(5)
N_SPECTRAL_EXT:    int = 10   # per channel: relative bands, centroid, SEF95, peak alpha, ratios
N_NONLINEAR:       int = 5    # per channel: spec_entropy, perm_entropy, samp_entropy, higuchi, katz
N_CONNECTIVITY:    int = 16   # T7+T8 pair: coherence(5)+PLV(5)+PLI(5)+xcorr(1)
N_STUDENT_FEAT_BASE:  int = 2 * N_BASE_PER_CH                              # 30
N_STUDENT_FEAT_EXT:   int = 2 * (N_BASE_PER_CH + N_SPECTRAL_EXT + N_NONLINEAR) + N_CONNECTIVITY  # 76


# ─────────────────────────────────────────────
#  UTILITY — BANDPASS FILTER
# ─────────────────────────────────────────────

def _bandpass(
    signal: np.ndarray,
    lo:     float,
    hi:     float,
    fs:     float = SAMPLING_RATE_HZ,
    order:  int   = BP_ORDER,
) -> np.ndarray:
    """Zero-phase Butterworth bandpass for a 1-D signal."""
    nyq    = fs / 2.0
    b, a   = butter(order, [lo / nyq, hi / nyq], btype='band')
    return filtfilt(b, a, signal)


# ─────────────────────────────────────────────
#  [A] PSD BAND POWER
# ─────────────────────────────────────────────

def psd_band_power(
    epoch_1d: np.ndarray,
    fs:       float = SAMPLING_RATE_HZ,
) -> np.ndarray:
    W         = len(epoch_1d)
    nperseg   = W                            # full-epoch window
    noverlap  = W // 2                       # 50% overlap

    freqs, psd = welch(
        epoch_1d.astype(np.float64),
        fs        = fs,
        window    = 'hann',
        nperseg   = nperseg,
        noverlap  = noverlap,
        scaling   = 'density',
    )

    features = np.empty(len(BAND_NAMES), dtype=np.float64)
    for i, band in enumerate(BAND_NAMES):
        lo, hi = BANDS[band]
        mask   = (freqs >= lo) & (freqs <= hi)
        bp     = float(np.trapezoid(psd[mask], freqs[mask])) if mask.any() else LOG_EPS
        features[i] = np.log10(max(bp, LOG_EPS))

    return features.astype(np.float32)


# ─────────────────────────────────────────────
#  [B] DIFFERENTIAL ENTROPY
# ─────────────────────────────────────────────

def differential_entropy(
    epoch_1d: np.ndarray,
    fs:       float = SAMPLING_RATE_HZ,
) -> np.ndarray:
    _2PIE = 2.0 * np.pi * np.e

    features = np.empty(len(BAND_NAMES), dtype=np.float64)
    x        = epoch_1d.astype(np.float64)

    for i, band in enumerate(BAND_NAMES):
        lo, hi    = BANDS[band]
        x_band    = _bandpass(x, lo, hi, fs)
        var_band  = max(float(x_band.var()), LOG_EPS)
        features[i] = 0.5 * np.log(_2PIE * var_band)

    return features.astype(np.float32)


# ─────────────────────────────────────────────
#  [C] TIME-DOMAIN STATISTICS  (Hjorth)
# ─────────────────────────────────────────────

def time_domain_stats(epoch_1d: np.ndarray) -> np.ndarray:
    x     = epoch_1d.astype(np.float64)
    dx    = np.diff(x)
    d2x   = np.diff(dx)

    mu    = float(x.mean())
    var_x = max(float(x.var()),   LOG_EPS)
    var_d = max(float(dx.var()),  LOG_EPS)
    var_d2= max(float(d2x.var()), LOG_EPS)

    activity   = var_x
    mobility   = np.sqrt(var_d  / var_x)
    mob_d      = np.sqrt(var_d2 / var_d)
    complexity = mob_d / max(mobility, LOG_EPS)

    return np.array([mu, var_x, activity, mobility, complexity],
                    dtype=np.float32)


# ─────────────────────────────────────────────
#  [D] EXTENDED SPECTRAL FEATURES
# ─────────────────────────────────────────────

def spectral_extended_features(
    epoch_1d: np.ndarray,
    fs: float = SAMPLING_RATE_HZ,
) -> np.ndarray:
    """
    10 spectral features beyond PSD band power.

    Returns
    -------
    [rel_delta, rel_theta, rel_alpha, rel_beta, rel_gamma,
     spectral_centroid, sef95, peak_alpha_freq,
     alpha_beta_ratio, theta_beta_ratio]
    """
    W = len(epoch_1d)
    freqs, psd = welch(epoch_1d.astype(np.float64), fs=fs,
                       window='hann', nperseg=W, noverlap=W // 2)
    total_power = max(float(np.trapezoid(psd, freqs)), LOG_EPS)

    # Relative band powers
    rel = np.empty(len(BAND_NAMES), dtype=np.float64)
    abs_powers = {}
    for i, band in enumerate(BAND_NAMES):
        lo, hi = BANDS[band]
        mask = (freqs >= lo) & (freqs <= hi)
        bp   = float(np.trapezoid(psd[mask], freqs[mask])) if mask.any() else 0.0
        abs_powers[band] = max(bp, LOG_EPS)
        rel[i] = bp / total_power

    # Spectral centroid: sum(f * PSD) / sum(PSD)
    sig_mask = (freqs >= 0.5) & (freqs <= 45.0)
    psd_sig  = psd[sig_mask]
    f_sig    = freqs[sig_mask]
    centroid = float(np.sum(f_sig * psd_sig) / max(np.sum(psd_sig), LOG_EPS))

    # SEF95: frequency below which 95% of power lies
    cum_pwr = np.cumsum(psd_sig)
    threshold = 0.95 * cum_pwr[-1]
    sef95_idx = int(np.searchsorted(cum_pwr, threshold))
    sef95 = float(f_sig[min(sef95_idx, len(f_sig) - 1)])

    # Peak alpha frequency (8-13 Hz)
    alpha_mask = (freqs >= 8.0) & (freqs <= 13.0)
    if alpha_mask.any():
        peak_alpha = float(freqs[alpha_mask][np.argmax(psd[alpha_mask])])
    else:
        peak_alpha = 10.0  # default centre

    # Band ratios
    alpha_beta = abs_powers['alpha'] / max(abs_powers['beta'], LOG_EPS)
    theta_beta = abs_powers['theta'] / max(abs_powers['beta'], LOG_EPS)

    feats = np.concatenate([
        rel,
        [centroid, sef95, peak_alpha, alpha_beta, theta_beta],
    ]).astype(np.float32)
    return np.clip(feats, -1e6, 1e6)


# ─────────────────────────────────────────────
#  [E] NONLINEAR FEATURES
# ─────────────────────────────────────────────

def _higuchi_fd(x: np.ndarray, kmax: int = 6) -> float:
    """Higuchi Fractal Dimension — O(kmax × n)."""
    n = len(x)
    Lmk = []
    k_vals = range(1, kmax + 1)
    for k in k_vals:
        Lm = []
        for m in range(1, k + 1):
            idxs = np.arange(m - 1, n, k)
            if len(idxs) < 2:
                continue
            L = np.sum(np.abs(np.diff(x[idxs]))) * (n - 1) / (k * k * len(idxs))
            Lm.append(L)
        if Lm:
            Lmk.append(np.mean(Lm))
    if len(Lmk) < 2:
        return 1.0
    log_k  = np.log(np.array(list(k_vals[:len(Lmk)]), dtype=np.float64))
    log_Lk = np.log(np.maximum(np.array(Lmk), LOG_EPS))
    slope, _ = np.polyfit(log_k, log_Lk, 1)
    return float(-slope)


def _katz_fd(x: np.ndarray) -> float:
    """Katz Fractal Dimension — O(n)."""
    n  = len(x)
    diffs = np.abs(np.diff(x.astype(np.float64)))
    L  = float(diffs.sum())                          # total path length
    d  = float(np.max(np.abs(x - x[0])))            # max distance from start
    if L < LOG_EPS or d < LOG_EPS:
        return 1.0
    return float(np.log10(n) / (np.log10(n) + np.log10(d / L)))


def _permutation_entropy(x: np.ndarray, m: int = 3, tau: int = 1) -> float:
    """Permutation Entropy — O(n × m!)."""
    n = len(x)
    patterns: dict = {}
    for i in range(n - (m - 1) * tau):
        embed  = x[i:i + m * tau:tau]
        perm   = tuple(np.argsort(embed))
        patterns[perm] = patterns.get(perm, 0) + 1
    total = sum(patterns.values())
    if total == 0:
        return 0.0
    probs = np.array(list(patterns.values()), dtype=np.float64) / total
    return float(-np.sum(probs * np.log2(probs + 1e-12)))


def _spectral_entropy(psd: np.ndarray) -> float:
    """Normalised spectral entropy from a PSD array."""
    p  = psd / max(psd.sum(), LOG_EPS)
    p  = p[p > 0]
    return float(-np.sum(p * np.log2(p)) / np.log2(max(len(psd), 2)))


def _sample_entropy(x: np.ndarray, m: int = 2, r: float = None) -> float:
    """Sample entropy — O(n²) but n ≤ 256 (downsampled)."""
    # Downsample to 128 pts for speed on 512-sample epochs
    x = x[::4].astype(np.float64)
    n = len(x)
    if r is None:
        r = 0.2 * max(float(x.std()), LOG_EPS)

    def _count(m_):
        count = 0
        for i in range(n - m_):
            diff = np.abs(x[i + 1:n - m_ + 1] - x[i])
            for k in range(1, m_):
                diff = np.maximum(diff, np.abs(x[i + 1 + k:n - m_ + 1 + k] - x[i + k]))
            count += int((diff < r).sum())
        return count

    B = _count(m)
    A = _count(m + 1)
    if B == 0:
        return 0.0
    return float(-np.log(A / B)) if A > 0 else 2.0


def nonlinear_features(
    epoch_1d: np.ndarray,
    fs: float = SAMPLING_RATE_HZ,
) -> np.ndarray:
    """
    5 nonlinear complexity features per channel.

    Returns
    -------
    [spectral_entropy, permutation_entropy, sample_entropy,
     higuchi_fd, katz_fd]
    """
    x = epoch_1d.astype(np.float64)
    W = len(x)
    _, psd = welch(x, fs=fs, window='hann', nperseg=W, noverlap=W // 2)

    spec_ent  = _spectral_entropy(psd)
    perm_ent  = _permutation_entropy(x, m=3, tau=1)
    samp_ent  = _sample_entropy(x, m=2)
    higuchi   = _higuchi_fd(x, kmax=6)
    katz      = _katz_fd(x)

    return np.array([spec_ent, perm_ent, samp_ent, higuchi, katz],
                    dtype=np.float32)


# ─────────────────────────────────────────────
#  [F] CONNECTIVITY FEATURES  (T7+T8 pair)
# ─────────────────────────────────────────────

def connectivity_features_2ch(
    epoch_2ch: np.ndarray,
    fs: float = SAMPLING_RATE_HZ,
) -> np.ndarray:
    """
    16 inter-channel connectivity features for the T7+T8 pair.

    Returns (16,): [coh×5, plv×5, pli×5, xcorr×1]
      coh_*   : magnitude-squared coherence per band
      plv_*   : phase-locking value per band (Hilbert phases)
      pli_*   : phase-lag index per band (sign of Im[cross-spectrum])
      xcorr   : normalized cross-correlation peak
    """
    if epoch_2ch.shape[0] != 2:
        return np.zeros(N_CONNECTIVITY, dtype=np.float32)

    x1 = epoch_2ch[0].astype(np.float64)
    x2 = epoch_2ch[1].astype(np.float64)
    W  = len(x1)

    freqs, Pxx = welch(x1, fs=fs, nperseg=W, noverlap=W // 2, window='hann')
    _,    Pyy  = welch(x2, fs=fs, nperseg=W, noverlap=W // 2, window='hann')
    _,    Pxy  = welch(x1, fs=fs, nperseg=W, noverlap=W // 2, window='hann',
                       # use csd manually below for cross-spectrum
                       scaling='density')

    from scipy.signal import csd as scipy_csd
    _, Cxy = scipy_csd(x1, x2, fs=fs, nperseg=W, noverlap=W // 2, window='hann')

    # Magnitude-squared coherence per band
    coherence = np.abs(Cxy) ** 2 / np.maximum(Pxx * Pyy, LOG_EPS)

    # PLV: phase-locking value from Hilbert phases
    z1   = hilbert(x1)
    z2   = hilbert(x2)
    phi1 = np.angle(z1)
    phi2 = np.angle(z2)
    # PLV per band: average |e^{i*(phi1 - phi2)}| over band samples
    # Map from frequency-domain bands to time-domain phase differences
    d_phi = phi1 - phi2

    # PLI: mean sign of imaginary part of cross-spectrum
    pli_all = np.sign(np.imag(Cxy))

    coh_feats = np.empty(len(BAND_NAMES), dtype=np.float64)
    plv_feats = np.empty(len(BAND_NAMES), dtype=np.float64)
    pli_feats = np.empty(len(BAND_NAMES), dtype=np.float64)

    for i, band in enumerate(BAND_NAMES):
        lo, hi = BANDS[band]
        f_mask = (freqs >= lo) & (freqs <= hi)
        # Coherence
        coh_feats[i] = float(coherence[f_mask].mean()) if f_mask.any() else 0.0
        # PLI
        pli_feats[i] = float(np.abs(pli_all[f_mask].mean())) if f_mask.any() else 0.0
        # PLV: filter both signals to band, extract Hilbert phases
        try:
            x1_b = _bandpass(x1, lo, hi, fs)
            x2_b = _bandpass(x2, lo, hi, fs)
            d_phi_b = np.angle(hilbert(x1_b)) - np.angle(hilbert(x2_b))
            plv_feats[i] = float(np.abs(np.mean(np.exp(1j * d_phi_b))))
        except Exception:
            plv_feats[i] = 0.0

    # Normalized cross-correlation peak
    cc = np.correlate(x1 - x1.mean(), x2 - x2.mean(), mode='full')
    norm = max(np.sqrt(np.dot(x1, x1) * np.dot(x2, x2)), LOG_EPS)
    xcorr_peak = float(np.max(np.abs(cc)) / norm)

    return np.concatenate([coh_feats, plv_feats, pli_feats, [xcorr_peak]]).astype(np.float32)


# ─────────────────────────────────────────────
#  FEATURE NAMES
# ─────────────────────────────────────────────

def build_feature_names(channel_names: List[str]) -> List[str]:
    names: List[str] = []
    for ch in channel_names:
        for band in BAND_NAMES:
            names.append(f'psd_{band}_{ch}')
    for ch in channel_names:
        for band in BAND_NAMES:
            names.append(f'de_{band}_{ch}')
    for ch in channel_names:
        for stat in ['mean', 'variance', 'hjorth_act', 'hjorth_mob', 'hjorth_cmp']:
            names.append(f'td_{stat}_{ch}')
    return names


def build_student_feature_names_extended(channel_names: List[str] = None) -> List[str]:
    """Return 76 feature names for the extended student (T7+T8) feature vector."""
    if channel_names is None:
        channel_names = STUDENT_CHANNEL_NAMES
    names: List[str] = []
    # Base features: PSD + DE + Hjorth
    for ch in channel_names:
        for band in BAND_NAMES:
            names.append(f'psd_{band}_{ch}')
    for ch in channel_names:
        for band in BAND_NAMES:
            names.append(f'de_{band}_{ch}')
    for ch in channel_names:
        for stat in ['mean', 'variance', 'hjorth_act', 'hjorth_mob', 'hjorth_cmp']:
            names.append(f'td_{stat}_{ch}')
    # Extended spectral
    for ch in channel_names:
        for band in BAND_NAMES:
            names.append(f'rel_{band}_{ch}')
        for feat in ['centroid', 'sef95', 'peak_alpha', 'alpha_beta_ratio', 'theta_beta_ratio']:
            names.append(f'sp_{feat}_{ch}')
    # Nonlinear
    for ch in channel_names:
        for feat in ['spec_entropy', 'perm_entropy', 'samp_entropy', 'higuchi_fd', 'katz_fd']:
            names.append(f'nl_{feat}_{ch}')
    # Connectivity (T7+T8 pair)
    for conn_type in ['coh', 'plv', 'pli']:
        for band in BAND_NAMES:
            names.append(f'{conn_type}_{band}_T7T8')
    names.append('xcorr_T7T8')
    assert len(names) == N_STUDENT_FEAT_EXT, \
        f"Expected {N_STUDENT_FEAT_EXT} names, got {len(names)}"
    return names


# ─────────────────────────────────────────────
#  EPOCH FEATURE VECTOR
# ─────────────────────────────────────────────

def extract_epoch_features(
    epoch: np.ndarray,
    fs:    float = SAMPLING_RATE_HZ,
) -> np.ndarray:
    n_ch = epoch.shape[0]
    n_psd, n_de, n_td = len(BAND_NAMES), len(BAND_NAMES), 5
    n_per_ch = n_psd + n_de + n_td          # 15 features per channel

    features = np.empty(n_ch * n_per_ch, dtype=np.float32)

    # PSD block: all channels sequentially
    psd_offset = 0
    for ch in range(n_ch):
        features[psd_offset + ch * n_psd : psd_offset + (ch + 1) * n_psd] = \
            psd_band_power(epoch[ch], fs)

    # DE block
    de_offset = n_ch * n_psd
    for ch in range(n_ch):
        features[de_offset + ch * n_de : de_offset + (ch + 1) * n_de] = \
            differential_entropy(epoch[ch], fs)

    # Time-domain block
    td_offset = n_ch * (n_psd + n_de)
    for ch in range(n_ch):
        features[td_offset + ch * n_td : td_offset + (ch + 1) * n_td] = \
            time_domain_stats(epoch[ch])

    return features


def extract_student_epoch_extended(
    epoch_2ch: np.ndarray,
    fs: float = SAMPLING_RATE_HZ,
) -> np.ndarray:
    """
    Extended 76-dim student feature vector for a 2-channel (T7+T8) epoch.

    Layout
    ------
    [0:30]   base features  (PSD+DE+Hjorth, 15 per channel)
    [30:50]  spectral extended  (10 per channel)
    [50:60]  nonlinear  (5 per channel)
    [60:76]  connectivity  (16 for T7+T8 pair)
    """
    assert epoch_2ch.shape[0] == 2, f"Expected 2 channels, got {epoch_2ch.shape[0]}"

    # Base (same as extract_epoch_features)
    base = extract_epoch_features(epoch_2ch, fs)                  # (30,)

    # Extended spectral + nonlinear per channel
    sp0  = spectral_extended_features(epoch_2ch[0], fs)           # (10,)
    sp1  = spectral_extended_features(epoch_2ch[1], fs)           # (10,)
    nl0  = nonlinear_features(epoch_2ch[0], fs)                   # (5,)
    nl1  = nonlinear_features(epoch_2ch[1], fs)                   # (5,)

    # Connectivity
    conn = connectivity_features_2ch(epoch_2ch, fs)               # (16,)

    return np.concatenate([base, sp0, sp1, nl0, nl1, conn]).astype(np.float32)


def extract_student_batch_extended(
    X_student: np.ndarray,
    fs: float = SAMPLING_RATE_HZ,
) -> np.ndarray:
    """Batch extract 76-dim extended features from (E, 2, W) student epochs."""
    E = X_student.shape[0]
    F = np.empty((E, N_STUDENT_FEAT_EXT), dtype=np.float32)
    log_every = max(1, E // 10)
    print(f"  Extended student features: {E} epochs -> {N_STUDENT_FEAT_EXT} features …")
    for e in range(E):
        F[e] = extract_student_epoch_extended(X_student[e], fs)
        if (e + 1) % log_every == 0 or e == E - 1:
            print(f"    {e+1:>5d} / {E}  ({(e+1)/E*100:.0f}%)", end='\r')
    print(f"    {E} / {E}  (100%)  done           ")
    return F


# ─────────────────────────────────────────────
#  BATCH EXTRACTION
# ─────────────────────────────────────────────

def extract_features_batch(
    X:   np.ndarray,
    fs:  float = SAMPLING_RATE_HZ,
    tag: str   = '',
) -> np.ndarray:
    E, n_ch, W     = X.shape
    n_per_ch       = len(BAND_NAMES) * 2 + 5   # psd + de + td = 15
    n_features     = n_ch * n_per_ch
    F              = np.empty((E, n_features), dtype=np.float32)

    print(f"  Extracting {tag} features: {E} epochs × {n_ch} ch "
          f"→ {n_features} features/epoch …")

    log_every = max(1, E // 10)
    for e in range(E):
        F[e] = extract_epoch_features(X[e], fs)
        if (e + 1) % log_every == 0 or e == E - 1:
            print(f"    {e+1:>5d} / {E}  ({(e+1)/E*100:.0f}%)", end='\r')

    print(f"    {E} / {E}  (100%)  done           ")
    return F


# ─────────────────────────────────────────────
#  VERIFICATION
# ─────────────────────────────────────────────

def verify_features(
    F:             np.ndarray,
    feature_names: List[str],
    tag:           str = '',
) -> Dict:

    n_nan  = int(np.isnan(F).sum())
    n_inf  = int(np.isinf(F).sum())
    f_mean = float(np.nanmean(F))
    f_std  = float(np.nanstd(F))
    f_min  = float(np.nanmin(F))
    f_max  = float(np.nanmax(F))

    # Check by group using feature names
    psd_idx = [i for i, n in enumerate(feature_names) if n.startswith('psd_')]
    de_idx  = [i for i, n in enumerate(feature_names) if n.startswith('de_')]
    td_idx  = [i for i, n in enumerate(feature_names) if n.startswith('td_')]
    mob_idx = [i for i, n in enumerate(feature_names) if 'hjorth_mob' in n]

    stats = {
        'tag'         : tag,
        'shape'       : F.shape,
        'n_nan'       : n_nan,
        'n_inf'       : n_inf,
        'mean'        : f_mean,
        'std'         : f_std,
        'min'         : f_min,
        'max'         : f_max,
        'psd_mean'    : float(np.nanmean(F[:, psd_idx])),
        'de_mean'     : float(np.nanmean(F[:, de_idx])),
        'td_mean'     : float(np.nanmean(F[:, td_idx])),
        'mob_min'     : float(np.nanmin(F[:, mob_idx])) if mob_idx else None,
    }

    print(f"\n  [{tag}] Feature matrix verification")
    print(f"    Shape      : {F.shape}")
    print(f"    NaN        : {n_nan}   Inf : {n_inf}")
    print(f"    Global     : mean={f_mean:+.3f}  std={f_std:.3f}  "
          f"range=[{f_min:.3f}, {f_max:.3f}]")
    print(f"    PSD mean   : {stats['psd_mean']:+.3f}  (log10 band power)")
    print(f"    DE  mean   : {stats['de_mean']:+.3f}  (Gaussian DE)")
    print(f"    TD  mean   : {stats['td_mean']:+.3f}  (time-domain stats)")
    if mob_idx:
        print(f"    Mob min    : {stats['mob_min']:.6f}  (Hjorth mobility > 0 expected)")

    # ── Flat-signal guard ─────────────────────────────────────
    # 100% of PSD values hitting the LOG_EPS floor (-10.0) means
    # the input signals are flat/zero — caused by ICA removing all
    # components. Hard-abort here so corrupt features are never saved.
    psd_floor    = np.log10(LOG_EPS)                          # -10.0
    pct_at_floor = float((F[:, psd_idx] <= psd_floor + 0.001).mean() * 100)
    mob_all_one  = bool(mob_idx and
                        (np.abs(F[:, mob_idx] - 1.0) < 1e-4).mean() > 0.90)
    print(f"    PSD @ floor : {pct_at_floor:.1f}%  (>50% = flat signal, pipeline error)")

    if pct_at_floor > 50 or mob_all_one:
        print(f"\n  FATAL [{tag}]: signals are flat — features are meaningless.")
        print(f"  Cause : ICA removed all components.")
        print(f"  Fix   : Update KURTOSIS_THRESHOLD / FRONTAL_RATIO_THRESHOLD in")
        print(f"          notch_filter_ica.py, then re-run:")
        print(f"            python3 notch_filter_ica.py")
        print(f"            python3 normalisation.py")
        print(f"            python3 feature_extraction.py")
        raise RuntimeError(
            f"[{tag}] {pct_at_floor:.0f}% of PSD features at LOG_EPS floor. "
            "Input signals are flat. Re-run from notch_filter_ica.py."
        )

    return stats


# ─────────────────────────────────────────────
#  NPZ → CSV EXPORT
# ─────────────────────────────────────────────

def export_to_csv(
    npz_path:   Path,
    output_dir: Optional[Path] = None,
) -> Tuple[Path, Path]:
    import pandas as pd

    if output_dir is None:
        output_dir = npz_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n  Loading  {npz_path}")
    data       = np.load(npz_path, allow_pickle=True)
    F_teacher  = data['F_teacher']
    F_student  = data['F_student']
    feat_names = data['feature_names'].tolist()
    y_emo      = data['y_emo']
    y_perc     = data['y_perc']
    source     = data['source']
    trial_idx  = data['trial_idx']
    subject_id = data['subject_id']

    E = F_teacher.shape[0]

    meta = {
        'y_emo'      : y_emo,
        'y_perc'     : y_perc,
        'source'     : source,
        'trial_idx'  : trial_idx,
        'subject_id' : subject_id,
    }

    # ── Teacher CSV ───────────────────────────────────────────
    print(f"  Building teacher DataFrame  ({E} rows × {len(feat_names) + 5} cols) …")
    df_teacher = pd.DataFrame(F_teacher, columns=feat_names)
    for col, arr in meta.items():
        df_teacher[col] = arr

    teacher_csv = output_dir / "features_teacher.csv"
    df_teacher.to_csv(teacher_csv, index=False)
    size_mb = teacher_csv.stat().st_size / 1_048_576
    print(f"  ✓ features_teacher.csv  →  {teacher_csv}")
    print(f"    {df_teacher.shape[0]} rows × {df_teacher.shape[1]} cols  ({size_mb:.1f} MB)")

    # ── Student CSV ───────────────────────────────────────────
    student_feat_names = [n for n in feat_names
                          if n.endswith('_T7') or n.endswith('_T8')]
    print(f"\n  Building student DataFrame  ({E} rows × {len(student_feat_names) + 5} cols) …")
    df_student = pd.DataFrame(F_student, columns=student_feat_names)
    for col, arr in meta.items():
        df_student[col] = arr

    student_csv = output_dir / "features_student.csv"
    df_student.to_csv(student_csv, index=False)
    size_mb = student_csv.stat().st_size / 1_048_576
    print(f"  ✓ features_student.csv  →  {student_csv}")
    print(f"    {df_student.shape[0]} rows × {df_student.shape[1]} cols  ({size_mb:.1f} MB)")

    print(f"\n  Teacher CSV column sample:")
    print(f"    first 3 : {list(df_teacher.columns[:3])}")
    print(f"    last  5 : {list(df_teacher.columns[-5:])}")
    print(f"\n  Student CSV column sample:")
    print(f"    first 3 : {list(df_student.columns[:3])}")
    print(f"    last  5 : {list(df_student.columns[-5:])}")

    return teacher_csv, student_csv


# ─────────────────────────────────────────────
#  FULL PIPELINE ENTRY POINT
# ─────────────────────────────────────────────

def frontal_de_asymmetry(
    X_teacher: np.ndarray,
    feature_names: List[str],
    fs: float = SAMPLING_RATE_HZ,
) -> Tuple[np.ndarray, List[str]]:
    """
    Compute frontal DE asymmetry features for perceived stress detection.

    Prefrontal alpha asymmetry (Fp1 - Fp2) is the strongest neural marker
    of sustained perceived stress. Left frontal alpha suppression relative
    to right correlates with negative affect and chronic stress load — it
    cannot be captured from T7/T8 alone and is exclusive to the 32-channel
    teacher representation.

    Features computed (per epoch, teacher only):
      de_alpha_asym  : DE_alpha(Fp1) − DE_alpha(Fp2)
                       positive = left-dominant (stressed)
      de_delta_asym  : DE_delta(Fp1) − DE_delta(Fp2)
                       delta asymmetry correlates with sustained cognitive load
      de_alpha_asym_AF : DE_alpha(AF3) − DE_alpha(AF4)
                         secondary frontal asymmetry check

    Parameters
    ----------
    X_teacher    : (E, 480) teacher feature matrix
    feature_names: (480,) ordered feature name list
    fs           : sampling rate (unused here, kept for API consistency)

    Returns
    -------
    F_asym       : (E, 3) float32  — three asymmetry features per epoch
    asym_names   : list of 3 feature name strings
    """
    name_to_idx = {n: i for i, n in enumerate(feature_names)}

    pairs = [
        ("de_alpha_asym_Fp",  "de_alpha_Fp1",  "de_alpha_Fp2"),
        ("de_delta_asym_Fp",  "de_delta_Fp1",  "de_delta_Fp2"),
        ("de_alpha_asym_AF",  "de_alpha_AF3",  "de_alpha_AF4"),
    ]

    asym_cols = []
    asym_names = []
    for name, left, right in pairs:
        if left in name_to_idx and right in name_to_idx:
            col = (X_teacher[:, name_to_idx[left]] -
                   X_teacher[:, name_to_idx[right]]).astype(np.float32)
        else:
            col = np.zeros(len(X_teacher), dtype=np.float32)
            print(f"  [Warning] {left} or {right} not found — asymmetry set to 0")
        asym_cols.append(col)
        asym_names.append(name)

    F_asym = np.column_stack(asym_cols)   # (E, 3)
    print(f"  Frontal DE asymmetry: {F_asym.shape}  "
          f"features: {asym_names}")
    print(f"  alpha_asym(Fp): mean={F_asym[:,0].mean():.4f}  "
          f"std={F_asym[:,0].std():.4f}")
    return F_asym, asym_names


def check_label_correlation(
    y_emo: np.ndarray,
    y_perc: np.ndarray,
    source: np.ndarray,
) -> Dict[str, object]:
    """
    Compute per-dataset label correlation and classify y_perc label quality.

    Cases
    -----
    r = nan   : y_perc is constant (zero variance) — no perceived stress
                labels exist for this dataset. SAM40 with enable_sam40_perceived=False
                has y_perc = -1 sentinel → exclude from perceived stress training.
    r > 0.5   : y_perc ≈ y_emo — labels are not independent; perceived
                stress head will learn the same thing as emotional stress.
    r < 0.3   : labels are genuinely independent — both heads are useful.

    Returns
    -------
    dict mapping source → {'r': float, 'status': str, 'has_perc_labels': bool}
    """
    print(f"\n  Label correlation check:")
    print(f"  {'Dataset':<10} {'r':>8}  {'y_perc pos':>12}  Status")
    print(f"  {'─'*58}")
    results = {}

    for src in ["deap", "sam40", "combined"]:
        m = (np.ones(len(y_emo), dtype=bool) if src == "combined"
             else np.array([str(s).lower() == src for s in source]))
        if m.sum() < 10:
            continue

        ye = y_emo[m].astype(float)
        # Exclude -1 sentinels (SAM40) before computing correlation
        valid_m  = y_perc[m] >= 0
        yp       = y_perc[m][valid_m].astype(float)
        ye_valid = ye[valid_m]
        pos_count = int(yp.sum())
        pos_rate  = float(yp.mean()) if len(yp) > 0 else 0.0

        # Guard: if y_perc is constant (all 0 or all 1), corr = nan
        ye = ye_valid  # use valid (non-sentinel) subset for correlation
        if len(yp) == 0 or yp.std() < 1e-9:
            r = float("nan")
            if pos_count == 0:
                status = "NO LABELS — y_perc all-zero, exclude from perc training"
                has_labels = False
            else:
                status = "CONSTANT POSITIVE — all epochs stressed"
                has_labels = True
        else:
            r = float(np.corrcoef(ye, yp)[0, 1])
            if abs(r) > 0.5:
                status = "HIGH CORR — y_perc ≈ y_emo, not independent"
                has_labels = True
            elif abs(r) > 0.3:
                status = "MODERATE CORR — partially independent"
                has_labels = True
            else:
                status = "LOW CORR — genuinely independent labels ✓"
                has_labels = True

        r_str = f"{r:+.4f}" if not np.isnan(r) else "   nan"
        print(f"  {src:<10} {r_str:>8}  {pos_count:>6} ({pos_rate:.1%})  {status}")
        results[src] = {"r": r, "status": status, "has_perc_labels": has_labels,
                         "pos_count": pos_count, "pos_rate": pos_rate}

    # Key finding for training decisions
    sam40_res = results.get("sam40", {})
    if not sam40_res.get("has_perc_labels", True):
        print(f"\n  ACTION: SAM40 y_perc = -1 sentinel (enable_sam40_perceived=False).")
        print(f"          → SAM40 contributes to y_emo head only (DEAP+SAM40 combined)")
        print(f"          → SAM40 MASKED from y_perc hard+soft loss")
        print(f"          → Re-run labeling with enable_sam40_perceived=True to include SAM40 trial-progression labels")
    deap_r = results.get("deap", {}).get("r", float("nan"))
    if not np.isnan(deap_r) and deap_r < 0.5:
        print(f"\n  DEAP r = {deap_r:+.4f} → emotional and perceived stress")
        print(f"  are independent signals. Dual-head training is well-founded.")
    print()
    return results


def run_feature_extraction_pipeline(
    input_npz:  Path,
    output_npz: Optional[Path] = None,
    fs:         float          = SAMPLING_RATE_HZ,
    verify:     bool           = True,
) -> Dict[str, np.ndarray]:
    """
    Extract PSD, DE and Hjorth features from normalised EEG epochs.

    Parameters
    ----------
    input_npz  : Path   Path to normalized_dataset.npz.
    output_npz : Path   Defaults to unified_output/features_dataset.npz.
    fs         : float  Sampling rate Hz (default 256.0).
    verify     : bool   Print feature matrix statistics after extraction.

    Returns
    -------
    dict with keys:
        'F_teacher'     : (E, 480)   teacher feature matrix
        'F_student'     : (E,  30)   student feature matrix (T7+T8)
        'feature_names' : (480,)     feature label per column
        'y_emo'         : (E,)
        'y_perc'        : (E,)
        'source'        : (E,)
        'trial_idx'     : (E,)
        'subject_id'    : (E,)
    """
    if output_npz is None:
        output_npz = UNIFIED_OUTPUT_DIR / "features_dataset.npz"

    output_npz.parent.mkdir(parents=True, exist_ok=True)

    n_bands     = len(BAND_NAMES)
    n_stats     = 5
    n_per_ch    = n_bands * 2 + n_stats           # 15
    n_feat_32   = 32 * n_per_ch                   # 480
    n_feat_2    = 2  * n_per_ch                   # 30

    print("\n" + "=" * 62)
    print("  FEATURE EXTRACTION PIPELINE")
    print(f"  Bands    : δ θ α β γ  →  {n_bands} bands")
    print(f"  Features : PSD (log) + DE (Gaussian) + TD (mean/var/Hjorth)")
    print(f"  Teacher  : {n_feat_32} features / epoch  (32 ch × {n_per_ch})")
    print(f"  Student  : {n_feat_2}  features / epoch  (2 ch × {n_per_ch})")
    print("=" * 62)

    # ── [1] Load ───────────────────────────────────────────────
    print(f"\n[1] Loading  {input_npz}")
    data        = np.load(input_npz, allow_pickle=True)
    X_teacher   = data['X_teacher'].astype(np.float32)   # (E, 32, W)
    X_student   = data['X_student'].astype(np.float32)   # (E,  2, W)
    y_emo       = data['y_emo']
    y_perc      = data['y_perc']
    source      = data['source']
    trial_idx   = data['trial_idx']
    subject_id  = data['subject_id']
    y_pre_stage = (data['y_pre_stage'] if 'y_pre_stage' in data
                   else ((y_emo == 1) & (y_perc == 0)).astype(np.int32))

    E, _, W = X_teacher.shape
    print(f"    X_teacher   : {X_teacher.shape}")
    print(f"    X_student   : {X_student.shape}")
    print(f"    Epoch W={W} samples = {W/fs:.2f} s @ {fs} Hz")
    print(f"    Sources     : {np.unique(source)}")

    deap_m  = np.array([str(s).lower() == 'deap'  for s in source])
    sam40_m = np.array([str(s).lower() == 'sam40' for s in source])
    print(f"  DEAP  : {deap_m.sum():,} epochs  ({len(np.unique(subject_id[deap_m]))} subjects)")
    sam40_valid_perc = int((y_perc[sam40_m] >= 0).sum())
    print(f"  SAM40 : {sam40_m.sum():,} epochs  ({len(np.unique(subject_id[sam40_m]))} subjects)  y_perc valid: {sam40_valid_perc:,}")
    print(f"  Total : {len(X_teacher):,} epochs for emo head")
    print(f"  y_emo       balance : {y_emo.mean():.2%}  (DEAP+SAM40)")
    yp_valid = y_perc[y_perc >= 0]
    print(f"  y_perc      balance : {yp_valid.mean():.2%}  (DEAP + SAM40, {len(yp_valid):,} labeled epochs)")
    print(f"  y_pre_stage balance : {y_pre_stage.mean():.2%}  pos={int(y_pre_stage.sum()):,}  (build-up phase)")

    # ── [2] Build feature names ────────────────────────────────
    teacher_feat_names = build_feature_names(EEG_CHANNELS)
    student_feat_names = build_feature_names(STUDENT_CHANNEL_NAMES)
    assert len(teacher_feat_names) == n_feat_32, \
        f"Expected {n_feat_32} teacher feature names, got {len(teacher_feat_names)}"

    # ── [3] Extract teacher features ──────────────────────────
    print(f"\n[2] Teacher feature extraction  (32 ch × {n_per_ch} = {n_feat_32} features) …")
    F_teacher = extract_features_batch(X_teacher, fs, tag='teacher')

    # ── [4] Extract student features ──────────────────────────
    print(f"\n[3] Student base feature extraction  (2 ch × {n_per_ch} = {n_feat_2} features) …")
    F_student = extract_features_batch(X_student, fs, tag='student')

    # ── [4b] Extract extended student features ────────────────
    print(f"\n[3b] Student extended feature extraction  ({N_STUDENT_FEAT_EXT} features) …")
    print(f"     Base(30) + SpectralExt(20) + Nonlinear(10) + Connectivity(16)")
    F_student_ext = extract_student_batch_extended(X_student, fs)

    # ── [5] Verification ──────────────────────────────────────
    student_ext_names = build_student_feature_names_extended()
    if verify:
        print(f"\n[4] Verification …")
        verify_features(F_teacher, teacher_feat_names, tag='teacher')
        verify_features(F_student, student_feat_names, tag='student')
        nan_ext = int(np.isnan(F_student_ext).sum())
        inf_ext = int(np.isinf(F_student_ext).sum())
        print(f"  [student_ext] shape={F_student_ext.shape}  NaN={nan_ext}  Inf={inf_ext}")

    # ── [6] Save NPZ ───────────────────────────────────────────
    print(f"\n[5] Saving NPZ  →  {output_npz}")
    # Compute frontal asymmetry (teacher only — T7/T8 student cannot see frontal)
    print(f"\n[compute] Frontal DE asymmetry features ...")
    check_label_correlation(y_emo, y_perc, source)
    F_frontal_asym, asym_names = frontal_de_asymmetry(F_teacher, teacher_feat_names)

    np.savez(
        output_npz,
        F_teacher               = F_teacher,
        F_student               = F_student,
        F_student_ext           = F_student_ext,
        F_frontal_asym          = F_frontal_asym,
        feature_names           = np.array(teacher_feat_names),
        student_feat_names_ext  = np.array(student_ext_names),
        frontal_asym_names      = np.array(asym_names),
        y_emo                   = y_emo,
        y_perc                  = y_perc,
        y_pre_stage             = y_pre_stage,
        source                  = source,
        trial_idx               = trial_idx,
        subject_id              = subject_id,
    )

    # ── [7] Export CSV ─────────────────────────────────────────
    print(f"\n[6] Exporting CSV …")
    export_to_csv(output_npz, output_dir=output_npz.parent)

    # ── Summary ────────────────────────────────────────────────
    print("\n" + "=" * 62)
    print("  OUTPUT SUMMARY")
    print("=" * 62)
    print(f"  F_teacher     : {F_teacher.shape}  dtype={F_teacher.dtype}")
    print(f"  F_frontal_asym: {F_frontal_asym.shape}  (de_alpha/delta asymmetry Fp1-Fp2, AF3-AF4)")
    print(f"  F_student     : {F_student.shape}    dtype={F_student.dtype}  (base 30-dim)")
    print(f"  F_student_ext : {F_student_ext.shape}  dtype={F_student_ext.dtype}  (extended 76-dim)")
    print(f"  feature_names : {len(teacher_feat_names)} labels")
    print(f"  y_emo         : {y_emo.shape}  pos={int(y_emo.sum())}  neg={int((y_emo==0).sum())}")
    print(f"  y_pre_stage   : {y_pre_stage.shape}  pos={int(y_pre_stage.sum())}  "
          f"({y_pre_stage.mean():.1%})  ← pre-stage stress target")
    print(f"  y_perc        : {y_perc.shape}  pos={int(y_perc.sum())}  neg={int((y_perc==0).sum())}")
    print(f"  source        : {np.unique(source)}")
    print(f"  subject_id    : {len(np.unique(subject_id))} unique subjects")
    print(f"\n  Feature layout per channel (×{n_per_ch}):")
    print(f"    PSD band power  : {n_bands} (δ θ α β γ)  — log10 Welch integrated")
    print(f"    Differential DE : {n_bands} (δ θ α β γ)  — Gaussian 0.5·log(2πe·σ²)")
    print(f"    Time-domain     : {n_stats} (mean var hjorth_act mob cmp)")
    print(f"\n  Sample teacher names  : {teacher_feat_names[:3]} …")
    print(f"  Sample student names  : {student_feat_names[:3]} …")
    print(f"\n  Files saved to  : {output_npz.parent}")
    print(f"    features_dataset.npz")
    print(f"    features_teacher.csv")
    print(f"    features_student.csv")
    print(f"\n  Next step → model training")
    print("=" * 62 + "\n")

    return {
        'F_teacher'         : F_teacher,
        'F_student'         : F_student,
        'F_student_ext'     : F_student_ext,
        'feature_names'     : np.array(teacher_feat_names),
        'student_ext_names' : np.array(student_ext_names),
        'y_emo'             : y_emo,
        'y_perc'            : y_perc,
        'y_pre_stage'       : y_pre_stage,
        'source'            : source,
        'trial_idx'         : trial_idx,
        'subject_id'        : subject_id,
    }


# ─────────────────────────────────────────────
#  SELF-TEST  (python feature_extraction.py)
# ─────────────────────────────────────────────

def _make_synthetic_normalized_npz(
    out_dir:      Path,
    n_epochs:     int   = 200,
    n_ch_teacher: int   = 32,
    W:            int   = 256,
) -> Path:
    """
    Write a synthetic normalized_dataset.npz that mirrors the output of
    normalisation.py.  Signals contain:
      · Multi-band neural oscillations (visible in PSD and DE)
      · Different amplitude per source (inter-subject variance)
      · DC-centred (mean ≈ 0) as expected after z-score normalisation
    """
    rng = np.random.default_rng(99)
    t   = np.arange(W) / SAMPLING_RATE_HZ

    def epoch_signal(amp: float = 1.0) -> np.ndarray:
        return (amp * (
            0.8 * np.sin(2 * np.pi *  2 * t) +     # delta
            0.6 * np.sin(2 * np.pi *  6 * t) +     # theta
            0.5 * np.sin(2 * np.pi * 10 * t) +     # alpha
            0.3 * np.sin(2 * np.pi * 20 * t) +     # beta
            0.2 * np.sin(2 * np.pi * 38 * t) +     # gamma
            0.1 * rng.standard_normal(W)
        )).astype(np.float32)

    X_teacher_list, source_list, trial_list = [], [], []
    subj_list, y_emo_list, y_perc_list      = [], [], []

    for e in range(n_epochs):
        is_deap     = e < n_epochs // 2
        src         = 'deap' if is_deap else 'sam40'
        amp         = 1.0 if is_deap else 1.2
        trial       = e // 19                                   # ~19 epochs/trial
        subj        = trial // (40 if is_deap else 12)
        subj_offset = 0 if is_deap else 32

        ep  = np.stack([epoch_signal(amp) for _ in range(n_ch_teacher)])
        X_teacher_list.append(ep)
        source_list.append(src)
        trial_list.append(trial)
        subj_list.append(subj + subj_offset)
        y_emo_list.append(int(rng.integers(0, 2)))
        y_perc_list.append(int(rng.integers(0, 2)))

    X_teacher   = np.stack(X_teacher_list)
    X_student   = X_teacher[:, [T7_INDEX, T8_INDEX], :]
    y_emo       = np.array(y_emo_list,  dtype=np.int32)
    y_perc      = np.array(y_perc_list, dtype=np.int32)
    y_pre_stage = ((y_emo == 1) & (y_perc == 0)).astype(np.int32)
    source      = np.array(source_list)
    trial_idx   = np.array(trial_list,  dtype=np.int32)
    subject_id  = np.array(subj_list,   dtype=np.int32)

    npz_path = out_dir / "normalized_dataset.npz"
    np.savez(npz_path,
             X_teacher=X_teacher, X_student=X_student,
             y_emo=y_emo, y_perc=y_perc, y_pre_stage=y_pre_stage,
             source=source, trial_idx=trial_idx, subject_id=subject_id)

    print(f"  Synthetic normalized_dataset.npz → {npz_path}")
    print(f"    X_teacher : {X_teacher.shape}  (multi-band neural + noise)")
    return npz_path


if __name__ == '__main__':
    import tempfile, argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--test', action='store_true',
                        help='Run on synthetic data instead of real data')
    args = parser.parse_args()

    real_input = UNIFIED_OUTPUT_DIR / "normalized_dataset.npz"

    if args.test:
        print("=" * 62)
        print("  FEATURE EXTRACTION — SELF-TEST (synthetic data)")
        print("=" * 62)
        with tempfile.TemporaryDirectory() as tmp:
            syn_dir = Path(tmp) / "unified_output"
            syn_dir.mkdir()
            print("\n[0] Generating synthetic normalized_dataset.npz …")
            input_npz = _make_synthetic_normalized_npz(syn_dir, n_epochs=60)
            result = run_feature_extraction_pipeline(input_npz=input_npz, verify=True)
            F_t = result['F_teacher']
            F_s = result['F_student']
            n_per_ch = len(BAND_NAMES) * 2 + 5
            checks = {
                f'F_teacher cols == {32*n_per_ch}' : F_t.shape[1] == 32*n_per_ch,
                f'F_student cols == {2*n_per_ch}'  : F_s.shape[1] == 2*n_per_ch,
                'No NaN'                            : bool(~np.isnan(F_t).any()),
                'No Inf'                            : bool(~np.isinf(F_t).any()),
            }
            for desc, ok in checks.items():
                print(f"  {desc:<38s}: {'OK  ✓' if ok else 'FAIL ✗'}")
            print("\n  Self-test complete.\n")
            sys.exit(0 if all(checks.values()) else 1)

    elif real_input.exists():
        print("=" * 62)
        print("  FEATURE EXTRACTION — REAL DATA")
        print("=" * 62)
        run_feature_extraction_pipeline(input_npz=real_input, verify=True)

    else:
        print(f"\n  ERROR: input not found:\n    {real_input}")
        print("  Run normalisation.py first, or use --test for synthetic data.\n")
        sys.exit(1)