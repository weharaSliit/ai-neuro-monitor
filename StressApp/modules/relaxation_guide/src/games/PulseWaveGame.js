import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Easing,
  Vibration,
  Platform,
} from 'react-native';

const { width, height } = Dimensions.get('window');
const WAVE_BAR_COUNT = 24;
const AMBIENT_TICK_MS = 50;

// ---------------------------------------------------------------------------
// Resonance-frequency breathing, the technique behind real HRV biofeedback
// software (HeartMath, Elite HRV, etc). Breathing smoothly at a rate close
// to ~6 breaths/minute maximizes the amplitude of heart-rate oscillations
// via the baroreflex — no hold phases, just a smooth in/out pace.
//
// This screen paces your breathing. It does NOT measure your heart rate —
// doing that for real needs a sensor (camera PPG or wearable), and showing
// a made-up number pretending to be your HRV would be misleading, so unlike
// the original file, no heart-rate figure is displayed anywhere.
//
// Lehrer, P. M., & Gevirtz, R. (2014). Heart rate variability biofeedback:
// How and why does it work? Frontiers in Psychology, 5, 756.
// Goessl, V. C., Curtiss, J. E., & Hofmann, S. G. (2017). The effect of
// heart rate variability biofeedback training on stress and anxiety: A
// meta-analysis. Psychological Medicine, 47(15), 2578–2586.
// ---------------------------------------------------------------------------
const PACE_OPTIONS = [4.5, 5, 5.5, 6, 6.5, 7]; // breaths per minute
const DURATION_OPTIONS_MIN = [2, 5, 10];

const COLORS = {
  background: '#1A1040',
  backgroundDeep: '#120A2E',
  accent: '#B388FF',
  accentSoft: 'rgba(179,136,255,0.25)',
  text: '#E9E4FF',
};

const ResonancePulseBreathing = () => {
  const [screen, setScreen] = useState('setup'); // 'setup' | 'session' | 'complete'
  const [paceBpm, setPaceBpm] = useState(6);
  const [durationMin, setDurationMin] = useState(5);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [breathCount, setBreathCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [breathDirection, setBreathDirection] = useState('in'); // 'in' | 'out'
  const [waveBars, setWaveBars] = useState(Array(WAVE_BAR_COUNT).fill(0.3));
  const [orbs] = useState(() =>
    Array.from({ length: 6 }, (_, i) => ({
      id: i,
      angle: (i / 6) * Math.PI * 2,
      radius: 110 + Math.random() * 25,
      size: 5 + Math.random() * 6,
      phase: Math.random() * Math.PI * 2,
    }))
  );

  const orbAnim = useRef(new Animated.Value(0)).current; // 0 = exhaled, 1 = inhaled
  const screenFade = useRef(new Animated.Value(1)).current;
  const tickRef = useRef(null);
  const ambientRef = useRef(null);
  const cyclingRef = useRef(false);
  const pausedRef = useRef(false);
  const paceRef = useRef(paceBpm);

  const totalSeconds = durationMin * 60;

  useEffect(() => { paceRef.current = paceBpm; }, [paceBpm]);
  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);

  // Overall session clock.
  useEffect(() => {
    if (screen !== 'session') return;
    tickRef.current = setInterval(() => {
      if (pausedRef.current) return;
      setElapsedSeconds(prev => {
        const next = prev + 1;
        if (next >= totalSeconds) {
          clearInterval(tickRef.current);
          cyclingRef.current = false;
          setScreen('complete');
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [screen, totalSeconds]);

  // Smooth continuous inhale/exhale cycle, no hold — matches resonance
  // breathing protocols, which use a smooth sinusoidal pace rather than
  // tense/hold segments.
  const runHalfCycle = (direction) => {
    if (screen !== 'session' && !cyclingRef.current) return;
    setBreathDirection(direction);
    const halfPeriodMs = (60 / paceRef.current / 2) * 1000;

    Animated.timing(orbAnim, {
      toValue: direction === 'in' ? 1 : 0,
      duration: halfPeriodMs,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished || !cyclingRef.current) return;
      if (direction === 'out') {
        setBreathCount(c => c + 1);
        if (Platform.OS !== 'web') Vibration.vibrate(6);
      }
      if (pausedRef.current) return; // hold here until resumed
      runHalfCycle(direction === 'in' ? 'out' : 'in');
    });
  };

  useEffect(() => {
    if (screen === 'session' && !isPaused && !cyclingRef.current) {
      cyclingRef.current = true;
      runHalfCycle('in');
    }
    if (screen === 'session' && !isPaused) {
      // Resuming from a pause where the animation loop had stopped
      cyclingRef.current = true;
    }
  }, [screen, isPaused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (screen !== 'session') cyclingRef.current = false;
  }, [screen]);

  // Ambient scrolling wave — a pacing visual, explicitly not a biometric.
  useEffect(() => {
    if (screen !== 'session') return;
    ambientRef.current = setInterval(() => {
      const periodSec = 60 / paceRef.current;
      const omega = (2 * Math.PI) / periodSec;
      const t = Date.now() / 1000;
      setWaveBars(
        Array.from({ length: WAVE_BAR_COUNT }, (_, i) => {
          const v = Math.sin(omega * t - i * 0.35);
          return 0.5 + v * 0.4;
        })
      );
    }, AMBIENT_TICK_MS);
    return () => clearInterval(ambientRef.current);
  }, [screen]);

  const restartPacing = () => {
    orbAnim.stopAnimation(() => {
      cyclingRef.current = true;
      runHalfCycle('in');
    });
  };

  const adjustPace = (delta) => {
    setPaceBpm(prev => {
      const next = Math.min(7, Math.max(4.5, Math.round((prev + delta) * 10) / 10));
      return next;
    });
    if (screen === 'session') setTimeout(restartPacing, 0);
  };

  const fadeTo = (next) => {
    Animated.timing(screenFade, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setScreen(next);
      Animated.timing(screenFade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    });
  };

  const startSession = () => {
    setElapsedSeconds(0);
    setBreathCount(0);
    setIsPaused(false);
    orbAnim.setValue(0);
    cyclingRef.current = false;
    fadeTo('session');
  };

  const endSessionEarly = () => {
    clearInterval(tickRef.current);
    cyclingRef.current = false;
    fadeTo('complete');
  };

  const togglePause = () => {
    setIsPaused(p => {
      const next = !p;
      if (!next) setTimeout(restartPacing, 0); // resuming
      else cyclingRef.current = false;
      return next;
    });
  };

  const orbScale = orbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.35] });
  const orbGlow = orbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });

  // =========================================================================
  // SETUP
  // =========================================================================
  if (screen === 'setup') {
    return (
      <Animated.View style={[styles.container, { backgroundColor: COLORS.background, opacity: screenFade }]}>
        <View style={styles.setupWrap}>
          <Text style={styles.setupTitle}>Resonance Pulse Breathing</Text>
          <Text style={styles.setupSubtitle}>
            Follow the pulse as it slowly grows and settles. Breathing smoothly at a slow, steady
            pace like this is the basis of clinical heart-rate-variability biofeedback training.
          </Text>

          <Text style={styles.sectionLabel}>Breathing pace</Text>
          <View style={styles.paceRow}>
            {PACE_OPTIONS.map(bpm => (
              <TouchableOpacity
                key={bpm}
                onPress={() => setPaceBpm(bpm)}
                style={[styles.paceChip, paceBpm === bpm && styles.paceChipActive]}
              >
                <Text style={[styles.paceChipText, paceBpm === bpm && styles.paceChipTextActive]}>
                  {bpm}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.paceHint}>breaths per minute — 6 is a common starting point</Text>

          <Text style={[styles.sectionLabel, { marginTop: 22 }]}>Session length</Text>
          <View style={styles.paceRow}>
            {DURATION_OPTIONS_MIN.map(min => (
              <TouchableOpacity
                key={min}
                onPress={() => setDurationMin(min)}
                style={[styles.durationChip, durationMin === min && styles.paceChipActive]}
              >
                <Text style={[styles.paceChipText, durationMin === min && styles.paceChipTextActive]}>
                  {min} min
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.startButton} onPress={startSession}>
            <Text style={styles.startButtonText}>Begin</Text>
          </TouchableOpacity>

          <Text style={styles.citation}>
            Lehrer &amp; Gevirtz, 2014, Frontiers in Psychology; Goessl et al., 2017, Psychological
            Medicine (meta-analysis).
          </Text>
          <Text style={styles.disclaimer}>
            This paces your breathing — it does not measure your heart rate. Not a substitute for
            medical or mental health care.
          </Text>
        </View>
      </Animated.View>
    );
  }

  // =========================================================================
  // SESSION
  // =========================================================================
  if (screen === 'session') {
    const progress = Math.min(1, elapsedSeconds / totalSeconds);
    return (
      <View style={[styles.container, { backgroundColor: COLORS.backgroundDeep }]}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.sessionTime}>
          {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
          {'  /  '}
          {durationMin}:00
        </Text>

        <View style={styles.waveRow}>
          {waveBars.map((h, i) => (
            <View key={i} style={[styles.waveBar, { height: 6 + h * 30 }]} />
          ))}
        </View>

        <View style={styles.pulseArea}>
          {orbs.map(o => {
            const t = Date.now() * 0.0006;
            const x = width / 2 + Math.cos(o.angle + t) * o.radius;
            const y = height * 0.42 + Math.sin(o.angle + t) * o.radius * 0.6;
            return (
              <View
                key={o.id}
                style={{
                  position: 'absolute', left: x - o.size / 2, top: y - o.size / 2,
                  width: o.size, height: o.size, borderRadius: o.size / 2,
                  backgroundColor: COLORS.accent, opacity: 0.35,
                }}
              />
            );
          })}

          <Animated.View style={[styles.orbGlow, { opacity: orbGlow, transform: [{ scale: orbScale }] }]} />
          <Animated.View style={[styles.orb, { transform: [{ scale: orbScale }] }]}>
            <View style={styles.orbRing} />
          </Animated.View>
        </View>

        <Text style={styles.phaseText}>{breathDirection === 'in' ? 'Breathe in…' : 'Breathe out…'}</Text>
        <Text style={styles.breathCount}>{breathCount} breaths</Text>

        <View style={styles.paceAdjustRow}>
          <TouchableOpacity onPress={() => adjustPace(-0.5)} style={styles.stepperButton}>
            <Text style={styles.stepperText}>–</Text>
          </TouchableOpacity>
          <Text style={styles.paceReadout}>{paceBpm.toFixed(1)} breaths/min</Text>
          <TouchableOpacity onPress={() => adjustPace(0.5)} style={styles.stepperButton}>
            <Text style={styles.stepperText}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footerButtons}>
          <TouchableOpacity onPress={togglePause}>
            <Text style={styles.endLink}>{isPaused ? 'Resume' : 'Pause'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={endSessionEarly}>
            <Text style={styles.endLink}>End session</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // =========================================================================
  // COMPLETE
  // =========================================================================
  const minutesDone = (elapsedSeconds / 60).toFixed(1);
  return (
    <Animated.View style={[styles.container, { backgroundColor: COLORS.background, opacity: screenFade }]}>
      <Text style={styles.completeTitle}>Session complete</Text>
      <View style={styles.completeStatsRow}>
        <View style={styles.completeStat}>
          <Text style={styles.completeStatValue}>{breathCount}</Text>
          <Text style={styles.completeStatLabel}>breaths</Text>
        </View>
        <View style={styles.completeStat}>
          <Text style={styles.completeStatValue}>{minutesDone}</Text>
          <Text style={styles.completeStatLabel}>minutes</Text>
        </View>
      </View>
      <Text style={styles.completeNote}>
        You paced your breathing at {paceBpm.toFixed(1)} breaths per minute — close to the
        resonance frequency range used in clinical HRV biofeedback training.
      </Text>

      <TouchableOpacity style={styles.startButton} onPress={startSession}>
        <Text style={styles.startButtonText}>Breathe again</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => fadeTo('setup')}>
        <Text style={styles.secondaryButtonText}>Change pace or duration</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Backward-compatible aliases for existing imports.
export const PulseWaveGame = ResonancePulseBreathing;
export default ResonancePulseBreathing;

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', overflow: 'hidden' },

  setupWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, width: '100%' },
  setupTitle: { color: COLORS.text, fontSize: 25, fontWeight: '300', marginBottom: 12, textAlign: 'center' },
  setupSubtitle: {
    color: 'rgba(233,228,255,0.6)', fontSize: 13, lineHeight: 19,
    textAlign: 'center', marginBottom: 26,
  },
  sectionLabel: {
    color: 'rgba(233,228,255,0.4)', fontSize: 11, textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 10, textAlign: 'center',
  },
  paceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  paceChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 18,
    paddingVertical: 7, paddingHorizontal: 14,
  },
  durationChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 18,
    paddingVertical: 7, paddingHorizontal: 16,
  },
  paceChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  paceChipText: { color: COLORS.text, fontSize: 13 },
  paceChipTextActive: { color: COLORS.background, fontWeight: '600' },
  paceHint: { color: 'rgba(233,228,255,0.3)', fontSize: 10, textAlign: 'center', marginTop: 8 },

  startButton: {
    backgroundColor: COLORS.accent, borderRadius: 26, paddingVertical: 15,
    alignItems: 'center', marginTop: 28, marginBottom: 14,
  },
  startButtonText: { color: COLORS.background, fontSize: 16, fontWeight: '600' },
  secondaryButton: { paddingVertical: 10, alignItems: 'center' },
  secondaryButtonText: { color: 'rgba(233,228,255,0.5)', fontSize: 13 },
  citation: { color: 'rgba(233,228,255,0.32)', fontSize: 10, textAlign: 'center', lineHeight: 15 },
  disclaimer: { color: 'rgba(233,228,255,0.25)', fontSize: 10, textAlign: 'center', marginTop: 10, lineHeight: 15 },

  progressTrack: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.06)' },
  progressFill: { height: '100%', backgroundColor: COLORS.accent },
  sessionTime: { color: 'rgba(233,228,255,0.4)', fontSize: 12, marginTop: 46 },

  waveRow: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    height: 40, marginTop: 20,
  },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: 'rgba(179,136,255,0.5)' },

  pulseArea: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  orbGlow: {
    position: 'absolute', width: 200, height: 200, borderRadius: 100,
    backgroundColor: COLORS.accentSoft,
  },
  orb: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: 'rgba(179,136,255,0.25)',
    borderWidth: 2, borderColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  orbRing: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },

  phaseText: { color: COLORS.text, fontSize: 16, fontWeight: '400', marginBottom: 4 },
  breathCount: { color: 'rgba(233,228,255,0.5)', fontSize: 13, marginBottom: 18 },

  paceAdjustRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 24 },
  stepperButton: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepperText: { color: COLORS.text, fontSize: 18, lineHeight: 20 },
  paceReadout: { color: 'rgba(233,228,255,0.55)', fontSize: 12, minWidth: 100, textAlign: 'center' },

  footerButtons: { flexDirection: 'row', gap: 24, marginBottom: 40 },
  endLink: { color: 'rgba(233,228,255,0.4)', fontSize: 12, textDecorationLine: 'underline' },

  completeTitle: { color: COLORS.text, fontSize: 24, fontWeight: '300', marginTop: 120, marginBottom: 30 },
  completeStatsRow: { flexDirection: 'row', gap: 50, marginBottom: 30 },
  completeStat: { alignItems: 'center' },
  completeStatValue: { fontSize: 36, fontWeight: '200', color: COLORS.accent },
  completeStatLabel: { color: 'rgba(233,228,255,0.4)', fontSize: 12, marginTop: 4 },
  completeNote: {
    color: 'rgba(233,228,255,0.55)', fontSize: 13, lineHeight: 19,
    textAlign: 'center', paddingHorizontal: 36, marginBottom: 40,
  },
});