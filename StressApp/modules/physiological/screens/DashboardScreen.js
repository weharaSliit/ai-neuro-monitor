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
          <Text style={[dStyles.signalLabel, { color: isDark ? '#5a7a9a' : '#5a7a9a' }]}>{label}</Text>
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

function MetricPill({ value, label, color, isDark }) {
  return (
    <View style={[dStyles.metricPill, {
      backgroundColor: isDark ? color + '12' : color + '10',
      borderColor: color + '30',
    }]}>
      <Text style={[dStyles.metricVal, { color }]}>{value}</Text>
      <Text style={dStyles.metricLabel}>{label}</Text>
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

function MiniRingAnim({ COLORS, isDark }) {
  const rotAnim  = useRef(new Animated.Value(0)).current;
  const beatAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotAnim, { toValue: 1, duration: 8000, useNativeDriver: true })
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(beatAnim, { toValue: 1.1, duration: 400, useNativeDriver: true }),
        Animated.timing(beatAnim, { toValue: 1,   duration: 400, useNativeDriver: true }),
        Animated.delay(700),
      ])
    ).start();
  }, []);

  const rotate = rotAnim.interpolate({ inputRange:[0,1], outputRange:['0deg','360deg'] });

  return (
    <View style={mrStyles.wrap}>
      <Animated.View style={[mrStyles.outerRing, {
        borderColor: COLORS.brand + '40',
        transform: [{ rotate }],
      }]} />
      <Animated.View style={[mrStyles.innerRing, {
        backgroundColor: isDark ? COLORS.brand + '12' : COLORS.brand + '08',
        borderColor: COLORS.brand,
        transform: [{ scale: beatAnim }],
        shadowColor: COLORS.brand,
      }]}>
        <Text style={mrStyles.emoji}>🧠</Text>
      </Animated.View>
      {/* Sensor dots on ring */}
      {[
        { angle: 0,   color: COLORS.hrv },
        { angle: 90,  color: COLORS.gsr },
        { angle: 180, color: COLORS.acc },
        { angle: 270, color: COLORS.brand },
      ].map((dot, i) => {
        const rad = (dot.angle * Math.PI) / 180;
        const r   = 35;
        return (
          <View key={i} style={[mrStyles.dot, {
            backgroundColor: dot.color,
            top:  44 + r * Math.sin(rad) - 4,
            left: 44 + r * Math.cos(rad) - 4,
          }]} />
        );
      })}
    </View>
  );
}

const mrStyles = StyleSheet.create({
  wrap:       { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  outerRing:  { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 1, borderStyle: 'dashed' },
  innerRing:  { width: 64, height: 64, borderRadius: 32, borderWidth: 2, alignItems: 'center', justifyContent: 'center', shadowOffset:{width:0,height:0}, shadowOpacity:0.4, shadowRadius:8, elevation:6 },
  emoji:      { fontSize: 28 },
  dot:        { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
});

const ringCardStyles = StyleSheet.create({
  ringRow:     { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 },
  miniRingWrap:{ alignItems: 'center', justifyContent: 'center' },
  sensorList:  { flex: 1, gap: 8 },
  sensorRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sensorIcon:  { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sensorLabel: { fontSize: 12, fontWeight: '700' },
  sensorSub:   { fontSize: 10, marginTop: 1 },
  sensorDot:   { width: 6, height: 6, borderRadius: 3, marginLeft: 'auto' },
});

export default function DashboardScreen({ navigation }) {
  const { isDark, toggle, theme, COLORS } = useTheme();
  const [status,   setStatus]   = useState('checking');
  const [baseline, setBaseline] = useState(null);
  const [sessions, setSessions] = useState(null);

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
    } catch { setStatus('error'); }
  };

  const sessionCount = sessions?.sessions ? Object.keys(sessions.sessions).length : 0;

  const statusColor =
    status === 'connected' ? COLORS.normal :
    status === 'checking'  ? COLORS.prestress : COLORS.stress;

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
              {USER_NAME} <Text style={{ fontSize: 20 }}>👋</Text>
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
              backgroundColor: baseline?.exists ? COLORS.normal : COLORS.prestress
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

        {/* Smart Ring Status Card */}
<View style={[dStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
  <View style={dStyles.cardHeader}>
    <Text style={[dStyles.cardTitle, { color: t.text }]}>
      Smart Ring
    </Text>
    <View style={[dStyles.noveltyPill, {
      backgroundColor: COLORS.normal + '18',
      borderColor: COLORS.normal + '30',
    }]}>

    </View>
  </View>
  

  {/* Ring illustration */}
  <View style={[ringCardStyles.ringRow]}>

    {/* Mini ring visual */}
    <View style={ringCardStyles.miniRingWrap}>
      <MiniRingAnim COLORS={COLORS} isDark={isDark} />
    </View>

    {/* Sensor list */}
    <View style={ringCardStyles.sensorList}>
      {[
        { icon: '💓', label: 'HRV',    color: COLORS.hrv, },
        { icon: '⚡', label: 'GSR',    color: COLORS.gsr,  },
        { icon: '📡', label: 'Motion', color: COLORS.acc,  },
        { icon: '📶', label: 'Wireless',     color: COLORS.brand,  },
      ].map((s, i) => (
        <View key={i} style={ringCardStyles.sensorRow}>
          <View style={[ringCardStyles.sensorIcon, { backgroundColor: s.color + '18' }]}>
            <Text style={{ fontSize: 13 }}>{s.icon}</Text>
          </View>
          <View>
            <Text style={[ringCardStyles.sensorLabel, { color: t.text }]}>
              {s.label}
            </Text>
            <Text style={[ringCardStyles.sensorSub, { color: t.textMuted }]}>
              {s.sub}
            </Text>
          </View>
          <View style={[ringCardStyles.sensorDot, { backgroundColor: COLORS.normal }]} />
        </View>
      ))}
    </View>
  </View>


</View>

        {/* Actions */}
        <View style={[dStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[dStyles.cardTitle, { color: t.text }]}>Quick Actions</Text>
          <View style={dStyles.actionsGrid}>
            <ActionTile icon="▶️" label="Simulate"   color={COLORS.brand}    isDark={isDark} onPress={() => navigation.navigate('Simulation')} />
            <ActionTile icon="🎯" label="Calibrate"  color={COLORS.hrv}      isDark={isDark} onPress={() => navigation.navigate('Calibration')} />
            <ActionTile icon="📋" label="PSS-4"      color={COLORS.normal}   isDark={isDark} onPress={() => navigation.navigate('PSS-4')} />
            <ActionTile icon="🔬" label="Analysis"   color={COLORS.gsr}      isDark={isDark} onPress={() => navigation.navigate('Analysis')} />
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
  signalLabel:  { fontSize: 11, fontWeight: '500' },
  signalValue:  { fontSize: 19, fontWeight: '900' },
  signalUnit:   { fontSize: 11, fontWeight: '400' },
  miniWave:     { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  calibPrompt:  { marginHorizontal: 20, marginBottom: 14, padding: 24, borderRadius: 22, borderWidth: 1, alignItems: 'center' },
  calibTitle:   { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  calibDesc:    { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  calibBtn:     { paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 },
  calibBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  metricsRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  metricPill:   { width: '47%', padding: 14, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
  metricVal:    { fontSize: 22, fontWeight: '900' },
  metricLabel:  { fontSize: 11, color: '#64748b', marginTop: 3 },
  noveltyRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 12, borderTopWidth: 1 },
  nChip:        { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1 },
  nChipText:    { fontSize: 10, fontWeight: '700' },
  actionsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  actionTile:   { width: (width - 96) / 2, padding: 16, borderRadius: 18, borderWidth: 1, alignItems: 'center', gap: 8 },
  actionIcon:   { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel:  { fontSize: 13, fontWeight: '700' },
});