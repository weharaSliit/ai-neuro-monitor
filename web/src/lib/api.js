import axios from 'axios';

// Same Render-hosted Flask services the mobile app calls
// (StressApp/modules/physiological/config/config.js, shared/eegApiClient.js).
// CORS is open on every backend (backend/common/app_factory.py).
export const API_BASE = 'https://mindpulse-physiological.onrender.com';
export const EEG_API_BASE = 'https://mindpulse-eeg.onrender.com';
export const DEVICE_ID = 'wearable01';
export const STRESS_DECISION_THRESHOLD_PERCENT = 64.47;

let authToken = null;
let onUnauthorized = null;

export function setAuthToken(token) { authToken = token; }
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function withAuth(instance) {
  instance.interceptors.request.use((config) => {
    if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
    return config;
  });
  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401 && onUnauthorized) onUnauthorized();
      return Promise.reject(err);
    },
  );
  return instance;
}

// 45s timeout: Render free-tier services cold-start slowly.
export const api = withAuth(axios.create({ baseURL: API_BASE, timeout: 45000 }));
export const eegApi = withAuth(axios.create({ baseURL: EEG_API_BASE, timeout: 45000 }));
export const deviceApi = axios.create({ baseURL: API_BASE, timeout: 20000 });
