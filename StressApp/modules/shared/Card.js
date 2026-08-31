import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../physiological/config/theme';

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
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
  },
});
