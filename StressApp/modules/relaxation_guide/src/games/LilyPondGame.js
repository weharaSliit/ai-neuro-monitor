import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  TouchableOpacity,
  Animated,
  Dimensions,
  Easing,
  Vibration,
  Platform,
} from 'react-native';

const { width, height } = Dimensions.get('window');
const PETAL_COUNT = 6;
const DURATION_OPTIONS_MIN = [2, 5, 10];
const BPM_OPTIONS = [4.5, 5, 5.5, 6, 6.5, 7];
const AMBIENT_TICK_MS = 50;

// ---------------------------------------------------------------------------
// Two evidence-based breathing patterns, both shown as a lily blooming
// (inhale) and settling closed (exhale) — no hold segments, matching how
// both techniques are actually practiced.
//
// Extended Exhale (45:55): a longer exhale than inhale is associated with
// increased heart-rate variability and parasympathetic activation.
//   Zaccaro, A., et al. (2018). How breath-control can change your life: A
//   systematic review on psycho-physiological correlates of slow breathing.
//   Frontiers in Human Neuroscience, 12, 353.
//
// Coherent Breathing (50:50, ~6 bpm): smooth equal breaths near the
// "resonance frequency" that maximizes heart-rate oscillation via the
// baroreflex — the basis of clinical HRV biofeedback training.
//   Lehrer, P. M., & Gevirtz, R. (2014). Heart rate variability biofeedback:
//   How and why does it work? Frontiers in Psychology, 5, 756.
// ---------------------------------------------------------------------------
const PATTERNS = {
  extended: {
    id: 'extended',
    label: 'Extended Exhale',
    inhaleRatio: 0.45,
    exhaleRatio: 0.55,
    defaultBpm: 5.5,
    citation: 'Zaccaro et al., 2018, Frontiers in Human Neuroscience',
    blurb: 'A longer exhale than inhale — linked to increased heart-rate variability and a calmer autonomic state.',
  },
  coherent: {
    id: 'coherent',
    label: 'Coherent Breathing',
    inhaleRatio: 0.5,
    exhaleRatio: 0.5,
    defaultBpm: 6,
    citation: 'Lehrer & Gevirtz, 2014, Frontiers in Psychology',
    blurb: 'Smooth, equal-length breaths near your resonance frequency — the pattern used in clinical HRV biofeedback training.',
  },
};

const COLORS = {
  background: '#0B2A1F',
  water: '#0F3B2A',
  pad: '#1B5E3C',
  petalClosed: '#3E8261',
  petalOpen: '#F472B6',
  accent: '#6EE7B7',
  rippleIn: '#F472B6',
  rippleOut: '#60A5FA',
  text: '#E7FBF1',
};

const LilyBreathingGame = () => {
  const [screen, setScreen] = useState('setup'); // 'setup' | 'session' | 'complete'
  const [patternId, setPatternId] = useState('extended');
  const [bpm, setBpm] = useState(PATTERNS.extended.defaultBpm);
  const [durationMin, setDurationMin] = useState(5);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [breathCount, setBreathCount] = useState(0);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'inhale' | 'exhale'
  const [isPaused, setIsPaused] = useState(false);
  const [ripples, setRipples] = useState([]);
  const [dragonflies, setDragonflies] = useState(() =>
    Array.from({ length: 2 }, (_, i) => ({
      id: i, x: Math.random() * width, y: height * 0.15 + Math.random() * height * 0.2,
      phase: Math.random() * Math.PI * 2,
    }))
  );

  const bloom = useRef(new Animated.Value(0)).current; // 0 closed -> 1 fully open
  const phaseProgress = useRef(new Animated.Value(0)).current; // 0 -> 1 across current phase
  const phaseTextOpacity = useRef(new Animated.Value(1)).current;
  const shimmerX = useRef(new Animated.Value(0)).current;
  const screenFade = useRef(new Animated.Value(1)).current;

  const tickRef = useRef(null);
  const ambientRef = useRef(null);
  const isPressedRef = useRef(false);
  const pausedRef = useRef(false);
  const patternRef = useRef(patternId);
  const bpmRef = useRef(bpm);
  const currentPhaseDurationRef = useRef(0);
  const bloomPausedValueRef = useRef(0);
  const progressPausedValueRef = useRef(0);

  const pattern = PATTERNS[patternId];
  const totalSeconds = durationMin * 60;

  useEffect(() => { patternRef.current = patternId; }, [patternId]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);

  const computeDurations = () => {
    const pat = PATTERNS[patternRef.current];
    const periodMs = (60 / bpmRef.current) * 1000;
    return { inhaleMs: periodMs * pat.inhaleRatio, exhaleMs: periodMs * pat.exhaleRatio };
  };

  // Overall session clock.
  useEffect(() => {
    if (screen !== 'session') return;
    tickRef.current = setInterval(() => {
      if (pausedRef.current) return;
      setElapsedSeconds(prev => {
        const next = prev + 1;
        if (next >= totalSeconds) {
          clearInterval(tickRef.current);
          setScreen('complete');
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [screen, totalSeconds]);

  // Ambient dragonfly drift + water shimmer loop.
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerX, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(shimmerX, { toValue: 0, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();

    ambientRef.current = setInterval(() => {
      const t = Date.now() * 0.0005;
      setDragonflies(prev =>
        prev.map(d => ({
          ...d,
          x: (width * 0.5) + Math.cos(t + d.phase) * width * 0.35,
          y: (height * 0.18) + Math.sin(t * 1.3 + d.phase) * height * 0.08,
        }))
      );
      setRipples(prev =>
        prev.map(r => ({ ...r, radius: r.radius + 1.1, opacity: r.opacity - 0.014 })).filter(r => r.opacity > 0)
      );
    }, AMBIENT_TICK_MS);

    return () => clearInterval(ambientRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const crossfadePhaseText = () => {
    Animated.sequence([
      Animated.timing(phaseTextOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(phaseTextOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  };

  const startExhale = () => {
    setPhase('exhale');
    crossfadePhaseText();
    const { exhaleMs } = computeDurations();
    currentPhaseDurationRef.current = exhaleMs;
    setRipples(prev => [...prev, { id: Math.random(), radius: 10, opacity: 0.5, color: COLORS.rippleOut }]);

    phaseProgress.setValue(0);
    Animated.timing(phaseProgress, { toValue: 1, duration: exhaleMs, easing: Easing.linear, useNativeDriver: false }).start();

    Animated.timing(bloom, { toValue: 0, duration: exhaleMs, easing: Easing.in(Easing.ease), useNativeDriver: false }).start(
      ({ finished }) => {
        if (!finished) return;
        setBreathCount(c => c + 1);
        if (Platform.OS !== 'web') Vibration.vibrate(8);
        setPhase('idle');
        if (isPressedRef.current && !pausedRef.current) startInhale(); // continuous hold chains the next breath
      }
    );
  };

  const startInhale = () => {
    setPhase('inhale');
    crossfadePhaseText();
    const { inhaleMs } = computeDurations();
    currentPhaseDurationRef.current = inhaleMs;
    if (Platform.OS !== 'web') Vibration.vibrate(5);
    setRipples(prev => [...prev, { id: Math.random(), radius: 10, opacity: 0.5, color: COLORS.rippleIn }]);

    phaseProgress.setValue(0);
    Animated.timing(phaseProgress, { toValue: 1, duration: inhaleMs, easing: Easing.linear, useNativeDriver: false }).start();

    Animated.timing(bloom, { toValue: 1, duration: inhaleMs, easing: Easing.out(Easing.ease), useNativeDriver: false }).start(
      ({ finished }) => {
        if (finished) startExhale(); // reaching full bloom naturally starts the exhale
      }
    );
  };

  const handlePressIn = () => {
    isPressedRef.current = true;
    if (pausedRef.current) return;
    if (phase === 'idle') startInhale();
  };

  const handlePressOut = () => {
    isPressedRef.current = false;
    if (phase === 'inhale') {
      bloom.stopAnimation(() => startExhale());
    }
  };

  // Pause genuinely freezes the animation in place and resumes it from the
  // same point, rather than just stopping the session clock underneath it.
  const togglePause = () => {
    const goingToPause = !isPaused;
    if (goingToPause) {
      bloom.stopAnimation(v => { bloomPausedValueRef.current = v; });
      phaseProgress.stopAnimation(v => { progressPausedValueRef.current = v; });
    } else if (phase !== 'idle') {
      const remainingFraction = Math.max(0, 1 - progressPausedValueRef.current);
      const remainingMs = currentPhaseDurationRef.current * remainingFraction;
      const targetBloom = phase === 'inhale' ? 1 : 0;

      Animated.timing(phaseProgress, { toValue: 1, duration: remainingMs, easing: Easing.linear, useNativeDriver: false }).start();
      Animated.timing(bloom, {
        toValue: targetBloom,
        duration: remainingMs,
        easing: phase === 'inhale' ? Easing.out(Easing.ease) : Easing.in(Easing.ease),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (!finished) return;
        if (phase === 'inhale') {
          startExhale();
        } else {
          setBreathCount(c => c + 1);
          if (Platform.OS !== 'web') Vibration.vibrate(8);
          setPhase('idle');
          if (isPressedRef.current) startInhale();
        }
      });
    }
    pausedRef.current = goingToPause;
    setIsPaused(goingToPause);
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
    setPhase('idle');
    setIsPaused(false);
    pausedRef.current = false;
    isPressedRef.current = false;
    bloom.setValue(0);
    phaseProgress.setValue(0);
    fadeTo('session');
  };

  const endSessionEarly = () => {
    clearInterval(tickRef.current);
    fadeTo('complete');
  };

  const selectPattern = (id) => {
    setPatternId(id);
    setBpm(PATTERNS[id].defaultBpm);
  };

  const phaseText =
    phase === 'inhale' ? 'Breathing in…' : phase === 'exhale' ? 'Breathing out…' : 'Press and hold the lily';

  const petalColor = bloom.interpolate({ inputRange: [0, 1], outputRange: [COLORS.petalClosed, COLORS.petalOpen] });
  const shimmerTranslate = shimmerX.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.6, width * 0.6] });
  const avgPace = breathCount > 0 && elapsedSeconds > 0 ? (breathCount / (elapsedSeconds / 60)).toFixed(1) : null;

  // =========================================================================
  // SETUP
  // =========================================================================
  if (screen === 'setup') {
    return (
      <Animated.View style={[styles.container, { backgroundColor: COLORS.background, opacity: screenFade }]}>
        <View style={styles.setupWrap}>
          <Text style={styles.setupTitle}>Lily Pond Breathing</Text>
          <Text style={styles.setupSubtitle}>
            Press and hold the lily to breathe in — it blooms open. Let go to breathe out as it
            settles closed. Keep holding through a breath to flow straight into the next one.
          </Text>

          <Text style={styles.sectionLabel}>Pattern</Text>
          {Object.values(PATTERNS).map(p => (
            <TouchableOpacity
              key={p.id}
              onPress={() => selectPattern(p.id)}
              style={[styles.patternCard, patternId === p.id && styles.patternCardActive]}
            >
              <Text style={styles.patternName}>{p.label}</Text>
              <Text style={styles.patternBlurb}>{p.blurb}</Text>
              <Text style={styles.patternCitation}>{p.citation}</Text>
            </TouchableOpacity>
          ))}

          <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Pace</Text>
          <View style={styles.chipRow}>
            {BPM_OPTIONS.map(b => (
              <TouchableOpacity key={b} onPress={() => setBpm(b)} style={[styles.chip, bpm === b && styles.chipActive]}>
                <Text style={[styles.chipText, bpm === b && styles.chipTextActive]}>{b}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.paceHint}>breaths per minute</Text>

          <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Session length</Text>
          <View style={styles.chipRow}>
            {DURATION_OPTIONS_MIN.map(min => (
              <TouchableOpacity
                key={min}
                onPress={() => setDurationMin(min)}
                style={[styles.chip, durationMin === min && styles.chipActive]}
              >
                <Text style={[styles.chipText, durationMin === min && styles.chipTextActive]}>{min} min</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.startButton} onPress={startSession}>
            <Text style={styles.startButtonText}>Begin</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            A relaxation exercise, not a substitute for medical or mental health care.
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
      <View style={[styles.container, { backgroundColor: COLORS.water }]}>
        <Animated.View
          style={[styles.shimmer, { transform: [{ translateX: shimmerTranslate }, { rotate: '20deg' }] }]}
        />

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <Text style={styles.sessionTime}>
          {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
          {'  /  '}
          {durationMin}:00
        </Text>
        <Text style={styles.sessionPattern}>{pattern.label} · {bpm} bpm</Text>

        <View style={styles.pondArea}>
          {dragonflies.map(d => (
            <View key={d.id} style={[styles.dragonfly, { left: d.x, top: d.y }]}>
              <View style={styles.dragonflyBody} />
              <View style={[styles.dragonflyWing, { left: -6 }]} />
              <View style={[styles.dragonflyWing, { left: 6 }]} />
            </View>
          ))}

          {ripples.map(r => (
            <View
              key={r.id}
              style={{
                position: 'absolute',
                width: r.radius * 2,
                height: r.radius * 2,
                borderRadius: r.radius,
                borderWidth: 1.5,
                borderColor: r.color,
                opacity: r.opacity,
              }}
            />
          ))}

          <View style={styles.pad} />

          <TouchableWithoutFeedback onPressIn={handlePressIn} onPressOut={handlePressOut}>
            <View style={styles.lilyHitArea}>
              {Array.from({ length: PETAL_COUNT }).map((_, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.petal,
                    {
                      backgroundColor: petalColor,
                      transform: [
                        { rotate: `${(360 / PETAL_COUNT) * i}deg` },
                        { translateY: bloom.interpolate({ inputRange: [0, 1], outputRange: [-4, -32] }) },
                        { scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
                      ],
                    },
                  ]}
                />
              ))}
              <View style={styles.lilyCenter} />
            </View>
          </TouchableWithoutFeedback>
        </View>

        <Animated.Text style={[styles.phaseText, { opacity: phaseTextOpacity }]}>{phaseText}</Animated.Text>

        <View style={styles.phaseProgressTrack}>
          <Animated.View
            style={[
              styles.phaseProgressFill,
              { width: phaseProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
            ]}
          />
        </View>

        <Text style={styles.breathCount}>{breathCount} breaths</Text>

        <View style={styles.paceAdjustRow}>
          <TouchableOpacity onPress={() => setBpm(b => Math.max(4.5, Math.round((b - 0.5) * 10) / 10))} style={styles.stepperButton}>
            <Text style={styles.stepperText}>–</Text>
          </TouchableOpacity>
          <Text style={styles.paceReadout}>{bpm.toFixed(1)} bpm</Text>
          <TouchableOpacity onPress={() => setBpm(b => Math.min(7, Math.round((b + 0.5) * 10) / 10))} style={styles.stepperButton}>
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
        {avgPace && (
          <View style={styles.completeStat}>
            <Text style={styles.completeStatValue}>{avgPace}</Text>
            <Text style={styles.completeStatLabel}>avg bpm</Text>
          </View>
        )}
      </View>
      <Text style={styles.completeNote}>{pattern.blurb}</Text>

      <TouchableOpacity style={styles.startButton} onPress={startSession}>
        <Text style={styles.startButtonText}>Breathe again</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => fadeTo('setup')}>
        <Text style={styles.secondaryButtonText}>Change pattern or pace</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Backward-compatible aliases for existing imports.
export const LilyPondGame = LilyBreathingGame;
export default LilyBreathingGame;

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', overflow: 'hidden' },

  setupWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 26, width: '100%', paddingVertical: 40 },
  setupTitle: { color: COLORS.text, fontSize: 25, fontWeight: '300', marginBottom: 10, textAlign: 'center' },
  setupSubtitle: {
    color: 'rgba(231,251,241,0.6)', fontSize: 13, lineHeight: 19,
    textAlign: 'center', marginBottom: 22,
  },
  sectionLabel: {
    color: 'rgba(231,251,241,0.4)', fontSize: 11, textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 10, textAlign: 'center',
  },
  patternCard: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 14,
    padding: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.03)',
  },
  patternCardActive: { borderColor: COLORS.accent, backgroundColor: 'rgba(110,231,183,0.1)' },
  patternName: { color: COLORS.text, fontSize: 14, fontWeight: '500', marginBottom: 3 },
  patternBlurb: { color: 'rgba(231,251,241,0.55)', fontSize: 11, lineHeight: 15, marginBottom: 4 },
  patternCitation: { color: 'rgba(231,251,241,0.3)', fontSize: 9, fontStyle: 'italic' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.text, fontSize: 13 },
  chipTextActive: { color: COLORS.background, fontWeight: '600' },
  paceHint: { color: 'rgba(231,251,241,0.3)', fontSize: 10, textAlign: 'center', marginTop: 6 },

  startButton: {
    backgroundColor: COLORS.accent, borderRadius: 26, paddingVertical: 15,
    alignItems: 'center', marginTop: 24, marginBottom: 14,
  },
  startButtonText: { color: COLORS.background, fontSize: 16, fontWeight: '600' },
  secondaryButton: { paddingVertical: 10, alignItems: 'center' },
  secondaryButtonText: { color: 'rgba(231,251,241,0.5)', fontSize: 13 },
  disclaimer: { color: 'rgba(231,251,241,0.25)', fontSize: 10, textAlign: 'center', marginTop: 4 },

  shimmer: {
    position: 'absolute', top: '30%', width: 60, height: height * 1.4,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  progressTrack: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.06)' },
  progressFill: { height: '100%', backgroundColor: COLORS.accent },
  sessionTime: { color: 'rgba(231,251,241,0.4)', fontSize: 12, marginTop: 46 },
  sessionPattern: { color: 'rgba(231,251,241,0.3)', fontSize: 11, marginTop: 3 },

  pondArea: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  dragonfly: { position: 'absolute', width: 14, height: 6 },
  dragonflyBody: { width: 10, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(96,165,250,0.6)', marginLeft: 2 },
  dragonflyWing: { position: 'absolute', top: -1, width: 8, height: 4, borderRadius: 4, backgroundColor: 'rgba(226,232,240,0.35)' },
  pad: {
    position: 'absolute', width: 130, height: 130, borderRadius: 65,
    backgroundColor: COLORS.pad, opacity: 0.6,
  },
  lilyHitArea: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center' },
  petal: { position: 'absolute', width: 12, height: 30, borderRadius: 8 },
  lilyCenter: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FCD34D' },

  phaseText: { color: COLORS.text, fontSize: 16, fontWeight: '400', marginBottom: 10 },
  phaseProgressTrack: {
    width: 140, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden', marginBottom: 10,
  },
  phaseProgressFill: { height: '100%', backgroundColor: COLORS.accent },
  breathCount: { color: 'rgba(231,251,241,0.5)', fontSize: 13, marginBottom: 16 },

  paceAdjustRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
  stepperButton: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepperText: { color: COLORS.text, fontSize: 17, lineHeight: 19 },
  paceReadout: { color: 'rgba(231,251,241,0.55)', fontSize: 12, minWidth: 70, textAlign: 'center' },

  footerButtons: { flexDirection: 'row', gap: 24, marginBottom: 36 },
  endLink: { color: 'rgba(231,251,241,0.4)', fontSize: 12, textDecorationLine: 'underline' },

  completeTitle: { color: COLORS.text, fontSize: 24, fontWeight: '300', marginTop: 110, marginBottom: 26 },
  completeStatsRow: { flexDirection: 'row', gap: 36, marginBottom: 26 },
  completeStat: { alignItems: 'center' },
  completeStatValue: { fontSize: 32, fontWeight: '200', color: COLORS.accent },
  completeStatLabel: { color: 'rgba(231,251,241,0.4)', fontSize: 11, marginTop: 4 },
  completeNote: {
    color: 'rgba(231,251,241,0.55)', fontSize: 13, lineHeight: 19,
    textAlign: 'center', paddingHorizontal: 36, marginBottom: 36,
  },
});