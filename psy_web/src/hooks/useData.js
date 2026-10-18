import { useEffect, useMemo, useState } from 'react';
import { setPicker, usePickerStore } from './pickerStore';
import { limitToLast, onValue, orderByKey, query, ref } from 'firebase/database';
import { db, shallowKeys } from '../lib/firebase';
import { EEG_API_BASE } from '../lib/config';

// Re-renders every `ms` so "x s ago" labels age honestly.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// Firebase value subscription; `path` null = unsubscribed.
// undefined = loading, null = empty/denied.
// opts.last: only the newest N children of the node (keys are time-ordered push ids / grid
// keys) -- a live page doesn't need to download a whole session on every update, which was
// what made the ring panels lag behind (each window carries its GSR wave and beat series).
export function useFirebaseValue(path, opts) {
  const [value, setValue] = useState(undefined);
  const last = opts?.last ?? null;
  useEffect(() => {
    if (!path) { setValue(undefined); return undefined; }
    setValue(undefined);
    const target = last ? query(ref(db, path), orderByKey(), limitToLast(last)) : ref(db, path);
    return onValue(target, (snap) => setValue(snap.val()), () => setValue(null));
  }, [path, last]);
  return value;
}

const POINTER_KEYS = new Set(['current_session_id', 'current_user_id']);

// psychological/current_{user,session}_id is the pointer mqtt_bridge.py
// itself follows, so "live" here means exactly the session the bridge is
// currently posting wearable02 blocks under.
export function useSessionPicker() {
  const liveUser = useFirebaseValue('psychological/current_user_id') || null;
  const liveSession = useFirebaseValue('psychological/current_session_id') || null;
  const { follow, userId: pickedUser, sessionId: pickedSession } = usePickerStore();
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);

  const userId = follow ? liveUser : pickedUser;
  // The picked session, unless this page has no such session for the user: then its newest.
  const sessionId = follow ? liveSession
    : pickedSession && (!sessions.length || sessions.includes(pickedSession)) ? pickedSession : (sessions[0] || pickedSession);

  useEffect(() => {
    shallowKeys('psychological')
      .then((keys) => setUsers(keys.filter((k) => !POINTER_KEYS.has(k)).sort()))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!userId) { setSessions([]); return; }
    let cancelled = false;
    shallowKeys(`psychological/${userId}`)
      .then((keys) => { if (!cancelled) setSessions(keys.sort().reverse()); })
      .catch(() => { if (!cancelled) setSessions([]); });
    return () => { cancelled = true; };
  }, [userId, liveSession]);

  return {
    follow, liveUser, liveSession, userId, sessionId, users, sessions,
    setFollow: (f) => setPicker({ follow: f }),
    choose: (next) => setPicker({ follow: false, ...next }),
  };
}

// One session node holds the window-keyed block records plus the
// calibration_result / threshold_result snapshots (firebase_service.py).
export function useSessionData(userId, sessionId) {
  const node = useFirebaseValue(userId && sessionId ? `psychological/${userId}/${sessionId}` : null);
  return useMemo(() => {
    if (!node || typeof node !== 'object') {
      return { loading: node === undefined, blocks: [], calibration: null, threshold: null };
    }
    const blocks = Object.keys(node)
      .filter((k) => /^\d+$/.test(k) && node[k] && typeof node[k] === 'object')
      .map((k) => node[k])
      .sort((a, b) => (a.window ?? 0) - (b.window ?? 0));
    return {
      loading: false,
      blocks,
      calibration: node.calibration_result || null,
      threshold: node.threshold_result || null,
    };
  }, [node]);
}

// GET /health is the only unauthenticated EEG API route; polled for model
// identity, block length and which sessions the server currently holds.
export function useHealth(pollMs = 30000, base = EEG_API_BASE) {
  const [state, setState] = useState({ loading: true, data: null, error: null, latencyMs: null, at: null });
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const t0 = performance.now();
      try {
        // 45s: Render free tier cold-starts slowly (same as mqtt_bridge.py).
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(45000) });
        const data = await res.json();
        if (!cancelled) setState({ loading: false, data, error: res.ok ? null : `HTTP ${res.status}`, latencyMs: Math.round(performance.now() - t0), at: Date.now() });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: e?.message || 'unreachable', at: Date.now() }));
      }
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs, base]);
  return state;
}
