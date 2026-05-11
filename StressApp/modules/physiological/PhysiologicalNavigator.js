import React, { useRef, useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, Animated } from 'react-native';
import { useTheme } from './config/ThemeContext';

import DashboardScreen   from './screens/DashboardScreen';
import SimulationScreen  from './screens/SimulationScreen';
import CalibrationScreen from './screens/CalibrationScreen';
import EMAScreen         from './screens/EMAScreen';
import PSS4Screen        from './screens/PSS4Screen';
import HistoryScreen     from './screens/HistoryScreen';
import ExploratoryScreen from './screens/ExploratoryScreen';

const Tab = createBottomTabNavigator();

const TABS = [
  { name: 'Dashboard',   icon: '🏠' },
  { name: 'Simulation',  icon: '▶️'  },
  { name: 'Calibration', icon: '🎯' },
  { name: 'EMA Update',  icon: '🔄' },
  { name: 'PSS-4',       icon: '📋' },
  { name: 'History',     icon: '📊' },
  { name: 'Analysis',    icon: '🔬' },
];

function TabIcon({ name, focused, color, COLORS }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: focused ? 1.2 : 1,
        tension: 200, friction: 8, useNativeDriver: true
      }),
      Animated.timing(glowAnim, {
        toValue: focused ? 1 : 0,
        duration: 180, useNativeDriver: true
      }),
    ]).start();
  }, [focused]);

  const tab = TABS.find(t => t.name === name);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 4 }}>
      {focused && (
        <Animated.View style={{
          position: 'absolute', top: -8,
          width: 38, height: 38, borderRadius: 19,
          backgroundColor: COLORS.brand + '18',
          opacity: glowAnim,
        }} />
      )}
      <Animated.Text style={{ fontSize: focused ? 20 : 17, transform: [{ scale: scaleAnim }] }}>
        {tab?.icon || '•'}
      </Animated.Text>
      {focused && (
        <View style={{
          width: 4, height: 4, borderRadius: 2,
          backgroundColor: COLORS.brand, marginTop: 3,
        }} />
      )}
    </View>
  );
}

export default function PhysiologicalNavigator() {
  const { isDark, theme, COLORS } = useTheme();
  const t = theme;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} COLORS={COLORS} />
        ),
        tabBarActiveTintColor:   COLORS.brand,
        tabBarInactiveTintColor: isDark ? '#3a5a7a' : '#8aacc8',
        tabBarStyle: {
          backgroundColor: isDark ? '#0a1628' : '#ffffff',
          borderTopColor:  isDark ? '#1a3352' : '#dceaf7',
          borderTopWidth:  1,
          height:          64,
          paddingBottom:   10,
          paddingTop:      4,
        },
        tabBarLabelStyle: {
          fontSize: 9, fontWeight: '700', letterSpacing: 0.3,
        },
      })}
    >
      <Tab.Screen name="Dashboard"   component={DashboardScreen}   />
      <Tab.Screen name="Simulation"  component={SimulationScreen}  />
      <Tab.Screen name="Calibration" component={CalibrationScreen} />
      <Tab.Screen name="EMA Update"  component={EMAScreen}         />
      <Tab.Screen name="PSS-4"       component={PSS4Screen}        />
      <Tab.Screen name="History"     component={HistoryScreen}      />
      <Tab.Screen name="Analysis"    component={ExploratoryScreen} />
    </Tab.Navigator>
  );
}