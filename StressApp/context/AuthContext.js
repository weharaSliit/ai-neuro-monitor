// ============================================================
// AuthContext.js
// App-wide (not physiological-modality-specific) login/session
// state — the account system a user registers/logs into before
// they ever reach the physiological module.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, update } from 'firebase/database';
import { db } from '../firebase';
import api, { setAuthToken, setUnauthorizedHandler } from '../modules/physiological/api/client';

const TOKEN_KEY      = '@stressapp/authToken';
const USER_KEY       = '@stressapp/authUser';
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
const CURRENT_USER_ID_FIELD    = 'current_user_id';
const CURRENT_SESSION_ID_ROOTS = ['psychological', 'fusion_en', 'fusion_en_sessions'];

function mintSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `session_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T`
      + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null); // { userId, name }
  const [token, setToken]         = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [isLoading, setLoading]   = useState(true);

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
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, SESSION_ID_KEY]);
    setAuthToken(null);
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
        const t  = storedToken?.[1];
        const u  = storedUser?.[1] ? JSON.parse(storedUser[1]) : null;
        const sid = storedSessionId?.[1];
        if (t && u) {
          setAuthToken(t);
          setToken(t);
          setUser(u);
          if (sid) {
            setSessionId(sid);
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
    setToken(newToken);
    setUser(newUser);
    await AsyncStorage.multiSet([
      [TOKEN_KEY, newToken],
      [USER_KEY, JSON.stringify(newUser)],
    ]);
    await startLiveSession(newUser.userId);
  };

  const login = async (userId, password) => {
    try {
      const res = await api.post('/login', { user_id: userId, password });
      const { token: newToken, user_id, name } = res.data;
      await persistSession(newToken, { userId: user_id, name });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.response?.data?.error || 'Login failed' };
    }
  };

  const register = async (userId, password, name) => {
    try {
      const res = await api.post('/register', { user_id: userId, password, name });
      const { token: newToken, user_id, name: returnedName } = res.data;
      await persistSession(newToken, { userId: user_id, name: returnedName });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.response?.data?.error || 'Registration failed' };
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, sessionId, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
