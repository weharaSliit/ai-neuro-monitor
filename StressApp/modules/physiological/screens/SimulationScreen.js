import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Animated, Alert
} from 'react-native';
import axios from 'axios';
import { API_BASE, USER_ID, STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI } from '../config/config';
import { useAppState } from './AppState';

export default function SimulationScreen({ navigation }) {
  const { selectedSubject, setSelectedSubject,
          setLastSessionId, setLastEmaResult } = useAppState();

  const [running, setRunning]               = useState(false);
  const [sessionId, setSessionId]           = useState(null);
  const [currentPrediction, setCurrentPrediction] = useState(null);
  const [windowLog, setWindowLog]           = useState([]);
  const [progress, setProgress]             = useState(0);
  const [stats, setStats]                   = useState({ normal: 0, prestress: 0, stress: 0 });

  const intervalRef = useRef(null);
  const pulseAnim   = useRef(new Animated.Value(1)).current;

  const pulse = () => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.15, duration: 300, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 300, useNativeDriver: true }),
    ]).start();
  };

  const startSimulation = async () => {
    try {
      const res = await axios.post(`${API_BASE}/simulate/start`, {
        user_id:    USER_ID,
        subject_id: selectedSubject,
      });
      const sid = res.data.session_id;
      setSessionId(sid);
      setLastSessionId(sid);
      setWindowLog([]);
      setProgress(0);
      setStats({ normal: 0, prestress: 0, stress: 0 });
      setRunning(true);
      intervalRef.current = setInterval(fetchNext, 2000);
    } catch (e) {
      Alert.alert('Error', 'Could not start simulation. Is the backend running?');
    }
  };

  const fetchNext = async () => {
    try {
      const res  = await axios.post(`${API_BASE}/simulate/next`, { user_id: USER_ID });
      const data = res.data;

      if (data.done) {
        stopSimulation();
        Alert.alert('Complete', 'Simulation finished. Please fill in the PSS-4 questionnaire.');
        return;
      }

      setCurrentPrediction(data);
      setProgress(data.progress);

      setStats(prev => ({
        normal:    prev.normal    + (data.prediction === 0 ? 1 : 0),
        prestress: prev.prestress + (data.prediction === 1 ? 1 : 0),
        stress:    prev.stress    + (data.prediction === 2 ? 1 : 0),
      }));

      setWindowLog(prev => [{
        idx:         data.window_idx,
        prediction:  data.prediction,
        label:       data.label,
        true_label:  data.true_label,
        true_name:   data.true_name,
        trend_alert: data.trend_alert,
        hr:          data.features?.MeanHR?.toFixed(1),
        scl:         data.features?.SCL_mean?.toFixed(2),
        prob_pre:    (data.probabilities?.prestress * 100).toFixed(0),
      }, ...prev].slice(0, 30));

      pulse();

      if (data.trend_alert) {
        Alert.alert(
          '⚠️ Pre-Stress Detected',
          'Rising stress trend detected across 5 consecutive windows. Stress building up.',
          [{ text: 'OK' }]
        );
      }
    } catch (e) {
      console.log('Fetch error:', e.message);
    }
  };

  const stopSimulation = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    try {
      await axios.post(`${API_BASE}/simulate/stop`, { user_id: USER_ID });

      // Trigger EMA update after session ends
      if (sessionId) {
        try {
          const baselineRes = await axios.get(`${API_BASE}/baseline/${USER_ID}`);
          if (!baselineRes.data?.exists) {
            console.log('EMA skipped: no baseline found. Calibrate first.');
            return;
          }
          const emaRes = await axios.post(`${API_BASE}/ema/update`, {
            user_id:    USER_ID,
            session_id: sessionId,
          });
          setLastEmaResult(emaRes.data);
          navigation.navigate('EMA Update');
        } catch (emaErr) {
          const errMsg = emaErr?.response?.data?.error || emaErr.message;
          console.log('EMA update error:', errMsg);
        }
      }
    } catch (e) {
      console.log('Stop error:', e.message);
    }
  };

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const gaugeColor = currentPrediction ? STRESS_COLORS[currentPrediction.prediction] : '#334155';
  const gaugeEmoji = currentPrediction ? STRESS_EMOJI[currentPrediction.prediction] : '😴';

  return (
    <View style={styles.container}>
      <ScrollView>
        {/* Stress Gauge */}
        <View style={styles.gaugeContainer}>
          <Animated.View style={[
            styles.gauge,
            { borderColor: gaugeColor, transform: [{ scale: pulseAnim }] }
          ]}>
            <Text style={styles.gaugeEmoji}>{gaugeEmoji}</Text>
            <Text style={[styles.gaugeLabel, { color: gaugeColor }]}>
              {currentPrediction ? STRESS_LABELS[currentPrediction.prediction] : 'Ready'}
            </Text>
            {currentPrediction && (
              <Text style={styles.gaugeProb}>
                Pre-stress: {currentPrediction.probabilities?.prestress
                  ? (currentPrediction.probabilities.prestress * 100).toFixed(0)
                  : 0}%
              </Text>
            )}
          </Animated.View>

          {currentPrediction?.trend_alert && (
            <View style={styles.alertBanner}>
              <Text style={styles.alertText}>⚠️ TREND ALERT — Stress Building</Text>
            </View>
          )}
        </View>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, {
              width: `${progress * 100}%`,
              backgroundColor: gaugeColor
            }]} />
          </View>
          <Text style={styles.progressText}>
            {(progress * 100).toFixed(0)}% complete
          </Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <StatBox label="Normal"     value={stats.normal}    color="#22c55e" />
          <StatBox label="Pre-Stress" value={stats.prestress} color="#f59e0b" />
          <StatBox label="Stress"     value={stats.stress}    color="#ef4444" />
        </View>

        {/* Subject Selector */}
        {!running && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Select Subject</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {[2,3,4,5,6,7,8,9,10,11,13,14,15,16,17].map(sid => (
                <TouchableOpacity
                  key={sid}
                  style={[
                    styles.subjectBtn,
                    selectedSubject === sid && styles.subjectBtnActive
                  ]}
                  onPress={() => setSelectedSubject(sid)}
                >
                  <Text style={[
                    styles.subjectBtnText,
                    selectedSubject === sid && { color: '#fff' }
                  ]}>S{sid}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Control Button */}
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: running ? '#ef4444' : '#6366f1' }]}
          onPress={running ? stopSimulation : startSimulation}
        >
          <Text style={styles.controlBtnText}>
            {running ? '⏹  Stop Simulation' : '▶️  Start Simulation'}
          </Text>
        </TouchableOpacity>

        {/* Window Log */}
        {windowLog.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Live Prediction Feed</Text>
            {windowLog.map((w, i) => (
              <View key={i} style={styles.logRow}>
                <View style={[styles.logDot, { backgroundColor: STRESS_COLORS[w.prediction] }]} />
                <Text style={styles.logText}>
                  W{w.idx} → {w.label}{w.trend_alert ? ' ⚠️' : ''}
                </Text>
                <Text style={styles.logSub}>HR:{w.hr} SCL:{w.scl}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function StatBox({ label, value, color }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#0f172a' },
  gaugeContainer:    { alignItems: 'center', paddingVertical: 30 },
  gauge:             { width: 200, height: 200, borderRadius: 100, borderWidth: 6, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' },
  gaugeEmoji:        { fontSize: 48 },
  gaugeLabel:        { fontSize: 20, fontWeight: 'bold', marginTop: 8 },
  gaugeProb:         { fontSize: 12, color: '#64748b', marginTop: 4 },
  alertBanner:       { backgroundColor: '#f59e0b22', borderRadius: 10, padding: 10, marginTop: 16, borderWidth: 1, borderColor: '#f59e0b' },
  alertText:         { color: '#f59e0b', fontWeight: '700', fontSize: 14 },
  progressContainer: { paddingHorizontal: 24, marginBottom: 16 },
  progressBg:        { height: 8, backgroundColor: '#1e293b', borderRadius: 4 },
  progressFill:      { height: 8, borderRadius: 4 },
  progressText:      { color: '#64748b', fontSize: 12, marginTop: 6, textAlign: 'center' },
  statsRow:          { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  statBox:           { flex: 1, backgroundColor: '#1e293b', borderRadius: 12, padding: 14, alignItems: 'center' },
  statValue:         { fontSize: 24, fontWeight: 'bold' },
  statLabel:         { fontSize: 11, color: '#64748b', marginTop: 4 },
  card:              { margin: 16, marginTop: 0, padding: 20, backgroundColor: '#1e293b', borderRadius: 16 },
  cardTitle:         { fontSize: 16, fontWeight: '700', color: '#f1f5f9', marginBottom: 14 },
  subjectBtn:        { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#0f172a', marginRight: 8, borderWidth: 1, borderColor: '#334155' },
  subjectBtnActive:  { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  subjectBtnText:    { color: '#64748b', fontWeight: '600' },
  controlBtn:        { margin: 16, padding: 18, borderRadius: 14, alignItems: 'center' },
  controlBtnText:    { color: '#fff', fontSize: 18, fontWeight: '700' },
  logRow:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  logDot:            { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  logText:           { color: '#f1f5f9', fontSize: 13, flex: 1 },
  logSub:            { color: '#64748b', fontSize: 11 },
});