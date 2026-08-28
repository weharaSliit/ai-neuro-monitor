import React, { useContext, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
  SafeAreaView,
  ScrollView
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { Timer } from '../components/Timer';
import { Ionicons } from '@expo/vector-icons';

// Import Interactive Games & Guided Meditation
import { FlowerMeadowGame } from '../games/FlowerMeadowGame';
import { LilyPondGame } from '../games/LilyPondGame';
import { PulseWaveGame } from '../games/PulseWaveGame';
import { CognitiveDeStressGame } from '../games/CognitiveDeStressGame';
import { MeditationGame } from '../games/MeditationGame';

const { width, height } = Dimensions.get('window');

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED TECHNIQUE CLINICAL METADATA & NEUROLOGICAL MEANINGS
// ═══════════════════════════════════════════════════════════════════════════
const TECHNIQUE_DETAILS = {
  water_lily_pond: {
    id: 'water_lily_pond',
    title: 'Lily Pond Diaphragmatic Exhale',
    icon: '🪷',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.12)',
    rank: 'WESAD Rank #1 · 100% Recovery (89s)',
    meaningTitle: '🧬 Vagal Nerve Diaphragmatic Activation',
    meaningDesc: 'Longer exhalations (4s inhale : 6s exhale) stimulate the vagus nerve to trigger the parasympathetic brake, rapidly lowering heart rate, blood pressure, and skin conductance.',
    defaultBpm: 6,
    hasPace: true,
    suggestedMin: 1.5,
    suggestedSec: 90,
    durationOptions: [1, 1.5, 2, 3],
  },
  vagus_humming: {
    id: 'vagus_humming',
    title: 'Vagal Humming Exhale',
    icon: '🧘‍♀️',
    color: '#8B5CF6',
    bg: 'rgba(139, 92, 246, 0.12)',
    rank: 'WESAD Rank #2 · 80% Recovery (134s)',
    meaningTitle: '🧘‍♀️ Acoustic Laryngeal Vagal Stimulation',
    meaningDesc: 'Steady vocal humming during exhalation creates laryngeal sound vibrations that directly stimulate vagal nerve fibers, interrupting acute sympathetic cardiac arousal.',
    defaultBpm: 5.5,
    hasPace: true,
    suggestedMin: 2,
    suggestedSec: 120,
    durationOptions: [1, 2, 3, 4],
  },
  cosmic_nebula: {
    id: 'cosmic_nebula',
    title: 'Cosmic Nebula (Resonance 6 bpm)',
    icon: '🌌',
    color: '#A78BFA',
    bg: 'rgba(167, 139, 250, 0.12)',
    rank: 'WESAD Rank #3 · 80% Recovery (137s)',
    meaningTitle: '🌌 0.1 Hz Baroreflex HRV Resonance',
    meaningDesc: 'Breathing smoothly at ~6 breaths per minute matches the natural resonance frequency (~0.1 Hz) of the cardiovascular system, maximizing Heart Rate Variability (HRV).',
    defaultBpm: 6,
    hasPace: true,
    suggestedMin: 2,
    suggestedSec: 120,
    durationOptions: [1, 2, 3, 4],
  },
  flower_meadow: {
    id: 'flower_meadow',
    title: 'Flower Meadow (4-7-8 Bloom)',
    icon: '🌺',
    color: '#EC4899',
    bg: 'rgba(236, 72, 153, 0.12)',
    rank: 'WESAD Rank #4 · 80% Recovery (140s)',
    meaningTitle: '🌺 Parasympathetic 4-7-8 Breathing Reset',
    meaningDesc: '4s inhale, 7s hold, and 8s slow exhale increases blood oxygenation during hold and triggers intense parasympathetic activation during extended exhalation.',
    defaultBpm: 4.5,
    hasPace: false,
    suggestedMin: 2.5,
    suggestedSec: 150,
    durationOptions: [1, 2, 2.5, 3],
  },
  diaphragmatic_pace: {
    id: 'diaphragmatic_pace',
    title: 'Deep Abdominal Pacing',
    icon: '🫁',
    color: '#3B82F6',
    bg: 'rgba(59, 130, 246, 0.12)',
    rank: 'WESAD Rank #5 · 66.7% Recovery (169s)',
    meaningTitle: '🫁 Deep Abdominal & Lower Lobe Expansion',
    meaningDesc: 'Pacing deep abdominal breaths expands lower lung lobes, suppressing upper-chest shallow breathing and reducing systemic muscle tension.',
    defaultBpm: 5,
    hasPace: true,
    suggestedMin: 3,
    suggestedSec: 180,
    durationOptions: [1.5, 2, 3, 4],
  },
  box_meditation: {
    id: 'box_meditation',
    title: 'Box Breathing (4-4-4-4)',
    icon: '📦',
    color: '#38BDF8',
    bg: 'rgba(56, 189, 248, 0.12)',
    rank: 'WESAD Rank #6 · 60% Recovery (184s)',
    meaningTitle: '📦 Square Autonomic CO2 Balance Reset',
    meaningDesc: 'Equal 4s inhale, 4s hold, 4s exhale, and 4s pause balances carbon dioxide and oxygen levels in blood, steadying the autonomic nervous system during stress.',
    defaultBpm: 6,
    hasPace: false,
    suggestedMin: 3,
    suggestedSec: 180,
    durationOptions: [1.5, 2, 3, 4],
  },
  soft_fascination: {
    id: 'soft_fascination',
    title: 'Nature Restoration Viewing',
    icon: '🌿',
    color: '#059669',
    bg: 'rgba(5, 150, 105, 0.12)',
    rank: 'WESAD Rank #7 · 60% Recovery (190s)',
    meaningTitle: '🌿 Attention Restoration Theory (ART)',
    meaningDesc: 'Viewing gentle biophilic nature movements engages effortless attention, allowing depleted directed-attention mechanisms in the prefrontal cortex to recover.',
    defaultBpm: 6,
    hasPace: false,
    suggestedMin: 3,
    suggestedSec: 180,
    durationOptions: [2, 3, 4, 5],
  },
  progressive_muscle: {
    id: 'progressive_muscle',
    title: 'Progressive Muscle Release',
    icon: '🦾',
    color: '#D97706',
    bg: 'rgba(217, 119, 6, 0.12)',
    rank: 'WESAD Rank #8 · 46.7% Recovery (217s)',
    meaningTitle: '🦾 Somatic Cortisol Tension Discharge',
    meaningDesc: 'Systematically tensing and releasing key muscle groups discharges physical cortisol, breaking the somatic feedback loop that maintains mental anxiety.',
    defaultBpm: 6,
    hasPace: false,
    suggestedMin: 3.5,
    suggestedSec: 210,
    durationOptions: [2, 3, 3.5, 5],
  },
  guided_imagery: {
    id: 'guided_imagery',
    title: 'Guided Forest Walk',
    icon: '🌲',
    color: '#047857',
    bg: 'rgba(4, 120, 87, 0.12)',
    rank: 'WESAD Rank #9 · 26.7% Recovery (254s)',
    meaningTitle: '🌲 Spatial Prefrontal Cognitive Distraction',
    meaningDesc: 'Multisensory forest trail imagery engages spatial and visual brain networks, redirecting cognitive bandwidth away from intrusive worry loops.',
    defaultBpm: 6,
    hasPace: false,
    suggestedMin: 4,
    suggestedSec: 240,
    durationOptions: [2, 3, 4, 5],
  },
  pattern_alignment: {
    id: 'pattern_alignment',
    title: 'Visuospatial Memory Alignment',
    icon: '🧩',
    color: '#7E57C2',
    bg: 'rgba(126, 87, 194, 0.12)',
    rank: 'WESAD Rank #10 · 20% Recovery (268s)',
    meaningTitle: '🧩 Visuospatial Working Memory Occupancy',
    meaningDesc: 'A calm visuospatial color-matching task occupies central executive memory channels, preventing emotional stress rumination.',
    defaultBpm: 6,
    hasPace: false,
    suggestedMin: 4.5,
    suggestedSec: 270,
    durationOptions: [2, 3, 4.5, 5],
  },
};

const getTechKey = (id) => {
  const raw = (id || '').toLowerCase();
  if (raw === 'water_lily_pond' || raw === 'lily_pond') return 'water_lily_pond';
  if (raw === 'vagus_humming') return 'vagus_humming';
  if (raw === 'cosmic_nebula') return 'cosmic_nebula';
  if (raw === 'flower_meadow') return 'flower_meadow';
  if (raw === 'diaphragmatic_pace') return 'diaphragmatic_pace';
  if (raw === 'box_meditation') return 'box_meditation';
  if (raw === 'soft_fascination' || raw === 'nature' || raw === 'cloud_float') return 'soft_fascination';
  if (raw === 'progressive_muscle' || raw === 'muscle') return 'progressive_muscle';
  if (raw === 'guided_imagery') return 'guided_imagery';
  if (raw === 'pattern_alignment' || raw === 'pattern' || raw === 'pattern_align') return 'pattern_alignment';
  return 'water_lily_pond';
};

export const GamePlayerScreen = () => {
  const {
    currentRecommendation,
    selectedSubOption,
    setCurrentScreen
  } = useContext(AppContext);
  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);

  const subId = selectedSubOption ? selectedSubOption.id : 'water_lily_pond';
  const techKey = getTechKey(subId);
  const tech = TECHNIQUE_DETAILS[techKey] || TECHNIQUE_DETAILS.water_lily_pond;

  const [gameState, setGameState] = useState('setup'); // setup, playing, paused, completed
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedMin, setSelectedMin] = useState(tech.suggestedMin || 1.5);
  const [sessionSeconds, setSessionSeconds] = useState((tech.suggestedMin || 1.5) * 60);
  const [paceBpm, setPaceBpm] = useState(tech.defaultBpm || 6);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [gameTime, setGameTime] = useState(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef(null);

  useEffect(() => {
    if (tech) {
      setSelectedMin(tech.suggestedMin || 1.5);
      setSessionSeconds((tech.suggestedMin || 1.5) * 60);
      if (tech.defaultBpm) setPaceBpm(tech.defaultBpm);
    }
  }, [techKey]);

  const handleStartSession = (durationInSec) => {
    if (typeof durationInSec === 'number' && durationInSec > 0) {
      setSessionSeconds(durationInSec);
    } else {
      setSessionSeconds(selectedMin * 60);
    }
    setHasStarted(true);
    setGameState('playing');
  };

  const handleFinishGame = () => {
    setGameState('completed');
    setCurrentScreen('Rating');
  };

  const togglePause = () => {
    setGameState(prev => (prev === 'playing' ? 'paused' : 'playing'));
  };

  // Timer interval
  useEffect(() => {
    if (hasStarted && gameState === 'playing') {
      timerRef.current = setInterval(() => {
        setGameTime(prev => {
          const next = prev + 1;
          if (next >= sessionSeconds) {
            clearInterval(timerRef.current);
            handleFinishGame();
          }
          return next;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }

    return () => clearInterval(timerRef.current);
  }, [hasStarted, gameState, sessionSeconds]);

  const renderGameCanvas = () => {
    switch (techKey) {
      case 'water_lily_pond':
        return <LilyPondGame initialScreen="session" initialDurationMin={selectedMin} initialBpm={paceBpm} onStartSession={handleStartSession} />;
      case 'flower_meadow':
        return <FlowerMeadowGame onStartSession={handleStartSession} />;
      case 'cosmic_nebula':
        return <PulseWaveGame mode="cosmic_nebula" initialScreen="session" initialDurationMin={selectedMin} initialBpm={paceBpm} onStartSession={handleStartSession} />;

      case 'vagus_humming':
      case 'diaphragmatic_pace':
      case 'box_meditation':
        return <MeditationGame mode={techKey} initialMode={techKey} initialDurationMin={selectedMin} initialBpm={paceBpm} onStartSession={handleStartSession} />;

      case 'soft_fascination':
      case 'progressive_muscle':
      case 'guided_imagery':
      case 'pattern_alignment':
        return <CognitiveDeStressGame mode={techKey} subOptionId={techKey} initialScreen="session" initialDurationMin={selectedMin} onFinish={handleFinishGame} onStartSession={handleStartSession} />;

      default:
        return <LilyPondGame initialScreen="session" initialDurationMin={selectedMin} initialBpm={paceBpm} onStartSession={handleStartSession} />;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED BEGIN / SETUP SCREEN (IDENTICAL FOR ALL 10 TECHNIQUES)
  // ═══════════════════════════════════════════════════════════════════════════
  if (!hasStarted || gameState === 'setup') {
    const paceOptions = [4.5, 5, 5.5, 6, 6.5, 7];
    const durationOptions = tech.durationOptions || [1, 1.5, 2, 3];

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.bgSecondary} />
        <Header title="Technique Setup" showBack onBack={() => setCurrentScreen('SubOptionSelector')} />

        <ScrollView contentContainerStyle={styles.unifiedSetupScroll} showsVerticalScrollIndicator={false}>
          {/* Header Card: Icon + Title + Rank */}
          <View style={[styles.unifiedCardHeader, { borderColor: tech.color + '40', backgroundColor: isDarkMode ? tech.bg : `${tech.color}15` }]}>
            <View style={[styles.unifiedIconRing, { borderColor: tech.color, backgroundColor: tech.color + '20' }]}>
              <Text style={styles.unifiedIconTxt}>{tech.icon}</Text>
            </View>
            <Text style={[styles.unifiedTitle, { color: theme.textPrimary }]}>{tech.title}</Text>
            <View style={[styles.unifiedBadge, { backgroundColor: tech.color }]}>
              <Text style={styles.unifiedBadgeTxt}>{tech.rank}</Text>
            </View>
          </View>

          {/* Meaning & Purpose Box */}
          <View style={[styles.meaningCard, { borderColor: theme.border, backgroundColor: theme.bgSecondary }]}>
            <View style={styles.meaningHeader}>
              <Text style={[styles.meaningTitle, { color: tech.color }]}>{tech.meaningTitle}</Text>
            </View>
            <Text style={[styles.meaningBody, { color: theme.textSecondary }]}>{tech.meaningDesc}</Text>
          </View>

          {/* Breathing Pace Selector */}
          {tech.hasPace && (
            <View style={styles.selectorSection}>
              <Text style={[styles.selectorLabel, { color: theme.textMuted }]}>🌬️ BREATHING PACE</Text>
              <View style={styles.chipRow}>
                {paceOptions.map(bpm => (
                  <TouchableOpacity
                    key={bpm}
                    onPress={() => setPaceBpm(bpm)}
                    style={[
                      styles.unifiedChip,
                      { backgroundColor: theme.bgSecondary, borderColor: theme.border },
                      paceBpm === bpm && { backgroundColor: tech.color, borderColor: tech.color }
                    ]}
                  >
                    <Text style={[styles.unifiedChipTxt, { color: theme.textPrimary }, paceBpm === bpm && { color: '#FFFFFF', fontWeight: '800' }]}>
                      {bpm} bpm
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.selectorHint, { color: theme.textMuted }]}>6 bpm is clinical baroreflex HRV resonance standard</Text>
            </View>
          )}

          {/* Session Length Selector */}
          <View style={styles.selectorSection}>
            <Text style={[styles.selectorLabel, { color: theme.textMuted }]}>⏱️ SESSION LENGTH (RECOMMENDED: {tech.suggestedMin} MIN)</Text>
            <View style={styles.chipRow}>
              {durationOptions.map(min => {
                const isSelected = selectedMin === min;
                return (
                  <TouchableOpacity
                    key={min}
                    onPress={() => {
                      setSelectedMin(min);
                      setSessionSeconds(min * 60);
                    }}
                    style={[
                      styles.unifiedChipLarge,
                      { backgroundColor: theme.bgSecondary, borderColor: theme.border },
                      isSelected && { backgroundColor: tech.color, borderColor: tech.color }
                    ]}
                  >
                    <Text style={[styles.unifiedChipTxtLarge, { color: theme.textPrimary }, isSelected && { color: '#FFFFFF', fontWeight: '800' }]}>
                      {min} min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.selectorHint, { color: theme.textMuted }]}>Targeted real-time stress intervention duration</Text>
          </View>

          {/* Begin Button */}
          <TouchableOpacity
            style={[styles.unifiedBeginBtn, { backgroundColor: tech.color }]}
            onPress={() => {
              handleStartSession(selectedMin * 60);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.unifiedBeginBtnTxt}>▶️  Begin Technique ({selectedMin} min)</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVE GAME CANVAS SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.bgSecondary} />

      {/* Game Header */}
      <Animated.View style={[
        styles.headerContainer,
        {
          backgroundColor: theme.bgSecondary,
          borderBottomColor: theme.border,
          borderBottomWidth: 1,
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }]
        }
      ]}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setHasStarted(false)}
          >
            <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
          </TouchableOpacity>

          <View style={styles.gameTitle}>
            <Text style={styles.gameIcon}>{tech.icon}</Text>
            <Text style={[styles.gameTitleText, { color: theme.textPrimary }]} numberOfLines={1}>{tech.title}</Text>
          </View>

          <TouchableOpacity style={styles.pauseButton} onPress={togglePause}>
            <Ionicons
              name={gameState === 'playing' ? 'pause' : 'play'}
              size={22}
              color={theme.textPrimary}
            />
          </TouchableOpacity>
        </View>

        <Text style={[styles.gameDescription, { color: theme.textMuted }]} numberOfLines={1}>{tech.rank} · {tech.meaningTitle}</Text>
      </Animated.View>

      {/* Timer & Stats Bar */}
      <Animated.View style={[
        styles.statsBar,
        { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: fadeAnim }
      ]}>
        <View style={styles.timerWrapper}>
          <Text style={[styles.statLabel, { color: theme.textMuted }]}>⏱️ TARGET TIME</Text>
          <Text style={[styles.statValue, { color: tech.color || theme.accent }]}>
            {selectedMin} min ({sessionSeconds}s)
          </Text>
        </View>

        <View style={styles.statsWrapper}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>Score</Text>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{score}</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>Level</Text>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{level}</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>Time</Text>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>
              {Math.floor(gameTime / 60)}:{String(gameTime % 60).padStart(2, '0')}
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Game Canvas Container */}
      <Animated.View style={[
        styles.canvasContainer,
        {
          opacity: fadeAnim,
          transform: [
            { scale: scaleAnim },
            { scale: pulseAnim }
          ]
        }
      ]}>
        {gameState === 'playing' ? (
          renderGameCanvas()
        ) : (
          <View style={[styles.pausedOverlay, { backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.92)' }]}>
            <View style={[styles.pausedContent, { backgroundColor: theme.bgSecondary, borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={styles.pausedIcon}>⏸️</Text>
              <Text style={[styles.pausedText, { color: theme.textPrimary }]}>Session Paused</Text>
              <TouchableOpacity style={[styles.resumeButton, { backgroundColor: theme.accent }]} onPress={togglePause}>
                <Text style={styles.resumeButtonText}>Resume</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>

      {/* Complete Activity & Proceed Footer Bar */}
      <View style={[styles.completeFooterBar, { backgroundColor: theme.bgSecondary, borderTopColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.completeBtn, { backgroundColor: tech.color || theme.accent || '#10B981' }]}
          onPress={handleFinishGame}
          activeOpacity={0.85}
        >
          <Text style={styles.completeBtnTxt}>✅  Complete Activity & Proceed  →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  unifiedSetupScroll: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  unifiedCardHeader: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1.5,
    gap: 12,
  },
  unifiedIconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unifiedIconTxt: {
    fontSize: 36,
  },
  unifiedTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  unifiedBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  unifiedBadgeTxt: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  meaningCard: {
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
  },
  meaningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  meaningTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  meaningBody: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 20,
  },
  selectorSection: {
    gap: 8,
  },
  selectorLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  unifiedChip: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
  },
  unifiedChipTxt: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  unifiedChipLarge: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 18,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
  },
  unifiedChipTxtLarge: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '700',
  },
  selectorHint: {
    color: '#64748B',
    fontSize: 11,
  },
  unifiedBeginBtn: {
    paddingVertical: 16,
    borderRadius: 20,
    alignItems: 'center',
    marginTop: 8,
    elevation: 4,
  },
  unifiedBeginBtnTxt: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  headerContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  backButton: {
    padding: 6,
  },
  gameTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  gameIcon: {
    fontSize: 20,
  },
  gameTitleText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  pauseButton: {
    padding: 6,
  },
  gameDescription: {
    fontSize: 11,
    textAlign: 'center',
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  timerWrapper: {
    flex: 1,
  },
  statsWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  statDivider: {
    width: 1,
    height: 16,
  },
  canvasContainer: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99,
  },
  pausedContent: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  pausedIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  pausedText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 18,
  },
  resumeButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  resumeButtonText: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  completeFooterBar: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    width: '100%',
  },
  completeBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  completeBtnTxt: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});