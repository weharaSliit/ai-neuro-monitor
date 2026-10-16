"""Hybrid EEG generator (headband wearable02, T7-T8 bipolar, 250 Hz).

Base signal = REAL SAM40 T7-T8 trials of one subject (each virtual user is
one SAM40 subject, so person-to-person differences -- typical, weak and
inverted responders -- come from real data, not from chosen numbers):
    x(t) = sqrt(1 - L(t)) * rest(t) + sqrt(L(t)) * task(t)
with L = the latent brain load at that moment, rest/task drawn from the
subject's Relax and Arithmetic/Stroop/Mirror trials (random circular shifts,
two-trial blends). Mixing independent segments interpolates band powers
linearly in L.

Headband layer, measured on real good-contact wearable02 blocks
(reference/real_iot_ranges.json: RMS 7.6-38 uV, median 11.4; delta_rel ~0.25,
gamma_rel ~0.10, slope ~-0.85), tuned in fidelity.py:
    amplitude scaled to the user's headband RMS; low-frequency electrode drift
    (0.3-3 Hz); temporal-muscle activity (35-100 Hz) with bursts while tapping;
    blinks 10-20/min (small at T7-T8); 50 Hz pickup; amplifier noise; a decaying
    post-power-on transient (the 2 min settle discards it); profile layers:
    drowsiness and contact drift (alpha loss + slow theta), jaw-clench bursts,
    dropouts.

Each 25 s block's components are prepared once (prepare_block) and rendered
in slices with the state at that moment (render), so the live stream (0.2 s
batches) and offline runs use exactly the same signal.
"""
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.signal import butter, resample_poly, sosfiltfilt

REPO = Path(__file__).resolve().parents[3]
FS = 250
BLOCK = 25 * FS


@lru_cache(maxsize=1)
def _sam40():
    """subject -> {'rest': [uV arrays @250 Hz], 'task': [...]} (T7-T8, filtered data)."""
    import sys
    sys.path.insert(0, str(REPO / "psycological"))
    from src.sam40.channels import T7_IDX, T8_IDX
    from src.sam40.loader import discover_trials, load_trial_data
    out = {}
    for t in discover_trials(REPO / "data" / "SAM40" / "filtered_data"):
        x = load_trial_data(t, "filtered")
        bip = resample_poly(x[T7_IDX] - x[T8_IDX], 125, 64)[:BLOCK]
        d = out.setdefault(t.subject, {"rest": [], "task": []})
        d["rest" if t.task == "Relax" else "task"].append(bip.astype(float))
    return out


def _band(lo, hi, order=4):
    return butter(order, (lo, hi), btype="bandpass", fs=FS, output="sos")


SOS = {"drift": _band(0.3, 3.0, 2), "theta": _band(4.0, 7.5), "alpha": _band(8.0, 12.5), "emg": _band(35.0, 100.0)}


def _colored(rng, n, sos):
    y = sosfiltfilt(sos, rng.normal(size=n))
    return y / (y.std() + 1e-12)


class EEGSource:
    def __init__(self, subject, rng, rms_uv, drift_frac, emg_frac, blink_rate, clench_rate=0.0, dropout_rate=0.0):
        self.d = _sam40()[subject]
        self.rng = rng
        rest_rms = float(np.median([np.sqrt(np.mean(r ** 2)) for r in self.d["rest"]]))
        self.scale = rms_uv / rest_rms
        self.drift_uv, self.emg_uv = drift_frac * rms_uv, emg_frac * rms_uv
        self.blink_rate, self.clench_rate, self.dropout_rate = blink_rate, clench_rate, dropout_rate
        self.t0 = 0.0                       # seconds since power-on at the start of the current block
        self.c = None

    def _seg(self, pool):
        r = self.rng
        a, b = pool[r.integers(len(pool))], pool[r.integers(len(pool))]
        w = r.uniform(0.6, 1.0)
        return w * np.roll(a, r.integers(BLOCK)) + math.sqrt(1 - w * w) * np.roll(b, r.integers(BLOCK))

    def prepare_block(self):
        r, n = self.rng, BLOCK
        rest, task = self._seg(self.d["rest"]) * self.scale, self._seg(self.d["task"]) * self.scale
        noise = (self.drift_uv * _colored(r, n, SOS["drift"])
                 + 80.0 * np.exp(-(self.t0 + np.arange(n) / FS) / 30.0) * _colored(r, n, SOS["drift"])
                 + r.uniform(0.5, 2.0) * np.sin(2 * math.pi * 50 * (self.t0 + np.arange(n) / FS)) + 1.5 * r.normal(size=n))
        for _ in range(r.poisson(self.blink_rate * 25 / 60)):
            k0, m = r.integers(0, n - FS), int(0.3 * FS)
            noise[k0:k0 + m] += r.uniform(10, 30) * np.sin(np.linspace(0, math.pi, m))
        clench = np.zeros(n)
        for _ in range(r.poisson(self.clench_rate * 25 / 60)):
            k0 = r.integers(0, n - 3 * FS)
            k1 = k0 + int(r.uniform(1, 3) * FS)
            clench[k0:k1] = 8 * self.emg_uv * _colored(r, k1 - k0, SOS["emg"])
        gap = None
        if r.random() < self.dropout_rate * 25 / 60:
            k0 = int(r.integers(FS, n - 4 * FS))
            gap = (k0, k0 + int(r.uniform(1, 3) * FS))
        self.c = {"rest": rest, "task": task, "a_rest": sosfiltfilt(SOS["alpha"], rest), "a_task": sosfiltfilt(SOS["alpha"], task),
                  "theta": self.scale * 3.0 * _colored(r, n, SOS["theta"]), "noise": noise, "clench": clench,
                  "emg": self.emg_uv * _colored(r, n, SOS["emg"]), "burst": (r.random(n // FS + 1) < 0.35).repeat(FS)[:n],
                  "gap": gap}
        return self.c

    def render(self, i0, i1, load, tapping=False, drowsy=0.0, drift_level=0.0):
        """Samples [i0, i1) of the prepared block with the state at that moment."""
        c, s = self.c, slice(i0, i1)
        a, b = math.sqrt(1 - load), math.sqrt(load)
        x = a * c["rest"][s] + b * c["task"][s]
        alpha = a * c["a_rest"][s] + b * c["a_task"][s]
        # drowsiness (alpha drops out, theta rises) and contact drift / fatigue (alpha loss, slow theta)
        x = x - (0.6 * drowsy + 0.5 * drift_level) * alpha + (0.8 * drowsy + 0.8 * drift_level) * c["theta"][s]
        emg = c["emg"][s] * (1.0 + (2.5 * c["burst"][s] if tapping else 0.0))
        return x + c["noise"][s] + emg + c["clench"][s]

    def block(self, load, **state):
        """Whole 25 s block at constant state (fidelity checks)."""
        self.prepare_block()
        x = self.render(0, BLOCK, load, **state)
        self.t0 += BLOCK / FS
        return x
