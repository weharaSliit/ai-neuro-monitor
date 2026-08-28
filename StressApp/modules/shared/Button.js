import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS } from '../physiological/config/theme';

// Replaces the duplicated button blocks across the app.
// variant: 'primary' | 'secondary' | 'calm' | 'outline' | 'danger'.
export default function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon = null,
  style,
  textStyle,
}) {
  const palette = {
    primary:   { bg: COLORS.brand,     text: '#FFFFFF',      border: COLORS.brand,     shadow: COLORS.brandDark },
    secondary: { bg: COLORS.secondary, text: '#FFFFFF',      border: COLORS.secondary, shadow: COLORS.secondary },
    calm:      { bg: COLORS.normal,    text: '#FFFFFF',      border: COLORS.normal,    shadow: COLORS.normalDark },
    outline:   { bg: '#FFFFFF',        text: COLORS.brand,   border: COLORS.light.border, shadow: null },
    danger:    { bg: '#FFFFFF',        text: COLORS.stress,  border: COLORS.stress + '40', shadow: null },
  }[variant] || { bg: COLORS.brand, text: '#FFFFFF', border: COLORS.brand, shadow: COLORS.brandDark };

  return (
    <TouchableOpacity
      style={[
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          shadowColor: palette.shadow || 'transparent',
          shadowOpacity: palette.shadow ? 0.15 : 0,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 10,
          elevation: palette.shadow ? 3 : 0,
        },
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} size="small" />
      ) : (
        <>
          {icon}
          <Text style={[styles.text, { color: palette.text }, textStyle]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 28,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  disabled: { opacity: 0.45 },
  text: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
});
