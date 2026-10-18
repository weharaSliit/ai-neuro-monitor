// Records what happens during an intervention session so it can be reviewed later on the web
// "Relaxation guide" page (evidence view). It writes small records to Firebase:
//
//   relaxation_evidence/{userId}/{sessionKey}/meta      technique, reason, context, condition ...
//   relaxation_evidence/{userId}/{sessionKey}/events    recommended / started / loop_check / switched / finished / rated / validated
//   relaxation_evidence/{userId}/{sessionKey}/samples   stress readings during the session (t, p, src)
//   relaxation_evidence/{userId}/{sessionKey}/result    the validation result (reward parts, measured recovery)
//   relaxation_evidence_index/{userId}/{sessionKey}     one light row per session (for listing users/sessions)
//
// Logging never blocks or breaks the app: every call is fire-and-forget and swallows errors
// (for example when Firebase rules do not allow the write).
import { ref, push, set, update } from 'firebase/database';
import { db } from '../../firebase';

const SAMPLE_EVERY_SEC = 5;
const lastSampleAt = {};

const clean = (obj) => {
  // Firebase rejects undefined values; keep only JSON-safe data.
  try { return JSON.parse(JSON.stringify(obj)); } catch { return null; }
};

const safe = (fn) => {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch { /* logging must never affect the app */ }
};

const base = (userId, key) => `relaxation_evidence/${userId}/${key}`;

export const newSessionKey = () => `app_${Date.now()}`;

export const evidenceLogger = {
  // Merge descriptive fields (technique, reason, context, condition, ...) into the session's meta.
  meta(userId, key, fields) {
    if (!userId || !key) return;
    const data = clean(fields);
    if (!data) return;
    safe(() => update(ref(db, `${base(userId, key)}/meta`), data));
    safe(() => update(ref(db, `relaxation_evidence_index/${userId}/${key}`), {
      at: Date.now(),
      technique_id: data.technique_id ?? null,
      condition: data.condition ?? null,
    }));
  },

  event(userId, key, type, data = {}) {
    if (!userId || !key) return;
    safe(() => push(ref(db, `${base(userId, key)}/events`), { t: Date.now() / 1000, type, data: clean(data) || {} }));
  },

  // One stress reading; throttled so a session writes about one point every few seconds.
  sample(userId, key, p, src) {
    if (!userId || !key || !Number.isFinite(p)) return;
    const nowSec = Date.now() / 1000;
    const id = `${userId}/${key}`;
    if (nowSec - (lastSampleAt[id] || 0) < SAMPLE_EVERY_SEC) return;
    lastSampleAt[id] = nowSec;
    safe(() => push(ref(db, `${base(userId, key)}/samples`), { t: nowSec, p, src: src || null }));
  },

  result(userId, key, result) {
    if (!userId || !key) return;
    safe(() => set(ref(db, `${base(userId, key)}/result`), clean(result)));
  },
};
