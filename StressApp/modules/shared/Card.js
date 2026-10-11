import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../physiological/config/theme';
import { RADIUS, ELEVATION } from './theme/tokens';

export default function Card({ children, onPress, style, accentColor, elevated = false, glass = false }) {
  const cardStyle = [
    styles.card,
    {
      borderColor: accentColor ? accentColor + '30' : COLORS.light.border,
      backgroundColor: glass ? COLORS.light.cardGlass : COLORS.light.card,
    },
    accentColor && { borderLeftColor: accentColor, borderLeftWidth: 3 },
    elevated && styles.elevated,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.85}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
    ...ELEVATION.resting,
  },
  elevated: {
    ...ELEVATION.elevated,
  },
});
