import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Dimensions, StatusBar
} from 'react-native';
import { useTheme } from '../modules/physiological/config/ThemeContext';

const { width, height } = Dimensions.get('window');

function PulseRing({ delay, size, color }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1, duration: 2000, useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0, duration: 0, useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const scale   = anim.interpolate({ inputRange: [0,1], outputRange: [0.8, 2.2] });
  const opacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.3, 0] });

  return (
    <Animated.View style={{
      position:     'absolute',
      width:        size,
      height:       size,
      borderRadius: size / 2,
      borderWidth:  1.5,
      borderColor:  color,
      opacity,
      transform:    [{ scale }],
    }} />
  );
}

function HRVWave({ color }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 3000, useNativeDriver: true })
    ).start();
  }, []);

  // Simple animated dots as wave
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const dotAnim = useRef(new Animated.Value(0)).current;
        useEffect(() => {
          Animated.loop(
            Animated.sequence([
              Animated.delay(i * 150),
              Animated.timing(dotAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
              Animated.timing(dotAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
            ])
          ).start();
        }, []);

        const heights = [4, 8, 20, 12, 6, 16, 4];
        const scaleY  = dotAnim.interpolate({ inputRange: [0,1], outputRange: [0.5, 1] });

        return (
          <Animated.View key={i} style={{
            width:           3,
            height:          heights[i],
            backgroundColor: color,
            borderRadius:    2,
            transform:       [{ scaleY }],
          }} />
        );
      })}
    </View>
  );
}

export default function MainHomeScreen({ navigation }) {
  const { isDark, toggle, theme } = useTheme();

  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const slideAnim  = useRef(new Animated.Value(40)).current;
  const scaleAnim  = useRef(new Animated.Value(0.9)).current;
  const glowAnim   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const bgColor    = isDark ? '#060d1a' : '#f0f9ff';
  const cardBg     = isDark ? '#0f1f35' : '#ffffff';
  const textColor  = isDark ? '#f0f9ff' : '#0f172a';
  const mutedColor = isDark ? '#64748b' : '#64748b';
  const borderCol  = isDark ? '#1e3a5f' : '#e2e8f0';

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.4, 0.8]
  });

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Background pulse rings */}
      <View style={styles.ringsContainer}>
        <PulseRing delay={0}    size={200} color="#6366f140" />
        <PulseRing delay={600}  size={200} color="#06b6d440" />
        <PulseRing delay={1200} size={200} color="#8b5cf440" />
      </View>

      {/* Theme toggle */}
      <TouchableOpacity style={[styles.themeToggle, { backgroundColor: cardBg, borderColor: borderCol }]} onPress={toggle}>
        <Text style={{ fontSize: 18 }}>{isDark ? '☀️' : '🌙'}</Text>
      </TouchableOpacity>

      <Animated.View style={[styles.content, {
        opacity:   fadeAnim,
        transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
      }]}>

        {/* Logo area */}
        <View style={styles.logoArea}>
          <Animated.View style={[styles.logoRing, {
            borderColor: '#6366f1',
            opacity:     glowOpacity,
          }]}>
            <View style={[styles.logoInner, { backgroundColor: isDark ? '#0f1f35' : '#eff6ff' }]}>
              <Text style={styles.logoEmoji}>🧠</Text>
            </View>
          </Animated.View>

          {/* Pulse line */}
          <View style={styles.pulseRow}>
            <HRVWave color="#6366f1" />
            <View style={[styles.pulseDot, { backgroundColor: '#10b981' }]} />
            <HRVWave color="#06b6d4" />
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.appName, { color: textColor }]}>
          Mind<Text style={styles.appNameAccent}>Pulse</Text>
        </Text>
        <Text style={[styles.tagline, { color: mutedColor }]}>
          AI-Enhanced IoT Multimodal{'\n'}Stress Management System
        </Text>

        {/* Signal badges */}
        <View style={styles.badgesRow}>
          <SignalBadge label="HRV" color="#06b6d4" icon="💓" dark={isDark} />
          <SignalBadge label="GSR" color="#8b5cf6" icon="⚡" dark={isDark} />
          <SignalBadge label="3-Class" color="#10b981" icon="🎯" dark={isDark} />
        </View>

        {/* Main CTA card */}
        <View style={[styles.ctaCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
          <View style={styles.ctaHeader}>
            <View style={[styles.ctaDot, { backgroundColor: '#10b981' }]} />
            <Text style={[styles.ctaTitle, { color: textColor }]}>
              Physiological Component
            </Text>
          </View>
          <Text style={[styles.ctaDesc, { color: mutedColor }]}>
            AI-Driven Personalized Pre-Stress Detection{'\n'}
            using Multimodal HRV and GSR Signals
          </Text>

          <View style={styles.statsRow}>
            <StatChip value="22" label="Features" color="#6366f1" dark={isDark} />
            <StatChip value="883" label="Windows" color="#06b6d4" dark={isDark} />
            <StatChip value="3" label="Classes" color="#10b981" dark={isDark} />
          </View>

          <TouchableOpacity
            style={styles.enterBtn}
            onPress={() => navigation.navigate('Physiological')}
            activeOpacity={0.85}
          >
            <View style={styles.enterBtnInner}>
              <Text style={styles.enterBtnText}>Enter MindPulse</Text>
              <Text style={styles.enterBtnArrow}>→</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Bottom label */}
        <Text style={[styles.bottomLabel, { color: mutedColor }]}>
          Wehara · Pre-Stress Detection Research
        </Text>

      </Animated.View>
    </View>
  );
}

function SignalBadge({ label, color, icon, dark }) {
  return (
    <View style={[styles.badge, {
      backgroundColor: color + '20',
      borderColor:     color + '60',
    }]}>
      <Text style={{ fontSize: 12 }}>{icon}</Text>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function StatChip({ value, label, color, dark }) {
  return (
    <View style={[styles.statChip, {
      backgroundColor: color + '15',
      borderColor:     color + '40',
    }]}>
      <Text style={[styles.statChipValue, { color }]}>{value}</Text>
      <Text style={styles.statChipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ringsContainer: { position: 'absolute', alignItems: 'center', justifyContent: 'center', top: height * 0.25 },
  themeToggle:    { position: 'absolute', top: 54, right: 20, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, zIndex: 10 },
  content:        { alignItems: 'center', paddingHorizontal: 24, width: '100%' },
  logoArea:       { alignItems: 'center', marginBottom: 20 },
  logoRing:       { width: 110, height: 110, borderRadius: 55, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoInner:      { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  logoEmoji:      { fontSize: 44 },
  pulseRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulseDot:       { width: 6, height: 6, borderRadius: 3 },
  appName:        { fontSize: 42, fontWeight: '900', letterSpacing: -1, marginBottom: 8 },
  appNameAccent:  { color: '#6366f1' },
  tagline:        { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  badgesRow:      { flexDirection: 'row', gap: 10, marginBottom: 24 },
  badge:          { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  badgeText:      { fontSize: 12, fontWeight: '700' },
  ctaCard:        { width: '100%', borderRadius: 24, padding: 22, borderWidth: 1, marginBottom: 20 },
  ctaHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  ctaDot:         { width: 8, height: 8, borderRadius: 4 },
  ctaTitle:       { fontSize: 16, fontWeight: '700' },
  ctaDesc:        { fontSize: 13, lineHeight: 20, color: '#64748b', marginBottom: 16 },
  statsRow:       { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statChip:       { flex: 1, alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1 },
  statChipValue:  { fontSize: 20, fontWeight: '900' },
  statChipLabel:  { fontSize: 10, color: '#64748b', marginTop: 2 },
  enterBtn:       { backgroundColor: '#6366f1', borderRadius: 14, overflow: 'hidden' },
  enterBtnInner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  enterBtnText:   { color: '#fff', fontSize: 17, fontWeight: '800' },
  enterBtnArrow:  { color: '#c7d2fe', fontSize: 20, fontWeight: '700' },
  bottomLabel:    { fontSize: 12 },
});