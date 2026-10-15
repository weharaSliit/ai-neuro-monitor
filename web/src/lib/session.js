import { ref, get, update } from 'firebase/database';
import { db } from './firebase';

// Same live-session pointer contract as StressApp/context/AuthContext.js.
// The web is a second screen, so it is careful never to steal a session
// the phone owns:
//   - nobody live            -> web starts a session (exactly like the app)
//   - same user already live -> web joins that session (no new pointer)
//   - different user live    -> web is view-only (pointer untouched)
// On logout the web ends the session only if the web started it.
const CURRENT_SESSION_ID_FIELD = 'current_session_id';
const CURRENT_USER_ID_FIELD = 'current_user_id';
const CURRENT_SESSION_ID_ROOTS = ['psychological', 'fusion_en', 'fusion_en_sessions'];

function mintSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `session_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T`
    + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function readLivePointer() {
  const [sid, uid] = await Promise.all([
    get(ref(db, `fusion_en_sessions/${CURRENT_SESSION_ID_FIELD}`)),
    get(ref(db, `fusion_en_sessions/${CURRENT_USER_ID_FIELD}`)),
  ]);
  return { sessionId: sid.val() || null, userId: uid.val() || null };
}

// Returns { sessionId, mode: 'started' | 'joined' | 'view' }.
export async function attachSession(userId) {
  let live = { sessionId: null, userId: null };
  try { live = await readLivePointer(); } catch { /* offline: fall through to start */ }

  if (live.sessionId && live.userId === userId) {
    return { sessionId: live.sessionId, mode: 'joined' };
  }
  if (live.sessionId && live.userId && live.userId !== userId) {
    return { sessionId: null, mode: 'view' };
  }

  const sessionId = mintSessionId();
  const updates = {
    [`fusion_en_sessions/${userId}/${sessionId}/session_started`]: new Date().toISOString(),
  };
  for (const root of CURRENT_SESSION_ID_ROOTS) {
    updates[`${root}/${CURRENT_SESSION_ID_FIELD}`] = sessionId;
    updates[`${root}/${CURRENT_USER_ID_FIELD}`] = userId;
  }
  try {
    await update(ref(db), updates);
  } catch (e) {
    console.warn('[live_session] start failed:', e?.message);
  }
  return { sessionId, mode: 'started' };
}

// Explicit, user-confirmed takeover of the shared device pointer. Used when
// another account (typically a phone user who is only tracking phone habits and
// never signed out) is holding it, so the ring and headband keep being
// attributed to them. Ends their live session cleanly and starts ours; the
// ring / EEG bridges follow the pointer exactly as they do for any login.
// Their phone keeps writing its own phenotyping windows under its own session
// path, which does not touch ours.
export async function takeOverSession(userId) {
  let live = { sessionId: null, userId: null };
  try { live = await readLivePointer(); } catch { /* offline: just start */ }

  const sessionId = mintSessionId();
  const nowIso = new Date().toISOString();
  const updates = {
    [`fusion_en_sessions/${userId}/${sessionId}/session_started`]: nowIso,
  };
  if (live.sessionId && live.userId && live.userId !== userId) {
    updates[`fusion_en_sessions/${live.userId}/${live.sessionId}/session_ended`] = nowIso;
  }
  for (const root of CURRENT_SESSION_ID_ROOTS) {
    updates[`${root}/${CURRENT_SESSION_ID_FIELD}`] = sessionId;
    updates[`${root}/${CURRENT_USER_ID_FIELD}`] = userId;
  }
  await update(ref(db), updates);
  return { sessionId, mode: 'started' };
}

export async function endSession(userId, sessionId) {
  if (!userId || !sessionId) return;
  // Only clear the pointer if it still points at our session -- the phone
  // may have taken over since.
  let live = { sessionId: null };
  try { live = await readLivePointer(); } catch { /* ignore */ }
  const updates = {
    [`fusion_en_sessions/${userId}/${sessionId}/session_ended`]: new Date().toISOString(),
  };
  if (live.sessionId === sessionId) {
    for (const root of CURRENT_SESSION_ID_ROOTS) {
      updates[`${root}/${CURRENT_SESSION_ID_FIELD}`] = null;
      updates[`${root}/${CURRENT_USER_ID_FIELD}`] = null;
    }
  }
  try {
    await update(ref(db), updates);
  } catch (e) {
    console.warn('[live_session] end failed:', e?.message);
  }
}
