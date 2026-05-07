import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Alert, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { API_BASE, USER_ID } from '../config/config';
import { useAppState } from './AppState';

export default function CalibrationScreen() {
  const { selectedSubject } = useAppState();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState('idle');
  const [timeLeft, setTimeLeft] = useState(120);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const intervalRef = useRef(null);

  const startCalibration = () => {
    setPhase('running');
    setTimeLeft(120);

    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 120000,
      useNativeDriver: false,
    }).start();

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          finishCalibration();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const finishCalibration = async () => {
    setPhase('done');
    try {
      await axios.post(`${API_BASE}/simulate/start`, {
        user_id: USER_ID,
        subject_id: selectedSubject,
      });

      const windows = [];
      for (let i = 0; i < 3; i++) {
        const w = await axios.post(`${API_BASE}/simulate/next`, { user_id: USER_ID });
        if (w.data && !w.data.done) {
          if (Array.isArray(w.data.features_array)) {
            windows.push(w.data.features_array);
          } else {
            windows.push(Object.values(w.data.features || {}));
          }
        }
      }
      await axios.post(`${API_BASE}/simulate/stop`, { user_id: USER_ID });

      await axios.post(`${API_BASE}/calibrate`, {
        user_id: USER_ID,
        windows,
      });

      Alert.alert(
        '✅ Calibration Complete',
        `Baseline captured from Subject S${selectedSubject} resting windows and saved to Firebase.`
      );
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.hint ||
        e?.message ||
        'Calibration failed.';
      Alert.alert('Calibration Failed', String(msg));
    }
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingBottom: 24 + insets.bottom + 60 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Baseline Calibration</Text>
        <Text style={styles.subtitle}>
          Sit quietly for 2 minutes while we measure your resting physiological state.
        </Text>

        <View style={styles.subjectBadge}>
          <Text style={styles.subjectBadgeText}>
            Using Subject S{selectedSubject} resting windows
          </Text>
        </View>

        <View style={styles.breathingContainer}>
          <Text style={styles.breathingEmoji}>
            {phase === 'idle' ? '😴' : phase === 'running' ? '🧘' : '✅'}
          </Text>
          <Text style={styles.breathingText}>
            {phase === 'idle' && 'Ready to calibrate'}
            {phase === 'running' && 'Breathe slowly and relax...'}
            {phase === 'done' && 'Calibration complete!'}
          </Text>
        </View>

        {phase === 'running' && (
          <View style={styles.timerContainer}>
            <Text style={styles.timerText}>{timeLeft}s remaining</Text>
            <View style={styles.progressBg}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
          </View>
        )}

        <View style={styles.instructionsCard}>
          <Text style={styles.instructionsTitle}>Instructions</Text>
          <Text style={styles.instruction}>1. Sit comfortably and relax</Text>
          <Text style={styles.instruction}>2. Breathe slowly and naturally</Text>
          <Text style={styles.instruction}>3. Avoid movement during calibration</Text>
          <Text style={styles.instruction}>4. This captures your personal resting baseline</Text>
          <Text style={styles.instruction}>5. Baseline updates via EMA after each session</Text>
        </View>

        {phase === 'idle' && (
          <TouchableOpacity style={styles.startBtn} onPress={startCalibration}>
            <Text style={styles.startBtnText}>Begin Calibration</Text>
          </TouchableOpacity>
        )}

        {phase === 'done' && (
          <View style={styles.doneCard}>
            <Text style={styles.doneText}>✅ Personal baseline saved to Firebase</Text>
            <Text style={styles.doneSubText}>EMA will update this after each session</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  container: { flexGrow: 1, backgroundColor: '#0f172a', padding: 24 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#f1f5f9', marginTop: 20 },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 8, lineHeight: 22 },
  subjectBadge: { backgroundColor: '#1e1b4b', borderRadius: 10, padding: 10, marginTop: 12, borderWidth: 1, borderColor: '#6366f1', alignSelf: 'flex-start' },
  subjectBadgeText: { color: '#a5b4fc', fontSize: 13, fontWeight: '600' },
  breathingContainer: { alignItems: 'center', paddingVertical: 40 },
  breathingEmoji: { fontSize: 72 },
  breathingText: { fontSize: 18, color: '#94a3b8', marginTop: 16, fontWeight: '500' },
  timerContainer: { marginBottom: 24 },
  timerText: { color: '#f1f5f9', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  progressBg: { height: 10, backgroundColor: '#1e293b', borderRadius: 5 },
  progressFill: { height: 10, backgroundColor: '#6366f1', borderRadius: 5 },
  instructionsCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 20, marginBottom: 24 },
  instructionsTitle: { color: '#f1f5f9', fontWeight: '700', fontSize: 16, marginBottom: 12 },
  instruction: { color: '#64748b', fontSize: 14, marginBottom: 8, lineHeight: 20 },
  startBtn: { backgroundColor: '#6366f1', padding: 18, borderRadius: 14, alignItems: 'center' },
  startBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  doneCard: { backgroundColor: '#22c55e22', borderRadius: 14, padding: 20, borderWidth: 1, borderColor: '#22c55e' },
  doneText: { color: '#22c55e', fontSize: 16, fontWeight: '700' },
  doneSubText: { color: '#64748b', fontSize: 13, marginTop: 6 },
});