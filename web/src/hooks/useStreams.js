import { useEffect, useMemo, useRef, useState } from 'react';
import { ref, get, onValue, query, orderByKey, limitToLast } from 'firebase/database';
import { db } from '../lib/firebase';
import { api } from '../lib/api';
import { sortedWindowKeys } from '../lib/levels';

// Same cross-session backfill the app uses: the live session plus this
// many of the user's own prior sessions, so charts never reset on login.
export const RECENT_SESSIONS_FOR_CHART = 4;
const CHART_POINTS_MAX = 160;

function sortedValues(obj) {
  return sortedWindowKeys(obj).map((k) => obj[k]);
}

// ── Fusion (fusion_en/{uid}/{sid}) ─────────────────────────────────
// Live session pushed by Firebase; prior sessions read once (only the
// last few session keys -- orderByKey/limitToLast, not the whole tree).
export function useFusion(userId, liveSessionId) {
  const [live, setLive] = useState(null);
  const [history, setHistory] = useState({});

  useEffect(() => {
    if (!userId || !liveSessionId) { setLive(null); return undefined; }
    return onValue(ref(db, `fusion_en/${userId}/${liveSessionId}`), (snap) => setLive(snap.val()));
  }, [userId, liveSessionId]);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    get(query(ref(db, `fusion_en/${userId}`), orderByKey(), limitToLast(RECENT_SESSIONS_FOR_CHART + 1)))
      .then((snap) => {
        if (cancelled) return;
        const all = snap.val() || {};
        const merged = {};
        Object.keys(all).sort()
          .filter((sid) => sid !== liveSessionId && all[sid] && typeof all[sid] === 'object')
          .slice(-RECENT_SESSIONS_FOR_CHART)
          .forEach((sid) => Object.assign(merged, all[sid]));
        setHistory(merged);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, liveSessionId]);

  return useMemo(() => {
    const combined = { ...history, ...(live || {}) };
    const keys = sortedWindowKeys(combined).slice(-CHART_POINTS_MAX);
    const rows = keys.map((k) => ({ key: Number(k), date: new Date(Number(k) * 60000), w: combined[k] || {} }));
    const liveKeys = sortedWindowKeys(live);
    const latestKey = liveKeys.length ? Number(liveKeys[liveKeys.length - 1]) : null;
    const lastKey = keys.length ? Number(keys[keys.length - 1]) : null;
    // A new minute's window appears when the FIRST device reports; the
    // fused result lands a moment later. Reading the raw newest window in
    // that gap flashed "Calm" for a second, so each reading comes from the
    // newest window that actually has it.
    const newestWith = (ok) => {
      for (let i = liveKeys.length - 1; i >= 0; i -= 1) {
        const w = live[liveKeys[i]];
        if (w && ok(w)) return w;
      }
      return null;
    };
    const fusedLatest = newestWith((w) => w.fused_label != null && w.fused_probability != null);
    return {
      rows,
      latest: fusedLatest || (latestKey != null ? live[latestKey] : null),
      latestMind: newestWith((w) => w.prob_eeg != null),
      latestBody: newestWith((w) => w.prob_hrv_gsr != null),
      latestMs: latestKey != null ? latestKey * 60000 : null,
      lastAny: lastKey != null ? combined[lastKey] : null,
      lastAnyMs: lastKey != null ? lastKey * 60000 : null,
    };
  }, [history, live]);
}

// ── Ring predictions via the Flask history routes ──────────────────
// One poll loop: session list + latest session each tick; finished
// sessions are cached (they never change) -- the same fix as the mobile
// admin screen. `admin` switches to the /admin/... routes.
export function useRingHistory(userId, { admin = false, pollMs = 10000 } = {}) {
  const [state, setState] = useState({ loading: true, windows: [], sessions: {}, pss4: {}, history: null });
  const cache = useRef(new Map());
  const inFlight = useRef(false);
  const prefix = admin ? '/admin/history' : '/history';

  useEffect(() => {
    cache.current = new Map();
    setState({ loading: true, windows: [], sessions: {}, pss4: {}, history: null });
    if (!userId) return undefined;
    let cancelled = false;

    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const h = await api.get(`${prefix}/${userId}`).then((r) => r.data).catch(() => null);
        if (!h || cancelled) return;
        const ids = Object.keys(h.sessions || {}).sort();
        const recent = ids.slice(-RECENT_SESSIONS_FOR_CHART);
        const latestId = recent[recent.length - 1];
        const results = await Promise.all(recent.map(async (sid) => {
          if (sid !== latestId && cache.current.has(sid)) return cache.current.get(sid);
          const data = await api.get(`${prefix}/${userId}/${sid}`).then((r) => r.data).catch(() => null);
          if (data && sid !== latestId) {
            const preds = {};
            Object.entries(data.predictions || {}).forEach(([k, w]) => {
              const { wave_gsr, ibi_sequence, ...rest } = w || {};
              preds[k] = rest;
            });
            const slim = { ...data, predictions: preds, sid };
            cache.current.set(sid, slim);
            return slim;
          }
          return data ? { ...data, sid } : null;
        }));
        if (cancelled) return;
        const windows = results
          .filter(Boolean)
          .flatMap((d) => Object.values(d.predictions || {}).map((w) => ({ ...w, _sid: d.sid })))
          .filter((w) => w.timestamp)
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
          .slice(-CHART_POINTS_MAX);
        setState({ loading: false, windows, sessions: h.sessions || {}, pss4: h.pss4 || {}, history: h, perSession: results.filter(Boolean) });
      } finally {
        inFlight.current = false;
      }
    };

    tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId, prefix, pollMs]);

  return state;
}

// ── EEG blocks (psychological/{uid}/{sid}) ─────────────────────────
export function useEegBlocks(userId, liveSessionId) {
  const [live, setLive] = useState(null);
  const [history, setHistory] = useState([]);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    if (!userId || !liveSessionId) { setLive(null); return undefined; }
    return onValue(ref(db, `psychological/${userId}/${liveSessionId}`), (snap) => setLive(snap.val()));
  }, [userId, liveSessionId]);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    get(query(ref(db, `psychological/${userId}`), orderByKey(), limitToLast(RECENT_SESSIONS_FOR_CHART + 2)))
      .then((snap) => {
        if (cancelled) return;
        const all = snap.val() || {};
        const sids = Object.keys(all).sort().filter((sid) => all[sid] && typeof all[sid] === 'object');
        setSessions(sids.map((sid) => {
          const blocks = sortedValues(all[sid]);
          const last = blocks[blocks.length - 1];
          return { sid, blocks: blocks.length, label: last?.task_state_label, end: last?.timestamp_end };
        }).filter((s) => s.blocks > 0).reverse());
        setHistory(sids.filter((sid) => sid !== liveSessionId).slice(-RECENT_SESSIONS_FOR_CHART)
          .flatMap((sid) => sortedValues(all[sid])));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, liveSessionId]);

  return useMemo(() => {
    const liveBlocks = sortedValues(live);
    const blocks = [...history, ...liveBlocks]
      .filter((b) => b && b.timestamp_end)
      .sort((a, b) => a.timestamp_end - b.timestamp_end)
      .slice(-CHART_POINTS_MAX);
    return { blocks, latest: liveBlocks[liveBlocks.length - 1] || null, sessions };
  }, [history, live, sessions]);
}
