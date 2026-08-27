import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  ScrollView,
} from 'react-native';

const { width, height } = Dimensions.get('window');
const AMBIENT_TICK_MS = 50;

// ---------------------------------------------------------------------------
// Three techniques, each mapped to one real mechanism. Pattern Alignment is
// unchanged from the previous version. Bubble Pop and Cloud Floating have
// been replaced — bubble popping didn't need the distress framing to work,
// and cloud steering asked for active fine-motor control, which works
// against the "effortless attention" mechanism it was meant to demonstrate.
// ---------------------------------------------------------------------------
const TECHNIQUES = {
  muscle: {
    id: 'muscle',
    name: 'Muscle Relaxation',
    subtitle: 'Tense & Release',
    description:
      'Gently tighten and release your muscles one by one to quickly let go of physical stress and body tension.',
    citation: '✨ Deep body tension release',
  },
  pattern: {
    id: 'pattern',
    name: 'Pattern Alignment',
    subtitle: 'Color Matching',
    description:
      'A calm color-matching puzzle that gently occupies your mind and clears away stressful thoughts.',
    citation: '✨ Clears overthinking & worry',
  },
  nature: {
    id: 'nature',
    name: 'Calming Nature View',
    subtitle: 'Nature Scenes',
    description:
      'Watch gentle, slowly changing nature scenes with zero effort to rest your mind and restore calm.',
    citation: '✨ Restores calm & lowers stress',
  },
};

const DURATION_OPTIONS_MIN = [2, 5, 10];

const THEME = {
  muscle: { primary: '#D97706', secondary: '#FCD34D', background: '#1A1206', accent: '#F59E0B' },
  pattern: { primary: '#7E57C2', secondary: '#B39DDB', background: '#140A28', accent: '#9575CD' },
  nature: { primary: '#2E7D5B', secondary: '#A5D6A7', background: '#08150F', accent: '#66BB8F' },
};

const CALM_PALETTE = ['#81D4FA', '#A5D6A7', '#CE93D8', '#FFCC80'];

// ===========================================================================
// Activity 1 — Progressive Muscle Relaxation
// A fixed tense (5s) / release (10s) cycle through major muscle groups,
// looping for the length of the session. No score — completing a group is
// its own thing, not a point total.
// ===========================================================================
const TENSE_SECONDS = 5;
const RELEASE_SECONDS = 10;

const MUSCLE_GROUPS = [
  { id: 'hands', label: 'Hands & Forearms', tenseCue: 'Clench your fists tightly', releaseCue: 'Let your hands go completely loose' },
  { id: 'arms', label: 'Upper Arms', tenseCue: 'Bend your elbows, tighten your biceps', releaseCue: 'Let your arms fall heavy and loose' },
  { id: 'shoulders', label: 'Shoulders & Neck', tenseCue: 'Raise your shoulders toward your ears', releaseCue: 'Drop your shoulders, soften your neck' },
  { id: 'face', label: 'Face', tenseCue: 'Scrunch your whole face tightly', releaseCue: 'Let your face go completely smooth' },
  { id: 'torso', label: 'Chest & Stomach', tenseCue: 'Tighten your stomach and chest', releaseCue: 'Let your breath settle and soften' },
  { id: 'legs', label: 'Legs & Feet', tenseCue: 'Point your toes, tighten your legs', releaseCue: 'Let your legs feel heavy and loose' },
];

const MuscleRelaxationActivity = ({ colors, onTally }) => {
  const [groupIndex, setGroupIndex] = useState(0);
  const [phase, setPhase] = useState('tense'); // 'tense' | 'release'
  const [secondsLeft, setSecondsLeft] = useState(TENSE_SECONDS);

  const scale = useRef(new Animated.Value(0.85)).current;
  const warmth = useRef(new Animated.Value(0)).current; // 0 = cool/release, 1 = warm/tense
  const tickRef = useRef(null);

  const animatePhase = (nextPhase) => {
    Animated.timing(scale, {
      toValue: nextPhase === 'tense' ? 1.18 : 0.85,
      duration: (nextPhase === 'tense' ? TENSE_SECONDS : RELEASE_SECONDS) * 1000 * 0.6,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
    Animated.timing(warmth, {
      toValue: nextPhase === 'tense' ? 1 : 0,
      duration: 500,
      useNativeDriver: false,
    }).start();
  };

  useEffect(() => {
    animatePhase('tense');
    tickRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev > 1) return prev - 1;

        setPhase(prevPhase => {
          if (prevPhase === 'tense') {
            animatePhase('release');
            setSecondsLeft(RELEASE_SECONDS);
            return 'release';
          } else {
            onTally();
            if (Platform.OS !== 'web') Vibration.vibrate(10);
            setGroupIndex(gi => (gi + 1) % MUSCLE_GROUPS.length);
            animatePhase('tense');
            setSecondsLeft(TENSE_SECONDS);
            return 'tense';
          }
        });
        return prev;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const group = MUSCLE_GROUPS[groupIndex];
  const glowColor = warmth.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.secondary, '#F59E0B'],
  });

  return (
    <View style={activityStyles.centerWrap}>
      <Animated.View
        style={[
          activityStyles.muscleOrb,
          {
            borderColor: glowColor,
            backgroundColor: `${colors.primary}22`,
            transform: [{ scale }],
          },
        ]}
      >
        <Text style={activityStyles.musclePhaseWord}>{phase === 'tense' ? 'Tense' : 'Release'}</Text>
        <Text style={activityStyles.muscleCountdown}>{secondsLeft}</Text>
      </Animated.View>

      <Text style={[activityStyles.muscleGroupLabel, { color: colors.secondary }]}>{group.label}</Text>
      <Text style={activityStyles.muscleCue}>
        {phase === 'tense' ? group.tenseCue : group.releaseCue}
      </Text>
    </View>
  );
};

// ===========================================================================
// Activity 2 — Pattern Alignment (unchanged — visuospatial working-memory
// occupation, self-paced color matching, no timer pressure inside the task)
// ===========================================================================
const GRID_SIZE = 9;

const PatternAlignActivity = ({ colors, onTally }) => {
  const makePattern = () =>
    Array.from({ length: GRID_SIZE }, () => Math.floor(Math.random() * CALM_PALETTE.length));

  const [target, setTarget] = useState(makePattern);
  const [cells, setCells] = useState(() => makePattern());
  const [justAligned, setJustAligned] = useState(false);

  const cycleCell = (index) => {
    if (justAligned) return;
    setCells(prev => {
      const next = [...prev];
      next[index] = (next[index] + 1) % CALM_PALETTE.length;
      return next;
    });
  };

  useEffect(() => {
    const allMatch = cells.every((c, i) => c === target[i]);
    if (allMatch && !justAligned) {
      setJustAligned(true);
      onTally();
      if (Platform.OS !== 'web') Vibration.vibrate(14);
      setTimeout(() => {
        setTarget(makePattern());
        setCells(makePattern());
        setJustAligned(false);
      }, 1100);
    }
  }, [cells]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={activityStyles.patternWrap}>
      <Text style={[activityStyles.hint, { color: colors.secondary, marginBottom: 18 }]}>
        Match each tile to the reference pattern
      </Text>

      <View style={activityStyles.referenceGrid}>
        {target.map((colorIdx, i) => (
          <View
            key={i}
            style={[activityStyles.referenceCell, { backgroundColor: CALM_PALETTE[colorIdx] }]}
          />
        ))}
      </View>

      <View style={[activityStyles.mainGrid, justAligned && { opacity: 0.6 }]}>
        {cells.map((colorIdx, i) => {
          const matched = colorIdx === target[i];
          return (
            <TouchableOpacity
              key={i}
              onPress={() => cycleCell(i)}
              style={[
                activityStyles.mainCell,
                {
                  backgroundColor: CALM_PALETTE[colorIdx],
                  borderColor: matched ? '#fff' : 'rgba(255,255,255,0.15)',
                  borderWidth: matched ? 2 : 1,
                },
              ]}
            />
          );
        })}
      </View>

      {justAligned && (
        <Text style={[activityStyles.alignedText, { color: colors.accent }]}>Aligned</Text>
      )}
    </View>
  );
};

// ===========================================================================
// Activity 3 — Single-Location Nature Focal Point & Soft Fascination
// A centered, biophilic nature focal orb that gently breathes and pulses.
// Focus your attention on the single central location to lower stress & restore calm.
// ===========================================================================
const NatureRestorationActivity = ({ colors, onTally }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [particles, setParticles] = useState([]);
  const [ripples, setRipples] = useState([]);

  // Rhythmic breathing pulse for the central nature focal point
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 3500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 3500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 30000,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();
  }, []);

  // Ambient particle tick
  useEffect(() => {
    const timer = setInterval(() => {
      // Fade out particles
      setParticles(prev =>
        prev.map(p => ({ ...p, opacity: p.opacity - 0.04, y: p.y - 0.6 }))
          .filter(p => p.opacity > 0)
      );

      // Expand nature ripples from focal point
      setRipples(prev =>
        prev.map(r => ({ ...r, radius: r.radius + 1.8, opacity: r.opacity - 0.025 }))
          .filter(r => r.opacity > 0)
      );
    }, AMBIENT_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  // Tap central nature focal point to release stress
  const handleFocalTap = () => {
    if (Platform.OS !== 'web') Vibration.vibrate(14);
    if (onTally) onTally();

    // Create expanding biophilic ripple ring from center
    setRipples(prev => [
      ...prev,
      { id: Math.random(), radius: 40, opacity: 0.8 }
    ]);

    // Create radiating firefly & petal particles
    const newParticles = Array.from({ length: 8 }, () => ({
      id: Math.random(),
      x: (width || 360) / 2 + (Math.random() * 100 - 50),
      y: (height || 600) / 3 + (Math.random() * 100 - 50),
      opacity: 1.0,
      sparkle: ['✨', '🍃', '🌸', '🪷', '🌟', '💫'][Math.floor(Math.random() * 6)]
    }));
    setParticles(prev => [...prev, ...newParticles]);
  };

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={activityStyles.natureContainer}>
      {/* Background Ambient Glow */}
      <View style={activityStyles.natureGlowAura} />

      {/* Radiating Water & Nature Ripples */}
      {ripples.map(r => (
        <View
          key={r.id}
          style={{
            position: 'absolute',
            top: '38%',
            alignSelf: 'center',
            width: r.radius * 2,
            height: r.radius * 2,
            marginTop: -r.radius,
            borderRadius: r.radius,
            borderWidth: 1.5,
            borderColor: '#34D399',
            opacity: r.opacity,
          }}
        />
      ))}

      {/* Radiating Fireflies & Petals */}
      {particles.map(p => (
        <Text
          key={p.id}
          style={{
            position: 'absolute', left: p.x, top: p.y,
            fontSize: 18, opacity: p.opacity,
          }}
        >
          {p.sparkle}
        </Text>
      ))}

      {/* Single Location Central Nature Focal Orb */}
      <View style={activityStyles.focalWrap}>
        <Text style={activityStyles.focalHeaderLabel}>NATURE FOCAL POINT</Text>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleFocalTap}
          style={{ alignItems: 'center', justifyContent: 'center' }}
        >
          {/* Outer Breathing Ring */}
          <Animated.View
            style={[
              activityStyles.outerBreathingRing,
              {
                transform: [{ scale: pulseAnim }],
                borderColor: 'rgba(52, 211, 153, 0.4)',
                backgroundColor: 'rgba(52, 211, 153, 0.06)',
              }
            ]}
          />

          {/* Inner Pulsing Lotus Orb */}
          <Animated.View
            style={[
              activityStyles.innerLotusOrb,
              {
                transform: [
                  { scale: pulseAnim }
                ],
                borderColor: '#34D399',
                backgroundColor: '#0F3826',
              }
            ]}
          >
            <Text style={activityStyles.lotusIcon}>🪷</Text>
          </Animated.View>
        </TouchableOpacity>

        <Text style={activityStyles.focalSubLabel}>Tap center to focus & release stress</Text>
      </View>

      {/* Bottom Guidance Banner (Fixed Width & Centered Text) */}
      <View style={activityStyles.hintBanner}>
        <Text style={activityStyles.hintBannerText}>
          Focus your attention on the glowing nature center & tap to release stress 🪷✨
        </Text>
      </View>
    </View>
  );
};

const activityStyles = StyleSheet.create({
  hint: {
    position: 'absolute', bottom: 40, alignSelf: 'center', fontSize: 12, opacity: 0.8, fontWeight: '600'
  },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  muscleOrb: {
    width: 190, height: 190, borderRadius: 95, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  musclePhaseWord: { color: '#fff', fontSize: 18, fontWeight: '400', marginBottom: 6 },
  muscleCountdown: { color: '#fff', fontSize: 40, fontWeight: '200' },
  muscleGroupLabel: { fontSize: 16, fontWeight: '500', marginBottom: 8 },
  muscleCue: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center', lineHeight: 19 },

  patternWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  referenceGrid: {
    width: 90, flexDirection: 'row', flexWrap: 'wrap', marginBottom: 26,
    borderRadius: 8, overflow: 'hidden',
  },
  referenceCell: { width: 30, height: 30 },
  mainGrid: {
    width: 210, flexDirection: 'row', flexWrap: 'wrap',
    borderRadius: 14, overflow: 'hidden',
  },
  mainCell: { width: 70, height: 70 },
  alignedText: { fontSize: 16, fontWeight: '600', marginTop: 16 },

  natureContainer: {
    flex: 1,
    backgroundColor: '#04150E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  natureGlowAura: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
  },
  focalWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  focalHeaderLabel: {
    color: '#A7F3D0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 28,
    opacity: 0.8,
  },
  outerBreathingRing: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    position: 'absolute',
  },
  innerLotusOrb: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#34D399',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 8,
  },
  lotusIcon: {
    fontSize: 52,
  },
  focalSubLabel: {
    color: '#6EE7B7',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 32,
  },
  hintBanner: {
    position: 'absolute',
    bottom: 24,
    width: '88%',
    backgroundColor: 'rgba(15, 56, 38, 0.7)',
    borderColor: 'rgba(52, 211, 153, 0.3)',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintBannerText: {
    color: '#A7F3D0',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  }
});

// ===========================================================================
// Top-level session shell (setup → session → complete)
// ===========================================================================
export const GroundedStressReliefSession = ({ mode, subOptionId, initialMode, onFinish }) => {
  const getInitialTechnique = () => {
    const raw = (mode || subOptionId || initialMode || '').toLowerCase();
    if (raw === 'pattern' || raw === 'pattern_align') return 'pattern';
    if (raw === 'nature' || raw === 'cloud_float') return 'nature';
    return 'muscle';
  };

  const [screen, setScreen] = useState('setup');
  const [techniqueId, setTechniqueId] = useState(getInitialTechnique);
  const [durationMin, setDurationMin] = useState(2);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tally, setTally] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const tickRef = useRef(null);
  const screenFade = useRef(new Animated.Value(1)).current;

  const technique = TECHNIQUES[techniqueId] || TECHNIQUES.muscle;
  const colors = THEME[techniqueId] || THEME.muscle;
  const totalSeconds = durationMin * 60;

  useEffect(() => {
    if (screen !== 'session') return;
    tickRef.current = setInterval(() => {
      if (isPaused) return;
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
  }, [screen, isPaused, totalSeconds]);

  const fadeTo = (next) => {
    Animated.timing(screenFade, { toValue: 0, duration: 180, useNativeDriver: false }).start(() => {
      setScreen(next);
      Animated.timing(screenFade, { toValue: 1, duration: 260, useNativeDriver: false }).start();
    });
  };

  const startSession = () => {
    setElapsedSeconds(0);
    setTally(0);
    setIsPaused(false);
    fadeTo('session');
  };

  const endSessionEarly = () => {
    clearInterval(tickRef.current);
    fadeTo('complete');
  };

  const handleTally = useCallback(() => setTally(t => t + 1), []);

  const tallyLabel =
    techniqueId === 'muscle' ? 'muscle groups released' :
      techniqueId === 'pattern' ? 'patterns aligned' :
        'nature focal points released';

  if (screen === 'setup') {
    return (
      <Animated.View style={[styles.container, { backgroundColor: '#0A1628', opacity: screenFade }]}>
        <ScrollView contentContainerStyle={styles.setupScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.setupTitle}>Grounding Exercises</Text>
          <Text style={styles.setupSubtitle}>
            Simple, calming activities designed to help you relax your mind and body without any rush.
          </Text>

          <Text style={styles.sectionLabel}>Choose a technique</Text>
          {Object.values(TECHNIQUES).map(t => {
            const selected = t.id === techniqueId;
            const c = THEME[t.id];
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => setTechniqueId(t.id)}
                style={[
                  styles.techCard,
                  { borderColor: selected ? c.accent : 'rgba(255,255,255,0.08)' },
                  selected && { backgroundColor: `${c.accent}18` },
                ]}
              >
                <View style={styles.techCardHeader}>
                  <Text style={styles.techName}>{t.name}</Text>
                  <Text style={[styles.techSubtitle, { color: c.accent }]}>{t.subtitle}</Text>
                </View>
                <Text style={styles.techDescription}>{t.description}</Text>
                <Text style={styles.techCitation}>{t.citation}</Text>
              </TouchableOpacity>
            );
          })}

          <Text style={styles.sectionLabel}>Session length</Text>
          <View style={styles.durationRow}>
            {DURATION_OPTIONS_MIN.map(min => (
              <TouchableOpacity
                key={min}
                onPress={() => setDurationMin(min)}
                style={[
                  styles.durationChip,
                  durationMin === min && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
              >
                <Text style={[styles.durationChipText, durationMin === min && { color: '#0A1628' }]}>
                  {min} min
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={[styles.startButton, { backgroundColor: colors.accent }]} onPress={startSession}>
            <Text style={styles.startButtonText}>Begin Session ({durationMin} min)</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            A relaxation exercise, not a substitute for medical or mental health care.
          </Text>
        </ScrollView>
      </Animated.View>
    );
  }

  if (screen === 'session') {
    const progress = Math.min(1, elapsedSeconds / totalSeconds);
    return (
      <Animated.View style={[styles.container, { backgroundColor: colors.background, opacity: screenFade }]}>
        <View style={styles.sessionProgressTrack}>
          <View style={[styles.sessionProgressFill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]} />
        </View>

        <View style={styles.techniqueHeader}>
          <Text style={styles.techniqueHeaderText}>{technique.name}</Text>
          <Text style={styles.techniqueHeaderSub}>
            {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
            {'  /  '}
            {durationMin}:00
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          {techniqueId === 'muscle' && <MuscleRelaxationActivity colors={colors} onTally={handleTally} />}
          {techniqueId === 'pattern' && <PatternAlignActivity colors={colors} onTally={handleTally} />}
          {techniqueId === 'nature' && <NatureRestorationActivity colors={colors} onTally={handleTally} />}
        </View>

        <View style={styles.sessionFooter}>
          {tallyLabel && <Text style={styles.breathCountText}>{tally} {tallyLabel}</Text>}
          <View style={styles.footerButtons}>
            <TouchableOpacity onPress={() => setIsPaused(p => !p)}>
              <Text style={styles.endLink}>{isPaused ? 'Resume' : 'Pause'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={endSessionEarly}>
              <Text style={styles.endLink}>End session</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    );
  }

  // complete screen
  const minutesDone = (elapsedSeconds / 60).toFixed(1);
  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.background, opacity: screenFade }]}>
      <Text style={styles.completeTitle}>Session Complete</Text>
      <View style={styles.completeStatsRow}>
        {tallyLabel && (
          <View style={styles.completeStat}>
            <Text style={[styles.completeStatValue, { color: colors.accent }]}>{tally}</Text>
            <Text style={styles.completeStatLabel}>{tallyLabel}</Text>
          </View>
        )}
        <View style={styles.completeStat}>
          <Text style={[styles.completeStatValue, { color: colors.accent }]}>{minutesDone}</Text>
          <Text style={styles.completeStatLabel}>minutes</Text>
        </View>
      </View>
      <Text style={styles.completeNote}>{technique.description}</Text>

      <TouchableOpacity style={[styles.startButton, { backgroundColor: colors.accent }]} onPress={() => onFinish ? onFinish() : startSession()}>
        <Text style={styles.startButtonText}>Complete Exercise & Submit Rating →</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => fadeTo('setup')}>
        <Text style={styles.secondaryButtonText}>Choose another technique</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Backward-compatible aliases for existing imports.
export const CognitiveDeStressGame = GroundedStressReliefSession;
export const SensoryGroundingSession = GroundedStressReliefSession;

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', overflow: 'hidden' },

  setupScroll: { paddingTop: 60, paddingHorizontal: 24, paddingBottom: 40, width: '100%' },
  setupTitle: { color: '#fff', fontSize: 28, fontWeight: '300', marginBottom: 8 },
  setupSubtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 19, marginBottom: 28 },
  sectionLabel: {
    color: 'rgba(255,255,255,0.4)', fontSize: 11, textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 10, marginTop: 6,
  },
  techCard: {
    borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  techCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  techName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  techSubtitle: { fontSize: 13, fontWeight: '600' },
  techDescription: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 17, marginBottom: 6 },
  techCitation: { color: 'rgba(255,255,255,0.3)', fontSize: 10, fontStyle: 'italic' },
  durationRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  durationChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 18,
  },
  durationChipText: { color: '#fff', fontSize: 13 },
  startButton: { borderRadius: 26, paddingVertical: 15, alignItems: 'center', marginBottom: 14, width: '100%' },
  startButtonText: { color: '#0A1628', fontSize: 16, fontWeight: '600' },
  secondaryButton: { paddingVertical: 10, alignItems: 'center' },
  secondaryButtonText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  disclaimer: { color: 'rgba(255,255,255,0.25)', fontSize: 10, textAlign: 'center', marginTop: 4 },

  sessionProgressTrack: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sessionProgressFill: { height: '100%' },
  techniqueHeader: { alignItems: 'center', marginTop: 50, marginBottom: 6 },
  techniqueHeaderText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '500' },
  techniqueHeaderSub: { color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 3 },

  sessionFooter: { alignItems: 'center', marginBottom: 40, gap: 8 },
  breathCountText: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  footerButtons: { flexDirection: 'row', gap: 24 },
  endLink: { color: 'rgba(255,255,255,0.35)', fontSize: 12, textDecorationLine: 'underline' },

  completeTitle: { color: '#fff', fontSize: 24, fontWeight: '300', marginTop: 120, marginBottom: 30 },
  completeStatsRow: { flexDirection: 'row', gap: 50, marginBottom: 30 },
  completeStat: { alignItems: 'center' },
  completeStatValue: { fontSize: 36, fontWeight: '200' },
  completeStatLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 },
  completeNote: {
    color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 19,
    textAlign: 'center', paddingHorizontal: 36, marginBottom: 40,
  },
});