"""A virtual person wearing both devices, advanced in 0.2 s steps.

Each step returns what the devices would send in those 0.2 s: 50 EEG samples
(uV + device millis) and one ring packet. Used by evaluate.py (offline, through
the real backend code) and by live_stimulator.py (published over MQTT).
"""
import numpy as np

from .eeg import BLOCK, EEGSource
from .latent import LatentState
from .profiles import PROFILES, sample_user
from .ring import RingSource

STEP = 0.2
BATCH = 50                       # EEG samples per step (250 Hz)
CALM_PHASES = {"settle", "rest", "recovery", "calm"}


class VirtualUser:
    def __init__(self, profile, seed):
        self.profile = PROFILES[profile]
        self.params, taus = sample_user(profile, seed)
        self.rng = np.random.default_rng(seed * 7919 + 13)
        self.latent = LatentState(taus, fatigue_per_hour=self.params.fatigue_per_hour)
        self.eeg = EEGSource(rng=np.random.default_rng(seed * 7919 + 1), **self.params.eeg)
        self.ring = (RingSource(np.random.default_rng(seed * 7919 + 2), **self.params.ring)
                     if self.profile.ring_present else None)
        self.eeg.prepare_block()
        self.i = 0                         # sample index inside the current EEG block
        self.t = 0.0
        self.millis = 0
        self.drift_level = 0.0
        self.task_started = False
        self.drowsy_until = -1.0

    def step(self, demand, phase):
        r, p = self.rng, self.profile
        lo = self.latent.step(demand, STEP, r)
        tapping = demand > 0.5
        if phase in ("task", "demand"):
            self.task_started = True
        if p.drift and self.task_started:                         # contact drift: creeps up, never returns
            self.drift_level = min(1.2, self.drift_level + STEP / 600.0)
        drowsy = 0.0
        if p.drowsy and phase in CALM_PHASES:
            if self.t >= self.drowsy_until and r.random() < STEP / 240.0:   # an episode every ~4 min
                self.drowsy_until = self.t + r.uniform(30, 90)
            drowsy = 0.8 if self.t < self.drowsy_until else 0.0
        x = self.eeg.render(self.i, self.i + BATCH, lo["brain"], tapping=tapping, drowsy=drowsy,
                            drift_level=self.drift_level + 0.3 * self.latent.fatigue)
        gap = self.eeg.c["gap"]
        keep = np.ones(BATCH, bool)
        if gap:
            keep = ~((np.arange(self.i, self.i + BATCH) >= gap[0]) & (np.arange(self.i, self.i + BATCH) < gap[1]))
        millis = self.millis + np.arange(BATCH) * 4
        self.millis += BATCH * 4
        self.i += BATCH
        block_done = self.i >= BLOCK
        block_lost = bool(gap) if block_done else False
        if block_done:
            self.i = 0
            self.eeg.t0 += BLOCK / 250
            self.eeg.prepare_block()
        packet = (self.ring.packet(lo["heart"], lo["skin"], self.latent.arousal, tapping=tapping)
                  if self.ring else None)
        self.t += STEP
        return {"uv": x, "millis": millis, "keep": keep, "packet": packet, "block_done": block_done,
                "block_lost": block_lost, "loads": dict(lo), "drowsy": drowsy, "drift": self.drift_level}
