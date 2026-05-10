import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Animated, Alert, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import {
  API_BASE, getSimulationUserId,
  STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI
} from '../config/config';
import { useAppState } from './AppState';

const { width } = Dimensions.get('window');

function AnimatedGauge({ prediction, pulseAnim, isDark }) {
  const color = prediction ? STRESS_COLORS[prediction.prediction] : '#334155';
  const emoji = prediction ? STRESS_EMOJI[prediction.prediction] : '😴';
  const label = prediction ? STRESS_LABELS[prediction.prediction] : 'Ready';

  const rotateAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 8000, useNativeDriver: true })
    ).start();
  }, []);

  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.gaugeWrapper}>
      {/* Outer rotating ring */}
      <Animated.View style={[styles.gaugeOuterRing, {
        borderColor: color + '30',
        transform:   [{ rotate }],
      }]} />

      {/* Glow ring */}
      <Animated.View style={[styles.gaugeGlowRing, {
        borderColor: color + '60',
        transform:   [{ scale: pulseAnim }],
      }]} />

      {/* Main gauge */}
      <Animated.View style={[styles.gauge, {
        backgroundColor: isDark ? '#0f1f35' : '#ffffff',
        borderColor:     color,
        transform:       [{ scale: pulseAnim }],
        shadowColor:     color,
        shadowOpacity:   0.4,
        shadowRadius:    20,
        elevation:       8,
      }]}>
        <Text style={styles.gaugeEmoji}>{emoji}</Text>
        <Text style={[styles.gaugeLabel, { color }]}>{label}</Text>
        {prediction && (
          <>
            <View style={[styles.gaugeDivider, { backgroundColor: color + '40' }]} />
            <Text style={[styles.gaugeProb, { color: color + 'cc' }]}>
              Pre-stress {(prediction.probabilities?.prestress * 100 || 0).toFixed(0)}%
            </Text>
          </>
        )}
      </Animated.View>
    </View>
  );
}

function TimelineBlock({ w, index }) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1, tension: 200, friction: 8, delay: index * 20, useNativeDriver: true
    }).start();
  }, []);

  return (
    <Animated.View style={[
      styles.timelineBlock,
      {
        backgroundColor: STRESS_COLORS[w.prediction],
        transform:       [{ scaleY: scaleAnim }],
        opacity:         w.trend_alert ? 1 : 0.8,
        borderWidth:     w.trend_alert ? 1.5 : 0,
        borderColor:     '#ffffff',
      }
    ]} />
  );
}

export default function SimulationScreen({ navigation }) {
  const { isDark, theme } = useTheme();
  const {
    selectedSubject, setSelectedSubject,
    setLastSessionId, setLastEmaResult
  } = useAppState();

  const [running,           setRunning]           = useState(false);
  const [currentPrediction, setCurrentPrediction] = useState(null);
  const [windowLog,         setWindowLog]         = useState([]);
  const [progress,          setProgress]          = useState(0);
  const [stats,             setStats]             = useState({ normal: 0, prestress: 0, stress: 0 });

  const intervalRef     = useRef(null);
  const pulseAnim       = useRef(new Animated.Value(1)).current;
  const trendShown      = useRef(false);
  const sessionIdRef    = useRef(null);
  const simUserIdRef    = useRef(getSimulationUserId(2));
  const logScrollRef    = useRef(null);

  const bg     = isDark ? '#060d1a' : '#f0f9ff';
  const card   = isDark ? '#0f1f35' : '#ffffff';
  const border = isDark ? '#1e3a5f' : '#e2e8f0';
  const text   = theme.text;
  const muted  = theme.textMuted;

  useEffect(() => {
    if (!running) simUserIdRef.current = getSimulationUserId(selectedSubject);
  }, [selectedSubject, running]);

  const pulse = () => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.12, duration: 250, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const startSimulation = async () => {
    const simUserId = getSimulationUserId(selectedSubject);
    simUserIdRef.current = simUserId;
    try {
      const res = await axios.post(`${API_BASE}/simulate/start`, {
        user_id: simUserId, subject_id: selectedSubject
      });
      const sid = res.data.session_id;
      sessionIdRef.current = sid;
      trendShown.current   = false;
      setLastSessionId(sid);
      setWindowLog([]);
      setProgress(0);
      setStats({ normal: 0, prestress: 0, stress: 0 });
      setCurrentPrediction(null);
      setRunning(true);
      intervalRef.current = setInterval(fetchNext, 2000);
    } catch {
      Alert.alert('Error', 'Could not start simulation. Is the backend running?');
    }
  };

  const fetchNext = async () => {
    try {
      const res  = await axios.post(`${API_BASE}/simulate/next`, { user_id: simUserIdRef.current });
      const data = res.data;
      if (data.done) {
        clearInterval(intervalRef.current);
        setRunning(false);
        handleComplete();
        return;
      }
      setCurrentPrediction(data);
      setProgress(data.progress);
      setStats(prev => ({
        normal:    prev.normal    + (data.prediction === 0 ? 1 : 0),
        prestress: prev.prestress + (data.prediction === 1 ? 1 : 0),
        stress:    prev.stress    + (data.prediction === 2 ? 1 : 0),
      }));
      setWindowLog(prev => [...prev, {
        idx: data.window_idx, prediction: data.prediction,
        label: data.label, raw_label: data.raw_label,
        state: data.state, true_label: data.true_label,
        true_name: data.true_name, trend_alert: data.trend_alert,
        hr:      data.features?.MeanHR?.toFixed(1),
        scl:     data.features?.SCL_mean?.toFixed(2),
        prob_pre: data.probabilities?.prestress
          ? (data.probabilities.prestress * 100).toFixed(0) : '0',
      }]);
      pulse();
      if (data.trend_alert && !trendShown.current) {
        trendShown.current = true;
        Alert.alert('⚠️ Pre-Stress Detected',
          'Rising stress trend detected.\nNovel Contribution N1 — Early warning system activated.',
          [{ text: 'OK' }]);
      }
      setTimeout(() => logScrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.log('Fetch error:', e.message);
    }
  };

  const handleComplete = async () => {
    const sid    = sessionIdRef.current;
    const userId = simUserIdRef.current;
    try { await axios.post(`${API_BASE}/simulate/stop`, { user_id: userId }); } catch {}
    try {
      const baseRes = await axios.get(`${API_BASE}/baseline/${userId}`);
      if (!baseRes.data?.exists) {
        Alert.alert('Simulation Complete', `No baseline for ${userId}.\nRun calibration first.`,
          [{ text: 'Calibrate', onPress: () => navigation.navigate('Calibration') }, { text: 'OK' }]);
        return;
      }
      const emaRes = await axios.post(`${API_BASE}/ema/update`, { user_id: userId, session_id: sid });
      setLastEmaResult(emaRes.data);
      Alert.alert('✅ Simulation Complete', `Session saved.\nEMA baseline updated for ${userId}.`,
        [{ text: 'View EMA', onPress: () => navigation.navigate('EMA Update') },
         { text: 'PSS-4',   onPress: () => navigation.navigate('PSS-4') },
         { text: 'OK' }]);
    } catch (e) {
      Alert.alert('Simulation Complete', 'Session saved. EMA update failed.');
    }
  };

  const stopSimulation = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    await handleComplete();
  };

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const gaugeColor = currentPrediction ? STRESS_COLORS[currentPrediction.prediction] : '#334155';

  // Phase detection
  const phases = [];
  let cur = null;
  windowLog.forEach(w => {
    const lbl = STRESS_LABELS[w.prediction];
    if (!cur || cur.label !== lbl) {
      if (cur) phases.push(cur);
      cur = { label: lbl, prediction: w.prediction, start: w.idx, end: w.idx, count: 1 };
    } else { cur.end = w.idx; cur.count++; }
  });
  if (cur) phases.push(cur);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.simHeader}>
          <View>
            <Text style={[styles.simTitle, { color: text }]}>Stress Simulation</Text>
            <Text style={[styles.simSub, { color: '#6366f1' }]}>
              {getSimulationUserId(selectedSubject)} · S{selectedSubject}
            </Text>
          </View>
          {running && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>

        {/* Gauge */}
        <AnimatedGauge prediction={currentPrediction} pulseAnim={pulseAnim} isDark={isDark} />

        {/* Pre-stress alert banner */}
        {currentPrediction?.trend_alert && (
          <Animated.View style={[styles.alertBanner, { borderColor: '#f59e0b' }]}>
            <Text style={styles.alertIcon}>⚠️</Text>
            <View>
              <Text style={styles.alertTitle}>Pre-Stress Trend Detected</Text>
              <Text style={styles.alertSub}>Novel Contribution N1 — 5-window sliding trend detector</Text>
            </View>
          </Animated.View>
        )}

        {/* Progress */}
        <View style={styles.progressWrap}>
          <View style={[styles.progressBg, { backgroundColor: isDark ? '#1e3a5f' : '#e2e8f0' }]}>
            <Animated.View style={[styles.progressFill, {
              width: `${progress * 100}%`, backgroundColor: gaugeColor
            }]} />
          </View>
          <View style={styles.progressRow}>
            <Text style={[styles.progressText, { color: muted }]}>
              {(progress * 100).toFixed(0)}% · W{currentPrediction?.window_idx ?? 0}
            </Text>
            <Text style={[styles.progressText, { color: gaugeColor }]}>
              {running ? 'Running...' : 'Paused'}
            </Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          {[
            { label: 'Normal',     value: stats.normal,    color: '#10b981' },
            { label: 'Pre-Stress', value: stats.prestress, color: '#f59e0b' },
            { label: 'Stress',     value: stats.stress,    color: '#ef4444' },
          ].map((s, i) => (
            <View key={i} style={[styles.statCard, { backgroundColor: card, borderColor: s.color + '30' }]}>
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: muted }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Subject selector */}
        {!running && (
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Select Subject</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              {[2,3,4,5,6,7,8,9,10,11,13,14,15,16,17].map(sid => (
                <TouchableOpacity
                  key={sid}
                  style={[styles.subjectChip,
                    selectedSubject === sid
                      ? { backgroundColor: '#6366f1', borderColor: '#6366f1' }
                      : { backgroundColor: isDark ? '#162033' : '#f8fafc', borderColor: border }
                  ]}
                  onPress={() => setSelectedSubject(sid)}
                >
                  <Text style={[styles.subjectChipText, { color: selectedSubject === sid ? '#fff' : muted }]}>
                    S{sid}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Control button */}
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: running ? '#ef4444' : '#6366f1' }]}
          onPress={running ? stopSimulation : startSimulation}
          activeOpacity={0.85}
        >
          <Text style={styles.controlBtnText}>
            {running ? '⏹  Stop Simulation' : '▶️  Start Simulation'}
          </Text>
        </TouchableOpacity>

        {/* Timeline */}
        {windowLog.length > 0 && (
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Stress Sequence Timeline</Text>
            <Text style={[styles.cardSub, { color: muted }]}>Each block = 60-second window</Text>

            <View style={styles.timeline}>
              {windowLog.map((w, i) => (
                <TimelineBlock key={i} w={w} index={i} />
              ))}
            </View>

            <View style={styles.legendRow}>
              {[['#10b981','Normal'],['#f59e0b','Pre-stress'],['#ef4444','Stress']].map(([c,l],i) => (
                <View key={i} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: c }]} />
                  <Text style={[styles.legendText, { color: muted }]}>{l}</Text>
                </View>
              ))}
            </View>

            {/* Phase chips */}
            {phases.length > 0 && (
              <View style={[styles.phaseRow, { borderTopColor: border }]}>
                {phases.map((p, i) => (
                  <React.Fragment key={i}>
                    <View style={[styles.phaseChip, {
                      backgroundColor: STRESS_COLORS[p.prediction] + '20',
                      borderColor:     STRESS_COLORS[p.prediction] + '60',
                    }]}>
                      <Text style={[styles.phaseLabel, { color: STRESS_COLORS[p.prediction] }]}>{p.label}</Text>
                      <Text style={[styles.phaseRange, { color: muted }]}>W{p.start}-{p.end}</Text>
                    </View>
                    {i < phases.length - 1 && (
                      <Text style={[styles.phaseArrow, { color: muted }]}>→</Text>
                    )}
                  </React.Fragment>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Live feed */}
        {windowLog.length > 0 && (
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Live Prediction Feed</Text>
            <Text style={[styles.cardSub, { color: muted }]}>
              {windowLog.length} windows · {windowLog.filter(w => w.raw_label !== w.label).length} SM overrides
            </Text>
            <ScrollView
              ref={logScrollRef}
              style={styles.logScroll}
              showsVerticalScrollIndicator
              onContentSizeChange={() => logScrollRef.current?.scrollToEnd({ animated: false })}
            >
              {windowLog.map((w, i) => (
                <View key={i} style={[
                  styles.logRow,
                  w.prediction === 1 && { backgroundColor: '#f59e0b08' },
                  w.trend_alert      && { backgroundColor: '#f59e0b15' },
                  { borderBottomColor: border }
                ]}>
                  <View style={[styles.logDot, { backgroundColor: STRESS_COLORS[w.prediction] }]} />
                  <View style={styles.logContent}>
                    <Text style={[styles.logMain, { color: text }]}>
                      W{w.idx} → <Text style={{ color: STRESS_COLORS[w.prediction], fontWeight: '700' }}>{w.label}</Text>
                      {w.trend_alert ? '  ⚠️' : ''}
                    </Text>
                    <Text style={[styles.logDetail, { color: muted }]}>
                      HR:{w.hr}bpm · SCL:{w.scl}μS · Pre:{w.prob_pre}%
                    </Text>
                    {w.raw_label !== w.label && (
                      <Text style={styles.logOverride}>XGB:{w.raw_label} → SM:{w.label}</Text>
                    )}
                  </View>
                  {w.prediction !== w.true_label && (
                    <Text style={styles.logTrue}>≠{w.true_name}</Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1 },
  simHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  simTitle:       { fontSize: 22, fontWeight: '900' },
  simSub:         { fontSize: 12, marginTop: 2, fontWeight: '600' },
  liveBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ef444420', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#ef444460' },
  liveDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' },
  liveText:       { color: '#ef4444', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  gaugeWrapper:   { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, height: 240 },
  gaugeOuterRing: { position: 'absolute', width: 230, height: 230, borderRadius: 115, borderWidth: 1, borderStyle: 'dashed' },
  gaugeGlowRing:  { position: 'absolute', width: 210, height: 210, borderRadius: 105, borderWidth: 2 },
  gauge:          { width: 185, height: 185, borderRadius: 93, borderWidth: 3, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 0 } },
  gaugeEmoji:     { fontSize: 42 },
  gaugeLabel:     { fontSize: 16, fontWeight: '900', marginTop: 4 },
  gaugeDivider:   { width: 80, height: 1, marginVertical: 6 },
  gaugeProb:      { fontSize: 11 },
  alertBanner:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginBottom: 12, backgroundColor: '#f59e0b15', borderRadius: 14, padding: 14, borderWidth: 1.5 },
  alertIcon:      { fontSize: 26 },
  alertTitle:     { color: '#f59e0b', fontWeight: '800', fontSize: 14 },
  alertSub:       { color: '#92400e', fontSize: 10, marginTop: 2 },
  progressWrap:   { paddingHorizontal: 20, marginBottom: 14 },
  progressBg:     { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill:   { height: 6, borderRadius: 3 },
  progressRow:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  progressText:   { fontSize: 11, fontWeight: '600' },
  statsRow:       { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 14 },
  statCard:       { flex: 1, padding: 14, borderRadius: 16, borderWidth: 1, alignItems: 'center' },
  statValue:      { fontSize: 24, fontWeight: '900' },
  statLabel:      { fontSize: 10, marginTop: 3, fontWeight: '600' },
  card:           { marginHorizontal: 20, marginBottom: 14, padding: 16, borderRadius: 18, borderWidth: 1 },
  cardTitle:      { fontSize: 15, fontWeight: '800' },
  cardSub:        { fontSize: 11, marginTop: 3, marginBottom: 12, fontStyle: 'italic' },
  subjectChip:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginRight: 8, borderWidth: 1 },
  subjectChipText:{ fontWeight: '700', fontSize: 13 },
  controlBtn:     { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 16, alignItems: 'center' },
  controlBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  timeline:       { flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 10 },
  timelineBlock:  { width: 8, height: 30, borderRadius: 2 },
  legendRow:      { flexDirection: 'row', gap: 14, marginBottom: 12 },
  legendItem:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:      { width: 8, height: 8, borderRadius: 4 },
  legendText:     { fontSize: 11 },
  phaseRow:       { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 12, borderTopWidth: 1 },
  phaseChip:      { borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center' },
  phaseLabel:     { fontWeight: '800', fontSize: 11 },
  phaseRange:     { fontSize: 9, marginTop: 2 },
  phaseArrow:     { fontSize: 14, fontWeight: '700' },
  logScroll:      { maxHeight: 300 },
  logRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  logDot:         { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  logContent:     { flex: 1 },
  logMain:        { fontSize: 13 },
  logDetail:      { fontSize: 10, marginTop: 2 },
  logOverride:    { color: '#f59e0b', fontSize: 9, fontStyle: 'italic', marginTop: 1 },
  logTrue:        { fontSize: 9, color: '#475569', fontStyle: 'italic' },
});