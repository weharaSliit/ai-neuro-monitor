"""Raw-telemetry cleanup, applied to already-uV-converted samples BEFORE
resampling/filtering: [Raw Telemetry] -> [Glitch/Spike Filter] ->
[uniform-grid interpolation] -> (existing) resample_to_target ->
notch_then_bandpass -> [Clean EEG].

Scoped to src/realtime/ deliberately, not src/sam40/preprocess.py: this
fixes properties specific to live IoT telemetry (glitches, WiFi/MQTT
jitter and packet loss) that SAM40's offline recordings don't have. Adding
it upstream of the offline training pipeline would shift every trained
model's input distribution and require full retraining -- out of scope
here. DC-offset removal and 50Hz notch are already handled by the existing
notch_then_bandpass() (0.5-45Hz bandpass + notch) downstream of this
module; not duplicated here.
"""

import numpy as np
import pandas as pd

MAD_TO_STD = 1.4826  # scales MAD to a Gaussian-equivalent std, standard convention

# Cheap early-reject threshold, checked directly on device timestamps before
# any despike/interpolation/filter work runs -- mirrors adc.py's
# MAX_RAW_UV/raw_magnitude_ok pattern, but for a dropped-packet outage
# instead of an amplitude fault. np.interp() (used downstream in
# interpolate_to_uniform_grid()) has no concept of a gap: it fabricates a
# straight line across ANY hole in the timestamps, so a multi-second WiFi/
# MQTT outage would otherwise be silently smoothed into a plausible-looking
# but entirely synthetic stretch of "signal" and fed straight into the
# filter and model like real data.
MAX_GAP_SEC = 1.0


def max_gap_sec(millis: np.ndarray) -> float:
    """Largest spacing between consecutive, de-duplicated device timestamps,
    in seconds -- see MAX_GAP_SEC above. Safe to call on raw millis before
    any other processing."""
    millis = np.asarray(millis, dtype=float)
    if millis.size < 2:
        return 0.0
    millis = np.sort(millis)
    millis = millis[np.concatenate(([True], np.diff(millis) > 0))]
    if millis.size < 2:
        return 0.0
    return float(np.max(np.diff(millis)) / 1000.0)


def start_after_last_gap(millis, max_gap_sec: float = None) -> tuple[int, float]:
    """(index, gap_sec): index of the first sample after the LAST break in
    `millis` -- a gap wider than max_gap_sec (default MAX_GAP_SEC) or a
    device reboot (millis going backwards) -- and that gap's length (-1 for
    a reboot). (0, 0.0) if the run is continuous. Used to start a block
    after a stream interruption instead of building one that spans it,
    which timing_ok() would then reject whole."""
    limit_ms = (MAX_GAP_SEC if max_gap_sec is None else max_gap_sec) * 1000.0
    m = np.asarray(millis, dtype=float)
    if m.size < 2:
        return 0, 0.0
    dt = np.diff(m)
    breaks = np.nonzero((dt > limit_ms) | (dt < 0))[0]
    if breaks.size == 0:
        return 0, 0.0
    i = int(breaks[-1])
    return i + 1, (float(dt[i]) / 1000.0 if dt[i] >= 0 else -1.0)


def timing_ok(millis: np.ndarray) -> bool:
    """True if this block has no dropped-packet gap wider than MAX_GAP_SEC."""
    return max_gap_sec(millis) <= MAX_GAP_SEC


def remove_spikes(values: np.ndarray, abs_threshold_uv: float = 10_000.0,
                   mad_k: float = 5.0, window: int = 25,
                   min_mad_uv: float = 1.0, max_spike_fraction: float = 0.5) -> tuple[np.ndarray, int]:
    """Flags samples that are either (a) beyond abs_threshold_uv outright, or
    (b) more than mad_k rolling-MADs from a rolling median -- then replaces
    flagged samples via linear interpolation from their nearest unflagged
    neighbors (never dropped, since dropping would corrupt the fixed-rate
    assumption every downstream spectral step relies on).

    min_mad_uv floors the local MAD estimate so a locally near-flat segment
    (MAD~0) doesn't make every tiny fluctuation look like a spike.

    SAFETY: this is for SPARSE glitches. If more than max_spike_fraction of
    the block is flagged, that isn't a sparse-glitch situation -- it's a
    sustained fault (e.g. the floating-reference amplitude fault this
    project has hit on real hardware: EVERY sample exceeds abs_threshold_uv,
    leaving no valid neighbor anywhere to interpolate from). Interpolating
    through that would silently produce all-NaN, which would then propagate
    as garbage into every downstream step instead of failing visibly. In
    that case, this returns the values UNCHANGED (still flagged as spikes in
    the count) -- the quality gate (quality_gate.py), which runs on the raw
    codes independently, is the correct place for a sustained fault like
    that to be caught and rejected, not this function.

    Returns (cleaned_values, n_spikes_flagged).
    """
    x = pd.Series(np.asarray(values, dtype=float))
    rolling_median = x.rolling(window, center=True, min_periods=1).median()
    deviation = (x - rolling_median).abs()
    rolling_mad = deviation.rolling(window, center=True, min_periods=1).median().clip(lower=min_mad_uv)

    is_spike = (x.abs() > abs_threshold_uv) | (deviation > mad_k * rolling_mad * MAD_TO_STD)
    n_spikes = int(is_spike.sum())

    if n_spikes == 0:
        return x.to_numpy(), 0
    if n_spikes / len(x) > max_spike_fraction:
        return x.to_numpy(), n_spikes  # sustained fault, not sparse glitches -- see docstring

    cleaned = x.copy()
    cleaned[is_spike] = np.nan
    # edges may be NaN with no valid neighbor on one side -- fill from whichever side exists
    cleaned = cleaned.interpolate(method='linear', limit_direction='both')
    return cleaned.to_numpy(), n_spikes


def interpolate_to_uniform_grid(millis: np.ndarray, values: np.ndarray, target_fs: float,
                                 duration_sec: float | None = None) -> np.ndarray:
    """Resamples irregularly-timed (millis, values) telemetry onto an exact
    uniform target_fs grid via linear interpolation on the device timestamps
    -- corrects for WiFi/MQTT jitter, occasional drops, or bursty delivery,
    rather than assuming every raw sample arrived at a perfectly even
    interval (resample_to_target()'s polyphase step assumes that, so this
    must run first).

    duration_sec: if given, the output grid spans exactly that many seconds
    from millis[0] -- makes block length deterministic (e.g. always exactly
    25s * target_fs samples) regardless of real-world packet-count
    variability. If None, spans millis[0]..millis[-1].

    Callers should check timing_ok()/max_gap_sec() BEFORE calling this --
    np.interp() has no concept of a gap and will fabricate a straight line
    across any hole in the timestamps, including a multi-second dropped-
    packet outage, indistinguishable downstream from real interpolated-
    jitter correction.
    """
    millis = np.asarray(millis, dtype=float)
    values = np.asarray(values, dtype=float)

    # defend against out-of-order or duplicate timestamps (MQTT gives no
    # ordering/uniqueness guarantee) -- np.interp requires strictly increasing x.
    order = np.argsort(millis, kind='stable')
    millis, values = millis[order], values[order]
    keep = np.concatenate(([True], np.diff(millis) > 0))
    millis, values = millis[keep], values[keep]

    t_sec = (millis - millis[0]) / 1000.0
    span = duration_sec if duration_sec is not None else t_sec[-1]
    n_out = max(1, int(round(span * target_fs)))
    t_uniform = np.arange(n_out) / target_fs
    return np.interp(t_uniform, t_sec, values)


def clean_raw_channel(millis: np.ndarray, values_uv: np.ndarray, target_fs: float,
                       duration_sec: float | None = None, **spike_kwargs) -> tuple[np.ndarray, int]:
    """Convenience wrapper: spike removal, THEN uniform-grid interpolation
    (in that order -- interpolating first would let a spike's neighbors drag
    the interpolated grid toward the glitch before it's ever flagged)."""
    despiked, n_spikes = remove_spikes(values_uv, **spike_kwargs)
    uniform = interpolate_to_uniform_grid(millis, despiked, target_fs, duration_sec=duration_sec)
    return uniform, n_spikes
