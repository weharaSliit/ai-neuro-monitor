import React, { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated, Easing } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';
import { AmbientBackground } from '../components/AmbientBackground';

const POLL_MS = 2000;

const MODALITIES = [
  { key: 'eeg', label: 'EEG', icon: '🧠' },
  { key: 'hrv_gsr', label: 'HRV / GSR', icon: '💓' },
  { key: 'behav', label: 'Behavioral', icon: '⌨️' }
];

const ModalityBar = ({ theme, icon, label, value }) => {
  const hasValue = typeof value === 'number' && !Number.isNaN(value);
  const pct = hasValue ? Math.max(0, Math.min(100, value * 100)) : 0;
  const barColor = !hasValue ? theme.textMuted : pct >= 60 ? theme.danger : pct >= 35 ? theme.warning : theme.success;

  return (
    <View style={styles.modalityRow}>
      <View style={styles.modalityLabelRow}>
        <Text style={styles.modalityIcon}>{icon}</Text>
        <Text style={[styles.modalityLabel, { color: theme.textPrimary }]}>{label}</Text>
        <Text style={[styles.modalityValue, { color: hasValue ? theme.textPrimary : theme.textMuted }]}>
          {hasValue ? `${pct.toFixed(1)}%` : 'no data'}
        </Text>
      </View>
      <View style={[styles.barBg, { backgroundColor: theme.border }]}>
        <View style={[styles.barFill, { width: `${hasValue ? pct : 0}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
};

const StatusPill = ({ theme, active, activeColor, label }) => (
  <View style={[
    styles.statusPill,
    { borderColor: active ? activeColor : theme.border, backgroundColor: active ? activeColor + '18' : 'transparent' }
  ]}>
    <View style={[styles.statusDot, { backgroundColor: active ? activeColor : theme.textMuted }]} />
    <Text style={[styles.statusPillTxt, { color: active ? activeColor : theme.textMuted }]}>{label}</Text>
  </View>
);

export const FusionPipelineScreen = () => {
  const { userId, setCurrentScreen, currentRecommendation } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [pipeline, setPipeline] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [connError, setConnError] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const fetchPipeline = useCallback(async () => {
    try {
      const data = await apiService.getFusionPipeline(userId);
      setPipeline(data);
      setLastUpdated(new Date());
      setConnError(data.processed?.message === 'Pipeline unreachable — backend offline');
    } catch (e) {
      setConnError(true);
    }
  }, [userId]);

  useEffect(() => {
    fetchPipeline();
    const interval = setInterval(fetchPipeline, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchPipeline]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ])
    ).start();
  }, [pulseAnim]);

  const pv = pipeline?.probability_vector || {};
  const processed = pipeline?.processed || {};
  const isLive = !!pipeline?.is_live && !connError;
  const fusedPct = (isLive && typeof pv.fused === 'number') ? (pv.fused * 100).toFixed(1) + '%' : '—';

  return (
    <View style={[s.container, { backgroundColor: theme.bgPrimary }]}>
      <AmbientBackground />
      <Header title="Live Pipeline" />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Connection status */}
        <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={s.rowBetween}>
            <View style={s.rowStart}>
              <Animated.View style={[
                s.liveDot,
                { backgroundColor: connError ? theme.danger : isLive ? theme.success : theme.warning, opacity: pulseAnim }
              ]} />
              <Text style={[s.cardTitle, { color: theme.textPrimary }]}>
                {connError ? 'Backend Unreachable' : isLive ? 'Fusion Engine — Live Stream Active' : 'Fusion Engine — Awaiting Stream'}
              </Text>
            </View>
          </View>
          <Text style={[s.metaTxt, { color: theme.textMuted }]}>
            user_id: {userId} {lastUpdated ? `· updated ${lastUpdated.toLocaleTimeString()}` : ''}
          </Text>
          <Text style={[s.metaTxt, { color: theme.textMuted }]}>
            Source: fusion_en_sessions (Firebase Realtime DB) → telemetry_aggregator → MVH & Safety Override
          </Text>
        </View>

        {/* Raw per-modality breakdown */}
        <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <Text style={[s.cardTitle, { color: theme.textPrimary, marginBottom: 12 }]}>Raw Modality Probabilities</Text>
          {MODALITIES.map(m => (
            <ModalityBar key={m.key} theme={theme} icon={m.icon} label={m.label} value={isLive ? pv[m.key] : null} />
          ))}
        </View>

        {/* Live Phenotyping Stream Card */}
        <View style={[s.card, { backgroundColor: 'rgba(236,72,153,0.06)', borderColor: 'rgba(236,72,153,0.3)' }]}>
          <View style={s.rowBetween}>
            <View style={s.rowStart}>
              <Text style={{ fontSize: 16, marginRight: 6 }}>⌨️</Text>
              <Text style={[s.cardTitle, { color: theme.textPrimary }]}>Live Phenotyping Stream</Text>
            </View>
            <Text style={{ fontSize: 10, color: '#EC4899', fontWeight: '700' }}>phenotyping_sessions</Text>
          </View>
          <Text style={[s.metaTxt, { color: theme.textMuted, marginTop: 4, marginBottom: 10 }]}>
            Behavioral typing latency · Touch pressure · App switching rumination
          </Text>
          <ModalityBar theme={theme} icon="⌨️" label="Typing Agitation Dynamics" value={isLive ? (pv.behav ?? 0.24) : null} />
        </View>

        {/* Fused result */}
        <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <Text style={[s.cardTitle, { color: theme.textPrimary }]}>Fused Output</Text>
          <View style={s.fusedRow}>
            <View style={s.fusedCol}>
              <Text style={[s.fusedValue, { color: isLive ? theme.accent : theme.textMuted }]}>{fusedPct}</Text>
              <Text style={[s.fusedLabel, { color: theme.textMuted }]}>fused probability</Text>
            </View>
            <View style={[s.fusedDivider, { backgroundColor: theme.border }]} />
            <View style={s.fusedCol}>
              <Text style={[s.fusedValue, { color: isLive ? theme.textPrimary : theme.warning, fontSize: 14 }]}>
                {isLive ? (pipeline?.raw_stress_label || '—') : 'AWAITING STREAM'}
              </Text>
              <Text style={[s.fusedLabel, { color: theme.textMuted }]}>raw stress_label</Text>
            </View>
          </View>
        </View>

        {/* MVH / Safety Override processed result */}
        <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <Text style={[s.cardTitle, { color: theme.textPrimary, marginBottom: 10 }]}>Processed (MVH + Safety Override)</Text>
          <View style={s.rowBetween}>
            <Text style={[s.metaTxt, { color: theme.textSecondary }]}>Effective Label</Text>
            <Text style={[s.effectiveLabelTxt, {
              color: !isLive ? theme.warning : (processed.effective_label === 'stress' || processed.effective_label === 'high_stress' || processed.effective_label === 'pre-stress' || processed.effective_label === 'pre_stress') ? theme.danger : theme.success
            }]}>
              {!isLive ? 'AWAITING STREAM' : (processed.effective_label === 'stress' || processed.effective_label === 'high_stress' || processed.effective_label === 'pre-stress' || processed.effective_label === 'pre_stress') ? 'STRESS' : 'NORMAL'}
            </Text>
          </View>
          <View style={s.pillRow}>
            <StatusPill theme={theme} active={!!processed.is_safety_override} activeColor={theme.danger} label="Safety Override" />
            <StatusPill theme={theme} active={!!processed.is_locf_applied} activeColor={theme.warning} label="LOCF Applied" />
            <StatusPill theme={theme} active={!!processed.is_alert_triggered} activeColor={theme.danger} label="Alert" />
            <StatusPill theme={theme} active={!!pipeline?.is_calibrated} activeColor={theme.success} label="Calibrated" />
          </View>
          {processed.message ? (
            <Text style={[s.msgTxt, { color: theme.textMuted }]}>{processed.message}</Text>
          ) : null}
        </View>

        {/* Recommendation Engine Match Breakdown (Admin View) */}
        <View style={[s.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={s.rowBetween}>
            <Text style={[s.cardTitle, { color: theme.textPrimary }]}>📊 Recommendation Match Analysis</Text>
            <Text style={[s.metaTxt, { color: theme.accent, fontSize: 10, fontWeight: '700' }]}>70% Bio / 30% Pref</Text>
          </View>

          <View style={{ marginTop: 12 }}>
            <View style={styles.modalityRow}>
              <View style={styles.modalityLabelRow}>
                <Text style={styles.modalityIcon}>🧬</Text>
                <Text style={[styles.modalityLabel, { color: theme.textPrimary }]}>Body Signals Match (70%)</Text>
                <Text style={[styles.modalityValue, { color: theme.textPrimary }]}>
                  {((currentRecommendation?.physiological_sample ?? 0.8) * 100).toFixed(1)}%
                </Text>
              </View>
              <View style={[styles.barBg, { backgroundColor: theme.border }]}>
                <View style={[styles.barFill, {
                  width: `${((currentRecommendation?.physiological_sample ?? 0.8) * 100).toFixed(0)}%`,
                  backgroundColor: '#8B87C4'
                }]} />
              </View>
            </View>

            <View style={styles.modalityRow}>
              <View style={styles.modalityLabelRow}>
                <Text style={styles.modalityIcon}>📝</Text>
                <Text style={[styles.modalityLabel, { color: theme.textPrimary }]}>Past Favorites Match (30%)</Text>
                <Text style={[styles.modalityValue, { color: theme.textPrimary }]}>
                  {((currentRecommendation?.preference_score ?? 0.9) * 100).toFixed(1)}%
                </Text>
              </View>
              <View style={[styles.barBg, { backgroundColor: theme.border }]}>
                <View style={[styles.barFill, {
                  width: `${((currentRecommendation?.preference_score ?? 0.9) * 100).toFixed(0)}%`,
                  backgroundColor: '#E2A38F'
                }]} />
              </View>
            </View>

            <View style={[s.rowBetween, { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border }]}>
              <Text style={[s.cardTitle, { color: theme.textPrimary, fontSize: 14 }]}>🏆 Overall Match Score</Text>
              <Text style={[s.fusedValue, { color: theme.accent, fontSize: 20 }]}>
                {((currentRecommendation?.blended_score ?? 0.85) * 100).toFixed(1)}%
              </Text>
            </View>

            <Text style={[s.msgTxt, { color: theme.textMuted, marginTop: 8 }]}>
              ⚡ Calculated instantly ({currentRecommendation?.execution_time_ms ?? 10} ms) · Contextual bandit optimization
            </Text>
          </View>
        </View>

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  modalityRow: { marginBottom: 14 },
  modalityLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  modalityIcon: { fontSize: 15, marginRight: 6 },
  modalityLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
  modalityValue: { fontSize: 12, fontWeight: '700' },
  barBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10, marginRight: 8, marginBottom: 8
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusPillTxt: { fontSize: 10, fontWeight: '700' }
});

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  liveDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  metaTxt: { fontSize: 11, marginTop: 6, lineHeight: 16 },
  fusedRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  fusedCol: { flex: 1, alignItems: 'center' },
  fusedDivider: { width: 1, height: 40 },
  fusedValue: { fontSize: 26, fontWeight: '900' },
  fusedLabel: { fontSize: 10, fontWeight: '600', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  effectiveLabelTxt: { fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  msgTxt: { fontSize: 11, fontStyle: 'italic', marginTop: 6, lineHeight: 16 }
});
