"""The 8 user profiles and per-user parameter sampling.

Every virtual user gets its own baselines, effect sizes and time constants,
drawn from the ranges below (sources in brackets):
  EEG subject       a SAM40 subject from the profile's response stratum
                    [reference/sam40_reference.json shift_sd: rest->task change in
                    rest spreads through the deployed model]
  EEG headband      RMS lognormal around 11.4 uV [real good-contact wearable02 blocks]
  tau brain         onset 10-30 s, recovery 20-60 s
  tau heart         onset 15-40 s, recovery 60-120 s
  tau skin          onset 20-60 s, recovery 120-300 s
  HR baseline       76-102 bpm [real ring users' median HR]
  HR stress effect  +3..+12 bpm; RMSSD -10..-35 % [lab cognitive stress; WESAD TSST is
                    stronger: +23 bpm, RMSSD -17 %]
  SCL baseline      1.4-6.4 uS [real ring users]; stress +0.3..+2 uS
  SCR rate          rest 1-3/min, stress 4-10/min, amplitude 0.05-0.5 uS
  Ring beat jitter  tuned so SD1 matches the real ring (median ~59 ms)
  GSR noise         5 ADC counts, level re-drawn each 30-90 s (lognormal sd 0.9) -> EDA_std
                    distance from baseline matches real ring windows
  Later occasion    live monitoring happens on another day than the ring calibration (the
                    ring baseline persists): HR +-6 bpm, SCL x lognormal(0.35), variability
                    x lognormal(0.25) -- sized so live windows' distance from the stored
                    baseline matches real ring windows (MeanHR |z| ~0.5, SCL/SD1 ~1.3)
"""
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .latent import Taus

REF = Path(__file__).resolve().parents[1] / "reference"


def sam40_strata():
    subs = json.loads((REF / "sam40_reference.json").read_text())["subjects"]
    sh = {s["subject"]: s["shift_sd"] for s in subs}
    resp = REF / "responsive_subjects.json"      # simkit/responders.py
    return {
        "typical": [s for s, v in sh.items() if v >= 0.5],
        "strong": [s for s, v in sh.items() if v >= 1.2],
        "weak": [s for s, v in sh.items() if abs(v) < 0.4],
        "inverted": [s for s, v in sh.items() if v <= -0.6],
        # subjects whose simulated EEG calibration (headband layer included) passes reliably
        "responsive": json.loads(resp.read_text())["responsive"] if resp.exists() else [s for s, v in sh.items() if v >= 1.2],
        "all": list(sh),
    }


@dataclass
class Profile:
    key: str
    title: str
    eeg_stratum: str = "typical"
    ring_effect: float = 1.0          # x the sampled HR / SCL / SCR effects
    ring_present: bool = True
    artifacts: bool = False           # clench bursts, dropouts, motion, contact loss
    drowsy: bool = False
    drift: bool = False
    low_arousal: bool = False
    tests: str = ""
    body_response: str = "lab"        # 'lab': cognitive-task size below; 'wesad': WESAD baseline -> TSST class means


# WESAD (15 subjects, 913 windows; physiological_signals notebook 03), baseline -> TSST
# class means: HR 72.2 -> 95.0 bpm, RMSSD 50.1 -> 41.7 ms, SCL 1.17 -> 2.27 uS, SCRs 3.6 -> 6.8 /min.
WESAD_BODY = {"d_hr": 95.0 - 72.2, "rsa_drop": 1 - 41.7 / 50.1, "d_scl": 2.27 - 1.17, "scr_rest": 3.6, "scr_stress": 6.8}


PROFILES = {p.key: p for p in [
    Profile("typical", "Typical", "typical", 1.0, tests="Baseline performance"),
    Profile("eeg_strong_ring_weak", "EEG strong, ring weak", "strong", 0.25, tests="What EEG contributes"),
    Profile("eeg_weak_ring_strong", "EEG weak, ring strong", "weak", 1.6, tests="Fallback to body"),
    Profile("ring_missing", "Ring missing", "typical", 1.0, ring_present=False, tests="'Mind only' mode"),
    Profile("inverted", "Inverted EEG", "inverted", 1.0, tests="Direction rule + safeguards"),
    Profile("noisy", "Real-world noise", "typical", 1.0, artifacts=True, tests="Quality gates, no false alerts in dropout"),
    Profile("drowsy", "Drowsy rest", "typical", 1.0, drowsy=True, low_arousal=True, tests="No false 'load' from drowsiness"),
    Profile("drift", "Drift", "typical", 1.0, drift=True, tests="drift_suspected, fusion down-weighting"),
]}

# Live-demo profiles (live_stimulator.py, four_state_session.py): NOT part of the
# offline multi-seed study, which keeps iterating PROFILES above.
DEMO_PROFILES = {p.key: p for p in [
    Profile("responsive", "Responsive (demo)", "responsive", 1.0, body_response="wesad",
            tests="SAM40 subjects whose EEG calibration passes reliably (>= 75% of 16 virtual users, "
                  "simkit/responders.py) with a WESAD-sized body response: calibrated mind and body, all four states"),
]}
ALL_PROFILES = {**PROFILES, **DEMO_PROFILES}


@dataclass
class UserParams:
    profile: str
    seed: int
    eeg: dict = field(default_factory=dict)
    ring: dict = field(default_factory=dict)
    taus: dict = field(default_factory=dict)
    fatigue_per_hour: float = 0.0


def sample_user(profile_key, seed):
    p = ALL_PROFILES[profile_key]
    r = np.random.default_rng(seed)
    strata = sam40_strata()
    subj = int(r.choice(strata[p.eeg_stratum]))
    u = r.uniform
    taus = {"brain": Taus(u(10, 30), u(20, 60)), "heart": Taus(u(15, 40), u(60, 120)),
            "skin": Taus(u(20, 60), u(120, 300))}
    eeg = {"subject": subj, "rms_uv": float(np.clip(r.lognormal(np.log(11.4), 0.25), 6.0, 30.0)),
           "drift_frac": u(0.30, 0.50), "emg_frac": u(0.10, 0.22), "blink_rate": u(10, 20)}
    # Ring stress effects: HR +1.5..+4.5 bpm, SCL +0.15..0.6 uS, +1..2.5 skin
    # responses/min (low end of lab cognitive-stress literature; WESAD's TSST is
    # +23 bpm, AUC 0.986). Sized so the deployed ring model's AUC on simulated
    # rest-vs-task windows is ~0.90 (fidelity.py) and the ring calibration
    # separates for most users (~70 % typical). The earlier +0.9..+3.2 bpm was
    # swamped by natural heart-rate drift: live demand could read lower than
    # calm and the ring calibration was "not separated" for about half the users.
    k = p.ring_effect
    ring = {"hr0": u(76, 102) - (4 if p.low_arousal else 0), "rmssd_phys": u(25, 45),
            "d_hr": k * u(1.5, 4.5), "rsa_drop": min(0.6, k * u(0.03, 0.10)),
            "scl0": float(np.clip(r.lognormal(np.log(2.6), 0.4), 1.4, 6.4)) * (0.7 if p.low_arousal else 1.0),
            "d_scl": k * u(0.15, 0.6), "scr_rest": u(1, 3), "scr_stress": 0.0,
            "scr_amp": u(0.05, 0.3), "jitter_ms": u(30, 55), "resp_hz": u(0.2, 0.3),
            "hr_wander": 4.0, "scl_wander": 0.06, "gsr_noise": 5.0, "gsr_noise_var": 0.9,
            "motion_rate": 1.5 if p.artifacts else 0.0, "contact_loss_rate": 0.4 if p.artifacts else 0.0}
    ring["scr_stress"] = ring["scr_rest"] + k * u(1.0, 2.5)
    if p.body_response == "wesad":
        ring.update(WESAD_BODY)
    eeg["clench_rate"] = 1.0 if p.artifacts else 0.0           # per minute
    eeg["dropout_rate"] = 0.5 if p.artifacts else 0.0
    fatigue = u(0.0, 0.3)
    up = UserParams(profile_key, seed, eeg, ring, {m: (t.on, t.off) for m, t in taus.items()})
    up.fatigue_per_hour = fatigue
    return up, taus
