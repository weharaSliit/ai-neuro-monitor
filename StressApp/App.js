import React, { useState } from 'react';
import { View, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import CalibrationGate from './modules/shared/CalibrationGate';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'expo-web-root-fix';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      html, body, #root, #root > div {
        height: 100%;
        width: 100%;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        flex: 1;
      }
    `;
    document.head.appendChild(style);
  }
}

import WelcomeScreen from './screens/WelcomeScreen';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import PhysiologicalNavigator from './modules/physiological/PhysiologicalNavigator';
import AdminNavigator from './modules/admin/AdminNavigator';
import CalibrationScreen from './modules/physiological/screens/CalibrationScreen';
import EMAScreen from './modules/physiological/screens/EMAScreen';
import PSS4Screen from './modules/physiological/screens/PSS4Screen';
import ProfileScreen from './modules/physiological/screens/ProfileScreen';
import RingSummaryScreen from './modules/physiological/screens/RingSummaryScreen';
import EegSummaryScreen from './modules/eeg/screens/EegSummaryScreen';
import PhenotypingEmaScreen from './modules/phenotyping/screens/PhenotypingEmaScreen';
import PhenotypingSignalDetailScreen from './modules/phenotyping/screens/PhenotypingSignalDetailScreen';
import PhenotypingSignalHistoryScreen from './modules/phenotyping/screens/PhenotypingSignalHistoryScreen';
import PhenotypingAlertDetailScreen from './modules/phenotyping/screens/PhenotypingAlertDetailScreen';
import PhenotypingOnboardingScreen from './modules/phenotyping/screens/PhenotypingOnboardingScreen';
import { AppContext } from './modules/physiological/screens/AppState';
import { ThemeProvider, useTheme } from './modules/physiological/config/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';

const Stack = createNativeStackNavigator();

const linking = {
  prefixes: [],
  config: {
    screens: {
      Welcome: 'welcome',
      Login: 'login',
      Register: 'register',
      Admin: 'admin',
      Physiological: {
        path: '',
        screens: {
          Fusion:          'fusion-tab',
          Phenotyping:     'phenotyping-tab',
          RelaxationGuide: 'relaxation-guide',
        },
      },
      CalibrationGate:        'calibration-gate',
      Calibration:            'calibration',
      RingSummary:            'ring',
      EegSummary:             'eeg',
      EmaDetail:              'ema',
      PSS4:                   'pss4',
      Profile:                'profile',
      PhenotypingEma:         'phenotyping-ema',
      PhenotypingSignalDetail:  'phenotyping-signal',
      PhenotypingSignalHistory: 'phenotyping-signal-history',
      PhenotypingAlertDetail:   'phenotyping-alert',
      PhenotypingOnboarding:    'phenotyping-onboarding',
    },
  },
};

function RootNavigator() {
  const { user, isLoading } = useAuth();
  const { theme } = useTheme();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme?.bg || '#F8F6F0', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#6E68B2" />
      </View>
    );
  }

  // Every login/session-restore lands straight in the User app now -- no
  // mode-chooser screen. CalibrationGate is the real landing point: it
  // intercepts if neither Ring nor EEG has a usable calibration on file,
  // otherwise immediately forwards to Physiological (see
  // modules/shared/CalibrationGate.js's own useEffect). Admin is reached
  // one level down, via a link in ProfileScreen.js -- not a peer choice
  // made at login.
  const initialRoute = !user ? 'Welcome' : 'CalibrationGate';

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRoute}>
      {user ? (
        <>
          {/* User path: Physiological's 2-tab bar (Overview/Phenotyping --
              see PhysiologicalNavigator.js), simplified for a real end
              user; CalibrationGate intercepts first if neither Ring nor
              EEG has a usable calibration on file. Admin path:
              AdminNavigator, a separate stack with full raw/technical data
              for any registered user, independent of who's logged into
              this phone -- reached via ProfileScreen.js's "Clinical &
              Admin Suite" card, with its own way back (see
              AdminUserListScreen.js's swap-mode button, which returns to
              CalibrationGate). Everything technical that used to live in
              the user app (raw baseline numbers, live signal charts,
              session history detail, Relaxation Guide, phenotyping's
              Analysis deep-dive) now lives only under Admin. Profile is
              reached via a persistent header icon on each user tab, not a
              tab of its own -- see ProfileScreen.js. */}
          <Stack.Screen name="Admin" component={AdminNavigator} />
          <Stack.Screen name="CalibrationGate" component={CalibrationGate} />
          <Stack.Screen name="Physiological" component={PhysiologicalNavigator} />
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Calibration"
            component={CalibrationScreen}
            options={{ headerShown: true, title: 'Calibration' }}
          />
          <Stack.Screen
            name="RingSummary"
            component={RingSummaryScreen}
            options={{ headerShown: true, title: 'My Ring' }}
          />
          <Stack.Screen
            name="EegSummary"
            component={EegSummaryScreen}
            options={{ headerShown: true, title: 'EEG Headband' }}
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
            name="PhenotypingEma"
            component={PhenotypingEmaScreen}
            options={{ headerShown: true, title: 'Stress Check-In' }}
          />
          <Stack.Screen
            name="PhenotypingSignalDetail"
            component={PhenotypingSignalDetailScreen}
            options={{ headerShown: true, title: 'Signal Detail' }}
          />
          <Stack.Screen
            name="PhenotypingSignalHistory"
            component={PhenotypingSignalHistoryScreen}
            options={{ headerShown: true, title: '7-Day History' }}
          />
          <Stack.Screen
            name="PhenotypingAlertDetail"
            component={PhenotypingAlertDetailScreen}
            options={{ headerShown: true, title: 'Alert Detail' }}
          />
          <Stack.Screen
            name="PhenotypingOnboarding"
            component={PhenotypingOnboardingScreen}
            options={{ headerShown: true, title: 'Set Up Tracking' }}
          />
        </>
      ) : (
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

// Light-only design now (dark mode removed) -- status bar text is always dark.
function ThemedStatusBar() {
  return <StatusBar style="dark" />;
}

export default function App() {
  const [lastSessionId,   setLastSessionId]   = useState(null);

  const sharedState = {
    lastSessionId,   setLastSessionId,
  };

  return (
    <SafeAreaProvider>
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
    </SafeAreaProvider>
  );
}
