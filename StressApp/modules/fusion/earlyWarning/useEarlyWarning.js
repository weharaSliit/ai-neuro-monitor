import { useEffect, useMemo, useState } from 'react';
import { ref, onValue, query, orderByKey, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import {
  calibrationPhases, eegLimitInfo, pickEeg, ringLimitInfo, sig,
} from './limits';
import { decisionGate, fusedQuadrant, gateSeries } from './condition';
import { EW_PARAMS, bodyCalibration, buildSeries, fusedCalibration } from './ewSeries';

// The app's twin of the website's useCondition + EarlyWarning computation
// (web/src/hooks/useCondition.js, web/src/components/EarlyWarning.jsx): the
// person's mind (EEG), body (ring) and overall value, each against their OWN
// calibrated limit, with the early-warning state of each. Reads the same
// Firebase records as the website and psy_web; nothing is written.
const RING_LAST = 40;          // newest ring windows, straight from Firebase (a window every ~20 s)
const DB_URL = 'https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAX_SESSIONS = 30;

function useDbValue(path, last) {
  const [value, setValue] = useState(undefined);
  useEffect(() => {
    if (!path) { setValue(undefined); return undefined; }
    setValue(undefined);
    const target = last ? query(ref(db, path), orderByKey(), limitToLast(last)) : ref(db, path);
    const stop = onValue(target, (snap) => setValue(snap.val()), () => setValue(null));
    return () => stop();
  }, [path, last]);
  return value;
}

async function getJson(path, shallow = false) {
  const res = await fetch(`${DB_URL}/${path}.json${shallow ? '?shallow=true' : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Every EEG calibration this user has, across sessions (snapshots only, never the blocks).
function useEegCalibrations(uid, refresh) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!uid) { setItems([]); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const sids = Object.keys((await getJson(`psychological/${uid}`, true)) || {})
          .filter((k) => k.startsWith('session_') || k.startsWith('wearable02_')).sort().slice(-MAX_SESSIONS);
        const got = await Promise.all(sids.map(async (sid) => {
          const [cal, thr] = await Promise.all([
            getJson(`psychological/${uid}/${sid}/calibration_result`).catch(() => null),
            getJson(`psychological/${uid}/${sid}/threshold_result`).catch(() => null),
          ]);
          return { sid, cal, thr };
        }));
        if (!cancelled) setItems(got.filter((i) => i.cal || i.thr));
      } catch { if (!cancelled) setItems([]); }
    })();
    return () => { cancelled = true; };
  }, [uid, refresh]);
  return { items };
}

// Ring window times: ISO with an offset, or a naive time written by the ring service's host
// (UTC on Render, local on a laptop) -- keep the reading closest to "now" without being ahead.
function ringMs(iso, now) {
  if (!iso) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) return Date.parse(iso);
  const utc = Date.parse(`${iso}Z`); const local = Date.parse(iso);
  const c = [utc, local].filter((t) => Number.isFinite(t) && t <= now + 60000);
  return c.length ? Math.max(...c) : (Number.isFinite(utc) ? utc : null);
}

// "12 min ago" / "3 h ago" for a reading that is not live any more (older than 3 minutes).
const oldTag = (r, now) => {
  if (!r || now - r.t <= 3 * 60000) return null;
  const m = Math.round((now - r.t) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const lastOf = (rows) => [...rows].reverse().find((r) => r.value != null) || null;

// fusionWindows: the fusion_en windows the screen already holds, { key: record }.
export default function useEarlyWarning(userId, sessionId, fusionWindows, now) {
  const base = userId && sessionId ? `psychological/${userId}/${sessionId}` : null;
  const node = useDbValue(base);
  const ringNode = useDbValue(userId && sessionId ? `physiological/predictions/${userId}/${sessionId}` : null, RING_LAST);
  const ringThresholds = useDbValue(userId ? `physiological/personal_thresholds/${userId}` : null);
  const ringBaseline = useDbValue(userId ? `physiological/baselines/${userId}` : null);
  const eegRecal = useDbValue(sessionId ? `eeg_recalibration/${sessionId}` : null);
  const ringRecal = useDbValue(userId ? `ring_recalibration/${userId}` : null);
  const calibration = node?.calibration_result || null;
  const threshold = node?.threshold_result || null;
  const history = useEegCalibrations(userId, `${sessionId}|${calibration?.updated_at ?? ''}|${threshold?.updated_at ?? ''}`);

  const blocks = useMemo(() => {
    if (!node || typeof node !== 'object') return [];
    return Object.keys(node).filter((k) => /^\d+$/.test(k) && node[k] && typeof node[k] === 'object')
      .map((k) => node[k]).sort((a, b) => (a.window ?? 0) - (b.window ?? 0)).slice(-160);
  }, [node]);
  const ringWindows = useMemo(() => Object.values(ringNode || {}).filter((w) => w && w.timestamp && w.prob_stress != null)
    .map((w) => { const { wave_gsr, ibi_sequence, ...rest } = w; return { ...rest, t: ringMs(w.timestamp, now) }; })
    .filter((w) => w.t).sort((a, b) => a.t - b.t), [ringNode, Math.floor(now / 30000)]);   // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const { cal, thr } = pickEeg({ calibration, threshold }, history, sessionId);
    const eegInfo = eegLimitInfo(cal, thr);
    const ring = { thresholds: ringThresholds || null, baseline: ringBaseline || null };
    const ringInfo = ringLimitInfo(ring);
    const phases = calibrationPhases(cal, thr, eegInfo, ring, ringInfo);
    const ringPresent = Boolean(ringBaseline) || ringWindows.length > 0;
    const gate = decisionGate({ cal, thr, ringThresholds, ringPresent, eegRecal, ringRecal, nowMs: now });
    const fusedCal = fusedCalibration(phases);
    const bodyCal = bodyCalibration(phases);
    const fw = Object.keys(fusionWindows || {}).filter((k) => /^\d+$/.test(k) && fusionWindows[k] && typeof fusionWindows[k] === 'object')
      .map((k) => ({ ...fusionWindows[k], key: Number(k) })).sort((a, b) => a.key - b.key).slice(-160);
    const ringBaseAt = ringBaseline?.updated_at
      ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(ringBaseline.updated_at) ? ringBaseline.updated_at : `${ringBaseline.updated_at}Z`) : null;
    const series = gateSeries(buildSeries({
      blocks, eegInfo, ringWindows, ringInfo, fusionWindows: fw, fusedCal, bodyCal, ringBaseAt, params: EW_PARAMS, nowMs: now,
    }), gate);
    const lastM = lastOf(series.mind); const lastB = lastOf(series.body); const lastF = lastOf(series.fused);
    const m = lastM; const b = lastB; const f = lastF;
    const calibrating = gate.paused || gate.recalibrating;
    const deciding = !calibrating && (m || b) && [m, b].some((r) => r && r.state !== 'calibrating');
    const quadrant = deciding
      ? fusedQuadrant(m && m.state !== 'calibrating' ? m.high : null, b && b.state !== 'calibrating' ? b.high : null) : null;
    return {
      gate, series, fusedCal, quadrant, deciding, phases,
      recal: { eeg: eegRecal || null, ring: ringRecal || null },
      body: { hr: ringWindows.length ? ringWindows[ringWindows.length - 1].features?.MeanHR ?? null : null,
        scl: ringWindows.length ? ringWindows[ringWindows.length - 1].features?.SCL_mean ?? null : null },
      mind: { contactOk: blocks.length ? Boolean(blocks[blocks.length - 1].eeg_quality_flag) : null },
      // calm -> limit for mind and body, in the same units as the website's boxes
      limits: {
        mind: { baseline: eegInfo ? sig(eegInfo.level) : null, limit: eegInfo ? sig(eegInfo.rawLimitL) : null,
          kind: eegInfo ? (eegInfo.responsive ? 'own limit' : 'standard') : null },
        body: { baseline: ringInfo?.base ?? null, limit: ringInfo?.limit ?? null,
          kind: ringBaseline ? (ringInfo?.personal ? 'own limit' : 'standard') : null },
      },
      now: { mind: m, body: b, fused: f },
      old: { mind: oldTag(m, now), body: oldTag(b, now), fused: oldTag(f, now) },
    };
  }, [calibration, threshold, history, ringThresholds, ringBaseline, eegRecal, ringRecal, sessionId, blocks, ringWindows, fusionWindows, Math.floor(now / 10000)]); // eslint-disable-line react-hooks/exhaustive-deps
}
