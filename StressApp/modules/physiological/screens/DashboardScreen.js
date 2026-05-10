import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import { API_BASE, USER_ID, USER_NAME } from '../config/config';

const { width } = Dimensions.get('window');

function LivePulseBar({ color, height: h, delay }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 500, useNativeDriver: true }),
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

function SignalBar({ label, color, value, unit, icon }) {
  const { isDark, theme } = useTheme();
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fillAnim, { toValue: 1, duration: 1200, useNativeDriver: false }).start();
  }, [value]);

  return (
    <View style={[styles.signalBar, { backgroundColor: isDark ? '#162033' : '#f8fafc', borderColor: color + '30' }]}>
      <View style={styles.signalBarHeader}>
        <View style={[styles.signalIconCircle, { backgroundColor: color + '20' }]}>
          <Text style={{ fontSize: 14 }}>{icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.signalLabel, { color: theme.textMuted }]}>{label}</Text>
          <Text style={[styles.signalValue, { color }]}>
            {value ?? '—'}<Text style={styles.signalUnit}> {unit}</Text>
          </Text>
        </View>
        <View style={styles.signalMini}>
          {[1,2,3,4,5].map((i) => (
            <LivePulseBar key={i} color={color} height={8 + i * 3} delay={i * 100} />
          ))}
        </View>
      </View>
    </View>
  );
}

function StressIndicator({ label, value, color, max }) {
  const { isDark } = useTheme();
  const fillAnim = useRef(new Animated.Value(0)).current;
  const pct = value / max;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: pct, duration: 1000, useNativeDriver: false
    }).start();
  }, [value]);

  const fillWidth = fillAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%']
  });

  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color, fontSize: 22, fontWeight: '900' }}>{value}</Text>
      <View style={[styles.indicatorBar, { backgroundColor: isDark ? '#1e3a5f' : '#e2e8f0' }]}>
        <Animated.View style={[styles.indicatorFill, { width: fillWidth, backgroundColor: color }]} />
      </View>
      <Text style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen({ navigation }) {
  const { isDark, toggle, theme } = useTheme();
  const [status,   setStatus]   = useState('checking');
  const [baseline, setBaseline] = useState(null);
  const [sessions, setSessions] = useState(null);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
    loadData();
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const loadData = async () => {
    setStatus('checking');
    try {
      const [b, h] = await Promise.all([
        axios.get(`${API_BASE}/baseline/${USER_ID}`),
        axios.get(`${API_BASE}/history/${USER_ID}`),
      ]);
      setBaseline(b.data);
      setSessions(h.data);
      setStatus('connected');
    } catch {
      setStatus('error');
    }
  };

  const sessionCount = sessions?.sessions ? Object.keys(sessions.sessions).length : 0;
  const bg     = isDark ? '#060d1a' : '#f0f9ff';
  const card   = isDark ? '#0f1f35' : '#ffffff';
  const border = isDark ? '#1e3a5f' : '#e2e8f0';
  const text   = theme.text;
  const muted  = theme.textMuted;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View style={[styles.header, { transform: [{ translateY: slideAnim }] }]}>
          <View>
            <Text style={[styles.headerGreeting, { color: muted }]}>Good day,</Text>
            <Text style={[styles.headerName, { color: text }]}>
              {USER_NAME} <Text style={{ fontSize: 22 }}>👋</Text>
            </Text>
            <Text style={[styles.headerSub, { color: '#6366f1' }]}>
              Mind<Text style={{ fontWeight: '900' }}>Pulse</Text> · Pre-Stress Detection
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.themeBtn, { backgroundColor: card, borderColor: border }]}
            onPress={toggle}
          >
            <Text style={{ fontSize: 18 }}>{isDark ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Status strip */}
        <View style={[styles.statusStrip, { backgroundColor: card, borderColor: border }]}>
          <StatusDot
            color={status === 'connected' ? '#10b981' : status === 'checking' ? '#f59e0b' : '#ef4444'}
            label={status === 'connected' ? 'Backend Online' : status === 'checking' ? 'Connecting...' : 'Offline'}
          />
          <View style={styles.statusDivider} />
          <StatusDot
            color={baseline?.exists ? '#10b981' : '#f59e0b'}
            label={baseline?.exists ? 'Baseline Active' : 'Needs Calibration'}
          />
          <View style={styles.statusDivider} />
          <StatusDot color="#6366f1" label={`${sessionCount} Sessions`} />
        </View>

        {/* Baseline signals */}
        {baseline?.exists ? (
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.cardTitle, { color: text }]}>Personal Baseline</Text>
              <View style={styles.noveltyBadge}>
                <Text style={styles.noveltyText}>N3 · Personalized</Text>
              </View>
            </View>
            <Text style={[styles.cardSub, { color: muted }]}>
              Your resting physiological fingerprint
            </Text>

            <SignalBar
              label="HRV — Avg RR Interval"
              color="#06b6d4"
              value={baseline.baseline?.AVNN?.mean?.toFixed(1)}
              unit="ms"
              icon="💓"
            />
            <SignalBar
              label="Heart Rate"
              color="#ef4444"
              value={baseline.baseline?.MeanHR?.mean?.toFixed(1)}
              unit="bpm"
              icon="❤️"
            />
            <SignalBar
              label="GSR — Skin Conductance"
              color="#8b5cf6"
              value={baseline.baseline?.SCL_mean?.mean?.toFixed(3)}
              unit="μS"
              icon="⚡"
            />
            <SignalBar
              label="SCR Count"
              color="#10b981"
              value={baseline.baseline?.SCR_count?.mean?.toFixed(1)}
              unit="/min"
              icon="📈"
            />
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.calibratePrompt, { backgroundColor: '#6366f115', borderColor: '#6366f140' }]}
            onPress={() => navigation.navigate('Calibration')}
          >
            <Text style={{ fontSize: 32, marginBottom: 8 }}>🎯</Text>
            <Text style={[styles.calibrateTitle, { color: '#818cf8' }]}>Run Calibration First</Text>
            <Text style={[styles.calibrateSub, { color: muted }]}>
              Capture your personal resting baseline to enable personalized stress detection
            </Text>
            <View style={styles.calibrateBtn}>
              <Text style={styles.calibrateBtnText}>Start Calibration →</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Research metrics */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: text }]}>Model Performance</Text>
          <Text style={[styles.cardSub, { color: muted }]}>XGBoost · WESAD · LOSO Cross-Validation</Text>

          <View style={styles.metricsGrid}>
            <MetricTile value="0.628" label="F1-Macro" color="#6366f1" dark={isDark} />
            <MetricTile value="0.802" label="F1-Stress" color="#10b981" dark={isDark} />
            <MetricTile value="0.194" label="OrdMAE" color="#06b6d4" dark={isDark} />
            <MetricTile value="85.6%" label="Accuracy" color="#f59e0b" dark={isDark} />
          </View>

          <View style={[styles.noveltyRow, { borderColor: border }]}>
            {['N1 Pre-stress', 'N3 Personal', 'N4 EMA', 'N7 LOSO'].map((n, i) => (
              <View key={i} style={styles.noveltyChip}>
                <Text style={styles.noveltyChipText}>{n}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Quick actions */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: text }]}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            <ActionCard icon="▶️" label="Simulate" color="#6366f1" onPress={() => navigation.navigate('Simulation')} dark={isDark} />
            <ActionCard icon="🎯" label="Calibrate" color="#06b6d4" onPress={() => navigation.navigate('Calibration')} dark={isDark} />
            <ActionCard icon="📋" label="PSS-4" color="#10b981" onPress={() => navigation.navigate('PSS-4')} dark={isDark} />
            <ActionCard icon="🔬" label="Analysis" color="#8b5cf6" onPress={() => navigation.navigate('Analysis')} dark={isDark} />
          </View>
        </View>

        <View style={{ height: 80 }} />
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

function StatusDot({ color, label }) {
  return (
    <View style={styles.statusItem}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusLabel, { color: '#94a3b8' }]}>{label}</Text>
    </View>
  );
}

function MetricTile({ value, label, color, dark }) {
  const bg = dark ? '#162033' : '#f8fafc';
  return (
    <View style={[styles.metricTile, { backgroundColor: bg, borderColor: color + '30' }]}>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ActionCard({ icon, label, color, onPress, dark }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const bg = dark ? '#162033' : '#f8fafc';

  const onPressIn  = () => Animated.spring(scaleAnim, { toValue: 0.94, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();

  return (
    <TouchableOpacity onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} activeOpacity={1}>
      <Animated.View style={[styles.actionCard, {
        backgroundColor: bg,
        borderColor:     color + '40',
        transform:       [{ scale: scaleAnim }],
      }]}>
        <View style={[styles.actionIconCircle, { backgroundColor: color + '20' }]}>
          <Text style={{ fontSize: 22 }}>{icon}</Text>
        </View>
        <Text style={[styles.actionLabel, { color }]}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  header:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  headerGreeting:    { fontSize: 13, fontWeight: '500' },
  headerName:        { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  headerSub:         { fontSize: 13, marginTop: 2 },
  themeBtn:          { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  statusStrip:       { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 16, padding: 12, borderRadius: 14, borderWidth: 1 },
  statusItem:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:         { width: 7, height: 7, borderRadius: 3.5 },
  statusLabel:       { fontSize: 10, fontWeight: '600' },
  statusDivider:     { width: 1, height: 20, backgroundColor: '#1e3a5f', marginHorizontal: 6 },
  card:              { marginHorizontal: 20, marginBottom: 16, padding: 18, borderRadius: 20, borderWidth: 1 },
  cardHeaderRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle:         { fontSize: 16, fontWeight: '800' },
  cardSub:           { fontSize: 12, marginBottom: 14 },
  noveltyBadge:      { backgroundColor: '#6366f120', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#6366f140' },
  noveltyText:       { color: '#818cf8', fontSize: 10, fontWeight: '700' },
  signalBar:         { borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1 },
  signalBarHeader:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  signalIconCircle:  { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  signalLabel:       { fontSize: 11, fontWeight: '500' },
  signalValue:       { fontSize: 18, fontWeight: '900' },
  signalUnit:        { fontSize: 11, fontWeight: '400' },
  signalMini:        { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  calibratePrompt:   { marginHorizontal: 20, marginBottom: 16, padding: 24, borderRadius: 20, borderWidth: 1, alignItems: 'center' },
  calibrateTitle:    { fontSize: 18, fontWeight: '800', marginBottom: 6 },
  calibrateSub:      { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  calibrateBtn:      { backgroundColor: '#6366f1', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  calibrateBtnText:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  metricsGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  metricTile:        { width: '47%', padding: 14, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
  metricValue:       { fontSize: 22, fontWeight: '900' },
  metricLabel:       { fontSize: 11, color: '#64748b', marginTop: 3 },
  noveltyRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 12, borderTopWidth: 1 },
  noveltyChip:       { backgroundColor: '#6366f115', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  noveltyChipText:   { color: '#818cf8', fontSize: 10, fontWeight: '700' },
  actionsGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard:        { width: (width - 76) / 2, padding: 16, borderRadius: 16, borderWidth: 1, alignItems: 'center', gap: 8 },
  actionIconCircle:  { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel:       { fontSize: 13, fontWeight: '700' },
  indicatorBar:      { width: '100%', height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  indicatorFill:     { height: 4, borderRadius: 2 },
});