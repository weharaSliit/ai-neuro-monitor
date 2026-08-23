import React, { useEffect, useState } from 'react';
import { View, AppState as RNAppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, update } from 'firebase/database';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import PhysiologicalNavigator from './modules/physiological/PhysiologicalNavigator';
import FusionSessionScreen from './modules/fusion/screens/FusionSessionScreen';
import EegSessionScreen from './modules/eeg/screens/EegSessionScreen';
import CalibrationScreen from './modules/physiological/screens/CalibrationScreen';
import EMAScreen from './modules/physiological/screens/EMAScreen';
import { AppContext } from './modules/physiological/screens/AppState';
import { ThemeProvider, useTheme } from './modules/physiological/config/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { db } from './firebase';

const Stack = createNativeStackNavigator();
const SESSION_ID_KEY = '@stressapp/liveSessionId';
const LAST_ACTIVE_KEY = '@stressapp/liveSessionLastActive';
const CURRENT_SESSION_ID_FIELD = 'current_session_id';
const CURRENT_USER_ID_FIELD = 'current_user_id';
const CURRENT_SESSION_ID_ROOTS = ['psychological', 'fusion_en', 'fusion_en_sessions'];
const SESSION_GRACE_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20 * 1000;

function mintSessionId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `session_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T`
        + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function resolveLiveSessionId(userId) {
    const stored = await AsyncStorage.multiGet([SESSION_ID_KEY, LAST_ACTIVE_KEY]);
    const storedId = stored[0][1];
    const storedLastActive = stored[1][1] ? Number(stored[1][1]) : 0;
    const withinGrace = !!storedId && (Date.now() - storedLastActive) < SESSION_GRACE_MS;
    const sessionId = withinGrace ? storedId : mintSessionId();

    await AsyncStorage.multiSet([
        [SESSION_ID_KEY, sessionId],
        [LAST_ACTIVE_KEY, String(Date.now())],
    ]);
    const updates = {};
    for (const root of CURRENT_SESSION_ID_ROOTS) {
        updates[`${root}/${CURRENT_SESSION_ID_FIELD}`] = sessionId;
        // Lets a device bridge attribute incoming data to whoever is
        // actually logged in right now, instead of a user_id fixed at
        // the bridge's own launch time.
        updates[`${root}/${CURRENT_USER_ID_FIELD}`] = userId;
    }
    await update(ref(db), updates);
    return sessionId;
}

function touchLiveSessionHeartbeat() {
    AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
}

const linking = {
  prefixes: [],
  config: {
    screens: {
      Login: 'login',
      Register: 'register',
      Physiological: {
        path: '',
        screens: {
          Home:     'home',
          History:  'history',
          'PSS-4':  'pss4',
          Ring:     'ring',
          EEG:      'eeg-tab',
          Profile:  'profile',
        },
      },
      Calibration: 'calibration',
      EmaDetail:   'ema',
      Fusion:      'fusion',
      Eeg:         'eeg',
    },
  },
};

function RootNavigator() {
  const { user, isLoading } = useAuth();
  const { theme } = useTheme();
  useEffect(() => {
    if (!user) return;

    resolveLiveSessionId(user.userId).catch((e) => console.log('[live_session] resolve failed:', e?.message));

    const heartbeat = setInterval(touchLiveSessionHeartbeat, HEARTBEAT_INTERVAL_MS);
    const subscription = RNAppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        touchLiveSessionHeartbeat();
      }
    });

    return () => {
      clearInterval(heartbeat);
      subscription.remove();
    };
  }, [user]);

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="Physiological" component={PhysiologicalNavigator} />
          <Stack.Screen
            name="Calibration"
            component={CalibrationScreen}
            options={{ headerShown: true, title: 'Calibration' }}
          />
          <Stack.Screen
            name="EmaDetail"
            component={EMAScreen}
            options={{ headerShown: true, title: 'Continual Learning' }}
          />
          <Stack.Screen
            name="Fusion"
            component={FusionSessionScreen}
            options={{ headerShown: true, title: 'Fusion' }}
          />
          <Stack.Screen
            name="Eeg"
            component={EegSessionScreen}
            options={{ headerShown: true, title: 'EEG' }}
          />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

export default function App() {
  const [lastSessionId,   setLastSessionId]   = useState(null);
  const [lastEmaResult,   setLastEmaResult]   = useState(null);

  const sharedState = {
    lastSessionId,   setLastSessionId,
    lastEmaResult,   setLastEmaResult,
  };

  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContext.Provider value={sharedState}>
          <NavigationContainer linking={linking}>
            <ThemedStatusBar />
            <RootNavigator />
          </NavigationContainer>
        </AppContext.Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}
