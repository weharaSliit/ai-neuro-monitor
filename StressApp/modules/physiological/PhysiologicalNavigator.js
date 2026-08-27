// ============================================================
// PhysiologicalNavigator.js
// No bottom tab bar -- Overview (Fusion) is the one hub screen, with Ring/
// EEG/Phenotyping each reached as sections/cards from it rather than tabs.
// Phenotyping stays its own pushed screen (it's a large, self-contained
// "phone statistics" dashboard), just no longer a tab -- Overview links to
// it directly, same as it already links to RingSummary/EegSummary.
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import FusionSessionScreen from '../fusion/screens/FusionSessionScreen';
import PhenotypingScreen   from '../phenotyping/screens/PhenotypingScreen';

const Stack = createNativeStackNavigator();

export default function PhysiologicalNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Fusion">
      <Stack.Screen name="Fusion" component={FusionSessionScreen} />
      <Stack.Screen name="Phenotyping" component={PhenotypingScreen} />
    </Stack.Navigator>
  );
}
