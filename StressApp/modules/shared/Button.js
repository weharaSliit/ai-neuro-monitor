import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS } from '../physiological/config/theme';

// Replaces the dozens of duplicated submitBtn/actionBtn/refreshBtn style
// blocks across the app. variant: 'primary' | 'secondary' | 'outline' | 'danger'.
export default function Button({ label, onPress, variant = 'primary', disabled = false, loading = false, style }) {
  const palette = {
    primary:   { bg: COLORS.brand,     text: '#FFFFFF',      border: COLORS.brand },
    secondary: { bg: COLORS.secondary, text: '#FFFFFF',      border: COLORS.secondary },
    outline:   { bg: 'transparent',    text: COLORS.brand,   border: COLORS.light.border },
    danger:    { bg: 'transparent',    text: COLORS.stress,  border: COLORS.stress + '50' },
  }[variant];

  return (
    <TouchableOpacity
      style={[
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border },
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <Text style={[styles.text, { color: palette.text }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  text: { fontSize: 15, fontWeight: '700' },
});
