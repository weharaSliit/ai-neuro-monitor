// Direct calls to the DEPLOYED ring API (backend/physiological/app.py on
// Render) -- the same routes StressApp's Calibrate card and limit test use,
// so ring (HRV/GSR) calibration works from psy_web without redeploying.
// The user signs in with their own password (POST /login); the token is kept
// in memory by the caller only, never stored.
import { PHYSIO_API_BASE } from './config';

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${PHYSIO_API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const ringLogin = (userId, password) => call('/login', { method: 'POST', body: { user_id: userId, password } });
export const ringBaselineStart = (token) => call('/calibrate/start', { method: 'POST', token });
export const ringBaselineStatus = (token) => call('/calibrate/status', { token });
export const ringThresholdStart = (token) => call('/calibrate/threshold/start', { method: 'POST', token });
export const ringThresholdStatus = (token) => call('/calibrate/threshold/status', { token });
