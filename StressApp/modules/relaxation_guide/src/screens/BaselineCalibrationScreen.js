import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { ref, onValue, off, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../../../eeg/firebase';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { useSweetAlert } from '../context/SweetAlertContext';
import { apiService } from '../api/apiService';

const CALIBRATION_DURATION = 120; // 2 minutes

const BREATHING_STEPS = [
  { phase: 'Inhale', duration: 4000, icon: '🌬️', direction: 'expand' },
  { phase: 'Hold', duration: 2000, icon: '🫁', direction: 'hold' },
  { phase: 'Exhale', duration: 4000, icon: '☁️', direction: 'contract' },
  { phase: 'Rest', duration: 2000, icon: '✨', direction: 'hold' },
];

const TIPS = [
  '🧘 Relax your jaw and shoulders.',
  '👁️ Gaze softly at a distant point.',
  '🌿 Let your body sink into your seat.',
  '💓 Feel your heartbeat slow down.',
  '🌊 Breathe with the guiding ring.',
];

export const BaselineCalibrationScreen = () => {
  const { showAlert } = useSweetAlert();
  const { userId, setCurrentScreen, setIsCalibrated, permMember1 } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [secondsLeft, setSecondsLeft] = useState(CALIBRATION_DURATION);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [breathPhase, setBreathPhase] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);

  // permMember1 (PermissionsScreen.js) is a CONSENT toggle, not a live
  // connectivity check -- it defaults true and has no hardware awareness.
  // eegConnected is the real signal: whether at least one derived-output
  // block record has landed in Firebase for this live EEG session (see
  // this file's eegConnected effect below). Both are required: a user who
  // declined the EEG permission should never see "EEG Recording" even if
  // hardware happens to be streaming, and a user who granted it but has no
  // wearable on should never see it either.
  const [eegSessionId, setEegSessionId] = useState(null);
  const [eegConnected, setEegConnected] = useState(false);
  // Outcome of backend/psychological's finalize_calibration() for this
  // session -- {status, thresholds_personalized, baseline_shift,
  // resting_calibrated_p, n_blocks} -- written by app.py's /calibrate via
  // push_calibration_result() the moment mqtt_bridge.py's calibration
  // blocks are processed server-side. Nothing else gives this screen
  // access to that outcome, since /calibrate is never called from here
  // directly.
  const [calibrationResult, setCalibrationResult] = useState(null);

  // Breathing ring
  const breathScale  = useRef(new Animated.Value(1)).current;
  const breathOpacity = useRef(new Animated.Value(0.5)).current;

  // Outer ring 1
  const ring1Scale  = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.3)).current;
  // Outer ring 2 (HRV sim)
  const ring2Scale  = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0.2)).current;

  // Entrance animations
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardSlide   = useRef(new Animated.Value(30)).current;
  const tipOpacity  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(cardSlide, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  // Breathing animation loop when calibrating
  useEffect(() => {
    if (!isCalibrating) return;

    const runBreathing = (phaseIdx) => {
      const phase = BREATHING_STEPS[phaseIdx % BREATHING_STEPS.length];
      setBreathPhase(phaseIdx % BREATHING_STEPS.length);

      const toScale = phase.direction === 'expand' ? 1.45 : phase.direction === 'contract' ? 0.85 : (phaseIdx % 4 === 1 ? 1.45 : 0.85);
      const toDur   = phase.duration;

      Animated.parallel([
        Animated.timing(breathScale, { toValue: toScale, duration: toDur * 0.9, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathOpacity, { toValue: toScale > 1 ? 0.85 : 0.45, duration: toDur * 0.9, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]).start(() => {
        // Outer rings pulse in opposite cadence
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Scale, { toValue: 1.7, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0.3, duration: 0, useNativeDriver: true }),
          ]),
        ]).start();
      });

      setTimeout(() => runBreathing(phaseIdx + 1), toDur);
    };

    runBreathing(0);

    // HRV outer ring - faster
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ring2Scale, { toValue: 2.0, duration: 900, useNativeDriver: true }),
          Animated.timing(ring2Opacity, { toValue: 0, duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(ring2Scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(ring2Opacity, { toValue: 0.2, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [isCalibrating]);

  // Countdown timer
  useEffect(() => {
    if (!isCalibrating || secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft(p => p - 1), 1000);
    return () => clearInterval(timer);
  }, [isCalibrating, secondsLeft]);

  // Real EEG connectivity, only while actively calibrating and only if the
  // user hasn't declined the EEG permission -- follows the SAME
  // current_session_id pointer this file's eegConnected effect below
  // reads, so this screen can never disagree with the real EEG tab about
  // whether wearable02 is actually connected right now.
  useEffect(() => {
    if (!isCalibrating || !permMember1 || !userId) {
      setEegSessionId(null);
      setEegConnected(false);
      return;
    }
    const pointerRef = ref(db, 'psychological/current_session_id');
    const pointerHandler = onValue(pointerRef, (snapshot) => {
      setEegSessionId(snapshot.val() || null);
    });
    return () => off(pointerRef, 'value', pointerHandler);
  }, [isCalibrating, permMember1, userId]);

  useEffect(() => {
    if (!eegSessionId || !userId) {
      setEegConnected(false);
      return;
    }
    // The backend no longer writes a live_raw preview node (raw EEG
    // samples are never sent to Firebase at all -- see
    // backend/psychological/app.py's /predict route). "Connected" here
    // just means at least one derived-output block record has landed for
    // this session -- same {window: record} path CalibrationGate.js's
    // useDeviceStatus() now queries the same way.
    const latestRef = query(
      ref(db, `psychological/${userId}/${eegSessionId}`),
      orderByChild('window'), limitToLast(1),
    );
    const rawHandler = onValue(latestRef, (snapshot) => {
      setEegConnected(!!snapshot.val());
    });
    return () => off(latestRef, 'value', rawHandler);
  }, [eegSessionId, userId]);

  // finalize_calibration()'s outcome for this session, once mqtt_bridge.py's
  // server-side /calibrate call actually reaches it -- see calibrationResult's
  // own comment above for why this screen has no more direct path to it.
  useEffect(() => {
    if (!eegSessionId || !userId) {
      setCalibrationResult(null);
      return;
    }
    const resultRef = ref(db, `psychological/${userId}/${eegSessionId}/calibration_result`);
    const resultHandler = onValue(resultRef, (snapshot) => {
      setCalibrationResult(snapshot.val() || null);
    });
    return () => off(resultRef, 'value', resultHandler);
  }, [eegSessionId, userId]);

  // Completion
  useEffect(() => {
    if (isCalibrating && secondsLeft === 0) {
      setIsCalibrated(true);
      apiService.completeCalibration(userId);
      // EEG is only claimed as captured if wearable02 genuinely produced
      // at least one block record at some point during this window
      // (eegConnected) -- this screen's own 2-minute timer completing
      // doesn't by itself mean
      // backend/psychological's finalize_calibration() ever ran; that
      // requires real blocks to have reached /calibrate via mqtt_bridge.py.
      const eegCaptured = permMember1 && eegConnected;
      // calibrationResult may not have landed yet even when eegCaptured is
      // true (mqtt_bridge.py's own calibration window runs on its own
      // clock, independent of this screen's 120s timer) -- eegCaptured
      // means "wearable02 was streaming," not "finalize_calibration()
      // already returned." Only claim personalization once the outcome
      // itself is actually in hand.
      let eegLine = 'EEG was not connected during this session, so no EEG baseline was recorded -- connect wearable02 and recalibrate from the EEG tab to add it.';
      if (eegCaptured) {
        eegLine = 'HRV, GSR, and EEG alpha/beta ratios stored. Real-time stress stream is now active.';
        if (calibrationResult?.status === 'ok') {
          eegLine += calibrationResult.thresholds_personalized
            ? ` Your EEG high-load sensitivity has been calibrated to your own resting pattern (${calibrationResult.baseline_shift >= 0 ? '+' : ''}${(calibrationResult.baseline_shift * 100).toFixed(1)}% vs. average).`
            : ' Not enough clean EEG blocks were captured to personalize your sensitivity this time -- using the standard sensitivity for now.';
        }
      }
      showAlert({
        title: '🎯 Baseline Recorded!',
        text: `Autonomic nervous system baseline captured. ${eegLine}`,
        icon: 'success',
        confirmButtonText: 'Go to Dashboard 🚀',
        onConfirm: () => setCurrentScreen('Dashboard')
      });
    }
  }, [isCalibrating, secondsLeft, permMember1, eegConnected, calibrationResult]);

  // Rotate tips
  useEffect(() => {
    if (!isCalibrating) return;
    const t = setInterval(() => {
      Animated.sequence([
        Animated.timing(tipOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(tipOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
      setTipIndex(i => (i + 1) % TIPS.length);
    }, 8000);
    return () => clearInterval(t);
  }, [isCalibrating]);

  const progressPct = ((CALIBRATION_DURATION - secondsLeft) / CALIBRATION_DURATION) * 100;
  const currentPhase = BREATHING_STEPS[breathPhase];
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Baseline Calibration" showBack onBack={() => setCurrentScreen('Permissions')} />

      <View style={styles.body}>
        <Animated.View style={[styles.infoCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: cardOpacity, transform: [{ translateY: cardSlide }] }]}>
          <Text style={[styles.heading, { color: theme.textPrimary }]}>2-Minute Baseline Calibration</Text>
          <Text style={[styles.sub, { color: theme.textSecondary }]}>
            Sit comfortably while Calm AI records your{'\n'}HRV · GSR · EEG baseline for 120 seconds.
          </Text>
        </Animated.View>

        {/* Biofeedback Ring Visualization */}
        <View style={styles.ringContainer}>
          {/* Outer HRV ring */}
          <Animated.View style={[styles.outerRing, styles.ring2, { borderColor: '#10B981', transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
          <Animated.View style={[styles.outerRing, styles.ring1, { borderColor: theme.accent, transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />

          {/* Breathing guide circle */}
          <Animated.View style={[styles.breathCircle, {
            backgroundColor: isCalibrating ? (theme.accent + '25') : theme.bgSecondary,
            borderColor: isCalibrating ? theme.accent : theme.border,
            transform: [{ scale: breathScale }],
            opacity: breathOpacity,
          }]}>
            <Text style={styles.breathIcon}>{isCalibrating ? currentPhase?.icon : '🫁'}</Text>
            <Text style={[styles.timerTxt, { color: isCalibrating ? theme.accent : theme.textPrimary }]}>
              {mins}:{secs.toString().padStart(2, '0')}
            </Text>
            <Text style={[styles.phaseLabel, { color: theme.textMuted }]}>
              {isCalibrating ? currentPhase?.phase : 'Ready'}
            </Text>
          </Animated.View>
        </View>

        {/* Progress Bar */}
        {isCalibrating && (
          <View style={styles.progressWrap}>
            <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
              <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: theme.accent }]} />
            </View>
            <Text style={[styles.progressTxt, { color: theme.textMuted }]}>{progressPct.toFixed(0)}% complete</Text>
          </View>
        )}

        {/* Sensor indicators -- EEG reflects REAL connectivity (permMember1
            consent + at least one block record actually arriving), not
            assumed-on like HRV/GSR still are here. */}
        {isCalibrating && (
          <View style={styles.sensorsRow}>
            {[
              { label: 'HRV', color: '#10B981', text: 'HRV Recording' },
              { label: 'GSR', color: '#F59E0B', text: 'GSR Recording' },
              !permMember1
                ? { label: 'EEG', color: '#64748B', text: 'EEG Skipped' }
                : eegConnected
                  ? { label: 'EEG', color: '#8B5CF6', text: 'EEG Recording' }
                  : { label: 'EEG', color: '#94A3B8', text: 'EEG Not Connected' },
            ].map((s, i) => (
              <View key={i} style={[styles.sensorChip, { borderColor: s.color + '60', backgroundColor: s.color + '12' }]}>
                <View style={[styles.sensorDot, { backgroundColor: s.color }]} />
                <Text style={[styles.sensorLabel, { color: s.color }]}>{s.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Tip or Start Button */}
        {!isCalibrating ? (
          <TouchableOpacity
            style={[styles.startBtn, { backgroundColor: theme.accent }]}
            onPress={() => setIsCalibrating(true)}
            activeOpacity={0.85}
          >
            <Text style={[styles.startBtnTxt, { color: theme.accentText }]}>▶  Begin 2-Min Calibration</Text>
          </TouchableOpacity>
        ) : (
          <Animated.View style={[styles.tipBox, { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: tipOpacity }]}>
            <Text style={[styles.tipTxt, { color: theme.accent }]}>{TIPS[tipIndex]}</Text>
          </Animated.View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 24, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  infoCard: {
    width: '100%', padding: 16, borderRadius: 18, borderWidth: 1,
    alignItems: 'center',
  },
  heading: { fontSize: 20, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  sub: { fontSize: 13, textAlign: 'center', lineHeight: 20 },

  ringContainer: {
    width: 220, height: 220,
    alignItems: 'center', justifyContent: 'center',
    marginVertical: 4,
  },
  outerRing: {
    position: 'absolute', borderRadius: 200, borderWidth: 1.5,
  },
  ring1: { width: 200, height: 200 },
  ring2: { width: 200, height: 200 },
  breathCircle: {
    width: 160, height: 160, borderRadius: 80,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3,
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 20,
    elevation: 10,
  },
  breathIcon: { fontSize: 30, marginBottom: 4 },
  timerTxt: { fontSize: 36, fontWeight: '900', letterSpacing: 1 },
  phaseLabel: { fontSize: 11, fontWeight: '700', marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },

  progressWrap: { width: '100%', gap: 4 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', width: '100%' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressTxt: { fontSize: 11, textAlign: 'right', fontWeight: '600' },

  sensorsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  sensorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
  },
  sensorDot: { width: 7, height: 7, borderRadius: 3.5 },
  sensorLabel: { fontSize: 11, fontWeight: '700' },

  startBtn: {
    paddingVertical: 16, paddingHorizontal: 40, borderRadius: 30,
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  startBtnTxt: { fontWeight: '800', fontSize: 16 },
  tipBox: {
    padding: 14, borderRadius: 14, borderWidth: 1, width: '100%', alignItems: 'center',
  },
  tipTxt: { fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
});
