import React, { useState, useContext, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Animated, Easing, Dimensions
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';
import { useSweetAlert } from '../context/SweetAlertContext';

const { width: SCREEN_W } = Dimensions.get('window');

const DAILY_TIPS = [
  { tip: 'Box breathing (4-4-4-4) lowers cortisol within 90 seconds.', icon: '🌬️' },
  { tip: 'Even a 5-minute walk reduces HRV stress markers by up to 15%.', icon: '🚶' },
  { tip: 'Jaw unclenching signals your vagus nerve to activate the calm response.', icon: '😌' },
  { tip: 'Cold water on your wrists can lower GSR skin conductance rapidly.', icon: '💧' },
  { tip: 'Progressive muscle relaxation is most effective starting from your feet.', icon: '🧘' },
];

/* ────────────────────────────────────────────────────────
   MOTIVATIONAL QUOTES DATA
   ──────────────────────────────────────────────────────── */
const QUOTES = [
  { quote: "You don't have to control your thoughts; you just have to stop letting them control you.", author: "Dan Millman", icon: "🌿" },
  { quote: "Breathe in peace, exhale tension. Every moment is a fresh start for your nervous system.", author: "Mindfulness Wisdom", icon: "🌬️" },
  { quote: "Your calm mind is the ultimate weapon against your daily challenges.", author: "Marcus Aurelius", icon: "⚔️" },
  { quote: "Within you, there is a stillness and a sanctuary to which you can retreat at any time.", author: "Hermann Hesse", icon: "🏔️" },
  { quote: "Tension is who you think you should be. Relaxation is who you are.", author: "Chinese Proverb", icon: "☯️" },
  { quote: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott", icon: "🔌" },
  { quote: "The greatest weapon against stress is our ability to choose one thought over another.", author: "William James", icon: "🧠" },
  { quote: "In the middle of difficulty lies opportunity.", author: "Albert Einstein", icon: "💡" },
  { quote: "Feelings come and go like clouds in a windy sky. Conscious breathing is my anchor.", author: "Thich Nhat Hanh", icon: "☁️" },
  { quote: "When you own your breath, nobody can steal your peace.", author: "Zen Proverb", icon: "🕊️" }
];

/* ────────────────────────────────────────────────────────
   LIVE QUOTES BANNER - Auto-rotating with crossfade
   ──────────────────────────────────────────────────────── */
const LiveQuotesBanner = ({ theme }) => {
  const [index, setIndex] = useState(Math.floor(Math.random() * QUOTES.length));
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  const cycleQuote = useCallback(() => {
    // Fade out + slide up
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -12, duration: 400, useNativeDriver: true })
    ]).start(() => {
      setIndex(prev => (prev + 1) % QUOTES.length);
      slideAnim.setValue(12);
      // Fade in + slide down into place
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true })
      ]).start();
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(cycleQuote, 8000);
    return () => clearInterval(timer);
  }, [cycleQuote]);

  const q = QUOTES[index];

  return (
    <View style={[s.quoteCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
      {/* Decorative accent line */}
      <View style={[s.quoteAccentLine, { backgroundColor: theme.accent }]} />

      <Animated.View style={[s.quoteInner, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <Text style={s.quoteIcon}>{q.icon}</Text>
        <Text style={[s.quoteText, { color: theme.textPrimary }]}>"{q.quote}"</Text>
        <Text style={[s.quoteAuthor, { color: theme.accent }]}>— {q.author}</Text>
      </Animated.View>

      {/* Dot indicators */}
      <View style={s.dotRow}>
        {QUOTES.map((_, i) => (
          <View key={i} style={[s.dot, { backgroundColor: i === index ? theme.accent : theme.border }]} />
        ))}
      </View>
    </View>
  );
};

/* ────────────────────────────────────────────────────────
   PULSING LIVE DOT
   ──────────────────────────────────────────────────────── */
const PulseDot = ({ color }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.8, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true })
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true })
        ])
      ])
    ).start();
  }, []);

  return (
    <View style={s.pulseDotWrap}>
      <Animated.View style={[s.pulseRing, { backgroundColor: color, transform: [{ scale }], opacity }]} />
      <View style={[s.pulseDotCore, { backgroundColor: color }]} />
    </View>
  );
};

/* ────────────────────────────────────────────────────────
   STRESS STATE CONFIG HELPER
   ──────────────────────────────────────────────────────── */
const getStateConfig = (stressState, stressProbability, theme, isCalibrated = true, hasLivePacket = true) => {
  if (isCalibrated === false) {
    return {
      color: theme.warning,
      bgTint: 'rgba(245,158,11,0.14)',
      label: 'WAITING FOR CALIBRATION',
      emoji: '⏳',
      tagline: 'Waiting for 2-minute baseline calibration... Real-time stress detection active after calibration',
      icon: '⏳',
      pct: '--',
      breathDuration: 2000,
    };
  }

  if (hasLivePacket === false) {
    return {
      color: theme.warning,
      bgTint: 'rgba(245,158,11,0.14)',
      label: 'AWAITING LLIVE STREAM',
      emoji: '📡',
      tagline: 'Active session initialized — waiting for live fusion telemetry stream from sensors...',
      icon: '📡',
      pct: '--',
      breathDuration: 2000,
    };
  }

  const normState = (stressState || '').toLowerCase();
  const prob = typeof stressProbability === 'number' ? stressProbability : 0.15;

  // Pipeline Color Synchronization:
  // Red (>= 60% or high_stress) -> HIGH STRESS
  // Green (< 35% or normal) -> NORMAL BASELINE
  if (normState === 'stress' || normState === 'high_stress' || normState === 'high' || normState === 'acute' || prob >= 0.60) {
    return {
      color: theme.danger,
      bgTint: 'rgba(239,68,68,0.14)',
      label: 'HIGH STRESS',
      emoji: '🔴',
      tagline: 'High sympathetic activation detected — Intervention recommended',
      icon: '🫀',
      pct: Math.min(99, Math.round(prob * 100)),
      breathDuration: 1200,
    };
  }
  if (normState === 'pre-stress' || normState === 'pre_stress' || normState === 'medium' || normState === 'moderate' || prob >= 0.35) {
    return {
      color: theme.warning,
      bgTint: 'rgba(245,158,11,0.14)',
      label: 'PRE-STRESS',
      emoji: '🟠',
      tagline: 'Elevated arousal detected — Early intervention window open',
      icon: '⚡',
      pct: Math.min(99, Math.round(prob * 100)),
      breathDuration: 2000,
    };
  }
  return {
    color: theme.success,
    bgTint: 'rgba(16,185,129,0.14)',
    label: 'NORMAL BASELINE',
    emoji: '🟢',
    tagline: 'Autonomic nervous system at optimal resting state',
    icon: '🧘',
    pct: Math.min(99, Math.round((1 - prob) * 100)),
    breathDuration: 3200,
  };
};

/* ────────────────────────────────────────────────────────
   DAILY TIP BANNER
   ──────────────────────────────────────────────────────── */
const DailyTipBanner = ({ theme }) => {
  const [tipIdx, setTipIdx] = useState(Math.floor(Math.random() * DAILY_TIPS.length));
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
      setTipIdx(p => (p + 1) % DAILY_TIPS.length);
    }, 9000);
    return () => clearInterval(t);
  }, []);

  const tip = DAILY_TIPS[tipIdx];
  return (
    <Animated.View style={[s.tipBanner, { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: fadeAnim }]}>
      <Text style={s.tipIcon}>{tip.icon}</Text>
      <Text style={[s.tipTxt, { color: theme.textSecondary }]}>
        <Text style={{ color: theme.accent, fontWeight: '800' }}>Daily Tip  </Text>
        {tip.tip}
      </Text>
    </Animated.View>
  );
};

/* ────────────────────────────────────────────────────────
   ACTION CARD (with press spring)
   ──────────────────────────────────────────────────────── */
const ActionCard = ({ item, theme, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.94, tension: 300, friction: 10, useNativeDriver: true }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }).start();

  return (
    <TouchableOpacity
      style={[
        s.actionCard,
        {
          backgroundColor: theme.bgSecondary,
          borderColor: theme.border,
          borderTopColor: item.accent,
          borderTopWidth: 2,
        }
      ]}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      activeOpacity={0.9}
    >
      <Animated.View style={{ alignItems: 'center', transform: [{ scale: scaleAnim }] }}>
        <View style={[s.actionIconWrap, { backgroundColor: item.tint }]}>
          <Text style={s.actionIcon}>{item.icon}</Text>
        </View>
        <Text style={[s.actionLabel, { color: theme.textPrimary }]} numberOfLines={1}>{item.label}</Text>
        <View style={[s.subBadgePill, { backgroundColor: `${item.accent}1F` }]}>
          <Text style={[s.actionSub, { color: item.accent }]}>{item.sub}</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

/* ════════════════════════════════════════════════════════
   MAIN DASHBOARD SCREEN
   ════════════════════════════════════════════════════════ */
export const DashboardScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    userId, username, setCurrentScreen,
    stressState, stressProbability,
    simMode, updateSimMode,
    isSafetyOverride, isAlertTriggered, telemetryMessage,
    isCalibrated, hasLivePacket,
    setCurrentRecommendation, setPreInterventionLabel,
    onboardingRecommendation, hasShownOnboardingAlert, setHasShownOnboardingAlert
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Entrance animations
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(40)).current;
  const ctaScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(slideUp, { toValue: 0, tension: 40, friction: 7, useNativeDriver: true })
    ]).start();

    // Subtle CTA breathing
    Animated.loop(
      Animated.sequence([
        Animated.timing(ctaScale, { toValue: 1.015, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(ctaScale, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ])
    ).start();
  }, []);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Onboarding recommendation alert
  useEffect(() => {
    if (onboardingRecommendation && !hasShownOnboardingAlert) {
      setHasShownOnboardingAlert(true);
      showAlert({
        title: '🎯 Personal Relaxation Plan Ready!',
        text: `Welcome ${username}!\n\nBased on your answers:\n\n• Recommended Technique: ${onboardingRecommendation.title}\n• Why It Helps: ${onboardingRecommendation.reason}`,
        icon: 'success',
        confirmButtonText: 'Explore Dashboard →'
      });
    }
  }, [onboardingRecommendation, hasShownOnboardingAlert]);

  const triggerIntervention = async () => {
    setLoading(true);
    try {
      setPreInterventionLabel(stressState);
      const recommendation = await apiService.getIntervention(userId, {
        user_id: userId,
        timestamp: Date.now() / 1000,
        fused_stress_label: stressState,
        stress_probability: stressProbability,
        seconds_since_last_packet: 0.0
      });
      setCurrentRecommendation(recommendation);
      showAlert({
        title: 'Intervention Selected! 🎯',
        text: `Based on your live signals (${stressState.toUpperCase()}), Calm AI selected: ${recommendation.title}.`,
        icon: 'info',
        confirmButtonText: 'Start Session ▶️',
        onConfirm: () => setCurrentScreen('Intervention')
      });
    } catch (e) {
      console.warn('Intervention error', e);
      showAlert({
        title: 'Connection Warning',
        text: 'Unable to reach backend. Loading local flow games...',
        icon: 'warning',
        onConfirm: () => setCurrentScreen('Intervention')
      });
    } finally {
      setLoading(false);
    }
  };

  const sc = getStateConfig(stressState, stressProbability, theme, isCalibrated, hasLivePacket);
  const greeting = currentTime.getHours() < 12 ? 'Good Morning' : currentTime.getHours() < 18 ? 'Good Afternoon' : 'Good Evening';
  const timeStr = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Breathing ring behind stress card
  const breathRing1 = useRef(new Animated.Value(1)).current;
  const breathRing1O = useRef(new Animated.Value(0.4)).current;
  const breathRing2 = useRef(new Animated.Value(1)).current;
  const breathRing2O = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const dur = sc.breathDuration;
    const runRing = (scaleAnim, opacityAnim, delay, maxScale) => {
      setTimeout(() => {
        Animated.loop(
          Animated.sequence([
            Animated.parallel([
              Animated.timing(scaleAnim, { toValue: maxScale, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
              Animated.timing(opacityAnim, { toValue: 0, duration: dur, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(scaleAnim, { toValue: 1, duration: 0, useNativeDriver: true }),
              Animated.timing(opacityAnim, { toValue: 0.3, duration: 0, useNativeDriver: true }),
            ]),
          ])
        ).start();
      }, delay);
    };
    runRing(breathRing1, breathRing1O, 0, 1.35);
    runRing(breathRing2, breathRing2O, dur / 2, 1.35);
  }, [stressState]);

  return (
    <View style={[s.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Home" />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeIn, transform: [{ translateY: slideUp }] }}>

          {/* ═══════════ 1. LIVE QUOTES BANNER (TOP) ═══════════ */}
          <LiveQuotesBanner theme={theme} />

          {/* ═══════════ 2. WELCOME + STATUS ROW ═══════════ */}
          <View style={[s.welcomeRow, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={s.welcomeLeft}>
              <Text style={[s.greetingTxt, { color: theme.textMuted }]}>{greeting}</Text>
              <Text style={[s.nameTxt, { color: theme.textPrimary }]}>{username}</Text>
              <View style={s.liveChip}>
                <PulseDot color={sc.color} />
                <Text style={[s.liveChipTxt, { color: sc.color }]}>{isCalibrated ? (hasLivePacket ? 'System Active' : 'Awaiting Telemetry Stream') : 'Waiting for Calibration'}</Text>
              </View>
            </View>
            <View style={s.welcomeRight}>
              <Text style={[s.clockTxt, { color: theme.accent }]}>{timeStr}</Text>
              <View style={[s.idPill, { backgroundColor: theme.bgPrimary, borderColor: theme.border }]}>
                <Text style={[s.idPillTxt, { color: theme.textMuted }]}>🔐 {userId}</Text>
              </View>
            </View>
          </View>

          {/* ═══════════ 3. STRESS STATE HERO ═══════════ */}
          <View style={[s.stateHero, { borderColor: sc.color, backgroundColor: sc.bgTint }]}>
            {/* Breathing ring layer */}
            <View style={s.breathRingWrap} pointerEvents="none">
              <Animated.View style={[s.breathRingBase, { borderColor: sc.color, transform: [{ scale: breathRing1 }], opacity: breathRing1O }]} />
              <Animated.View style={[s.breathRingBase, { borderColor: sc.color, transform: [{ scale: breathRing2 }], opacity: breathRing2O }]} />
            </View>
            {/* Top row: state badge + metrics */}
            <View style={s.stateHeroTop}>
              <View style={s.stateLeft}>
                <View style={[s.stateIconCircle, { backgroundColor: sc.color + '20' }]}>
                  <Text style={s.stateEmoji}>{sc.icon}</Text>
                </View>
                <View>
                  <View style={[s.statePill, { backgroundColor: sc.color }]}>
                    <Text style={s.statePillTxt}>{sc.emoji} {sc.label}</Text>
                  </View>
                  <Text style={[s.stateTagline, { color: theme.textSecondary }]}>{sc.tagline}</Text>
                </View>
              </View>
            </View>

            {/* Metrics bar */}
            <View style={[s.metricsRow, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <View style={s.metricCol}>
                <Text style={[s.metricValue, { color: theme.textPrimary }]}>{(isCalibrated && hasLivePacket) ? `${(stressProbability * 100).toFixed(0)}%` : '--'}</Text>
                <Text style={[s.metricLabel, { color: theme.textMuted }]}>Stress Level</Text>
              </View>
              <View style={[s.metricDivider, { backgroundColor: theme.border }]} />
              <View style={s.metricCol}>
                <Text style={[s.metricValue, { color: sc.color }]}>{(isCalibrated && hasLivePacket) ? stressState.toUpperCase() : (isCalibrated ? 'AWAITING...' : 'CALIBRATING')}</Text>
                <Text style={[s.metricLabel, { color: theme.textMuted }]}>Current State</Text>
              </View>
              <View style={[s.metricDivider, { backgroundColor: theme.border }]} />
              <View style={s.metricCol}>
                <Text style={[s.metricValue, { color: theme.accent }]}>{(isCalibrated && hasLivePacket) ? (typeof sc.pct === 'number' ? `${sc.pct}%` : sc.pct) : 'WAITING...'}</Text>
                <Text style={[s.metricLabel, { color: theme.textMuted }]}>Confidence</Text>
              </View>
            </View>

            {/* Progress bar: Stress → Normal */}
            <View style={s.progressSection}>
              <View style={s.progressLabels}>
                <Text style={[s.progressLbl, { color: theme.textMuted }]}>Stress</Text>
                <Text style={[s.progressLbl, { color: theme.textMuted }]}>Recovery Target →</Text>
                <Text style={[s.progressLbl, { color: theme.textMuted }]}>Normal ✓</Text>
              </View>
              <View style={[s.progressBg, { backgroundColor: theme.border }]}>
                <Animated.View style={[s.progressFill, {
                  backgroundColor: sc.color,
                  width: stressState === 'normal' ? '100%' : '18%'
                }]} />
              </View>
            </View>

            {isSafetyOverride && (
              <View style={[s.overrideBar, { borderColor: theme.danger }]}>
                <Text style={[s.overrideTxt, { color: theme.danger }]}>🚨 HIGH STRESS ALERT — Instant relaxation recommended</Text>
              </View>
            )}
          </View>

          {/* ═══════════ CALIBRATION STATUS BANNER ═══════════ */}
          {!isCalibrated && (
            <View style={[s.calibrationCard, { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: '#F59E0B' }]}>
              <View style={s.calibrationHeader}>
                <ActivityIndicator size="small" color="#F59E0B" />
                <Text style={[s.calibrationTitle, { color: '#F59E0B' }]}>⏳ Waiting for Baseline Calibration...</Text>
              </View>
              <Text style={[s.calibrationBody, { color: theme.textSecondary }]}>
                The 2-minute baseline calibration is currently active. Real-time stress detection and adaptive relaxation recommendations will initialize automatically once baseline calibration completes.
              </Text>
            </View>
          )}

          {/* ═══════════ 4. QUICK ACTION GRID ═══════════ */}
          <Text style={[s.sectionTitle, { color: theme.textPrimary }]}>Quick Actions</Text>
          <View style={s.actionGrid}>
            {[
              { id: 'Intervention', icon: '🧘', label: 'Techniques', sub: '25 Games', tint: 'rgba(56,189,248,0.14)', accent: '#38BDF8' },
              { id: 'History', icon: '📈', label: 'History', sub: 'Recovery', tint: 'rgba(16,185,129,0.14)', accent: '#10B981' },
              { id: 'UserProfile', icon: '👤', label: 'Profile', sub: 'Account', tint: 'rgba(245,158,11,0.14)', accent: '#F59E0B' }
            ].map(item => (
              <ActionCard key={item.id} item={item} theme={theme} onPress={() => setCurrentScreen(item.id)} />
            ))}
          </View>

          {/* ═══════════ 4b. DAILY TIP ═══════════ */}
          <DailyTipBanner theme={theme} />

          {/* ═══════════ 7. LAUNCH CTA ═══════════ */}
          <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
            <TouchableOpacity
              style={[s.ctaBtn, { backgroundColor: theme.accent }, loading && { opacity: 0.5 }]}
              onPress={triggerIntervention}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={theme.accentText} size="small" />
              ) : (
                <View style={s.ctaInner}>
                  <Text style={[s.ctaMain, { color: theme.accentText }]}>🚀  Start Relaxation Session</Text>
                  <Text style={[s.ctaSub, { color: theme.accentText }]}>Smart AI selects the best exercise for your stress level</Text>
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>

          <View style={{ height: 24 }} />
        </Animated.View>
      </ScrollView>
    </View>
  );
};

/* ════════════════════════════════════════════════════════
   STYLES
   ════════════════════════════════════════════════════════ */
const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32 },

  /* ── Live Quotes Banner ── */
  quoteCard: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden'
  },
  quoteAccentLine: {
    height: 3,
    width: '100%'
  },
  quoteInner: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    alignItems: 'center'
  },
  quoteIcon: {
    fontSize: 28,
    marginBottom: 10
  },
  quoteText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
    fontStyle: 'italic',
    letterSpacing: 0.2
  },
  quoteAuthor: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 10,
    letterSpacing: 0.3
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    paddingBottom: 14,
    paddingTop: 6
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5
  },

  /* ── Welcome Row ── */
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14
  },
  welcomeLeft: { flex: 1 },
  greetingTxt: { fontSize: 12, fontWeight: '600' },
  nameTxt: { fontSize: 22, fontWeight: '900', marginTop: 2, letterSpacing: -0.3 },
  liveChip: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  liveChipTxt: { fontSize: 11, fontWeight: '700' },
  welcomeRight: { alignItems: 'flex-end' },
  clockTxt: { fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  idPill: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1
  },
  idPillTxt: { fontSize: 9, fontWeight: '600' },

  /* ── Pulse Dot ── */
  pulseDotWrap: {
    width: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 6
  },
  pulseRing: {
    position: 'absolute',
    width: 14, height: 14, borderRadius: 7
  },
  pulseDotCore: {
    width: 8, height: 8, borderRadius: 4
  },

  /* ── Stress State Hero ── */
  stateHero: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 16
  },
  stateHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12
  },
  stateLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  stateIconCircle: {
    width: 48, height: 48, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12
  },
  stateEmoji: { fontSize: 24 },
  statePill: {
    paddingVertical: 4,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignSelf: 'flex-start'
  },
  statePillTxt: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.6
  },
  stateTagline: {
    fontSize: 11,
    marginTop: 4,
    lineHeight: 16,
    maxWidth: SCREEN_W * 0.55
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12
  },
  metricCol: { alignItems: 'center', flex: 1 },
  metricValue: { fontSize: 16, fontWeight: '900' },
  metricLabel: { fontSize: 9, fontWeight: '600', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  metricDivider: { width: 1, height: 30 },

  progressSection: { marginTop: 2 },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6
  },
  progressLbl: { fontSize: 9, fontWeight: '600' },
  progressBg: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: 4
  },

  overrideBar: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(239,68,68,0.06)'
  },
  overrideTxt: { fontSize: 10, fontWeight: '800', textAlign: 'center' },

  /* ── Section Title ── */
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: 0.2
  },

  /* ── Quick Actions ── */
  actionGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  actionCard: {
    width: '31.5%',
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3
  },
  actionIconWrap: {
    width: 44, height: 44,
    borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8
  },
  actionIcon: { fontSize: 22 },
  actionLabel: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  subBadgePill: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10
  },
  actionSub: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  /* ── Daily Tip ── */
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 4,
  },
  tipIcon: { fontSize: 22 },
  tipTxt: { flex: 1, fontSize: 12, lineHeight: 18 },

  /* ── Breathing ring ── */
  breathRingWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  breathRingBase: {
    position: 'absolute',
    width: '80%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
  },

  /* ── CTA Button ── */
  ctaBtn: {
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: 'center',
    marginTop: 8,
    elevation: 5,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14
  },
  ctaInner: { alignItems: 'center' },
  ctaMain: { fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
  ctaSub: { fontSize: 11, opacity: 0.85, marginTop: 2, fontWeight: '600' },

  /* ── Calibration Banner ── */
  calibrationCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 16,
  },
  calibrationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  calibrationTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  calibrationBody: {
    fontSize: 13,
    lineHeight: 18,
  }
});
