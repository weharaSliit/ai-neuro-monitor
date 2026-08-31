import React from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Button from '../modules/shared/Button';
import ZenMeditationHero from '../modules/shared/ZenMeditationHero';
import { COLORS } from '../modules/physiological/config/theme';

export default function WelcomeScreen({ navigation }) {
  const text = COLORS.light.text;
  const windowWidth = Dimensions.get('window').width;
  const heroSize = Math.min(330, windowWidth - 48);

  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Top Serene Meditation Hero Illustration */}
        <View style={styles.heroWrapper}>
          <ZenMeditationHero size={heroSize} />
        </View>

        {/* Wordmark & Inspiring Stress Quote */}
        <View style={styles.copyBlock}>
          <Text style={[styles.wordmark, { color: text }]}>
            Mind<Text style={{ color: COLORS.brand }}>Pulse</Text>
          </Text>
          <Text style={[styles.quote, { color: COLORS.light.textMuted }]}>
            “In the midst of movement and chaos, keep stillness inside of you.”
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <Button
            label="Begin Your Journey →"
            onPress={() => navigation.navigate('Register')}
            variant="calm"
            style={styles.pillButton}
          />
          <View style={{ height: 12 }} />
          <Button
            label="I already have an account"
            onPress={() => navigation.navigate('Login')}
            variant="outline"
            style={styles.pillButton}
          />
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
    justifyContent: 'space-between',
  },
  heroWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  copyBlock: {
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  wordmark: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginBottom: 6,
    textAlign: 'center',
  },
  quote: {
    fontSize: 14,
    fontStyle: 'italic',
    fontWeight: '500',
    letterSpacing: 0.1,
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    paddingTop: 8,
  },
  pillButton: {
    borderRadius: 28,
    paddingVertical: 16,
  },
});
