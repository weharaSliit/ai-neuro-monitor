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
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeContext } from '../context/ThemeContext';

const { width, height } = Dimensions.get('window');
const AMBIENT_TICK_MS = 50;

// ---------------------------------------------------------------------------
// Enhanced Healthcare Relaxation Guide with Gamification
// ---------------------------------------------------------------------------
const TECHNIQUES = {
  soft_fascination: {
    id: 'soft_fascination',
    name: '🌿 Nature Restoration Viewing',
    subtitle: 'WESAD Rank #7 Priority',
    description:
      'Watch gentle, slowly changing biophilic nature scenes asking nothing of directed attention to restore cognitive calm.',
    citation: '✨ WESAD Rank #7 · Biophilic Attention Restoration',
    emoji: '🌿',
    color: '#059669',
  },
  progressive_muscle: {
    id: 'progressive_muscle',
    name: '🧘 Progressive Muscle Release',
    subtitle: 'WESAD Rank #8 Priority',
    description:
      'Gently tighten and release muscle groups in sequence to discharge physical cortisol and body tension.',
    citation: '✨ WESAD Rank #8 · Somatic Tension Discharge',
    emoji: '🧘',
    color: '#D97706',
  },
  guided_imagery: {
    id: 'guided_imagery',
    name: '🌲 Guided Forest Walk',
    subtitle: 'WESAD Rank #9 Priority',
    description:
      'Multisensory guided forest trail walk with atmospheric canopy mist to shift focus away from intrusive anxiety loops.',
    citation: '✨ WESAD Rank #9 · Forest Trail Imagery Walk',
    emoji: '🌲',
    color: '#047857',
  },
  pattern_alignment: {
    id: 'pattern_alignment',
    name: '🎯 Visuospatial Memory Alignment',
    subtitle: 'WESAD Rank #10 Priority',
    description:
      'A calm visuospatial color-matching puzzle that occupies central executive memory to clear intrusive worry.',
    citation: '✨ WESAD Rank #10 · Visuospatial Working Memory Focus',
    emoji: '🎯',
    color: '#7E57C2',
  },
};

const DURATION_OPTIONS_MIN = [1, 2, 3, 5];

const THEME = {
  soft_fascination: { primary: '#059669', secondary: '#A7F3D0', background: '#041B13', accent: '#10B981' },
  progressive_muscle: { primary: '#D97706', secondary: '#FCD34D', background: '#1A1206', accent: '#F59E0B' },
  guided_imagery: { primary: '#047857', secondary: '#6EE7B7', background: '#031912', accent: '#059669' },
  pattern_alignment: { primary: '#7E57C2', secondary: '#B39DDB', background: '#140A28', accent: '#9575CD' },
};

const CALM_PALETTE = ['#81D4FA', '#A5D6A7', '#CE93D8', '#FFCC80', '#FFAB91'];

// ===========================================================================
// Activity 1 — Progressive Muscle Relaxation (Enhanced with Visuals)
// ===========================================================================
const TENSE_SECONDS = 5;
const RELEASE_SECONDS = 10;

const MUSCLE_GROUPS = [
  { id: 'hands', label: '🤲 Hands & Forearms', tenseCue: 'Clench your fists tightly', releaseCue: 'Let your hands go completely loose', icon: '✊' },
  { id: 'arms', label: '💪 Upper Arms', tenseCue: 'Bend your elbows, tighten your biceps', releaseCue: 'Let your arms fall heavy and loose', icon: '💪' },
  { id: 'shoulders', label: '🫂 Shoulders & Neck', tenseCue: 'Raise your shoulders toward your ears', releaseCue: 'Drop your shoulders, soften your neck', icon: '🫂' },
  { id: 'face', label: '😌 Face', tenseCue: 'Scrunch your whole face tightly', releaseCue: 'Let your face go completely smooth', icon: '😌' },
  { id: 'torso', label: '🫁 Chest & Stomach', tenseCue: 'Tighten your stomach and chest', releaseCue: 'Let your breath settle and soften', icon: '🫁' },
  { id: 'legs', label: '🦵 Legs & Feet', tenseCue: 'Point your toes, tighten your legs', releaseCue: 'Let your legs feel heavy and loose', icon: '🦵' },
];

const MuscleRelaxationActivity = ({ colors, onTally }) => {
  const [groupIndex, setGroupIndex] = useState(0);
  const [phase, setPhase] = useState('tense'); // 'tense' | 'release'
  const [secondsLeft, setSecondsLeft] = useState(TENSE_SECONDS);
  const [isHolding, setIsHolding] = useState(false);
  const [energyBalls, setEnergyBalls] = useState([]);
  const [completedGroups, setCompletedGroups] = useState([]);

  const scale = useRef(new Animated.Value(0.9)).current;
  const warmth = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation during active holding
  useEffect(() => {
    if (isHolding && phase === 'tense') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 400, useNativeDriver: false }),
          Animated.timing(pulseAnim, { toValue: 0.96, duration: 400, useNativeDriver: false }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isHolding, phase]);

  // Phase countdown timer — 100% safe side-effect handling
  useEffect(() => {
    let timer = null;
    if (phase === 'tense' && isHolding) {
      timer = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            triggerRelease();
            return RELEASE_SECONDS;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (phase === 'release') {
      timer = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            advanceToNextGroup();
            return TENSE_SECONDS;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [phase, isHolding]);

  const triggerRelease = () => {
    setPhase('release');
    setIsHolding(false);
    setSecondsLeft(RELEASE_SECONDS);
    if (Platform.OS !== 'web') Vibration.vibrate([0, 40, 80, 120]);
    spawnEnergyBalls();

    // Trigger parent tally safely outside render/updater cycle
    setTimeout(() => {
      if (onTally) onTally();
    }, 50);

    Animated.parallel([
      Animated.timing(scale, { toValue: 0.85, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(warmth, { toValue: 0, duration: 600, useNativeDriver: false }),
    ]).start();
  };

  const advanceToNextGroup = () => {
    setCompletedGroups(prev => [...new Set([...prev, MUSCLE_GROUPS[groupIndex].id])]);
    const nextIdx = (groupIndex + 1) % MUSCLE_GROUPS.length;
    setGroupIndex(nextIdx);
    setPhase('tense');
    setSecondsLeft(TENSE_SECONDS);
    setIsHolding(false);

    Animated.parallel([
      Animated.timing(scale, { toValue: 0.9, duration: 600, useNativeDriver: false }),
      Animated.timing(warmth, { toValue: 1, duration: 600, useNativeDriver: false }),
    ]).start();
  };

  const handlePressIn = () => {
    if (phase !== 'tense') return;
    setIsHolding(true);
    if (Platform.OS !== 'web') Vibration.vibrate(25);
    Animated.parallel([
      Animated.timing(scale, { toValue: 1.2, duration: 500, useNativeDriver: false }),
      Animated.timing(warmth, { toValue: 1, duration: 400, useNativeDriver: false }),
    ]).start();
  };

  const handlePressOut = () => {
    if (phase === 'tense' && isHolding) {
      setIsHolding(false);
      Animated.timing(scale, { toValue: 0.9, duration: 400, useNativeDriver: false }).start();
    }
  };

  const spawnEnergyBalls = () => {
    const newBalls = Array.from({ length: 12 }, () => ({
      id: Math.random(),
      x: (Math.random() - 0.5) * 220,
      y: (Math.random() - 0.5) * 220,
      size: Math.random() * 24 + 8,
    }));
    setEnergyBalls(newBalls);
    setTimeout(() => setEnergyBalls([]), 2200);
  };

  const group = MUSCLE_GROUPS[groupIndex];

  return (
    <View style={activityStyles.centerWrap}>
      {/* Energy particles on release */}
      {energyBalls.map(ball => (
        <Animated.View
          key={ball.id}
          style={{
            position: 'absolute',
            width: ball.size,
            height: ball.size,
            borderRadius: ball.size / 2,
            backgroundColor: '#FFD700',
            opacity: 0.8,
            transform: [{ translateX: ball.x }, { translateY: ball.y }],
          }}
        />
      ))}

      {/* Muscle Region Quick Selectors */}
      <View style={activityStyles.muscleRegionBar}>
        {MUSCLE_GROUPS.map((g, idx) => {
          const isDone = completedGroups.includes(g.id);
          const isCurrent = idx === groupIndex;
          return (
            <TouchableOpacity
              key={g.id}
              onPress={() => {
                setGroupIndex(idx);
                setPhase('tense');
                setSecondsLeft(TENSE_SECONDS);
                setIsHolding(false);
              }}
              style={[
                activityStyles.muscleRegionChip,
                isCurrent && { backgroundColor: colors.accent || '#F59E0B', borderColor: colors.accent || '#F59E0B' },
                isDone && !isCurrent && { backgroundColor: `${colors.secondary}30`, borderColor: colors.secondary }
              ]}
            >
              <Text style={{ fontSize: 11 }}>{g.icon}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Interactive Muscle Orb Container */}
      <TouchableOpacity
        activeOpacity={0.9}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={phase === 'release'}
        style={{ marginVertical: 10 }}
      >
        <Animated.View
          style={[
            activityStyles.muscleOrb,
            {
              borderColor: phase === 'tense' ? (isHolding ? '#F59E0B' : colors.secondary) : '#10B981',
              backgroundColor: phase === 'tense' ? (isHolding ? 'rgba(245,158,11,0.25)' : `${colors.primary}22`) : 'rgba(16,185,129,0.25)',
              transform: [{ scale: Animated.multiply(scale, pulseAnim) }],
            },
          ]}
        >
          <Text style={activityStyles.muscleIcon}>{group.icon}</Text>
          <Text style={[activityStyles.musclePhaseWord, { color: phase === 'tense' ? (isHolding ? '#F59E0B' : '#FFFFFF') : '#10B981' }]}>
            {phase === 'tense' ? (isHolding ? '⚡ SQUEEZING...' : '👇 HOLD TO TENSE') : '🌀 RELEASING...'}
          </Text>
          <Text style={activityStyles.muscleCountdown}>{secondsLeft}s</Text>
        </Animated.View>
      </TouchableOpacity>

      <Text style={[activityStyles.muscleGroupLabel, { color: colors.secondary }]}>
        {group.label}
      </Text>
      <Text style={activityStyles.muscleCue}>
        {phase === 'tense'
          ? (isHolding ? `⚡ ${group.tenseCue} — Keep Squeezing!` : `🔹 Press & HOLD button to ${group.tenseCue.toLowerCase()}`)
          : `🔸 ${group.releaseCue} — Feel the tension dissolving.`}
      </Text>

      {/* Interactive Guidance Hint */}
      <View style={activityStyles.holdHintBar}>
        <Text style={activityStyles.holdHintTxt}>
          {phase === 'tense'
            ? '💡 Physical Action: Press & Hold the orb to squeeze your muscles for 5s'
            : '✨ Somatic Release: Let muscles sink completely loose & heavy'}
        </Text>
      </View>
    </View>
  );
};

// ===========================================================================
// Activity 2 — Pattern Alignment (Gamified with Score)
// ===========================================================================
const GRID_SIZE = 9;

const PatternAlignActivity = ({ colors, onTally }) => {
  const makePattern = () =>
    Array.from({ length: GRID_SIZE }, () => Math.floor(Math.random() * CALM_PALETTE.length));

  const [target, setTarget] = useState(makePattern);
  const [cells, setCells] = useState(() => makePattern());
  const [justAligned, setJustAligned] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [floatingTexts, setFloatingTexts] = useState([]);

  const cycleCell = (index) => {
    if (justAligned) return;
    setCells(prev => {
      const next = [...prev];
      next[index] = (next[index] + 1) % CALM_PALETTE.length;
      return next;
    });
    // Haptic feedback
    if (Platform.OS !== 'web') Vibration.vibrate(5);
  };

  useEffect(() => {
    const allMatch = cells.every((c, i) => c === target[i]);
    if (allMatch && !justAligned) {
      setJustAligned(true);
      const newCombo = combo + 1;
      setCombo(newCombo);
      const points = newCombo * 10;
      setScore(prev => prev + points);
      onTally();

      // Show floating text
      const text = `+${points} ✨`;
      setFloatingTexts(prev => [...prev, { id: Math.random(), text, y: 0, opacity: 1 }]);
      setTimeout(() => {
        setFloatingTexts(prev => prev.filter(t => t.id !== floatingTexts[0]?.id));
      }, 1500);

      if (Platform.OS !== 'web') Vibration.vibrate(14);
      setTimeout(() => {
        setTarget(makePattern());
        setCells(makePattern());
        setJustAligned(false);
      }, 1200);
    }
  }, [cells]);

  return (
    <View style={activityStyles.patternWrap}>
      {/* Score display */}
      <View style={activityStyles.scoreDisplay}>
        <Text style={[activityStyles.scoreText, { color: colors.accent }]}>
          🏆 Score: {score}
        </Text>
        {combo > 0 && (
          <Text style={[activityStyles.comboText, { color: colors.secondary }]}>
            🔥 Combo: {combo}
          </Text>
        )}
      </View>

      {/* Floating texts */}
      {floatingTexts.map(ft => (
        <Animated.Text
          key={ft.id}
          style={[
            activityStyles.floatingText,
            {
              transform: [{ translateY: ft.y }],
              opacity: ft.opacity,
            }
          ]}
        >
          {ft.text}
        </Animated.Text>
      ))}

      <Text style={[activityStyles.hint, { color: colors.secondary, marginBottom: 18 }]}>
        Match each tile to the reference pattern 🎯
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
                  borderWidth: matched ? 3 : 1,
                },
              ]}
            />
          );
        })}
      </View>

      {justAligned && (
        <Text style={[activityStyles.alignedText, { color: colors.accent }]}>
          ✅ Aligned! 🎉
        </Text>
      )}
    </View>
  );
};

// ===========================================================================
// Activity 3 — Nature Restoration (Immersive with Interactive Elements)
// ===========================================================================
const NatureRestorationActivity = ({ colors, onTally }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [particles, setParticles] = useState([]);
  const [ripples, setRipples] = useState([]);
  const [stressLevel, setStressLevel] = useState(100);
  const [breathCount, setBreathCount] = useState(0);

  // Rhythmic breathing pulse
  useEffect(() => {
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    breathLoop.start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 30000,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();

    return () => breathLoop.stop();
  }, []);

  // Ambient particles
  useEffect(() => {
    const timer = setInterval(() => {
      setParticles(prev =>
        prev.map(p => ({ ...p, opacity: p.opacity - 0.03, y: p.y - 0.8 }))
          .filter(p => p.opacity > 0)
      );

      setRipples(prev =>
        prev.map(r => ({ ...r, radius: r.radius + 2, opacity: r.opacity - 0.03 }))
          .filter(r => r.opacity > 0)
      );
    }, AMBIENT_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  const handleFocalTap = () => {
    if (Platform.OS !== 'web') Vibration.vibrate(14);
    if (onTally) onTally();

    // Reduce stress
    setStressLevel(prev => Math.max(0, prev - 5));
    setBreathCount(prev => prev + 1);

    // Create ripple effect
    setRipples(prev => [
      ...prev,
      { id: Math.random(), radius: 30, opacity: 0.9 }
    ]);

    // Create particles
    const natureEmojis = ['🌸', '🍃', '🪷', '🌺', '💫', '✨', '🦋', '🌿'];
    const newParticles = Array.from({ length: 12 }, () => ({
      id: Math.random(),
      x: (width || 360) / 2 + (Math.random() * 120 - 60),
      y: (height || 600) / 3 + (Math.random() * 120 - 60),
      opacity: 1.0,
      emoji: natureEmojis[Math.floor(Math.random() * natureEmojis.length)],
      scale: Math.random() * 0.5 + 0.5,
    }));
    setParticles(prev => [...prev, ...newParticles]);
  };

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={activityStyles.natureContainer}>
      {/* Stress level indicator */}
      <View style={activityStyles.stressIndicator}>
        <Text style={activityStyles.stressLabel}>🧘 Stress Level</Text>
        <View style={activityStyles.stressBar}>
          <Animated.View
            style={[
              activityStyles.stressFill,
              {
                width: `${stressLevel}%`,
                backgroundColor: stressLevel > 70 ? '#EF4444' :
                  stressLevel > 40 ? '#F59E0B' : '#10B981'
              }
            ]}
          />
        </View>
        <Text style={activityStyles.stressValue}>{stressLevel}%</Text>
      </View>

      {/* Breath count */}
      <Text style={activityStyles.breathCounter}>
        🌬️ Breaths: {breathCount}
      </Text>

      {/* Background Ambient Glow */}
      <View style={activityStyles.natureGlowAura} />

      {/* Ripples */}
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
            borderWidth: 2,
            borderColor: '#34D399',
            opacity: r.opacity,
          }}
        />
      ))}

      {/* Particles */}
      {particles.map(p => (
        <Animated.Text
          key={p.id}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            fontSize: 20 * p.scale,
            opacity: p.opacity,
            transform: [{ scale: p.scale }],
          }}
        >
          {p.emoji}
        </Animated.Text>
      ))}

      {/* Central Nature Orb */}
      <View style={activityStyles.focalWrap}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleFocalTap}
          style={{ alignItems: 'center', justifyContent: 'center' }}
        >
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

          <Animated.View
            style={[
              activityStyles.innerLotusOrb,
              {
                transform: [{ scale: pulseAnim }, { rotate: rotateInterpolate }],
                borderColor: '#34D399',
                backgroundColor: '#0F3826',
              }
            ]}
          >
            <Text style={activityStyles.lotusIcon}>🪷</Text>
            <Text style={activityStyles.breathHint}>Tap to relax</Text>
          </Animated.View>
        </TouchableOpacity>

        <Text style={activityStyles.focalSubLabel}>Tap the lotus to release stress 🌸</Text>
      </View>

      {/* Tips */}
      <View style={activityStyles.tipsContainer}>
        <Text style={activityStyles.tipText}>
          💡 Tip: Focus on your breath and the gentle movement
        </Text>
      </View>
    </View>
  );
};

// ===========================================================================
// Activity 4 — Guided Forest Walk (Shinrin-Yoku Biophilic Trail)
// ===========================================================================
const FOREST_STATIONS = [
  {
    id: 'canopy',
    name: '🌲 Ancient Pine Canopy',
    subtitle: 'Shinrin-Yoku Station #1',
    description: 'Inhale deep cedar and pine resin mist. Feel the cool mountain forest canopy breeze.',
    actionIcon: '🌲',
    actionText: 'Inhale Pine Mist',
    color: '#047857',
    ambientEmoji: ['🌲', '🍃', '✨', '💨']
  },
  {
    id: 'stream',
    name: '💧 Crystal Mountain Stream',
    subtitle: 'Shinrin-Yoku Station #2',
    description: 'Dip your hands into the crystal clear mountain spring. Feel the cool water washing away stress.',
    actionIcon: '💧',
    actionText: 'Dip Hand in Stream',
    color: '#38BDF8',
    ambientEmoji: ['💧', '🌊', '✨', '🍃']
  },
  {
    id: 'clearing',
    name: '☀️ Sun-Dappled Clearing',
    subtitle: 'Shinrin-Yoku Station #3',
    description: 'Feel warm golden sunlight filtering through green leaves, warming your forehead and shoulders.',
    actionIcon: '☀️',
    actionText: 'Soak Sun Rays',
    color: '#F59E0B',
    ambientEmoji: ['☀️', '✨', '🍂', '🦋']
  },
  {
    id: 'sanctuary',
    name: '🔔 Mountain Sanctuary Peak',
    subtitle: 'Shinrin-Yoku Station #4',
    description: 'Listen to deep mountain silence and distant bamboo wind chimes. Prefrontal bandwidth restored.',
    actionIcon: '🔔',
    actionText: 'Ring Wind Chime',
    color: '#A78BFA',
    ambientEmoji: ['🔔', '🕊️', '🌸', '✨']
  }
];

const GuidedForestWalkActivity = ({ colors, onTally }) => {
  const [stationIdx, setStationIdx] = useState(0);
  const [stepProgress, setStepProgress] = useState(0);
  const [stepsTaken, setStepsTaken] = useState(0);
  const [particles, setParticles] = useState([]);
  const [breathPhase, setBreathPhase] = useState('inhale');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const currentStation = FOREST_STATIONS[stationIdx];

  // Paced respiration loop
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.14, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0.95, duration: 6000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Inhale/Exhale phase text switcher
  useEffect(() => {
    const interval = setInterval(() => {
      setBreathPhase(p => (p === 'inhale' ? 'exhale' : 'inhale'));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleTakeStep = () => {
    if (Platform.OS !== 'web') Vibration.vibrate(18);

    setStepsTaken(s => s + 1);
    const nextProg = stepProgress + 25;

    // Spawn floating nature particles along path
    const ems = currentStation.ambientEmoji;
    const newP = Array.from({ length: 6 }, () => ({
      id: Math.random(),
      x: (Math.random() - 0.5) * 240,
      y: (Math.random() - 0.5) * 180,
      emoji: ems[Math.floor(Math.random() * ems.length)],
      size: Math.random() * 12 + 16,
    }));
    setParticles(prev => [...prev, ...newP]);
    setTimeout(() => setParticles(p => p.slice(3)), 2000);

    if (nextProg >= 100) {
      setStepProgress(0);
      setStationIdx(prev => (prev + 1) % FOREST_STATIONS.length);
      if (onTally) onTally();
      if (Platform.OS !== 'web') Vibration.vibrate([0, 50, 100, 150]);
    } else {
      setStepProgress(nextProg);
    }
  };

  return (
    <View style={activityStyles.forestContainer}>
      {/* Station Title & Progress Bar Header */}
      <View style={activityStyles.forestHeader}>
        <View style={activityStyles.stationBadgeRow}>
          <Text style={[activityStyles.stationBadgeTxt, { color: currentStation.color }]}>{currentStation.subtitle}</Text>
          <Text style={activityStyles.forestStepsTxt}>👣 {stepsTaken} Steps Taken</Text>
        </View>

        <Text style={activityStyles.stationTitle}>{currentStation.name}</Text>
        <Text style={activityStyles.stationDesc}>{currentStation.description}</Text>

        {/* Trail Progress Bar */}
        <View style={activityStyles.trailProgressTrack}>
          <View style={[activityStyles.trailProgressFill, { width: `${stepProgress}%`, backgroundColor: currentStation.color }]} />
        </View>
      </View>

      {/* Interactive Forest Canvas Area */}
      <View style={activityStyles.forestCanvas}>
        {/* Floating Particles */}
        {particles.map(p => (
          <Text
            key={p.id}
            style={{
              position: 'absolute',
              fontSize: p.size,
              transform: [{ translateX: p.x }, { translateY: p.y }],
              opacity: 0.85,
            }}
          >
            {p.emoji}
          </Text>
        ))}

        {/* Central Biophilic Interactive Station Orb */}
        <TouchableOpacity activeOpacity={0.85} onPress={handleTakeStep}>
          <Animated.View
            style={[
              activityStyles.forestOrb,
              {
                borderColor: currentStation.color,
                backgroundColor: `${currentStation.color}25`,
                transform: [{ scale: pulseAnim }],
              }
            ]}
          >
            <Text style={activityStyles.forestOrbIcon}>{currentStation.actionIcon}</Text>
            <Text style={activityStyles.forestOrbLabel}>{currentStation.actionText}</Text>
            <Text style={activityStyles.breathPhaseTxt}>
              {breathPhase === 'inhale' ? '🌬️ Inhale Forest Air (4s)' : '🍃 Exhale Tension (6s)'}
            </Text>
          </Animated.View>
        </TouchableOpacity>

        {/* Station Navigation Dots */}
        <View style={activityStyles.stationDotsRow}>
          {FOREST_STATIONS.map((st, i) => (
            <View
              key={st.id}
              style={[
                activityStyles.stationDot,
                {
                  backgroundColor: i === stationIdx ? st.color : 'rgba(255,255,255,0.15)',
                  width: i === stationIdx ? 18 : 8,
                }
              ]}
            />
          ))}
        </View>
      </View>

      {/* Trail Step Action Button */}
      <TouchableOpacity
        style={[activityStyles.forestStepBtn, { backgroundColor: currentStation.color }]}
        onPress={handleTakeStep}
        activeOpacity={0.85}
      >
        <Text style={activityStyles.forestStepBtnTxt}>👣  Walk Trail & Breathe Deeply</Text>
      </TouchableOpacity>
    </View>
  );
};

const activityStyles = StyleSheet.create({
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },

  muscleRegionBar: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  muscleRegionChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  holdHintBar: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  holdHintTxt: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Muscle relaxation styles
  muscleOrb: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  muscleIcon: { fontSize: 28, marginBottom: 4 },
  musclePhaseWord: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  muscleCountdown: { color: '#fff', fontSize: 32, fontWeight: '300' },
  muscleGroupLabel: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  muscleCue: { color: 'rgba(255,255,255,0.85)', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  muscleProgress: { flexDirection: 'row', marginTop: 20, gap: 8 },
  muscleDot: { width: 10, height: 10, borderRadius: 5 },

  // Pattern alignment styles
  patternWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  scoreDisplay: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 12 },
  scoreText: { fontSize: 18, fontWeight: '600' },
  comboText: { fontSize: 16, fontWeight: '500' },
  floatingText: { position: 'absolute', fontSize: 24, fontWeight: 'bold' },
  hint: { fontSize: 12, opacity: 0.8, fontWeight: '600' },
  referenceGrid: {
    width: 90,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 26,
    borderRadius: 8,
    overflow: 'hidden',
  },
  referenceCell: { width: 30, height: 30 },
  mainGrid: {
    width: 210,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 14,
    overflow: 'hidden',
  },
  mainCell: { width: 70, height: 70 },
  alignedText: { fontSize: 18, fontWeight: '700', marginTop: 16 },

  // Nature restoration styles
  natureContainer: {
    flex: 1,
    backgroundColor: '#04150E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  natureGlowAura: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
  },
  stressIndicator: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
  },
  stressLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 4 },
  stressBar: { height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
  stressFill: { height: '100%', borderRadius: 3 },
  stressValue: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 2, textAlign: 'right' },
  breathCounter: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 60, marginBottom: 20 },
  focalWrap: { alignItems: 'center', justifyContent: 'center' },
  outerBreathingRing: {
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 2,
    position: 'absolute',
  },
  innerLotusOrb: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#34D399',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  lotusIcon: { fontSize: 50 },
  breathHint: { color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 4 },
  focalSubLabel: { color: '#6EE7B7', fontSize: 14, fontWeight: '600', marginTop: 30 },
  tipsContainer: {
    position: 'absolute',
    bottom: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(15, 56, 38, 0.6)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
  },
  tipText: { color: '#A7F3D0', fontSize: 12, textAlign: 'center' },

  // Guided Forest Walk Styles
  forestContainer: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, width: '100%' },
  forestHeader: { width: '100%', alignItems: 'center' },
  stationBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 4 },
  stationBadgeTxt: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  forestStepsTxt: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  stationTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', marginVertical: 2 },
  stationDesc: { fontSize: 12, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 17, marginBottom: 8, paddingHorizontal: 10 },
  trailProgressTrack: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  trailProgressFill: { height: '100%', borderRadius: 3 },
  forestCanvas: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 150 },
  forestOrb: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    padding: 10,
  },
  forestOrbIcon: { fontSize: 34, marginBottom: 4 },
  forestOrbLabel: { fontSize: 14, fontWeight: '800', color: '#FFFFFF', marginBottom: 2 },
  breathPhaseTxt: { fontSize: 10, color: 'rgba(255,255,255,0.75)', fontWeight: '600', textAlign: 'center' },
  stationDotsRow: { flexDirection: 'row', gap: 6, marginTop: 12, alignItems: 'center' },
  stationDot: { height: 8, borderRadius: 4 },
  forestStepBtn: { width: '100%', paddingVertical: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  forestStepBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
});

// ===========================================================================
// Main Session Component (Enhanced with Gamification)
// ===========================================================================
export const GroundedStressReliefSession = ({
  mode,
  subOptionId,
  initialMode,
  onFinish,
  onStartSession,
  onDurationChange,
  initialScreen = 'session'
}) => {
  const themeContext = React.useContext(ThemeContext);
  const theme = themeContext?.theme || {};
  const isDarkMode = themeContext?.isDarkMode ?? true;

  const getInitialTechnique = () => {
    const raw = (mode || subOptionId || initialMode || '').toLowerCase();
    if (raw === 'pattern' || raw === 'pattern_align' || raw === 'pattern_alignment') return 'pattern_alignment';
    if (raw === 'guided_imagery' || raw === 'forest' || raw === 'forest_walk') return 'guided_imagery';
    if (raw === 'nature' || raw === 'cloud_float' || raw === 'soft_fascination') return 'soft_fascination';
    return 'progressive_muscle';
  };

  const [screen, setScreen] = useState(initialScreen);
  const [techniqueId, setTechniqueId] = useState(getInitialTechnique);
  const [durationMin, setDurationMin] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tally, setTally] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [totalCalmScore, setTotalCalmScore] = useState(0);

  const tickRef = useRef(null);
  const screenFade = useRef(new Animated.Value(1)).current;

  const technique = TECHNIQUES[techniqueId] || TECHNIQUES.progressive_muscle;
  const colors = THEME[techniqueId] || THEME.progressive_muscle || { primary: '#059669', secondary: '#A7F3D0', background: '#041B13', accent: '#10B981' };

  const primaryTextColor = isDarkMode ? '#FFFFFF' : (theme.textPrimary || '#0F172A');
  const secondaryTextColor = isDarkMode ? 'rgba(255,255,255,0.75)' : (theme.textSecondary || '#334155');
  const mutedTextColor = isDarkMode ? 'rgba(255,255,255,0.45)' : (theme.textMuted || '#64748B');
  const containerBg = isDarkMode ? (colors?.background || '#0A1628') : (theme.bgPrimary || '#F8FAFC');
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
    setTotalCalmScore(0);
    setIsPaused(false);
    fadeTo('session');
  };

  const endSessionEarly = () => {
    clearInterval(tickRef.current);
    fadeTo('complete');
  };

  const handleTally = useCallback(() => {
    setTally(t => t + 1);
    setTotalCalmScore(s => s + 10);
  }, []);

  const tallyLabel =
    techniqueId === 'progressive_muscle' ? 'muscle groups released' :
      techniqueId === 'pattern_alignment' ? 'patterns aligned' :
        techniqueId === 'guided_imagery' ? 'forest stations reached' :
          'relaxation moments';

  if (screen === 'setup') {
    return (
      <Animated.View style={[styles.container, { backgroundColor: containerBg, opacity: screenFade }]}>
        <ScrollView contentContainerStyle={styles.setupScroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.setupTitle, { color: primaryTextColor }]}>🧘 Grounding Exercises</Text>
          <Text style={[styles.setupSubtitle, { color: secondaryTextColor }]}>
            Simple, calming activities designed to help you relax your mind and body without any rush.
            Earn calm points as you progress!
          </Text>

          <Text style={[styles.sectionLabel, { color: mutedTextColor }]}>Select Technique</Text>
          {Object.values(TECHNIQUES).map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[
                styles.techCard,
                { borderColor: techniqueId === t.id ? colors.accent : 'rgba(255,255,255,0.08)', backgroundColor: isDarkMode ? 'rgba(255,255,255,0.03)' : (theme.bgSecondary || '#FFFFFF') }
              ]}
              onPress={() => setTechniqueId(t.id)}
            >
              <View style={styles.techCardHeader}>
                <Text style={[styles.techName, { color: primaryTextColor }]}>{t.name}</Text>
                <Text style={[styles.techSubtitle, { color: colors.accent }]}>{t.subtitle}</Text>
              </View>
              <Text style={[styles.techDescription, { color: secondaryTextColor }]}>{t.description}</Text>
              <Text style={[styles.techCitation, { color: mutedTextColor }]}>{t.citation}</Text>
            </TouchableOpacity>
          ))}

          <Text style={[styles.sectionLabel, { color: mutedTextColor }]}>Session Length</Text>
          <View style={styles.durationRow}>
            {DURATION_OPTIONS_MIN.map(min => (
              <TouchableOpacity
                key={min}
                style={[
                  styles.durationChip,
                  { backgroundColor: durationMin === min ? colors.accent : (isDarkMode ? 'rgba(255,255,255,0.05)' : (theme.bgSecondary || '#FFFFFF')), borderColor: theme.border }
                ]}
                onPress={() => setDurationMin(min)}
              >
                <Text style={[styles.durationChipText, { color: durationMin === min ? '#FFFFFF' : primaryTextColor }]}>{min} min</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.startButton, { backgroundColor: colors.accent }]}
            onPress={startSession}
          >
            <Text style={styles.startButtonText}>Begin Session ▶</Text>
          </TouchableOpacity>

          <Text style={[styles.disclaimer, { color: mutedTextColor }]}>
            Biophilic Shinrin-Yoku imagery engages prefrontal restorative networks to lower stress.
          </Text>
        </ScrollView>
      </Animated.View>
    );
  }

  if (screen === 'session') {
    const progress = Math.min(1, elapsedSeconds / totalSeconds);
    return (
      <Animated.View style={[styles.container, { backgroundColor: containerBg, opacity: screenFade }]}>
        <View style={styles.sessionProgressTrack}>
          <View style={[styles.sessionProgressFill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]} />
        </View>

        <View style={styles.techniqueHeader}>
          <Text style={[styles.techniqueHeaderText, { color: primaryTextColor }]}>
            {technique.emoji} {technique.name}
          </Text>
          <Text style={[styles.techniqueHeaderSub, { color: mutedTextColor }]}>
            ⏱️ {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')} / {durationMin}:00
          </Text>
          <Text style={styles.calmScoreText}>
            🌟 Calm Score: {totalCalmScore}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          {techniqueId === 'progressive_muscle' && <MuscleRelaxationActivity colors={colors} onTally={handleTally} />}
          {techniqueId === 'pattern_alignment' && <PatternAlignActivity colors={colors} onTally={handleTally} />}
          {techniqueId === 'soft_fascination' && <NatureRestorationActivity colors={colors} onTally={handleTally} />}
          {techniqueId === 'guided_imagery' && <GuidedForestWalkActivity colors={colors} onTally={handleTally} />}
        </View>

        <View style={styles.sessionFooter}>
          {tallyLabel && <Text style={[styles.breathCountText, { color: secondaryTextColor }]}>✅ {tally} {tallyLabel}</Text>}
          <View style={styles.footerButtons}>
            <TouchableOpacity onPress={() => setIsPaused(p => !p)}>
              <Text style={[styles.endLink, { color: mutedTextColor }]}>{isPaused ? '▶️ Resume' : '⏸️ Pause'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={endSessionEarly}>
              <Text style={[styles.endLink, { color: mutedTextColor }]}>⏹️ End session</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    );
  }

  // Complete screen
  const minutesDone = (elapsedSeconds / 60).toFixed(1);
  const stressReduction = Math.min(100, totalCalmScore * 0.5);

  return (
    <Animated.View style={[styles.container, { backgroundColor: containerBg, opacity: screenFade }]}>
      <LinearGradient
        colors={['rgba(16, 185, 129, 0.1)', 'transparent']}
        style={styles.completeGradient}
      />

      <Text style={[styles.completeTitle, { color: primaryTextColor }]}>🎉 Session Complete!</Text>
      <Text style={[styles.completeSubtitle, { color: secondaryTextColor }]}>Great job taking time for yourself</Text>

      <View style={styles.completeStatsRow}>
        <View style={styles.completeStat}>
          <Text style={[styles.completeStatValue, { color: colors.accent }]}>🌟</Text>
          <Text style={[styles.completeStatLabel, { color: primaryTextColor }]}>{totalCalmScore}</Text>
          <Text style={[styles.completeStatSub, { color: mutedTextColor }]}>Calm Points</Text>
        </View>
        <View style={styles.completeStat}>
          <Text style={[styles.completeStatValue, { color: colors.accent }]}>⏱️</Text>
          <Text style={[styles.completeStatLabel, { color: primaryTextColor }]}>{minutesDone}m</Text>
          <Text style={[styles.completeStatSub, { color: mutedTextColor }]}>Time Spent</Text>
        </View>
        <View style={styles.completeStat}>
          <Text style={[styles.completeStatValue, { color: colors.accent }]}>📉</Text>
          <Text style={[styles.completeStatLabel, { color: primaryTextColor }]}>{stressReduction.toFixed(0)}%</Text>
          <Text style={[styles.completeStatSub, { color: mutedTextColor }]}>Est. Reduction</Text>
        </View>
      </View>

      <Text style={[styles.completeNote, { color: secondaryTextColor }]}>{technique.description}</Text>

      <TouchableOpacity
        style={[styles.startButton, { backgroundColor: colors.accent }]}
        onPress={() => (onFinish ? onFinish() : startSession())}
      >
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
  container: { flex: 1, alignItems: 'center', overflow: 'hidden', width: '100%' },

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
  startButton: { borderRadius: 26, paddingVertical: 15, alignItems: 'center', marginBottom: 14, width: '100%', paddingHorizontal: 20 },
  startButtonText: { color: '#0A1628', fontSize: 16, fontWeight: '600' },
  secondaryButton: { paddingVertical: 10, alignItems: 'center' },
  secondaryButtonText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  disclaimer: { color: 'rgba(255,255,255,0.25)', fontSize: 10, textAlign: 'center', marginTop: 4 },

  sessionProgressTrack: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sessionProgressFill: { height: '100%' },
  techniqueHeader: { alignItems: 'center', marginTop: 12, marginBottom: 4 },
  techniqueHeaderText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500' },
  techniqueHeaderSub: { color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 2 },
  calmScoreText: { color: '#F59E0B', fontSize: 12, fontWeight: '600', marginTop: 2 },

  sessionFooter: { alignItems: 'center', marginBottom: 10, gap: 6 },
  breathCountText: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  footerButtons: { flexDirection: 'row', gap: 20 },
  endLink: { color: 'rgba(255,255,255,0.35)', fontSize: 12, textDecorationLine: 'underline' },

  completeGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  completeTitle: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 80, marginBottom: 8 },
  completeSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 30 },
  completeStatsRow: { flexDirection: 'row', gap: 24, marginBottom: 30 },
  completeStat: { alignItems: 'center' },
  completeStatValue: { fontSize: 28, fontWeight: '600' },
  completeStatLabel: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 4 },
  completeStatSub: { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 },
  completeNote: {
    color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 19,
    textAlign: 'center', paddingHorizontal: 36, marginBottom: 40,
  },
});