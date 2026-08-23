import React, { useContext, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

const FEATURES = [
  { icon: '🧠', label: 'EEG Monitor', desc: 'Neural Alpha/Beta' },
  { icon: '💓', label: 'HRV Sensor', desc: 'RMSSD / SDNN' },
  { icon: '🌡️', label: 'GSR Sensor', desc: 'Skin Conductance' },
];

export const WelcomeScreen = () => {
  const { setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  // Floating icons
  const float1 = useRef(new Animated.Value(0)).current;
  const float2 = useRef(new Animated.Value(0)).current;
  const float3 = useRef(new Animated.Value(0)).current;

  // Staggered entrance
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroSlide   = useRef(new Animated.Value(30)).current;
  const featureOpacity = useRef(new Animated.Value(0)).current;
  const featureSlide   = useRef(new Animated.Value(20)).current;
  const btnOpacity  = useRef(new Animated.Value(0)).current;
  const btnSlide    = useRef(new Animated.Value(20)).current;

  const startFloat = (anim, delay, range) => {
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: -range, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: range, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    }, delay);
  };

  useEffect(() => {
    startFloat(float1, 0, 8);
    startFloat(float2, 600, 6);
    startFloat(float3, 1200, 10);

    Animated.stagger(160, [
      Animated.parallel([
        Animated.timing(heroOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.spring(heroSlide, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(featureOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(featureSlide, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(btnOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(btnSlide, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      {/* Background glow orb */}
      <View style={[styles.glowOrb, { backgroundColor: theme.accent + '08' }]} />

      {/* Hero section */}
      <Animated.View style={[styles.hero, { opacity: heroOpacity, transform: [{ translateY: heroSlide }] }]}>
        <View style={styles.iconsRow}>
          <Animated.Text style={[styles.floatIcon, { transform: [{ translateY: float1 }] }]}>🌿</Animated.Text>
          <Animated.Text style={[styles.centerIcon, { transform: [{ translateY: float2 }] }]}>🧠</Animated.Text>
          <Animated.Text style={[styles.floatIcon, { transform: [{ translateY: float3 }] }]}>⚡</Animated.Text>
        </View>

        <View style={[styles.titleBadge, { borderColor: theme.accent + '40' }]}>
          <Text style={[styles.titleBadgeTxt, { color: theme.accent }]}>Research · Member 4 · Bio-Feedback</Text>
        </View>

        <Text style={[styles.title, { color: theme.textPrimary }]}>Welcome to</Text>
        <Text style={[styles.titleAccent, { color: theme.accent }]}>Calm AI</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Your personal stress intervention system powered by real-time bio-signals and adaptive neural intelligence.
        </Text>
      </Animated.View>

      {/* Feature stat row */}
      <Animated.View style={[styles.featureRow, { opacity: featureOpacity, transform: [{ translateY: featureSlide }] }]}>
        {FEATURES.map((f, i) => (
          <View
            key={i}
            style={[styles.featureCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}
          >
            <Text style={styles.featureIcon}>{f.icon}</Text>
            <Text style={[styles.featureLabel, { color: theme.textPrimary }]}>{f.label}</Text>
            <Text style={[styles.featureDesc, { color: theme.textMuted }]}>{f.desc}</Text>
          </View>
        ))}
      </Animated.View>

      {/* CTA Buttons */}
      <Animated.View style={[styles.btnStack, { opacity: btnOpacity, transform: [{ translateY: btnSlide }] }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
          onPress={() => setCurrentScreen('SignUp')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnTxt, { color: theme.accentText }]}>🚀  Create Account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}
          onPress={() => setCurrentScreen('SignIn')}
          activeOpacity={0.8}
        >
          <Text style={[styles.secondaryBtnTxt, { color: theme.textPrimary }]}>Sign In  →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.guestBtn}
          onPress={() => setCurrentScreen('PrivacyPolicy')}
          activeOpacity={0.7}
        >
          <Text style={[styles.guestBtnTxt, { color: theme.textMuted }]}>Explore as Guest Participant</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  glowOrb: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    top: '10%',
  },
  hero: { alignItems: 'center', width: '100%' },
  iconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  floatIcon: { fontSize: 30 },
  centerIcon: { fontSize: 44 },
  titleBadge: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 12,
  },
  titleBadgeTxt: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 0 },
  titleAccent: { fontSize: 38, fontWeight: '900', letterSpacing: 1, marginBottom: 10 },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  featureCard: {
    flex: 1,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  featureIcon: { fontSize: 22 },
  featureLabel: { fontSize: 11, fontWeight: '800', textAlign: 'center' },
  featureDesc: { fontSize: 9, fontWeight: '600', textAlign: 'center' },
  btnStack: { width: '100%', gap: 10 },
  primaryBtn: {
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  primaryBtnTxt: { fontWeight: '800', fontSize: 16 },
  secondaryBtn: {
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryBtnTxt: { fontWeight: '700', fontSize: 15 },
  guestBtn: { paddingVertical: 10, alignItems: 'center' },
  guestBtnTxt: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
