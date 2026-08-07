"""
dashboard_server.py — WebSocket bridge: MQTT EEG stream -> browser dashboard.

Subscribes to the same MQTT topic as eeg_stress_live.py ("eeg/t7t8/raw",
T7 + T8 dry electrodes referenced to REF), runs the raw stream through the
SAME trained preprocessing + stress-detection pipeline used everywhere else
in this project (real_time_inference.StressInferenceEngine: bandpass ->
z-score -> 76-dim student features -> StudentMLP -> SpiralLSTM), and
streams both the raw waveform and per-epoch stress results to any
connected WebSocket client for the React clinical dashboard.

Epochs whose window overlaps ADC clipping or a connection dropout are
skipped rather than fed to the model, mirroring the guard added to
eeg_stress_live.py's offline `diagnose` pipeline.

Run:
    uvicorn dashboard_server:app --host 0.0.0.0 --port 8000
"""

import asyncio
import csv
import json
import sys
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
import paho.mqtt.client as mqtt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "models"))

from real_time_inference import (         # noqa: E402
    StressInferenceEngine, SAMPLING_RATE_HZ, EPOCH_SAMPLES, EPOCH_STRIDE_S,
    ALERT_THRESH, K_AHEAD,
)
from trend_detector import FixedBaseline  # noqa: E402
from alert_queue import AlertQueue, StageEdgeWatcher, BooleanAlarmWatcher  # noqa: E402

BROKER = "localhost"   # mosquitto runs on this same Mac (brew services) — using
                        # localhost instead of the LAN IP means this never needs
                        # to change again, regardless of what IP the router hands
                        # out (the ESP32 still needs the real LAN IP — see the
                        # DHCP reservation note in the .ino sketch).
TOPIC  = "eeg/t7t8/raw"

EPOCH_STRIDE = int(round(EPOCH_STRIDE_S * SAMPLING_RATE_HZ))   # 128
LEAD_TIME_S  = K_AHEAD * EPOCH_STRIDE_S                          # 10s

STAGE_NAMES = ["CALM", "PRE-STAGE", "STRESSED"]

ADC_CLIP_CODE       = 2 ** 23   # 24-bit ADC full-scale magnitude
ADC_CLIP_MARGIN     = 8
WINDOW_SKIP_FRAC    = 0.02      # skip an epoch if >2% of it is clipped/dropped
DROPOUT_GAP_S       = 0.05      # inter-sample gap treated as a connection dropout

RAW_BROADCAST_INTERVAL_S = 0.02   # batch raw samples ~50 msgs/sec to the browser

MC_SAMPLES = 15   # MC-Dropout samples for SpiralLSTM risk uncertainty per epoch —
                  # surfaces honest confidence rather than a bare point estimate
                  # (see StressInferenceEngine._mc_risk; small enough to stay
                  # well under the 0.5s epoch cadence on CPU)


def _is_clipped(v: float) -> bool:
    return abs(v) >= (ADC_CLIP_CODE - ADC_CLIP_MARGIN)


CHANNEL_PNG_BAND_SIGMA = 2   # shaded "within baseline" band, matches ChannelBaselineChart.tsx

def save_channel_baseline_png(csv_path: Path, png_path: Path):
    """
    Render a static PNG snapshot of the live 'Channel Deviation from
    Identified Baseline (T7 / T8)' dashboard chart (see
    eeg-dashboard/src/components/ChannelBaselineChart.tsx) from this
    session's logged CSV. Called once at server shutdown so every session
    gets a saved figure alongside its eeg_raw_*.csv / eeg_stress_*.csv,
    without needing the browser tab open or a manual screenshot.
    """
    import pandas as pd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    df = pd.read_csv(csv_path)
    df = df[df["skipped"] == False]  # noqa: E712 — drop clip/dropout-guarded epochs
    if df.empty:
        print(f"[PNG] Skipped channel-baseline chart — no valid epochs in {csv_path.name}")
        return

    specs = [
        ("ch1_level", "ch1_baseline_mu", "ch1_baseline_sigma", "#1f77b4", "T7"),
        ("ch2_level", "ch2_baseline_mu", "ch2_baseline_sigma", "#d2691e", "T8"),
    ]
    deviate_color = "#d62728"

    fig, axes = plt.subplots(2, 1, figsize=(11, 6), sharex=True)
    for ax, (level_col, mu_col, sigma_col, color, label) in zip(axes, specs):
        sub = df.dropna(subset=[level_col])
        if sub.empty:
            ax.set_title(f"{label} — no data")
            continue

        mu_series = sub[mu_col].dropna()
        sigma_series = sub[sigma_col].dropna()
        if len(mu_series) and len(sigma_series):
            mu = float(mu_series.iloc[-1])
            sigma = float(sigma_series.iloc[-1])
            band = CHANNEL_PNG_BAND_SIGMA * sigma
            ax.axhspan(mu - band, mu + band, color=color, alpha=0.12,
                       label=f"baseline ±{CHANNEL_PNG_BAND_SIGMA}σ")
            ax.axhline(mu, color=color, linestyle="--", linewidth=1, alpha=0.6)
            deviating = (sub[level_col] - mu).abs() > band
        else:
            deviating = pd.Series(False, index=sub.index)

        ax.plot(sub["time_s"], sub[level_col], color=color, linewidth=1.2, label=f"{label} level")
        if deviating.any():
            ax.scatter(sub.loc[deviating, "time_s"], sub.loc[deviating, level_col],
                       color=deviate_color, s=10, zorder=3,
                       label=f">{CHANNEL_PNG_BAND_SIGMA}σ from baseline")

        ax.set_ylabel(f"{label} level")
        ax.legend(loc="upper right", fontsize=8)
        ax.grid(alpha=0.2)

    axes[-1].set_xlabel("time (s)")
    fig.suptitle("Channel Deviation from Identified Baseline (T7 / T8)")
    fig.tight_layout()
    fig.savefig(png_path, dpi=150)
    plt.close(fig)
    print(f"[PNG] Saved channel-baseline chart -> {png_path}")


class DashboardState:
    """Owns the MQTT link, the preprocessing/inference pipeline, and the set
    of connected WebSocket clients that get streamed the results."""

    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.sample_queue: "asyncio.Queue[tuple[float, float, float]]" = asyncio.Queue()

        self.mqtt_client = None
        self.mqtt_connected = False
        self.engine = None
        self.models_available = False

        self.epoch_ch1 = deque(maxlen=EPOCH_SAMPLES)
        self.epoch_ch2 = deque(maxlen=EPOCH_SAMPLES)
        self.epoch_ts  = deque(maxlen=EPOCH_SAMPLES)
        self.new_count = 0
        self.epoch_i   = 0

        # Per-channel raw-signal baseline (same fixed ~30s calibrate-then-freeze
        # design as trend_detector.FixedBaseline, reused here on each channel's
        # per-epoch signal level (std) rather than on p_emo) — lets the dashboard
        # show how T7/T8 are drifting from this user's own resting level.
        self.ch1_baseline = FixedBaseline()
        self.ch2_baseline = FixedBaseline()

        self.n_epochs  = 0
        self.n_alerts  = 0
        self.n_skipped = 0
        self.session_start = time.time()
        self.latest_epoch: Optional[dict] = None

        self.session = time.strftime("%Y%m%d_%H%M%S")
        self.csv_raw_path    = _HERE / f"eeg_raw_{self.session}.csv"
        self.csv_stress_path = _HERE / f"eeg_stress_{self.session}.csv"
        self.channel_png_path = _HERE / f"eeg_channel_baseline_{self.session}.png"

        # Trend/alarm episode recording + hand-off to the (separate,
        # out-of-scope) stress-intervention system — see alert_queue.py.
        # AlertQueue is process-wide (append-only, survives restarts);
        # StageEdgeWatcher is per-session state that turns this session's
        # stage transitions into onset/escalate/de-escalate/end events.
        self.alert_queue = AlertQueue()
        self.stage_watcher = StageEdgeWatcher(
            queue=self.alert_queue, session_id=self.session
        )
        # shock_alarm can flip on/off several times within one PRE-STAGE
        # episode without `stage` itself changing (see BooleanAlarmWatcher
        # docstring) — archived independently so each shock is captured.
        self.shock_watcher = BooleanAlarmWatcher(
            queue=self.alert_queue, session_id=self.session,
            result_key="shock_alarm", label="shock",
        )

        with open(self.csv_raw_path, "w", newline="") as f:
            csv.writer(f).writerow(["timestamp_ms", "ch1", "ch2"])
        with open(self.csv_stress_path, "w", newline="") as f:
            csv.writer(f).writerow([
                "time_s", "epoch", "p_emo", "risk", "alert", "stage", "alert_type", "skipped",
                "trend_score", "trend_alarm", "calibrating",
                "feature_dist", "feature_dist_mu", "feature_dist_sigma",
                "feature_trend_score", "feature_trend_alarm",
                "shock_alarm", "p_shock_z", "feature_shock_z",
                "risk_std", "confidence",
                "ch1_level", "ch2_level",
                "ch1_baseline_mu", "ch1_baseline_sigma",
                "ch2_baseline_mu", "ch2_baseline_sigma",
                "channel_calibrating",
            ])
        self._f_raw    = open(self.csv_raw_path, "a", newline="", buffering=1)
        self._f_stress = open(self.csv_stress_path, "a", newline="", buffering=1)
        self._w_raw    = csv.writer(self._f_raw)
        self._w_stress = csv.writer(self._f_stress)

        print("Loading stress inference models ...")
        try:
            self.engine = StressInferenceEngine(alert_thresh=ALERT_THRESH)
            self.models_available = True
        except FileNotFoundError as e:
            print(f"[WARN] Models unavailable: {e}")
            print("[WARN] Running in RAW-ONLY mode (waveform only, no stress detection).")

    # ── MQTT ──────────────────────────────────────────────────
    def start_mqtt(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

        def on_connect(c, *args):
            reason_code = args[2]
            if reason_code == 0:
                c.subscribe(TOPIC)
                self.mqtt_connected = True
                print(f"[MQTT] Connected to {BROKER}  |  subscribed to {TOPIC}")
            else:
                print(f"[MQTT] Connection refused (reason={reason_code}) — retrying ...")

        def on_disconnect(*args):
            self.mqtt_connected = False
            print("[MQTT] Disconnected — auto-reconnecting ...")

        def on_message(c, userdata, msg):
            try:
                parts = msg.payload.decode().strip().split(",")
                ts, ch1, ch2 = float(parts[0]), float(parts[1]), float(parts[2])
                self.loop.call_soon_threadsafe(
                    self.sample_queue.put_nowait, (ts, ch1, ch2)
                )
            except Exception as e:
                print(f"[MQTT PARSE ERROR] {e}  payload={msg.payload!r}")

        client.on_connect    = on_connect
        client.on_disconnect = on_disconnect
        client.on_message    = on_message
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        try:
            client.connect_async(BROKER, 1883, 60)
        except Exception as e:
            print(f"[MQTT] Initial connect failed ({e}) — will retry in background.")
        client.loop_start()
        self.mqtt_client = client

    # ── broadcast helpers ────────────────────────────────────────
    async def broadcast(self, message: dict):
        if not self.clients:
            return
        payload = json.dumps(message)
        dead = []
        for ws in self.clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def config_message(self):
        alert_thresh = self.engine.alert_thresh if self.engine is not None else ALERT_THRESH
        return {
            "type": "config",
            "sampling_rate_hz": SAMPLING_RATE_HZ,
            "epoch_stride_s": EPOCH_STRIDE_S,
            "epoch_samples": EPOCH_SAMPLES,
            "alert_thresh": alert_thresh,
            "lead_time_s": LEAD_TIME_S,
            "stage_names": STAGE_NAMES,
            "models_available": self.models_available,
        }

    def status_message(self):
        return {
            "type": "status",
            "mqtt_connected": self.mqtt_connected,
            "models_available": self.models_available,
            "n_epochs": self.n_epochs,
            "n_alerts": self.n_alerts,
            "n_skipped": self.n_skipped,
            "elapsed_s": round(time.time() - self.session_start, 1),
        }

    # ── main drain / inference loop ─────────────────────────────
    async def run(self):
        raw_batch = []
        last_flush  = time.monotonic()
        last_status = time.monotonic()

        while True:
            try:
                ts, ch1, ch2 = await asyncio.wait_for(self.sample_queue.get(), timeout=0.2)
            except asyncio.TimeoutError:
                ts = None

            if ts is not None:
                self._w_raw.writerow([ts, ch1, ch2])

                clipped = _is_clipped(ch1) or _is_clipped(ch2)
                raw_batch.append({"t": ts, "ch1": ch1, "ch2": ch2, "clipped": clipped})

                self.epoch_ch1.append(ch1)
                self.epoch_ch2.append(ch2)
                self.epoch_ts.append(ts)
                self.new_count += 1

                if (self.new_count >= EPOCH_STRIDE and
                        len(self.epoch_ch1) == EPOCH_SAMPLES):
                    self.new_count = 0
                    await self._process_epoch()

            now = time.monotonic()
            if raw_batch and (now - last_flush) >= RAW_BROADCAST_INTERVAL_S:
                await self.broadcast({"type": "raw_batch", "samples": raw_batch})
                raw_batch = []
                last_flush = now

            if now - last_status >= 1.0:
                await self.broadcast(self.status_message())
                last_status = now

    async def _process_epoch(self):
        ts_arr  = np.array(self.epoch_ts)
        ch1_arr = np.array(self.epoch_ch1, dtype=np.float32)
        ch2_arr = np.array(self.epoch_ch2, dtype=np.float32)

        clip_frac = float(
            (np.abs(ch1_arr) >= ADC_CLIP_CODE - ADC_CLIP_MARGIN).mean() +
            (np.abs(ch2_arr) >= ADC_CLIP_CODE - ADC_CLIP_MARGIN).mean()
        ) / 2.0
        dt = np.diff(ts_arr) / 1000.0
        gap_frac = float((dt > DROPOUT_GAP_S).sum()) / max(len(dt), 1)

        time_s  = round(self.epoch_i * EPOCH_STRIDE_S, 2)
        skipped = (clip_frac > WINDOW_SKIP_FRAC) or (gap_frac > 0) or self.engine is None

        if skipped:
            result = {
                "epoch": self.epoch_i, "time_s": time_s,
                "p_emo": None, "risk": None, "alert": False, "stage": None,
                "alert_type": None, "skipped": True,
                "trend_score": None, "trend_alarm": False, "calibrating": None,
                "feature_dist": None, "feature_dist_mu": None, "feature_dist_sigma": None,
                "feature_trend_score": None, "feature_trend_alarm": False,
                "shock_alarm": False, "p_shock_z": None, "feature_shock_z": None,
                "risk_std": None, "confidence": None,
                "ch1_level": None, "ch2_level": None,
                "ch1_baseline_mu": self.ch1_baseline.mu if self.ch1_baseline.ready else None,
                "ch1_baseline_sigma": self.ch1_baseline.sigma if self.ch1_baseline.ready else None,
                "ch2_baseline_mu": self.ch2_baseline.mu if self.ch2_baseline.ready else None,
                "ch2_baseline_sigma": self.ch2_baseline.sigma if self.ch2_baseline.ready else None,
                "channel_calibrating": not (self.ch1_baseline.ready and self.ch2_baseline.ready),
            }
            self.n_skipped += 1
        else:
            epoch = np.stack([ch1_arr, ch2_arr])
            r = self.engine.process_epoch(epoch, mc_samples=MC_SAMPLES)
            r["epoch"]   = self.epoch_i
            r["time_s"]  = time_s
            r["skipped"] = False
            r.setdefault("risk_std", None)
            r.setdefault("confidence", None)

            # Per-channel signal level (epoch std, DC-offset-free) fed into
            # the same fixed-baseline design used for p_emo (see
            # trend_detector.FixedBaseline) so the dashboard can show T7/T8
            # deviating from THIS user's own resting level, not an absolute
            # threshold.
            ch1_level = float(np.std(ch1_arr))
            ch2_level = float(np.std(ch2_arr))
            self.ch1_baseline.update(time_s, ch1_level)
            self.ch2_baseline.update(time_s, ch2_level)

            r["ch1_level"] = ch1_level
            r["ch2_level"] = ch2_level
            r["ch1_baseline_mu"]    = self.ch1_baseline.mu if self.ch1_baseline.ready else None
            r["ch1_baseline_sigma"] = self.ch1_baseline.sigma if self.ch1_baseline.ready else None
            r["ch2_baseline_mu"]    = self.ch2_baseline.mu if self.ch2_baseline.ready else None
            r["ch2_baseline_sigma"] = self.ch2_baseline.sigma if self.ch2_baseline.ready else None
            r["channel_calibrating"] = not (self.ch1_baseline.ready and self.ch2_baseline.ready)

            result = r
            self.n_epochs += 1
            if r["alert"]:
                self.n_alerts += 1

        self._w_stress.writerow([
            result["time_s"], result["epoch"], result["p_emo"], result["risk"],
            result["alert"], result["stage"], result["alert_type"], result["skipped"],
            result["trend_score"], result["trend_alarm"], result["calibrating"],
            result["feature_dist"], result["feature_dist_mu"], result["feature_dist_sigma"],
            result["feature_trend_score"], result["feature_trend_alarm"],
            result["shock_alarm"], result["p_shock_z"], result["feature_shock_z"],
            result["risk_std"], result["confidence"],
            result["ch1_level"], result["ch2_level"],
            result["ch1_baseline_mu"], result["ch1_baseline_sigma"],
            result["ch2_baseline_mu"], result["ch2_baseline_sigma"],
            result["channel_calibrating"],
        ])
        self.epoch_i += 1

        # Trend/alarm episode record + hand-off to the stress-intervention
        # system's local queue (see alert_queue.py) — fires only on a
        # stage CHANGE, not every epoch.
        self.stage_watcher.update(result["time_s"], result)
        self.shock_watcher.update(result["time_s"], result)

        payload = dict(result)
        payload["type"] = "epoch"
        self.latest_epoch = payload
        await self.broadcast(payload)

    # ── shutdown ─────────────────────────────────────────────────
    def close(self):
        """Flush and close the session's CSV files so they're safe to
        read back (e.g. for save_channel_baseline_png) once the server
        is stopping."""
        for f in (self._f_raw, self._f_stress):
            try:
                f.close()
            except Exception:
                pass
        self.alert_queue.close()


state = DashboardState()


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    state.start_mqtt(loop)
    task = asyncio.create_task(state.run())
    yield
    task.cancel()
    if state.mqtt_client is not None:
        state.mqtt_client.loop_stop()
    state.close()
    try:
        save_channel_baseline_png(state.csv_stress_path, state.channel_png_path)
    except Exception as e:
        print(f"[PNG] Failed to save channel-baseline chart: {e}")


app = FastAPI(title="AI NeuroMonitor Dashboard Bridge", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/status")
def api_status():
    return {**state.config_message(), **state.status_message()}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    state.clients.add(websocket)
    await websocket.send_text(json.dumps(state.config_message()))
    await websocket.send_text(json.dumps(state.status_message()))
    if state.latest_epoch is not None:
        await websocket.send_text(json.dumps(state.latest_epoch))
    try:
        while True:
            await websocket.receive_text()   # keep-alive; client messages ignored
    except WebSocketDisconnect:
        state.clients.discard(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
