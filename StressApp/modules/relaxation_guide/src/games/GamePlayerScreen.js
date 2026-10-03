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
    title: 'Lily Pond Breathing',
    icon: '🪷',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.12)',
    meaningTitle: '🪷 Deep Exhale Vagal Reset',
    meaningDesc: 'Slow exhalations signal your nervous system to calm down, quickly lowering heart rate and body stress.',
    defaultBpm: 6,
    suggestedMin: 3,
  },
  diaphragmatic_pace: {
    id: 'diaphragmatic_pace',
    title: 'Deep Belly Pacing',
    icon: '🫁',
    color: '#0284C7',
    bg: 'rgba(2, 132, 199, 0.12)',
    meaningTitle: '🫁 Lower Lobe Abdominal Expansion',
    meaningDesc: 'Expanding stomach outward on inhale and softening inward on exhale resets ANS balance.',
    defaultBpm: 6,
    suggestedMin: 4,
  },
  box_meditation: {
    id: 'box_meditation',
    title: 'Box Breathing',
    icon: '🧊',
    color: '#0284C7',
    bg: 'rgba(2, 132, 199, 0.12)',
    meaningTitle: '🧊 Balanced Square Breathing',
    meaningDesc: 'Equal 4s inhale, 4s hold, 4s exhale, and 4s pause restores calm and steady focus.',
    defaultBpm: 6,
    suggestedMin: 3,
  },
  pattern_alignment: {
    id: 'pattern_alignment',
    title: 'Memory Match',
    icon: '🧩',
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.12)',
    meaningTitle: '🧩 Focus & Pattern Match',
    meaningDesc: 'A light visual matching puzzle shifts your active focus away from stressful thoughts.',
    defaultBpm: 6,
    suggestedMin: 2,
  },
  body_scan_mindful: {
    id: 'body_scan_mindful',
    title: 'Mindful Body Scan',
    icon: '🧘‍♂️',
    color: '#3B82F6',
    bg: 'rgba(59, 130, 246, 0.12)',
    meaningTitle: '🧘‍♂️ Attentional Body Sweep',
    meaningDesc: 'Systematic attentional sweep across body regions to release somatic hyperarousal.',
    defaultBpm: 6,
    suggestedMin: 5,
  },
  autogenic_warmth: {
    id: 'autogenic_warmth',
    title: 'Autogenic Thermal Focus',
    icon: '🔥',
    color: '#EF4444',
    bg: 'rgba(239, 68, 68, 0.12)',
    meaningTitle: '🔥 Somatosensory Thermal Warmth',
    meaningDesc: 'Somatosensory thermal focus for peripheral vasodilation and vascular relaxation.',
    defaultBpm: 6,
    suggestedMin: 4,
  },
  flower_meadow: {
    id: 'flower_meadow',
    title: 'Flower Meadow Garden Bloom',
    icon: '🌸',
    color: '#F472B6',
    bg: 'rgba(244, 114, 182, 0.12)',
    meaningTitle: '🌸 Biophilic Attention Restoration & Garden Bloom',
    meaningDesc: 'Interactive floral garden bloom entrainment for maximum biophilic WESAD recovery (0.97 score).',
    defaultBpm: 6,
    suggestedMin: 3,
  },
  stroop_decoupler: {
    id: 'stroop_decoupler',
    title: 'Stroop Cognitive Decoupler',
    icon: '🎯',
    color: '#3B82F6',
    bg: 'rgba(59, 130, 246, 0.12)',
    meaningTitle: '🎯 Prefrontal Executive Interference Task',
    meaningDesc: 'High-speed cognitive refocusing puzzle suppressing DMN rumination for 0.95 WESAD recovery rating.',
    defaultBpm: 6,
    suggestedMin: 3,
  },
};

const getTechKey = (id) => {
  const raw = (id || '').toLowerCase();
  if (raw === 'water_lily_pond' || raw === 'lily_pond') return 'water_lily_pond';
  if (raw === 'diaphragmatic_pace' || raw === 'belly_pacing') return 'diaphragmatic_pace';
  if (raw === 'box_meditation' || raw === 'box') return 'box_meditation';
  if (raw === 'pattern_alignment' || raw === 'pattern') return 'pattern_alignment';
  if (raw === 'body_scan_mindful' || raw === 'body_scan') return 'body_scan_mindful';
  if (raw === 'autogenic_warmth' || raw === 'autogenic') return 'autogenic_warmth';
  if (raw === 'flower_meadow' || raw === 'meadow') return 'flower_meadow';
  if (raw === 'stroop_decoupler' || raw === 'stroop') return 'stroop_decoupler';
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

  const [gameState, setGameState] = useState('playing'); // playing, paused, completed
  const [hasStarted, setHasStarted] = useState(true);
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
      case 'flower_meadow':
        return <FlowerMeadowGame initialScreen="session" initialDurationMin={selectedMin} initialBpm={paceBpm} onStartSession={handleStartSession} />;

      case 'water_lily_pond':
        return <LilyPondGame initialScreen="session" initialDurationMin={selectedMin} initialBpm={paceBpm} onStartSession={handleStartSession} />;

      case 'box_meditation':
      case 'diaphragmatic_pace':
      case 'body_scan_mindful':
        return <MeditationGame mode={techKey} initialMode={techKey} initialDurationMin={selectedMin} initialBpm={paceBpm} onStartSession={handleStartSession} />;

      case 'pattern_alignment':
      case 'autogenic_warmth':
      case 'stroop_decoupler':
        return <CognitiveDeStressGame mode={techKey} subOptionId={techKey} initialScreen="session" initialDurationMin={selectedMin} onFinish={handleFinishGame} onStartSession={handleStartSession} />;

      default:
        return <FlowerMeadowGame initialScreen="session" initialDurationMin={selectedMin} initialBpm={paceBpm} onStartSession={handleStartSession} />;
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      {/* Header Controls Bar */}
      <Animated.View style={[
        styles.topBar,
        { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: fadeAnim }
      ]}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setCurrentScreen('Dashboard')}
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

        <Text style={[styles.gameDescription, { color: theme.textMuted }]} numberOfLines={1}>{tech.meaningTitle}</Text>
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

      {/* Bottom Completion Action Bar */}
      <View style={[styles.bottomBarContainer, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.completeSessionBtn, { backgroundColor: '#10B981' }]}
          onPress={handleFinishGame}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.completeSessionBtnTxt}>Complete Session & View Results</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  backButton: {
    padding: 6,
    borderRadius: 8,
  },
  gameTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gameIcon: {
    fontSize: 22,
  },
  gameTitleText: {
    fontSize: 18,
    fontWeight: '800',
  },
  pauseButton: {
    padding: 6,
    borderRadius: 8,
  },
  gameDescription: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  timerWrapper: {
    alignItems: 'flex-start',
  },
  statsWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 20,
  },
  canvasContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 18,
    overflow: 'hidden',
  },
  pausedOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedContent: {
    paddingVertical: 24,
    paddingHorizontal: 32,
    borderRadius: 20,
    alignItems: 'center',
    gap: 12,
  },
  pausedIcon: {
    fontSize: 40,
  },
  pausedText: {
    fontSize: 18,
    fontWeight: '800',
  },
  resumeButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 4,
  },
  resumeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  bottomBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeSessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 14,
    elevation: 3,
  },
  completeSessionBtnTxt: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});

export default GamePlayerScreen;