import { useSyncExternalStore } from 'react';

// The user / session being looked at, shared by every tab and remembered across
// reloads. Each page used to build its own picker, so choosing a user on one tab
// was forgotten on the next (the selectors showed "select" and the tab was empty).
// Now there is one selection: follow the live user, or the last user and session
// the person picked. Stored in localStorage; if that is blocked it still works
// for the open page.
const KEY = 'psy_web_picker_v1';

function read() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object') return { follow: v.follow !== false, userId: v.userId || null, sessionId: v.sessionId || null };
  } catch { /* unavailable: start fresh */ }
  return { follow: true, userId: null, sessionId: null };
}

let state = read();
const listeners = new Set();

export const getPicker = () => state;

export function setPicker(patch) {
  state = { ...state, ...patch };
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

export function usePickerStore() {
  return useSyncExternalStore(subscribe, getPicker, getPicker);
}
