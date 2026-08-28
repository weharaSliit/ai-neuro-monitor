import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../physiological/config/theme';

// The one card shape, replacing the dozens of hand-duplicated
// `{ borderRadius, borderWidth, padding, backgroundColor, borderColor }`
// StyleSheet blocks scattered across the app pre-redesign. Pass `onPress`
// to render a tappable card (e.g. Profile's navigational cards); omit it
// for a plain static card.
export default function Card({ children, onPress, style, accentColor, elevated = false, glass = false }) {
  const cardStyle = [
    styles.card,
    {
      borderColor: accentColor ? accentColor + '38' : COLORS.light.border,
      backgroundColor: glass ? COLORS.light.cardGlass : COLORS.light.card,
    },
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
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    marginBottom: 14,
    shadowColor: '#2D2938',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#2D2938',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 4,
  },
});
