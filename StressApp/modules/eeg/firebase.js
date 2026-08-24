// Client-side Firebase Realtime Database init for the live EEG screen --
// same bare pattern as modules/fusion/firebase.js and
// modules/phenotyping/src/firebase.js (no admin credential, just the
// shared project's databaseURL). Source of truth for this URL is
// backend/common/firebase_config.py::FIREBASE_DB_URL -- keep this in sync
// manually if that ever changes (same duplication those two already carry).
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
    databaseURL: "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// modules/fusion/firebase.js already calls initializeApp() with the same
// config when both modules are mounted in the same app -- reuse the
// existing default app instead of a duplicate-app-name crash.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);
