import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// Same Realtime Database the mobile app reads (StressApp/firebase.js) --
// a bare databaseURL config, no Firebase Auth (login is the Flask
// bearer-token flow in ./api.js).
const firebaseConfig = {
  databaseURL: 'https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);
