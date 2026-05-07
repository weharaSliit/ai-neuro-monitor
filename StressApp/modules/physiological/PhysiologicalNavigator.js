import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import DashboardScreen from './screens/DashboardScreen';
import SimulationScreen from './screens/SimulationScreen';
import CalibrationScreen from './screens/CalibrationScreen';
import PSS4Screen from './screens/PSS4Screen';
import HistoryScreen from './screens/HistoryScreen';
import EMAScreen from './screens/EMAScreen';

const Tab = createBottomTabNavigator();

export default function PhysiologicalNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#f1f5f9',
        tabBarStyle: {
          backgroundColor: '#0f172a',
          borderTopColor: '#1e293b',
          height: 60,
        },
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#64748b',
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen}
        options={{ tabBarIcon: () => <Text>🏠</Text> }} />

      <Tab.Screen name="Simulation" component={SimulationScreen}
        options={{ tabBarIcon: () => <Text>▶️</Text> }} />

      <Tab.Screen name="Calibration" component={CalibrationScreen}
        options={{ tabBarIcon: () => <Text>⚙️</Text> }} />

      <Tab.Screen name="EMA Update" component={EMAScreen}
        options={{ tabBarIcon: () => <Text>🔄</Text> }} />

      <Tab.Screen name="PSS-4" component={PSS4Screen}
        options={{ tabBarIcon: () => <Text>📋</Text> }} />

      <Tab.Screen name="History" component={HistoryScreen}
        options={{ tabBarIcon: () => <Text>📊</Text> }} />
    </Tab.Navigator>
  );
}