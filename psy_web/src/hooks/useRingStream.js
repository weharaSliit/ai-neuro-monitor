import { useEffect, useRef, useState } from 'react';
import mqtt from 'mqtt';
import {
  MQTT_RING_CLIENT_ID, MQTT_RING_PASS, MQTT_RING_USER, MQTT_TOPIC_RING, MQTT_URL, RING_FINGER_IR, RING_WINDOW_SEC,
} from '../lib/config';
import { adcToMicroS } from '../lib/ring';

const RATE_WINDOW_MS = 5000;
const RENDER_EVERY_MS = 500;
// Messages are 200 ms apart; a device-ts jump above this means some never arrived.
const GAP_MS = 1000;

// Live wearable01 messages, the same JSON backend/physiological/mqtt_bridge.py
// reads: {device_id, ts, gsr, ir, finger, acc_x, acc_y, acc_z, ibi: [...]}.
// Raw readings never reach Firebase, so this is the only live view of them.
// Connects only while the component using it is mounted.
export default function useRingStream() {
  const buf = useRef([]);     // one entry per message
  const beats = useRef([]);   // one entry per IBI beat
  const arrivals = useRef([]);
  const stats = useRef({ packets: 0, beats: 0, malformed: 0, gaps: 0, lastPacketAt: null, lastPayload: null });
  const [conn, setConn] = useState({ state: 'connecting', error: null });
  const [snapshot, setSnapshot] = useState({ msgs: [], beats: [], stats: stats.current, rate: null });

  useEffect(() => {
    const client = mqtt.connect(MQTT_URL, {
      clientId: MQTT_RING_CLIENT_ID,
      username: MQTT_RING_USER,
      password: MQTT_RING_PASS,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
    });
    client.on('connect', () => { setConn({ state: 'connected', error: null }); client.subscribe(MQTT_TOPIC_RING); });
    client.on('reconnect', () => setConn((c) => ({ ...c, state: 'reconnecting' })));
    client.on('offline', () => setConn((c) => ({ ...c, state: 'offline' })));
    client.on('error', (e) => setConn({ state: 'error', error: e?.message || String(e) }));

    client.on('message', (_topic, payload) => {
      const st = stats.current;
      let m;
      try { m = JSON.parse(payload.toString()); } catch { st.malformed += 1; return; }
      const now = Date.now();
      const prev = buf.current[buf.current.length - 1];
      if (prev?.ts != null && m.ts != null && m.ts - prev.ts > GAP_MS && m.ts - prev.ts < 600000) st.gaps += 1;
      const ax = Number(m.acc_x) || 0; const ay = Number(m.acc_y) || 0; const az = Number(m.acc_z) || 0;
      buf.current.push({
        t: now, ts: m.ts, ir: m.ir ?? null, gsr: m.gsr ?? null, us: adcToMicroS(m.gsr),
        finger: m.finger ?? (m.ir != null ? m.ir > RING_FINGER_IR : null),
        acc: Math.sqrt(ax * ax + ay * ay + az * az) / 9.81,
      });
      for (const ibi of Array.isArray(m.ibi) ? m.ibi : []) {
        beats.current.push({ t: now, ibi, hr: ibi > 0 ? 60000 / ibi : null });
        st.beats += 1;
      }
      const cutoff = now - RING_WINDOW_SEC * 1000;
      while (buf.current.length && buf.current[0].t < cutoff) buf.current.shift();
      while (beats.current.length && beats.current[0].t < cutoff) beats.current.shift();
      st.packets += 1; st.lastPacketAt = now; st.lastPayload = payload.toString(); st.device = m.device_id;
      arrivals.current.push(now);
    });

    const timer = setInterval(() => {
      const now = Date.now();
      arrivals.current = arrivals.current.filter((t) => now - t <= RATE_WINDOW_MS);
      const span = arrivals.current.length > 1 ? (now - arrivals.current[0]) / 1000 : 0;
      setSnapshot({
        msgs: buf.current.slice(), beats: beats.current.slice(), stats: { ...stats.current },
        rate: span >= 1 ? arrivals.current.length / span : null,
      });
    }, RENDER_EVERY_MS);

    return () => { clearInterval(timer); client.end(true); };
  }, []);

  return { conn, ...snapshot };
}
