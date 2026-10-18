"""A virtual person wearing both devices, advanced in 0.2 s steps.

Each step returns what the devices would send in those 0.2 s: 50 EEG samples
(uV + device millis) and one ring packet. Used by evaluate.py (offline, through
the real backend code) and by live_stimulator.py (published over MQTT).
"""
import numpy as np

from .eeg import BLOCK, EEGSource
from .latent import LatentState
from .profiles import ALL_PROFILES, sample_user
from .ring import RingSource

STEP = 0.2
BATCH = 50                       # EEG samples per step (250 Hz)
CALM_PHASES = {"settle", "rest", "recovery", "calm", "relaxed"}
MIND_PHASES = {"task", "demand", "ramp", "mental", "stress"}   # cognitive demand (task started)

# Live scenarios: (phase, seconds, demand at the start, demand at the end).
# 'steps': repeated calm / demand. 'ramp': demand rises gradually (the early
# warning needs time in the band between baseline and limit), then a plateau
# of moderate load without stress, which should warn little and never alert.
SCENARIOS = {
    "steps": [("calm", 240, 0, 0), ("demand", 240, 1, 1), ("calm", 240, 0, 0), ("demand", 240, 1, 1), ("calm", 300, 0, 0)],
    "ramp": [("calm", 240, 0, 0), ("ramp", 300, 0, 1), ("demand", 120, 1, 1), ("calm", 240, 0, 0),
             ("plateau", 240, 0.4, 0.4), ("calm", 240, 0, 0)],
}
HIGH_PHASES = {"demand"}                     # ground truth: high load expected
RISING_PHASES = {"ramp"}

# 'four_state': mind and body driven SEPARATELY, so each condition the app
# shows appears in turn, each followed by a full recovery (skin conductance
# needs up to ~10 min): (phase, seconds, mind demand, body demand).
#   relaxed  mind calm,   body calm     -> Relaxed / normal
#   mental   mind loaded, body calm     -> High mental load (no physical arousal)
#   arousal  mind calm,   body aroused  -> Physical arousal (movement-free: caffeine, emotion)
#   stress   mind loaded, body aroused  -> Stress
FOUR_STATE = [("relaxed", 300, 0, 0), ("mental", 420, 1, 0), ("recovery", 600, 0, 0), ("arousal", 420, 0, 1),
              ("recovery", 600, 0, 0), ("stress", 420, 1, 1), ("recovery", 600, 0, 0)]
SCENARIOS["four_state"] = [(n, d, m, m) for n, d, m, _ in FOUR_STATE]   # mind demand, for code reading SCENARIOS
EXPECTED_STATE = {"relaxed": "relaxed", "mental": "mental", "arousal": "arousal", "stress": "stress", "recovery": "relaxed"}

# Five everyday situations where mind and body vary separately, gradually and by
# different amounts: (phase, seconds, mind start, mind end, body start, body end,
# expected state). Intensities 0..1 (body 1 = WESAD TSST-sized response for the
# 'responsive' profile). expected None = in-between level, shown but not scored.
# Physical arousal is always movement-free here (seated after stairs, caffeine,
# nerves): moving windows are rejected by the ring pipeline, not scored as arousal.
SITUATIONS = {
    "exam_revision": {"title": "Exam revision at a desk", "plan": [
        ("arrive", 300, 0, 0, 0, 0, "relaxed"),
        ("light_reading", 420, 0.35, 0.35, 0, 0, None),
        ("getting_into_it", 240, 0.4, 1.0, 0, 0.05, None),
        ("hard_problems", 600, 1.0, 1.0, 0.05, 0.05, "mental"),
        ("break", 600, 0, 0, 0, 0, "relaxed")]},
    "viva_presentation": {"title": "Viva / presentation", "plan": [
        ("waiting", 300, 0.1, 0.2, 0, 0.4, None),
        ("presenting", 480, 1.0, 1.0, 0.9, 1.0, "stress"),
        ("questions", 420, 1.0, 1.0, 1.0, 0.8, "stress"),
        ("afterwards", 600, 0, 0, 0, 0, "relaxed")]},
    "stairs_coffee": {"title": "Stairs, then a coffee (body only)", "plan": [
        ("at_desk", 300, 0, 0, 0, 0, "relaxed"),
        ("after_stairs", 480, 0, 0, 1.0, 1.0, "arousal"),
        ("coffee_chat", 420, 0.15, 0.15, 0.7, 0.7, None),
        ("settle_down", 600, 0, 0, 0, 0, "relaxed")]},
    "relaxing_break": {"title": "Relaxing break with a notification", "plan": [
        ("calm", 600, 0, 0, 0, 0, "relaxed"),
        ("notification", 120, 0.2, 0.2, 0.25, 0.25, "relaxed"),
        ("calm_again", 780, 0, 0, 0, 0, "relaxed")]},
    "busy_workday": {"title": "Busy workday", "plan": [
        ("focused_email", 480, 0.8, 0.8, 0.1, 0.1, "mental"),
        ("deadline_call", 420, 1.0, 1.0, 1.0, 1.0, "stress"),
        ("rush_to_meeting", 360, 0, 0, 1.0, 1.0, "arousal"),
        ("lunch", 600, 0, 0, 0, 0, "relaxed")]},
}
for _k, _v in SITUATIONS.items():                     # mind demand, for code reading SCENARIOS
    SCENARIOS[_k] = [(n, d, m0, m1) for n, d, m0, m1, *_ in _v["plan"]]


def scenario_at(name, t):
    """(phase, demand, seconds left in the phase) at t seconds into the looping scenario."""
    sc = SCENARIOS[name]
    t = t % sum(d for _, d, _, _ in sc)
    for phase, dur, d0, d1 in sc:
        if t < dur:
            return phase, d0 + (d1 - d0) * t / dur, dur - t
        t -= dur
    return sc[-1][0], sc[-1][3], 0.0


def scenario_targets(name, t):
    """(phase, mind demand, body demand, seconds left). Body = mind except in 'four_state'."""
    if name in SITUATIONS:
        plan = SITUATIONS[name]["plan"]
        t = t % sum(p[1] for p in plan)
        for phase, dur, m0, m1, b0, b1, _ in plan:
            if t < dur:
                f = t / dur
                return phase, m0 + (m1 - m0) * f, b0 + (b1 - b0) * f, dur - t
            t -= dur
        return plan[-1][0], 0.0, 0.0, 0.0
    if name != "four_state":
        phase, d, left = scenario_at(name, t)
        return phase, d, d, left
    t = t % sum(d for _, d, _, _ in FOUR_STATE)
    for phase, dur, mind, body in FOUR_STATE:
        if t < dur:
            return phase, float(mind), float(body), dur - t
        t -= dur
    return FOUR_STATE[-1][0], 0.0, 0.0, 0.0


class VirtualUser:
    def __init__(self, profile, seed):
        self.profile = ALL_PROFILES[profile]
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

    def inject(self, kind):
        """Demo events on request: 'clench' (jaw clench burst), 'dropout' (lost
        packets: a 1-3 s gap) in the next EEG block, 'drowsy' (60 s episode)."""
        if kind == "clench":
            self.eeg.force_clench = 1
        elif kind == "dropout":
            self.eeg.force_dropout = True
        elif kind == "drowsy":
            self.drowsy_until = self.t + 60.0

    def step(self, demand, phase, body=None):
        """demand = mental demand (brain); body = physical arousal (heart, skin),
        default the same demand."""
        r, p = self.rng, self.profile
        lo = self.latent.step(demand, STEP, r, body=body)
        tapping = demand > 0.5
        if phase in MIND_PHASES:
            self.task_started = True
        if p.drift and self.task_started:                         # contact drift: creeps up, never returns
            self.drift_level = min(1.2, self.drift_level + STEP / 600.0)
        drowsy = 0.0
        if p.drowsy and phase in CALM_PHASES and self.t >= self.drowsy_until and r.random() < STEP / 240.0:
            self.drowsy_until = self.t + r.uniform(30, 90)              # an episode every ~4 min
        if self.t < self.drowsy_until:                                  # profile episode or an injected one
            drowsy = 0.8
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
