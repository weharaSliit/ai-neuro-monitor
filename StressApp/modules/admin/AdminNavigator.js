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
import RelaxationGuideModule from '../relaxation_guide';

const Stack = createNativeStackNavigator();

export default function AdminNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="AdminUserList">
      <Stack.Screen name="AdminUserList" component={AdminUserListScreen} />
      <Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} />
      <Stack.Screen name="AdminSessionDetail" component={AdminSessionDetailScreen} />
      <Stack.Screen name="AdminEegLive" component={AdminEegLiveScreen} />
      {/* Research-grade phenotyping deep-dive (Z-scores, idiographic
          baseline table) -- moved here from the user app, reused as-is;
          it already reads whichever user is logged in via useAuth(), so
          today it still reflects the ADMIN's own account, same known
          limitation as AdminRelaxation below (flagged, not silently
          pretended to be per-user yet). headerShown:true here since this
          screen was built assuming a native header owns its back button +
          top inset (edges={['left','right']} only, per its own
          ScreenBackground usage) -- same as its old registration in the
          user app's App.js. */}
      <Stack.Screen
        name="PhenotypingAnalysis"
        component={PhenotypingAnalysisScreen}
        options={{ headerShown: true, title: 'Analysis & Patterns' }}
      />
      <Stack.Screen name="AdminRelaxation" component={RelaxationGuideModule} />
    </Stack.Navigator>
  );
}
