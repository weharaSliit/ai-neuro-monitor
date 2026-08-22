import React, { useState } from 'react';
import { View } from 'react-native';
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

const Stack = createNativeStackNavigator();

// Web-only concern: without this, NavigationContainer never reflects the
// current screen in the URL, so a hard page refresh always remounts at the
// default route (Home) instead of wherever the user actually was (e.g. the
// live EEG or Fusion screen) -- looked like "the dashboard shows nothing
// after refresh" when it was really "the app is back on Home". Tab names
// here must match PhysiologicalNavigator.js's <Tab.Screen name="..."> exactly.
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

  if (isLoading) {
    // Auth restore from AsyncStorage is fast/local — a blank themed
    // screen avoids a flash of Login before a saved session restores.
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
