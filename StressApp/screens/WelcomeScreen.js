import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Button from '../modules/shared/Button';
import Icon, { NAMES } from '../modules/shared/Icon';
import { COLORS } from '../modules/physiological/config/theme';

// Pre-login welcome moment -- deliberately minimal now: a mark, the
// wordmark, and one warm line underneath, the way Fely/Amelia-style
// wellness-app landing screens lead with the brand itself rather than a
// feature pitch. No hero illustration, no "live" language, no feature
// chips -- all of that read as over-explaining a marketing page rather
// than a calm first impression.
export default function WelcomeScreen({ navigation }) {
  const text  = COLORS.light.text;
  const muted = COLORS.light.textMuted;

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.mark}>
            <Icon name={NAMES.overview} size={48} color={COLORS.brand} />
          </View>
          <Text style={[styles.wordmark, { color: text }]}>
            Mind<Text style={{ color: COLORS.brand }}>Pulse</Text>
          </Text>
          <Text style={[styles.quote, { color: muted }]}>
            “Notice how you feel, before it tells you.”
          </Text>
        </View>

        <View style={styles.actions}>
          <Button label="Log In" onPress={() => navigation.navigate('Login')} variant="primary" style={styles.pillButton} />
          <View style={{ height: 12 }} />
          <Button label="Create Account" onPress={() => navigation.navigate('Register')} variant="outline" style={styles.pillButton} />
        </View>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 28, justifyContent: 'space-between' },
  hero:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: COLORS.brandGlow,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 22,
  },
  wordmark: { fontSize: 34, fontWeight: '900', letterSpacing: 0.2 },
  quote:    { fontSize: 15, fontStyle: 'italic', textAlign: 'center', marginTop: 16, lineHeight: 22, maxWidth: 280 },

  actions:    { paddingBottom: 12 },
  pillButton: { borderRadius: 30 },
});
