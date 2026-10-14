import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { FIREBASE_DB_URL } from './config';

// Read-only client: bare databaseURL, no auth, and nothing in this app
// calls set/update/push.
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
