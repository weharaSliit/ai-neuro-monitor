import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Animated, Alert
} from 'react-native';
import axios from 'axios';
import {
  API_BASE,
  getSimulationUserId,
  STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI
} from '../config/config';
import { useAppState } from './AppState';

export default function SimulationScreen({ navigation }) {
  const {
    selectedSubject, setSelectedSubject,
    setLastSessionId, setLastEmaResult
  } = useAppState();

  const [running,           setRunning]           = useState(false);
  const [currentPrediction, setCurrentPrediction] = useState(null);
  const [windowLog,         setWindowLog]         = useState([]);
  const [progress,          setProgress]          = useState(0);
  const [stats,             setStats]             = useState({
    normal: 0, prestress: 0, stress: 0
  });

  const intervalRef       = useRef(null);
  const pulseAnim         = useRef(new Animated.Value(1)).current;
  const trendAlertShown   = useRef(false);
  const sessionIdRef      = useRef(null);
  const simUserIdRef      = useRef(getSimulationUserId(2));
  const logScrollRef      = useRef(null);

  // Keep simUserIdRef in sync
  useEffect(() => {
    if (!running) {
      simUserIdRef.current = getSimulationUserId(selectedSubject);
    }
  }, [selectedSubject, running]);

  const pulse = () => {
    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 1.15, duration: 300, useNativeDriver: true
      }),
      Animated.timing(pulseAnim, {
        toValue: 1,    duration: 300, useNativeDriver: true
      }),
    ]).start();
  };

  const startSimulation = async () => {
    const simUserId = getSimulationUserId(selectedSubject);
    simUserIdRef.current = simUserId;

    try {
      const res = await axios.post(
        `${API_BASE}/simulate/start`,
        { user_id: simUserId, subject_id: selectedSubject }
      );

      const sid = res.data.session_id;
      sessionIdRef.current    = sid;
      trendAlertShown.current = false;

      setLastSessionId(sid);
      setWindowLog([]);
      setProgress(0);
      setStats({ normal: 0, prestress: 0, stress: 0 });
      setCurrentPrediction(null);
      setRunning(true);

      intervalRef.current = setInterval(fetchNext, 2000);
    } catch (e) {
      Alert.alert(
        'Error',
        'Could not start simulation.\nIs the backend running?'
      );
    }
  };

  const fetchNext = async () => {
    try {
      const res  = await axios.post(
        `${API_BASE}/simulate/next`,
        { user_id: simUserIdRef.current }
      );
      const data = res.data;

      if (data.done) {
        clearInterval(intervalRef.current);
        setRunning(false);
        handleSimulationComplete();
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
        idx:         data.window_idx,
        prediction:  data.prediction,
        label:       data.label,
        raw_label:   data.raw_label,
        state:       data.state,
        true_label:  data.true_label,
        true_name:   data.true_name,
        trend_alert: data.trend_alert,
        hr:          data.features?.MeanHR?.toFixed(1),
        scl:         data.features?.SCL_mean?.toFixed(2),
        prob_pre:    data.probabilities?.prestress
          ? (data.probabilities.prestress * 100).toFixed(0)
          : '0',
      }]);

      pulse();

      if (data.trend_alert && !trendAlertShown.current) {
        trendAlertShown.current = true;
        Alert.alert(
          'Pre-Stress Detected',
          'Rising stress trend detected.\n' +
          'Stress is building — consider taking a break.',
          [{ text: 'OK' }]
        );
      }

      // Auto scroll log to bottom (newest window)
      setTimeout(() => {
        logScrollRef.current?.scrollToEnd({ animated: true });
      }, 100);

    } catch (e) {
      console.log('Fetch error:', e.message);
    }
  };

  const handleSimulationComplete = async () => {
    const sid    = sessionIdRef.current;
    const userId = simUserIdRef.current;

    try {
      await axios.post(
        `${API_BASE}/simulate/stop`,
        { user_id: userId }
      );
    } catch (e) {
      console.log('Stop error:', e.message);
    }

    try {
      const baselineRes = await axios.get(
        `${API_BASE}/baseline/${userId}`
      );

      if (!baselineRes.data?.exists) {
        Alert.alert(
          'Simulation Complete',
          `No baseline for ${userId}.\n` +
          'Run calibration to enable EMA updates.',
          [
            { text: 'Calibrate',
              onPress: () => navigation.navigate('Calibration') },
            { text: 'OK' }
          ]
        );
        return;
      }

      const emaRes = await axios.post(
        `${API_BASE}/ema/update`,
        { user_id: userId, session_id: sid }
      );

      setLastEmaResult(emaRes.data);

      Alert.alert(
        'Simulation Complete',
        `Session saved for ${userId}.\n` +
        'EMA baseline updated.',
        [
          { text: 'View EMA',
            onPress: () => navigation.navigate('EMA Update') },
          { text: 'PSS-4',
            onPress: () => navigation.navigate('PSS-4') },
          { text: 'OK' }
        ]
      );
    } catch (emaErr) {
      const errMsg =
        emaErr?.response?.data?.error || emaErr.message;
      console.log('EMA error:', errMsg);
      Alert.alert(
        'Simulation Complete',
        'Session saved. EMA update could not be computed.',
        [{ text: 'OK' }]
      );
    }
  };

  const stopSimulation = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    await handleSimulationComplete();
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const gaugeColor = currentPrediction
    ? STRESS_COLORS[currentPrediction.prediction]
    : '#334155';
  const gaugeEmoji = currentPrediction
    ? STRESS_EMOJI[currentPrediction.prediction]
    : '😴';
  const currentUserId = getSimulationUserId(selectedSubject);

  return (
    <View style={styles.container}>
      <ScrollView>

        {/* User badge */}
        <View style={styles.userBadge}>
          <Text style={styles.userBadgeText}>
            Simulating: {currentUserId}
          </Text>
        </View>

        {/* Gauge */}
        <View style={styles.gaugeContainer}>
          <Animated.View style={[
            styles.gauge,
            {
              borderColor: gaugeColor,
              transform: [{ scale: pulseAnim }]
            }
          ]}>
            <Text style={styles.gaugeEmoji}>{gaugeEmoji}</Text>
            <Text style={[styles.gaugeLabel,
              { color: gaugeColor }]}>
              {currentPrediction
                ? STRESS_LABELS[currentPrediction.prediction]
                : 'Ready'}
            </Text>
            {currentPrediction && (
              <>
                <Text style={styles.gaugeProb}>
                  Pre-stress:{' '}
                  {currentPrediction.probabilities?.prestress
                    ? (currentPrediction.probabilities
                        .prestress * 100).toFixed(0)
                    : 0}%
                </Text>
                <Text style={styles.gaugeState}>
                  State: {currentPrediction.state || 'Normal'}
                </Text>
              </>
            )}
          </Animated.View>

          {currentPrediction?.trend_alert && (
            <View style={styles.alertBanner}>
              <Text style={styles.alertIcon}>⚠️</Text>
              <View>
                <Text style={styles.alertTitle}>
                  Pre-Stress Trend Detected
                </Text>
                <Text style={styles.alertSub}>
                  Novel Contribution N1 — Early warning
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Progress */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, {
              width:           `${progress * 100}%`,
              backgroundColor: gaugeColor,
            }]} />
          </View>
          <Text style={styles.progressText}>
            {(progress * 100).toFixed(0)}% complete
            {'  '}W{currentPrediction?.window_idx ?? 0}
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatBox
            label="Normal"
            value={stats.normal}
            color="#22c55e"
          />
          <StatBox
            label="Pre-Stress"
            value={stats.prestress}
            color="#f59e0b"
          />
          <StatBox
            label="Stress"
            value={stats.stress}
            color="#ef4444"
          />
        </View>

        {/* Subject selector */}
        {!running && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Select Subject
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {[2,3,4,5,6,7,8,9,10,11,13,14,15,16,17]
                .map(sid => (
                <TouchableOpacity
                  key={sid}
                  style={[
                    styles.subjectBtn,
                    selectedSubject === sid &&
                      styles.subjectBtnActive
                  ]}
                  onPress={() => setSelectedSubject(sid)}
                >
                  <Text style={[
                    styles.subjectBtnText,
                    selectedSubject === sid &&
                      { color: '#fff' }
                  ]}>S{sid}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Control button */}
        <TouchableOpacity
          style={[
            styles.controlBtn,
            { backgroundColor: running
                ? '#ef4444'
                : '#6366f1' }
          ]}
          onPress={running ? stopSimulation : startSimulation}
        >
          <Text style={styles.controlBtnText}>
            {running
              ? 'Stop Simulation'
              : 'Start Simulation'}
          </Text>
        </TouchableOpacity>

        {/*  Sequence Timeline  */}
        {windowLog.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Stress Sequence Timeline
            </Text>
            <Text style={styles.cardSubtitleSmall}>
              Each block = one 60-second window
              — read left to right
            </Text>

            {/* Color blocks */}
            <View style={styles.timeline}>
              {windowLog.map((w, i) => (
                <View
                  key={i}
                  style={[
                    styles.timelineBlock,
                    {
                      backgroundColor:
                        STRESS_COLORS[w.prediction],
                      opacity: w.trend_alert ? 1 : 0.75,
                      borderWidth: w.trend_alert ? 1 : 0,
                      borderColor: '#fff'
                    }
                  ]}
                />
              ))}
            </View>

            {/* Legend */}
            <View style={styles.timelineLegend}>
              <LegendItem
                color="#22c55e" label="Normal" />
              <LegendItem
                color="#f59e0b" label="Pre-stress" />
              <LegendItem
                color="#ef4444" label="Stress" />
              <LegendItem
                color="#fff"
                label="Alert border"
                border />
            </View>

            {/* Phase summary */}
            {windowLog.length > 0 && (
              <PhaseSummary log={windowLog} />
            )}
          </View>
        )}

        {/*  Live Prediction Feed  */}
        {windowLog.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Live Prediction Feed
            </Text>
            <Text style={styles.cardSubtitleSmall}>
              Oldest → Newest (top to bottom)
              {'  '}|{'  '}
              {windowLog.length} windows total
              {'  '}|{'  '}
              {windowLog.filter(
                w => w.raw_label !== w.label
              ).length} SM overrides
            </Text>

            {/* Scrollable log — all windows */}
            <ScrollView
              ref={logScrollRef}
              style={styles.logScroll}
              showsVerticalScrollIndicator={true}
              onContentSizeChange={() =>
                logScrollRef.current?.scrollToEnd(
                  { animated: false }
                )
              }
            >
              {windowLog.map((w, i) => (
                <View key={i} style={[
                  styles.logRow,
                  w.prediction === 1 && styles.logRowPS,
                  w.trend_alert && styles.logRowAlert
                ]}>
                  <View style={[
                    styles.logDot,
                    { backgroundColor:
                        STRESS_COLORS[w.prediction] }
                  ]} />
                  <View style={styles.logContent}>
                    <Text style={styles.logText}>
                      W{w.idx} → {w.label}
                      {w.trend_alert ? '  ⚠️' : ''}
                    </Text>
                    <Text style={styles.logSub}>
                      HR:{w.hr}bpm
                      {'  '}SCL:{w.scl}μS
                      {'  '}Pre:{w.prob_pre}%
                      {'  '}{w.state}
                    </Text>
                    {w.raw_label !== w.label && (
                      <Text style={styles.logOverride}>
                        XGB:{w.raw_label} → SM:{w.label}
                      </Text>
                    )}
                  </View>
                  {w.prediction !== w.true_label && (
                    <Text style={styles.logTrue}>
                      true:{w.true_name}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>

          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// Phase Summary Component 
function PhaseSummary({ log }) {
  // Detect phase transitions
  const phases = [];
  let currentPhase = null;

  log.forEach((w, i) => {
    const label = STRESS_LABELS[w.prediction];
    if (!currentPhase || currentPhase.label !== label) {
      if (currentPhase) phases.push(currentPhase);
      currentPhase = {
        label,
        prediction: w.prediction,
        start:      w.idx,
        end:        w.idx,
        count:      1
      };
    } else {
      currentPhase.end = w.idx;
      currentPhase.count++;
    }
  });
  if (currentPhase) phases.push(currentPhase);

  return (
    <View style={styles.phaseSummary}>
      <Text style={styles.phaseSummaryTitle}>
        Phase Transitions
      </Text>
      <View style={styles.phaseRow}>
        {phases.map((p, i) => (
          <React.Fragment key={i}>
            <View style={[
              styles.phaseChip,
              { borderColor: STRESS_COLORS[p.prediction],
                backgroundColor:
                  STRESS_COLORS[p.prediction] + '22' }
            ]}>
              <Text style={[
                styles.phaseChipLabel,
                { color: STRESS_COLORS[p.prediction] }
              ]}>
                {p.label}
              </Text>
              <Text style={styles.phaseChipRange}>
                W{p.start}-W{p.end}
              </Text>
              <Text style={styles.phaseChipCount}>
                {p.count}w
              </Text>
            </View>
            {i < phases.length - 1 && (
              <Text style={styles.phaseArrow}>→</Text>
            )}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

//  Helper components 
function StatBox({ label, value, color }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function LegendItem({ color, label, border }) {
  return (
    <View style={styles.legendItem}>
      <View style={[
        styles.legendDot,
        {
          backgroundColor: border
            ? 'transparent'
            : color,
          borderWidth: border ? 1 : 0,
          borderColor: '#64748b'
        }
      ]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0f172a' },
  userBadge:          { backgroundColor: '#1e1b4b', margin: 16, marginBottom: 0, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#6366f1', alignItems: 'center' },
  userBadgeText:      { color: '#a5b4fc', fontSize: 13, fontWeight: '600' },
  gaugeContainer:     { alignItems: 'center', paddingVertical: 24 },
  gauge:              { width: 190, height: 190, borderRadius: 95, borderWidth: 6, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' },
  gaugeEmoji:         { fontSize: 44 },
  gaugeLabel:         { fontSize: 18, fontWeight: 'bold', marginTop: 6 },
  gaugeProb:          { fontSize: 11, color: '#64748b', marginTop: 3 },
  gaugeState:         { fontSize: 10, color: '#475569', marginTop: 2, fontStyle: 'italic' },
  alertBanner:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f59e0b22', borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 2, borderColor: '#f59e0b' },
  alertIcon:          { fontSize: 28 },
  alertTitle:         { color: '#f59e0b', fontWeight: '700', fontSize: 14 },
  alertSub:           { color: '#92400e', fontSize: 11, marginTop: 2 },
  progressContainer:  { paddingHorizontal: 24, marginBottom: 14 },
  progressBg:         { height: 8, backgroundColor: '#1e293b', borderRadius: 4 },
  progressFill:       { height: 8, borderRadius: 4 },
  progressText:       { color: '#64748b', fontSize: 11, marginTop: 5, textAlign: 'center' },
  statsRow:           { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 14 },
  statBox:            { flex: 1, backgroundColor: '#1e293b', borderRadius: 12, padding: 14, alignItems: 'center' },
  statValue:          { fontSize: 24, fontWeight: 'bold' },
  statLabel:          { fontSize: 11, color: '#64748b', marginTop: 4 },
  card:               { margin: 16, marginTop: 0, marginBottom: 14, padding: 16, backgroundColor: '#1e293b', borderRadius: 16 },
  cardTitle:          { fontSize: 15, fontWeight: '700', color: '#f1f5f9', marginBottom: 4 },
  cardSubtitleSmall:  { color: '#475569', fontSize: 10, fontStyle: 'italic', marginBottom: 10 },
  subjectBtn:         { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#0f172a', marginRight: 8, borderWidth: 1, borderColor: '#334155' },
  subjectBtnActive:   { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  subjectBtnText:     { color: '#64748b', fontWeight: '600' },
  controlBtn:         { margin: 16, padding: 18, borderRadius: 14, alignItems: 'center' },
  controlBtnText:     { color: '#fff', fontSize: 18, fontWeight: '700' },

  //  Timeline 
  timeline:           { flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 12 },
  timelineBlock:      { width: 9, height: 28, borderRadius: 2 },
  timelineLegend:     { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 10 },
  legendItem:         { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:          { width: 10, height: 10, borderRadius: 5 },
  legendText:         { color: '#64748b', fontSize: 11 },

  // Phase summary 
  phaseSummary:       { backgroundColor: '#0f172a', borderRadius: 10, padding: 12, marginTop: 4 },
  phaseSummaryTitle:  { color: '#64748b', fontSize: 11, marginBottom: 8 },
  phaseRow:           { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  phaseChip:          { borderRadius: 8, borderWidth: 1, padding: 8, alignItems: 'center', minWidth: 70 },
  phaseChipLabel:     { fontWeight: '700', fontSize: 11 },
  phaseChipRange:     { color: '#64748b', fontSize: 9, marginTop: 2 },
  phaseChipCount:     { color: '#475569', fontSize: 9 },
  phaseArrow:         { color: '#334155', fontSize: 14, fontWeight: 'bold' },

  // Log 
  logScroll:          { maxHeight: 320 },
  logRow:             { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  logRowPS:           { backgroundColor: '#f59e0b11' },
  logRowAlert:        { backgroundColor: '#f59e0b22' },
  logDot:             { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  logContent:         { flex: 1 },
  logText:            { color: '#f1f5f9', fontSize: 13 },
  logSub:             { color: '#64748b', fontSize: 10, marginTop: 2 },
  logOverride:        { color: '#f59e0b', fontSize: 10, fontStyle: 'italic', marginTop: 1 },
  logTrue:            { color: '#475569', fontSize: 10, fontStyle: 'italic', marginLeft: 6 },
});