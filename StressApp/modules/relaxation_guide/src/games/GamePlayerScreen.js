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

export const GamePlayerScreen = () => {
  const {
    currentRecommendation,
    selectedSubOption,
    setCurrentScreen
  } = useContext(AppContext);

  const [gameState, setGameState] = useState('playing'); // playing, paused, completed
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [achievements, setAchievements] = useState([]);
  const [showStats, setShowStats] = useState(false);
  const [gameTime, setGameTime] = useState(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const timerRef = useRef(null);
  const statsInterval = useRef(null);

  const subId = selectedSubOption ? selectedSubOption.id : 'box_meditation';

  // Game metadata with WESAD Priority ranks
  const gameMetadata = {
    water_lily_pond: {
      title: 'Lily Pond Diaphragmatic Exhale',
      icon: '🪷',
      color: '#10B981',
      description: 'WESAD Priority #1 · 100% Recovery (89s) · Diaphragmatic 4-6 Exhalation Pacing'
    },
    vagus_humming: {
      title: 'Vagal Humming Exhale',
      icon: '🧘‍♀️',
      color: '#8B5CF6',
      description: 'WESAD Priority #2 · 80% Recovery (134s) · Vagal Nerve Resonant Humming'
    },
    cosmic_nebula: {
      title: 'Cosmic Nebula (6 bpm)',
      icon: '🌌',
      color: '#A78BFA',
      description: 'WESAD Priority #3 · 80% Recovery (137s) · 0.1Hz Resonance Frequency Pacing'
    },
    flower_meadow: {
      title: 'Flower Meadow (4-7-8)',
      icon: '🌺',
      color: '#EC4899',
      description: 'WESAD Priority #4 · 80% Recovery (140s) · 4-7-8 Parasympathetic Bloom'
    },
    diaphragmatic_pace: {
      title: 'Deep Abdominal Pacing',
      icon: '🫁',
      color: '#3B82F6',
      description: 'WESAD Priority #5 · 66.7% Recovery (169s) · Deep Abdominal Pacing'
    },
    box_meditation: {
      title: 'Box Breathing (4-4-4-4)',
      icon: '📦',
      color: '#38BDF8',
      description: 'WESAD Priority #6 · 60% Recovery (184s) · Equal Square Pacing'
    },
    soft_fascination: {
      title: 'Nature Restoration Viewing',
      icon: '🌿',
      color: '#059669',
      description: 'WESAD Priority #7 · 60% Recovery (190s) · Biophilic Attention Restoration'
    },
    progressive_muscle: {
      title: 'Progressive Muscle Release',
      icon: '🦾',
      color: '#D97706',
      description: 'WESAD Priority #8 · 46.7% Recovery (217s) · Somatic Tension Release'
    },
    guided_imagery: {
      title: 'Guided Forest Walk',
      icon: '🌲',
      color: '#047857',
      description: 'WESAD Priority #9 · 26.7% Recovery (254s) · Forest Trail Imagery Walk'
    },
    pattern_alignment: {
      title: 'Visuospatial Memory Alignment',
      icon: '🧩',
      color: '#7E57C2',
      description: 'WESAD Priority #10 · 20% Recovery (268s) · Visuospatial Tile Memory'
    }
  };

  const meta = gameMetadata[subId] || gameMetadata.water_lily_pond;

  const renderGameCanvas = () => {
    switch (subId) {
      // Breathing Garden & Resonance Pacing
      case 'water_lily_pond':
        return <LilyPondGame />;
      case 'flower_meadow':
        return <FlowerMeadowGame />;
      case 'cosmic_nebula':
        return <PulseWaveGame mode="cosmic_nebula" />;

      // Guided Meditation & Vagal Breathwork
      case 'vagus_humming':
      case 'diaphragmatic_pace':
      case 'box_meditation':
      case 'chakra_harmonizer':
      case 'silent_zen_timer':
        return <MeditationGame mode={subId} initialMode={subId} />;

      // Cognitive De-Stress Arcade
      case 'soft_fascination':
      case 'progressive_muscle':
      case 'guided_imagery':
      case 'pattern_alignment':
      case 'muscle':
      case 'pattern':
      case 'nature':
      case 'bubble_pop':
      case 'pattern_align':
      case 'cloud_float':
        return <CognitiveDeStressGame mode={subId} />;

      default:
        return <LilyPondGame />;
    }
  };

  // Pulsing animation for the game container
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.02,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  // Timer interval
  useEffect(() => {
    if (gameState === 'playing') {
      timerRef.current = setInterval(() => {
        setGameTime(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }

    return () => clearInterval(timerRef.current);
  }, [gameState]);

  // Achievement system
  const checkAchievements = (newScore) => {
    const newAchievements = [];

    if (newScore >= 100 && !achievements.includes('first_100')) {
      newAchievements.push('first_100');
    }
    if (newScore >= 500 && !achievements.includes('score_500')) {
      newAchievements.push('score_500');
    }
    if (gameTime >= 60 && !achievements.includes('minute_master')) {
      newAchievements.push('minute_master');
    }
    if (level >= 5 && !achievements.includes('level_up')) {
      newAchievements.push('level_up');
    }

    if (newAchievements.length > 0) {
      setAchievements(prev => [...prev, ...newAchievements]);
      // Show achievement notification
      setShowStats(true);
      setTimeout(() => setShowStats(false), 3000);
    }
  };

  const handleFinishGame = () => {
    // Animate out
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentScreen('Rating');
    });
  };

  const togglePause = () => {
    setGameState(prev => prev === 'playing' ? 'paused' : 'playing');
  };

  const handleScoreUpdate = (newScore) => {
    setScore(newScore);
    // Check for level ups
    const newLevel = Math.floor(newScore / 100) + 1;
    if (newLevel !== level) {
      setLevel(newLevel);
      checkAchievements(newScore);
    }
  };

  const getAchievementIcon = (id) => {
    const icons = {
      first_100: '🏅',
      score_500: '🌟',
      minute_master: '⏰',
      level_up: '🎯',
    };
    return icons[id] || '✨';
  };

  const getAchievementText = (id) => {
    const texts = {
      first_100: 'First 100 Points!',
      score_500: '500 Points Achieved!',
      minute_master: '1 Minute Master!',
      level_up: 'Level Up!',
    };
    return texts[id] || 'Achievement Unlocked!';
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* Game Header */}
      <Animated.View style={[
        styles.headerContainer,
        {
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }]
        }
      ]}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setCurrentScreen('SubOptionSelector')}
          >
            <Ionicons name="arrow-back" size={24} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.gameTitle}>
            <Text style={styles.gameIcon}>{meta.icon}</Text>
            <Text style={styles.gameTitleText}>{meta.title}</Text>
          </View>

          <TouchableOpacity style={styles.pauseButton} onPress={togglePause}>
            <Ionicons
              name={gameState === 'playing' ? 'pause' : 'play'}
              size={24}
              color="#94A3B8"
            />
          </TouchableOpacity>
        </View>

        <Text style={styles.gameDescription}>{meta.description}</Text>
      </Animated.View>

      {/* Timer & Stats Bar */}
      <Animated.View style={[
        styles.statsBar,
        { opacity: fadeAnim }
      ]}>
        <View style={styles.timerWrapper}>
          <Timer initialSeconds={60} onComplete={handleFinishGame} />
        </View>

        <View style={styles.statsWrapper}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Score</Text>
            <Text style={styles.statValue}>{score}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Level</Text>
            <Text style={styles.statValue}>{level}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Time</Text>
            <Text style={styles.statValue}>{gameTime}s</Text>
          </View>
        </View>
      </Animated.View>

      {/* Game Canvas */}
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
          <View style={styles.pausedOverlay}>
            <View style={styles.pausedContent}>
              <Text style={styles.pausedIcon}>⏸️</Text>
              <Text style={styles.pausedText}>Game Paused</Text>
              <TouchableOpacity style={styles.resumeButton} onPress={togglePause}>
                <Text style={styles.resumeButtonText}>Resume</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>

      {/* Achievement Notification */}
      {showStats && achievements.length > 0 && (
        <Animated.View style={styles.achievementNotification}>
          <View style={styles.achievementContent}>
            <Text style={styles.achievementIcon}>
              {getAchievementIcon(achievements[achievements.length - 1])}
            </Text>
            <View style={styles.achievementTextContainer}>
              <Text style={styles.achievementTitle}>Achievement Unlocked!</Text>
              <Text style={styles.achievementDesc}>
                {getAchievementText(achievements[achievements.length - 1])}
              </Text>
            </View>
          </View>
        </Animated.View>
      )}

      {/* Footer */}
      <Animated.View style={[
        styles.footer,
        { opacity: fadeAnim }
      ]}>
        <View style={styles.footerContent}>
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${(score % 100)}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {score % 100}% to next level
            </Text>
          </View>

          <TouchableOpacity style={styles.finishBtn} onPress={handleFinishGame}>
            <Text style={styles.finishBtnTxt}>Complete Exercise →</Text>
            <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.footerActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setShowStats(!showStats)}>
            <Ionicons name="stats-chart" size={18} color="#94A3B8" />
            <Text style={styles.actionBtnText}>Stats</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => { }}>
            <Ionicons name="volume-high" size={18} color="#94A3B8" />
            <Text style={styles.actionBtnText}>Sound</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => { }}>
            <Ionicons name="share-social" size={18} color="#94A3B8" />
            <Text style={styles.actionBtnText}>Share</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
  },
  gameTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gameIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  gameTitleText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  gameDescription: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
  },
  pauseButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
  },
  statsBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 41, 59, 0.5)',
  },
  timerWrapper: {
    flex: 1,
  },
  statsWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  statLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
  },
  canvasContainer: {
    flex: 1,
    margin: 12,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(30, 41, 59, 0.5)',
    position: 'relative',
  },
  gameWrapper: {
    flex: 1,
  },
  pausedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  pausedContent: {
    alignItems: 'center',
  },
  pausedIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  pausedText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  resumeButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  resumeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  achievementNotification: {
    position: 'absolute',
    top: 120,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.95)',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#10B981',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    zIndex: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  achievementContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  achievementIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  achievementTextContainer: {
    flex: 1,
  },
  achievementTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  achievementDesc: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    marginTop: 2,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(30, 41, 59, 0.5)',
  },
  footerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressContainer: {
    flex: 1,
    marginRight: 12,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 2,
  },
  progressText: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 4,
  },
  finishBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 140,
  },
  finishBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    marginRight: 8,
  },
  footerActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(30, 41, 59, 0.3)',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    marginLeft: 6,
  },
});

export default GamePlayerScreen;