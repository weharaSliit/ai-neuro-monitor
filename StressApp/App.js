import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import MainHomeScreen from './screens/mainHomeScreen';
import PhysiologicalNavigator from './modules/physiological/PhysiologicalNavigator';
import { AppContext } from './modules/physiological/screens/AppState';
import { ThemeProvider } from './modules/physiological/config/ThemeContext';

const Stack = createNativeStackNavigator();

export default function App() {
  const [lastSessionId,   setLastSessionId]   = useState(null);
  const [lastEmaResult,   setLastEmaResult]   = useState(null);

  const sharedState = {
    lastSessionId,   setLastSessionId,
    lastEmaResult,   setLastEmaResult,
  };

  return (
    <ThemeProvider>
      <AppContext.Provider value={sharedState}>
        <NavigationContainer>
          <StatusBar style="light" />
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home"          component={MainHomeScreen} />
            <Stack.Screen name="Physiological" component={PhysiologicalNavigator} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppContext.Provider>
    </ThemeProvider>
  );
}