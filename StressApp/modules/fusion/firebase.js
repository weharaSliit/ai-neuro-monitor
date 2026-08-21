// Client-side Firebase Realtime Database init for the live fusion screen --
// same bare pattern as modules/phenotyping/src/firebase.js (no admin
// credential, just the shared project's databaseURL). Source of truth for
// this URL is backend/common/firebase_config.py::FIREBASE_DB_URL -- keep
// this in sync manually if that ever changes (same duplication
// modules/phenotyping already carries, not a new problem this introduces).
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
    databaseURL: "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// modules/eeg/firebase.js initializes the same default app with the same
// config -- reuse it instead of a duplicate-app-name crash when both
// modules are mounted together (App.js imports both).
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);
