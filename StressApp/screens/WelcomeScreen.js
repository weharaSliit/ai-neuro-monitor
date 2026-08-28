import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Button from '../modules/shared/Button';
import ZenMeditationHero from '../modules/shared/ZenMeditationHero';
import { COLORS } from '../modules/physiological/config/theme';

export default function WelcomeScreen({ navigation }) {
  const text = COLORS.light.text;

  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Serene Meditation Hero Illustration */}
        <View style={styles.heroWrapper}>
          <ZenMeditationHero size={240} />
        </View>

        {/* Wordmark */}
        <View style={styles.copyBlock}>
          <Text style={[styles.wordmark, { color: text }]}>
            Mind<Text style={{ color: COLORS.brand }}>Pulse</Text>
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
    paddingTop: 16,
    paddingBottom: 32,
    justifyContent: 'space-between',
  },
  heroWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  copyBlock: {
    alignItems: 'center',
    paddingHorizontal: 10,
    marginBottom: 16,
  },
  wordmark: {
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginBottom: 4,
  },
  actions: {
    paddingTop: 8,
  },
  pillButton: {
    borderRadius: 28,
    paddingVertical: 15,
  },
});
