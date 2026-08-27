import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../physiological/config/theme';

// Outer wrapper for every main-app screen -- a subtle top-to-bottom gradient
// wash (mist lavender -> warm ivory) instead of a flat white background,
// per the "gentle colors going under the background" design brief. Replaces
// each screen's own `<SafeAreaView style={{ backgroundColor: theme.bg }}>`.
// `edges` passes through to SafeAreaView -- pushed screens with a native
// header (headerShown: true in App.js) pass `['left','right']` so the
// header itself owns the top inset instead of double-padding.
export default function ScreenBackground({ children, style, edges }) {
  return (
    <LinearGradient
      colors={[COLORS.light.bgGradientTop, COLORS.light.bgGradientBottom]}
      style={styles.fill}
    >
      <SafeAreaView style={[styles.fill, style]} edges={edges}>
        {children}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
