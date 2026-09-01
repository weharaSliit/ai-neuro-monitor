import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeContext } from '../context/ThemeContext';

const { width } = Dimensions.get('window');

// ---------------------------------------------------------------------------
// Serene Minimalist Techniques Catalog Definitions
// ---------------------------------------------------------------------------
const TECHNIQUES = {
  autogenic_warmth: {
    id: 'autogenic_warmth',
    name: '🔥 Autogenic Thermal Focus',
    subtitle: 'Vascular Somatosensory Focus',
    description: 'Somatosensory thermal focus promoting peripheral vasodilation and vascular relaxation.',
    emoji: '🔥',
    color: '#0D9488',
    bgDark: ['#061D1A', '#0B2925'],
    bgLight: ['#F8FAFC', '#F0FDFA'],
  },
  pattern_alignment: {
    id: 'pattern_alignment',
    name: '🧩 Memory Match',
    subtitle: 'Visuospatial Working Memory',
    description: 'A light visual matching task that shifts active focus away from intrusive anxiety thoughts.',
    emoji: '🧩',
    color: '#0D9488',
    bgDark: ['#061D1A', '#0B2925'],
    bgLight: ['#F8FAFC', '#F0FDFA'],
  },
  progressive_muscle: {
    id: 'progressive_muscle',
    name: '🧘 Muscle Release',
    subtitle: 'Somatic Tension Release',
    description: 'Gently tighten and release muscles to drop physical tension and body stress.',
    emoji: '🧘',
    color: '#0D9488',
    bgDark: ['#061D1A', '#0B2925'],
    bgLight: ['#F8FAFC', '#F0FDFA'],
  },
};

// ===========================================================================
// 1. Autogenic Thermal Focus Activity
// ===========================================================================
const THERMAL_STAGES = [
  { stage: '1. HANDS & ARMS', cue: 'Feel deep warmth spreading into your hands & wrists', icon: '🤲' },
  { stage: '2. SOLAR PLEXUS', cue: 'Feel pleasant radiation of heat in your solar plexus core', icon: '☀️' },
  { stage: '3. CARDIAC RHYTHM', cue: 'Heart rate is calm, steady, and comfortably relaxed', icon: '🫀' },
  { stage: '4. FOREHEAD COOL', cue: 'Forehead feels refreshingly cool and clear', icon: '❄️' },
];

const AutogenicWarmthActivity = ({ isDarkMode, onTally }) => {
  const [stageIdx, setStageIdx] = useState(0);
  const heatPulse = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.timing(heatPulse, { toValue: 1.3, duration: 3500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(glowOpacity, { toValue: 0.9, duration: 3500, useNativeDriver: false }),
      ])
    ).start();

    const timer = setInterval(() => {
      setStageIdx(prev => (prev + 1) % THERMAL_STAGES.length);
      if (onTally) onTally();
    }, 7000);
    return () => clearInterval(timer);
  }, []);

  const stg = THERMAL_STAGES[stageIdx];
  const textColor = isDarkMode ? '#FFFFFF' : '#0F172A';
  const subTextColor = isDarkMode ? 'rgba(255,255,255,0.75)' : '#334155';

  return (
    <View style={styles.activityCanvasContainer}>
      <View style={[styles.vascularThermogramCard, { backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.15)' : '#F0FDFA', borderColor: '#0D9488' }]}>
        <View style={styles.thermogramHeader}>
          <Text style={styles.canvasIconEmoji}>{stg.icon}</Text>
          <Text style={[styles.canvasTimerTxt, { color: textColor }]}>{stg.stage}</Text>
        </View>

        {/* Vascular Heat Flow Gauge */}
        <View style={styles.heatFlowTrack}>
          <Animated.View
            style={[
              styles.heatFlowFill,
              {
                backgroundColor: '#0D9488',
                opacity: glowOpacity,
                width: heatPulse.interpolate({
                  inputRange: [1, 1.3],
                  outputRange: ['40%', '100%'],
                }),
              }
            ]}
          />
        </View>
        <Text style={[styles.heatFlowLabel, { color: '#0D9488' }]}>🌿 Peripheral Vasodilation: Active Heat Flow</Text>
      </View>

      <View style={[styles.stageCard, { backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.2)' : '#E0F2FE', borderColor: '#0D9488' }]}>
        <Text style={[styles.stageTitle, { color: isDarkMode ? '#5EEAD4' : '#0F766E' }]}>{stg.stage}</Text>
        <Text style={[styles.stageCue, { color: textColor }]}>{stg.cue}</Text>
      </View>
    </View>
  );
};

// ===========================================================================
// 2. Restored Pattern Alignment Activity (Minimalist 3x3 Grid)
// ===========================================================================
const PALETTE = ['#0D9488', '#0284C7', '#059669', '#334155', '#475569'];
const ICONS = ['🪷', '🌊', '🌸', '⚡', '⭐', '💎', '🌙', '🔥', '🍀'];

const generatePattern = () =>
  Array.from({ length: 9 }, (_, i) => ({
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    icon: ICONS[i % ICONS.length],
  }));

const PatternAlignActivity = ({ isDarkMode, onTally }) => {
  const [targetPattern, setTargetPattern] = useState(generatePattern);
  const [currentGrid, setCurrentGrid] = useState(() => generatePattern());

  const handleTileTap = (index) => {
    if (Platform.OS !== 'web') Vibration.vibrate(12);

    setCurrentGrid(prev => {
      const next = [...prev];
      const curColorIdx = PALETTE.indexOf(next[index].color);
      const nextColor = PALETTE[(curColorIdx + 1) % PALETTE.length];
      next[index] = { ...next[index], color: nextColor };

      let matchedCount = 0;
      next.forEach((cell, idx) => {
        if (cell.color === targetPattern[idx].color) matchedCount++;
      });

      if (matchedCount === 9) {
        if (onTally) onTally();
        setTimeout(() => {
          setTargetPattern(generatePattern());
          setCurrentGrid(generatePattern());
        }, 600);
      }

      return next;
    });
  };

  const matchCount = currentGrid.filter((c, i) => c.color === targetPattern[i].color).length;
  const alignmentPercent = Math.round((matchCount / 9) * 100);

  const textColor = isDarkMode ? '#FFFFFF' : '#0F172A';

  return (
    <View style={styles.activityCanvasContainer}>
      <View style={[styles.targetPatternCard, { backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.15)' : '#F0FDFA', borderColor: '#0D9488' }]}>
        <View style={styles.targetHeaderRow}>
          <Text style={[styles.targetHeaderTxt, { color: '#0D9488' }]}>🎯 TARGET PATTERN</Text>
          <Text style={[styles.alignmentGaugeTxt, { color: '#0D9488' }]}>Match: {alignmentPercent}%</Text>
        </View>

        <View style={styles.targetMiniGrid}>
          {targetPattern.map((cell, i) => (
            <View key={i} style={[styles.targetMiniTile, { backgroundColor: cell.color }]}>
              <Text style={styles.miniTileIcon}>{cell.icon}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={[styles.puzzleInstruction, { color: textColor }]}>
        Tap tiles to cycle colors & match the target pattern above
      </Text>

      <View style={styles.playerMatrixGrid}>
        {currentGrid.map((cell, i) => {
          const isMatched = cell.color === targetPattern[i].color;
          return (
            <TouchableOpacity
              key={i}
              activeOpacity={0.8}
              style={[
                styles.playerMatrixTile,
                { backgroundColor: cell.color },
                isMatched && styles.playerMatrixTileMatched,
              ]}
              onPress={() => handleTileTap(i)}
            >
              <Text style={styles.playerTileIcon}>{cell.icon}</Text>
              {isMatched && <View style={styles.matchedCheckBadge}><Text style={styles.checkTxt}>✓</Text></View>}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

// ===========================================================================
// 3. Progressive Muscle Relaxation Activity
// ===========================================================================
const MUSCLE_GROUPS = [
  { label: 'Hands & Forearms', cue: 'Clench fists tightly (5s) → Release & let fall heavy (10s)', icon: '✊' },
  { label: 'Upper Arms', cue: 'Tighten biceps (5s) → Let arms rest loose (10s)', icon: '💪' },
  { label: 'Shoulders & Neck', cue: 'Raise shoulders up (5s) → Drop shoulders downward (10s)', icon: '💆‍♂️' },
  { label: 'Face & Jaw', cue: 'Scrunch face & unclench jaw (5s) → Smooth forehead (10s)', icon: '😌' },
  { label: 'Chest & Stomach', cue: 'Tighten stomach core (5s) → Let belly soften (10s)', icon: '🫁' },
  { label: 'Legs & Feet', cue: 'Flex calves & toes (5s) → Let legs rest heavy (10s)', icon: '🦵' },
];

const MuscleRelaxationActivity = ({ isDarkMode, onTally }) => {
  const [groupIdx, setGroupIdx] = useState(0);
  const [phase, setPhase] = useState('tense');
  const [secLeft, setSecLeft] = useState(5);
  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let countdown = 5;
    let currentPhase = 'tense';

    const timer = setInterval(() => {
      countdown--;
      setSecLeft(countdown);

      if (countdown <= 0) {
        if (currentPhase === 'tense') {
          currentPhase = 'release';
          countdown = 10;
          setPhase('release');
          Animated.timing(pulseScale, { toValue: 0.9, duration: 600, useNativeDriver: true }).start();
        } else {
          currentPhase = 'tense';
          countdown = 5;
          setPhase('tense');
          setGroupIdx(prev => (prev + 1) % MUSCLE_GROUPS.length);
          if (onTally) onTally();
          Animated.timing(pulseScale, { toValue: 1.3, duration: 600, useNativeDriver: true }).start();
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const mg = MUSCLE_GROUPS[groupIdx];
  const textColor = isDarkMode ? '#FFFFFF' : '#0F172A';

  return (
    <View style={styles.activityCanvasContainer}>
      <Animated.View
        style={[
          styles.muscleRingOuter,
          {
            borderColor: '#0D9488',
            backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.15)' : '#F0FDFA',
            transform: [{ scale: pulseScale }],
          }
        ]}
      >
        <Text style={styles.canvasIconEmoji}>{mg.icon}</Text>
        <Text style={[styles.canvasTimerTxt, { color: textColor }]}>{secLeft}s</Text>
        <Text style={[styles.canvasTagTxt, { color: '#0D9488' }]}>
          {phase === 'tense' ? '✊ CLENCH TIGHT' : '👐 RELEASE & RELAX'}
        </Text>
      </Animated.View>

      <View style={[styles.muscleGroupCard, { backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.2)' : '#F0FDFA', borderColor: '#0D9488' }]}>
        <Text style={[styles.muscleGroupTitle, { color: isDarkMode ? '#5EEAD4' : '#0F766E' }]}>{mg.label}</Text>
        <Text style={[styles.muscleGroupCue, { color: textColor }]}>{mg.cue}</Text>
      </View>
    </View>
  );
};

// ===========================================================================
// Main Session Component
// ===========================================================================
export const GroundedStressReliefSession = ({
  mode,
  subOptionId,
  initialMode,
  initialDurationMin,
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
    if (raw === 'autogenic_warmth' || raw === 'autogenic') return 'autogenic_warmth';
    if (raw === 'pattern_alignment' || raw === 'pattern') return 'pattern_alignment';
    return 'progressive_muscle';
  };

  const TARGET_MINUTES = {
    autogenic_warmth: 4,
    pattern_alignment: 2,
    progressive_muscle: 4
  };

  const [screen, setScreen] = useState(initialScreen);
  const [techniqueId, setTechniqueId] = useState(getInitialTechnique);
  const [durationMin, setDurationMin] = useState(initialDurationMin || TARGET_MINUTES[getInitialTechnique()] || 4);

  useEffect(() => {
    const key = getInitialTechnique();
    setTechniqueId(key);
    setDurationMin(initialDurationMin || TARGET_MINUTES[key] || 4);
  }, [mode, subOptionId, initialMode, initialDurationMin]);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const tickRef = useRef(null);

  const tech = TECHNIQUES[techniqueId] || TECHNIQUES.progressive_muscle;
  const primaryTextColor = isDarkMode ? '#FFFFFF' : '#0F172A';
  const secondaryTextColor = isDarkMode ? 'rgba(255,255,255,0.75)' : '#334155';
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

  const handleTally = useCallback(() => {}, []);

  if (screen === 'session') {
    const progress = Math.min(1, elapsedSeconds / totalSeconds);
    const bgGradient = isDarkMode ? tech.bgDark : tech.bgLight;

    return (
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false} bounces={false}>
        <LinearGradient colors={bgGradient} style={styles.sessionGradientWrapper}>
          {/* Header Card */}
          <View style={[styles.techHeaderCard, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.08)' : '#FFFFFF', borderColor: '#0D9488' }]}>
            <View style={[styles.techHeaderIconRing, { backgroundColor: 'rgba(13, 148, 136, 0.2)' }]}>
              <Text style={styles.techHeaderIcon}>{tech.emoji}</Text>
            </View>
            <View style={styles.techHeaderTextWrap}>
              <Text style={[styles.techHeaderTitle, { color: primaryTextColor }]}>{tech.name}</Text>
              <Text style={[styles.techHeaderBadge, { color: '#0D9488' }]}>{tech.subtitle}</Text>
            </View>
            <View style={[styles.timeBadge, { backgroundColor: '#0D9488' }]}>
              <Text style={styles.timeBadgeTxt}>
                {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')} / {durationMin}m
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressTrackBar}>
            <View style={[styles.progressFillBar, { width: `${progress * 100}%`, backgroundColor: '#0D9488' }]} />
          </View>

          {/* Activity Canvas Router */}
          <View style={styles.canvasWrapper}>
            {techniqueId === 'autogenic_warmth' && <AutogenicWarmthActivity isDarkMode={isDarkMode} onTally={handleTally} />}
            {techniqueId === 'pattern_alignment' && <PatternAlignActivity isDarkMode={isDarkMode} onTally={handleTally} />}
            {techniqueId === 'progressive_muscle' && <MuscleRelaxationActivity isDarkMode={isDarkMode} onTally={handleTally} />}
          </View>

          {/* Controls */}
          <TouchableOpacity
            style={[styles.sessionControlBtn, { backgroundColor: '#0D9488' }]}
            onPress={() => setIsPaused(p => !p)}
            activeOpacity={0.85}
          >
            <Text style={styles.sessionControlBtnTxt}>{isPaused ? '▶  Resume Session' : '⏸  Pause Session'}</Text>
          </TouchableOpacity>
        </LinearGradient>
      </ScrollView>
    );
  }

  // Complete Screen
  return (
    <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false} bounces={false}>
      <LinearGradient colors={tech.bgDark} style={styles.sessionGradientWrapper}>
        <Text style={[styles.completeTitle, { color: primaryTextColor }]}>🎉 Session Complete!</Text>
        <Text style={[styles.completeSubtitle, { color: secondaryTextColor }]}>Great job completing your relaxation session</Text>

        <TouchableOpacity
          style={[styles.sessionControlBtn, { backgroundColor: '#0D9488', marginTop: 24 }]}
          onPress={() => (onFinish ? onFinish() : setScreen('session'))}
          activeOpacity={0.85}
        >
          <Text style={styles.sessionControlBtnTxt}>Complete & Submit →</Text>
        </TouchableOpacity>
      </LinearGradient>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: { flexGrow: 1 },
  sessionGradientWrapper: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 520,
  },
  techHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: width * 0.9,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    marginBottom: 6,
    elevation: 4,
    gap: 12,
  },
  techHeaderIconRing: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  techHeaderIcon: { fontSize: 24 },
  techHeaderTextWrap: { flex: 1 },
  techHeaderTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  techHeaderBadge: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  timeBadge: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14 },
  timeBadgeTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },

  progressTrackBar: { width: width * 0.9, height: 6, borderRadius: 3, backgroundColor: 'rgba(0, 0, 0, 0.08)', overflow: 'hidden', marginVertical: 6 },
  progressFillBar: { height: '100%', borderRadius: 3 },

  canvasWrapper: { width: width * 0.9, height: Math.min(width * 0.72, 270), alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  activityCanvasContainer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', position: 'relative' },

  // Autogenic Vascular Thermogram
  vascularThermogramCard: {
    width: '100%',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    marginBottom: 10,
  },
  thermogramHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  heatFlowTrack: { width: '100%', height: 12, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginVertical: 4 },
  heatFlowFill: { height: '100%', borderRadius: 6 },
  heatFlowLabel: { fontSize: 11, fontWeight: '800', marginTop: 4 },

  stageCard: { width: '100%', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5, alignItems: 'center' },
  stageTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  stageCue: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 2 },

  // Restored Memory Match Pattern Alignment
  targetPatternCard: { width: '100%', padding: 10, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', marginBottom: 8 },
  targetHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 6 },
  targetHeaderTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  alignmentGaugeTxt: { fontSize: 11, fontWeight: '800' },
  targetMiniGrid: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', width: 108, justifyContent: 'center' },
  targetMiniTile: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  miniTileIcon: { fontSize: 12 },

  puzzleInstruction: { fontSize: 12, fontWeight: '700', textAlign: 'center', marginVertical: 6 },
  playerMatrixGrid: { width: 180, height: 180, flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', alignItems: 'center' },
  playerMatrixTile: { width: 54, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', elevation: 3, position: 'relative' },
  playerMatrixTileMatched: { borderWidth: 2.5, borderColor: '#FFFFFF' },
  playerTileIcon: { fontSize: 20 },
  matchedCheckBadge: { position: 'absolute', top: 2, right: 2, backgroundColor: '#0D9488', width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  checkTxt: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },

  // Progressive Muscle Release
  muscleRingOuter: { width: 175, height: 175, borderRadius: 87.5, borderWidth: 3.5, alignItems: 'center', justifyContent: 'center' },
  muscleGroupCard: { width: '100%', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', marginTop: 12 },
  muscleGroupTitle: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  muscleGroupCue: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 2 },

  // Shared Typography
  canvasIconEmoji: { fontSize: 34, marginBottom: 2 },
  canvasTimerTxt: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  canvasTagTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 2, textTransform: 'uppercase' },

  // Session Control Button
  sessionControlBtn: {
    width: width * 0.9,
    paddingVertical: 15,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    elevation: 3,
  },
  sessionControlBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },

  completeTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  completeSubtitle: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 6 },
});

export const CognitiveDeStressGame = GroundedStressReliefSession;
export default GroundedStressReliefSession;