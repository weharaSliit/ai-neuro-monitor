import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Alert, ScrollView
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import { API_BASE, getSimulationUserId } from '../config/config';
import { useAppState } from './AppState';

function BreathingCircle({ phase, color }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacAnim  = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (phase === 'running') {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scaleAnim, { toValue: 1.3, duration: 4000, useNativeDriver: true }),
            Animated.timing(opacAnim,  { toValue: 1,   duration: 4000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scaleAnim, { toValue: 1,   duration: 4000, useNativeDriver: true }),
            Animated.timing(opacAnim,  { toValue: 0.5, duration: 4000, useNativeDriver: true }),
          ]),
        ])
      ).start();
    } else {
      scaleAnim.stopAnimation();
      opacAnim.stopAnimation();
    }
  }, [phase]);

  return (
    <View style={styles.breathingWrapper}>
      {/* Outer pulse rings */}
      <Animated.View style={[styles.breathRing3, { borderColor: color + '20', transform: [{ scale: scaleAnim }] }]} />
      <Animated.View style={[styles.breathRing2, { borderColor: color + '40', transform: [{ scale: scaleAnim }] }]} />
      <Animated.View style={[styles.breathRing1, { borderColor: color + '80', opacity: opacAnim }]} />

      {/* Center */}
      <Animated.View style={[styles.breathCenter, {
        backgroundColor: color + '20',
        borderColor:     color,
        transform:       [{ scale: scaleAnim }],
        opacity:         opacAnim,
      }]}>
        <Text style={styles.breathEmoji}>
          {phase === 'idle' ? '😴' : phase === 'running' ? '🧘' : '✅'}
        </Text>
        <Text style={[styles.breathLabel, { color }]}>
          {phase === 'idle' ? 'Ready' : phase === 'running' ? 'Breathe...' : 'Complete'}
        </Text>
      </Animated.View>
    </View>
  );
}

export default function CalibrationScreen() {
  const { isDark, theme }      = useTheme();
  const { selectedSubject }    = useAppState();
  const insets                 = useSafeAreaInsets();

  const [phase,    setPhase]    = useState('idle');
  const [timeLeft, setTimeLeft] = useState(120);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const intervalRef  = useRef(null);
  const selectedSubjectRef = useRef(selectedSubject);

  useEffect(() => {
    selectedSubjectRef.current = selectedSubject;
    if (phase === 'idle') { progressAnim.setValue(0); setTimeLeft(120); }
  }, [selectedSubject]);

  const bg     = isDark ? '#060d1a' : '#f0f9ff';
  const card   = isDark ? '#0f1f35' : '#ffffff';
  const border = isDark ? '#1e3a5f' : '#e2e8f0';
  const text   = theme.text;
  const muted  = theme.textMuted;
  const color  = phase === 'done' ? '#10b981' : '#6366f1';

  const startCalibration = () => {
    setPhase('running');
    setTimeLeft(120);
    progressAnim.setValue(0);
    Animated.timing(progressAnim, { toValue: 1, duration: 120000, useNativeDriver: false }).start();
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(intervalRef.current); finishCalibration(); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const finishCalibration = async () => {
    setPhase('done');
    const currentSubject = selectedSubjectRef.current;
    const userId         = getSimulationUserId(currentSubject);
    try {
      await axios.post(`${API_BASE}/simulate/start`, { user_id: userId, subject_id: currentSubject });
      const windows = [];
      for (let i = 0; i < 3; i++) {
        const w = await axios.post(`${API_BASE}/simulate/next`, { user_id: userId });
        if (w.data && !w.data.done && Array.isArray(w.data.features_array) && w.data.features_array.length === 22) {
          windows.push(w.data.features_array);
        }
      }
      await axios.post(`${API_BASE}/simulate/stop`, { user_id: userId });
      if (windows.length === 0) {
        Alert.alert('Calibration Failed', 'Could not retrieve resting windows. Try again.');
        setPhase('idle'); return;
      }
      const calRes = await axios.post(`${API_BASE}/calibrate`, { user_id: userId, windows });
      if (calRes.data?.success) {
        Alert.alert('✅ Calibration Complete',
          `Subject S${currentSubject} baseline saved.\nAVNN: ${calRes.data.sample_values?.AVNN_mean?.toFixed(1)} ms`);
      }
    } catch (e) {
      Alert.alert('Calibration Failed', e?.response?.data?.error || e.message);
      setPhase('idle');
    }
  };

  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  const progressWidth = progressAnim.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] });
  const displayUserId = getSimulationUserId(selectedSubject);

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 24 + insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: text }]}>Baseline Calibration</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            Capture your personal resting physiological state
          </Text>
        </View>

        {/* Subject badge */}
        <View style={[styles.subjectBadge, { backgroundColor: card, borderColor: border }]}>
          <View style={[styles.subjectIcon, { backgroundColor: '#6366f120' }]}>
            <Text>🎯</Text>
          </View>
          <View>
            <Text style={[styles.subjectLabel, { color: muted }]}>Calibrating for</Text>
            <Text style={[styles.subjectValue, { color: '#818cf8' }]}>
              Subject S{selectedSubject} · {displayUserId}
            </Text>
          </View>
          <View style={[styles.noveltyBadge, { backgroundColor: '#6366f115', borderColor: '#6366f140' }]}>
            <Text style={styles.noveltyText}>N3</Text>
          </View>
        </View>

        {/* Breathing animation */}
        <BreathingCircle phase={phase} color={color} />

        {/* Timer */}
        {phase === 'running' && (
          <View style={[styles.timerCard, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.timerText, { color: '#6366f1' }]}>
              {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
            </Text>
            <Text style={[styles.timerSub, { color: muted }]}>remaining</Text>
            <View style={[styles.progressBg, { backgroundColor: isDark ? '#1e3a5f' : '#e2e8f0' }]}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
          </View>
        )}

        {/* Instructions */}
        <View style={[styles.instructionsCard, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.instructionsTitle, { color: text }]}>Instructions</Text>
          {[
            ['😌', 'Sit comfortably and relax your body'],
            ['🌬️', 'Breathe slowly and naturally'],
            ['🤫', 'Avoid talking or moving'],
            ['📱', 'Keep phone still during calibration'],
            ['🔄', 'EMA will update baseline after each session'],
          ].map(([icon, txt], i) => (
            <View key={i} style={styles.instructionRow}>
              <Text style={{ fontSize: 16 }}>{icon}</Text>
              <Text style={[styles.instructionText, { color: muted }]}>{txt}</Text>
            </View>
          ))}
        </View>

        {/* EMA explanation */}
        <View style={[styles.emaCard, { backgroundColor: '#6366f110', borderColor: '#6366f130' }]}>
          <Text style={[styles.emaTitle, { color: '#818cf8' }]}>How EMA Works (N4)</Text>
          <Text style={[styles.emaText, { color: muted }]}>
            After each session: new = 0.2 × session + 0.8 × previous{'\n'}
            Your baseline adapts gradually over 10–15 sessions
          </Text>
        </View>

        {/* Buttons */}
        {phase === 'idle' && (
          <TouchableOpacity style={styles.startBtn} onPress={startCalibration} activeOpacity={0.85}>
            <Text style={styles.startBtnText}>🎯  Begin Calibration</Text>
          </TouchableOpacity>
        )}

        {phase === 'done' && (
          <View>
            <View style={[styles.doneCard, { backgroundColor: '#10b98115', borderColor: '#10b98140' }]}>
              <Text style={styles.doneIcon}>✅</Text>
              <Text style={styles.doneTitle}>Baseline Saved to Firebase</Text>
              <Text style={[styles.doneSub, { color: muted }]}>
                EMA will update this baseline after each simulation session
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.recalBtn, { backgroundColor: card, borderColor: border }]}
              onPress={() => { progressAnim.setValue(0); setPhase('idle'); setTimeLeft(120); }}
            >
              <Text style={[styles.recalText, { color: muted }]}>↺  Recalibrate</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  container:         { flexGrow: 1, padding: 20 },
  header:            { marginBottom: 16 },
  title:             { fontSize: 26, fontWeight: '900' },
  subtitle:          { fontSize: 13, marginTop: 4 },
  subjectBadge:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 20 },
  subjectIcon:       { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  subjectLabel:      { fontSize: 11 },
  subjectValue:      { fontSize: 14, fontWeight: '800' },
  noveltyBadge:      { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  noveltyText:       { color: '#818cf8', fontSize: 12, fontWeight: '800' },
  breathingWrapper:  { alignItems: 'center', justifyContent: 'center', height: 220, marginBottom: 16 },
  breathRing3:       { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 1 },
  breathRing2:       { position: 'absolute', width: 170, height: 170, borderRadius: 85, borderWidth: 1 },
  breathRing1:       { position: 'absolute', width: 140, height: 140, borderRadius: 70, borderWidth: 2 },
  breathCenter:      { width: 110, height: 110, borderRadius: 55, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  breathEmoji:       { fontSize: 36 },
  breathLabel:       { fontSize: 13, fontWeight: '700', marginTop: 4 },
  timerCard:         { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 16 },
  timerText:         { fontSize: 48, fontWeight: '900', letterSpacing: 2 },
  timerSub:          { fontSize: 12, marginTop: 2, marginBottom: 12 },
  progressBg:        { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill:      { height: 6, borderRadius: 3, backgroundColor: '#6366f1' },
  instructionsCard:  { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  instructionsTitle: { fontSize: 15, fontWeight: '800', marginBottom: 12 },
  instructionRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  instructionText:   { fontSize: 13, flex: 1, lineHeight: 20 },
  emaCard:           { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 20 },
  emaTitle:          { fontSize: 13, fontWeight: '800', marginBottom: 6 },
  emaText:           { fontSize: 12, lineHeight: 20 },
  startBtn:          { backgroundColor: '#6366f1', padding: 18, borderRadius: 16, alignItems: 'center' },
  startBtnText:      { color: '#fff', fontSize: 17, fontWeight: '800' },
  doneCard:          { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 12 },
  doneIcon:          { fontSize: 40, marginBottom: 8 },
  doneTitle:         { fontSize: 16, fontWeight: '800', color: '#10b981' },
  doneSub:           { fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  recalBtn:          { borderRadius: 14, borderWidth: 1, padding: 14, alignItems: 'center' },
  recalText:         { fontSize: 14, fontWeight: '600' },
});