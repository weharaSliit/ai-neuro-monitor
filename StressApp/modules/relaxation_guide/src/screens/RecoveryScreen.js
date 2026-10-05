import React, { useState, useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, ScrollView } from 'react-native';
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
        Animated.timing(glowAnim, { toValue: 1.06, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [pct]);

  const trackColor = pct >= 95 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';

  return (
    <View style={[gStyles.gaugeWrap, { backgroundColor: trackColor + '12', borderColor: trackColor }]}>
      <Animated.View style={[gStyles.gaugeInner, { transform: [{ scale: glowAnim }] }]}>
        <Text style={gStyles.gaugeEmoji}>{pct >= 95 ? '🏆' : pct >= 50 ? '🌟' : '💪'}</Text>
        <Animated.Text style={[gStyles.gaugePct, { color: trackColor }]}>
          {pct.toFixed(0)}%
        </Animated.Text>
        <Text style={[gStyles.gaugeLabel, { color: theme.textMuted }]}>Calm Meter</Text>
      </Animated.View>

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
    width: '100%', borderRadius: 24, borderWidth: 2,
    alignItems: 'center', padding: 24, gap: 10,
    elevation: 6,
  },
  gaugeInner: { alignItems: 'center' },
  gaugeEmoji: { fontSize: 44, marginBottom: 4 },
  gaugePct: { fontSize: 48, fontWeight: '900', letterSpacing: -1 },
  gaugeLabel: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  arcTrack: { width: '100%', height: 10, borderRadius: 5, overflow: 'hidden' },
  arcFill: { height: '100%', borderRadius: 5 },
});

export const RecoveryScreen = () => {
  const {
    lastValidationResult, preInterventionLabel, postInterventionLabel,
    setCurrentRecommendation, setSelectedSubOption, setCurrentScreen
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const postNorm    = (postInterventionLabel || '').toLowerCase();
  const isNormal    = lastValidationResult?.is_normal_reached ?? lastValidationResult?.is_normal ?? (postNorm === 'normal');
  const recoveryPct = isNormal ? 100.0 : (lastValidationResult?.recovery_percentage ?? 80.0);
  const altRec     = lastValidationResult?.alternative_recommendation;

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

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <AmbientBackground />
      <Header title="Level Summary" />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <RecoveryGauge pct={recoveryPct} theme={theme} />

        {/* Results Card */}
        <View style={[styles.detailsCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <Text style={[styles.cardHeader, { color: '#F59E0B' }]}>⭐ Level Session Summary</Text>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Starting State</Text>
            <Text style={[styles.rowVal, { color: '#EF4444' }]}>{preInterventionLabel?.toUpperCase() || 'STRESS'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Final State</Text>
            <Text style={[styles.rowVal, { color: '#10B981' }]}>RELAXED & CALM</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Reward XP Earned</Text>
            <Text style={[styles.rowVal, { color: '#F59E0B' }]}>+200 XP</Text>
          </View>
        </View>

        {/* Action Button */}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => setCurrentScreen('Dashboard')}
          activeOpacity={0.85}
        >
          <Text style={styles.doneBtnTxt}>Back to Dashboard ▶</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 20, gap: 16, paddingBottom: 40 },
  detailsCard: { padding: 16, borderRadius: 24, borderWidth: 2, gap: 10 },
  cardHeader: { fontSize: 16, fontWeight: '900', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: 13, flex: 1, fontWeight: '700' },
  rowVal: { fontWeight: '900', fontSize: 14 },
  doneBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 16,
    borderRadius: 22,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#A7F3D0',
    elevation: 8,
  },
  doneBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
});

export default RecoveryScreen;
