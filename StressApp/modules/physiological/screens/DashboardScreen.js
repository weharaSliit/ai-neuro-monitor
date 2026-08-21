import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LineChart } from 'react-native-gifted-charts';
import { useTheme } from '../config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import api from '../api/client';
import EmaSummaryCard from './EmaSummaryCard';

const { width } = Dimensions.get('window');

function LivePulseBar({ color, h, delay }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 450, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{
      width: 3, height: h, borderRadius: 2,
      backgroundColor: color, opacity: anim,
      transform: [{ scaleY: anim }],
    }} />
  );
}

function SignalCard({ icon, label, value, unit, color, isDark, border }) {
  const fillAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fillAnim, { toValue: 1, duration: 1000, useNativeDriver: false }).start();
  }, [value]);

  return (
    <View style={[dStyles.signalCard, {
      backgroundColor: isDark ? color + '0d' : color + '08',
      borderColor: color + '25',
    }]}>
      <View style={dStyles.signalTop}>
        <View style={[dStyles.signalIconBox, { backgroundColor: color + '20' }]}>
          <Text style={{ fontSize: 16 }}>{icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={dStyles.signalLabel}>{label}</Text>
          <Text style={[dStyles.signalValue, { color }]}>
            {value ?? '—'}<Text style={dStyles.signalUnit}> {unit}</Text>
          </Text>
        </View>
        <View style={dStyles.miniWave}>
          {[1,2,3,4,5].map(i => (
            <LivePulseBar key={i} color={color} h={6 + i * 3} delay={i * 80} />
          ))}
        </View>
      </View>
    </View>
  );
}

function LegendDot({ color, label, textColor }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: textColor }}>{label}</Text>
    </View>
  );
}

function ActionTile({ icon, label, color, onPress, isDark }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const onIn  = () => Animated.spring(scaleAnim, { toValue: 0.93, useNativeDriver: true }).start();
  const onOut = () => Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true }).start();
  return (
    <TouchableOpacity onPress={onPress} onPressIn={onIn} onPressOut={onOut} activeOpacity={1}>
      <Animated.View style={[dStyles.actionTile, {
        backgroundColor: isDark ? color + '10' : color + '08',
        borderColor: color + '30',
        transform: [{ scale: scaleAnim }],
      }]}>
        <View style={[dStyles.actionIcon, { backgroundColor: color + '20' }]}>
          <Text style={{ fontSize: 24 }}>{icon}</Text>
        </View>
        <Text style={[dStyles.actionLabel, { color }]}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}


export default function DashboardScreen({ navigation }) {
  const { isDark, toggle, theme, COLORS } = useTheme();
  const { user } = useAuth();
  const userId = user?.userId;
  const [status,        setStatus]        = useState('checking');
  const [baseline,      setBaseline]      = useState(null);
  const [sessions,      setSessions]      = useState(null);
  const [stressSeries,  setStressSeries]  = useState([]);
  const [recentRows,    setRecentRows]    = useState([]);
  const [currentStatus, setCurrentStatus] = useState(null); // latest window: {label, trending, timestamp}

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  const t = theme;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start();
    loadData();
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  // Session-level `stress_label` in /history's session metadata is only
  // ever set when a PSS-4 was submitted (end_session() writes it) — for
  // a plain ring session with no self-report, it's just missing. So the
  // real Normal/Stress status for a session has to be derived from its
  // own predictions (majority vote), not trusted from that field alone.
  const deriveSessionStatus = (predictionsObj) => {
    const preds = Object.values(predictionsObj || {});
    if (preds.length === 0) return null;
    const stressCount = preds.filter(p => p.label === 'Stress').length;
    const trending = preds.some(p => p.trending_toward_stress);
    return {
      label: stressCount > preds.length / 2 ? 'Stress' : 'Normal',
      trending,
      windowCount: preds.length,
    };
  };

  const loadData = async () => {
    if (!userId) return;
    setStatus('checking');
    try {
      const [b, h] = await Promise.all([
        api.get(`/baseline/${userId}`),
        api.get(`/history/${userId}`),
      ]);
      setBaseline(b.data);
      setSessions(h.data);
      setStatus('connected');

      const sessionEntries = Object.entries(h.data?.sessions || {});
      // Firebase push keys sort chronologically
      const recentEntries = sessionEntries.slice(-4).reverse();

      // Fetch predictions for each recent session in parallel to derive
      // a real Normal/Stress status per session (see deriveSessionStatus).
      const recentWithStatus = await Promise.all(
        recentEntries.map(async ([sid, data]) => {
          try {
            const s = await api.get(`/history/${userId}/${sid}`);
            return [sid, data, deriveSessionStatus(s.data?.predictions)];
          } catch {
            return [sid, data, null];
          }
        })
      );
      setRecentRows(recentWithStatus);

      const latestId = sessionEntries.length
        ? sessionEntries[sessionEntries.length - 1][0]
        : null;

      if (latestId) {
        const s = await api.get(`/history/${userId}/${latestId}`);
        const predictions = Object.values(s.data?.predictions || {})
          .sort((a, b) => (a.window_idx ?? 0) - (b.window_idx ?? 0));

        setStressSeries(predictions.map(p => {
          const dotColor = p.label === 'Stress'
            ? COLORS.stress
            : p.trending_toward_stress ? COLORS.warning : COLORS.normal;
          return {
            value: Math.round((p.prob_stress ?? 0) * 100),
            label: `${p.window_idx ?? ''}`,
            dataPointColor: dotColor,
          };
        }));

        const latest = predictions[predictions.length - 1];
        setCurrentStatus(latest ? {
          label: latest.label,
          trending: !!latest.trending_toward_stress,
          timestamp: latest.timestamp,
        } : null);
      } else {
        setStressSeries([]);
        setCurrentStatus(null);
      }
    } catch { setStatus('error'); }
  };

  const sessionCount = sessions?.sessions ? Object.keys(sessions.sessions).length : 0;

  const statusColor =
    status === 'connected' ? COLORS.normal :
    status === 'checking'  ? COLORS.warning : COLORS.stress;

  return (
    <SafeAreaView style={[dStyles.safe, { backgroundColor: t.bg }]}>
      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View style={[dStyles.header, { transform: [{ translateY: slideAnim }] }]}>
          <View>
            <Text style={[dStyles.greeting, { color: t.textMuted }]}>Good day,</Text>
            <Text style={[dStyles.name, { color: t.text }]}>
              {user?.name || user?.userId} <Text style={{ fontSize: 20 }}>👋</Text>
            </Text>
            <View style={dStyles.brandRow}>
              <Text style={[dStyles.brandText, { color: t.textMuted }]}>Mind</Text>
              <Text style={[dStyles.brandAccent, { color: COLORS.brand }]}>Pulse</Text>
              <View style={[dStyles.liveDot, { backgroundColor: COLORS.normal }]} />
              <Text style={[dStyles.liveText, { color: COLORS.normal }]}>LIVE</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[dStyles.themeBtn, { backgroundColor: t.card, borderColor: t.border }]}
            onPress={toggle}
          >
            <Text style={{ fontSize: 17 }}>{isDark ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Current status — the actual answer to "am I stressed right now" */}
        {currentStatus && (
          <View style={[
            dStyles.statusHero,
            {
              backgroundColor: (currentStatus.label === 'Stress' ? COLORS.stress : COLORS.normal) + '15',
              borderColor:     (currentStatus.label === 'Stress' ? COLORS.stress : COLORS.normal) + '50',
            },
          ]}>
            <Text style={dStyles.statusHeroEmoji}>
              {currentStatus.label === 'Stress' ? '😰' : '😌'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[
                dStyles.statusHeroLabel,
                { color: currentStatus.label === 'Stress' ? COLORS.stress : COLORS.normal },
              ]}>
                {currentStatus.label === 'Stress' ? 'Stress' : 'Normal'}
              </Text>
              <Text style={[dStyles.statusHeroSub, { color: t.textMuted }]}>
                {currentStatus.timestamp
                  ? `As of ${new Date(currentStatus.timestamp).toLocaleTimeString()}`
                  : 'Latest reading'}
              </Text>
              {currentStatus.trending && currentStatus.label !== 'Stress' && (
                <View style={[dStyles.trendingPill, { backgroundColor: COLORS.warning + '20', borderColor: COLORS.warning + '50' }]}>
                  <Text style={[dStyles.trendingPillText, { color: COLORS.warning }]}>⚠ Trending toward stress</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Status bar */}
        <View style={[dStyles.statusBar, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={dStyles.statusItem}>
            <View style={[dStyles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[dStyles.statusText, { color: t.textSub }]}>
              {status === 'connected' ? 'Backend Online' : status === 'checking' ? 'Connecting' : 'Offline'}
            </Text>
          </View>
          <View style={[dStyles.statusDiv, { backgroundColor: t.border }]} />
          <View style={dStyles.statusItem}>
            <View style={[dStyles.statusDot, {
              backgroundColor: baseline?.exists ? COLORS.normal : COLORS.warning
            }]} />
            <Text style={[dStyles.statusText, { color: t.textSub }]}>
              {baseline?.exists ? 'Baseline Active' : 'No Baseline'}
            </Text>
          </View>
          <View style={[dStyles.statusDiv, { backgroundColor: t.border }]} />
          <View style={dStyles.statusItem}>
            <View style={[dStyles.statusDot, { backgroundColor: COLORS.brand }]} />
            <Text style={[dStyles.statusText, { color: t.textSub }]}>{sessionCount} Sessions</Text>
          </View>
        </View>

        {/* Baseline signals */}
        {baseline?.exists ? (
          <View style={[dStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={dStyles.cardHeader}>
              <Text style={[dStyles.cardTitle, { color: t.text }]}>Personal Baseline</Text>
              <View style={[dStyles.noveltyPill, { backgroundColor: COLORS.brand + '18', borderColor: COLORS.brand + '30' }]}>
                <Text style={[dStyles.noveltyText, { color: COLORS.brandLight }]}>N3 · Personalized</Text>
              </View>
            </View>
            <Text style={[dStyles.cardSub, { color: t.textMuted }]}>
              Your resting physiological fingerprint
            </Text>
            <SignalCard icon="💓" label="HRV — Avg RR Interval" color={COLORS.hrv}
              value={baseline.baseline?.AVNN?.mean?.toFixed(1)} unit="ms" isDark={isDark} />
            <SignalCard icon="❤️" label="Heart Rate" color={COLORS.stress}
              value={baseline.baseline?.MeanHR?.mean?.toFixed(1)} unit="bpm" isDark={isDark} />
            <SignalCard icon="⚡" label="GSR — Skin Conductance" color={COLORS.gsr}
              value={baseline.baseline?.SCL_mean?.mean?.toFixed(3)} unit="μS" isDark={isDark} />
            <SignalCard icon="📈" label="SCR Count" color={COLORS.normal}
              value={baseline.baseline?.SCR_count?.mean?.toFixed(1)} unit="/min" isDark={isDark} />
          </View>
        ) : (
          <TouchableOpacity
            style={[dStyles.calibPrompt, { backgroundColor: COLORS.brand + '10', borderColor: COLORS.brand + '30' }]}
            onPress={() => navigation.navigate('Calibration')}
          >
            <Text style={{ fontSize: 36, marginBottom: 10 }}>🎯</Text>
            <Text style={[dStyles.calibTitle, { color: COLORS.brandLight }]}>
              Run Calibration First
            </Text>
            <Text style={[dStyles.calibDesc, { color: t.textMuted }]}>
              Capture your personal resting baseline to enable personalized stress detection
            </Text>
            <View style={[dStyles.calibBtn, { backgroundColor: COLORS.brand }]}>
              <Text style={dStyles.calibBtnText}>Start Calibration →</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Stress chart — latest session */}
        <View style={[dStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[dStyles.cardTitle, { color: t.text }]}>Stress Level — Latest Session</Text>
          <Text style={[dStyles.cardSub, { color: t.textMuted }]}>
            {stressSeries.length > 1 ? 'Stress probability per window (%)' : 'No sessions yet'}
          </Text>
          {stressSeries.length > 1 ? (
            <>
              <LineChart
                data={stressSeries}
                height={150}
                color={t.textMuted}
                thickness={1.5}
                curved
                hideDataPoints={false}
                dataPointsRadius={4}
                yAxisColor={t.border}
                xAxisColor={t.border}
                yAxisTextStyle={{ color: t.textMuted, fontSize: 9 }}
                xAxisLabelTextStyle={{ color: t.textMuted, fontSize: 8 }}
                noOfSections={4}
                maxValue={100}
                rulesColor={t.border}
                backgroundColor="transparent"
              />
              <View style={dStyles.chartLegendRow}>
                <LegendDot color={COLORS.normal} label="Normal" textColor={t.textMuted} />
                <LegendDot color={COLORS.warning} label="Trending" textColor={t.textMuted} />
                <LegendDot color={COLORS.stress} label="Stress" textColor={t.textMuted} />
              </View>
            </>
          ) : (
            <View style={dStyles.emptyChart}>
              <Text style={{ fontSize: 26, marginBottom: 6 }}>📉</Text>
              <Text style={[dStyles.emptyChartText, { color: t.textMuted }]}>
                Wear the ring and start a session to see this chart.
              </Text>
            </View>
          )}
        </View>

        {/* Recent activity */}
        <View style={[dStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[dStyles.cardTitle, { color: t.text }]}>Recent Activity</Text>
          {recentRows.length === 0 ? (
            <Text style={[dStyles.cardSub, { color: t.textMuted, marginBottom: 0 }]}>
              No sessions yet.
            </Text>
          ) : (
            recentRows.map(([sid, data, derived]) => {
              const dotColor = derived
                ? (derived.label === 'Stress'
                    ? COLORS.stress
                    : derived.trending ? COLORS.warning : COLORS.normal)
                : t.textMuted;
              return (
                <View key={sid} style={[dStyles.activityRow, { borderBottomColor: t.border }]}>
                  <View style={[dStyles.activityDot, { backgroundColor: dotColor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[dStyles.activityTime, { color: t.text }]}>
                      {data.start_time ? new Date(data.start_time).toLocaleString() : 'Recent session'}
                    </Text>
                    <Text style={[dStyles.activitySub, { color: t.textMuted }]}>
                      {derived
                        ? `${derived.label}${derived.trending && derived.label !== 'Stress' ? ' (trending)' : ''} · ${derived.windowCount} windows${data.pss4_score != null ? ` · PSS-4: ${data.pss4_score}/16` : ''}`
                        : `${data.window_count || 0} windows recorded`}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
          <TouchableOpacity onPress={() => navigation.navigate('History')} style={dStyles.viewAllRow}>
            <Text style={[dStyles.viewAllText, { color: COLORS.brand }]}>View Full History →</Text>
          </TouchableOpacity>
        </View>

        {/* Continual learning summary */}
        <EmaSummaryCard navigation={navigation} />

        {/* Actions */}
        <View style={[dStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[dStyles.cardTitle, { color: t.text }]}>Quick Actions</Text>
          <View style={dStyles.actionsGrid}>
            <ActionTile icon="🎯" label="Calibrate"  color={COLORS.hrv}      isDark={isDark} onPress={() => navigation.navigate('Calibration')} />
            <ActionTile icon="📋" label="PSS-4"      color={COLORS.normal}   isDark={isDark} onPress={() => navigation.navigate('PSS-4')} />
            <ActionTile icon="📊" label="History"    color={COLORS.gsr}      isDark={isDark} onPress={() => navigation.navigate('History')} />
            <ActionTile icon="💍" label="Ring"       color={COLORS.brand}    isDark={isDark} onPress={() => navigation.navigate('Ring')} />
            <ActionTile icon="🧬" label="Fusion"     color={COLORS.stress}   isDark={isDark} onPress={() => navigation.navigate('Fusion')} />
            <ActionTile icon="🧠" label="EEG"        color={COLORS.warning}  isDark={isDark} onPress={() => navigation.navigate('Eeg')} />
          </View>
        </View>

        <View style={{ height: 80 }} />
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const dStyles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  greeting:     { fontSize: 13, fontWeight: '500' },
  name:         { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  brandRow:     { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  brandText:    { fontSize: 13, fontWeight: '700' },
  brandAccent:  { fontSize: 13, fontWeight: '900' },
  liveDot:      { width: 6, height: 6, borderRadius: 3, marginLeft: 6 },
  liveText:     { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  themeBtn:     { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  statusHero:      { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1.5 },
  statusHeroEmoji: { fontSize: 38 },
  statusHeroLabel: { fontSize: 24, fontWeight: '900' },
  statusHeroSub:   { fontSize: 12, marginTop: 2 },
  trendingPill:    { alignSelf: 'flex-start', marginTop: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  trendingPillText:{ fontSize: 11, fontWeight: '700' },
  statusBar:    { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 14, padding: 12, borderRadius: 16, borderWidth: 1 },
  statusItem:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:    { width: 7, height: 7, borderRadius: 3.5 },
  statusText:   { fontSize: 10, fontWeight: '600' },
  statusDiv:    { width: 1, height: 18, marginHorizontal: 4 },
  card:         { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 22, borderWidth: 1 },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle:    { fontSize: 16, fontWeight: '800' },
  cardSub:      { fontSize: 12, marginBottom: 14 },
  noveltyPill:  { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1 },
  noveltyText:  { fontSize: 10, fontWeight: '700' },
  signalCard:   { borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1 },
  signalTop:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  signalIconBox:{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  signalLabel:  { fontSize: 11, fontWeight: '500', color: '#9B958A' },
  signalValue:  { fontSize: 19, fontWeight: '900' },
  signalUnit:   { fontSize: 11, fontWeight: '400' },
  miniWave:     { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  calibPrompt:  { marginHorizontal: 20, marginBottom: 14, padding: 24, borderRadius: 22, borderWidth: 1, alignItems: 'center' },
  calibTitle:   { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  calibDesc:    { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  calibBtn:     { paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 },
  calibBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  actionsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  actionTile:   { width: (width - 96) / 2, padding: 16, borderRadius: 18, borderWidth: 1, alignItems: 'center', gap: 8 },
  actionIcon:   { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel:  { fontSize: 13, fontWeight: '700' },
  chartLegendRow:  { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  emptyChart:      { alignItems: 'center', paddingVertical: 20 },
  emptyChartText:  { fontSize: 12, textAlign: 'center', paddingHorizontal: 16 },
  activityRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  activityDot:     { width: 8, height: 8, borderRadius: 4 },
  activityTime:    { fontSize: 13, fontWeight: '600' },
  activitySub:     { fontSize: 11, marginTop: 2 },
  viewAllRow:      { paddingTop: 12, alignItems: 'center' },
  viewAllText:     { fontSize: 13, fontWeight: '700' },
});