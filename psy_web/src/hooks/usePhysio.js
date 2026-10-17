import { useEffect, useMemo, useState } from 'react';
import { shallowKeys } from '../lib/firebase';
import { joinQuality, pushList } from '../lib/ring';
import { useFirebaseValue } from './useData';

const NS = 'physiological';   // backend/common/firebase_config.py RTDB_NAMESPACES

// The ring bridge (backend/physiological/mqtt_bridge.py) follows
// fusion_en/current_{user,session}_id -- the pointer StressApp writes --
// so "live" here is the session it is posting ring windows under.
// Users are listed from predictions/ (never physiological/users, which
// holds login data). Same shape as useSessionPicker().
export function usePhysioPicker() {
  const liveUser = useFirebaseValue('fusion_en/current_user_id') || null;
  const liveSession = useFirebaseValue('fusion_en/current_session_id') || null;
  const [follow, setFollow] = useState(true);
  const [manual, setManual] = useState({ userId: null, sessionId: null });
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);

  const userId = follow ? liveUser : manual.userId;
  const sessionId = follow ? liveSession : manual.sessionId;

  useEffect(() => {
    shallowKeys(`${NS}/predictions`).then((k) => setUsers(k.sort())).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!userId) { setSessions([]); return undefined; }
    let cancelled = false;
    shallowKeys(`${NS}/predictions/${userId}`)
      .then((k) => { if (!cancelled) setSessions(k.sort().reverse()); })
      .catch(() => { if (!cancelled) setSessions([]); });
    return () => { cancelled = true; };
  }, [userId, liveSession]);

  return {
    follow, setFollow, liveUser, liveSession, userId, sessionId, users, sessions,
    choose: (next) => { setFollow(false); setManual((m) => ({ ...m, ...next })); },
  };
}

// Everything backend/physiological/firebase_service.py stores for one
// user + session: per-window predictions (features, GSR wave, IBI
// sequence), their quality rows, the personal baseline, the resting
// scores / personal threshold, and the device heartbeat.
export function usePhysioData(userId, sessionId) {
  const both = userId && sessionId;
  const preds = useFirebaseValue(both ? `${NS}/predictions/${userId}/${sessionId}` : null);
  const quals = useFirebaseValue(both ? `${NS}/prediction_quality/${userId}/${sessionId}` : null);
  const baseline = useFirebaseValue(userId ? `${NS}/baselines/${userId}` : null);
  const thresholds = useFirebaseValue(userId ? `${NS}/personal_thresholds/${userId}` : null);
  const session = useFirebaseValue(both ? `${NS}/sessions/${userId}/${sessionId}` : null);
  const device = useFirebaseValue(`${NS}/devices/wearable01`);
  return useMemo(() => ({
    loading: both && preds === undefined,
    windows: joinQuality(pushList(preds), pushList(quals)),
    baseline: baseline || null,
    thresholds: thresholds || null,
    session: session || null,
    device: device || null,
  }), [both, preds, quals, baseline, thresholds, session, device]);
}
