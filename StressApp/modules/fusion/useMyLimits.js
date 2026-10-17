import { useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';
import { calibrationPhases, eegLimitInfo, pickEeg, ringLimitInfo } from '../shared/limits';

// Everything the "Your calm level & limits" screen needs, from the same
// Firebase paths as psy_web's Calibration, scores & alerts dashboard:
//   fusion_en/{uid}/{sid}                     live mind / body / overall windows
//   psychological/{uid}/{sid}/calibration_result, threshold_result   EEG calibration
//   physiological/personal_thresholds/{uid}, baselines/{uid}          ring calibration
//   eeg_recalibration/{sid}                   a recalibration in progress (live blocks)
// All subscriptions, so the screen updates by itself when a value changes.
const DB_URL = 'https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAX_SESSIONS = 30;

function useValue(path) {
  const [v, setV] = useState(undefined);
  useEffect(() => {
    if (!path) { setV(null); return undefined; }
    return onValue(ref(db, path), (s) => setV(s.val()), () => setV(null));
  }, [path]);
  return v;
}

const getJson = async (path, q = '') => {
  const res = await fetch(`${DB_URL}/${path}.json${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// The user's EEG calibrations across sessions (only the two result nodes,
// never the blocks), oldest first -- used when the live session has none.
function useEegHistory(uid, refresh) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!uid) { setItems([]); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const keys = Object.keys((await getJson(`psychological/${uid}`, '?shallow=true')) || {})
          .filter((k) => k.startsWith('session_') || k.startsWith('wearable02_')).sort().slice(-MAX_SESSIONS);
        const all = await Promise.all(keys.map(async (sid) => {
          const [cal, thr] = await Promise.all([
            getJson(`psychological/${uid}/${sid}/calibration_result`).catch(() => null),
            getJson(`psychological/${uid}/${sid}/threshold_result`).catch(() => null),
          ]);
          return { sid, cal, thr };
        }));
        if (!cancelled) setItems(all.filter((i) => i.cal || i.thr));
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, refresh]);
  return items;
}

const sortedWindows = (obj) => (obj ? Object.keys(obj).filter((k) => /^\d+$/.test(k))
  .sort((a, b) => Number(a) - Number(b)).map((k) => ({ ...obj[k], key: Number(k) })) : []);

export default function useMyLimits(uid) {
  const sid = useValue(uid ? 'fusion_en_sessions/current_session_id' : null) || null;
  const fusionRaw = useValue(uid && sid ? `fusion_en/${uid}/${sid}` : null);
  const calibration = useValue(uid && sid ? `psychological/${uid}/${sid}/calibration_result` : null);
  const threshold = useValue(uid && sid ? `psychological/${uid}/${sid}/threshold_result` : null);
  const thresholds = useValue(uid ? `physiological/personal_thresholds/${uid}` : null);
  const baseline = useValue(uid ? `physiological/baselines/${uid}` : null);
  const recal = useValue(sid ? `eeg_recalibration/${sid}` : null);
  const history = useEegHistory(uid, `${sid}|${calibration?.updated_at ?? ''}|${threshold?.updated_at ?? ''}`);

  return useMemo(() => {
    const ring = { thresholds: thresholds || null, baseline: baseline || null };
    const { cal, thr } = pickEeg({ calibration, threshold }, { items: history }, sid);
    const eegInfo = eegLimitInfo(cal, thr);
    const ringInfo = ringLimitInfo(ring);
    return {
      loading: fusionRaw === undefined && calibration === undefined,
      sid, windows: sortedWindows(fusionRaw), cal, thr, eegInfo, ringInfo,
      phases: calibrationPhases(cal, thr, eegInfo, ring, ringInfo),
      recal: recal || null,
    };
  }, [sid, fusionRaw, calibration, threshold, thresholds, baseline, recal, history]);
}
