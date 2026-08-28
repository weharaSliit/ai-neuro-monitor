// ============================================================
// eegApiClient.js
//
// EEG's Flask API has no shared authenticated axios instance (unlike
// physiological's modules/physiological/api/client.js) -- it was previously
// only ever read via a one-off axios.create() inline in CalibrationGate.js.
// Factored out here now that a second consumer needs it
// (modules/relaxation_guide/src/games/BreathingLightGame.js's on-demand EEG
// calibration trigger) -- same Render-hosted, cold-start-tolerant pattern
// already used for physiological/relaxation_guide (see
// modules/relaxation_guide/src/api/apiService.js).
// ============================================================

import axios from 'axios';

export const EEG_API_BASE = 'https://mindpulse-eeg.onrender.com';
export const eegClient = axios.create({ baseURL: EEG_API_BASE, timeout: 45000 });
