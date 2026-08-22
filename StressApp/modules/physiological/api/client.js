// ============================================================
// client.js — shared axios instance for authenticated API calls
//
// Every screen used to import bare axios + API_BASE + a hardcoded
// USER_ID directly. Now that the backend requires a Bearer token
// and derives user_id from it server-side, this is the one place
// that attaches the logged-in user's token to every request, and
// the one place that reacts to a token going invalid (expired /
// revoked) by triggering logout instead of every screen having to
// handle 401s individually.
// ============================================================

import axios from 'axios';
import { API_BASE } from '../config/config';

let authToken = null;
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token;
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    return Promise.reject(err);
  }
);

export default api;
