import { useEffect, useMemo, useState } from 'react';
import { shallowKeys } from '../lib/firebase';
import { toWindows } from '../lib/fusion';
import { useFirebaseValue } from './useData';

const POINTER_KEYS = new Set(['current_session_id', 'current_user_id']);

// fusion_en_sessions/current_{user,session}_id is the pointer
// fusion_live_session.py follows, so "live" is the session it is fusing now.
// Same shape as useSessionPicker() so SessionPicker renders it unchanged.
export function useFusionPicker() {
  const liveUser = useFirebaseValue('fusion_en_sessions/current_user_id') || null;
  const liveSession = useFirebaseValue('fusion_en_sessions/current_session_id') || null;
  const [follow, setFollow] = useState(true);
  const [manual, setManual] = useState({ userId: null, sessionId: null });
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);

  const userId = follow ? liveUser : manual.userId;
  const sessionId = follow ? liveSession : manual.sessionId;

  useEffect(() => {
    shallowKeys('fusion_en')
      .then((keys) => setUsers(keys.filter((k) => !POINTER_KEYS.has(k)).sort()))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!userId) { setSessions([]); return undefined; }
    let cancelled = false;
    shallowKeys(`fusion_en/${userId}`)
      .then((keys) => { if (!cancelled) setSessions(keys.sort().reverse()); })
      .catch(() => { if (!cancelled) setSessions([]); });
    return () => { cancelled = true; };
  }, [userId, liveSession]);

  return {
    follow, setFollow, liveUser, liveSession, userId, sessionId, users, sessions,
    choose: (next) => { setFollow(false); setManual((m) => ({ ...m, ...next })); },
  };
}

// fusion_en/{uid}/{sid}: one record per fusion window (EEG + HRV/GSR inputs
// and the fused result); fusion_en_sessions/{uid}/{sid}: session meta
// (baseline, start/end) plus a per-window summary.
export function useFusionData(userId, sessionId) {
  const node = useFirebaseValue(userId && sessionId ? `fusion_en/${userId}/${sessionId}` : null);
  const meta = useFirebaseValue(userId && sessionId ? `fusion_en_sessions/${userId}/${sessionId}` : null);
  return useMemo(() => ({
    loading: node === undefined,
    windows: toWindows(node),
    baseline: meta?.baseline ?? null,
    started: meta?.session_started ?? null,
    ended: meta?.session_ended ?? null,
  }), [node, meta]);
}
