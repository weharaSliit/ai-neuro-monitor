# ============================================================
# extract_features.py
# Converts raw ring sensor data into the 23 features
# expected by the XGBoost model.
#
# Called by /predict endpoint when real IoT ring
# sends raw sensor arrays instead of pre-extracted features.
#
# Input:
#   ibi_array        : RR intervals in ms (from MAX30102)
#   gsr_array        : raw ADC values 0-4095 (from Grove GSR)
#   acc_array        : acceleration magnitude in g (from MPU-6050)
#   gsr_calibration  : per-sensor calibration value from setup
#
# Output:
#   np.array shape (1, 23) in exact feature_cols order:
#   [AVNN, MeanHR, SDHR, pNN20, SD1,
#    SCL_mean, SCL_slope, EDA_mean, EDA_slope, EDA_std,
#    SCR_count, SCR_amp_mean, SCR_width_mean,
#    EDA_q10, EDA_q75, EDA_q90, EDA_range,
#    deriv1_std, deriv2_mean,
#    wavelet_d1_energy, wavelet_d3_energy,
#    ACC_mean, ACC_std]
#
# SCL_slope added on top of the original literature-validated 22
# (see notebooks/04_feature_selection.ipynb) — rate of change of
# tonic skin conductance, a validated stress-onset indicator
# (Kyriakou et al. 2019; Segono et al. 2026) not captured by any
# of the original 22.
# ============================================================

import numpy as np
from scipy import signal
import pywt


# ── Feature column order must match training exactly ─────────
# This is the exact order from feature_cols_obj1_v2.pkl
FEATURE_COLS = [
    'AVNN', 'MeanHR', 'SDHR', 'pNN20', 'SD1',
    'SCL_mean', 'SCL_slope', 'EDA_mean', 'EDA_slope', 'EDA_std',
    'SCR_count', 'SCR_amp_mean', 'SCR_width_mean',
    'EDA_q10', 'EDA_q75', 'EDA_q90', 'EDA_range',
    'deriv1_std', 'deriv2_mean',
    'wavelet_d1_energy', 'wavelet_d3_energy',
    'ACC_mean', 'ACC_std'
]


# ── GSR conversion ────────────────────────────────────────────
def adc_to_conductance(adc_array, gsr_calibration):
    """
    Convert Grove GSR raw ADC readings to skin conductance (uS).

    Grove GSR measures RESISTANCE not conductance.
    Formula from Seeed documentation:
      Resistance (ohm) = ((1024 + 2 * ADC) * 10000) / (calibration - ADC)

    We then convert to conductance:
      Conductance (uS) = 1,000,000 / Resistance

    Parameters:
        adc_array       : raw ADC values (0-4095, 12-bit ESP32)
        gsr_calibration : calibration value from setup step
                          (ADC reading when electrodes not worn,
                           potentiometer adjusted to minimum)

    Returns:
        conductance_us : array of conductance values in microsiemens
    """
    adc_array = np.array(adc_array, dtype=np.float64)

    # Grove formula uses 10-bit scale (0-1023)
    # ESP32 ADC is 12-bit (0-4095) so scale down
    adc_10bit = adc_array / 4.0
    cal_10bit = gsr_calibration / 4.0

    # Avoid division by zero
    denominator = cal_10bit - adc_10bit
    denominator = np.where(np.abs(denominator) < 1, 1, denominator)

    resistance_ohm = ((1024 + 2 * adc_10bit) * 10000) / denominator

    # Avoid negative resistance (happens if ADC > calibration)
    resistance_ohm = np.where(resistance_ohm <= 0, 1e6, resistance_ohm)

    # Convert to microsiemens (1 uS = 1/1,000,000 ohm)
    conductance_us = 1_000_000.0 / resistance_ohm

    return conductance_us


# ── GSR preprocessing ─────────────────────────────────────────
def preprocess_gsr(conductance_us, fs=50):
    """
    Preprocess raw conductance signal into tonic (SCL) and
    phasic (SCR) components.

    fs varies by source: WESAD-style pipelines assumed 50Hz;
    the real ring publishes over MQTT at ~5Hz. Filter cutoffs
    below are clamped to a safe fraction of Nyquist so this
    doesn't break at low fs (a fixed 5Hz low-pass is invalid
    once fs drops to anything under ~10Hz).

    Matches WESAD preprocessing pipeline:
      1. IQR outlier removal
      2. Linear detrend
      3. Butterworth low-pass 5Hz
      4. High-pass 0.05Hz → SCR (phasic)
      5. Subtraction → SCL (tonic)
      6. First and second derivatives
      7. Haar wavelet decomposition

    Parameters:
        conductance_us : array of conductance in uS
        fs             : sampling rate in Hz (default 50)

    Returns:
        dict with keys: filtered, tonic, phasic,
                        deriv1, deriv2, wavelets
    """
    eda = np.array(conductance_us, dtype=np.float64)

    # Step 1 — IQR outlier removal
    q1, q3 = np.percentile(eda, [25, 75])
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    # Replace outliers with nearest valid value
    eda_clean = np.clip(eda, lower, upper)

    # Step 2 — Linear detrend (removes electrode drift only)
    # We detrend to remove drift but preserve absolute level
    # by adding back the mean of the original clean signal
    from scipy.signal import detrend
    eda_mean_original = np.mean(eda_clean)
    eda_detrend = detrend(eda_clean) + eda_mean_original

    # Step 3 — Butterworth low-pass filter, target 5Hz but
    # clamped below Nyquist so low actual_fs (e.g. ring's ~5Hz)
    # doesn't produce an invalid Wn >= 1
    nyq = fs / 2.0
    lp_cutoff_hz = min(5.0, nyq * 0.8)
    b_lp, a_lp = signal.butter(4, lp_cutoff_hz / nyq, btype='low')
    eda_filtered = signal.filtfilt(b_lp, a_lp, eda_detrend)

    # Step 4 — High-pass, target 0.05Hz → SCR (phasic component)
    hp_cutoff_hz = min(0.05, nyq * 0.1)
    b_hp, a_hp = signal.butter(4, hp_cutoff_hz / nyq, btype='high')
    eda_phasic = signal.filtfilt(b_hp, a_hp, eda_filtered)

    # Step 5 — SCL (tonic) = filtered minus phasic
    # This preserves absolute conductance level for SCL_mean
    eda_tonic = eda_filtered - eda_phasic

    # Step 6 — Derivatives
    deriv1 = np.gradient(eda_filtered)
    deriv2 = np.gradient(deriv1)

    # Step 7 — Haar wavelet 5-level decomposition
    coeffs = pywt.wavedec(eda_filtered, 'haar', level=5)
    # coeffs[0] = approximation, coeffs[1..5] = details d1..d5

    return {
        'filtered': eda_filtered,
        'tonic':    eda_tonic,
        'phasic':   eda_phasic,
        'deriv1':   deriv1,
        'deriv2':   deriv2,
        'wavelets': coeffs
    }


# ── SCR peak detection ────────────────────────────────────────
def detect_scr_peaks(phasic_signal, fs=50,
                     min_amplitude=0.01,
                     min_width_sec=1.0):
    """
    Detect skin conductance response (SCR) peaks in phasic signal.

    Returns:
        scr_count      : number of SCR events per minute
        scr_amp_mean   : mean peak amplitude in uS
        scr_width_mean : mean peak width in seconds
    """
    min_width_samples = int(min_width_sec * fs)

    # Find peaks with minimum amplitude and width
    peaks, properties = signal.find_peaks(
        phasic_signal,
        height=min_amplitude,
        width=min_width_samples
    )

    if len(peaks) == 0:
        return 0.0, 0.0, 0.0

    # Duration of signal in minutes
    duration_min = len(phasic_signal) / fs / 60.0

    scr_count = len(peaks) / duration_min  # per minute
    scr_amp_mean = float(np.mean(phasic_signal[peaks]))

    # Width in seconds
    widths_samples = properties['widths']
    scr_width_mean = float(np.mean(widths_samples) / fs)

    return scr_count, scr_amp_mean, scr_width_mean


# ── HRV feature extraction ────────────────────────────────────
def extract_hrv_features(ibi_array):
    """
    Extract 5 HRV features from IBI array.

    Matches WESAD preprocessing:
      - Hard physiological limit 300-2000ms applied
      - Median-based contextual outlier removal ±20%

    Features extracted:
      AVNN  : mean RR interval (ms)
      MeanHR: mean heart rate (bpm)
      SDHR  : std of heart rate (bpm)
      pNN20 : proportion of successive differences > 20ms
      SD1   : short-term HRV (Poincaré plot)

    Parameters:
        ibi_array : list of RR intervals in ms

    Returns:
        (dict with HRV features, is_fallback: bool) -- is_fallback is True
        when there wasn't enough clean IBI data and the dict below is a
        fixed placeholder rather than a real reading. Callers must not feed
        a fallback dict to the model as if it were real (see /predict's
        hrv_fallback rejection in app.py) -- this used to be silent, which
        let a noisy/short window produce a confident-looking prediction
        built on fabricated numbers.
    """
    ibi = np.array(ibi_array, dtype=np.float64)

    # Hard physiological limit
    ibi = ibi[(ibi >= 300) & (ibi <= 2000)]

    if len(ibi) < 4:
        # Not enough data — return safe defaults, flagged as such
        return {
            'AVNN': 800.0, 'MeanHR': 75.0, 'SDHR': 5.0,
            'pNN20': 0.1, 'SD1': 30.0
        }, True

    # Contextual outlier removal ±20% of local median
    ibi_clean = []
    for i in range(len(ibi)):
        start = max(0, i - 2)
        end   = min(len(ibi), i + 3)
        local_median = np.median(ibi[start:end])
        if abs(ibi[i] - local_median) / local_median <= 0.20:
            ibi_clean.append(ibi[i])

    ibi = np.array(ibi_clean, dtype=np.float64)

    if len(ibi) < 4:
        return {
            'AVNN': 800.0, 'MeanHR': 75.0, 'SDHR': 5.0,
            'pNN20': 0.1, 'SD1': 30.0
        }, True

    # AVNN — mean RR interval
    avnn = float(np.mean(ibi))

    # Heart rate per beat
    hr_per_beat = 60000.0 / ibi  # bpm per beat
    mean_hr = float(np.mean(hr_per_beat))
    sdhr    = float(np.std(hr_per_beat))

    # pNN20 — proportion of successive differences > 20ms
    successive_diffs = np.abs(np.diff(ibi))
    pnn20 = float(np.sum(successive_diffs > 20) /
                  len(successive_diffs)) if len(successive_diffs) > 0 else 0.0

    # SD1 — short-term Poincaré plot HRV
    # SD1 = std of (IBI[n+1] - IBI[n]) / sqrt(2)
    sd1 = float(np.std(np.diff(ibi)) / np.sqrt(2))

    return {
        'AVNN':   avnn,
        'MeanHR': mean_hr,
        'SDHR':   sdhr,
        'pNN20':  pnn20,
        'SD1':    sd1
    }, False


# ── GSR feature extraction ────────────────────────────────────
def extract_gsr_features(gsr_components, fs=50):
    """
    Extract 16 GSR features from preprocessed components.

    Features:
      SCL_mean, SCL_slope, EDA_mean, EDA_slope, EDA_std  (tonic/overall)
      SCR_count, SCR_amp_mean, SCR_width_mean            (phasic)
      EDA_q10, EDA_q75, EDA_q90, EDA_range               (statistical)
      deriv1_std, deriv2_mean                            (derivatives)
      wavelet_d1_energy, wavelet_d3_energy               (wavelet)
    """
    filtered = gsr_components['filtered']
    tonic    = gsr_components['tonic']
    phasic   = gsr_components['phasic']
    deriv1   = gsr_components['deriv1']
    deriv2   = gsr_components['deriv2']
    wavelets = gsr_components['wavelets']

    # Tonic features
    scl_mean = float(np.mean(tonic))
    eda_mean = float(np.mean(filtered))
    eda_std  = float(np.std(filtered))
    eda_range = float(np.max(filtered) - np.min(filtered))

    # EDA slope — linear trend of filtered signal
    x = np.arange(len(filtered))
    if len(filtered) > 1:
        slope_coeffs = np.polyfit(x, filtered, 1)
        eda_slope = float(slope_coeffs[0])
    else:
        eda_slope = 0.0

    # SCL slope — linear trend of the tonic component specifically
    # (rate of change of skin conductance level — a rising slope is
    # a validated stress-onset indicator, distinct from EDA_slope
    # which trends the whole filtered signal including phasic bursts)
    if len(tonic) > 1:
        scl_slope_coeffs = np.polyfit(x, tonic, 1)
        scl_slope = float(scl_slope_coeffs[0])
    else:
        scl_slope = 0.0

    # Statistical features
    eda_q10 = float(np.percentile(filtered, 10))
    eda_q75 = float(np.percentile(filtered, 75))
    eda_q90 = float(np.percentile(filtered, 90))

    # Phasic SCR features — fs must match the actual sampling
    # rate or peak width / per-minute count come out wrong
    scr_count, scr_amp_mean, scr_width_mean = \
        detect_scr_peaks(phasic, fs=fs)

    # Derivative features
    deriv1_std  = float(np.std(deriv1))
    deriv2_mean = float(np.mean(deriv2))

    # Wavelet energy features
    # wavelets[0]=approx, [1]=d1, [2]=d2, [3]=d3, [4]=d4, [5]=d5
    wavelet_d1_energy = float(np.sum(wavelets[1] ** 2)) \
        if len(wavelets) > 1 else 0.0
    wavelet_d3_energy = float(np.sum(wavelets[3] ** 2)) \
        if len(wavelets) > 3 else 0.0

    return {
        'SCL_mean':       scl_mean,
        'SCL_slope':      scl_slope,
        'EDA_mean':       eda_mean,
        'EDA_slope':      eda_slope,
        'EDA_std':        eda_std,
        'SCR_count':      scr_count,
        'SCR_amp_mean':   scr_amp_mean,
        'SCR_width_mean': scr_width_mean,
        'EDA_q10':        eda_q10,
        'EDA_q75':        eda_q75,
        'EDA_q90':        eda_q90,
        'EDA_range':      eda_range,
        'deriv1_std':     deriv1_std,
        'deriv2_mean':    deriv2_mean,
        'wavelet_d1_energy': wavelet_d1_energy,
        'wavelet_d3_energy': wavelet_d3_energy
    }


# ── ACC feature extraction ────────────────────────────────────
def extract_acc_features(acc_array):
    """
    Extract 2 ACC features from magnitude array.

    Features:
      ACC_mean : mean acceleration (should be ~0.93g at rest)
      ACC_std  : std of acceleration (higher = more movement)

    Also returns motion_flag for window rejection.
    """
    acc = np.array(acc_array, dtype=np.float64)

    acc_mean = float(np.mean(acc))
    acc_std  = float(np.std(acc))

    # Motion gate — reject window if >10% samples above 1.2g
    motion_contaminated = float(
        np.sum(acc > 1.2) / len(acc)
    ) > 0.10

    return {
        'ACC_mean': acc_mean,
        'ACC_std':  acc_std
    }, motion_contaminated


# ── MAIN FUNCTION ─────────────────────────────────────────────
def extract_features(ibi_array, gsr_adc_array,
                     acc_array, gsr_calibration,
                     actual_fs=50):
    """
    Convert raw ring sensor data into 22 features
    expected by XGBoost model.

    Parameters:
        ibi_array       : list of RR intervals in ms
                          (R-peaks detected on ESP32 from MAX30102)
        gsr_adc_array   : list of raw ADC values 0-4095
                          (Grove GSR — real ring publishes ~5Hz over
                          MQTT, not WESAD's 50Hz; pass the real rate)
        acc_array       : list of acceleration magnitude in g
                          (MPU-6050, same rate as gsr_adc_array)
        gsr_calibration : int, ADC value recorded during setup
                          (potentiometer adjusted, no electrodes)
        actual_fs       : int, real sampling rate of gsr_adc_array/
                          acc_array in Hz. Defaults to 50 (WESAD-like)
                          for backward compatibility with simulation
                          callers — the ring endpoint always passes
                          its measured rate explicitly.

    Returns:
        features_array      : np.array shape (1, 22)
        motion_contaminated : bool, True = reject this window
        feature_dict        : dict {feature_name: value}
                              (for StressStateMachine history)
        hrv_is_fallback     : bool, True = ibi_array had too little clean
                              data and feature_dict's HRV values (AVNN etc.)
                              are fixed placeholders, not a real reading --
                              see extract_hrv_features()'s docstring
    """

    # ── Step 1: Motion check ──────────────────────────────────
    acc_features, motion_contaminated = \
        extract_acc_features(acc_array)

    # ── Step 2: HRV features from IBI ────────────────────────
    hrv_features, hrv_is_fallback = extract_hrv_features(ibi_array)

    # ── Step 3: GSR ADC → conductance ────────────────────────
    conductance_us = adc_to_conductance(
        gsr_adc_array, gsr_calibration
    )

    # ── Step 4: GSR preprocessing ────────────────────────────
    gsr_components = preprocess_gsr(conductance_us, fs=actual_fs)

    # ── Step 5: GSR features ─────────────────────────────────
    gsr_features = extract_gsr_features(gsr_components, fs=actual_fs)

    # ── Step 6: Assemble in exact FEATURE_COLS order ─────────
    feature_dict = {}
    feature_dict.update(hrv_features)
    feature_dict.update(gsr_features)
    feature_dict.update(acc_features)

    # Build array in exact order model expects
    features_array = np.array(
        [[feature_dict[col] for col in FEATURE_COLS]],
        dtype=np.float64
    )

    return features_array, motion_contaminated, feature_dict, hrv_is_fallback


# ── Signal quality ────────────────────────────────────────────
def compute_signal_quality(ibi_array, gsr_adc_array, acc_array,
                           motion_contaminated, actual_fs=50):
    """
    Estimate how trustworthy this window's RAW sensor data was —
    independent of what the model predicted. Used to decide whether
    a window is eligible to be pooled for later retraining.

    actual_fs must match the real gsr_adc_array/acc_array sampling
    rate (~5Hz for the ring) — hardcoding it would silently misjudge
    IBI density on any window that isn't exactly that rate.

    Returns: float 0.0 to 1.0
    """
    scores = []

    duration_est = len(gsr_adc_array) / float(actual_fs) if actual_fs > 0 else 0
    expected_beats = max(1, duration_est / 0.8)  # ~1 beat per 0.8s at rest
    ibi_density_score = min(1.0, len(ibi_array) / expected_beats)
    scores.append(ibi_density_score)

    if len(ibi_array) >= 3:
        ibi_arr = np.array(ibi_array, dtype=np.float64)
        cv = np.std(ibi_arr) / (np.mean(ibi_arr) + 1e-6)
        ibi_stability_score = 1.0 if cv < 0.25 else max(0.0, 1.0 - (cv - 0.25))
        scores.append(ibi_stability_score)

    gsr_arr = np.array(gsr_adc_array, dtype=np.float64)
    gsr_range = gsr_arr.max() - gsr_arr.min() if len(gsr_arr) > 0 else 0
    gsr_contact_score = 1.0 if gsr_range > 5 else 0.3
    scores.append(gsr_contact_score)

    motion_score = 0.2 if motion_contaminated else 1.0
    scores.append(motion_score)

    return float(np.mean(scores))


# ── Validation test ───────────────────────────────────────────
if __name__ == '__main__':
    """
    Quick sanity check using synthetic data.
    Run: python extract_features.py
    Expected: 22 features with physiologically plausible values.
    """
    import random

    print("=" * 55)
    print("extract_features() validation test")
    print("=" * 55)

    # Simulate 60 seconds of resting data
    # IBI: ~75bpm = ~800ms intervals
    np.random.seed(42)
    ibi_sim = np.random.normal(800, 40, 75).tolist()

    # GSR: resting conductance ~3-4 uS
    # Calibration value ~512 (midpoint of 10-bit scale)
    # Work backward: what ADC gives ~3.5 uS?
    # resistance = 1e6 / 3.5 = 285714 ohm
    # ((1024 + 2*ADC) * 10000) / (512 - ADC) = 285714
    # Solving: ADC ≈ 498 (10-bit) → 1992 (12-bit)
    gsr_sim = np.random.normal(1992, 30, 3000).tolist()
    gsr_cal = 2048  # 12-bit calibration value

    # ACC: resting ~0.93g
    acc_sim = np.random.normal(0.93, 0.02, 3000).tolist()

    # Run extraction
    features, motion_flag, feat_dict, hrv_fallback_flag = extract_features(
        ibi_sim, gsr_sim, acc_sim, gsr_cal
    )

    print(f"\nOutput shape: {features.shape}")
    print(f"Motion contaminated: {motion_flag}")
    print(f"HRV fallback (insufficient clean IBI): {hrv_fallback_flag}")
    print(f"\nFeature values:")
    print("-" * 40)
    for i, col in enumerate(FEATURE_COLS):
        print(f"  {col:25s} = {features[0, i]:.4f}")

    print("\n" + "=" * 55)
    print("Expected ranges for resting state:")
    print("  AVNN       ~800ms")
    print("  MeanHR     ~75bpm")
    print("  SDHR       ~5-10 bpm")
    print("  pNN20      ~0.1-0.4")
    print("  SD1        ~25-50ms")
    print("  SCL_mean   ~3-5 uS")
    print("  ACC_mean   ~0.93g")
    print("  ACC_std    ~0.02g")
    print("=" * 55)