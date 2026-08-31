import React, { useState, useContext, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Animated, Easing, Dimensions, Modal
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
const getStateConfig = (stressState, stressProbability, rawLabel, theme, isCalibrated = true, hasLivePacket = true) => {
  if (hasLivePacket === false) {
    return {
      color: theme.warning,
      bgTint: 'rgba(245,158,11,0.14)',
      label: 'WAITING FOR LIVE STREAM',
      displayLabel: 'Awaiting Telemetry',
      rawLabel: 'Awaiting Live Stream',
      tagline: 'Awaiting device stream',
      emoji: '📡',
      icon: '📡',
      pct: '--',
      breathDuration: 2000,
    };
  }

  const normState = (stressState || '').toLowerCase();
  const rawLower = (rawLabel || '').toLowerCase();
  const prob = typeof stressProbability === 'number' ? stressProbability : 0.15;
  const pctVal = Math.min(99, Math.round(prob * 100));

  const isHighStress = normState.includes('high') || rawLower.includes('high confidence stress') || rawLower.includes('high stress');
  const isLowStress = normState.includes('low') || rawLower.includes('low confidence stress') || rawLower.includes('low stress');
  const isGenericStress = normState === 'stress' || normState === 'acute' || normState === 'pre-stress' || normState === 'pre_stress' || prob >= 0.50;

  if (isHighStress || (isGenericStress && !isLowStress && prob >= 0.60)) {
    return {
      color: theme.danger,
      bgTint: 'rgba(239,68,68,0.14)',
      label: 'HIGH STRESS',
      displayLabel: 'High Stress',
      rawLabel: rawLabel || 'High Confidence Stress',
      emoji: '🔴',
      tagline: 'High stress detected',
      icon: '🫀',
      pct: pctVal,
      breathDuration: 1200,
    };
  } else if (isLowStress) {
    return {
      color: '#F59E0B',
      bgTint: 'rgba(245,158,11,0.14)',
      label: 'LOW STRESS',
      displayLabel: 'Low Stress',
      rawLabel: rawLabel || 'Low Confidence Stress',
      emoji: '🟡',
      tagline: 'Mild stress detected',
      icon: '⚡',
      pct: pctVal,
      breathDuration: 2000,
    };
  } else if (isGenericStress) {
    return {
      color: theme.danger,
      bgTint: 'rgba(239,68,68,0.14)',
      label: 'STRESS',
      displayLabel: 'Stress State',
      rawLabel: rawLabel || 'Stress Detected',
      emoji: '🔴',
      tagline: 'Stress detected',
      icon: '🫀',
      pct: pctVal,
      breathDuration: 1400,
    };
  }

  return {
    color: theme.success,
    bgTint: 'rgba(16,185,129,0.14)',
    label: 'NORMAL',
    displayLabel: 'Normal / Calm',
    rawLabel: rawLabel || 'Normal State',
    emoji: '🟢',
    tagline: 'Optimal resting state',
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
    Animated.spring(scaleAnim, { toValue: 0.96, tension: 300, friction: 10, useNativeDriver: true }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }).start();

  return (
    <TouchableOpacity
      style={[
        s.actionCard,
        {
          backgroundColor: theme.bgSecondary,
          borderColor: theme.border,
        }
      ]}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      activeOpacity={0.9}
    >
      <Animated.View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, transform: [{ scale: scaleAnim }] }}>
        <View style={[s.actionIconWrap, { backgroundColor: item.tint }]}>
          <Text style={s.actionIcon}>{item.icon}</Text>
        </View>
        <Text style={[s.actionLabel, { color: theme.textPrimary }]} numberOfLines={1}>{item.label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

/* ════════════════════════════════════════════════════════
   MAIN DASHBOARD SCREEN
   ════════════════════════════════════════════════════════ */
export const DashboardScreen = () => {
  const navigation = useNavigation();
  const { showAlert } = useSweetAlert();

  const handleBackToMain = () => {
    try {
      if (navigation && navigation.canGoBack()) {
        navigation.goBack();
      } else if (navigation) {
        navigation.navigate('Home');
      }
    } catch (e) {
      try {
        navigation.navigate('Main');
      } catch (e2) {
        // Fallback
      }
    }
  };

  const {
    userId, username, setCurrentScreen,
    stressState, stressProbability, rawLabel, activeSessionId, confidence,
    simMode, updateSimMode,
    isSafetyOverride, isAlertTriggered, telemetryMessage,
    isCalibrated, hasLivePacket,
    currentRecommendation, setCurrentRecommendation, setPreInterventionLabel, setSelectedSubOption
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const u = (userId || '').toLowerCase();
  const isAdmin = u === 'ojani' || u.includes('ojani') || u === 'admin' || u.includes('admin');

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

  const [showInterventionModal, setShowInterventionModal] = useState(false);

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
      if (recommendation?.selected_sub_option) {
        setSelectedSubOption(recommendation.selected_sub_option);
      }
      setShowInterventionModal(true);
    } catch (e) {
      console.warn('Intervention error', e);
      setShowInterventionModal(true);
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchFromModal = () => {
    setShowInterventionModal(false);
    setCurrentScreen('GamePlayer');
  };

  const sc = getStateConfig(stressState, stressProbability, rawLabel, theme, isCalibrated, hasLivePacket);
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
      <Header
        title="Welcome to Relaxation Guide"
        showBack={true}
        onBack={handleBackToMain}
      />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeIn, transform: [{ translateY: slideUp }] }}>

          {/* ═══════════ 2. WELCOME + STATUS ROW ═══════════ */}
          <View style={[s.welcomeRow, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={s.welcomeLeft}>
              <Text style={[s.greetingTxt, { color: theme.textMuted }]}>{greeting}</Text>
              <Text style={[s.nameTxt, { color: theme.textPrimary }]}>{isAdmin ? 'Ojani (Admin)' : username}</Text>
              <View style={s.liveChip}>
                <PulseDot color={sc.color} />
                <Text style={[s.liveChipTxt, { color: sc.color }]}>{isCalibrated ? (hasLivePacket ? 'System Active' : 'Awaiting Live Stream') : 'Waiting for Calibration'}</Text>
              </View>
            </View>
            <View style={s.welcomeRight}>
              <Text style={[s.clockTxt, { color: theme.accent }]}>{timeStr}</Text>
              <View style={[s.idPill, { backgroundColor: theme.bgPrimary, borderColor: theme.border }]}>
                <Text style={[s.idPillTxt, { color: theme.textMuted }]}>{isAdmin ? '🛡️ Admin (Ojani)' : `🆔 ${userId}`}</Text>
              </View>
            </View>
          </View>

          {/* ═══════════ LIVE TELEMETRY STREAMS ═══════════ */}
          <Text style={[s.sectionTitle, { color: theme.textPrimary, marginBottom: 8 }]}>Live Telemetry Streams</Text>

          <View style={{ gap: 10, marginBottom: 16 }}>
            {/* 🫀 Physiological Stream */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: theme.bgSecondary,
              borderWidth: 1,
              borderColor: theme.border,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 20 }}>🫀</Text>
                <View>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.textPrimary }}>Physiological Stream</Text>
                  <Text style={{ fontSize: 11, color: theme.textMuted }}>Smart Ring + Earbud</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: sc.color }}>
                  Label: {hasLivePacket ? sc.displayLabel : 'Awaiting'}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: theme.accent }}>
                  Probability: {hasLivePacket ? (typeof sc.pct === 'number' ? `${sc.pct}%` : sc.pct) : '--'}
                </Text>
              </View>
            </View>

            {/* ⌨️ Phenotyping Stream */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: theme.bgSecondary,
              borderWidth: 1,
              borderColor: theme.border,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 20 }}>📱</Text>
                <View>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.textPrimary }}>Phenotyping Stream</Text>
                  <Text style={{ fontSize: 11, color: theme.textMuted }}>Behavioral & Smartphone</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: sc.color }}>
                  Label: {hasLivePacket ? sc.displayLabel : 'Awaiting'}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: theme.accent }}>
                  Probability: {hasLivePacket ? (typeof sc.pct === 'number' ? `${sc.pct}%` : sc.pct) : '--'}
                </Text>
              </View>
            </View>
          </View>



          {/* ═══════════ 4. QUICK ACTION GRID ═══════════ */}
          <Text style={[s.sectionTitle, { color: theme.textPrimary }]}>Quick Actions</Text>
          <View style={s.actionGrid}>
            {[
              { id: 'Methods', icon: '🧘', label: 'Techniques', sub: '10 Techniques', tint: 'rgba(56,189,248,0.14)', accent: '#38BDF8' },
              { id: 'PerformanceOverview', icon: '📊', label: 'Performance', sub: 'Analytics & Trends', tint: 'rgba(16,185,129,0.14)', accent: '#10B981' },
              { id: 'UserProfile', icon: '👤', label: 'User Profile', sub: 'Account & XP', tint: 'rgba(236,72,153,0.14)', accent: '#EC4899' },
              { id: 'CommonHome', icon: '🏠', label: 'Main Home', sub: 'Return to App', tint: 'rgba(59,130,246,0.14)', accent: '#3B82F6' },
              ...(isAdmin ? [
                { id: 'History', icon: '📈', label: 'History', sub: 'Recovery', tint: 'rgba(16,185,129,0.14)', accent: '#10B981' },
                { id: 'FusionPipeline', icon: '📡', label: 'Pipeline', sub: 'Telemetry', tint: 'rgba(139,92,246,0.14)', accent: '#8B5CF6' }
              ] : [])
            ].map(item => (
              <ActionCard
                key={item.id}
                item={item}
                theme={theme}
                onPress={() => {
                  if (item.id === 'CommonHome') {
                    handleBackToMain();
                  } else if (item.id === 'UserProfile') {
                    try {
                      navigation.navigate('Profile');
                    } catch (e) {
                      setCurrentScreen('UserProfile');
                    }
                  } else {
                    setCurrentScreen(item.id);
                  }
                }}
              />
            ))}
          </View>



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

      {/* ═══════════ INTERVENTION RECOMMENDATION POPUP MODAL ═══════════ */}
      <Modal
        visible={showInterventionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowInterventionModal(false)}
      >
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={s.modalHeaderRow}>
              <View style={[s.modalIconRing, { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: '#10B981' }]}>
                <Text style={{ fontSize: 32 }}>🪷</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.modalTitle, { color: theme.textPrimary }]}>
                  {currentRecommendation?.title || 'Lily Pond Breathing'}
                </Text>
                <Text style={[s.modalBadgeTxt, { color: '#10B981' }]}>
                  Recommended Relaxation Method
                </Text>
              </View>
            </View>

            <Text style={[s.modalDesc, { color: theme.textSecondary }]}>
              {currentRecommendation?.description || 'Extended exhale pacing synced with water lilies to quickly lower heart rate and reduce stress.'}
            </Text>

            {/* Popup Button to Launch Technique */}
            <TouchableOpacity
              style={[s.modalLaunchBtn, { backgroundColor: '#10B981' }]}
              onPress={handleLaunchFromModal}
              activeOpacity={0.85}
            >
              <Text style={s.modalLaunchBtnTxt}>▶️  Start Relaxation Technique</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.modalCloseBtn}
              onPress={() => setShowInterventionModal(false)}
            >
              <Text style={[s.modalCloseBtnTxt, { color: theme.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16
  },
  actionCard: {
    flex: 1,
    minWidth: '46%',
    maxWidth: '48.5%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 2
  },
  actionIconWrap: {
    width: 32, height: 32,
    borderRadius: 16,
    alignItems: 'center', justifyContent: 'center'
  },
  actionIcon: { fontSize: 16 },
  actionLabel: { fontSize: 12, fontWeight: '700' },

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
  },

  /* ── Intervention Modal Styles ── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    width: '100%',
    marginBottom: 14
  },
  modalIconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800'
  },
  modalBadgeTxt: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2
  },
  modalDesc: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20
  },
  modalLaunchBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10
  },
  modalLaunchBtnTxt: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  modalCloseBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16
  },
  modalCloseBtnTxt: {
    fontSize: 13,
    fontWeight: '600'
  }
});
