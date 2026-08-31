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
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');
const AMBIENT_TICK_MS = 50;

// ---------------------------------------------------------------------------
// Enhanced Healthcare Relaxation Guide with Gamification
// ---------------------------------------------------------------------------
const TECHNIQUES = {
  soft_fascination: {
    id: 'soft_fascination',
    name: '🌿 Nature Scenery',
    subtitle: 'Restorative Nature',
    description: 'Watch gentle, slowly changing nature scenes to quickly restore mental calm.',
    citation: '✨ Restorative Nature Viewing',
    emoji: '🌿',
    color: '#059669',
  },
  progressive_muscle: {
    id: 'progressive_muscle',
    name: '🧘 Muscle Release',
    subtitle: 'Somatic Relief',
    description: 'Gently tighten and release muscles to drop physical tension and body stress.',
    citation: '✨ Somatic Tension Release',
    emoji: '🧘',
    color: '#D97706',
  },
  guided_imagery: {
    id: 'guided_imagery',
    name: '🌲 Forest Walk',
    subtitle: 'Guided Imagery',
    description: 'Peaceful guided forest trail walk to shift your mind away from stress.',
    citation: '✨ Forest Imagery Walk',
    emoji: '🌲',
    color: '#047857',
  },
  pattern_alignment: {
    id: 'pattern_alignment',
    name: '🎯 Memory Match',
    subtitle: 'Focus Reset',
    description: 'A calm visual matching puzzle to clear intrusive worry and refocus your mind.',
    citation: '✨ Focus & Memory Match',
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
// Activity 1 — Progressive Muscle Relaxation (Redesigned)
// ===========================================================================
const TENSE_SECONDS = 5;
const RELEASE_SECONDS = 10;

const MUSCLE_GROUPS = [
  { id: 'hands', label: 'Hands & Forearms', tenseCue: 'Clench your fists', releaseCue: 'Let your hands go completely loose', icon: '✊' },
  { id: 'arms', label: 'Upper Arms', tenseCue: 'Tighten your biceps', releaseCue: 'Let your arms fall heavy and loose', icon: '💪' },
  { id: 'shoulders', label: 'Shoulders & Neck', tenseCue: 'Raise your shoulders', releaseCue: 'Drop your shoulders, soften your neck', icon: '🫂' },
  { id: 'face', label: 'Face', tenseCue: 'Scrunch your face tightly', releaseCue: 'Let your face go completely smooth', icon: '😌' },
  { id: 'torso', label: 'Chest & Stomach', tenseCue: 'Tighten your stomach', releaseCue: 'Let your breath settle and soften', icon: '🫁' },
  { id: 'legs', label: 'Legs & Feet', tenseCue: 'Point your toes', releaseCue: 'Let your legs feel heavy and loose', icon: '🦵' },
];

const MuscleRelaxationActivity = ({ colors, onTally }) => {
  const [groupIndex, setGroupIndex] = useState(0);
  const [phase, setPhase] = useState('tense');
  const [secondsLeft, setSecondsLeft] = useState(TENSE_SECONDS);
  const [isHolding, setIsHolding] = useState(false);
  const [energyBalls, setEnergyBalls] = useState([]);
  const [completedGroups, setCompletedGroups] = useState([]);

  const scale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.3)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;

  // Glow pulse animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 0.8, duration: 2000, useNativeDriver: false }),
        Animated.timing(glowOpacity, { toValue: 0.2, duration: 2000, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  // Ring rotation
  useEffect(() => {
    Animated.loop(
      Animated.timing(ringRotate, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();
  }, []);

  const rotateInterpolate = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Phase countdown timer
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

    setTimeout(() => {
      if (onTally) onTally();
    }, 50);

    Animated.parallel([
      Animated.timing(scale, { toValue: 0.95, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  };

  const advanceToNextGroup = () => {
    setCompletedGroups(prev => [...new Set([...prev, MUSCLE_GROUPS[groupIndex].id])]);
    const nextIdx = (groupIndex + 1) % MUSCLE_GROUPS.length;
    setGroupIndex(nextIdx);
    setPhase('tense');
    setSecondsLeft(TENSE_SECONDS);
    setIsHolding(false);

    Animated.timing(scale, { toValue: 1, duration: 400, useNativeDriver: false }).start();
  };

  const handlePressIn = () => {
    if (phase !== 'tense') return;
    setIsHolding(true);
    if (Platform.OS !== 'web') Vibration.vibrate(25);
    Animated.spring(scale, { toValue: 1.08, friction: 3, useNativeDriver: false }).start();
  };

  const handlePressOut = () => {
    if (phase === 'tense' && isHolding) {
      setIsHolding(false);
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: false }).start();
    }
  };

  const spawnEnergyBalls = () => {
    const newBalls = Array.from({ length: 15 }, () => ({
      id: Math.random(),
      x: (Math.random() - 0.5) * 300,
      y: (Math.random() - 0.5) * 300,
      size: Math.random() * 20 + 6,
      color: ['#FFD700', '#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF'][Math.floor(Math.random() * 5)],
    }));
    setEnergyBalls(newBalls);
    setTimeout(() => setEnergyBalls([]), 2000);
  };

  const group = MUSCLE_GROUPS[groupIndex];

  return (
    <View style={activityStyles.muscleContainer}>
      {/* Energy particles */}
      {energyBalls.map(ball => (
        <Animated.View
          key={ball.id}
          style={{
            position: 'absolute',
            width: ball.size,
            height: ball.size,
            borderRadius: ball.size / 2,
            backgroundColor: ball.color,
            opacity: 0.9,
            transform: [{ translateX: ball.x }, { translateY: ball.y }],
          }}
        />
      ))}

      {/* Progress Rings */}
      <View style={activityStyles.muscleProgressContainer}>
        {MUSCLE_GROUPS.map((g, idx) => (
          <View key={g.id} style={activityStyles.muscleProgressDot}>
            <View style={[
              activityStyles.muscleDotInner,
              completedGroups.includes(g.id) && { backgroundColor: colors.accent },
              idx === groupIndex && { borderColor: colors.accent, borderWidth: 2 }
            ]} />
            <Text style={[activityStyles.muscleDotLabel, { color: 'rgba(255,255,255,0.4)' }]}>
              {idx + 1}
            </Text>
          </View>
        ))}
      </View>

      {/* Main Interactive Orb */}
      <TouchableWithoutFeedback
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={phase === 'release'}
      >
        <Animated.View style={activityStyles.muscleOrbWrapper}>
          <Animated.View
            style={[
              activityStyles.muscleOrbRing,
              {
                transform: [{ rotate: rotateInterpolate }],
                borderColor: phase === 'tense' ? (isHolding ? '#F59E0B' : 'rgba(255,255,255,0.1)') : '#10B981',
              }
            ]}
          />
          <Animated.View
            style={[
              activityStyles.muscleOrb,
              {
                transform: [{ scale }],
                backgroundColor: phase === 'tense'
                  ? (isHolding ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)')
                  : 'rgba(16,185,129,0.1)',
                borderColor: phase === 'tense'
                  ? (isHolding ? '#F59E0B' : 'rgba(255,255,255,0.2)')
                  : '#10B981',
              }
            ]}
          >
            <Animated.View style={[activityStyles.muscleGlow, { opacity: glowOpacity }]} />
            <Text style={activityStyles.muscleIcon}>{group.icon}</Text>
            <Text style={activityStyles.musclePhaseWord}>
              {phase === 'tense' ? (isHolding ? '⚡ SQUEEZING' : 'TAP & HOLD') : '🌀 RELEASING'}
            </Text>
            <Text style={activityStyles.muscleCountdown}>{secondsLeft}s</Text>
          </Animated.View>
        </Animated.View>
      </TouchableWithoutFeedback>

      <Text style={activityStyles.muscleGroupLabel}>{group.label}</Text>
      <Text style={activityStyles.muscleCue}>
        {phase === 'tense'
          ? (isHolding ? `⚡ ${group.tenseCue} — Keep squeezing!` : `Press & hold to ${group.tenseCue.toLowerCase()}`)
          : `🔸 ${group.releaseCue} — Feel tension dissolving`}
      </Text>
    </View>
  );
};

// ===========================================================================
// Activity 2 — Pattern Alignment (Unchanged - Keep as is)
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
// Activity 3 — Nature Restoration (Redesigned)
// ===========================================================================
const NatureRestorationActivity = ({ colors, onTally }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const [particles, setParticles] = useState([]);
  const [stressLevel, setStressLevel] = useState(100);
  const [breathCount, setBreathCount] = useState(0);

  // Floating animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(floatAnim, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    ).start();
  }, []);

  // Breathing pulse
  useEffect(() => {
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    breathLoop.start();
    return () => breathLoop.stop();
  }, []);

  // Ambient particles
  useEffect(() => {
    const timer = setInterval(() => {
      setParticles(prev =>
        prev.map(p => ({ ...p, opacity: p.opacity - 0.02, y: p.y - 0.5 }))
          .filter(p => p.opacity > 0)
      );
    }, AMBIENT_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  const floatInterpolate = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-10, 10],
  });

  const handleFocalTap = () => {
    if (Platform.OS !== 'web') Vibration.vibrate(14);
    if (onTally) onTally();

    setStressLevel(prev => Math.max(0, prev - 8));
    setBreathCount(prev => prev + 1);

    const natureEmojis = ['🌸', '🍃', '🪷', '🌺', '💫', '✨', '🦋', '🌿'];
    const newParticles = Array.from({ length: 15 }, () => ({
      id: Math.random(),
      x: width / 2 + (Math.random() * 200 - 100),
      y: height / 2 + (Math.random() * 200 - 100),
      opacity: 1.0,
      emoji: natureEmojis[Math.floor(Math.random() * natureEmojis.length)],
      scale: Math.random() * 0.6 + 0.4,
    }));
    setParticles(prev => [...prev, ...newParticles]);
  };

  return (
    <View style={activityStyles.natureContainer}>
      {/* Background ambient glow */}
      <View style={[activityStyles.natureGlow, { backgroundColor: `${colors.accent}15` }]} />

      {/* Floating particles */}
      {particles.map(p => (
        <Animated.Text
          key={p.id}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            fontSize: 22 * p.scale,
            opacity: p.opacity,
            transform: [{ scale: p.scale }],
          }}
        >
          {p.emoji}
        </Animated.Text>
      ))}

      {/* Stress indicator */}
      <View style={activityStyles.stressContainer}>
        <Text style={activityStyles.stressLabel}>Stress Level</Text>
        <View style={activityStyles.stressBar}>
          <View style={[activityStyles.stressFill, { width: `${stressLevel}%`, backgroundColor: colors.accent }]} />
        </View>
        <Text style={activityStyles.stressValue}>{Math.floor(stressLevel)}%</Text>
      </View>

      {/* Breath counter */}
      <Text style={activityStyles.breathCounter}>🧘 {breathCount} breaths</Text>

      {/* Central nature orb */}
      <TouchableOpacity activeOpacity={0.8} onPress={handleFocalTap}>
        <Animated.View
          style={[
            activityStyles.natureOrb,
            {
              transform: [{ scale: pulseAnim }, { translateY: floatInterpolate }],
              borderColor: colors.accent,
            }
          ]}
        >
          <LinearGradient
            colors={['rgba(16,185,129,0.2)', 'rgba(16,185,129,0.05)']}
            style={activityStyles.natureOrbGradient}
          />
          <Text style={activityStyles.natureOrbIcon}>🪷</Text>
          <Text style={activityStyles.natureOrbLabel}>Tap to relax</Text>
        </Animated.View>
      </TouchableOpacity>

      <Text style={activityStyles.natureHint}>Tap the lotus to release tension</Text>
    </View>
  );
};

// ===========================================================================
// Activity 4 — Guided Forest Walk (Redesigned)
// ===========================================================================
const FOREST_STATIONS = [
  {
    id: 'canopy',
    name: 'Ancient Pine Canopy',
    description: 'Breathe deep cedar and pine resin mist',
    actionIcon: '🌲',
    actionText: 'Inhale deeply',
    color: '#7C3AED',
    ambientEmoji: ['🌲', '🍃', '✨', '💨']
  },
  {
    id: 'stream',
    name: 'Crystal Mountain Stream',
    description: 'Feel cool water washing away stress',
    actionIcon: '💧',
    actionText: 'Touch the water',
    color: '#38BDF8',
    ambientEmoji: ['💧', '🌊', '✨', '🍃']
  },
  {
    id: 'clearing',
    name: 'Sun-Dappled Clearing',
    description: 'Warm sunlight filtering through leaves',
    actionIcon: '☀️',
    actionText: 'Soak in the warmth',
    color: '#F59E0B',
    ambientEmoji: ['☀️', '✨', '🍂', '🦋']
  },
  {
    id: 'sanctuary',
    name: 'Mountain Sanctuary',
    description: 'Peaceful silence and bamboo chimes',
    actionIcon: '🔔',
    actionText: 'Find stillness',
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

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const currentStation = FOREST_STATIONS[stationIdx];

  // Breathing scale
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.1, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(scaleAnim, { toValue: 0.9, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Breath phase switcher
  useEffect(() => {
    const interval = setInterval(() => {
      setBreathPhase(p => (p === 'inhale' ? 'exhale' : 'inhale'));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTakeStep = () => {
    if (Platform.OS !== 'web') Vibration.vibrate(18);

    setStepsTaken(s => s + 1);
    const nextProg = stepProgress + 25;

    const ems = currentStation.ambientEmoji;
    const newP = Array.from({ length: 8 }, () => ({
      id: Math.random(),
      x: (Math.random() - 0.5) * 300,
      y: (Math.random() - 0.5) * 200,
      emoji: ems[Math.floor(Math.random() * ems.length)],
      size: Math.random() * 16 + 14,
    }));
    setParticles(prev => [...prev, ...newP]);
    setTimeout(() => setParticles(p => p.slice(5)), 1500);

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
      {/* Header */}
      <View style={activityStyles.forestHeader}>
        <Text style={activityStyles.stationName}>{currentStation.icon || '🌲'} {currentStation.name}</Text>
        <Text style={activityStyles.stationDesc}>{currentStation.description}</Text>

        {/* Progress bar */}
        <View style={activityStyles.forestProgressTrack}>
          <View style={[activityStyles.forestProgressFill, { width: `${stepProgress}%`, backgroundColor: currentStation.color }]} />
        </View>
      </View>

      {/* Interactive area */}
      <View style={activityStyles.forestCanvas}>
        {particles.map(p => (
          <Text
            key={p.id}
            style={{
              position: 'absolute',
              fontSize: p.size,
              transform: [{ translateX: p.x }, { translateY: p.y }],
              opacity: 0.8,
            }}
          >
            {p.emoji}
          </Text>
        ))}

        <TouchableOpacity activeOpacity={0.85} onPress={handleTakeStep}>
          <Animated.View
            style={[
              activityStyles.forestOrb,
              {
                borderColor: currentStation.color,
                backgroundColor: `${currentStation.color}20`,
                transform: [{ scale: scaleAnim }],
              }
            ]}
          >
            <View style={[activityStyles.forestOrbInner, { backgroundColor: `${currentStation.color}15` }]}>
              <Text style={activityStyles.forestOrbIcon}>{currentStation.actionIcon}</Text>
              <Text style={activityStyles.forestOrbAction}>{currentStation.actionText}</Text>
              <Text style={activityStyles.forestBreathPhase}>
                {breathPhase === 'inhale' ? '🌬️ Inhale' : '🍃 Exhale'}
              </Text>
            </View>
          </Animated.View>
        </TouchableOpacity>

        {/* Station dots */}
        <View style={activityStyles.forestDots}>
          {FOREST_STATIONS.map((st, i) => (
            <View
              key={st.id}
              style={[
                activityStyles.forestDot,
                {
                  backgroundColor: i === stationIdx ? st.color : 'rgba(255,255,255,0.15)',
                  width: i === stationIdx ? 20 : 8,
                }
              ]}
            />
          ))}
        </View>
      </View>

      {/* Step button */}
      <TouchableOpacity
        style={[activityStyles.forestStepBtn, { backgroundColor: currentStation.color }]}
        onPress={handleTakeStep}
        activeOpacity={0.85}
      >
        <Text style={activityStyles.forestStepBtnText}>👣 Walk the trail</Text>
      </TouchableOpacity>
    </View>
  );
};

// ===========================================================================
// Activity Styles (Updated)
// ===========================================================================
const activityStyles = StyleSheet.create({
  // Muscle relaxation styles
  muscleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  muscleProgressContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 30,
  },
  muscleProgressDot: {
    alignItems: 'center',
  },
  muscleDotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 4,
  },
  muscleDotLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  muscleOrbWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  muscleOrbRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.3,
  },
  muscleOrb: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  muscleGlow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  muscleIcon: { fontSize: 36, marginBottom: 6 },
  musclePhaseWord: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  muscleCountdown: { color: '#FFFFFF', fontSize: 38, fontWeight: '300' },
  muscleGroupLabel: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  muscleCue: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },

  // Nature styles
  natureContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  natureGlow: {
    position: 'absolute',
    width: 350,
    height: 350,
    borderRadius: 175,
    opacity: 0.3,
  },
  stressContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
  },
  stressLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', marginBottom: 4 },
  stressBar: { height: 4, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' },
  stressFill: { height: '100%', borderRadius: 2 },
  stressValue: { color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 2, textAlign: 'right' },
  breathCounter: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600', marginBottom: 20 },
  natureOrb: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  natureOrbGradient: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  natureOrbIcon: { fontSize: 56 },
  natureOrbLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', marginTop: 4 },
  natureHint: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 24 },

  // Forest styles
  forestContainer: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 20, width: '100%' },
  forestHeader: { width: '100%', alignItems: 'center' },
  stationName: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  stationDesc: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  forestProgressTrack: { width: '100%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  forestProgressFill: { height: '100%', borderRadius: 2 },
  forestCanvas: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  forestOrb: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forestOrbInner: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forestOrbIcon: { fontSize: 40, marginBottom: 6 },
  forestOrbAction: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  forestBreathPhase: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 2 },
  forestDots: { flexDirection: 'row', gap: 8, marginTop: 20 },
  forestDot: { height: 8, borderRadius: 4 },
  forestStepBtn: { width: '100%', paddingVertical: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  forestStepBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // Pattern styles (unchanged)
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
});

// ===========================================================================
// Main Session Component (Updated)
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

  useEffect(() => {
    if (screen === 'setup') {
      setScreen('session');
    }
  }, [screen]);

  if (screen === 'setup') return null;

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
              <Text style={[styles.endLink, { color: mutedTextColor }]}>⏹️ End</Text>
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
          <Text style={[styles.completeStatSub, { color: mutedTextColor }]}>Reduction</Text>
        </View>
      </View>

      <Text style={[styles.completeNote, { color: secondaryTextColor }]}>{technique.description}</Text>

      <TouchableOpacity
        style={[styles.startButton, { backgroundColor: colors.accent }]}
        onPress={() => (onFinish ? onFinish() : startSession())}
      >
        <Text style={styles.startButtonText}>Complete & Submit →</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => fadeTo('setup')}>
        <Text style={styles.secondaryButtonText}>Choose another technique</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Backward-compatible aliases
export const CognitiveDeStressGame = GroundedStressReliefSession;
export const SensoryGroundingSession = GroundedStressReliefSession;

// ===========================================================================
// Main Styles (Updated)
// ===========================================================================
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