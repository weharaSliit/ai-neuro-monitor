"""Pre-inference EEG signal-quality gate for the real-time T7/T8 pipeline.

Runs BEFORE a block is scored by the model: a 9-factor amplitude/spectral
gate, an inter-channel PLI-vs-surrogate coupling check (real coupling
should exceed phase-shuffled coupling), an Itakura spectral-distance
artifact check against a stored clean baseline, and a lightweight quality
check that measures a live epoch's distance from this session's own real
calibration epochs. A block that fails is not fed to the model or into
decision-state history -- see `RealtimeInference` in `pipeline.py`.

Adapted from a standalone offline validator (originally tuned for an
ADS1299/OpenBCI Cyton-style front end: VREF=4.5V, Gain=24) to this
project's actual hardware, an ADS1292R at VREF=2.42V (GAIN=12 on the old
2-channel path; the live wearable02 bipolar channel is gain 8 --
adc.py BIPOLAR_GAIN, matching the firmware's CH2SET) -- see
`adc.py`'s docstring for how those were decoded from the firmware's
register writes. `auto_scale_adc_to_uv` below now defaults to those
verified constants so a raw-code CSV inspected standalone (see
`scripts/check_signal_quality.py`) scores consistently with the live
pipeline, which converts codes via `adc.code_to_microvolts` before this
gate ever sees them.

`MultiFeatureQualityClassifier` is NOT trained on external labeled data --
it measures a live epoch's distance (in a 6-feature Hjorth+spectral space)
from the mean/std of this session's OWN real, already-trusted calibration
epochs (fed in via `add_baseline_epoch()`/`TrustedIoTEEGValidator
.record_calibration_epoch()` -- see `pipeline.py`'s `calibrate_bipolar_block()`),
not from fabricated/perturbed data. KNOWN LIMITATION: a calibration window
built from very few blocks (this project's default, or a degraded
single-block fallback) still gives a thinner reference than a real labeled
dataset would, so its rating stays a soft diagnostic -- already NOT AND'd
into `is_trusted` below (see `validate_epoch`/`validate_epoch_single`)
rather than a hard rejection criterion. The 9-factor gate score and the
PLI-vs-surrogate check remain the more trustworthy signals here.

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


def _range_details(gate_details: dict) -> dict:
    """The unclamped-signal measurements assess_epoch_single() reports,
    passed through to the API/Firebase record (absent on the 2-channel path)."""
    keys = ("out_of_range_fraction", "ptp_uV_unclamped", "std_uV_unclamped", "reason")
    return {k: gate_details[k] for k in keys if k in gate_details}


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

    # A block collapsed to a handful of repeated values (almost always from
    # upstream clamping on wildly out-of-range raw input) can still score
    # well on the 7 factors below -- a near-flat signal has LOW variance
    # and LOW kurtosis-deviation, which amp_score/stat_score/var_score
    # reward rather than penalize. Confirmed repeatedly against real
    # captured hardware data this project has tested: false-positive GOOD
    # blocks had 1-28 distinct filtered values out of 3200-6250 samples
    # (<1% unique); genuinely clean blocks captured later in the same
    # testing had 2900+ distinct values (>90% unique) with near-Gaussian
    # kurtosis. This is a more direct and reliable discriminator than raw
    # clip-fraction, which was tried first and found NOT to reliably
    # predict post-filter degeneracy -- a heavily-clamped-looking raw
    # block can still filter down to a genuinely rich signal (real EEG
    # riding on top of a large-but-linear offset the bandpass legitimately
    # removes), and a raw block that looks only moderately clamped can
    # still collapse to near-flat after filtering. Checked on the
    # FILTERED signal specifically, and treated as an outright fail (not
    # just another averaged factor) -- 7-factor averaging alone was
    # observed to only partially discount a degenerate block (e.g. an
    # 87.9 "GOOD" score with everything else passing), not exclude it.
    MIN_UNIQUE_RATIO = 0.5

    # Share of the UNCLAMPED filtered signal allowed beyond +-CLIP_UV
    # (100 uV), i.e. the share the pipeline's final clamp would alter. The
    # model never saw clamping: all 480 SAM40 training blocks have
    # filtered ptp <= 78 uV (median 47), so 0% of training samples exceed
    # 100 uV. Above a few percent the 29 features come from a flat-topped
    # signal outside the training range, and the score means nothing. 5%
    # leaves room for a blink or a brief movement, not for sustained
    # interference. Hard fail (like MIN_UNIQUE_RATIO), not an averaged
    # factor: averaging one bad factor into seven is how out-of-range
    # blocks used to score 96 and pass.
    MAX_OUT_OF_RANGE_FRACTION = 0.05
    RANGE_UV = 100.0  # == adc.CLIP_UV, the pipeline's final clamp

    def __init__(self, fs_raw=250, fs_filtered=128, max_adc_counts=1_000_000.0, max_uv=7000.0):
        self.fs_raw = fs_raw
        self.fs_filtered = fs_filtered
        self.max_adc_counts = max_adc_counts
        self.max_uv = max_uv

    def _assess_channel(self, raw, filt) -> float | None:
        """The 9-factor computation for ONE channel -- factors 1-4 on `raw`
        (ADC codes), 5-9 on `filt` (already-processed signal). Returns None
        (caller should treat as an immediate POOR/0.0) if the raw epoch is
        incomplete/NaN/Inf. Shared by assess_epoch() (averages two channels)
        and assess_epoch_single() (wearable02's one hardware-differential
        channel -- see that method's docstring for why there's no second
        channel to average against)."""
        raw_arr = np.asarray(raw, dtype=float).flatten()
        filt_uv = np.asarray(filt, dtype=float).flatten()

        if len(raw_arr) < self.fs_raw or np.isnan(raw_arr).any() or np.isinf(raw_arr).any():
            return None

        # Degeneracy hard-fail -- see MIN_UNIQUE_RATIO's docstring above.
        # Checked before the 7 factors below since a degenerate signal can
        # otherwise pass several of them individually.
        unique_ratio = len(np.unique(filt_uv.round(4))) / len(filt_uv)
        if unique_ratio < self.MIN_UNIQUE_RATIO:
            return 0.0

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

        return float(np.mean([clip_score, flatline_score, amp_score, noise_score, stat_score, drift_score, var_score]))

    @staticmethod
    def _rating_for(score: float) -> str:
        if score >= 80.0:
            return "GOOD"
        elif score >= 40.0:
            return "QUESTIONABLE"
        return "POOR"

    def assess_epoch(self, ch1_raw, ch2_raw, ch1_filtered, ch2_filtered):
        scores = []
        for raw, filt in [(ch1_raw, ch1_filtered), (ch2_raw, ch2_filtered)]:
            ch_score = self._assess_channel(raw, filt)
            if ch_score is None:
                return 0.0, "POOR", {"reason": "NaN/Inf/Incomplete epoch sample"}
            scores.append(ch_score)

        final_score = float(np.mean(scores))
        return final_score, self._rating_for(final_score), {"channel_scores": [round(s, 1) for s in scores]}

    def assess_epoch_single(self, raw, filtered):
        """wearable02 variant: ONE hardware T7-T8 differential channel, not
        two channels to average -- see this class's docstring and
        TrustedIoTEEGValidator.assess_only_single()/validate_epoch_single()
        for the full reasoning (no second channel exists to average
        against, or to compare PLI coupling with)."""
        ch_score = self._assess_channel(raw, filtered)
        if ch_score is None:
            return 0.0, "POOR", {"reason": "NaN/Inf/Incomplete epoch sample"}
        # `filtered` must be the UNCLAMPED filtered signal (pipeline.py
        # preprocess_bipolar_block_unclamped()) -- on the clamped one every
        # block over 100 uV reads ptp=200 and fails MIN_UNIQUE_RATIO by
        # accident instead of being measured.
        filt = np.asarray(filtered, dtype=float).flatten()
        out_of_range = float(np.mean(np.abs(filt) > self.RANGE_UV))
        details = {"channel_scores": [round(ch_score, 1)],
                   "out_of_range_fraction": round(out_of_range, 4),
                   "ptp_uV_unclamped": round(float(np.ptp(filt)), 1),
                   "std_uV_unclamped": round(float(np.std(filt)), 1)}
        if out_of_range > self.MAX_OUT_OF_RANGE_FRACTION:
            details["reason"] = (f"{out_of_range * 100:.0f}% of the filtered signal is beyond "
                                 f"+-{self.RANGE_UV:.0f} uV (limit {self.MAX_OUT_OF_RANGE_FRACTION * 100:.0f}%; "
                                 f"training data: 0%) -- outside the model's range, typically poor "
                                 f"electrode/bias contact or mains interference")
            return 0.0, "POOR", details
        return ch_score, self._rating_for(ch_score), details


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
        return bool(is_valid), {
            "ptp": round(ptp, 2), "std": round(std_dev, 2),
            "kurtosis": round(kurt, 2), "skew": round(skw, 2),
        }


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
    """Flags a live epoch HIGH-Q/MED-Q/LOW-Q by its distance (in a 6-feature
    Hjorth+spectral space, see `extract_domain_features`) from THIS
    SESSION's own real, already-trusted calibration epochs -- not a model
    "trained" on fabricated data. Call `add_baseline_epoch()` once per real
    calibration block that passed the Step-0 gate (see `pipeline.py`'s
    `calibrate_bipolar_block()`); `classify()` then measures how far a live
    epoch's features sit from that real reference, in per-feature standard
    deviations. See this module's docstring for why its output is a soft
    diagnostic, not a rejection criterion.
    """

    # A single relative-std floor (not 6 per-feature tunings) so a baseline
    # built from very few calibration blocks (as few as 1, in a degraded-
    # calibration fallback -- see pipeline.py's finalize_calibration_bipolar())
    # can't produce a near-zero std and blow ordinary block-to-block
    # variation up into an extreme z-score.
    MIN_REL_STD = 0.15
    # Standard z-score conventions, not fit/tuned against any dataset --
    # ~2 SD covers typical within-session variation under a roughly-
    # Gaussian assumption, ~4 SD is a genuine outlier.
    HIGH_Q_MAX_AVG_Z = 2.0
    MED_Q_MAX_AVG_Z = 4.0

    def __init__(self, fs=250):
        self.fs = fs
        self._baseline_features: list[list[float]] = []

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

    def add_baseline_epoch(self, segment):
        """Feeds one real, already-trusted calibration epoch into this
        session's reference set -- see `TrustedIoTEEGValidator
        .record_calibration_epoch()`, the caller-facing entry point."""
        self._baseline_features.append(self.extract_domain_features(segment))

    def classify(self, segment):
        if not self._baseline_features:
            # No real calibration reference recorded yet -- callers are expected to
            # call add_baseline_epoch() during calibration before this is ever hit
            # (see pipeline.py's calibrate_bipolar_block()/finalize_calibration_bipolar()).
            # MED-Q is the neutral/non-blocking default rather than guessing HIGH or LOW
            # with nothing real to compare against.
            return "MED-Q"

        base = np.array(self._baseline_features, dtype=float)
        mean = base.mean(axis=0)
        std_safe = np.maximum(np.maximum(base.std(axis=0), np.abs(mean) * self.MIN_REL_STD), 1e-9)

        feats = np.array(self.extract_domain_features(segment), dtype=float)
        avg_z = float(np.mean(np.abs(feats - mean) / std_safe))

        if avg_z <= self.HIGH_Q_MAX_AVG_Z:
            return "HIGH-Q"
        if avg_z <= self.MED_Q_MAX_AVG_Z:
            return "MED-Q"
        return "LOW-Q"


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

    def record_calibration_epoch(self, ch1_filtered) -> None:
        """Feeds one real, already-trusted calibration epoch (CH1/bipolar
        signal -- see `ml_classifier`'s own docstring) into `ml_classifier`'s
        real baseline reference, so its later `classify()` calls compare a
        live epoch against actual captured signal instead of nothing. Call
        once per accepted calibration block -- see `pipeline.py`'s
        `calibrate_bipolar_block()`/`finalize_calibration_bipolar()`."""
        self.ml_classifier.add_baseline_epoch(ch1_filtered)

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

        # ml_classifier stays CH1-only: its real calibration reference (see
        # add_baseline_epoch()) is built from CH1 epochs -- feeding it both channels
        # through the same instance would mix two different signals into that one
        # reference rather than giving CH2 its own independent judgment.
        #
        # NOT used as a rejection criterion below, same reasoning PLI was demoted to
        # diagnostic-only above: even grounded in real calibration data, a handful of
        # calibration blocks is a thinner reference than a labeled dataset would give,
        # so an AND'd hard gate on it risked rejecting known-good blocks purely because
        # this session's own calibration window happened to be atypical -- still
        # returned below so callers/logs can see it, just not load-bearing for
        # is_trusted.
        ml_rating = self.ml_classifier.classify(ch1_filt)

        is_trusted = bool(
            time_ok1 and time_ok2
            and (snr1 > -20.0) and (snr2 > -20.0)
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
            "std_uV": stats1["std"],
            "std_uV_ch2": stats2["std"],
            "kurtosis": stats1["kurtosis"],
            "kurtosis_ch2": stats2["kurtosis"],
            "skew": stats1["skew"],
            "skew_ch2": stats2["skew"],
            "ml_rating": ml_rating,
        }

    def assess_only_single(self, raw, filtered) -> dict:
        """assess_only()'s wearable02 (single hardware-differential channel)
        counterpart -- used for calibration blocks, before any clean
        baseline exists for the Itakura check."""
        gate_score, gate_rating, gate_details = self.quality_gate.assess_epoch_single(raw, filtered)
        return {
            "is_trusted": gate_rating != "POOR",
            "gate_rating": gate_rating,
            "quality_score": round(gate_score, 1),
            **_range_details(gate_details),
        }

    def validate_epoch_single(self, raw, filtered, baseline_filtered) -> dict:
        """validate_epoch()'s wearable02 counterpart. Two checks from the
        two-channel version are intentionally absent, not approximated:
          - PLI-vs-surrogate: measures phase COUPLING BETWEEN two
            independently recorded channels -- meaningless for a signal
            that was already collapsed to one hardware differential before
            it ever reached software. There is no second channel to
            compare against, and comparing the signal to a time-shifted
            copy of itself would test a different (and not validated)
            hypothesis while looking like the same metric -- see this
            module's design discussion for why that was rejected outright
            rather than approximated.
          - The CH1-healthy-masks-CH2-degraded failure mode validate_epoch()
            guards against (see its own comment) doesn't apply here either:
            there is only one channel, so there's no second channel's
            numbers to separately check.
        Everything else (SNR, amplitude/kurtosis/skew thresholds, Itakura
        distance against this session's OWN bipolar calibration reference,
        the self-calibrated ML rating) is unchanged in kind from the
        two-channel version, just computed once instead of twice.
        """
        gate_score, gate_rating, gate_details = self.quality_gate.assess_epoch_single(raw, filtered)
        if gate_rating == "POOR":
            return {
                "is_trusted": False,
                "gate_rating": gate_rating,
                "quality_score": round(gate_score, 1),
                **_range_details(gate_details),
                "reason": gate_details.get("reason") or "Failed pre-filter quality gate (POOR rating)",
            }

        filt = np.asarray(filtered, dtype=float).flatten()

        snr = self.trad_val.compute_snr(filt)
        time_ok, stats = self.trad_val.check_time_domain_thresholds(filt, max_amplitude=self.max_amplitude)
        itakura_d = self.itakura_val.compute_itakura_distance(filt, baseline_filtered)
        ml_rating = self.ml_classifier.classify(filt)

        is_trusted = bool(time_ok and (snr > -20.0) and (itakura_d < 6.0))

        # Name every check that failed -- previously only the pre-filter
        # gate gave a reason, so a block rejected here looked identical to
        # one rejected for any other cause.
        failed = []
        if stats["ptp"] > self.max_amplitude:
            failed.append(f"ptp {stats['ptp']:.0f} uV > {self.max_amplitude:.0f}")
        if stats["std"] <= 0.01:
            failed.append("flat signal")
        if stats["kurtosis"] >= 12.0:
            failed.append(f"kurtosis {stats['kurtosis']:.1f} >= 12 (spiky artefact)")
        if stats["skew"] >= 4.0:
            failed.append(f"skew {stats['skew']:.1f} >= 4")
        if snr <= -20.0:
            failed.append(f"alpha/high-band SNR {snr:.1f} dB <= -20")
        if itakura_d >= 6.0:
            failed.append(f"Itakura distance {itakura_d:.2f} >= 6 vs this session's reference block")

        return {
            "is_trusted": is_trusted,
            **({"reason": "; ".join(failed)} if failed else {}),
            "gate_rating": gate_rating,
            "quality_score": round(gate_score, 1),
            "snr_db": round(snr, 2),
            "itakura_distance": round(itakura_d, 3),
            "amplitude_ok": time_ok,
            "peak_to_peak_uV": stats["ptp"],
            "std_uV": stats["std"],
            "kurtosis": stats["kurtosis"],
            "skew": stats["skew"],
            "ml_rating": ml_rating,
            **_range_details(gate_details),
        }
