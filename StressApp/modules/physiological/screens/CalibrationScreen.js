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

function BreathingOrb({ phase, color }) {
  const scale1 = useRef(new Animated.Value(1)).current;
  const scale2 = useRef(new Animated.Value(1)).current;
  const scale3 = useRef(new Animated.Value(1)).current;
  const opac   = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (phase === 'running') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scale1, { toValue: 1.35, duration: 4000, useNativeDriver: true }),
            Animated.timing(scale2, { toValue: 1.6,  duration: 4000, useNativeDriver: true }),
            Animated.timing(scale3, { toValue: 1.9,  duration: 4000, useNativeDriver: true }),
            Animated.timing(opac,   { toValue: 1,    duration: 4000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scale1, { toValue: 1,    duration: 4000, useNativeDriver: true }),
            Animated.timing(scale2, { toValue: 1,    duration: 4000, useNativeDriver: true }),
            Animated.timing(scale3, { toValue: 1,    duration: 4000, useNativeDriver: true }),
            Animated.timing(opac,   { toValue: 0.5,  duration: 4000, useNativeDriver: true }),
          ]),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [phase]);

  return (
    <View style={cStyles.orbWrap}>
      <Animated.View style={[cStyles.ring3, { borderColor: color + '12', transform: [{ scale: scale3 }] }]} />
      <Animated.View style={[cStyles.ring2, { borderColor: color + '28', transform: [{ scale: scale2 }] }]} />
      <Animated.View style={[cStyles.ring1, { borderColor: color + '55', transform: [{ scale: scale1 }] }]} />
      <Animated.View style={[cStyles.orb, {
        backgroundColor: color + '18',
        borderColor: color,
        opacity: opac,
        transform: [{ scale: scale1 }],
      }]}>
        <Text style={cStyles.orbEmoji}>
          {phase === 'idle' ? '😴' : phase === 'running' ? '🧘' : '✅'}
        </Text>
        <Text style={[cStyles.orbLabel, { color }]}>
          {phase === 'idle' ? 'Ready' : phase === 'running' ? 'Breathe...' : 'Done'}
        </Text>
      </Animated.View>
    </View>
  );
}

export default function CalibrationScreen() {
  const { isDark, theme, COLORS } = useTheme();
  const { selectedSubject }       = useAppState();
  const insets                    = useSafeAreaInsets();

  const [phase,    setPhase]    = useState('idle');
  const [timeLeft, setTimeLeft] = useState(120);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const intervalRef  = useRef(null);
  const subjectRef   = useRef(selectedSubject);

  useEffect(() => {
    subjectRef.current = selectedSubject;
    if (phase === 'idle') { progressAnim.setValue(0); setTimeLeft(120); }
  }, [selectedSubject]);

  const t     = theme;
  const color = phase === 'done' ? COLORS.normal : COLORS.brand;
  const uid   = getSimulationUserId(selectedSubject);

  const startCal = () => {
    setPhase('running'); setTimeLeft(120); progressAnim.setValue(0);
    Animated.timing(progressAnim, { toValue: 1, duration: 120000, useNativeDriver: false }).start();
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(intervalRef.current); finishCal(); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const finishCal = async () => {
    setPhase('done');
    const sub    = subjectRef.current;
    const userId = getSimulationUserId(sub);
    try {
      await axios.post(`${API_BASE}/simulate/start`, { user_id: userId, subject_id: sub });
      const windows = [];
      for (let i = 0; i < 3; i++) {
        const w = await axios.post(`${API_BASE}/simulate/next`, { user_id: userId });
        if (w.data && !w.data.done && Array.isArray(w.data.features_array) && w.data.features_array.length === 22)
          windows.push(w.data.features_array);
      }
      await axios.post(`${API_BASE}/simulate/stop`, { user_id: userId });
      if (!windows.length) { Alert.alert('Failed', 'No resting windows found.'); setPhase('idle'); return; }
      const res = await axios.post(`${API_BASE}/calibrate`, { user_id: userId, windows });
      if (res.data?.success)
        Alert.alert('✅ Calibrated', `Baseline saved for ${userId}\nAVNN: ${res.data.sample_values?.AVNN_mean?.toFixed(1)} ms`);
    } catch (e) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
      setPhase('idle');
    }
  };

  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  const progressWidth = progressAnim.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] });
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  return (
    <SafeAreaView style={[cStyles.safe, { backgroundColor: t.bg }]}>
      <ScrollView
        contentContainerStyle={[cStyles.scroll, { paddingBottom: 24 + insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={cStyles.header}>
          <Text style={[cStyles.title, { color: t.text }]}>Baseline Calibration</Text>
          <Text style={[cStyles.sub, { color: t.textMuted }]}>
            Capture your personal resting physiological state
          </Text>
        </View>

        {/* Subject badge */}
        <View style={[cStyles.subjectBadge, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={[cStyles.subjectIconBox, { backgroundColor: COLORS.brand + '18' }]}>
            <Text style={{ fontSize: 16 }}>🎯</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[cStyles.subjectLabel, { color: t.textMuted }]}>Calibrating for</Text>
            <Text style={[cStyles.subjectValue, { color: COLORS.brandLight }]}>
              Subject S{selectedSubject} · {uid}
            </Text>
          </View>
          <View style={[cStyles.n3Badge, { backgroundColor: COLORS.brand + '18', borderColor: COLORS.brand + '30' }]}>
            <Text style={[cStyles.n3Text, { color: COLORS.brandLight }]}>N3</Text>
          </View>
        </View>

        {/* Breathing orb */}
        <BreathingOrb phase={phase} color={color} />

        {/* Timer */}
        {phase === 'running' && (
          <View style={[cStyles.timerCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[cStyles.timerText, { color: COLORS.brand }]}>
              {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
            </Text>
            <Text style={[cStyles.timerSub, { color: t.textMuted }]}>remaining</Text>
            <View style={[cStyles.progBg, { backgroundColor: isDark ? COLORS.brand + '20' : COLORS.brand + '15' }]}>
              <Animated.View style={[cStyles.progFill, { width: progressWidth, backgroundColor: COLORS.brand }]} />
            </View>
          </View>
        )}

        {/* Instructions */}
        <View style={[cStyles.infoCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[cStyles.infoTitle, { color: t.text }]}>Instructions</Text>
          {[
            ['😌','Sit comfortably and relax your body'],
            ['🌬️','Breathe slowly and naturally'],
            ['🤫','Avoid talking or moving'],
            ['📱','Keep phone still during calibration'],
            ['🔄','EMA updates baseline after each session'],
          ].map(([icon, txt], i) => (
            <View key={i} style={cStyles.infoRow}>
              <Text style={{ fontSize: 15 }}>{icon}</Text>
              <Text style={[cStyles.infoText, { color: t.textMuted }]}>{txt}</Text>
            </View>
          ))}
        </View>

        {/* EMA formula */}
        <View style={[cStyles.emaCard, { backgroundColor: COLORS.brand + '0d', borderColor: COLORS.brand + '25' }]}>
          <Text style={[cStyles.emaTitle, { color: COLORS.brandLight }]}>EMA Continual Learning (N4)</Text>
          <Text style={[cStyles.emaText, { color: t.textMuted }]}>
            new = 0.2 × session + 0.8 × previous{'\n'}
            Adapts gradually over 10–15 real sessions
          </Text>
        </View>

        {/* Buttons */}
        {phase === 'idle' && (
          <TouchableOpacity style={[cStyles.startBtn, { backgroundColor: COLORS.brand }]} onPress={startCal} activeOpacity={0.87}>
            <Text style={cStyles.startBtnText}>🎯  Begin Calibration</Text>
          </TouchableOpacity>
        )}

        {phase === 'done' && (
          <View>
            <View style={[cStyles.doneCard, { backgroundColor: COLORS.normal + '10', borderColor: COLORS.normal + '30' }]}>
              <Text style={cStyles.doneEmoji}>✅</Text>
              <Text style={[cStyles.doneTitle, { color: COLORS.normal }]}>Baseline Saved to Firebase</Text>
              <Text style={[cStyles.doneSub, { color: t.textMuted }]}>
                EMA will update {uid} after each session
              </Text>
            </View>
            <TouchableOpacity
              style={[cStyles.recalBtn, { backgroundColor: t.card, borderColor: t.border }]}
              onPress={() => { progressAnim.setValue(0); setPhase('idle'); setTimeLeft(120); }}
            >
              <Text style={[cStyles.recalText, { color: t.textMuted }]}>↺  Recalibrate</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const cStyles = StyleSheet.create({
  safe:          { flex: 1 },
  scroll:        { flexGrow: 1, padding: 20 },
  header:        { marginBottom: 16 },
  title:         { fontSize: 26, fontWeight: '900' },
  sub:           { fontSize: 13, marginTop: 4 },
  subjectBadge:  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, marginBottom: 20 },
  subjectIconBox:{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  subjectLabel:  { fontSize: 11 },
  subjectValue:  { fontSize: 14, fontWeight: '800' },
  n3Badge:       { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1 },
  n3Text:        { fontSize: 12, fontWeight: '800' },
  orbWrap:       { alignItems: 'center', justifyContent: 'center', height: 230, marginBottom: 16 },
  ring3:         { position: 'absolute', width: 210, height: 210, borderRadius: 105, borderWidth: 1 },
  ring2:         { position: 'absolute', width: 175, height: 175, borderRadius: 88,  borderWidth: 1 },
  ring1:         { position: 'absolute', width: 145, height: 145, borderRadius: 73,  borderWidth: 2 },
  orb:           { width: 112, height: 112, borderRadius: 56, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  orbEmoji:      { fontSize: 38 },
  orbLabel:      { fontSize: 13, fontWeight: '700', marginTop: 4 },
  timerCard:     { borderRadius: 18, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 16 },
  timerText:     { fontSize: 48, fontWeight: '900', letterSpacing: 3 },
  timerSub:      { fontSize: 12, marginTop: 2, marginBottom: 12 },
  progBg:        { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  progFill:      { height: 6, borderRadius: 3 },
  infoCard:      { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
  infoTitle:     { fontSize: 15, fontWeight: '800', marginBottom: 12 },
  infoRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  infoText:      { fontSize: 13, flex: 1, lineHeight: 20 },
  emaCard:       { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 20 },
  emaTitle:      { fontSize: 13, fontWeight: '800', marginBottom: 6 },
  emaText:       { fontSize: 12, lineHeight: 20 },
  startBtn:      { padding: 18, borderRadius: 18, alignItems: 'center' },
  startBtnText:  { color: '#fff', fontSize: 17, fontWeight: '800' },
  doneCard:      { borderRadius: 18, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 12 },
  doneEmoji:     { fontSize: 40, marginBottom: 8 },
  doneTitle:     { fontSize: 16, fontWeight: '800' },
  doneSub:       { fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  recalBtn:      { borderRadius: 14, borderWidth: 1, padding: 14, alignItems: 'center' },
  recalText:     { fontSize: 14, fontWeight: '600' },
});