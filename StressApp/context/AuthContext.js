// ============================================================
// AuthContext.js
// App-wide (not physiological-modality-specific) login/session
// state — the account system a user registers/logs into before
// they ever reach the physiological module.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { ref, update } from 'firebase/database';
import { db } from '../firebase';
import api, { setAuthToken, setUnauthorizedHandler } from '../modules/physiological/api/client';
import { setAuthToken as setRelaxationAuthToken } from '../modules/relaxation_guide/src/api/apiService';
import { cacheAuthUserId, clearCachedAuthUserId } from '../modules/phenotyping/utils/deviceIdentity';

// Bridge: pushes / clears the real auth userId and sessionId in native SharedPreferences so
// KeystrokeCollectorService (AccessibilityService) always uploads phenotyping
// windows under the correct user and active live session, not a random per-device id or missing session.
const { PhenotypingIdentity } = NativeModules;
function syncPhenotypingIdentity(userId, sessionId) {
  if (Platform.OS === 'android' && PhenotypingIdentity) {
    if (PhenotypingIdentity.setIdentity) {
      PhenotypingIdentity.setIdentity(userId, sessionId || '');
    } else {
      if (PhenotypingIdentity.setUserId) PhenotypingIdentity.setUserId(userId);
      if (sessionId && PhenotypingIdentity.setSessionId) PhenotypingIdentity.setSessionId(sessionId);
    }
  }
  // Also warm the JS-side AsyncStorage cache so usePhenotypingDeviceId()
  // resolves instantly on the next render without a native round-trip.
  cacheAuthUserId(userId).catch(() => { });
}

function syncPhenotypingUserId(userId, sessionId) {
  syncPhenotypingIdentity(userId, sessionId);
}

function clearPhenotypingIdentity() {
  if (Platform.OS === 'android' && PhenotypingIdentity) {
    if (PhenotypingIdentity.clearIdentity) {
      PhenotypingIdentity.clearIdentity();
    } else if (PhenotypingIdentity.clearUserId) {
      PhenotypingIdentity.clearUserId();
    }
  }
  clearCachedAuthUserId().catch(() => { });
}

function clearPhenotypingUserId() {
  clearPhenotypingIdentity();
}

// Digital Phenotyping identity is now UNIFIED with the login userId.
// On every successful login / session restore we call syncPhenotypingUserId()
// so KeystrokeCollectorService always tags windows with the real username (userId)
// (e.g. "alex_zen") instead of a random per-device "phn_..." string.
// This enables proper multimodal fusion with the Physiological Ring and EEG
// components, which both key their Firebase data by the same userId.
// On logout, clearPhenotypingUserId() is called so any buffered window
// flushed after logout is not misattributed to the next user.

const TOKEN_KEY = '@stressapp/authToken';
const USER_KEY = '@stressapp/authUser';
const SESSION_ID_KEY = '@stressapp/sessionId';

// A "session" is one login-to-logout span (not "however long the app
// happened to stay open") -- see fushion engin/fusion_live_session.py and
// backend/*/firebase_service.py, which all nest their live fusion data
// under {root}/{user_id}/{session_id} on that assumption. current_session_id/
// current_user_id are flat POINTER fields (not nested -- a device bridge
// that doesn't yet know who's logged in reads these to find out), written
// into all three roots at once so every backend/bridge polling any of them
// sees the same session at the same time.
const CURRENT_SESSION_ID_FIELD = 'current_session_id';
const CURRENT_USER_ID_FIELD = 'current_user_id';
const CURRENT_SESSION_ID_ROOTS = ['psychological', 'fusion_en', 'fusion_en_sessions'];

function mintSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `session_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T`
    + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { userId, name }
  const [token, setToken] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [isLoading, setLoading] = useState(true);

  // Called once per real login (fresh login/register, or a restore that
  // finds a token but no session id from before this field existed) --
  // mints a fresh session, publishes it as the live pointer, and stamps
  // session_started directly (the authoritative moment this session began;
  // fushion engin/fusion_live_session.py only backfills this if it somehow
  // sees the session before this write lands).
  const startLiveSession = async (userId) => {
    const newSessionId = mintSessionId();
    const nowIso = new Date().toISOString();
    const updates = { [`fusion_en_sessions/${userId}/${newSessionId}/session_started`]: nowIso };
    for (const root of CURRENT_SESSION_ID_ROOTS) {
      updates[`${root}/${CURRENT_SESSION_ID_FIELD}`] = newSessionId;
      updates[`${root}/${CURRENT_USER_ID_FIELD}`] = userId;
    }
    try {
      await update(ref(db), updates);
    } catch (e) {
      console.log('[live_session] start failed:', e?.message);
    }
    await AsyncStorage.setItem(SESSION_ID_KEY, newSessionId);
    setSessionId(newSessionId);
    // Push new sessionId to native phenotyping service immediately
    syncPhenotypingIdentity(userId, newSessionId);
    return newSessionId;
  };

  // Ends the CURRENT session (if any) and clears the live pointer so no
  // backend/bridge attributes further incoming data to this login once it's
  // over -- the frontend counterpart to fusion_live_session.py's own
  // rotation-based session_ended fallback, but immediate and authoritative
  // instead of waiting for the next login's pointer change to be noticed.
  const endLiveSession = async (userId, endingSessionId) => {
    if (!userId || !endingSessionId) return;
    const nowIso = new Date().toISOString();
    const updates = {
      [`fusion_en_sessions/${userId}/${endingSessionId}/session_ended`]: nowIso,
    };
    for (const root of CURRENT_SESSION_ID_ROOTS) {
      updates[`${root}/${CURRENT_SESSION_ID_FIELD}`] = null;
      updates[`${root}/${CURRENT_USER_ID_FIELD}`] = null;
    }
    try {
      await update(ref(db), updates);
    } catch (e) {
      console.log('[live_session] end failed:', e?.message);
    }
  };

  const logout = useCallback(async () => {
    await endLiveSession(user?.userId, sessionId);
    // Clear native SharedPreferences so buffered phenotyping windows flushed
    // after this point are not attributed to the user or session who just logged out.
    clearPhenotypingIdentity();
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, SESSION_ID_KEY]);
    setAuthToken(null);
    setRelaxationAuthToken(null);
    setToken(null);
    setUser(null);
    setSessionId(null);
  }, [user, sessionId]);

  // Restore a saved session on launch. Optimistic — no network
  // round-trip to "verify" the token here; if it's expired/invalid,
  // the first real API call 401s and the response interceptor below
  // triggers logout automatically. A persisted session id is reused as-is
  // (restoring an app process mid-login is NOT a new login); only a token
  // with no persisted session id (e.g. upgrading from before this field
  // existed) falls back to minting one so it's never silently missing.
  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser, storedSessionId] = await AsyncStorage.multiGet(
          [TOKEN_KEY, USER_KEY, SESSION_ID_KEY]
        );
        const t = storedToken?.[1];
        const u = storedUser?.[1] ? JSON.parse(storedUser[1]) : null;
        const sid = storedSessionId?.[1];
        if (t && u) {
          setAuthToken(t);
          setRelaxationAuthToken(t);
          setToken(t);
          setUser(u);
          // Push real userId and sessionId into native SharedPreferences so the background
          // AccessibilityService (KeystrokeCollectorService) uses the right identity & session
          // even if it was already running before this JS restore completed.
          if (sid) {
            setSessionId(sid);
            syncPhenotypingIdentity(u.userId, sid);
          } else {
            await startLiveSession(u.userId);
          }
        }
      } catch (e) {
        console.log('Auth restore error:', e.message);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  const persistSession = async (newToken, newUser) => {
    setAuthToken(newToken);
    setRelaxationAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
    await AsyncStorage.multiSet([
      [TOKEN_KEY, newToken],
      [USER_KEY, JSON.stringify(newUser)],
    ]);
    // Unify Digital Phenotyping identity with the real login user id.
    syncPhenotypingUserId(newUser.userId);
    await startLiveSession(newUser.userId);
  };

  const login = async (userId, password) => {
    try {
      const res = await api.post('/login', { user_id: userId, password });
      const { token: newToken, user_id, name } = res.data;
      await persistSession(newToken, { userId: user_id, name, isNewUser: false });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.response?.data?.error || 'Login failed' };
    }
  };

  const register = async (userId, password, name) => {
    try {
      const res = await api.post('/register', { user_id: userId, password, name });
      const { token: newToken, user_id, name: returnedName } = res.data;
      await persistSession(newToken, { userId: user_id, name: returnedName, isNewUser: true });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.response?.data?.error || 'Registration failed' };
    }
  };

  // Called once the new-user setup screen (device check + first
  // calibration, or an explicit skip) is done -- flips isNewUser off so
  // App.js's RootNavigator stops routing this user back to that screen on
  // future opens. Persisted immediately (not just in-memory state), since
  // a killed app should remember this was already shown.
  const completeOnboarding = useCallback(async () => {
    setUser((u) => {
      if (!u || !u.isNewUser) return u;
      const updated = { ...u, isNewUser: false };
      AsyncStorage.setItem(USER_KEY, JSON.stringify(updated)).catch(() => { });
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, sessionId, isLoading, login, register, logout, completeOnboarding }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
