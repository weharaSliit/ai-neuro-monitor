import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';

import DashboardScreen    from './screens/DashboardScreen';
import SimulationScreen   from './screens/SimulationScreen';
import CalibrationScreen  from './screens/CalibrationScreen';
import EMAScreen          from './screens/EMAScreen';
import PSS4Screen         from './screens/PSS4Screen';
import HistoryScreen      from './screens/HistoryScreen';
import ExploratoryScreen  from './screens/ExploratoryScreen';

const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Dashboard:   '🏠',
  Simulation:  '▶️',
  Calibration: '🎯',
  'EMA Update':'🔄',
  'PSS-4':     '📋',
  History:     '📊',
  Analysis:    '🔬',
};

function TabIcon({ name, focused }) {
  return (
    <View style={{
      alignItems:     'center',
      justifyContent: 'center',
      paddingTop:     4,
    }}>
      <Text style={{ fontSize: focused ? 20 : 18 }}>
        {TAB_ICONS[name] || '•'}
      </Text>
    </View>
  );
}

export default function PhysiologicalNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon:  ({ focused }) => (
          <TabIcon name={route.name} focused={focused} />
        ),
        tabBarActiveTintColor:   '#6366f1',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#1e293b',
          borderTopColor:  '#334155',
          borderTopWidth:  1,
          height:          60,
          paddingBottom:   8,
        },
        tabBarLabelStyle: {
          fontSize:   10,
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
      />
      <Tab.Screen
        name="Simulation"
        component={SimulationScreen}
      />
      <Tab.Screen
        name="Calibration"
        component={CalibrationScreen}
      />
      <Tab.Screen
        name="EMA Update"
        component={EMAScreen}
      />
      <Tab.Screen
        name="PSS-4"
        component={PSS4Screen}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
      />
      <Tab.Screen
        name="Analysis"
        component={ExploratoryScreen}
      />
    </Tab.Navigator>
  );
}