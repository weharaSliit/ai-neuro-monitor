import { useEffect, useRef, useState } from 'react';
import mqtt from 'mqtt';
import {
  MQTT_CLIENT_ID, MQTT_PASS, MQTT_TOPIC_EEG, MQTT_TOPIC_STATUS, MQTT_URL, MQTT_USER,
  RAW_WINDOW_SEC, SOURCE_FS, UV_PER_COUNT,
} from '../lib/config';

const MAX_SAMPLES = RAW_WINDOW_SEC * SOURCE_FS;
const RATE_WINDOW_MS = 5000;
const RENDER_EVERY_MS = 200;
// At 250 SPS consecutive samples are 4ms apart; a millis gap above this
// means the ADS1292R produced frames that never arrived (corrupt frame or
// MQTT publish drop) -- same idea as raw_cleaning.py's timing_ok().
const GAP_MS = 12;

// Same wire format realtime/mqtt_client.py::parse_bipolar_payload() reads:
// "millis,code;millis,code;..."
function parseBipolar(payload) {
  const out = [];
  for (const rec of payload.split(';')) {
    const parts = rec.trim().split(',');
    if (parts.length !== 2) continue;
    const millis = Number(parts[0]);
    const code = Number(parts[1]);
    if (Number.isFinite(millis) && Number.isFinite(code)) out.push({ millis, code });
  }
  return out;
}

export default function useRawStream() {
  const buf = useRef([]);
  const arrivals = useRef([]); // [wallMs, nSamples] for the effective-rate estimate
  const stats = useRef({ packets: 0, samples: 0, malformed: 0, gaps: 0, missing: 0, lastPacketAt: null });
  const [conn, setConn] = useState({ state: 'connecting', error: null });
  const [status, setStatus] = useState({ online: null, heartbeat: null, heartbeatAt: null });
  const [snapshot, setSnapshot] = useState({ samples: [], stats: stats.current, rate: null });

  useEffect(() => {
    const client = mqtt.connect(MQTT_URL, {
      clientId: MQTT_CLIENT_ID,
      username: MQTT_USER,
      password: MQTT_PASS,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
    });

    client.on('connect', () => {
      setConn({ state: 'connected', error: null });
      client.subscribe([MQTT_TOPIC_EEG, MQTT_TOPIC_STATUS]);
    });
    client.on('reconnect', () => setConn((c) => ({ ...c, state: 'reconnecting' })));
    client.on('offline', () => setConn((c) => ({ ...c, state: 'offline' })));
    client.on('error', (e) => setConn({ state: 'error', error: e?.message || String(e) }));

    client.on('message', (topic, payload) => {
      const text = payload.toString();
      if (topic === MQTT_TOPIC_STATUS) {
        try {
          const msg = JSON.parse(text);
          // Firmware sends two shapes: {"status":"ONLINE","mode":...} on
          // connect, {"uptime_ms":..,"drdy_ok":..} every 5s.
          if (msg.status) setStatus((s) => ({ ...s, online: msg }));
          else setStatus((s) => ({ ...s, heartbeat: msg, heartbeatAt: Date.now() }));
        } catch { /* ignore non-JSON status */ }
        return;
      }
      const samples = parseBipolar(text);
      const st = stats.current;
      if (!samples.length) { st.malformed += 1; return; }
      const prev = buf.current[buf.current.length - 1];
      let last = prev?.millis;
      for (const s of samples) {
        if (last != null) {
          const dt = s.millis - last;
          if (dt > GAP_MS && dt < 60000) {
            st.gaps += 1;
            st.missing += Math.round(dt / (1000 / SOURCE_FS)) - 1;
          }
        }
        last = s.millis;
        buf.current.push({ millis: s.millis, code: s.code, uv: s.code * UV_PER_COUNT });
      }
      if (buf.current.length > MAX_SAMPLES) buf.current.splice(0, buf.current.length - MAX_SAMPLES);
      const now = Date.now();
      st.packets += 1;
      st.samples += samples.length;
      st.lastPacketAt = now;
      st.lastPayload = text;
      arrivals.current.push([now, samples.length]);
    });

    const timer = setInterval(() => {
      const now = Date.now();
      arrivals.current = arrivals.current.filter(([t]) => now - t <= RATE_WINDOW_MS);
      const n = arrivals.current.reduce((a, [, k]) => a + k, 0);
      const span = arrivals.current.length > 1 ? (now - arrivals.current[0][0]) / 1000 : 0;
      setSnapshot({
        samples: buf.current.slice(),
        stats: { ...stats.current },
        rate: span >= 1 ? n / span : null,
      });
    }, RENDER_EVERY_MS);

    return () => {
      clearInterval(timer);
      client.end(true);
    };
  }, []);

  return { conn, status, ...snapshot };
}
