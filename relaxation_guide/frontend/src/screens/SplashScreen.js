import React, { useEffect, useContext, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { AppContext } from '../context/AppContext';

export const SplashScreen = () => {
  const { setCurrentScreen, privacyAccepted } = useContext(AppContext);

  // Entrance animations
  const logoScale   = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity  = useRef(new Animated.Value(0)).current;
  const titleSlide    = useRef(new Animated.Value(20)).current;
  const subOpacity    = useRef(new Animated.Value(0)).current;
  const btnOpacity    = useRef(new Animated.Value(0)).current;

  // Breathing ring animations
  const ring1Scale   = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.5)).current;
  const ring2Scale   = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0.3)).current;
  const ring3Scale   = useRef(new Animated.Value(1)).current;
  const ring3Opacity = useRef(new Animated.Value(0.15)).current;

  // Logo inner pulse
  const logoGlow = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Auto-navigate after 3s
    const timer = setTimeout(() => {
      if (privacyAccepted) {
        setCurrentScreen('Dashboard');
      } else {
        setCurrentScreen('Login');
      }
    }, 3000);

    // Staggered entrance
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
      Animated.stagger(150, [
        Animated.parallel([
          Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.spring(titleSlide, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
        ]),
        Animated.timing(subOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    ]).start();

    // Breathing ring 1 — slow outer
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ring1Scale, { toValue: 2.6, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(ring1Opacity, { toValue: 0, duration: 2800, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(ring1Scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(ring1Opacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();

    // Ring 2 — delayed
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring2Scale, { toValue: 2.6, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0, duration: 2800, easing: Easing.in(Easing.ease), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring2Scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0.3, duration: 0, useNativeDriver: true }),
          ]),
        ])
      ).start();
    }, 900);

    // Ring 3 — more delayed
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring3Scale, { toValue: 2.6, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(ring3Opacity, { toValue: 0, duration: 2800, easing: Easing.in(Easing.ease), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring3Scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring3Opacity, { toValue: 0.15, duration: 0, useNativeDriver: true }),
          ]),
        ])
      ).start();
    }, 1800);

    // Logo gentle breathing
    Animated.loop(
      Animated.sequence([
        Animated.timing(logoGlow, { toValue: 1.08, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(logoGlow, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    return () => clearTimeout(timer);
  }, [privacyAccepted]);

  return (
    <View style={styles.container}>
      {/* Background glow */}
      <View style={styles.bgGlow} />

      <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        {/* Breathing rings */}
        <Animated.View style={[styles.ring, styles.ring1, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
        <Animated.View style={[styles.ring, styles.ring2, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
        <Animated.View style={[styles.ring, styles.ring3, { transform: [{ scale: ring3Scale }], opacity: ring3Opacity }]} />

        {/* Logo badge */}
        <Animated.View style={[styles.logoBadge, { transform: [{ scale: logoGlow }] }]}>
          <Text style={styles.logoIcon}>🫁</Text>
        </Animated.View>
      </Animated.View>

      <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleSlide }], alignItems: 'center' }}>
        <Text style={styles.title}>CAPS</Text>
        <Text style={styles.titleSub}>Calm AI</Text>
      </Animated.View>

      <Animated.Text style={[styles.subtitle, { opacity: subOpacity }]}>
        Context-Aware Personalized Stress Intervention System
      </Animated.Text>

      <Animated.Text style={[styles.memberTag, { opacity: subOpacity }]}>
        Bio-Feedback · Thompson Sampling · Closed-Loop Recovery
      </Animated.Text>

      <Animated.View style={{ opacity: btnOpacity, width: '100%', alignItems: 'center' }}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={() => setCurrentScreen(privacyAccepted ? 'Dashboard' : 'Login')}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>Begin Your Journey  →</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Loading dots */}
      <Animated.View style={[styles.dotsRow, { opacity: subOpacity }]}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[styles.dot, i === 1 && { backgroundColor: '#38BDF8', width: 16 }]} />
        ))}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060E1E',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  bgGlow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(56, 189, 248, 0.04)',
    top: '25%',
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 130,
    height: 130,
    marginBottom: 8,
  },
  ring: {
    position: 'absolute',
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: '#38BDF8',
  },
  ring1: { width: 90, height: 90 },
  ring2: { width: 90, height: 90 },
  ring3: { width: 90, height: 90 },
  logoBadge: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#38BDF8',
  },
  logoIcon: { fontSize: 42 },
  title: {
    color: '#F8FAFC',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 6,
  },
  titleSub: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: -4,
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 4,
    paddingHorizontal: 16,
  },
  memberTag: {
    color: '#334155',
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  continueBtn: {
    marginTop: 16,
    backgroundColor: '#38BDF8',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  btnText: {
    color: '#060E1E',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#334155',
  },
});
