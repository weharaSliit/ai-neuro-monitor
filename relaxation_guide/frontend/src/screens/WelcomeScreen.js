import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

export const WelcomeScreen = () => {
  const { setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <View style={styles.heroBadge}>
        <Text style={styles.heroIcon}>🧠 🌿 ⚡</Text>
      </View>

      <Text style={[styles.title, { color: theme.textPrimary }]}>Welcome to CAPS</Text>
      <Text style={[styles.subtitle, { color: theme.accent }]}>
        Context-Aware Personalized Stress Intervention System
      </Text>

      <Text style={[styles.desc, { color: theme.textSecondary }]}>
        Member 4 Component • Multi-modal bio-feedback signals (EEG earbud, Smart Ring GSR/HRV, Phone Phenotype) paired with Contextual Thompson Sampling for real-time gamified neural relaxation.
      </Text>

      <View style={styles.btnStack}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
          onPress={() => setCurrentScreen('SignUp')}
        >
          <Text style={[styles.primaryBtnTxt, { color: theme.accentText }]}>Create Account →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}
          onPress={() => setCurrentScreen('SignIn')}
        >
          <Text style={[styles.secondaryBtnTxt, { color: theme.textPrimary }]}>Sign In</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.guestBtn}
          onPress={() => setCurrentScreen('PrivacyPolicy')}
        >
          <Text style={[styles.guestBtnTxt, { color: theme.textMuted }]}>Explore as Guest Participant</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center'
  },
  heroBadge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20
  },
  heroIcon: {
    fontSize: 32
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1.0,
    marginBottom: 6
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16
  },
  desc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
    paddingHorizontal: 10
  },
  btnStack: {
    width: '100%',
    gap: 12
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center'
  },
  primaryBtnTxt: {
    fontWeight: '800',
    fontSize: 16
  },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1
  },
  secondaryBtnTxt: {
    fontWeight: '700',
    fontSize: 15
  },
  guestBtn: {
    paddingVertical: 10,
    alignItems: 'center'
  },
  guestBtnTxt: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline'
  }
});
