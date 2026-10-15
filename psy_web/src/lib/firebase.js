import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';
import { FIREBASE_DB_URL } from './config';

// Bare databaseURL, no auth. The app only reads, with ONE exception:
// requestRecalibration() below.
const app = getApps().length ? getApp() : initializeApp({ databaseURL: `${FIREBASE_DB_URL}/` });
export const db = getDatabase(app);

// REST shallow read -- lists child keys without downloading every block of
// every session (the client SDK has no shallow query).
export async function shallowKeys(path) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json?shallow=true`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data && typeof data === 'object' ? Object.keys(data) : [];
}

// The single write in psy_web: asks the EEG bridge (backend/psychological/
// mqtt_bridge.py) to recalibrate this session. The bridge polls
// eeg_recalibration/{sessionId} every 10 s, acts on status "requested" and
// reports its progress back to the same node. Needs the database rules to
// allow writes to eeg_recalibration/.
// opts.includeThreshold: after the rest blocks, the bridge also records
// opts.taskBlocks live blocks while the user does the high-load task and
// recalibrates the high-load threshold from them (/calibrate/threshold).
export function requestRecalibration(sessionId, userId, opts = {}) {
  return set(ref(db, `eeg_recalibration/${sessionId}`), {
    status: 'requested', source: 'psy_web', user_id: userId || null, requested_at: Date.now() / 1000,
    include_threshold: Boolean(opts.includeThreshold),
    ...(opts.includeThreshold ? { task_blocks: opts.taskBlocks || 19 } : {}),
  });
}
