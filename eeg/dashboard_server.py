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

BROKER = "192.168.1.2"
TOPIC  = "eeg/t7t8/raw"

EPOCH_STRIDE = int(round(EPOCH_STRIDE_S * SAMPLING_RATE_HZ))   # 128
LEAD_TIME_S  = K_AHEAD * EPOCH_STRIDE_S                          # 10s

STAGE_NAMES = ["CALM", "PRE-STAGE", "STRESSED"]

ADC_CLIP_CODE       = 2 ** 23   # 24-bit ADC full-scale magnitude
ADC_CLIP_MARGIN     = 8
WINDOW_SKIP_FRAC    = 0.02      # skip an epoch if >2% of it is clipped/dropped
DROPOUT_GAP_S       = 0.05      # inter-sample gap treated as a connection dropout

RAW_BROADCAST_INTERVAL_S = 0.02   # batch raw samples ~50 msgs/sec to the browser


def _is_clipped(v: float) -> bool:
    return abs(v) >= (ADC_CLIP_CODE - ADC_CLIP_MARGIN)


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

        self.n_epochs  = 0
        self.n_alerts  = 0
        self.n_skipped = 0
        self.session_start = time.time()
        self.latest_epoch: Optional[dict] = None

        session = time.strftime("%Y%m%d_%H%M%S")
        self.csv_raw_path    = _HERE / f"eeg_raw_{session}.csv"
        self.csv_stress_path = _HERE / f"eeg_stress_{session}.csv"
        with open(self.csv_raw_path, "w", newline="") as f:
            csv.writer(f).writerow(["timestamp_ms", "ch1", "ch2"])
        with open(self.csv_stress_path, "w", newline="") as f:
            csv.writer(f).writerow([
                "time_s", "epoch", "p_emo", "risk", "alert", "stage", "skipped",
                "trend_score", "trend_alarm", "calibrating",
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
                "skipped": True,
                "trend_score": None, "trend_alarm": False, "calibrating": None,
            }
            self.n_skipped += 1
        else:
            epoch = np.stack([ch1_arr, ch2_arr])
            r = self.engine.process_epoch(epoch)
            r["epoch"]   = self.epoch_i
            r["time_s"]  = time_s
            r["skipped"] = False
            result = r
            self.n_epochs += 1
            if r["alert"]:
                self.n_alerts += 1

        self._w_stress.writerow([
            result["time_s"], result["epoch"], result["p_emo"], result["risk"],
            result["alert"], result["stage"], result["skipped"],
            result["trend_score"], result["trend_alarm"], result["calibrating"],
        ])
        self.epoch_i += 1

        payload = dict(result)
        payload["type"] = "epoch"
        self.latest_epoch = payload
        await self.broadcast(payload)


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
