// Client-side Firebase Realtime Database init for the live HRV/GSR screen --
// same bare pattern as modules/fusion/firebase.js and modules/eeg/firebase.js
// (no admin credential, just the shared project's databaseURL). Source of
// truth for this URL is backend/common/firebase_config.py::FIREBASE_DB_URL --
// keep this in sync manually if that ever changes (same duplication those
// modules already carry, not a new problem this introduces).
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
    databaseURL: "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// Other modules' firebase.js files already call initializeApp() with the
// same config when mounted together -- reuse the existing default app
// instead of a duplicate-app-name crash.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);
