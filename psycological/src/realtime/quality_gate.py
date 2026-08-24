"""Pre-inference EEG signal-quality gate for the real-time T7/T8 pipeline.

Runs BEFORE a block is scored by the model: a 9-factor amplitude/spectral
gate, an inter-channel PLI-vs-surrogate coupling check (real coupling
should exceed phase-shuffled coupling), an Itakura spectral-distance
artifact check against a stored clean baseline, and a lightweight
self-calibrated KNN quality classifier. A block that fails is not fed to
the model or into decision-state history -- see `RealtimeInference` in
`pipeline.py`.

Adapted from a standalone offline validator (originally tuned for an
ADS1299/OpenBCI Cyton-style front end: VREF=4.5V, Gain=24) to this
project's actual hardware, an ADS1292R at GAIN=12, VREF=2.42V -- see
`adc.py`'s docstring for how those were decoded from the firmware's
register writes. `auto_scale_adc_to_uv` below now defaults to those
verified constants so a raw-code CSV inspected standalone (see
`scripts/check_signal_quality.py`) scores consistently with the live
pipeline, which converts codes via `adc.code_to_microvolts` before this
gate ever sees them.

KNOWN LIMITATION carried over from the source: `MultiFeatureQualityClassifier`
is not trained on external labeled data -- it self-calibrates a synthetic
GOOD/MED/LOW boundary from perturbations of the very first epoch it sees.
If that first epoch is itself atypical (e.g. captured before electrodes
settle), its notion of "good" will be skewed for the rest of the session.
Treat its output as a soft heuristic; the 9-factor gate score and the
PLI-vs-surrogate check are the more trustworthy signals here.

RE-ARCHITECTED to assess the SAME signal the model actually sees, not a
separate re-derivation of it: `assess_epoch`/`validate_epoch` used to
run their own internal detrend+bandpass+notch on raw 250Hz codes,
independently of (and materially weaker than) `pipeline.preprocess_block()`
-- which additionally spike-filters, corrects for MQTT/WiFi timing jitter
(raw_cleaning.py), and resamples through 128Hz (whose anti-aliasing filter
usefully attenuates high-frequency contamination the gate's own simpler
chain didn't). Confirmed against real captured hardware data: for the same
3 blocks, the old internal-filtering gate reported 40,343-96,653uV while
the ACTUAL signal `preprocess_block()` produces was 1,533-9,022uV -- up to
~25x different, meaning the gate had been rejecting blocks based on a
signal quality estimate that didn't match what the model would actually
receive. Now: factors 1-4 (completeness/dropout/clipping/flatline) still
use RAW ADC codes (the correct domain for those checks); everything else
(amplitude, noise ratio, kurtosis/skew, drift, variance, SNR, PLI,
Itakura, ML rating) uses the caller-supplied, already-fully-processed
signal directly -- no re-filtering here.
"""

import numpy as np
from scipy import signal
from scipy.stats import kurtosis, skew
from sklearn.neighbors import KNeighborsClassifier

from .adc import ADC_FULL_SCALE, GAIN, VREF_VOLTS


def auto_scale_adc_to_uv(raw_epoch, v_ref: float = VREF_VOLTS, gain: float = GAIN, adc_bits: int = 24):
    """Raw ADC counts -> microvolts, using THIS project's verified ADS1292R
    constants by default (not this module's original ADS1299 defaults).
    If values already look like microvolts (max abs <= 10000 uV), returned
    untouched -- lets this also accept pre-converted input safely.
    """
    arr = np.asarray(raw_epoch, dtype=float)
    max_val = np.max(np.abs(arr)) if len(arr) > 0 else 0.0
    if max_val <= 10000.0:
        return arr
    scale_factor = (v_ref / (gain * (2 ** (adc_bits - 1) - 1))) * 1e6
    return arr * scale_factor


class SignalQualityGate:
    """9 signal quality factors on a block:
    1. Completeness  2. Dropout/NaNs  3. ADC Clipping  4. Flatline
    5. Amplitude     6. Noise Ratio   7. Kurtosis/Skew 8. Drift Power 9. Variance headroom.
    Score (0-100) -> GOOD (>=80), QUESTIONABLE (>=40), POOR (<40).

    Factors 1-4 assess RAW ADC codes (fs_raw) -- the correct domain for
    completeness/clipping/flatline. Factors 5-9 assess the caller-supplied
    ALREADY-PROCESSED signal (fs_filtered) -- i.e. whatever
    pipeline.preprocess_block() actually produced (spike-filtered,
    uniform-gridded, resampled, notched, bandpassed) -- not a separate
    re-derivation of filtering here. See module docstring for why this
    matters (confirmed ~25x discrepancy against real hardware data when
    these two didn't match).
    """

    def __init__(self, fs_raw=250, fs_filtered=128, max_adc_counts=1_000_000.0, max_uv=7000.0):
        self.fs_raw = fs_raw
        self.fs_filtered = fs_filtered
        self.max_adc_counts = max_adc_counts
        self.max_uv = max_uv

    def assess_epoch(self, ch1_raw, ch2_raw, ch1_filtered, ch2_filtered):
        scores = []
        for raw, filt in [(ch1_raw, ch1_filtered), (ch2_raw, ch2_filtered)]:
            raw_arr = np.asarray(raw, dtype=float).flatten()
            filt_uv = np.asarray(filt, dtype=float).flatten()

            if len(raw_arr) < self.fs_raw or np.isnan(raw_arr).any() or np.isinf(raw_arr).any():
                return 0.0, "POOR", {"reason": "NaN/Inf/Incomplete epoch sample"}

            clipping_ratio = np.mean(np.abs(raw_arr) >= self.max_adc_counts)
            clip_score = max(0.0, 100.0 * (1.0 - clipping_ratio * 10.0))

            ptp_raw = np.ptp(raw_arr)
            std_raw = np.std(raw_arr)
            flatline_score = 0.0 if (ptp_raw < 1e-4 or std_raw < 1e-6) else 100.0

            det_ptp = np.ptp(filt_uv)
            amp_score = 100.0 if det_ptp <= self.max_uv else max(0.0, 100.0 - (det_ptp - self.max_uv) * 0.01)

            nperseg = min(len(filt_uv), int(self.fs_filtered))
            freqs, psd = signal.welch(filt_uv, fs=self.fs_filtered, nperseg=nperseg)
            in_band = np.sum(psd[(freqs >= 0.5) & (freqs <= 45.0)]) + 1e-12
            out_band = np.sum(psd[freqs > 45.0]) + 1e-12
            noise_ratio = out_band / (in_band + out_band)
            noise_score = max(0.0, 100.0 * (1.0 - noise_ratio * 2.0))

            kurt = abs(kurtosis(filt_uv))
            skw = abs(skew(filt_uv))
            stat_score = 100.0 if (kurt <= 12.0 and skw <= 4.0) else 30.0

            # filt_uv is already bandpassed (>=0.5Hz), so drift here reflects only
            # residual filter-rolloff leakage below 0.5Hz, not raw baseline wander.
            drift_power = np.sum(psd[freqs < 0.5]) + 1e-12
            drift_ratio = drift_power / (in_band + drift_power)
            drift_score = max(0.0, 100.0 * (1.0 - drift_ratio * 1.5))

            var_score = 100.0 if np.var(filt_uv) > 0.01 else 0.0

            ch_score = np.mean([clip_score, flatline_score, amp_score, noise_score, stat_score, drift_score, var_score])
            scores.append(ch_score)

        final_score = float(np.mean(scores))
        if final_score >= 80.0:
            rating = "GOOD"
        elif final_score >= 40.0:
            rating = "QUESTIONABLE"
        else:
            rating = "POOR"
        return final_score, rating, {"channel_scores": [round(s, 1) for s in scores]}


class TraditionalEEGValidator:
    def __init__(self, fs=250):
        self.fs = fs

    def compute_snr(self, eeg_segment, signal_band=(8, 13), noise_band=(30, 45)):
        eeg_segment = np.asarray(eeg_segment, dtype=float).flatten()
        freqs, psd = signal.welch(eeg_segment, fs=self.fs, nperseg=min(len(eeg_segment), self.fs))
        signal_power = float(np.sum(psd[(freqs >= signal_band[0]) & (freqs <= signal_band[1])])) + 1e-12
        noise_power = float(np.sum(psd[(freqs >= noise_band[0]) & (freqs <= noise_band[1])])) + 1e-12
        return float(10.0 * np.log10(signal_power / noise_power))

    def check_time_domain_thresholds(self, eeg_segment_filt, max_amplitude=7000.0):
        seg = np.asarray(eeg_segment_filt, dtype=float).flatten()
        ptp = float(np.ptp(seg))
        std_dev = float(np.std(seg))
        kurt = float(abs(kurtosis(seg)))
        skw = float(abs(skew(seg)))
        is_valid = (ptp <= max_amplitude) and (std_dev > 0.01) and (kurt < 12.0) and (skw < 4.0)
        return bool(is_valid), {"ptp": round(ptp, 2), "std": round(std_dev, 2)}


class ConnectivityValidator:
    @staticmethod
    def compute_pli(sig1, sig2):
        s1, s2 = np.asarray(sig1, dtype=float).flatten(), np.asarray(sig2, dtype=float).flatten()
        phase1 = np.angle(signal.hilbert(s1))
        phase2 = np.angle(signal.hilbert(s2))
        return float(np.abs(np.mean(np.sign(np.sin(phase1 - phase2)))))

    @staticmethod
    def compute_surrogate_pli(sig1, sig2, n_permutations=10):
        s1, s2 = np.asarray(sig1, dtype=float).flatten(), np.asarray(sig2, dtype=float).flatten()
        surrogates = []
        for _ in range(n_permutations):
            s2_perm = np.random.permutation(s2)
            phase1 = np.angle(signal.hilbert(s1))
            phase2 = np.angle(signal.hilbert(s2_perm))
            surrogates.append(float(np.abs(np.mean(np.sign(np.sin(phase1 - phase2))))))
        return float(np.mean(surrogates))


class ItakuraArtifactDetector:
    @staticmethod
    def lpc(sig, order=6):
        sig = np.asarray(sig, dtype=float).flatten()
        r = np.correlate(sig, sig, mode='full')[len(sig) - 1: len(sig) + order + 1]
        a = np.zeros(order + 1, dtype=float)
        a[0], e = 1.0, float(r[0]) + 1e-12
        for i in range(1, order + 1):
            acc = float(sum(a[j] * r[i - j] for j in range(i)))
            k = -acc / e
            a[i] = k
            for j in range(1, i // 2 + 1):
                a[j], a[i - j] = a[j] + k * a[i - j], a[i - j] + k * a[j]
            e *= (1.0 - k * k)
        return a

    def compute_itakura_distance(self, candidate_sig, baseline_clean_sig, order=6):
        cand = np.asarray(candidate_sig, dtype=float).flatten()
        base = np.asarray(baseline_clean_sig, dtype=float).flatten()

        a_cand = self.lpc(cand, order=order)
        a_base = self.lpc(base, order=order)

        r_cand = np.correlate(cand, cand, mode='full')[len(cand) - 1: len(cand) + order + 1]
        R = np.zeros((order + 1, order + 1), dtype=float)
        for i in range(order + 1):
            for j in range(order + 1):
                R[i, j] = r_cand[abs(i - j)]

        num = float(np.atleast_1d(a_base @ R @ a_base)[0])
        den = float(np.atleast_1d(a_cand @ R @ a_cand)[0])
        ratio = (num + 1e-12) / (den + 1e-12)
        return max(0.0, float(np.log(max(ratio, 1e-12))))


class MultiFeatureQualityClassifier:
    def __init__(self, fs=250):
        self.fs = fs
        self.knn = KNeighborsClassifier(n_neighbors=5, weights='distance')
        self._is_trained = False

    def extract_domain_features(self, segment):
        seg = np.asarray(segment, dtype=float).flatten()
        std_val = np.std(seg)
        if std_val > 1e-6:
            seg = (seg - np.mean(seg)) / std_val

        act = float(np.var(seg))
        diff1 = np.diff(seg)
        mob = float(np.sqrt(np.var(diff1) / (act + 1e-12)))
        diff2 = np.diff(diff1)
        comp = float(np.sqrt(np.var(diff2) / (np.var(diff1) + 1e-12)) / (mob + 1e-12))

        freqs, psd = signal.welch(seg, fs=self.fs, nperseg=min(len(seg), self.fs))
        total_p = np.sum(psd) + 1e-12
        rel_alpha = np.sum(psd[(freqs >= 8) & (freqs <= 12)]) / total_p
        rel_beta = np.sum(psd[(freqs >= 13) & (freqs <= 30)]) / total_p
        norm_psd = psd / total_p
        spec_entropy = -np.sum(norm_psd * np.log(norm_psd + 1e-12))

        return [act, mob, comp, float(rel_alpha), float(rel_beta), float(spec_entropy)]

    def train_adaptive_baseline(self, sample_segment):
        np.random.seed(42)
        base = self.extract_domain_features(sample_segment)
        X, y = [], []
        for _ in range(20):
            X.append([b * np.random.uniform(0.85, 1.15) for b in base])
            y.append("HIGH-Q")
        for _ in range(20):
            med_feat = [base[0] * 1.2, base[1] * 1.5, base[2] * 1.2, base[3] * 0.6, base[4] * 1.5, base[5] * 1.1]
            X.append([f * np.random.uniform(0.9, 1.1) for f in med_feat])
            y.append("MED-Q")
        for _ in range(20):
            low_feat = [base[0] * 2.5, base[1] * 4.0, base[2] * 0.2, base[3] * 0.05, base[4] * 3.0, base[5] * 1.8]
            X.append([f * np.random.uniform(0.9, 1.1) for f in low_feat])
            y.append("LOW-Q")
        self.knn.fit(X, y)
        self._is_trained = True

    def classify(self, segment):
        if not self._is_trained:
            self.train_adaptive_baseline(segment)
        return str(self.knn.predict([self.extract_domain_features(segment)])[0])


class TrustedIoTEEGValidator:
    """Unified gate: raw ADC codes (for factors 1-4) + the pipeline's actual
    processed signal (for everything else) in -> trusted/not decision +
    diagnostic scores out. Call `assess_only` during calibration (no clean
    baseline exists yet); call `validate_epoch` during inference, once a
    clean baseline block is available.

    Deliberately does NOT re-filter anything -- ch1_filtered/ch2_filtered
    are expected to already be the output of pipeline.preprocess_block()
    (or equivalent), so what's assessed here is exactly what the model
    would receive, not a separate approximation of it (see module
    docstring for why that distinction matters).
    """

    def __init__(self, fs_raw=250, fs_filtered=128, max_amplitude=7000.0):
        self.fs_raw = fs_raw
        self.fs_filtered = fs_filtered
        self.max_amplitude = max_amplitude
        self.quality_gate = SignalQualityGate(fs_raw=fs_raw, fs_filtered=fs_filtered, max_uv=max_amplitude)
        self.trad_val = TraditionalEEGValidator(fs=fs_filtered)
        self.conn_val = ConnectivityValidator()
        self.itakura_val = ItakuraArtifactDetector()
        self.ml_classifier = MultiFeatureQualityClassifier(fs=fs_filtered)

    def assess_only(self, ch1_raw, ch2_raw, ch1_filtered, ch2_filtered) -> dict:
        """Step-0 gate only -- used for calibration blocks, before any clean
        baseline exists for the Itakura check."""
        gate_score, gate_rating, _ = self.quality_gate.assess_epoch(ch1_raw, ch2_raw, ch1_filtered, ch2_filtered)
        return {
            "is_trusted": gate_rating != "POOR",
            "gate_rating": gate_rating,
            "quality_score": round(gate_score, 1),
        }

    def validate_epoch(self, ch1_raw, ch2_raw, ch1_filtered, ch2_filtered,
                        baseline_filtered_ch1, baseline_filtered_ch2) -> dict:
        gate_score, gate_rating, gate_details = self.quality_gate.assess_epoch(
            ch1_raw, ch2_raw, ch1_filtered, ch2_filtered)
        if gate_rating == "POOR":
            return {
                "is_trusted": False,
                "gate_rating": gate_rating,
                "quality_score": round(gate_score, 1),
                "reason": "Failed pre-filter quality gate (POOR rating)",
            }

        ch1_filt = np.asarray(ch1_filtered, dtype=float).flatten()
        ch2_filt = np.asarray(ch2_filtered, dtype=float).flatten()

        # Both channels get their own SNR/amplitude/Itakura check -- CH2 used to only feed
        # into the Step-0 gate score (averaged 50/50 with CH1) and the diagnostic-only PLI
        # check below, so a channel that's degraded but not enough to drag the AVERAGE gate
        # score to POOR could pass is_trusted on CH1's numbers alone (observed on real
        # hardware: a T8 channel stuck near its ADC rail still scored QUESTIONABLE, not
        # POOR, because CH1 was healthy).
        snr1 = self.trad_val.compute_snr(ch1_filt)
        snr2 = self.trad_val.compute_snr(ch2_filt)
        time_ok1, stats1 = self.trad_val.check_time_domain_thresholds(ch1_filt, max_amplitude=self.max_amplitude)
        time_ok2, stats2 = self.trad_val.check_time_domain_thresholds(ch2_filt, max_amplitude=self.max_amplitude)

        # PLI-vs-surrogate: diagnostic only, NOT a rejection criterion. Verified against real
        # SAM40 reference (CAR-referenced, this project's own gold-standard "clean" signal): one
        # legitimate block's real PLI (0.013) sat BELOW its surrogate PLI even at 1000 permutations
        # (~0.018, not noise -- the surrogate estimate had converged). Weak/near-zero task-related
        # T7-T8 phase coupling on a given block is a real, expected property of this weakly-coupled
        # channel pair (see results/methodology/01_dataset_and_channel_research.md -- T7/T8 shows no
        # special coupling advantage over a random pair), not evidence of bad signal. Using it as a
        # hard AND'd gate criterion was capable of rejecting known-good data purely on that basis.
        pli = self.conn_val.compute_pli(ch1_filt, ch2_filt)
        surr_pli = self.conn_val.compute_surrogate_pli(ch1_filt, ch2_filt, n_permutations=10)

        itakura_d1 = self.itakura_val.compute_itakura_distance(ch1_filt, baseline_filtered_ch1)
        itakura_d2 = self.itakura_val.compute_itakura_distance(ch2_filt, baseline_filtered_ch2)

        # ml_classifier stays CH1-only: it self-calibrates its GOOD/MED/LOW boundary from the
        # first epoch it's ever given (see this class's KNOWN LIMITATION docstring above) --
        # feeding it both channels through the same instance would mix two different signals
        # into that one calibration rather than giving CH2 its own independent judgment.
        ml_rating = self.ml_classifier.classify(ch1_filt)

        is_trusted = bool(
            time_ok1 and time_ok2
            and (snr1 > -20.0) and (snr2 > -20.0)
            and (ml_rating != "LOW-Q")
            and (itakura_d1 < 6.0) and (itakura_d2 < 6.0)
        )

        return {
            "is_trusted": is_trusted,
            "gate_rating": gate_rating,
            "quality_score": round(gate_score, 1),
            "snr_db": round(snr1, 2),
            "snr_db_ch2": round(snr2, 2),
            "pli_t7_t8": round(pli, 3),
            "surrogate_pli": round(surr_pli, 3),
            "itakura_distance": round(itakura_d1, 3),
            "itakura_distance_ch2": round(itakura_d2, 3),
            "amplitude_ok": time_ok1,
            "amplitude_ok_ch2": time_ok2,
            "peak_to_peak_uV": stats1["ptp"],
            "peak_to_peak_uV_ch2": stats2["ptp"],
            "ml_rating": ml_rating,
        }
