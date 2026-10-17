import { useEffect, useState } from 'react';
import { FIREBASE_DB_URL } from '../lib/config';
import { shallowKeys } from '../lib/firebase';

const MAX_SESSIONS = 30;   // newest sessions checked per user

async function getJson(path) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Every EEG calibration this user has, across sessions: for each session,
// only its calibration_result and threshold_result snapshots are fetched
// (never the blocks). Oldest first. `refresh` re-runs it (e.g. when the
// selected session's own calibration changes).
export default function useEegCalibrations(uid, refresh) {
  const [state, setState] = useState({ loading: false, items: [] });
  useEffect(() => {
    if (!uid) { setState({ loading: false, items: [] }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const sids = (await shallowKeys(`psychological/${uid}`)).filter((k) => k.startsWith('session_') || k.startsWith('wearable02_'))
          .sort().slice(-MAX_SESSIONS);
        const items = await Promise.all(sids.map(async (sid) => {
          const [cal, thr] = await Promise.all([
            getJson(`psychological/${uid}/${sid}/calibration_result`).catch(() => null),
            getJson(`psychological/${uid}/${sid}/threshold_result`).catch(() => null),
          ]);
          return { sid, cal, thr };
        }));
        if (!cancelled) setState({ loading: false, items: items.filter((i) => i.cal || i.thr) });
      } catch {
        if (!cancelled) setState({ loading: false, items: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [uid, refresh]);
  return state;
}
