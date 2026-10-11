import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
  Vibration,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { DailyTasksModal } from '../components/DailyTasksModal';
import { RewardChestModal } from '../components/RewardChestModal';

// Import Interactive Games
import { FlowerMeadowGame } from '../games/FlowerMeadowGame';
import { LilyPondGame } from '../games/LilyPondGame';
import { PulseWaveGame } from '../games/PulseWaveGame';
import { CognitiveDeStressGame } from '../games/CognitiveDeStressGame';
import { MeditationGame } from '../games/MeditationGame';
import {
  PMRMuscleReleaseGame,
  EMDRSaccadicTraceGame,
  BioGSRLiquidPoolGame,
} from '../games/InnovativeTechniquesGame';

const { width } = Dimensions.get('window');

// GAMIFIED TECHNIQUE DETAILS & UNIQUE COLOR-MIXED GRADIENT PALETTES
const TECHNIQUE_DETAILS = {
  flower_meadow: {
    id: 'flower_meadow',
    title: 'Calm Meadow',
    icon: '🌸',
    color: '#EC4899',
    gradient: ['#F43F5E', '#EC4899', '#FDE68A'], // Sunset Blossom Gradient
    meaningTitle: 'Garden Bloom Breathing',
    suggestedMin: 3,
  },
  water_lily_pond: {
    id: 'water_lily_pond',
    title: 'Zen Lily Pond',
    icon: '🪷',
    color: '#10B981',
    gradient: ['#059669', '#10B981', '#06B6D4'], // Emerald Lagoon Gradient
    meaningTitle: 'Breathe with Water Lilies',
    suggestedMin: 3,
  },
  box_meditation: {
    id: 'box_meditation',
    title: 'Focus Box',
    icon: '🧊',
    color: '#0EA5E9',
    gradient: ['#1E1B4B', '#3B82F6', '#38BDF8'], // Cosmic Sapphire Gradient
    meaningTitle: 'Square Breathing Rhythm',
    suggestedMin: 3,
  },
  diaphragmatic_pace: {
    id: 'diaphragmatic_pace',
    title: 'Deep Belly Calm',
    icon: '🫁',
    color: '#3B82F6',
    gradient: ['#0284C7', '#0EA5E9', '#6EE7B7'], // Ocean Wave Gradient
    meaningTitle: 'Deep Belly Breathing',
    suggestedMin: 3,
  },
  pattern_alignment: {
    id: 'pattern_alignment',
    title: 'Color Match',
    icon: '🧩',
    color: '#F59E0B',
    gradient: ['#8B5CF6', '#D946EF', '#F59E0B'], // Prismatic Amber Gradient
    meaningTitle: 'Color Pattern Puzzle',
    suggestedMin: 2,
  },
  body_scan_mindful: {
    id: 'body_scan_mindful',
    title: 'Body Sweep',
    icon: '🧘‍♂️',
    color: '#8B5CF6',
    gradient: ['#4C1D95', '#7C3AED', '#C4B5FD'], // Violet Twilight Gradient
    meaningTitle: 'Mindful Body Scan',
    suggestedMin: 4,
  },
  autogenic_warmth: {
    id: 'autogenic_warmth',
    title: 'Warmth Flow',
    icon: '🔥',
    color: '#EF4444',
    gradient: ['#B91C1C', '#EF4444', '#F59E0B'], // Radiant Thermal Fire Gradient
    meaningTitle: 'Gentle Thermal Warmth',
    suggestedMin: 3,
  },
  stroop_decoupler: {
    id: 'stroop_decoupler',
    title: 'Color Clash',
    icon: '🎯',
    color: '#06B6D4',
    gradient: ['#0891B2', '#06B6D4', '#A855F7'], // Cyber Neon Gradient
    meaningTitle: 'Speed Color Challenge',
    suggestedMin: 3,
  },

  // ===== INNOVATIVE BIOPHYSICAL TECHNIQUES =====
  pmr_crystal_squeeze: {
    id: 'pmr_crystal_squeeze',
    title: 'Somatic PMR',
    icon: '💎',
    color: '#EC4899',
    gradient: ['#881337', '#BE185D', '#F472B6'],
    meaningTitle: 'PMR Iso-Tension & Release',
    suggestedMin: 3,
  },
  emdr_saccadic_trace: {
    id: 'emdr_saccadic_trace',
    title: 'Cosmic Trace',
    icon: '✨',
    color: '#38BDF8',
    gradient: ['#0369A1', '#38BDF8', '#C084FC'],
    meaningTitle: 'EMDR Saccadic Desensitization',
    suggestedMin: 3,
  },
  galvanic_biofeedback_flow: {
    id: 'galvanic_biofeedback_flow',
    title: 'Bio GSR Pool',
    icon: '💧',
    color: '#06B6D4',
    gradient: ['#083344', '#06B6D4', '#67E8F9'],
    meaningTitle: 'GSR Fluid Closed-Loop Biofeedback',
    suggestedMin: 3,
  },
};

const getTechKey = (target) => {
  let raw = '';
  if (typeof target === 'string') {
    raw = target;
  } else if (target && typeof target === 'object') {
    raw = target.id || target.technique_id || target.key || target.title || '';
  }
  const s = String(raw).toLowerCase();

  if (s.includes('pmr') || s.includes('crystal') || s.includes('somatic') || s.includes('squeeze')) return 'pmr_crystal_squeeze';
  if (s.includes('emdr') || s.includes('saccadic') || s.includes('trace') || s.includes('cosmic')) return 'emdr_saccadic_trace';
  if (s.includes('gsr') || s.includes('galvanic') || s.includes('fluid') || s.includes('pool')) return 'galvanic_biofeedback_flow';

  if (s.includes('pattern') || s.includes('match') || s.includes('alignment')) return 'pattern_alignment';
  if (s.includes('autogenic') || s.includes('warmth') || s.includes('warm')) return 'autogenic_warmth';
  if (s.includes('stroop') || s.includes('clash') || s.includes('decoupler')) return 'stroop_decoupler';
  if (s.includes('flower') || s.includes('meadow')) return 'flower_meadow';
  if (s.includes('lily') || s.includes('pond') || s.includes('water')) return 'water_lily_pond';
  if (s.includes('box') || s.includes('meditation')) return 'box_meditation';
  if (s.includes('diaphragmatic') || s.includes('belly') || s.includes('deep')) return 'diaphragmatic_pace';
  if (s.includes('body') || s.includes('scan') || s.includes('sweep') || s.includes('mindful')) return 'body_scan_mindful';

  return 'flower_meadow';
};

export const GamePlayerScreen = () => {
  const {
    selectedSubOption,
    currentRecommendation,
    setCurrentScreen
  } = useContext(AppContext);
  const { theme, isDarkMode } = useContext(ThemeContext);

  const rawTarget = selectedSubOption || currentRecommendation || 'flower_meadow';
  const techKey = getTechKey(rawTarget);
  const tech = TECHNIQUE_DETAILS[techKey] || TECHNIQUE_DETAILS.flower_meadow;

  const [gameState, setGameState] = useState('playing');
  const [sessionSeconds, setSessionSeconds] = useState((tech.suggestedMin || 3) * 60);
  const [score, setScore] = useState(350);
  const [combo, setCombo] = useState(2);
  const [level, setLevel] = useState(1);
  const [gameTime, setGameTime] = useState(0);

  // Boosters state
  const [rippleCount, setRippleCount] = useState(2);
  const [elixirCount, setElixirCount] = useState(2);

  // Modals state
  const [showTasksModal, setShowTasksModal] = useState(false);
  const [showRewardModal, setShowRewardModal] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef(null);

  const handleTally = useCallback(() => {
    setScore(s => s + 50);
    setCombo(c => c + 1);
  }, []);

  const handleStartSession = useCallback((durationInSec) => {
    if (typeof durationInSec === 'number' && durationInSec > 0) {
      setSessionSeconds(durationInSec);
    }
    setGameState('playing');
  }, []);

  const handleFinishGame = useCallback(() => {
    Vibration.vibrate([0, 100, 50, 100]);
    setShowRewardModal(true);
  }, []);

  const togglePause = () => {
    setGameState(prev => (prev === 'playing' ? 'paused' : 'playing'));
  };

  useEffect(() => {
    if (gameState === 'playing') {
      timerRef.current = setInterval(() => {
        setGameTime(prev => {
          const next = prev + 1;
          if (next % 15 === 0) {
            setScore(s => s + 50);
          }
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
  }, [gameState, sessionSeconds, handleFinishGame]);

  const handleUseRipple = () => {
    if (rippleCount > 0) {
      setRippleCount(c => c - 1);
      setScore(s => s + 100);
      Vibration.vibrate(40);
    }
  };

  const handleUseElixir = () => {
    if (elixirCount > 0) {
      setElixirCount(c => c - 1);
      setScore(s => s + 150);
      setCombo(c => c + 1);
      Vibration.vibrate(50);
    }
  };

  const renderGameCanvas = () => {
    switch (techKey) {
      case 'flower_meadow':
        return <FlowerMeadowGame initialScreen="session" initialDurationMin={tech.suggestedMin} onStartSession={handleStartSession} onTally={handleTally} onFinish={handleFinishGame} />;

      case 'water_lily_pond':
        return <LilyPondGame initialScreen="session" initialDurationMin={tech.suggestedMin} onStartSession={handleStartSession} onTally={handleTally} onFinish={handleFinishGame} />;

      case 'box_meditation':
      case 'diaphragmatic_pace':
      case 'body_scan_mindful':
        return <MeditationGame mode={techKey} initialMode={techKey} initialDurationMin={tech.suggestedMin} onStartSession={handleStartSession} onTally={handleTally} onFinish={handleFinishGame} />;

      case 'pattern_alignment':
      case 'autogenic_warmth':
      case 'stroop_decoupler':
        return <CognitiveDeStressGame mode={techKey} subOptionId={techKey} initialScreen="session" initialDurationMin={tech.suggestedMin} onTally={handleTally} onFinish={handleFinishGame} onStartSession={handleStartSession} />;

      case 'pmr_crystal_squeeze':
        return <PMRMuscleReleaseGame onTally={handleTally} onFinish={handleFinishGame} />;

      case 'emdr_saccadic_trace':
        return <EMDRSaccadicTraceGame onTally={handleTally} onFinish={handleFinishGame} />;

      case 'galvanic_biofeedback_flow':
        return <BioGSRLiquidPoolGame onTally={handleTally} onFinish={handleFinishGame} />;

      default:
        return <FlowerMeadowGame initialScreen="session" initialDurationMin={tech.suggestedMin} onStartSession={handleStartSession} onTally={handleTally} onFinish={handleFinishGame} />;
    }
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      {/* Header Controls Bar */}
      <Animated.View style={[
        styles.topBar,
        { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: fadeAnim }
      ]}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setCurrentScreen('Methods')}
          >
            <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
          </TouchableOpacity>

          <View style={styles.gameTitle}>
            <Text style={styles.gameIcon}>{tech.icon}</Text>
            <Text style={[styles.gameTitleText, { color: theme.textPrimary }]} numberOfLines={1}>{tech.title}</Text>
          </View>

          <View style={styles.headerRightBtns}>
            {/* Quest Modal Trigger Button */}
            <TouchableOpacity style={styles.headerQuestBtn} onPress={() => setShowTasksModal(true)}>
              <Text style={styles.headerQuestEmoji}>📜 Quests</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pauseButton} onPress={togglePause}>
              <Ionicons
                name={gameState === 'playing' ? 'pause' : 'play'}
                size={22}
                color={theme.textPrimary}
              />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.gameDescription, { color: tech.color }]} numberOfLines={1}>{tech.meaningTitle}</Text>
      </Animated.View>

      {/* Gamified HUD & Stats Bar */}
      <Animated.View style={[
        styles.statsBar,
        { backgroundColor: theme.bgSecondary, borderColor: tech.color }
      ]}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>⭐ ZEN XP</Text>
          <Text style={[styles.statValue, { color: '#F59E0B' }]}>{score}</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <Text style={styles.statLabel}>🔥 CALM STREAK</Text>
          <Text style={[styles.statValue, { color: '#EC4899' }]}>x{combo}</Text>
        </View>



        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <Text style={styles.statLabel}>⏱️ TIME</Text>
          <Text style={[styles.statValue, { color: theme.textPrimary }]}>
            {Math.floor(gameTime / 60)}:{String(gameTime % 60).padStart(2, '0')}
          </Text>
        </View>
      </Animated.View>

      {/* Game Canvas Container */}
      <View style={styles.canvasContainer}>
        {gameState === 'playing' ? (
          renderGameCanvas()
        ) : (
          <View style={[styles.pausedOverlay, { backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.92)' }]}>
            <View style={[styles.pausedContent, { backgroundColor: theme.bgSecondary, borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={styles.pausedIcon}>⏸️</Text>
              <Text style={[styles.pausedText, { color: theme.textPrimary }]}>Session Paused</Text>
              <TouchableOpacity style={[styles.resumeButton, { backgroundColor: tech.color }]} onPress={togglePause}>
                <Text style={styles.resumeButtonText}>Resume ▶</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* In-Game Booster Action Bar with Unique Color-Mixed Gradients */}
      <View style={styles.boosterBarContainer}>
        <TouchableOpacity
          onPress={handleUseRipple}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#8B5CF6', '#C084FC']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.boosterBtnGradient}
          >
            <Text style={styles.boosterIcon}>🪷</Text>
            <Text style={styles.boosterTxt}>Zen Ripple ({rippleCount})</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleUseElixir}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#D97706', '#F59E0B', '#FDE68A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.boosterBtnGradient}
          >
            <Text style={styles.boosterIcon}>🧪</Text>
            <Text style={styles.boosterTxt}>Elixir ({elixirCount})</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.completeSessionBtnWrapper}
          onPress={handleFinishGame}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={tech.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.completeSessionBtnGradient}
          >
            <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" style={{ marginRight: 4 }} />
            <Text style={styles.completeSessionBtnTxt}>Complete Level ▶</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Task & Reward Modals */}
      <DailyTasksModal
        visible={showTasksModal}
        onClose={() => setShowTasksModal(false)}
        onOpenChest={() => {
          setShowTasksModal(false);
          setShowRewardModal(true);
        }}
        onStartTask={(task) => {
          if (task?.gameId) {
            const subOpt = { id: task.gameId, title: task.title, description: task.title };
            setSelectedSubOption(subOpt);
            setCurrentRecommendation({
              technique_id: task.gameId,
              title: task.title,
              description: task.title,
              selected_sub_option: subOpt,
            });
            setCurrentScreen('GamePlayer');
          }
        }}
      />

      <RewardChestModal
        visible={showRewardModal}
        onClose={() => {
          setShowRewardModal(false);
          setCurrentScreen('Rating');
        }}
        level={level}
        techniqueId={techKey}
        gradient={tech.gradient}
        color={tech.color}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 2,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 1,
  },
  backButton: {
    padding: 4,
    borderRadius: 8,
  },
  gameTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gameIcon: {
    fontSize: 18,
  },
  gameTitleText: {
    fontSize: 16,
    fontWeight: '900',
  },
  headerRightBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerQuestBtn: {
    backgroundColor: '#7C3AED',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A78BFA',
  },
  headerQuestEmoji: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  pauseButton: {
    padding: 4,
    borderRadius: 8,
  },
  gameDescription: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginHorizontal: 12,
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  statValue: {
    fontSize: 12.5,
    fontWeight: '900',
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  canvasContainer: {
    flex: 1,
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 18,
    overflow: 'hidden',
  },
  pausedOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedContent: {
    paddingVertical: 20,
    paddingHorizontal: 28,
    borderRadius: 20,
    alignItems: 'center',
    gap: 12,
  },
  pausedIcon: {
    fontSize: 36,
  },
  pausedText: {
    fontSize: 16,
    fontWeight: '900',
  },
  resumeButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 4,
  },
  resumeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  boosterBarContainer: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'android' ? 76 : 66,
    marginBottom: 10,
    gap: 5,
    alignItems: 'center',
  },
  boosterBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    elevation: 3,
  },
  boosterIcon: {
    fontSize: 15,
    marginRight: 3,
  },
  boosterTxt: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '900',
  },
  completeSessionBtnWrapper: {
    flex: 1,
    borderRadius: 14,
    elevation: 4,
  },
  completeSessionBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  completeSessionBtnTxt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
});

export default GamePlayerScreen;