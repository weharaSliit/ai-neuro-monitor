// Client-side Firebase Realtime Database init for the phenotyping screens --
// same bare pattern as modules/eeg/firebase.js and modules/fusion/firebase.js
// (no admin credential, just the shared project's databaseURL).
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
    databaseURL: "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);
