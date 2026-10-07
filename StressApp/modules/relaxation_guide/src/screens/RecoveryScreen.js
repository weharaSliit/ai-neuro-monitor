import React, { useState, useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { AchievementModal } from '../components/AchievementModal';
import { AmbientBackground } from '../components/AmbientBackground';

/* Circular animated gauge that fills from 0 to pct */
const RecoveryGauge = ({ pct, theme }) => {
  const fillAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fillAnim, { toValue: pct / 100, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1.05, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [pct]);

  const trackColor = pct >= 95 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';

  return (
    <View style={[gStyles.gaugeWrap, { backgroundColor: 'rgba(15, 23, 42, 0.65)', borderColor: trackColor + '40' }]}>
      <Animated.View style={[gStyles.gaugeInner, { transform: [{ scale: glowAnim }] }]}>
        <Text style={gStyles.gaugeEmoji}>{pct >= 95 ? '🏆' : pct >= 50 ? '🌟' : '💪'}</Text>
        <Animated.Text style={[gStyles.gaugePct, { color: trackColor }]}>
          {pct.toFixed(0)}%
        </Animated.Text>
        <Text style={[gStyles.gaugeLabel, { color: '#CBD5E1' }]}>Calm Meter</Text>
      </Animated.View>

      <View style={[gStyles.arcTrack, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
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
    width: '100%',
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    padding: 24,
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  gaugeInner: { alignItems: 'center' },
  gaugeEmoji: { fontSize: 44, marginBottom: 4 },
  gaugePct: { fontSize: 52, fontWeight: '900', letterSpacing: -1 },
  gaugeLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2 },
  arcTrack: { width: '100%', height: 10, borderRadius: 5, overflow: 'hidden' },
  arcFill: { height: '100%', borderRadius: 5 },
});

export const RecoveryScreen = () => {
  const {
    lastValidationResult, preInterventionLabel, postInterventionLabel,
    setCurrentRecommendation, setSelectedSubOption, setCurrentScreen
  } = useContext(AppContext);
  const { theme, isDarkMode } = useContext(ThemeContext);

  const postNorm    = (postInterventionLabel || '').toLowerCase();
  const isNormal    = lastValidationResult?.is_normal_reached ?? lastValidationResult?.is_normal ?? (postNorm === 'normal');
  const recoveryPct = isNormal ? 100.0 : (lastValidationResult?.recovery_percentage ?? 80.0);
  const altRec     = lastValidationResult?.alternative_recommendation;
  const isDark     = isDarkMode ?? true;

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <AmbientBackground />
      <Header title="Session Recovery Summary" />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <RecoveryGauge pct={recoveryPct} theme={theme} />

        {/* Results Card */}
        <View style={[styles.detailsCard, { backgroundColor: isDark ? 'rgba(30, 41, 59, 0.75)' : 'rgba(255, 255, 255, 0.9)', borderColor: theme.border }]}>
          <Text style={[styles.cardHeader, { color: '#F59E0B' }]}>⭐ Level Session Summary</Text>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Starting State</Text>
            <View style={[styles.valPill, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Text style={[styles.rowVal, { color: '#EF4444' }]}>{preInterventionLabel?.toUpperCase() || 'STRESS'}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Final State</Text>
            <View style={[styles.valPill, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Text style={[styles.rowVal, { color: '#10B981' }]}>RELAXED & CALM</Text>
            </View>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Reward XP Earned</Text>
            <View style={[styles.valPill, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Text style={[styles.rowVal, { color: '#F59E0B' }]}>+200 XP</Text>
            </View>
          </View>
        </View>

        {/* Action Button */}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => setCurrentScreen('Dashboard')}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={['#10B981', '#059669']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.btnGradient}
          >
            <Text style={styles.doneBtnTxt}>Back to Dashboard ▶</Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 20, gap: 18, paddingBottom: 80 },
  detailsCard: { padding: 20, borderRadius: 26, borderWidth: 1, gap: 14, elevation: 4 },
  cardHeader: { fontSize: 16, fontWeight: '900', marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: 13, flex: 1, fontWeight: '700' },
  valPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  rowVal: { fontWeight: '900', fontSize: 13 },
  doneBtn: {
    borderRadius: 22,
    elevation: 8,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  btnGradient: {
    paddingVertical: 16,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  doneBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
});

export default RecoveryScreen;
