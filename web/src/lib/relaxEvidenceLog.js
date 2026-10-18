// Writes the same evidence records the mobile app writes (StressApp/.../utils/evidenceLogger.js), so
// sessions played on the web appear in the admin evidence view too. Fire-and-forget: a failed write
// (for example blocked by database rules) never affects the page.
import { get, limitToLast, orderByKey, push, query, ref, set, update } from 'firebase/database';
import { db } from './firebase';

const SAMPLE_EVERY_SEC = 5;
const lastSampleAt = {};
const base = (userId, key) => `relaxation_evidence/${userId}/${key}`;
const clean = (obj) => { try { return JSON.parse(JSON.stringify(obj)); } catch { return null; } };
const safe = (fn) => { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* ignore */ } };

export const newWebSessionKey = () => `web_${Date.now()}`;

export const relaxLog = {
  meta(userId, key, fields) {
    if (!userId || !key) return;
    const data = clean(fields);
    if (!data) return;
    safe(() => update(ref(db, `${base(userId, key)}/meta`), data));
    safe(() => update(ref(db, `relaxation_evidence_index/${userId}/${key}`), {
      at: Date.now(), technique_id: data.technique_id ?? null, condition: data.condition ?? null,
    }));
  },
  event(userId, key, type, data = {}) {
    if (!userId || !key) return;
    safe(() => push(ref(db, `${base(userId, key)}/events`), { t: Date.now() / 1000, type, data: clean(data) || {} }));
  },
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

// Latest phenotyping stress score (0..1) for users without a live ring/earbud on the web.
export async function latestPhenoScore(userId) {
  try {
    const snap = await get(query(ref(db, `phenotyping/predictions/${userId}`), orderByKey(), limitToLast(1)));
    const val = snap.val();
    if (!val) return null;
    const rec = Object.values(val)[0];
    const score = typeof rec?.stress_score === 'number' ? rec.stress_score : (typeof rec?.probability === 'number' ? rec.probability : null);
    return score == null ? null : Math.max(0, Math.min(1, score));
  } catch { return null; }
}
