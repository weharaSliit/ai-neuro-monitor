import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../physiological/config/theme';
import { MAX_CONTENT_WIDTH } from './theme/layout';

// Outer wrapper for every main-app screen -- a subtle top-to-bottom gradient
// wash (mist lavender -> warm ivory) instead of a flat white background,
// per the "gentle colors going under the background" design brief. Replaces
// each screen's own `<SafeAreaView style={{ backgroundColor: theme.bg }}>`.
// `edges` passes through to SafeAreaView -- pushed screens with a native
// header (headerShown: true in App.js) pass `['left','right']` so the
// header itself owns the top inset instead of double-padding.
// The inner column is capped at MAX_CONTENT_WIDTH and centred, so every
// screen scales cleanly to tablets/landscape without per-screen changes
// (on phones the cap is wider than the screen, so nothing changes).
export default function ScreenBackground({ children, style, edges }) {
  return (
    <LinearGradient
      colors={[COLORS.light.bgGradientTop, COLORS.light.bgGradientBottom]}
      style={styles.fill}
    >
      {/* Soft pastel glows -- same palette as the website background. */}
      <View pointerEvents="none" style={[styles.glow, styles.glowA]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowB]} />
      <SafeAreaView style={[styles.fill, style]} edges={edges}>
        <View style={styles.column}>{children}</View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  glow: { position: 'absolute', borderRadius: 999 },
  glowA: { width: 360, height: 360, top: -140, left: -120, backgroundColor: '#EAE7FB', opacity: 0.7 },
  glowB: { width: 320, height: 320, top: -60, right: -150, backgroundColor: '#FCE9E1', opacity: 0.6 },
});
