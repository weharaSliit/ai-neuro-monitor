import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Replaces the repeated colored label-pill pattern (StatusPill, userBadge,
// alphaBadge, etc.) scattered across screens pre-redesign.
export default function Badge({ label, color, size = 'md' }) {
  const small = size === 'sm';
  return (
    <View style={[
      styles.badge,
      { backgroundColor: color + '18', borderColor: color + '40' },
      small && styles.badgeSm,
    ]}>
      <Text style={[styles.text, { color }, small && styles.textSm]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  badgeSm: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  text: { fontSize: 12, fontWeight: '700' },
  textSm: { fontSize: 10 },
});
