import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from '../lib/api';
import { attachSession, endSession, takeOverSession } from '../lib/session';

const STORAGE_KEY = 'mindpulse.web.auth';

function readStored() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
function writeStored(v) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode: session just won't survive a reload */ }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // { token, user: {userId, name}, sessionId, sessionMode }
  const [auth, setAuth] = useState(() => {
    const s = readStored();
    if (s?.token) setAuthToken(s.token);
    return s;
  });

  const logout = useCallback(async () => {
    const s = readStored();
    if (s?.sessionMode === 'started') await endSession(s.user?.userId, s.sessionId);
    setAuthToken(null);
    writeStored(null);
    setAuth(null);
  }, []);

  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);

  const persist = async (token, user) => {
    setAuthToken(token);
    const { sessionId, mode } = await attachSession(user.userId);
    const next = { token, user, sessionId, sessionMode: mode };
    writeStored(next);
    setAuth(next);
  };

  // The devices are held by another account; claim them for this one.
  const takeOver = async () => {
    const s = readStored();
    if (!s?.user?.userId) return { success: false };
    try {
      const { sessionId, mode } = await takeOverSession(s.user.userId);
      const next = { ...s, sessionId, sessionMode: mode };
      writeStored(next);
      setAuth(next);
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || 'Could not take over the devices.' };
    }
  };

  const login = async (userId, password) => {
    try {
      const res = await api.post('/login', { user_id: userId, password });
      const { token, user_id, name } = res.data;
      await persist(token, { userId: user_id, name });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.response?.data?.error || 'Login failed — check your ID and password.' };
    }
  };

  const register = async (userId, password, name) => {
    try {
      const res = await api.post('/register', { user_id: userId, password, name });
      const { token, user_id, name: returnedName } = res.data;
      await persist(token, { userId: user_id, name: returnedName });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.response?.data?.error || 'Registration failed' };
    }
  };

  return (
    <AuthContext.Provider value={{
      user: auth?.user || null,
      token: auth?.token || null,
      sessionId: auth?.sessionId || null,
      sessionMode: auth?.sessionMode || null,
      login, register, logout, takeOver,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
