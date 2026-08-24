import React, { useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import PhysiologicalNavigator from './modules/physiological/PhysiologicalNavigator';
import HrvGsrSessionScreen from './modules/hrvgsr/screens/HrvGsrSessionScreen';
import CalibrationScreen from './modules/physiological/screens/CalibrationScreen';
import EMAScreen from './modules/physiological/screens/EMAScreen';
import PSS4Screen from './modules/physiological/screens/PSS4Screen';
import RelaxationGuideModule from './modules/relaxation_guide';
import { AppContext } from './modules/physiological/screens/AppState';
import { ThemeProvider, useTheme } from './modules/physiological/config/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';

const Stack = createNativeStackNavigator();

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
          Ring:     'ring',
          EEG:      'eeg-tab',
          Fusion:   'fusion-tab',
          Profile:  'profile',
        },
      },
      Calibration: 'calibration',
      EmaDetail:   'ema',
      PSS4:        'pss4',
      HrvGsr:      'hrv-gsr',
      Relaxation:  'relaxation',
    },
  },
};

function RootNavigator() {
  const { user, isLoading } = useAuth();
  const { theme } = useTheme();

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={user ? 'Relaxation' : 'Login'}>
      {user ? (
        <>
          {/* Relaxation Guide is the primary post-login experience -- see
              StressApp/modules/relaxation_guide/index.js. Physiological/EEG/
              HRV-GSR/Fusion below are supporting sensor screens, reachable
              but no longer the landing destination. */}
          <Stack.Screen
            name="Relaxation"
            component={RelaxationGuideModule}
            options={{ headerShown: false }}
          />
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
            name="PSS4"
            component={PSS4Screen}
            options={{ headerShown: true, title: 'PSS-4 Survey' }}
          />
          <Stack.Screen
            name="HrvGsr"
            component={HrvGsrSessionScreen}
            options={{ headerShown: true, title: 'HRV/GSR' }}
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
