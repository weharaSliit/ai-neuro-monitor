"""Ring generator (wearable01): what the ring publishes every 200 ms --
beat intervals detected on the device (ms), Grove GSR ADC, accelerometer.

Heart: integral pulse-frequency modulation (IPFM) -- a beat fires each time
the integral of the instantaneous heart rate reaches 1. Instantaneous rate =
user baseline + stress effect + respiratory sinus arrhythmia (breathing
0.2-0.3 Hz) + Mayer waves (~0.1 Hz) + slow 1/f wander. Stress lowers RSA
(RMSSD -10..-35 %) and raises HR (+3..+12 bpm, per user; WESAD lab stress is
larger, +23 bpm, but a cognitive task is milder). The ring's own beat
detection adds timing jitter, occasional missed beats (interval doubled) and
extra beats (interval split) -- the real ring's RMSSD/SD1 are far above
physiology for this reason (reference: SD1 median ~59 ms).

Skin: tonic level (user baseline 1.4-6.4 uS from real ring users) + stress
rise (0.3-2 uS) with slow recovery, temperature drift, and phasic responses
(SCRs) as a Poisson process -- non-specific SCRs at rest (1-3/min), more under
stress (4-10/min), amplitudes 0.05-0.5 uS, Bateman-shaped.

Artifacts (by profile): movement (acc spikes + corrupted beats), contact loss
(GSR jumps to the open-circuit ADC value).
"""
import math

import numpy as np

from backend.common.config import GSR_CAL

PERIOD = 0.2      # s between packets
FS = 5


class RingSource:
    def __init__(self, rng, hr0, rmssd_phys, d_hr, rsa_drop, scl0, d_scl, scr_rest, scr_stress,
                 scr_amp, jitter_ms, resp_hz, motion_rate=0.0, contact_loss_rate=0.0, hr_wander=3.0, scl_wander=0.06, gsr_noise=1.5, gsr_noise_var=0.0):
        self.r = rng
        self.hr0, self.d_hr, self.rsa_drop = hr0, d_hr, rsa_drop
        self.rsa_ms = rmssd_phys            # physiological beat-to-beat variability scale
        self.scl0, self.d_scl = scl0, d_scl
        self.scr_rest, self.scr_stress, self.scr_amp = scr_rest, scr_stress, scr_amp
        self.jitter = jitter_ms
        self.resp_hz = resp_hz
        self.motion_rate, self.contact_loss_rate = motion_rate, contact_loss_rate
        self.hr_wander, self.scl_wander = hr_wander, scl_wander   # slow minute-to-minute variability
        # GSR measurement noise (ADC counts) whose level changes every ~minute
        # (contact pressure, small movements): real ring EDA_std varies widely.
        self.gsr_noise, self.gsr_noise_var = gsr_noise, gsr_noise_var
        self.noise_now, self.noise_until = gsr_noise, -1.0
        self.t = 0.0
        self.phase = 0.0                    # IPFM integral
        self.wander = 0.0
        self.temp = 0.0
        self.scrs = []
        self.loss_until = -1.0
        self.motion_until = -1.0
        self.last_beat_t = 0.0
        self.ir = 115000.0

    def later_occasion(self, hr_sd, scl_sd, var_sd):
        """Monitoring on a later occasion than the calibration: day-to-day
        shifts of heart rate, skin level and beat variability (sized from real
        ring windows vs their users' stored baselines)."""
        r = self.r
        self.hr0 += r.normal(0, hr_sd)
        self.scl0 *= r.lognormal(0, scl_sd)
        f = r.lognormal(0, var_sd)
        self.rsa_ms *= f
        self.jitter *= f

    def packet(self, heart, skin, arousal=0.0, tapping=False):
        r, dt = self.r, PERIOD
        # ── heart (IPFM at 50 Hz sub-steps) ──
        beats = []
        sub = 10
        for i in range(sub):
            t = self.t + i * dt / sub
            self.wander += -self.wander * (dt / sub) / 90.0 + self.hr_wander * math.sqrt(2 * (dt / sub) / 90.0) * r.normal()
            hr = (self.hr0 + self.d_hr * heart + 6.0 * arousal + self.wander
                  + (self.rsa_ms / 1000.0) * (self.hr0 ** 2 / 60.0) * 0.9 * (1 - self.rsa_drop * heart)
                  * math.sin(2 * math.pi * self.resp_hz * t)
                  + 1.5 * math.sin(2 * math.pi * 0.1 * t + 1.3))
            self.phase += max(30.0, hr) / 60.0 * dt / sub
            if self.phase >= 1.0:
                self.phase -= 1.0
                ibi = (t - self.last_beat_t) * 1000.0
                self.last_beat_t = t
                if ibi < 250:
                    continue
                ibi += r.normal(0, self.jitter)                     # ring detection jitter
                u = r.random()
                if u < 0.012:
                    continue                                        # missed beat -> next interval doubles
                if u < 0.018:
                    beats += [round(ibi * 0.45, 1), round(ibi * 0.55, 1)]
                    continue
                if t < self.motion_until:
                    ibi *= r.uniform(0.6, 1.6)
                beats.append(round(float(np.clip(ibi, 250, 2500)), 1))
        # ── skin ──
        self.temp += -self.temp * dt / 300.0 + self.scl_wander * math.sqrt(2 * dt / 300.0) * r.normal()
        scl = self.scl0 * (1 + self.temp) + self.d_scl * skin
        self.now_hr, self.now_scl = hr, scl          # for the live stimulator's status (display only)
        rate = self.scr_rest + (self.scr_stress - self.scr_rest) * skin + 4.0 * arousal
        if r.random() < rate / 60.0 * dt:
            self.scrs.append((self.t, self.scr_amp * r.lognormal(0, 0.5) * (1 + 1.5 * arousal)))
        g = scl
        alive = []
        for onset, amp in self.scrs:
            s = self.t - onset
            if s < 40:
                g += amp * 2.6 * (math.exp(-s / 2.0) - math.exp(-s / 0.75))   # Bateman, peak ~amp
                alive.append((onset, amp))
        self.scrs = alive
        if self.contact_loss_rate and self.t >= self.loss_until and r.random() < self.contact_loss_rate / 60 * dt:
            self.loss_until = self.t + r.uniform(2, 10)
        if self.t < self.loss_until:
            adc = GSR_CAL - r.uniform(0, 15)                        # open circuit
        else:
            R = 1e6 / max(g, 0.05)
            if self.t >= self.noise_until:
                self.noise_now = self.gsr_noise * r.lognormal(0, self.gsr_noise_var)
                self.noise_until = self.t + r.uniform(30, 90)
            adc = (R * GSR_CAL - 10240000) / (R + 20000) + r.normal(0, self.noise_now)
        # ── movement ──
        if self.motion_rate and self.t >= self.motion_until and r.random() < self.motion_rate / 60 * dt:
            self.motion_until = self.t + r.uniform(1, 4)
        move = 2.5 if self.t < self.motion_until else (0.25 if tapping and r.random() < 0.3 else 0.04)
        ax, ay, az = r.normal(0, move, 3) + (0.0, 0.0, 9.81)
        self.ir += -0.02 * (self.ir - 115000.0) + r.normal(0, 150)
        self.t += dt
        return {"device_id": "wearable01", "ibi": beats, "gsr": int(round(adc)), "acc_x": round(float(ax), 3),
                "acc_y": round(float(ay), 3), "acc_z": round(float(az), 3), "ir": int(self.ir), "finger": True}


def window_arrays(packets):
    """60 s of packets -> the arrays the ring bridge builds (|acc| in g)."""
    ibi = [b for d in packets for b in d["ibi"]]
    gsr = [d["gsr"] for d in packets]
    acc = [math.sqrt(d["acc_x"] ** 2 + d["acc_y"] ** 2 + d["acc_z"] ** 2) / 9.81 for d in packets]
    return ibi, gsr, acc
