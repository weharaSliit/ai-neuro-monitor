"""
Live stimulator: a virtual person wearing the EEG headband (wearable02) and
the HRV/GSR ring (wearable01), streaming over MQTT exactly like the real
devices, so the REAL pipeline handles it end to end -- the Render bridges,
the EEG and ring APIs, the fusion engine, Firebase, psy_web and StressApp.
Nothing downstream knows it isn't a person.

  EEG   mindpulse/wearable02/eeg       "millis,code;millis,code;..." batches, 250 SPS,
                                       T7-T8 bipolar ADC codes (adc.microvolts_to_bipolar_code)
  Ring  mindpulse/wearable01/sensors   JSON every 200 ms: ibi (beats that ended in this
                                       packet, ms), gsr (Grove ADC), acc_x/y/z (m/s^2), ir, finger

Users are NOT changed: the stimulator streams for whoever is logged in with
the devices (the app's device pointer), and only while someone has started
it -- otherwise the real headband and ring readings are used, as always. It
never logs anyone in, never writes the pointer, never ends a session; it
follows the logged-in session if the app rotates it, and stops by itself if
the user logs out.

What it does when started (from psy_web's Stimulator panel or --autostart):
  1. (optional, on by default) asks both devices to recalibrate for the logged-in
     user (eeg_recalibration/{sid}, ring_recalibration/{uid}) -- psy_web's Recalibrate
  2. follows the protocol the bridges report: rests through settle/rest, does the task
     (cognitive demand rises), relaxes in recovery (demand drops)
     It runs once, as asked: if the EEG calibration doesn't end 'ok' the mind shows
     'Limited' and that is reported; it is not repeated unless the user asks again.
  3. then live monitoring on a loop: 'four_state' (default; mind and body driven
     separately: relaxed 5 -> high mental load 7 (body calm) -> recovery 10 ->
     physical arousal 7 (mind calm) -> recovery 10 -> stress 7 (both) -> recovery 10 min),
     'ramp' (calm 4 -> demand rising over 5 -> demand 2 -> calm 4 -> moderate-load
     plateau 4 -> calm 4 min) or 'steps' (calm 4 -> demand 4 -> calm 4 -> demand 4 -> calm 5 min)
  Demo events on request (psy_web): dropout, jaw clench, drowsiness.

The body is simulated, not scripted: demand drives physiological states with
their own time constants (EEG ~20 s, heart ~15 s, skin conductance rises over
~40 s and decays over ~2 min), on top of natural variability -- breathing-linked
heart-rate oscillation (RSA, 0.25 Hz), slower 0.1 Hz waves, alpha waxing and
waning, slowly wandering rhythms, eye blinks, jaw/temporal muscle bursts while
tapping during the task, spontaneous skin-conductance responses, tiny movements.

Default profile 'responsive' (simkit/profiles.py DEMO_PROFILES): a SAM40 subject whose
EEG calibration passes reliably (simkit/responders.py) and a WESAD-sized body response.
Profiles (simkit/profiles.py -- the same virtual users as the offline study):
  typical, eeg_strong_ring_weak, eeg_weak_ring_strong, ring_missing, inverted,
  noisy (artifacts, dropouts), drowsy, drift. Signals: real SAM40 T7-T8 EEG +
  a headband layer measured on real wearable02 blocks; ring beats / skin
  conductance sized from real ring readings (see simkit/__init__.py).

Run on a laptop (keep it running; it idles until psy_web starts it):
  venv/bin/python backend/simulation/live_stimulator.py
  venv/bin/python backend/simulation/live_stimulator.py --autostart                 # responsive, four_state
Switch the real headband and ring OFF while it runs -- both publish on the same topics.
"""
import argparse
import json
import math
import os
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import paho.mqtt.client as mqtt
import requests
from scipy.signal import butter, sosfilt, sosfilt_zi

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backend.common.config import GSR_CAL  # noqa: E402
from backend.common.firebase_config import FIREBASE_DB_URL  # noqa: E402
from backend.psychological.realtime.adc import microvolts_to_bipolar_code  # noqa: E402

BROKER = os.environ.get("STIM_MQTT_BROKER", "ob1f0f10.ala.asia-southeast1.emqxsl.com")
PORT = 8883
CA_CERT = str(REPO / "iot_firmware" / "emqxsl-ca.crt")
EEG_TOPIC, RING_TOPIC = "mindpulse/wearable02/eeg", "mindpulse/wearable01/sensors"
EEG_AUTH = (os.environ.get("EEG_MQTT_USER", "wearable02"), os.environ.get("EEG_MQTT_PASSWORD", "wearable02"))
RING_AUTH = (os.environ.get("RING_MQTT_USER", "wearable01"), os.environ.get("RING_MQTT_PASSWORD", "wearable01"))
# Fixed client ids (one per simulated device), never per-run unique -- keeps
# the EMQX client list clean.
EEG_CLIENT_ID, RING_CLIENT_ID = "mindpulse_stimulator_eeg", "mindpulse_stimulator_ring"

FS = 250                     # headband sampling rate (realtime/resample.py SOURCE_FS)
EEG_BATCH = 50               # samples per MQTT message (~5 messages/s, like the firmware)
RING_PERIOD = 0.2            # ring packet every 200 ms
DB = FIREBASE_DB_URL.rstrip("/")
RING_RECOVERY_WINDOWS = 8       # 8 min: skin conductance needs minutes to come back down (5 left ~half drift_suspected)
PICKUP_TIMEOUT_SEC = 120         # a recalibration request nobody acts on is withdrawn after this
# Recalibration happens only when the user asks for it (psy_web Start with
# 'recalibrate', or the Recalibrate button). The stimulator never recalibrates on
# its own: an EEG calibration that ends not 'ok' is reported (the mind shows
# 'Limited') and the live scenario runs as described. 0 = no automatic retries.
MAX_EEG_RETRIES = 0
DEFAULT_PROFILE = "responsive"   # simkit.profiles DEMO_PROFILES: EEG calibration passes reliably, WESAD-sized body
DEFAULT_SCENARIO = "four_state"
POINTER_ROOTS = ("psychological", "fusion_en", "fusion_en_sessions")   # StressApp CURRENT_SESSION_ID_ROOTS  # simkit.session FOUR_STATE: relaxed, mental load, physical arousal, stress
# Live scenarios: simkit/session.py SCENARIOS ('steps' = calm/demand blocks; 'ramp' =
# gradual rise, demand, calm, moderate-load plateau, calm -- for the early warning).
RNG = np.random.default_rng()

# Safety: the stimulator calibrates the account that is logged in with the devices
# (it writes that account's ring baseline + limits and asks the headband to
# recalibrate), and everything it streams is stored under that account. On a REAL
# account that would silently replace the person's own calibration and mix simulated
# readings into their history. So it only runs for test accounts (ids starting "sim_" --
# the offline study / real_iot_ranges.py convention -- or "mp_", the accounts the team
# already uses for simulation runs), unless explicitly allowed.
SIM_USER_PREFIXES = tuple(p.strip() for p in os.environ.get("STIM_TEST_PREFIXES", "sim_,mp_").split(",") if p.strip())
ALLOW_REAL_USER = os.environ.get("STIM_ALLOW_REAL_USER") == "1"


def is_test_account(uid):
    return bool(uid) and uid.startswith(SIM_USER_PREFIXES)


# ── Firebase (REST; same open rules psy_web writes through) ─────────
def fb_get(path):
    try:
        r = requests.get(f"{DB}/{path}.json", timeout=10)
        return r.json() if r.ok else None
    except requests.RequestException:
        return None


def fb_put(path, value):
    try:
        requests.put(f"{DB}/{path}.json", data=json.dumps(value), timeout=10)
    except requests.RequestException as e:
        print(f"[firebase] write failed: {e}")


def fb_patch(path, value):
    try:
        requests.patch(f"{DB}/{path}.json", data=json.dumps(value), timeout=10)
    except requests.RequestException as e:
        print(f"[firebase] write failed: {e}")


# ── The virtual person ──────────────────────────────────────────────
class Person:
    """Demand (0 = calm, 1 = full load) drives physiological states, each
    following it with its own time constant."""

    def __init__(self, profile):
        self.profile = profile
        self.demand = 0.0
        self.eeg_load = 0.0
        self.hr_load = 0.0
        self.eda_load = 0.0
        self.tapping = False
        self.drift = 0.0                      # electrode-contact drift (profile 'drift')
        self._t = time.time()
        self.lock = threading.Lock()

    def step(self, dt=None):
        """Advance the body states; dt from the wall clock (live) or given
        (offline runs on a simulated clock, e.g. export_session_excel.py)."""
        with self.lock:
            now = time.time()
            if dt is None:
                dt = min(1.0, now - self._t)
            self._t = now
            d = self.demand

            def follow(x, tau):
                return x + (d - x) * (1 - math.exp(-dt / tau))
            self.eeg_load = follow(self.eeg_load, 20.0)
            self.hr_load = follow(self.hr_load, 15.0)
            self.eda_load = follow(self.eda_load, 40.0 if d > self.eda_load else 120.0)
            if self.profile == "drift" and self.started_task:
                self.drift = min(1.6, self.drift + dt / 600.0)   # creeps up over ~15 min, never returns

    started_task = False


# ── EEG: continuous T7-T8 signal with filter state carried across batches ─
class EEGGenerator:
    BANDS = {"theta": (4.0, 7.5), "alpha": (8.0, 12.5), "beta": (13.0, 30.0), "gamma": (30.0, 45.0)}
    REST = {"theta": 4.0, "alpha": 12.0, "beta": 2.5, "gamma": 0.6, "pink": 6.0}   # uV RMS

    def __init__(self, person):
        self.p = person
        self.sos = {k: butter(4, b, btype="bandpass", fs=FS, output="sos") for k, b in self.BANDS.items()}
        self.zi = {k: sosfilt_zi(s) * 0 for k, s in self.sos.items()}
        self.emg_sos = butter(4, (30.0, 90.0), btype="bandpass", fs=FS, output="sos")
        self.emg_zi = sosfilt_zi(self.emg_sos) * 0
        self.gain = {k: self._unit_gain(s) for k, s in self.sos.items()}
        self.emg_gain = self._unit_gain(self.emg_sos)
        self.pink_b = np.zeros(7)              # Paul Kellet's pink-noise filter state
        self.pink_scale = 1.0 / 3.3
        self.wander = {"theta": 0.0, "alpha": 0.0}     # slowly wandering rhythms (OU, tau 60 s)
        self.t = 0.0
        self.blink_left = 0
        self.millis = int(time.time() * 1000) % 1_000_000_000

    @staticmethod
    def _unit_gain(sos):
        x = sosfilt(sos, RNG.normal(size=FS * 60))
        return 1.0 / x[FS * 2:].std()

    def _pink(self, n):
        out = np.empty(n)
        b = self.pink_b
        for i, w in enumerate(RNG.normal(size=n)):
            b[0] = 0.99886 * b[0] + w * 0.0555179
            b[1] = 0.99332 * b[1] + w * 0.0750759
            b[2] = 0.96900 * b[2] + w * 0.1538520
            b[3] = 0.86650 * b[3] + w * 0.3104856
            b[4] = 0.55000 * b[4] + w * 0.5329522
            b[5] = -0.7616 * b[5] - w * 0.0168980
            out[i] = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362
            b[6] = w * 0.115926
        return out * self.pink_scale

    def batch(self, n):
        p = self.p
        dt = n / FS
        for k in self.wander:                  # OU process: tau 60 s, sd 0.12 uV
            self.wander[k] += -self.wander[k] * dt / 60.0 + 0.12 * math.sqrt(2 * dt / 60.0) * RNG.normal()
        load = p.eeg_load * {"typical": 1.0, "inverted": -1.0, "drift": 0.15}[p.profile]
        theta = self.REST["theta"] + 0.55 * load + self.wander["theta"] + 0.5 * p.drift
        alpha = self.REST["alpha"] - 1.1 * load + self.wander["alpha"] - 1.0 * p.drift
        alpha *= 1.0 + 0.15 * math.sin(2 * math.pi * 0.08 * self.t)       # alpha waxing and waning
        amps = {"theta": theta, "alpha": alpha, "beta": self.REST["beta"] + 0.3 * abs(load), "gamma": self.REST["gamma"]}
        uv = self.REST["pink"] * self._pink(n)
        for k, sos in self.sos.items():
            y, self.zi[k] = sosfilt(sos, RNG.normal(size=n), zi=self.zi[k])
            uv += amps[k] * self.gain[k] * y
        # Muscle (jaw/temporal) bursts while tapping during the task -- what T7-T8 really picks up.
        emg, self.emg_zi = sosfilt(self.emg_sos, RNG.normal(size=n), zi=self.emg_zi)
        if p.tapping and RNG.random() < 0.25:
            uv += 2.5 * self.emg_gain * emg
        # Occasional eye blink (small at temporal sites): ~10 per minute, ~300 ms.
        if self.blink_left == 0 and RNG.random() < 10 / 60 * dt:
            self.blink_left = int(0.3 * FS)
        if self.blink_left:
            k = min(n, self.blink_left)
            ph = np.linspace(0, math.pi, int(0.3 * FS))[-self.blink_left:][:k]
            uv[:k] += 18.0 * np.sin(ph)
            self.blink_left -= k
        uv += 1.5 * RNG.normal(size=n)                       # amplifier / electrode noise
        uv += 0.8 * np.sin(2 * math.pi * 50.0 * (self.t + np.arange(n) / FS))   # mains pickup (notched downstream)
        self.t += dt
        codes = microvolts_to_bipolar_code(uv)
        stamps = self.millis + (np.arange(n) * 1000 // FS)
        self.millis += n * 1000 // FS
        return ";".join(f"{int(m)},{int(c)}" for m, c in zip(stamps, codes))


# ── Ring: beats, skin conductance, movement ─────────────────────────
class RingGenerator:
    def __init__(self, person):
        self.p = person
        self.t = 0.0
        self.next_beat = 0.8
        self.scl_drift = 0.0
        self.scrs = []                        # (onset_t, amplitude)
        self.ir = 115000.0

    def packet(self):
        p = self.p
        dt = RING_PERIOD
        resp = {"typical": 1.0, "inverted": 1.0, "drift": 0.15}[p.profile]
        hl, el = p.hr_load * resp, p.eda_load * resp
        hr = 70.0 + 9.0 * hl
        hrv = 45.0 - 12.0 * hl                 # ms, variability falls under load
        beats = []
        while self.next_beat <= self.t + dt:
            ibi = (60000.0 / hr + hrv * 0.9 * math.sin(2 * math.pi * 0.25 * self.next_beat)   # RSA
                   + hrv * 0.5 * math.sin(2 * math.pi * 0.1 * self.next_beat)               # 0.1 Hz wave
                   + RNG.normal(0, hrv * 0.35))
            ibi = float(np.clip(ibi, 350.0, 1500.0))
            beats.append(round(ibi, 1))
            self.next_beat += ibi / 1000.0
        # Skin conductance: tonic level + spontaneous/demand-driven responses.
        self.scl_drift += -self.scl_drift * dt / 300.0 + 0.004 * math.sqrt(dt) * RNG.normal()
        scl = 3.0 + 0.8 * el + self.scl_drift
        if RNG.random() < (1.0 + 3.0 * el) / 60.0 * dt:
            self.scrs.append((self.t, scl * RNG.uniform(0.15, 0.45)))
        g = scl
        alive = []
        for onset, amp in self.scrs:
            s = self.t - onset
            if s < 40:
                g += amp * (1 - math.exp(-s / 1.0)) * math.exp(-s / 6.0)
                alive.append((onset, amp))
        self.scrs = alive
        R = 1e6 / max(g, 0.05)
        adc = (R * GSR_CAL - 10240000) / (R + 20000) + RNG.normal(0, 1.5)
        move = 0.25 if p.tapping and RNG.random() < 0.3 else 0.04
        ax, ay, az = RNG.normal(0, move, 3) + (0.0, 0.0, 9.81)
        self.ir += -0.02 * (self.ir - 115000.0) + RNG.normal(0, 150)
        self.t += dt
        return {"device_id": "wearable01", "ibi": beats, "gsr": int(round(adc)), "acc_x": round(float(ax), 3),
                "acc_y": round(float(ay), 3), "acc_z": round(float(az), 3), "ir": int(self.ir), "finger": True}


# ── Stimulator: control, protocol following, streaming ──────────────
class Stimulator:
    def __init__(self, profile):
        self.profile = profile
        self.running = False
        self.uid = self.sid = None
        self.person = None
        self.stage = "idle"
        self.live_started = None
        self.sent = {"eeg": 0, "ring": 0}
        self.prev_pointer = None
        self.threads = []
        self.eeg_client = self._client(EEG_CLIENT_ID, EEG_AUTH)
        self.ring_client = self._client(RING_CLIENT_ID, RING_AUTH)

    @staticmethod
    def _client(cid, auth):
        c = mqtt.Client(client_id=cid, callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        c.tls_set(ca_certs=CA_CERT)
        c.username_pw_set(*auth)
        c.connect_async(BROKER, PORT, 60)
        c.loop_start()
        return c

    # By default the LOGGED-IN user is used as is. A user_id other than the
    # logged-in one makes the stimulator act as a login for it (_claim): a new
    # session and the device pointers, exactly as StressApp's claimDevices()
    # writes them, after saving the previous pointers to stimulator/takeover;
    # stop() (or the next program start, after a crash) puts them back (_release),
    # unless a real login has claimed the devices meanwhile.
    @staticmethod
    def _pointer():
        return fb_get("fusion_en_sessions/current_user_id"), fb_get("fusion_en_sessions/current_session_id")

    @staticmethod
    def _read_pointers():
        return {root: {"uid": fb_get(f"{root}/current_user_id"), "sid": fb_get(f"{root}/current_session_id")}
                for root in POINTER_ROOTS}

    def _claim(self, uid):
        """Act as a login for uid (StressApp AuthContext startLiveSession + claimDevices)."""
        sid = datetime.now().strftime("session_%Y%m%dT%H%M%S")
        fb_put("stimulator/takeover", {"uid": uid, "sid": sid, "saved": self._read_pointers(), "at": time.time()})
        fb_patch(f"fusion_en_sessions/{uid}/{sid}", {"session_started": datetime.now(timezone.utc).isoformat(),
                                                    "simulated": True})
        updates = {}
        for root in POINTER_ROOTS:
            updates[f"{root}/current_session_id"] = sid
            updates[f"{root}/current_user_id"] = uid
        fb_patch("", updates)
        print(f"[stimulator] acting as a login for {uid} / {sid} (previous login saved)")
        return sid

    @staticmethod
    def _release(reason):
        """Restore the login saved by _claim -- only if the pointers are still the
        simulated session's (a real login since then is never overwritten)."""
        tk = fb_get("stimulator/takeover")
        if not isinstance(tk, dict) or not tk.get("uid"):
            return
        if (fb_get("fusion_en_sessions/current_user_id"), fb_get("fusion_en_sessions/current_session_id")) == (tk["uid"], tk["sid"]):
            saved = tk.get("saved") or {}
            updates = {}
            for root in POINTER_ROOTS:
                prev = saved.get(root) or {}
                updates[f"{root}/current_session_id"] = prev.get("sid")     # None removes the field
                updates[f"{root}/current_user_id"] = prev.get("uid")
            fb_patch("", updates)
            prev = saved.get("fusion_en_sessions") or {}
            print(f"[stimulator] login restored to {prev.get('uid') or 'nobody'} / {prev.get('sid') or '-'} ({reason})")
        else:
            print(f"[stimulator] devices were claimed by another login meanwhile -- left as they are ({reason})")
        fb_patch(f"fusion_en_sessions/{tk['uid']}/{tk['sid']}", {"session_ended": datetime.now(timezone.utc).isoformat()})
        fb_put("stimulator/takeover", None)

    def start(self, profile, recalibrate=True, scenario=DEFAULT_SCENARIO, user_id=None):
        if self.running:
            return "already running"
        uid, sid = self._pointer()
        self.took_over = False
        if user_id and user_id != uid:
            uid, sid = user_id, self._claim(user_id)
            self.took_over = True
        if not uid or not sid:
            return "no user is logged in with the devices -- log in on StressApp or choose a user"
        from simkit.profiles import ALL_PROFILES as PROFILES
        if profile not in PROFILES:
            return f"unknown profile '{profile}'"
        if not is_test_account(uid) and not ALLOW_REAL_USER:
            return (f"not started: '{uid}' is a real account. The simulation would replace its ring baseline, limits and EEG "
                    f"calibration and add simulated readings to its history. Log in as a test account (id starting with "
                    f"{' or '.join(repr(p) for p in SIM_USER_PREFIXES)}, e.g. sim_demo), or set STIM_ALLOW_REAL_USER=1 to run on "
                    f"this account anyway (its current calibration is then backed up to stimulator/backups/{uid}).")
        if not is_test_account(uid):
            self._backup_calibration(uid)
        self.profile, self.uid, self.sid = profile, uid, sid
        self.recalibrate, self.eeg_retries = recalibrate, 0
        if not recalibrate:
            # keep the user's calibration; close an earlier run's unfinished records
            self._close_own_records(uid, sid, "superseded: stimulator started without recalibrating")
        if recalibrate:
            now = time.time()
            self._request_eeg_calibration()
            if PROFILES[profile].ring_present:
                # Ring: calibrated HERE with the ring backend's own functions, following the
                # EEG protocol phases (simkit/ring_calibration.py). Status 'capturing' (not
                # 'requested'), so the ring API's own poller -- once deployed -- never runs a
                # second capture on top. Progress goes to the same node psy_web shows.
                fb_put(f"ring_recalibration/{uid}", {"status": "capturing", "phase": "settle", "source": "stimulator", "updated_at": now,
                                                     "mode": "local", "requested_at": now, "blocks_captured": 0,
                                                     "blocks_needed": 4, "task_windows": 7})
        # The realistic virtual user (simkit): SAM40-based EEG + headband layer, IPFM ring,
        # latent load with per-user time constants -- the same generator as the offline study.
        from simkit.session import VirtualUser
        from simkit.session import SCENARIOS
        self.scenario = scenario if scenario in SCENARIOS else DEFAULT_SCENARIO
        # The same virtual person the user was calibrated with (stimulator/persons/{uid}), so a restart
        # with another situation and no recalibration continues the same person. A NEW random person
        # (other SAM40 subject, headband amplitude and noise) would be judged against the previous
        # person's baseline and limit -- calm EEG then reads as high load. Recalibrating starts a new
        # person and remembers it for this user.
        person = fb_get(f"stimulator/persons/{uid}") or {}
        continuing = not recalibrate and person.get("seed") is not None and person.get("profile") == profile
        self.seed = int(person["seed"]) if continuing else int(time.time()) % 100000
        self.vu = VirtualUser(profile, seed=self.seed)
        if continuing:
            self.vu.eeg.t0 = 600.0                 # headband already worn and settled: no power-on transient
            self.vu.eeg.prepare_block()
        if recalibrate:
            fb_put(f"stimulator/persons/{uid}", {"seed": self.seed, "profile": profile,
                                                 "eeg_subject": self.vu.params.eeg["subject"], "calibrated_from": time.time()})
        person_warning = None if recalibrate or continuing else (
            f"{uid}'s calibration was made with a different simulated person (or the real headband): "
            f"the mind may read high while calm -- tick 'recalibrate this user first' once")
        from simkit.ring_calibration import RingCalibration
        self.ring_cal = RingCalibration() if (recalibrate and PROFILES[profile].ring_present) else None
        self.ring_cal_phase = "settle"
        self.demand, self.body, self.phase = 0.0, 0.0, "settle" if recalibrate else "calm"
        self.started_at, self.stage_since = time.time(), time.time()
        self.warnings = {"EEG": person_warning} if person_warning else {}
        self.running = True
        self.live_started = None
        self.sent = {"eeg": 0, "ring": 0}
        self.threads = [threading.Thread(target=f, daemon=True) for f in (self._stream_loop, self._mind_loop)]
        for t in self.threads:
            t.start()
        print(f"[stimulator] started for {'simulated login' if self.took_over else 'logged-in'} {uid} / {sid}, "
              f"profile {profile}, recalibrate {recalibrate}, "
              f"{'same calibrated person' if continuing else 'new person'} (seed {self.seed}, SAM40 {self.vu.params.eeg['subject']})")
        if person_warning:
            print(f"[stimulator] {person_warning}")
        return "started"

    @staticmethod
    def _backup_calibration(uid):
        """Only reached with STIM_ALLOW_REAL_USER=1: keep a copy of the account's own calibration
        (ring baseline + limits, EEG profile) before the simulation writes over it."""
        saved = {}
        for key, path in (("ring_baseline", f"physiological/baselines/{uid}"),
                          ("ring_thresholds", f"physiological/personal_thresholds/{uid}"),
                          ("eeg_profile", f"user_profiles/{uid}/eeg")):
            val = fb_get(path)
            if val and val.get("calibrated_by") != "live_stimulator":
                saved[key] = {"path": path, "value": val}
        if saved:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            fb_put(f"stimulator/backups/{uid}/{stamp}", saved)
            print(f"[stimulator] backed up {uid}'s calibration to stimulator/backups/{uid}/{stamp} ({', '.join(saved)})")

    def _request_eeg_calibration(self):
        """Same request psy_web's Recalibrate button writes, for this user's session."""
        # null clears what an earlier run on this session left in the same document (phase, live
        # points, progress). Otherwise the new request starts in that stale phase (e.g. 'rest'), and
        # when the bridge restarts the protocol at 'settle' the ring calibration is cut short.
        fb_patch(f"eeg_recalibration/{self.sid}", {"status": "requested", "source": "stimulator", "user_id": self.uid,
                                                   "requested_at": time.time(), "include_threshold": True, "task_blocks": 19,
                                                   "phase": None, "live": None, "blocks_captured": None, "handled_at": None,
                                                   "error": None})

    def _eeg_retry(self, eeg):
        """After the stimulator's own EEG calibration finished: if it didn't pass
        (mind would be 'Limited'), request it again, as the app would ask a real
        user. True when a new calibration was requested."""
        if eeg.get("source") != "stimulator" or eeg.get("status") != "done":
            return False
        thr = fb_get(f"psychological/{self.uid}/{self.sid}/threshold_result") or {}
        status = thr.get("calibration_status")
        if status in (None, "ok"):
            self.warnings.pop("EEG", None)
            return False
        if self.eeg_retries >= MAX_EEG_RETRIES:
            self.warnings["EEG"] = (f"EEG calibration {status} (SAM40 subject {self.vu.params.eeg['subject']}): "
                                    f"the mind shows 'Limited' -- recalibrate to try again")
            return False
        self.eeg_retries += 1
        self.warnings["EEG"] = f"EEG calibration {status}: recalibrating (attempt {self.eeg_retries + 1} of {MAX_EEG_RETRIES + 1})"
        print(f"[stimulator] {self.warnings['EEG']}")
        self._request_eeg_calibration()
        return True

    @staticmethod
    def _close_own_records(uid, sid, why):
        """Close this stimulator's unfinished calibration records, so no dashboard keeps
        showing 'recalibrating' for a run that no longer exists. The ring record is the
        stimulator's own (it calibrates the ring locally); the EEG record belongs to the
        bridge once picked up, so it is only closed while still unhandled ('requested')."""
        now = time.time()
        ring = fb_get(f"ring_recalibration/{uid}") or {} if uid else {}
        if ring.get("source") == "stimulator" and ring.get("status") in ("requested", "capturing", "saving"):
            fb_patch(f"ring_recalibration/{uid}", {"status": "stopped", "phase": "stopped", "error": why, "updated_at": now})
        eeg = fb_get(f"eeg_recalibration/{sid}") or {} if sid else {}
        if eeg.get("source") == "stimulator" and eeg.get("status") == "requested":
            fb_patch(f"eeg_recalibration/{sid}", {"status": "stopped", "phase": "stopped", "error": why, "updated_at": now})

    def set_scenario(self, name):
        """Switch the live scenario; it starts from its beginning. The calibration in use is kept
        (no recalibration). During calibration it takes effect when the live part starts."""
        from simkit.session import SCENARIOS
        if name not in SCENARIOS:
            return f"unknown scenario '{name}'"
        self.scenario = name
        if self.live_started is not None:
            self.live_started = time.time()
        fb_patch("stimulator/status", {"scenario": name, "ts": time.time()})
        return f"scenario -> {name}"

    def stop(self, reason="stopped"):
        if not self.running:
            return
        self.running = False
        for t in self.threads:
            if t is not threading.current_thread():
                t.join(timeout=3)
        if self.ring_cal is not None or self.recalibrate:
            self._close_own_records(self.uid, self.sid, f"stimulator {reason} before the calibration finished")
        if getattr(self, "took_over", False):
            self._release(reason)
            self.took_over = False
        self.stage = "idle"
        fb_patch("stimulator/status", {"running": False, "stage": "idle", "last_message": reason, "ts": time.time()})
        print(f"[stimulator] {reason} -- the real devices' readings apply again (user unchanged)")

    # What the person is doing: follow the calibration protocol, then the live scenario.
    def _mind_loop(self):
        while self.running:
            uid, sid = self._pointer()
            if not uid:
                self.stop("stopped: the user logged out")
                return
            if self.took_over and (uid, sid) != (self.uid, self.sid):
                # a real login claimed the devices: hand them over (stop() leaves its pointers alone)
                self.stop(f"stopped: {uid} logged in with the devices")
                return
            if uid != self.uid and not is_test_account(uid) and not ALLOW_REAL_USER:
                # Another (real) account took the devices while the simulation ran: stop at once so
                # nothing simulated is written to, or calibrated for, a real person.
                self.stop(f"stopped: '{uid}' (a real account) is now logged in with the devices")
                return
            if (uid, sid) != (self.uid, self.sid):        # the app opened a new session for the same / another user
                print(f"[stimulator] following the logged-in session: {uid} / {sid}")
                self.uid, self.sid = uid, sid
            eeg = fb_get(f"eeg_recalibration/{self.sid}") or {}
            ring = fb_get(f"ring_recalibration/{self.uid}") or {} if self.vu.ring else {}
            # A request no service picks up (e.g. the ring API on Render without the
            # recalibration poller) must not hold the whole run in "settle": after
            # PICKUP_TIMEOUT_SEC it is withdrawn (it's the stimulator's own request) and
            # reported, and the run continues with the device that did calibrate.
            for name, r, path in (("EEG", eeg, f"eeg_recalibration/{self.sid}"),):
                if (r.get("status") == "requested" and r.get("source") == "stimulator"
                        and time.time() - (r.get("requested_at") or time.time()) > PICKUP_TIMEOUT_SEC):
                    why = (f"the {name} service didn't pick up the recalibration request within "
                           f"{PICKUP_TIMEOUT_SEC // 60} min -- is the {'ring API' if name == 'ring' else 'EEG bridge'} on Render redeployed?")
                    fb_patch(path, {"status": "failed", "error": why})
                    r["status"] = "failed"
                    self.warnings[name] = why
                    print(f"[stimulator] {why}")
            if self.live_started is None and self.recalibrate and self._eeg_retry(eeg):
                eeg = {"status": "requested"}            # calm until the bridge picks the new request up
            # The protocol follows the EEG bridge's phases; the ring calibration runs alongside.
            active = [r for r in (eeg,) if r.get("status") in ("requested", "capturing", "saving")]
            phases = {r.get("phase") for r in active}
            if active:
                phase = "task" if "task" in phases else "recovery" if "recovery" in phases else (
                    "rest" if "rest" in phases else "settle")
                stage, demand = phase, 1.0 if phase == "task" else 0.0
                body = demand                             # the calibration task loads mind and body together
                # a recalibration (asked for) interrupts the scenario: it starts again from its beginning afterwards
                self.live_started = None
            else:
                if self.live_started is None:
                    self.live_started = time.time()
                    print(f"[stimulator] calibration finished -- live scenario {self.scenario!r} from its beginning")
                from simkit.session import SCENARIOS, scenario_targets
                # the selected scenario / situation runs until the user picks another one; at its end it repeats
                elapsed = time.time() - self.live_started
                name, demand, body, self.phase_left = scenario_targets(self.scenario, elapsed)
                total = sum(p[1] for p in SCENARIOS[self.scenario]) or 1
                self.scenario_pass = int(elapsed // total) + 1
                phase, stage = name, f"live: {name}"
            if active:
                self.phase_left = None
            self.phase, self.demand, self.body = phase, demand, body
            self._ring_calibration_step(phase if active else "done")
            now = time.time()
            if stage != self.stage:
                print(f"[stimulator] {self.stage} -> {stage}")
                self.stage_since = now
            self.stage = stage
            lo = self.vu.latent.loads
            ring = self.vu.ring
            hr = round(float(getattr(ring, "now_hr", 0)), 1) if ring else None
            scl = round(float(getattr(ring, "now_scl", 0)), 3) if ring else None
            # Demand timeline for the dashboards' shaded bands (own node only; every ~10 s and on change).
            if now - getattr(self, "last_tl", 0) >= 10 or stage != getattr(self, "last_tl_stage", None):
                self.last_tl, self.last_tl_stage = now, stage
                fb_patch(f"stimulator/timeline/{self.sid}/{int(now)}", {
                    "phase": phase, "demand": round(demand, 3), "body_demand": round(body, 3),
                    "brain": round(lo["brain"], 3), "heart": round(lo["heart"], 3),
                    "skin": round(lo["skin"], 3), "hr": hr, "scl": scl, "calibration": bool(active)})
            fb_patch("stimulator/status", {
                "online": True, "running": True, "ts": time.time(), "uid": self.uid, "sid": self.sid,
                "profile": self.profile, "stage": stage, "phase": phase, "demand": round(demand, 3), "body_demand": round(body, 3),
                "seed": self.seed, "scenario": self.scenario, "phase_left": getattr(self, "phase_left", None),
                "scenario_pass": getattr(self, "scenario_pass", None) if self.live_started else None,
                "scenario_since": self.live_started,
                "stage_since": getattr(self, "stage_since", now), "calibrating": bool(active),
                "hr_bpm": hr, "scl_us": scl, "started_at": self.started_at, "warnings": dict(self.warnings) or None,
                "eeg_load": round(lo["brain"], 3), "hr_load": round(lo["heart"], 3), "eda_load": round(lo["skin"], 3),
                "eeg_subject": self.vu.params.eeg["subject"], "eeg_samples": self.sent["eeg"], "ring_packets": self.sent["ring"],
                "mqtt": {"eeg": self.eeg_client.is_connected(), "ring": self.ring_client.is_connected()}})
            time.sleep(3)

    def _ring_calibration_step(self, phase):
        """Advance the local ring calibration with the protocol phase (see start())."""
        rc = self.ring_cal
        if rc is None:
            return
        path = f"ring_recalibration/{self.uid}"
        prev = self.ring_cal_phase
        # Skin conductance recovers over 2-5 min: the ring keeps recording recovery into the
        # first calm minutes of the live scenario (demand off) until it has RING_RECOVERY_WINDOWS.
        # (Also while an EEG retry settles / rests: demand is off then too.)
        if (prev == "recovery" and phase in ("done", "settle", "rest") and self.demand < 0.05 and self.body < 0.05
                and rc.n_windows("recovery") < RING_RECOVERY_WINDOWS):
            phase = "recovery"
        if prev == "rest" and phase == "settle":
            # The EEG protocol restarted (a retry, or a stale phase from an earlier run): start the
            # ring's rest again too -- finishing it on a partial minute would fail the calibration.
            rc.packets["rest"].clear()
            self.ring_cal_phase = "settle"
            fb_patch(path, {"status": "capturing", "phase": "settle", "blocks_captured": 0, "blocks_needed": 4})
            return
        if phase != prev:
            self.ring_cal_phase = phase
            if prev == "rest":
                recs, why = rc.finish_rest()
                if recs:
                    fb_put(f"physiological/baselines/{self.uid}", recs["baseline"])
                    fb_put(f"physiological/personal_thresholds/{self.uid}", recs["thresholds"])
                    fb_patch(path, {"live/rest": rc.rest_scores})
                    print(f"[stimulator] ring baseline saved for {self.uid} ({len(rc.rest_scores)} rest windows)")
                else:
                    fb_patch(path, {"updated_at": time.time(), "status": "failed", "error": f"ring baseline: {why}"})
                    self.warnings["ring"] = f"ring calibration failed: {why}"
                    self.ring_cal = None
                    return
            if prev in ("task", "recovery") and phase not in ("task", "recovery"):
                recs, why = rc.finish_task()
                if recs:
                    fb_patch(f"physiological/personal_thresholds/{self.uid}", recs["thresholds"])
                    r = rc.result
                    fb_patch(path, {"updated_at": time.time(), "status": "done", "phase": "done", "live/task": recs["task"], "live/recovery": recs["recovery"],
                                    "result": {k: r.get(k) for k in ("status", "personal_stress_threshold", "baseline", "task_level",
                                                                     "needed_separation", "recovery_mean", "recovered",
                                                                     "n_task_windows", "aba_confirmed")}})
                    print(f"[stimulator] ring threshold: {r['status']} limit {r['personal_stress_threshold']}")
                else:
                    fb_patch(path, {"updated_at": time.time(), "status": "failed", "error": f"ring threshold: {why}"})
                    self.warnings["ring"] = f"ring threshold failed: {why}"
                self.ring_cal = None
                return
        if phase in ("settle", "rest", "task", "recovery"):
            need = {"rest": 4, "task": 7, "recovery": RING_RECOVERY_WINDOWS}.get(phase)
            fb_patch(path, {"status": "capturing", "phase": phase, "updated_at": time.time(),
                            "blocks_captured": rc.n_windows(phase) if need else 0,
                            "blocks_needed": need})

    # One 0.2 s step of the virtual user per tick: 50 EEG samples + one ring packet.
    def _stream_loop(self):
        base_ms = int(time.time() * 1000) % 1_000_000_000
        nxt = time.time()
        while self.running:
            st = self.vu.step(self.demand, self.phase, body=self.body)
            keep = st["keep"]
            if keep.any():          # a dropout leaves a real gap in the device clock, as the firmware would
                codes = microvolts_to_bipolar_code(st["uv"][keep])
                ms = base_ms + st["millis"][keep]
                self.eeg_client.publish(EEG_TOPIC, ";".join(f"{int(m)},{int(c)}" for m, c in zip(ms, codes)), qos=0)
                self.sent["eeg"] += int(keep.sum())
            if st["packet"] is not None:
                if self.ring_cal is not None:
                    self.ring_cal.add(self.ring_cal_phase, st["packet"])
                self.ring_client.publish(RING_TOPIC, json.dumps(st["packet"]), qos=0)
                self.sent["ring"] += 1
            nxt += RING_PERIOD
            time.sleep(max(0.0, nxt - time.time()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    from simkit.profiles import ALL_PROFILES as PROFILES
    from simkit.session import SCENARIOS
    ap.add_argument("--profile", default=DEFAULT_PROFILE, choices=list(PROFILES))
    ap.add_argument("--autostart", action="store_true", help="start now instead of waiting for psy_web")
    ap.add_argument("--no-recalibrate", action="store_true", help="stream only; keep the user's current thresholds")
    ap.add_argument("--scenario", default=DEFAULT_SCENARIO, choices=list(SCENARIOS))
    args = ap.parse_args()
    stim = Stimulator(args.profile)
    Stimulator._release("restored at program start: a previous run ended without stopping")
    if args.autostart:
        print(stim.start(args.profile, recalibrate=not args.no_recalibrate, scenario=args.scenario))
    print("[stimulator] ready -- start/stop it from psy_web (Calibration, scores & alerts -> Stimulator), Ctrl+C to quit")
    last_nonce = (fb_get("stimulator/control") or {}).get("nonce")
    try:
        while True:
            ctl = fb_get("stimulator/control") or {}
            if ctl.get("nonce") and ctl.get("nonce") != last_nonce:
                last_nonce = ctl["nonce"]
                if ctl.get("command") == "start":
                    msg = stim.start(ctl.get("profile") or DEFAULT_PROFILE, recalibrate=ctl.get("recalibrate", True) is not False,
                                     scenario=ctl.get("scenario") or DEFAULT_SCENARIO, user_id=ctl.get("user_id") or None)
                    fb_patch("stimulator/status", {"last_message": msg, "ts": time.time()})
                elif ctl.get("command") == "scenario" and stim.running:
                    # Switch the live scenario (e.g. to one of the five situations) without recalibrating.
                    print(f"[stimulator] {stim.set_scenario(ctl.get('scenario'))}")
                elif ctl.get("command") == "inject" and stim.running and ctl.get("kind") in ("dropout", "clench", "drowsy"):
                    # Demo events on request, logged so the dashboard can mark them.
                    stim.vu.inject(ctl["kind"])
                    fb_patch(f"stimulator/events/{stim.sid}/{int(time.time() * 1000)}", {"kind": ctl["kind"]})
                    print(f"[stimulator] injected: {ctl['kind']}")
                elif ctl.get("command") == "stop":
                    stim.stop()
                    fb_patch("stimulator/status", {"last_message": "stopped", "running": False, "stage": "idle", "ts": time.time()})
            if not stim.running:
                fb_patch("stimulator/status", {"online": True, "running": False, "stage": "idle", "ts": time.time(),
                                               "mqtt": {"eeg": stim.eeg_client.is_connected(), "ring": stim.ring_client.is_connected()}})
            time.sleep(3)
    except KeyboardInterrupt:
        stim.stop()
        fb_patch("stimulator/status", {"online": False, "running": False, "stage": "idle", "ts": time.time()})


if __name__ == "__main__":
    main()
