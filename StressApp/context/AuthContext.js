// ============================================================
// AuthContext.js
// App-wide (not physiological-modality-specific) login/session
// state — the account system a user registers/logs into before
// they ever reach the physiological module.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { setAuthToken, setUnauthorizedHandler } from '../modules/physiological/api/client';

const TOKEN_KEY = '@stressapp/authToken';
const USER_KEY  = '@stressapp/authUser';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]         = useState(null); // { userId, name }
  const [token, setToken]       = useState(null);
  const [isLoading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  // Restore a saved session on launch. Optimistic — no network
  // round-trip to "verify" the token here; if it's expired/invalid,
  // the first real API call 401s and the response interceptor below
  // triggers logout automatically.
  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await AsyncStorage.multiGet([TOKEN_KEY, USER_KEY]);
        const t = storedToken?.[1];
        const u = storedUser?.[1] ? JSON.parse(storedUser[1]) : null;
        if (t && u) {
          setAuthToken(t);
          setToken(t);
          setUser(u);
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
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
