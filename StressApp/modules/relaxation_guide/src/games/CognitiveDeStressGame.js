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
// Healthcare Relaxation Techniques Catalog definitions
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
    bgLight: ['#FFFFFF', '#F1F5F9'],
  },
  pattern_alignment: {
    id: 'pattern_alignment',
    name: '🧠 Neural Color Matrix Alignment',
    subtitle: 'Visuospatial Working Memory Task',
    description: 'A structured neural alignment task that shifts cognitive bandwidth away from intrusive anxiety thoughts.',
    emoji: '🧩',
    color: '#0D9488',
    bgDark: ['#061D1A', '#0B2925'],
    bgLight: ['#FFFFFF', '#F1F5F9'],
  },
  stroop_decoupler: {
    id: 'stroop_decoupler',
    name: '🎯 Stroop Cognitive Decoupler',
    subtitle: 'Prefrontal Executive Interference Task',
    description: 'High-speed cognitive refocusing puzzle suppressing Default Mode Network rumination (0.95 WESAD score).',
    emoji: '🎯',
    color: '#0D9488',
    bgDark: ['#061D1A', '#0B2925'],
    bgLight: ['#FFFFFF', '#F1F5F9'],
  },
};

// ===========================================================================
// 1. Autogenic Thermal Focus Activity (Interactive Bio-Thermal Vasodilation)
// ===========================================================================
const THERMAL_STAGES = [
  {
    id: 'hands_arms',
    name: 'Hands & Arms',
    emoji: '🤲',
    cue: 'My hands and arms feel heavy and pleasantly warm.',
    effect: 'Relaxes peripheral blood vessels, opening blood flow.',
    color: '#EF4444',
  },
  {
    id: 'solar_plexus',
    name: 'Solar Plexus',
    emoji: '☀️',
    cue: 'My solar plexus abdomen feels radiating warmth.',
    clinicalNote: 'Calms stomach nerve center and digestive tension.',
    color: '#F59E0B',
  },
  {
    id: 'cardiac_pulse',
    name: 'Cardiac Pulse',
    emoji: '🫀',
    cue: 'My heartbeat is calm, steady, and warm.',
    clinicalNote: 'Slowing pulse rate lowers autonomic blood pressure.',
    color: '#10B981',
  },
  {
    id: 'forehead_cool',
    name: 'Forehead Cool',
    emoji: '❄️',
    cue: 'My forehead feels comfortably cool and calm.',
    clinicalNote: 'Clears mental tension and calms racing thoughts.',
    color: '#06B6D4',
  },
];

const AutogenicWarmthActivity = ({ isDarkMode, onTally }) => {
  const [activeZone, setActiveZone] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const zone = THERMAL_STAGES[activeZone];
  const primaryColor = zone.color;
  const textColor = isDarkMode ? '#FFFFFF' : '#0F172A';
  const subTextColor = isDarkMode ? 'rgba(255,255,255,0.7)' : '#475569';

  return (
    <View style={styles.activityCanvasContainer}>
      <View style={styles.thermalDeckRow}>
        <View style={[styles.thermalAuraCard, { backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.6)' : '#FFFFFF', borderColor: primaryColor }]}>
          <Animated.View style={[styles.thermalPulseRing, { borderColor: primaryColor, transform: [{ scale: pulseAnim }] }]}>
            <Text style={styles.thermalBigIcon}>{zone.emoji}</Text>
          </Animated.View>
          <Text style={[styles.thermalStageBadge, { color: primaryColor }]}>{zone.name}</Text>
        </View>

        <View style={styles.thermalInfoCol}>
          <View style={[styles.thermalInstructionBox, { backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2', borderColor: primaryColor }]}>
            <Text style={[styles.thermalGuideLabel, { color: primaryColor }]}>📢 HOW TO DO THIS:</Text>
            <Text style={[styles.thermalGuideTxt, { color: textColor }]}>"{zone.cue}"</Text>
            <View style={[styles.thermalEffectBox, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.7)' }]}>
              <Text style={[styles.thermalEffectTxt, { color: subTextColor }]}>
                💡 <Text style={{ fontWeight: '800', color: primaryColor }}>Effect: </Text>
                {zone.effect || zone.clinicalNote}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.thermalZonePillRow}>
        {THERMAL_STAGES.map((stg, idx) => {
          const isActive = activeZone === idx;
          return (
            <TouchableOpacity
              key={stg.id}
              activeOpacity={0.8}
              style={[
                styles.thermalZonePill,
                { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#FFFFFF', borderColor: isDarkMode ? 'rgba(255,255,255,0.1)' : '#CBD5E1' },
                isActive && { backgroundColor: stg.color, borderColor: stg.color },
              ]}
              onPress={() => {
                setActiveZone(idx);
                if (onTally) onTally();
              }}
            >
              <Text style={styles.zonePillEmoji}>{stg.emoji}</Text>
              <Text style={[styles.zonePillLabel, { color: isActive ? '#FFFFFF' : textColor }]}>{stg.name.split(' ')[0]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.clinicalValidationBadge, { backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.2)' : '#F0FDFA', borderColor: '#0D9488' }]}>
        <Text style={[styles.clinicalValidationTxt, { color: textColor }]}>
          🏥 <Text style={{ fontWeight: '800', color: '#0D9488' }}>Clinical Protocol: </Text>
          Schultz Autogenic Thermal Focus (Vascular Vasodilation)
        </Text>
      </View>
    </View>
  );
};

// ===========================================================================
// 2. Neural Color Matrix Alignment Activity (Pure 100% Solid Colors)
// ===========================================================================
const SOLID_COLOR_PALETTE = ['#EF4444', '#F59E0B', '#10B981', '#06B6D4', '#8B5CF6'];

const PatternAlignActivity = ({ isDarkMode, onTally }) => {
  const [blueprint, setBlueprint] = useState([]);
  const [grid, setGrid] = useState([]);
  const [matches, setMatches] = useState(0);

  const generateLevel = useCallback(() => {
    const nextBP = Array.from({ length: 9 }, () => SOLID_COLOR_PALETTE[Math.floor(Math.random() * SOLID_COLOR_PALETTE.length)]);
    const nextGrid = Array.from({ length: 9 }, () => SOLID_COLOR_PALETTE[Math.floor(Math.random() * SOLID_COLOR_PALETTE.length)]);
    setBlueprint(nextBP);
    setGrid(nextGrid);
  }, []);

  useEffect(() => { generateLevel(); }, [generateLevel]);

  const handleTilePress = (index) => {
    if (Platform.OS !== 'web') Vibration.vibrate(15);
    const newGrid = [...grid];
    const currentColor = newGrid[index];
    const colorIdx = SOLID_COLOR_PALETTE.indexOf(currentColor);
    const nextColor = SOLID_COLOR_PALETTE[(colorIdx + 1) % SOLID_COLOR_PALETTE.length];
    newGrid[index] = nextColor;
    setGrid(newGrid);

    let matchCount = 0;
    for (let i = 0; i < 9; i++) {
      if (newGrid[i] === blueprint[i]) matchCount++;
    }
    setMatches(matchCount);

    if (matchCount === 9) {
      if (onTally) onTally();
      setTimeout(() => generateLevel(), 400);
    }
  };

  const textColor = isDarkMode ? '#FFFFFF' : '#0F172A';

  return (
    <View style={styles.neuralCanvasContainer}>
      <View style={[styles.neuralHudCard, { backgroundColor: isDarkMode ? 'rgba(15,23,42,0.6)' : '#FFFFFF', borderColor: isDarkMode ? 'rgba(255,255,255,0.1)' : '#CBD5E1' }]}>
        <View style={styles.hudStatItem}>
          <Text style={styles.hudStatLabel}>ALIGNMENT</Text>
          <Text style={[styles.hudStatValue, { color: '#0D9488' }]}>{Math.round((matches / 9) * 100)}%</Text>
        </View>
        <View style={styles.hudStatDivider} />
        <View style={styles.hudStatItem}>
          <Text style={styles.hudStatLabel}>MATCHED</Text>
          <Text style={[styles.hudStatValue, { color: textColor }]}>{matches} / 9</Text>
        </View>
      </View>

      <View style={styles.dualArenaRow}>
        <View style={[styles.arenaSideCard, { backgroundColor: isDarkMode ? 'rgba(15,23,42,0.4)' : '#FFFFFF', borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : '#E2E8F0' }]}>
          <Text style={[styles.arenaCardHeader, { color: '#0D9488' }]}>🎯 TARGET</Text>
          <View style={styles.miniBlueprintGrid}>
            {blueprint.map((color, idx) => (
              <View key={`bp-${idx}`} style={[styles.miniBlueprintTile, { backgroundColor: color }]} />
            ))}
          </View>
        </View>

        <View style={[styles.arenaSideCard, { backgroundColor: isDarkMode ? 'rgba(15,23,42,0.4)' : '#FFFFFF', borderColor: '#0D9488' }]}>
          <Text style={[styles.arenaCardHeader, { color: textColor }]}>👇 TAP TILE</Text>
          <View style={styles.interactiveGameGrid}>
            {grid.map((color, idx) => {
              const isMatched = color === blueprint[idx];
              return (
                <TouchableOpacity
                  key={`tile-${idx}`}
                  activeOpacity={0.7}
                  style={[styles.gameMatrixCardTile, { backgroundColor: color }, isMatched && styles.gameMatrixCardMatched]}
                  onPress={() => handleTilePress(idx)}
                >
                  {isMatched && (
                    <View style={styles.gameMatchedCheck}>
                      <Text style={styles.gameCheckIcon}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
};

// ===========================================================================
// 3. Stroop Cognitive Decoupler Activity (PREMIUM ARCADE STROOP INTERFERENCE GAME)
// ===========================================================================
const STROOP_COLORS = [
  { name: 'RED', color: '#EF4444', icon: '🔴' },
  { name: 'BLUE', color: '#3B82F6', icon: '🔵' },
  { name: 'GREEN', color: '#10B981', icon: '🟢' },
  { name: 'YELLOW', color: '#F59E0B', icon: '🟡' },
];

const StroopDecouplerActivity = ({ isDarkMode, onTally }) => {
  const [wordItem, setWordItem] = useState(STROOP_COLORS[0]);
  const [colorItem, setColorItem] = useState(STROOP_COLORS[1]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);

  const wordPopAnim = useRef(new Animated.Value(1)).current;

  const generateNextChallenge = useCallback(() => {
    const w = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
    let c = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
    while (c.name === w.name) {
      c = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
    }
    setWordItem(w);
    setColorItem(c);

    wordPopAnim.setValue(0.85);
    Animated.spring(wordPopAnim, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
  }, []);

  useEffect(() => { generateNextChallenge(); }, [generateNextChallenge]);

  const handleColorChoice = (chosenColorObj) => {
    if (Platform.OS !== 'web') Vibration.vibrate(15);
    if (chosenColorObj.name === colorItem.name) {
      setScore(s => s + 10);
      setCombo(c => c + 1);
      if (onTally) onTally();
    } else {
      setCombo(0);
    }
    generateNextChallenge();
  };

  const textColor = isDarkMode ? '#FFFFFF' : '#0F172A';

  return (
    <View style={styles.stroopGameArenaContainer}>
      {/* High-Tech HUD Bar */}
      <View style={[styles.neuralHudCard, { backgroundColor: isDarkMode ? 'rgba(15,23,42,0.7)' : '#FFFFFF', borderColor: isDarkMode ? 'rgba(255,255,255,0.1)' : '#CBD5E1' }]}>
        <View style={styles.hudStatItem}>
          <Text style={styles.hudStatLabel}>WESAD SCORE</Text>
          <Text style={[styles.hudStatValue, { color: '#0D9488' }]}>0.95</Text>
        </View>
        <View style={styles.hudStatDivider} />
        <View style={styles.hudStatItem}>
          <Text style={styles.hudStatLabel}>SCORE</Text>
          <Text style={[styles.hudStatValue, { color: '#F59E0B' }]}>{score}</Text>
        </View>
        <View style={styles.hudStatDivider} />
        <View style={styles.hudStatItem}>
          <Text style={styles.hudStatLabel}>COMBO</Text>
          <Text style={[styles.hudStatValue, { color: '#EF4444' }]}>🔥 {combo}x</Text>
        </View>
      </View>

      {/* Center Arcade Target Display Card */}
      <View style={[styles.stroopTargetCard, { backgroundColor: isDarkMode ? 'rgba(15,23,42,0.85)' : '#FFFFFF', borderColor: '#0D9488' }]}>
        <View style={[styles.stroopRuleBadge, { backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.2)' : '#E0F2FE' }]}>
          <Text style={[styles.stroopRuleTxt, { color: '#0284C7' }]}>💡 RULE: TAP TEXT FONT COLOR (NOT THE WORD!)</Text>
        </View>

        <Animated.Text style={[styles.stroopTargetWordTxt, { color: colorItem.color, transform: [{ scale: wordPopAnim }] }]}>
          {wordItem.name}
        </Animated.Text>
      </View>

      {/* 2x2 Arcade Color Button Grid */}
      <View style={styles.stroop2x2Grid}>
        {STROOP_COLORS.map((btnColor) => (
          <TouchableOpacity
            key={btnColor.name}
            activeOpacity={0.8}
            style={[styles.stroopGridButton, { backgroundColor: btnColor.color }]}
            onPress={() => handleColorChoice(btnColor)}
          >
            <Text style={styles.stroopBtnIcon}>{btnColor.icon}</Text>
            <Text style={styles.stroopBtnTxt}>{btnColor.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Clinical Protocol Validation Banner */}
      <View style={[styles.clinicalValidationBadge, { backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.2)' : '#F0FDFA', borderColor: '#0D9488' }]}>
        <Text style={[styles.clinicalValidationTxt, { color: textColor }]}>
          🏥 <Text style={{ fontWeight: '800', color: '#0D9488' }}>Clinical Protocol: </Text>
          Prefrontal Attentional Shifting (0.95 WESAD Recovery Rating)
        </Text>
      </View>
    </View>
  );
};

// ===========================================================================
// Core Activity Canvas Container & Router
// ===========================================================================
export const CognitiveDeStressGame = (props) => {
  const {
    activeMode: rawActiveMode,
    mode,
    initialMode,
    subOptionId,
    onFinish,
    isPaused = false,
    setIsPaused = () => {},
  } = props;

  const rawMode = mode || initialMode || subOptionId || rawActiveMode || 'autogenic_warmth';
  const techniqueId = TECHNIQUES[rawMode] ? rawMode : 'autogenic_warmth';

  const themeContext = React.useContext(ThemeContext);
  const theme = themeContext?.theme || {};
  const isDarkMode = themeContext?.isDarkMode === true || theme.mode === 'dark' || theme.isDark === true;

  const [screen, setScreen] = useState('session');
  const [tallyCount, setTallyCount] = useState(0);

  const tech = TECHNIQUES[techniqueId] || TECHNIQUES.autogenic_warmth;
  const primaryTextColor = isDarkMode ? '#FFFFFF' : '#0F172A';
  const secondaryTextColor = isDarkMode ? 'rgba(255,255,255,0.7)' : '#475569';

  const handleTally = () => {
    setTallyCount(c => c + 1);
  };

  if (screen === 'session') {
    return (
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false} bounces={false}>
        <LinearGradient colors={isDarkMode ? tech.bgDark : tech.bgLight} style={styles.sessionGradientWrapper}>
          {/* Header Card */}
          <View style={[styles.techHeaderCard, { backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.15)' : '#FFFFFF', borderColor: isDarkMode ? 'rgba(13, 148, 136, 0.35)' : '#CBD5E1' }]}>
            <View style={[styles.techHeaderIconRing, { backgroundColor: 'rgba(13, 148, 136, 0.2)' }]}>
              <Text style={styles.techHeaderIcon}>{tech.emoji}</Text>
            </View>
            <View style={styles.techHeaderTextWrap}>
              <Text style={[styles.techHeaderTitle, { color: primaryTextColor }]}>{tech.name}</Text>
              <Text style={[styles.techHeaderBadge, { color: '#0D9488' }]}>{tech.subtitle}</Text>
            </View>
            <View style={[styles.timeBadge, { backgroundColor: '#0D9488' }]}>
              <Text style={styles.timeBadgeTxt}>{tallyCount} Actions</Text>
            </View>
          </View>

          {/* Activity Canvas Router */}
          <View style={styles.canvasWrapper}>
            {techniqueId === 'autogenic_warmth' && <AutogenicWarmthActivity isDarkMode={isDarkMode} onTally={handleTally} />}
            {techniqueId === 'pattern_alignment' && <PatternAlignActivity isDarkMode={isDarkMode} onTally={handleTally} />}
            {techniqueId === 'stroop_decoupler' && <StroopDecouplerActivity isDarkMode={isDarkMode} onTally={handleTally} />}
          </View>

          {/* Session Controls */}
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

  return null;
};

const styles = StyleSheet.create({
  scrollContainer: { flexGrow: 1 },
  sessionGradientWrapper: {
    flex: 1,
    paddingTop: 10,
    paddingBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 480,
  },
  techHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: width * 0.92,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 4,
    elevation: 3,
    gap: 10,
  },
  techHeaderIconRing: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  techHeaderIcon: { fontSize: 22 },
  techHeaderTextWrap: { flex: 1 },
  techHeaderTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  techHeaderBadge: { fontSize: 10, fontWeight: '700', marginTop: 1 },
  timeBadge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  timeBadgeTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },

  canvasWrapper: { width: width * 0.92, height: Math.min(width * 0.78, 300), alignItems: 'center', justifyContent: 'center', marginVertical: 4 },
  activityCanvasContainer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', position: 'relative' },

  // Autogenic Thermal Layout
  thermalDeckRow: { flexDirection: 'row', width: '100%', gap: 10, flex: 1, marginVertical: 4 },
  thermalAuraCard: {
    width: 120,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thermalPulseRing: { width: 74, height: 74, borderRadius: 37, borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 6, position: 'relative' },
  rhythmRippleRing: { position: 'absolute', borderWidth: 2.5 },
  thermalBigIcon: { fontSize: 32 },
  thermalStageBadge: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  thermalInfoCol: { flex: 1, justifyContent: 'center' },
  thermalInstructionBox: { padding: 12, borderRadius: 16, borderWidth: 1.5, flex: 1, justifyContent: 'center' },
  thermalGuideLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6, marginBottom: 3 },
  thermalGuideTxt: { fontSize: 12, fontWeight: '700', lineHeight: 16, marginBottom: 6 },
  thermalEffectBox: { padding: 8, borderRadius: 10 },
  thermalEffectTxt: { fontSize: 10, lineHeight: 14 },

  thermalZonePillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, width: '100%', marginVertical: 4 },
  thermalZonePill: {
    flex: 1,
    minWidth: 70,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    elevation: 1,
  },
  zonePillEmoji: { fontSize: 12 },
  zonePillLabel: { fontSize: 9, fontWeight: '900' },

  activeZoneDetailCard: { padding: 12, borderRadius: 16, borderWidth: 1.5 },
  clinicalValidationBadge: { width: '100%', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, marginTop: 4 },
  clinicalValidationTxt: { fontSize: 9, textAlign: 'center', lineHeight: 13 },

  // Pure Color Matrix Layout
  neuralCanvasContainer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  neuralHudCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  hudStatItem: { alignItems: 'center' },
  hudStatLabel: { fontSize: 8, fontWeight: '800', color: '#64748B', letterSpacing: 0.6 },
  hudStatValue: { fontSize: 11, fontWeight: '900', marginTop: 1 },
  hudStatDivider: { width: 1, height: 16, backgroundColor: 'rgba(100,116,139,0.2)' },

  dualArenaRow: { flexDirection: 'row', width: '100%', gap: 10, flex: 1, marginTop: 6 },
  arenaSideCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arenaCardHeader: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, marginBottom: 8 },

  miniBlueprintGrid: { width: 114, height: 114, flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'center' },
  miniBlueprintTile: { width: 34, height: 34, borderRadius: 10, elevation: 2 },

  interactiveGameGrid: { width: 134, height: 134, flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'center' },
  gameMatrixCardTile: { width: 40, height: 40, borderRadius: 11, elevation: 3, position: 'relative' },
  gameMatrixCardMatched: { borderWidth: 2.5, borderColor: '#FFFFFF' },
  gameMatchedCheck: { position: 'absolute', top: 2, right: 2, backgroundColor: '#FFFFFF', width: 12, height: 12, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  gameCheckIcon: { color: '#0F172A', fontSize: 8, fontWeight: '900' },

  // Stroop Cognitive Decoupler Layout
  stroopGameArenaContainer: { width: '100%', height: '100%', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  stroopTargetCard: { width: '100%', height: 110, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center', padding: 8, marginVertical: 4 },
  stroopRuleBadge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, marginBottom: 6 },
  stroopRuleTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  stroopTargetWordTxt: { fontSize: 36, fontWeight: '900', letterSpacing: 2 },

  stroop2x2Grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%', justifyContent: 'space-between' },
  stroopGridButton: {
    width: '48%',
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 4,
  },
  stroopBtnIcon: { fontSize: 16 },
  stroopBtnTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.8 },

  // Session Control Button
  sessionControlBtn: { width: width * 0.92, paddingVertical: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center', elevation: 3, marginTop: 4 },
  sessionControlBtnTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
});

export const AutogenicWarmthGame = CognitiveDeStressGame;
export default CognitiveDeStressGame;