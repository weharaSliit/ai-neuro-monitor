import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Dimensions, StatusBar, ScrollView
} from 'react-native';
import { useTheme } from '../modules/physiological/config/ThemeContext';

const { width, height } = Dimensions.get('window');

function PulseRing({ delay, size, color, duration = 2400 }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const scale   = anim.interpolate({ inputRange: [0,1], outputRange: [0.6, 2.4] });
  const opacity = anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.5, 0.2, 0] });
  return (
    <Animated.View style={{
      position: 'absolute', width: size, height: size,
      borderRadius: size / 2, borderWidth: 1,
      borderColor: color, opacity, transform: [{ scale }],
    }} />
  );
}

function HRVLine({ color, isDark }) {
  const anims = [0,1,2,3,4,5,6].map(() => useRef(new Animated.Value(0.3)).current);
  useEffect(() => {
    anims.forEach((a, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 120),
          Animated.timing(a, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0.3, duration: 350, useNativeDriver: true }),
        ])
      ).start();
    });
  }, []);
  const heights = [5, 9, 22, 14, 7, 18, 5];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {anims.map((a, i) => (
        <Animated.View key={i} style={{
          width: 3, height: heights[i], borderRadius: 2,
          backgroundColor: color, opacity: a,
        }} />
      ))}
    </View>
  );
}

function SignalPill({ label, color, icon, isDark }) {
  const bg = isDark ? color + '18' : color + '15';
  return (
    <View style={[hStyles.pill, { backgroundColor: bg, borderColor: color + '40' }]}>
      <Text style={{ fontSize: 13 }}>{icon}</Text>
      <Text style={[hStyles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function StatBlock({ value, label, color, isDark }) {
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, tension: 80, friction: 6, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={[
      hStyles.statBlock,
      {
        backgroundColor: isDark ? color + '12' : color + '10',
        borderColor: color + '30',
        transform: [{ scale: scaleAnim }],
        opacity: fadeAnim,
      }
    ]}>
      <Text style={[hStyles.statValue, { color }]}>{value}</Text>
      <Text style={hStyles.statLabel}>{label}</Text>
    </Animated.View>
  );
}

export default function MainHomeScreen({ navigation }) {
  const { isDark, toggle, theme, COLORS } = useTheme();

  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const slideAnim   = useRef(new Animated.Value(50)).current;
  const scaleAnim   = useRef(new Animated.Value(0.85)).current;
  const glowAnim    = useRef(new Animated.Value(0)).current;
  const rotateAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 7, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2500, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2500, useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 20000, useNativeDriver: true })
    ).start();
  }, []);

  const t  = theme;
  const glowOpacity = glowAnim.interpolate({ inputRange: [0,1], outputRange: [0.3, 0.7] });
  const rotate      = rotateAnim.interpolate({ inputRange: [0,1], outputRange: ['0deg','360deg'] });

  return (
    <View style={[hStyles.container, { backgroundColor: t.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Background rings */}
      <View style={hStyles.ringsWrap}>
        <PulseRing delay={0}    size={160} color={COLORS.brand}    duration={3000} />
        <PulseRing delay={700}  size={160} color={COLORS.hrv}      duration={3000} />
        <PulseRing delay={1400} size={160} color={COLORS.gsr}      duration={3000} />
      </View>

      {/* Theme toggle */}
      <TouchableOpacity
        style={[hStyles.themeBtn, { backgroundColor: t.card, borderColor: t.border }]}
        onPress={toggle}
      >
        <Text style={{ fontSize: 17 }}>{isDark ? '☀️' : '🌙'}</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={hStyles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[hStyles.content, {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
        }]}>

          {/* Logo */}
          <View style={hStyles.logoSection}>
            <View style={hStyles.logoRingOuter}>
              <Animated.View style={[hStyles.logoRingInner, {
                borderColor: COLORS.brand,
                opacity: glowOpacity,
                transform: [{ rotate }],
              }]} />
              <View style={[hStyles.logoCore, {
                backgroundColor: isDark ? COLORS.brand + '20' : COLORS.brand + '15',
                borderColor: COLORS.brand + '40',
              }]}>
                <Text style={hStyles.logoEmoji}>🧠</Text>
              </View>
            </View>

            <View style={hStyles.waveRow}>
              <HRVLine color={COLORS.hrv} isDark={isDark} />
              <View style={[hStyles.heartDot, { backgroundColor: COLORS.normal }]} />
              <HRVLine color={COLORS.gsr} isDark={isDark} />
            </View>
          </View>

          {/* Title */}
          <Text style={[hStyles.appName, { color: t.text }]}>
            Mind<Text style={{ color: COLORS.brand }}>Pulse</Text>
          </Text>
          <Text style={[hStyles.tagline, { color: t.textMuted }]}>
            AI-Enhanced Multimodal{'\n'}Stress Detection System
          </Text>

          

          {/* Main card */}
          <View style={[hStyles.mainCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={hStyles.cardTopRow}>
              <View style={[hStyles.activeDot, { backgroundColor: COLORS.normal }]} />
              <Text style={[hStyles.cardTopLabel, { color: t.textSub }]}>
                Physiological Component
              </Text>
            </View>

            <Text style={[hStyles.cardTitle, { color: t.text }]}>
              Personalized Stress{'\n'}Detection Engine
            </Text>
          

            {/* Stats */}
            <View style={hStyles.statsRow}>
              <StatBlock value="22"   label="Features"  color={COLORS.brand}    isDark={isDark} />
              <StatBlock value="883"  label="Windows"   color={COLORS.hrv}      isDark={isDark} />
              <StatBlock value="81.8%" label="Distinct" color={COLORS.normal}   isDark={isDark} />
            </View>

            {/* Stress state strip */}
            <View style={[hStyles.stressStrip, { backgroundColor: t.surface, borderColor: t.border }]}>
              {[
                { label: 'Normal',   color: COLORS.normal,  emoji: '😌' },
                { label: 'Trending', color: COLORS.warning, emoji: '😰' },
                { label: 'Stress',   color: COLORS.stress,  emoji: '😨' },
              ].map((s, i) => (
                <View key={i} style={[hStyles.stressItem, i < 2 && { borderRightColor: t.border, borderRightWidth: 1 }]}>
                  <Text style={{ fontSize: 18 }}>{s.emoji}</Text>
                  <Text style={[hStyles.stressLabel, { color: s.color }]}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* CTA */}
            <TouchableOpacity
              style={[hStyles.enterBtn, { backgroundColor: COLORS.brand }]}
              onPress={() => navigation.navigate('Physiological')}
              activeOpacity={0.87}
            >
              <Text style={hStyles.enterBtnText}>Enter MindPulse</Text>
              <Text style={[hStyles.enterArrow, { color: COLORS.brandLight }]}>→</Text>
            </TouchableOpacity>
          </View>


        </Animated.View>
      </ScrollView>
    </View>
  );
}

const hStyles = StyleSheet.create({
  container:     { flex: 1 },
  ringsWrap:     { position: 'absolute', alignItems: 'center', justifyContent: 'center', top: height * 0.18, left: width / 2 - 80 },
  themeBtn:      { position: 'absolute', top: 54, right: 20, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, zIndex: 20 },
  scroll:        { flexGrow: 1, paddingBottom: 40 },
  content:       { alignItems: 'center', paddingHorizontal: 24, paddingTop: 80 },
  logoSection:   { alignItems: 'center', marginBottom: 24 },
  logoRingOuter: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  logoRingInner: { position: 'absolute', width: 118, height: 118, borderRadius: 59, borderWidth: 1, borderStyle: 'dashed' },
  logoCore:      { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  logoEmoji:     { fontSize: 46 },
  waveRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heartDot:      { width: 7, height: 7, borderRadius: 3.5 },
  appName:       { fontSize: 44, fontWeight: '900', letterSpacing: -1.5, marginBottom: 10 },
  tagline:       { fontSize: 15, textAlign: 'center', lineHeight: 24, marginBottom: 24 },
  pillsRow:      { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 28 },
  pill:          { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  pillText:      { fontSize: 12, fontWeight: '700' },
  mainCard:      { width: '100%', borderRadius: 24, padding: 22, borderWidth: 1, marginBottom: 20 },
  cardTopRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  activeDot:     { width: 8, height: 8, borderRadius: 4 },
  cardTopLabel:  { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  cardTitle:     { fontSize: 22, fontWeight: '900', lineHeight: 30, marginBottom: 8 },
  cardDesc:      { fontSize: 13, lineHeight: 20, marginBottom: 18 },
  statsRow:      { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBlock:     { flex: 1, alignItems: 'center', padding: 12, borderRadius: 14, borderWidth: 1 },
  statValue:     { fontSize: 18, fontWeight: '900' },
  statLabel:     { fontSize: 10, color: '#64748b', marginTop: 3, fontWeight: '600' },
  stressStrip:   { flexDirection: 'row', borderRadius: 14, borderWidth: 1, marginBottom: 18, overflow: 'hidden' },
  stressItem:    { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 4 },
  stressLabel:   { fontSize: 10, fontWeight: '800' },
  enterBtn:      { borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  enterBtnText:  { color: '#fff', fontSize: 17, fontWeight: '800' },
  enterArrow:    { fontSize: 20, fontWeight: '700' },
  bottomNote:    { fontSize: 12, marginTop: 4 },
});