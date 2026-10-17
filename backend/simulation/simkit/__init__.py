"""simkit -- realistic software-in-the-loop simulator for MindPulse (SIMULATED).

Self-contained: imports backend code read-only and never changes the
deployed pipeline (users, devices, bridges, APIs, fusion). Signal ranges come
from real IoT readings (reference/real_iot_ranges.json), SAM40
(reference/sam40_reference.json) and WESAD class statistics.

  latent.py    demand -> per-modality loads (separate onset / recovery time constants),
               fatigue, unrelated arousal events
  profiles.py  the 8 user profiles and per-user parameter sampling
  eeg.py       hybrid EEG: real SAM40 T7-T8 trials + measured headband layer
  ring.py      beat intervals (IPFM, RSA, Mayer waves, ring detection jitter),
               skin conductance (tonic + Poisson SCRs), movement, artifacts
  session.py   protocol driver (calibration + live scenario)
  evaluate.py  runs sessions through the real backend code, metrics, multi-seed
  fidelity.py  simulated vs real ranges and model AUC
"""
GENERATOR_VERSION = "simkit-2.0"
