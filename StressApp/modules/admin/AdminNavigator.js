// ============================================================
// AdminNavigator.js
// Admin App's own stack, mounted as a top-level Stack.Screen ("Admin") in
// App.js once the App Mode chooser routes here. Everything technical/raw
// that moved out of the simplified User App lives under this stack,
// parameterized by an admin-selected user_id (not the logged-in account).
// ============================================================
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AdminUserListScreen from './screens/AdminUserListScreen';
import AdminUserDetailScreen from './screens/AdminUserDetailScreen';
import AdminSessionDetailScreen from './screens/AdminSessionDetailScreen';
import AdminEegLiveScreen from './screens/AdminEegLiveScreen';
import PhenotypingAnalysisScreen from '../phenotyping/screens/PhenotypingAnalysisScreen';
import PhenotypingValidationScreen from '../phenotyping/screens/PhenotypingValidationScreen';
import FusionSessionScreen from '../fusion/screens/FusionSessionScreen';
import RelaxationGuideModule from '../relaxation_guide';

const Stack = createNativeStackNavigator();

export default function AdminNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="AdminUserList">
      <Stack.Screen name="AdminUserList" component={AdminUserListScreen} />
      <Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} />
      <Stack.Screen name="AdminSessionDetail" component={AdminSessionDetailScreen} />
      <Stack.Screen name="AdminEegLive" component={AdminEegLiveScreen} />
      <Stack.Screen
        name="PhenotypingAnalysis"
        component={PhenotypingAnalysisScreen}
        options={{ headerShown: true, title: 'Analysis & Patterns' }}
      />
      <Stack.Screen
        name="PhenotypingValidation"
        component={PhenotypingValidationScreen}
        options={{ headerShown: true, title: 'Validation Report' }}
      />
      <Stack.Screen name="AdminRelaxation" component={RelaxationGuideModule} />
      <Stack.Screen
        name="AdminFusion"
        component={FusionSessionScreen}
        options={{ headerShown: true, title: 'Multimodal Fusion' }}
      />
    </Stack.Navigator>
  );
}
