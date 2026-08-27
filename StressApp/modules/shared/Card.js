import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../physiological/config/theme';

// The one card shape, replacing the dozens of hand-duplicated
// `{ borderRadius, borderWidth, padding, backgroundColor, borderColor }`
// StyleSheet blocks scattered across the app pre-redesign. Pass `onPress`
// to render a tappable card (e.g. Profile's navigational cards); omit it
// for a plain static card.
export default function Card({ children, onPress, style, accentColor, elevated = false }) {
  const cardStyle = [
    styles.card,
    { borderColor: accentColor ? accentColor + '40' : COLORS.light.border },
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
    // Slightly translucent instead of flat #FFFFFF -- lets a hint of the
    // screen's own gradient show through so cards read as part of the page,
    // not pasted-on white rectangles.
    backgroundColor: COLORS.light.card + 'F2',
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
    shadowColor: COLORS.brandDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  elevated: {
    shadowColor: COLORS.brandDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 4,
  },
});
