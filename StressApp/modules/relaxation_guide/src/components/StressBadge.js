import React, { useContext } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

export const StressBadge = ({ label = 'normal', isOverride = false }) => {
  const { theme } = useContext(ThemeContext);

  let bgColor = theme.success;
  let title = '🟢 NORMAL STATE';

  if (label === 'stress') {
    bgColor = theme.danger;
    title = isOverride ? '🚨 SAFETY OVERRIDE (STRESS)' : '🔴 ACUTE STRESS STATE';
  }

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Text style={styles.text}>{title}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignSelf: 'center',
    elevation: 3
  },
  text: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  }
});
