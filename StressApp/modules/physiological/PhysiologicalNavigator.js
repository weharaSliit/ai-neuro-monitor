import React, { useRef, useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, Animated, TouchableOpacity } from 'react-native';
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
  { name: 'Dashboard',   icon: '🏠', activeIcon: '🏠' },
  { name: 'Simulation',  icon: '▶️',  activeIcon: '▶️'  },
  { name: 'Calibration', icon: '🎯', activeIcon: '🎯' },
  { name: 'EMA Update',  icon: '🔄', activeIcon: '🔄' },
  { name: 'PSS-4',       icon: '📋', activeIcon: '📋' },
  { name: 'History',     icon: '📊', activeIcon: '📊' },
  { name: 'Analysis',    icon: '🔬', activeIcon: '🔬' },
];

function AnimatedTabIcon({ name, focused, color }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (focused) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1.2, tension: 200, friction: 8, useNativeDriver: true }),
        Animated.timing(glowAnim,  { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, tension: 200, friction: 8, useNativeDriver: true }),
        Animated.timing(glowAnim,  { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [focused]);

  const tab = TABS.find(t => t.name === name);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 4 }}>
      {focused && (
        <Animated.View style={{
          position:        'absolute',
          top:             -6,
          width:           40,
          height:          40,
          borderRadius:    20,
          backgroundColor: '#6366f120',
          opacity:         glowAnim,
        }} />
      )}
      <Animated.Text style={{
        fontSize:  focused ? 20 : 17,
        transform: [{ scale: scaleAnim }],
      }}>
        {tab?.icon || '•'}
      </Animated.Text>
      {focused && (
        <View style={{
          width:        4,
          height:       4,
          borderRadius: 2,
          backgroundColor: '#6366f1',
          marginTop:    3,
        }} />
      )}
    </View>
  );
}

export default function PhysiologicalNavigator() {
  const { isDark } = useTheme();

  const tabBg     = isDark ? '#0f1f35' : '#ffffff';
  const borderCol = isDark ? '#1e3a5f' : '#e2e8f0';

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon:  ({ focused, color }) => (
          <AnimatedTabIcon name={route.name} focused={focused} color={color} />
        ),
        tabBarActiveTintColor:   '#6366f1',
        tabBarInactiveTintColor: isDark ? '#475569' : '#94a3b8',
        tabBarStyle: {
          backgroundColor: tabBg,
          borderTopColor:  borderCol,
          borderTopWidth:  1,
          height:          62,
          paddingBottom:   8,
          paddingTop:      4,
        },
        tabBarLabelStyle: {
          fontSize:   9,
          fontWeight: '700',
          letterSpacing: 0.3,
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