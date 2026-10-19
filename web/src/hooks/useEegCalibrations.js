import { useEffect, useState } from 'react';

// Every EEG calibration this user has, across sessions (port of
// psy_web/src/hooks/useEegCalibrations.js): for each session only its
// calibration_result and threshold_result are fetched (never the blocks).
// Oldest first. A change of `refresh` re-runs it. Lets a new app session keep
// the user's last completed calibration until they recalibrate (lib/limits pickEeg).
const DB = 'https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAX_SESSIONS = 30;

async function getJson(path, shallow = false) {
  const res = await fetch(`${DB}/${path}.json${shallow ? '?shallow=true' : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function useEegCalibrations(uid, refresh) {
  const [state, setState] = useState({ loading: false, items: [] });
  useEffect(() => {
    if (!uid) { setState({ loading: false, items: [] }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const sids = Object.keys((await getJson(`psychological/${uid}`, true)) || {})
          .filter((k) => k.startsWith('session_') || k.startsWith('wearable02_')).sort().slice(-MAX_SESSIONS);
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
