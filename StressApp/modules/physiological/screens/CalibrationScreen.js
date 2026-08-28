import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert
} from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import api from '../api/client';

const STEPS = [
  { key: 'settling',  label: 'Settling',      hint: 'Electrode contact stabilizing (~30s)' },
  { key: 'capturing', label: 'Capturing',      hint: 'Sit still and relaxed (~1 min per window, 3 windows)' },
  { key: 'saving',    label: 'Saving',        hint: 'Computing your personal baseline' },
  { key: 'done',      label: 'Done',          hint: 'Baseline saved' },
];

const IN_PROGRESS_STATUSES = ['settling', 'capturing', 'saving'];

export default function CalibrationScreen() {
  const { theme, COLORS } = useTheme();
  const { user } = useAuth();
  const userId = user?.userId;

  const [baseline, setBaseline]   = useState(null);
  const [phase, setPhase]         = useState('idle'); // idle|settling|capturing|saving|done|error
  const [windowIdx, setWindowIdx] = useState(0);
  const [nWindows, setNWindows]   = useState(3);
  const [errorMsg, setErrorMsg]   = useState(null);
  const pollRef = useRef(null);

  const bg     = theme.bg;
  const card   = theme.card;
  const border = theme.border;
  const text   = theme.text;
  const muted  = theme.textMuted;

  const loadBaseline = async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/baseline/${userId}`);
      setBaseline(res.data);
    } catch (e) {
      console.log('Baseline load error:', e.message);
    }
  };

  const applyStatus = (data) => {
    setPhase(data.status || 'idle');
    if (data.window_idx != null) setWindowIdx(data.window_idx);
    if (data.n_windows != null) setNWindows(data.n_windows);
    if (data.status === 'error') setErrorMsg(data.error || 'Calibration failed');
    if (data.status === 'done') {
      setErrorMsg(null);
      loadBaseline();
    }
  };

  const pollStatus = useCallback(async () => {
    try {
      const res = await api.get('/calibrate/status');
      applyStatus(res.data);
      return res.data.status;
    } catch (e) {
      return null;
    }
  }, []);

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const status = await pollStatus();
      if (status && !IN_PROGRESS_STATUSES.includes(status)) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 2000);
  };

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useFocusEffect(useCallback(() => {
    loadBaseline();
    // Resume watching if a capture was already running (e.g. navigated
    // away mid-capture and came back).
    pollStatus().then((status) => {
      if (status && IN_PROGRESS_STATUSES.includes(status)) startPolling();
    });
  }, [userId]));

  const start = async () => {
    setErrorMsg(null);
    setWindowIdx(0);
    try {
      await api.post('/calibrate/start', {});
      setPhase('settling');
      startPolling();
    } catch (e) {
      if (e?.response?.status === 409) {
        // Already running somewhere — just start watching it.
        startPolling();
        return;
      }
      Alert.alert('Could not start calibration', e?.response?.data?.error || e.message);
    }
  };

  const inProgress = IN_PROGRESS_STATUSES.includes(phase);
  const stepIndex = STEPS.findIndex(s => s.key === phase);

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        <Text style={[styles.title, { color: text }]}>Calibration</Text>
        <Text style={[styles.subtitle, { color: muted }]}>
          Establishes your personal resting baseline — the model compares
          future readings against this, not a generic average.
        </Text>

        {/* Current status -- plain language only, no raw sensor numbers.
            age_days/is_stale_soft/is_stale_hard already come back from
            GET /baseline/<user_id> (see backend/physiological/app.py). */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: text }]}>Current Baseline</Text>
          {baseline?.exists ? (
            <Text style={[styles.statusLine, { color: baseline.is_stale_soft ? COLORS.warning : COLORS.normal }]}>
              {baseline.is_stale_hard
                ? '⚠ Your baseline needs renewing'
                : baseline.is_stale_soft
                  ? `✓ Baseline is set — ${Math.floor(baseline.age_days ?? 0)} days old, renew when convenient`
                  : '✓ Baseline is set and up to date'}
            </Text>
          ) : (
            <Text style={[styles.statusLine, { color: COLORS.warning }]}>No baseline yet</Text>
          )}
        </View>

        {/* Progress / start */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          {inProgress || phase === 'done' ? (
            <>
              <Text style={[styles.cardTitle, { color: text }]}>
                {phase === 'done' ? 'Calibration Complete' : 'Calibrating…'}
              </Text>
              <View style={styles.stepperRow}>
                {STEPS.map((s, i) => (
                  <View key={s.key} style={styles.stepDotWrap}>
                    <View style={[
                      styles.stepDot,
                      { borderColor: border },
                      i < stepIndex && { backgroundColor: COLORS.normal, borderColor: COLORS.normal },
                      i === stepIndex && { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
                    ]} />
                    {i < STEPS.length - 1 && (
                      <View style={[styles.stepLine, { backgroundColor: i < stepIndex ? COLORS.normal : border }]} />
                    )}
                  </View>
                ))}
              </View>
              <Text style={[styles.stepLabel, { color: text }]}>
                {STEPS[stepIndex]?.label || 'Working…'}
                {phase === 'capturing' ? ` (${windowIdx}/${nWindows})` : ''}
              </Text>
              <Text style={[styles.stepHint, { color: muted }]}>{STEPS[stepIndex]?.hint}</Text>
              {inProgress && (
                <View style={styles.spinnerRow}>
                  <ActivityIndicator color={COLORS.brand} />
                  <Text style={[styles.spinnerText, { color: muted }]}>
                    Keep the ring worn and stay still…
                  </Text>
                </View>
              )}
              {phase === 'done' && (
                <Text style={[styles.doneText, { color: COLORS.normal }]}>
                  Your baseline has been saved and is now in use.
                </Text>
              )}
            </>
          ) : (
            <>
              <Text style={[styles.cardTitle, { color: text }]}>Start Calibration</Text>
              <Text style={[styles.cardSub, { color: muted }]}>
                Takes about 3.5 minutes. Wear the ring, sit somewhere calm,
                and stay relaxed and still for the whole capture.
              </Text>
              {phase === 'error' && errorMsg && (
                <Text style={[styles.errorText, { color: COLORS.stress }]}>{errorMsg}</Text>
              )}
              <TouchableOpacity
                style={[styles.startBtn, { backgroundColor: COLORS.brand }]}
                onPress={start}
                activeOpacity={0.85}
              >
                <Text style={styles.startBtnText}>Start Calibration →</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {phase === 'done' && (
          <TouchableOpacity
            style={[styles.recalibrateBtn, { backgroundColor: card, borderColor: border }]}
            onPress={() => { setPhase('idle'); setErrorMsg(null); }}
          >
            <Text style={[styles.recalibrateText, { color: COLORS.brand }]}>Recalibrate</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1 },
  container:       { padding: 20 },
  title:           { fontSize: 24, fontWeight: '900' },
  subtitle:        { fontSize: 13, marginTop: 4, marginBottom: 16, lineHeight: 19 },
  card:            { padding: 18, borderRadius: 20, borderWidth: 1, marginBottom: 16 },
  cardTitle:       { fontSize: 16, fontWeight: '800' },
  cardSub:         { fontSize: 12, marginTop: 6, lineHeight: 18 },
  statusLine:      { fontSize: 14, fontWeight: '700', marginTop: 8, marginBottom: 4, lineHeight: 20 },
  stepperRow:      { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 14 },
  stepDotWrap:     { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepDot:         { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  stepLine:        { flex: 1, height: 2, marginHorizontal: 2 },
  stepLabel:       { fontSize: 15, fontWeight: '800', marginBottom: 4 },
  stepHint:        { fontSize: 12, marginBottom: 12 },
  spinnerRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  spinnerText:     { fontSize: 12 },
  doneText:        { fontSize: 13, marginTop: 4 },
  errorText:       { fontSize: 13, marginTop: 8, marginBottom: 8 },
  startBtn:        { marginTop: 14, padding: 16, borderRadius: 14, alignItems: 'center' },
  startBtnText:    { color: '#fff', fontSize: 15, fontWeight: '800' },
  recalibrateBtn:  { padding: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1 },
  recalibrateText: { fontSize: 14, fontWeight: '700' },
});
