import { useCallback, useEffect, useState } from 'react';
import { ref, onValue, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../lib/firebase';
import { api, deviceApi, eegApi, DEVICE_ID } from '../lib/api';

const DEVICE_POLL_MS = 5000;
const EEG_LATEST_WINDOW_FRESH_SEC = 40;
// The EEG service writes a heartbeat about every 5 s while the headband streams.
const EEG_HEARTBEAT_FRESH_SEC = 20;

// Re-renders every `ms` so "x min ago"/live checks age honestly.
export function useNow(ms = 20000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// Firebase value subscription; `path` null = unsubscribed.
export function useFirebaseValue(path) {
  const [value, setValue] = useState(undefined);
  useEffect(() => {
    if (!path) { setValue(undefined); return undefined; }
    return onValue(ref(db, path), (snap) => setValue(snap.val()), () => setValue(null));
  }, [path]);
  return value;
}

// The live-session pointer the phone/web/backends all share.
export function useLivePointer() {
  const sessionId = useFirebaseValue('fusion_en_sessions/current_session_id');
  const userId = useFirebaseValue('fusion_en_sessions/current_user_id');
  return { sessionId: sessionId || null, userId: userId || null };
}

// Port of StressApp CalibrationGate.useDeviceStatus(): ring via the device
// status route, EEG via the freshness of the latest per-block record (or an
// in-progress calibration).
export function useDeviceStatus(userId) {
  const [ringOnline, setRingOnline] = useState(false);
  const eegSessionId = useFirebaseValue(userId ? 'psychological/current_session_id' : null) || null;
  const [eegLastSeen, setEegLastSeen] = useState(null);
  const calib = useFirebaseValue(userId && eegSessionId ? `psychological/${userId}/${eegSessionId}/calibration_result` : null);
  const now = useNow(DEVICE_POLL_MS);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await deviceApi.get(`/devices/${DEVICE_ID}/status`);
        if (!cancelled) setRingOnline((res.data?.status || 'offline') === 'online');
      } catch {
        if (!cancelled) setRingOnline(false);
      }
    };
    poll();
    const id = setInterval(poll, DEVICE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!userId || !eegSessionId) { setEegLastSeen(null); return undefined; }
    const q = query(ref(db, `psychological/${userId}/${eegSessionId}`), orderByChild('window'), limitToLast(1));
    return onValue(q, (snap) => {
      const data = snap.val();
      const latest = data ? Object.values(data)[0] : null;
      setEegLastSeen(latest?.timestamp_end ?? null);
    });
  }, [userId, eegSessionId]);

  const fresh = (sec) => sec != null && (now / 1000 - sec) <= EEG_LATEST_WINDOW_FRESH_SEC;
  const deviceSeen = useFirebaseValue('eeg_devices/wearable02/last_seen');
  const heartbeatFresh = deviceSeen != null && (now / 1000 - deviceSeen) <= EEG_HEARTBEAT_FRESH_SEC;
  const eegOnline = heartbeatFresh || fresh(eegLastSeen) || fresh(calib?.updated_at ?? null);
  return { ringOnline, eegOnline, eegSessionId };
}

// Port of CalibrationGate.useCalibrationSummary(): personal thresholds.
export function useCalibration(userId, token) {
  const [state, setState] = useState({ loading: true, ring: null, eeg: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    Promise.all([
      api.get(`/baseline/${userId}`).then((r) => r.data).catch(() => null),
      eegApi.get('/calibration/status').then((r) => r.data).catch(() => null),
    ]).then(([ring, eeg]) => { if (!cancelled) setState({ loading: false, ring, eeg }); });
    return () => { cancelled = true; };
  }, [userId, token, version]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, refresh };
}
