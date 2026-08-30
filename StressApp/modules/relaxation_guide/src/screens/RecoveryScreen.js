import React, { useState, useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, ScrollView } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { AchievementModal } from '../components/AchievementModal';

/* Circular animated gauge that fills from 0 to pct */
const RecoveryGauge = ({ pct, color, theme }) => {
  const fillAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fillAnim, { toValue: pct / 100, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1.06, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [pct]);

  const displayPct = fillAnim.interpolate({ inputRange: [0, 1], outputRange: [0, pct] });
  const trackColor = pct >= 95 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';

  return (
    <View style={[gStyles.gaugeWrap, { backgroundColor: trackColor + '12', borderColor: trackColor }]}>
      <Animated.View style={[gStyles.gaugeInner, { transform: [{ scale: glowAnim }] }]}>
        <Text style={gStyles.gaugeEmoji}>{pct >= 95 ? '🎉' : pct >= 50 ? '🔄' : '⚠️'}</Text>
        <Animated.Text style={[gStyles.gaugePct, { color: trackColor }]}>
          {pct.toFixed(0)}%
        </Animated.Text>
        <Text style={[gStyles.gaugeLabel, { color: theme.textMuted }]}>Recovery</Text>
      </Animated.View>

      {/* Progress arc bar (simulated with height) */}
      <View style={[gStyles.arcTrack, { backgroundColor: theme.border }]}>
        <Animated.View style={[gStyles.arcFill, {
          backgroundColor: trackColor,
          width: fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
        }]} />
      </View>
    </View>
  );
};

const gStyles = StyleSheet.create({
  gaugeWrap: {
    width: '100%', borderRadius: 24, borderWidth: 1.5,
    alignItems: 'center', padding: 24, gap: 10,
    shadowColor: '#10B981', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 8,
  },
  gaugeInner: { alignItems: 'center' },
  gaugeEmoji: { fontSize: 40, marginBottom: 4 },
  gaugePct: { fontSize: 48, fontWeight: '900', letterSpacing: -1 },
  gaugeLabel: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  arcTrack: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden' },
  arcFill: { height: '100%', borderRadius: 4 },
});

/* Particle burst for celebration */
const Particles = ({ active, color }) => {
  const particles = Array.from({ length: 12 }, (_, i) => ({
    anim: useRef(new Animated.Value(0)).current,
    angle: (i / 12) * 2 * Math.PI,
  }));

  useEffect(() => {
    if (!active) return;
    particles.forEach((p, i) => {
      setTimeout(() => {
        Animated.sequence([
          Animated.timing(p.anim, { toValue: 1, duration: 600 + i * 40, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(p.anim, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]).start();
      }, i * 50);
    });
  }, [active]);

  if (!active) return null;

  return (
    <View style={pStyles.wrap} pointerEvents="none">
      {particles.map((p, i) => {
        const tx = Math.cos(p.angle) * 80;
        const ty = Math.sin(p.angle) * 80;
        return (
          <Animated.View
            key={i}
            style={[pStyles.particle, {
              backgroundColor: i % 3 === 0 ? color : i % 3 === 1 ? '#F59E0B' : '#10B981',
              opacity: p.anim,
              transform: [
                { translateX: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, tx] }) },
                { translateY: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, ty] }) },
                { scale: p.anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1, 0.2] }) },
              ],
            }]}
          />
        );
      })}
    </View>
  );
};

const pStyles = StyleSheet.create({
  wrap: {
    position: 'absolute', top: '35%', left: '50%',
    width: 1, height: 1, alignItems: 'center', justifyContent: 'center',
  },
  particle: {
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
  },
});

export const RecoveryScreen = () => {
  const {
    lastValidationResult, preInterventionLabel, postInterventionLabel,
    setCurrentRecommendation, setSelectedSubOption, setCurrentScreen
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const postNorm    = (postInterventionLabel || '').toLowerCase();
  const preNorm     = (preInterventionLabel || '').toLowerCase();
  const isNormal    = lastValidationResult?.is_normal_reached ?? lastValidationResult?.is_normal ?? (postNorm === 'normal');
  const recoveryPct = isNormal ? 100.0 : (lastValidationResult?.recovery_percentage ?? 45.0);
  const transition  = isNormal ? '🎉 Baseline Achieved! (Normal Equilibrium Restored)' : (lastValidationResult?.transition ?? 'Partial Recovery');
  const displayPre  = (preNorm === 'stress' || preNorm === 'high_stress' || preNorm === 'pre-stress') ? 'STRESS' : 'NORMAL';
  const displayPost = (isNormal || postNorm === 'normal') ? 'NORMAL' : 'STRESS';
  const preColor    = displayPre === 'STRESS' ? theme.danger : theme.success;
  const postColor   = displayPost === 'NORMAL' ? theme.success : theme.danger;
  const altRec     = lastValidationResult?.alternative_recommendation;

  const reward = lastValidationResult?.reward ?? (isNormal ? 1.0 : 0.2);
  const alpha  = lastValidationResult?.alpha ?? (isNormal ? 2.0 : 1.0);
  const beta   = lastValidationResult?.beta ?? (isNormal ? 1.0 : 2.0);

  const handleStartAlt = () => {
    if (altRec) {
      setCurrentRecommendation(altRec);
      if (altRec.selected_sub_option) {
        setSelectedSubOption(altRec.selected_sub_option);
      }
      setCurrentScreen('GamePlayer');
    } else {
      setCurrentScreen('Methods');
    }
  };

  const [showCelebration, setShowCelebration] = useState(isNormal);
  const [showParticles, setShowParticles] = useState(isNormal);

  // Staggered card entrances
  const gaugeOpacity = useRef(new Animated.Value(0)).current;
  const gaugeSlide   = useRef(new Animated.Value(30)).current;
  const detailOpacity = useRef(new Animated.Value(0)).current;
  const detailSlide   = useRef(new Animated.Value(20)).current;
  const btnOpacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(200, [
      Animated.parallel([
        Animated.timing(gaugeOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(gaugeSlide, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(detailOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(detailSlide, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
      ]),
      Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    // Auto-dismiss particles
    if (isNormal) {
      setTimeout(() => setShowParticles(false), 3000);
    }
  }, []);

  const rewardColor = reward >= 0.7 ? theme.success : reward >= 0.3 ? theme.warning : theme.danger;

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Recovery Analytics" />
      <AchievementModal
        visible={showCelebration}
        onClose={() => setShowCelebration(false)}
        xpEarned={lastValidationResult?.xp_earned || 100}
        badges={lastValidationResult?.unlocked_badges || []}
      />

      {/* Celebration particles */}
      <Particles active={showParticles} color={theme.accent} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Recovery Gauge */}
        <Animated.View style={{ opacity: gaugeOpacity, transform: [{ translateY: gaugeSlide }], width: '100%' }}>
          <RecoveryGauge pct={recoveryPct} color={theme.accent} theme={theme} />
          <Text style={[styles.transitionTxt, { color: theme.textSecondary }]}>{transition}</Text>
        </Animated.View>

        {/* Metrics card */}
        <Animated.View style={[styles.detailsCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: detailOpacity, transform: [{ translateY: detailSlide }] }]}>
          <Text style={[styles.cardHeader, { color: theme.accent }]}>Closed-Loop Feedback Results</Text>

          {[
            { label: 'Pre-Intervention State', value: displayPre, color: preColor },
            { label: 'Post-Intervention State', value: displayPost, color: postColor },
            { label: 'Validator Reward Signal', value: `+${reward.toFixed(2)}`, color: rewardColor },
          ].map((row, i) => (
            <View key={i} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border + '60', paddingTop: 8, marginTop: 4 }]}>
              <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>{row.label}</Text>
              <Text style={[styles.rowVal, { color: row.color }]}>{row.value}</Text>
            </View>
          ))}

          {/* Bandit update */}
          <View style={[styles.banditRow, { backgroundColor: theme.bgPrimary, borderColor: theme.border }]}>
            <View style={styles.banditCol}>
              <Text style={[styles.banditLabel, { color: theme.textMuted }]}>Alpha (Success)</Text>
              <Text style={[styles.banditVal, { color: theme.textPrimary }]}>{alpha.toFixed(2)}</Text>
            </View>
            <View style={[styles.banditDivider, { backgroundColor: theme.border }]} />
            <View style={styles.banditCol}>
              <Text style={[styles.banditLabel, { color: theme.textMuted }]}>Beta (Failure)</Text>
              <Text style={[styles.banditVal, { color: theme.textPrimary }]}>{beta.toFixed(2)}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Guidance based on baseline status */}
        {isNormal ? (
          <View style={[styles.guidanceCard, { backgroundColor: theme.success + '14', borderColor: theme.success }]}>
            <Text style={[styles.guidanceTitle, { color: theme.success }]}>🎯 Closed-Loop Adaptive Guidance — Baseline Achieved!</Text>
            <Text style={[styles.guidanceText, { color: theme.textSecondary }]}>
              {lastValidationResult?.closed_loop_status?.guidance_message ||
                "🎉 Baseline Achieved! Real-time bio-feedback verified your live stress probability returned to optimal resting equilibrium."}
            </Text>
          </View>
        ) : (
          <View style={[styles.guidanceCard, { backgroundColor: theme.warning + '12', borderColor: theme.warning }]}>
            <Text style={[styles.guidanceTitle, { color: theme.warning }]}>⚡ Closed-Loop Adaptive Guidance</Text>
            <Text style={[styles.guidanceText, { color: theme.textSecondary }]}>
              {altRec?.reason ||
                lastValidationResult?.closed_loop_status?.guidance_message ||
                "Baseline not yet reached. Smart AI selected an alternative technique for your recovery."}
            </Text>
            <TouchableOpacity
              style={[styles.guidanceBtn, { backgroundColor: theme.warning }]}
              onPress={handleStartAlt}
              activeOpacity={0.85}
            >
              <Text style={[styles.guidanceBtnTxt, { color: '#0F172A' }]}>
                {altRec?.title
                  ? `⚡ Start ${altRec.title} Now  →`
                  : lastValidationResult?.closed_loop_status?.next_recommended_technique_name
                  ? `⚡ Start ${lastValidationResult.closed_loop_status.next_recommended_technique_name} Now  →`
                  : 'Try Another Technique  →'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Return to Dashboard */}
        <Animated.View style={{ opacity: btnOpacity, width: '100%' }}>
          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: theme.accent }]}
            onPress={() => setCurrentScreen('Dashboard')}
            activeOpacity={0.85}
          >
            <Text style={[styles.doneBtnTxt, { color: theme.accentText }]}>Return to Dashboard  →</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 20, gap: 16, paddingBottom: 40 },
  transitionTxt: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  detailsCard: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 2 },
  cardHeader: { fontSize: 13, fontWeight: '800', marginBottom: 8, letterSpacing: 0.3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { fontSize: 12, flex: 1 },
  rowVal: { fontWeight: '800', fontSize: 13 },
  banditRow: {
    flexDirection: 'row', borderRadius: 14, borderWidth: 1,
    marginTop: 10, overflow: 'hidden',
  },
  banditCol: { flex: 1, padding: 10, alignItems: 'center' },
  banditDivider: { width: 1 },
  banditLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  banditVal: { fontSize: 18, fontWeight: '900', marginTop: 2 },
  guidanceCard: { padding: 14, borderRadius: 18, borderWidth: 1, gap: 8 },
  guidanceTitle: { fontSize: 13, fontWeight: '800' },
  guidanceText: { fontSize: 12, lineHeight: 18 },
  guidanceBtn: { paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  guidanceBtnTxt: { fontWeight: '800', fontSize: 13 },
  doneBtn: {
    paddingVertical: 16, borderRadius: 18, alignItems: 'center',
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 6,
  },
  doneBtnTxt: { fontWeight: '800', fontSize: 15 },
});
