import { useEffect, useRef, useState } from 'react';
import mqtt from 'mqtt';

// Live signals straight from the two wearables, over the same EMQX WebSocket
// listener the technical dashboard (psy_web) uses. Nothing is written to
// Firebase and nothing is stored: the browser only keeps the last seconds.
//
//   ring     mindpulse/wearable01/sensors  JSON every 200 ms:
//            {device_id, ts, gsr, ir, finger, acc_x, acc_y, acc_z, ibi: [...]}
//   headband mindpulse/wearable02/eeg      "millis,code;millis,code;..." at 250 SPS
//
// Connects only while a component using it is mounted. Client ids are fixed
// (one entry per device in the broker dashboard) and differ from psy_web's, so
// the two can be open together; a second tab of this page would take over.

const MQTT_URL = 'wss://ob1f0f10.ala.asia-southeast1.emqxsl.com:8084/mqtt';

const RING = { user: 'wearable01', pass: 'wearable01', topic: 'mindpulse/wearable01/sensors', id: 'web_live_wearable01' };
const EEG = { user: 'wearable02', pass: 'wearable02', topic: 'mindpulse/wearable02/eeg', id: 'web_live_wearable02' };

const GSR_CAL = 2872;            // backend/common/config.py (ADC with electrodes off)
const RING_FINGER_IR = 50000;    // wearable01.ino: finger = ir > 50000
const UV_PER_COUNT = 0.0360608;  // ADS1292R, gain 8, VREF 2.42 V
const EEG_SECONDS = 10;
const EEG_FS = 250;
const RING_SECONDS = 30;
const RENDER_MS = 400;

// Grove GSR formula on a 10-bit scale (same as backend adc_to_conductance()).
export function adcToMicroS(adc, cal = GSR_CAL) {
  if (adc == null || !Number.isFinite(adc)) return null;
  const a = adc / 4; const c = cal / 4;
  let den = c - a;
  if (Math.abs(den) < 1) den = 1;
  let r = ((1024 + 2 * a) * 10000) / den;
  if (r <= 0) r = 1e6;
  return 1e6 / r;
}

function connect(cfg, onMessage, setConn) {
  const client = mqtt.connect(MQTT_URL, {
    clientId: cfg.id, username: cfg.user, password: cfg.pass,
    clean: true, reconnectPeriod: 3000, connectTimeout: 10000,
  });
  client.on('connect', () => { setConn('connected'); client.subscribe(cfg.topic); });
  client.on('reconnect', () => setConn('reconnecting'));
  client.on('offline', () => setConn('offline'));
  client.on('error', () => setConn('error'));
  client.on('message', (_t, payload) => onMessage(payload.toString()));
  return client;
}

export default function useLiveDevices() {
  const ringMsgs = useRef([]);
  const beats = useRef([]);
  const arrivals = useRef([]);
  const ringStats = useRef({ packets: 0, gaps: 0, malformed: 0, lastAt: null, lastTs: null });
  const eegBuf = useRef([]);
  const eegStats = useRef({ samples: 0, gaps: 0, lastAt: null, lastMillis: null });
  const [ringConn, setRingConn] = useState('connecting');
  const [eegConn, setEegConn] = useState('connecting');
  const [snap, setSnap] = useState({ ring: null, eeg: null });

  useEffect(() => {
    const ringClient = connect(RING, (text) => {
      const st = ringStats.current;
      let m;
      try { m = JSON.parse(text); } catch { st.malformed += 1; return; }
      const now = Date.now();
      if (st.lastTs != null && m.ts != null && m.ts - st.lastTs > 1000 && m.ts - st.lastTs < 600000) st.gaps += 1;
      st.lastTs = m.ts ?? st.lastTs;
      const ax = Number(m.acc_x) || 0; const ay = Number(m.acc_y) || 0; const az = Number(m.acc_z) || 0;
      ringMsgs.current.push({
        t: now, gsr: m.gsr ?? null, us: adcToMicroS(m.gsr),
        finger: m.finger ?? (m.ir != null ? m.ir > RING_FINGER_IR : null),
        acc: Math.sqrt(ax * ax + ay * ay + az * az) / 9.81,
      });
      for (const ibi of Array.isArray(m.ibi) ? m.ibi : []) {
        if (ibi >= 300 && ibi <= 2000) beats.current.push({ t: now, ibi, hr: 60000 / ibi });
      }
      const cutoff = now - RING_SECONDS * 1000;
      while (ringMsgs.current.length && ringMsgs.current[0].t < cutoff) ringMsgs.current.shift();
      while (beats.current.length && beats.current[0].t < cutoff) beats.current.shift();
      st.packets += 1; st.lastAt = now;
      arrivals.current.push(now);
    }, setRingConn);

    const eegClient = connect(EEG, (text) => {
      const st = eegStats.current;
      const now = Date.now();
      let n = 0;
      for (const rec of text.split(';')) {
        const p = rec.trim().split(',');
        if (p.length !== 2) continue;
        const millis = Number(p[0]); const code = Number(p[1]);
        if (!Number.isFinite(millis) || !Number.isFinite(code)) continue;
        if (st.lastMillis != null && millis - st.lastMillis > 12 && millis - st.lastMillis < 60000) st.gaps += 1;
        st.lastMillis = millis;
        eegBuf.current.push(code * UV_PER_COUNT);
        n += 1;
      }
      if (eegBuf.current.length > EEG_SECONDS * EEG_FS) {
        eegBuf.current.splice(0, eegBuf.current.length - EEG_SECONDS * EEG_FS);
      }
      if (n) { st.samples += n; st.lastAt = now; }
    }, setEegConn);

    const timer = setInterval(() => {
      const now = Date.now();
      arrivals.current = arrivals.current.filter((t) => now - t <= 5000);
      const span = arrivals.current.length > 1 ? (now - arrivals.current[0]) / 1000 : 0;
      const msgs = ringMsgs.current;
      const last = msgs[msgs.length - 1] || null;
      const rs = ringStats.current;
      const es = eegStats.current;

      // Headband: remove the DC level, then a one-pole high-pass (about 1 Hz)
      // so the display shows the signal and not the electrode offset.
      const raw = eegBuf.current;
      let eegWave = [];
      let rms = null;
      if (raw.length > EEG_FS) {
        const a = Math.exp(-2 * Math.PI * 1 / EEG_FS);
        let prevIn = raw[0]; let prevOut = 0;
        const hp = new Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) {
          const out = a * (prevOut + raw[i] - prevIn);
          prevIn = raw[i]; prevOut = out; hp[i] = out;
        }
        const tail = hp.slice(EEG_FS / 2);              // drop the filter start-up
        const step = Math.max(1, Math.floor(tail.length / 600));
        for (let i = 0; i < tail.length; i += step) eegWave.push(tail[i]);
        rms = Math.sqrt(tail.reduce((s, v) => s + v * v, 0) / tail.length);
      }
      setSnap({
        ring: {
          now,
          msgs: msgs.slice(),
          beats: beats.current.slice(),
          finger: last?.finger ?? null,
          us: last?.us ?? null,
          acc: last?.acc ?? null,
          rate: span >= 1 ? arrivals.current.length / span : null,
          gaps: rs.gaps, malformed: rs.malformed,
          fresh: rs.lastAt != null && now - rs.lastAt < 4000,
        },
        eeg: {
          now, wave: eegWave, rms,
          rate: es.lastAt != null && now - es.lastAt < 4000 ? EEG_FS : null,
          gaps: es.gaps, fresh: es.lastAt != null && now - es.lastAt < 4000,
        },
      });
    }, RENDER_MS);

    return () => { clearInterval(timer); ringClient.end(true); eegClient.end(true); };
  }, []);

  return { ringConn, eegConn, ...snap };
}
