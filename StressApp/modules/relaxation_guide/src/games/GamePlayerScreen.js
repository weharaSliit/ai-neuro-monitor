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
import { AdaptiveRainGame } from '../games/AdaptiveRainGame';
import { ForestGame } from '../games/ForestGame';
import { OceanGame } from '../games/OceanGame';
import { FlowerMeadowGame } from '../games/FlowerMeadowGame';
import { ZenGardenGame } from '../games/ZenGardenGame';
import { LilyPondGame } from '../games/LilyPondGame';
import { PulseWaveGame } from '../games/PulseWaveGame';
import { ParticleFieldGame } from '../games/ParticleFieldGame';
import { BreathingLightGame } from '../games/BreathingLightGame';
import { ZenRunnerGame } from '../games/ZenRunnerGame';
import { LuminaBladeGame } from '../games/LuminaBladeGame';
import { OrbDefenseGame } from '../games/OrbDefenseGame';
import { PatternMatrixGame } from '../games/PatternMatrixGame';
import { CognitiveDeStressGame } from '../games/CognitiveDeStressGame';
import { MeditationGame } from '../games/MeditationGame';
import { FocusArcade } from '../games/FocusArcadeGame';

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

  const subId = selectedSubOption ? selectedSubOption.id : 'resonance_circle';

  // Game metadata
  const gameMetadata = {
    // Focus Arcade Games
    resonance_circle: {
      title: 'Resonance Circle',
      icon: '🔄',
      color: '#60A5FA',
      description: 'Visual biofeedback for heart rate variability training using paced resonance'
    },
    mindful_sweep: {
      title: 'Mindful Sweep',
      icon: '🧠',
      color: '#34D399',
      description: 'Gentle attention guidance through body awareness zones'
    },
    aurora_flow: {
      title: 'Aurora Flow',
      icon: '🌌',
      color: '#C084FC',
      description: 'Paced color transition training for parasympathetic activation'
    },
    serenity_spiral: {
      title: 'Serenity Spiral',
      icon: '🌀',
      color: '#FBBF24',
      description: 'Calming spiral meditation for attention restoration therapy'
    },
    stillness_dots: {
      title: 'Stillness Dots',
      icon: '🎯',
      color: '#F472B6',
      description: 'Visual anchoring technique for attention stabilization'
    },

    // Guided Meditation & Breathwork
    box_meditation: {
      title: 'Box Meditation',
      icon: '📦',
      color: '#38BDF8',
      description: 'Structured 4-4-4-4 visual pacing for rapid autonomic calm'
    },
    zen_body_scan: {
      title: 'Zen Body Scan',
      icon: '🧘',
      color: '#10B981',
      description: 'Mindful muscle relaxation with expanding aura visuals'
    },
    chakra_meditation: {
      title: 'Chakra Harmonizer',
      icon: '✨',
      color: '#EC4899',
      description: '432Hz & 528Hz frequency alignment for deep mental focus'
    },
    transcendental_mind: {
      title: 'Silent Zen Timer',
      icon: '🔔',
      color: '#F59E0B',
      description: 'Minimalist meditation timer with periodic singing bowl bells'
    },
    sound_meditation: {
      title: 'Acoustic Meditation',
      icon: '🎵',
      color: '#818CF8',
      description: 'Resonant soundscape meditation for effortless presence'
    },

    // Sensory & Tactile Games
    rain_scene: {
      title: 'Rain Meditation',
      icon: '🌧️',
      color: '#38BDF8',
      description: 'Soothing rain sounds with interactive ripples'
    },
    sunset_glow: {
      title: 'Sunset Glow',
      icon: '🌅',
      color: '#F59E0B',
      description: 'Warm dusk horizon color transitions for circadian calming'
    },
    mountain_breeze: {
      title: 'Mountain Breeze',
      icon: '🏔️',
      color: '#34D399',
      description: 'Crisp mountain wind flows reacting to touch orientation'
    },
    forest_scene: {
      title: 'Forest Adventure',
      icon: '🌲',
      color: '#10B981',
      description: 'Collect fireflies in an enchanted forest'
    },
    ocean_scene: {
      title: 'Ocean Waves',
      icon: '🌊',
      color: '#3B82F6',
      description: 'Ride the waves with calming ocean sounds'
    },
    flower_meadow: {
      title: 'Bloom Garden',
      icon: '🌺',
      color: '#EC4899',
      description: 'Guided 4-7-8 breath relaxation with living garden ecosystem'
    },
    zen_rock_garden: {
      title: 'Zen Garden',
      icon: '🪨',
      color: '#F59E0B',
      description: 'Rake sand patterns for mindfulness'
    },
    water_lily_pond: {
      title: 'Lily Pond',
      icon: '🪷',
      color: '#8B5CF6',
      description: 'Watch lilies bloom in peaceful water'
    },
    pulse_wave: {
      title: 'Pulse Wave',
      icon: '📳',
      color: '#F472B6',
      description: 'Synchronize with healing vibrations'
    },
    particle_field: {
      title: 'Particle Field',
      icon: '✨',
      color: '#A78BFA',
      description: 'Manipulate particles with touch'
    },
    breathing_light: {
      title: 'Breathing Light',
      icon: '💡',
      color: '#818CF8',
      description: 'Follow the light for deep relaxation'
    },

    // Cognitive De-Stress & Fidget Games
    bubble_pop: {
      title: 'Zen Bubble Pop',
      icon: '🧼',
      color: '#F43F5E',
      description: 'Tactile stress bubble popping with satisfying visual particle bursts'
    },
    pattern_align: {
      title: 'Pattern Alignment',
      icon: '🧩',
      color: '#3B82F6',
      description: 'Frosted glass pattern matching puzzle to soothe overthinking'
    },
    stress_shatter: {
      title: 'Stress Release Shatter',
      icon: '💥',
      color: '#EF4444',
      description: 'Tap-to-shatter dark glass stress objects into harmless shards'
    },
    cloud_float: {
      title: 'Cloud Floating',
      icon: '☁️',
      color: '#38BDF8',
      description: 'Interact with soft drifting clouds in an open sky sanctuary'
    },
    sand_drop: {
      title: 'Cascade Sand',
      icon: '⏳',
      color: '#F59E0B',
      description: 'Granular sand fall physics with calming hourglass flow'
    },
    cosmic_nebula: {
      title: 'Cosmic Nebula',
      icon: '🌌',
      color: '#A78BFA',
      description: 'Deep galaxy dust particles expanding to breathing pulse'
    },
    crystal_cave: {
      title: 'Crystal Cave',
      icon: '💎',
      color: '#06B6D4',
      description: 'Resonant crystal cavern with glowing harmonic audio visualizers'
    }
  };

  const meta = gameMetadata[subId] || gameMetadata.resonance_circle;

  // Pulsing animation for the game container
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.02,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  // Track game time
  useEffect(() => {
    statsInterval.current = setInterval(() => {
      setGameTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(statsInterval.current);
  }, []);

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

  const renderGameCanvas = () => {
    switch (subId) {
      // Focus Arcade
      case 'resonance_circle':
      case 'mindful_sweep':
      case 'aurora_flow':
      case 'serenity_spiral':
      case 'stillness_dots':
        return <FocusArcade mode={subId} initialMode={subId} />;

      // Guided Meditation
      case 'box_meditation':
        return <MeditationGame mode="box_meditation" initialMode="box_meditation" />;
      case 'zen_body_scan':
        return <MeditationGame mode="zen_body_scan" initialMode="zen_body_scan" />;
      case 'chakra_meditation':
        return <MeditationGame mode="chakra_meditation" initialMode="chakra_meditation" />;
      case 'transcendental_mind':
        return <MeditationGame mode="transcendental_mind" initialMode="transcendental_mind" />;
      case 'sound_meditation':
        return <MeditationGame mode="sound_meditation" initialMode="sound_meditation" />;

      // Nature Sensory & Ambient Environments
      case 'rain_scene':
      case 'sunset_glow':
      case 'mountain_breeze':
        return <AdaptiveRainGame mode={subId} />;
      case 'forest_scene':
        return <ForestGame />;
      case 'ocean_scene':
        return <OceanGame />;
      case 'flower_meadow':
        return <FlowerMeadowGame />;
      case 'zen_rock_garden':
        return <ZenGardenGame />;
      case 'water_lily_pond':
        return <LilyPondGame />;
      case 'pulse_wave':
      case 'cosmic_nebula':
      case 'crystal_cave':
        return <PulseWaveGame mode={subId} />;
      case 'particle_field':
        return <ParticleFieldGame />;
      case 'breathing_light':
        return <BreathingLightGame />;

      // Cognitive De-Stress & Fidget Arcade
      case 'bubble_pop':
      case 'pattern_align':
      case 'stress_shatter':
      case 'cloud_float':
      case 'sand_drop':
        return <CognitiveDeStressGame mode={subId} />;

      default:
        return <FocusArcade mode="resonance_circle" initialMode="resonance_circle" />;
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