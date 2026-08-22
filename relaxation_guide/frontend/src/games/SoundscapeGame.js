import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Easing,
  ScrollView
} from 'react-native';
import { soundEngine } from '../utils/SoundEngine';

const { width, height } = Dimensions.get('window');

export const SoundscapeGame = () => {
  const [activeFrequency, setActiveFrequency] = useState('432 Hz');
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);
  const [gameState, setGameState] = useState('playing');
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [soundWaves, setSoundWaves] = useState([]);
  const [vibrationStrength, setVibrationStrength] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const soundTimer = useRef(null);
  const gameLoop = useRef(null);
  const audioContext = useRef(null);

  // Sound frequencies with their properties
  const SOUND_TYPES = [
    {
      id: '432',
      label: '432 Hz',
      frequency: 432,
      color: '#818CF8',
      glow: '#A5B4FC',
      emoji: '🎵',
      description: 'Healing Resonance',
      points: 10,
      waveSpeed: 1
    },
    {
      id: '528',
      label: '528 Hz',
      frequency: 528,
      color: '#34D399',
      glow: '#6EE7B7',
      emoji: '🎶',
      description: 'DNA Repair',
      points: 15,
      waveSpeed: 1.2
    },
    {
      id: 'alpha',
      label: 'Alpha 10Hz',
      frequency: 10,
      color: '#F472B6',
      glow: '#F9A8D4',
      emoji: '🧘',
      description: 'Deep Relaxation',
      points: 20,
      waveSpeed: 0.8
    },
    {
      id: 'theta',
      label: 'Theta 5Hz',
      frequency: 5,
      color: '#A78BFA',
      glow: '#C4B5FD',
      emoji: '🌌',
      description: 'Meditative State',
      points: 25,
      waveSpeed: 0.6
    },
    {
      id: 'delta',
      label: 'Delta 2Hz',
      frequency: 2,
      color: '#F59E0B',
      glow: '#FCD34D',
      emoji: '💫',
      description: 'Deep Sleep',
      points: 30,
      waveSpeed: 0.4
    },
    {
      id: 'forest',
      label: 'Deep Forest',
      frequency: 0,
      color: '#10B981',
      glow: '#34D399',
      emoji: '🌿',
      description: 'Nature Sounds',
      points: 35,
      waveSpeed: 1.5
    },
  ];

  const currentSound = SOUND_TYPES.find(s => s.label === activeFrequency) || SOUND_TYPES[0];

  // Create sound wave effect with interactive touch sound chime
  const createSoundWave = (x, y) => {
    soundEngine.playTouchChime(x / width);
    setSoundWaves(prev => [...prev, {
      id: Date.now() + Math.random(),
      x,
      y,
      radius: 20,
      maxRadius: 100 + Math.random() * 50,
      opacity: 1,
      color: currentSound.color,
      speed: 1 + Math.random() * 2,
    }]);
  };

  // Create particles
  const createParticles = (x, y, color, count = 30) => {
    const newParticles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 1 + Math.random() * 4;
      newParticles.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 2,
        life: 1,
        size: 2 + Math.random() * 6,
        color: color || currentSound.color,
        gravity: 0.05,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Create floating text
  const createFloatingText = (x, y, text, color = currentSound.color) => {
    setFloatingTexts(prev => [...prev, {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${Math.random()}`,
      x,
      y,
      text,
      color,
      opacity: 1,
      vy: -2 - Math.random() * 1,
      scale: 1,
    }]);
  };

  // Handle sound selection
  const selectSound = (sound) => {
    setActiveFrequency(sound.label);
    setIsPlaying(true);

    // Visual feedback
    createSoundWave(width / 2, height / 2);
    createParticles(width / 2, height / 2, sound.color, 40);
    createFloatingText(
      width / 2 - 50,
      height / 2 - 50,
      `${sound.emoji} ${sound.label}`,
      sound.color
    );

    // Score bonus for selection
    const bonus = sound.points * 2;
    setScore(prev => prev + bonus);
    setCombo(prev => prev + 1);
    setTotalSessions(prev => prev + 1);

    if (combo + 1 > maxCombo) {
      setMaxCombo(combo + 1);
    }

    // Vibration feedback
    setVibrationStrength(1);
    setTimeout(() => setVibrationStrength(0), 500);

    // Glow animation
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0.3,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();

    // Scale animation
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1.2,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Combo milestone
    if (combo > 0 && combo % 5 === 0) {
      createFloatingText(
        width / 2 - 60,
        height / 2 - 100,
        `🎵 ${combo + 1}x HARMONY!`,
        '#FCD34D'
      );
      // Bonus particles
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          createParticles(
            width / 2 + (Math.random() - 0.5) * 200,
            height / 2 + (Math.random() - 0.5) * 200,
            '#FCD34D',
            20
          );
        }, i * 100);
      }
    }
  };

  // Sound wave animation
  useEffect(() => {
    soundTimer.current = setInterval(() => {
      setSoundWaves(prev => prev.map(wave => ({
        ...wave,
        radius: wave.radius + wave.speed * currentSound.waveSpeed,
        opacity: wave.opacity - 0.02,
      })).filter(wave => wave.opacity > 0 && wave.radius < wave.maxRadius));
    }, 50);

    return () => clearInterval(soundTimer.current);
  }, [currentSound]);

  // Game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update particles
      setParticles(prev => {
        const updated = prev.map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          vy: p.vy + p.gravity,
          life: p.life - 0.015,
          size: p.size * 0.995,
        }));
        return updated.filter(p => p.life > 0);
      });

      // Update floating texts
      setFloatingTexts(prev => {
        const updated = prev.map(t => ({
          ...t,
          y: t.y + t.vy,
          opacity: t.opacity - 0.015,
          scale: t.scale + 0.01,
        }));
        return updated.filter(t => t.opacity > 0);
      });

      // Update wave animation
      waveAnim.setValue(Math.sin(Date.now() * 0.001) * 10);

      // Pulse animation
      pulseAnim.setValue(0.95 + Math.sin(Date.now() * 0.002) * 0.05);

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, []);

  // Play sound through smartphone speaker when active
  useEffect(() => {
    if (isPlaying) {
      const trackMap = {
        '432': 'chakra_breath',
        '528': 'singing_bowl',
        'alpha': 'piano_rain',
        'theta': 'zen_flute',
        'delta': 'ocean_harp',
      };
      const track = trackMap[currentSound.id] || 'piano_rain';
      soundEngine.playSoundTrack(track, 'inhale', 4);

      const autoWave = setInterval(() => {
        createSoundWave(
          width / 2 + (Math.random() - 0.5) * 100,
          height / 2 + (Math.random() - 0.5) * 100
        );
      }, 3000);

      return () => {
        clearInterval(autoWave);
        soundEngine.stopSound();
      };
    } else {
      soundEngine.stopSound();
    }
  }, [isPlaying, activeFrequency]);

  return (
    <View style={styles.container}>
      {/* Background gradient with animated waves */}
      <Animated.View style={[
        styles.bgGradient,
        {
          transform: [
            { translateY: waveAnim },
          ]
        }
      ]}>
        <View style={[styles.gradientLayer, { backgroundColor: '#1E1B4B' }]} />
        <View style={[styles.gradientLayer, {
          backgroundColor: currentSound.color + '20',
          opacity: 0.3 + glowAnim._value * 0.3,
        }]} />
      </Animated.View>

      {/* Sound Waves */}
      {soundWaves.map(wave => (
        <Animated.View
          key={wave.id}
          style={[
            styles.soundWave,
            {
              left: wave.x - wave.radius,
              top: wave.y - wave.radius,
              width: wave.radius * 2,
              height: wave.radius * 2,
              borderRadius: wave.radius,
              borderColor: wave.color,
              opacity: wave.opacity * 0.5,
            }
          ]}
        />
      ))}

      {/* Particles */}
      {particles.map(p => (
        <Animated.View
          key={p.id}
          style={[
            styles.particle,
            {
              left: p.x - p.size / 2,
              top: p.y - p.size / 2,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              opacity: p.life,
              borderRadius: p.size / 2,
              shadowColor: p.color,
              shadowOpacity: 0.3,
              shadowRadius: p.size,
            }
          ]}
        />
      ))}

      {/* Floating Texts */}
      {floatingTexts.map(t => (
        <Animated.Text
          key={t.id}
          style={[
            styles.floatingText,
            {
              left: t.x,
              top: t.y,
              opacity: t.opacity,
              color: t.color,
              transform: [{ scale: t.scale }],
            }
          ]}
        >
          {t.text}
        </Animated.Text>
      ))}

      {/* Main Sound Ring */}
      <Animated.View style={[
        styles.mainRingContainer,
        {
          transform: [
            { scale: scaleAnim },
            {
              rotate: rotateAnim.interpolate({
                inputRange: [0, 360],
                outputRange: ['0deg', '360deg'],
              })
            },
          ],
        }
      ]}>
        <Animated.View style={[
          styles.soundRing,
          {
            width: 180,
            height: 180,
            borderRadius: 90,
            borderColor: currentSound.color,
            backgroundColor: currentSound.color + '20',
            opacity: 0.7 + glowAnim._value * 0.3,
            shadowColor: currentSound.glow,
            shadowOpacity: 0.3 + glowAnim._value * 0.6,
            shadowRadius: 40 + glowAnim._value * 40,
          }
        ]}>
          <Animated.View style={[
            styles.ringInner,
            {
              transform: [{ scale: pulseAnim }],
            }
          ]}>
            <Text style={styles.ringEmoji}>{currentSound.emoji}</Text>
            <Text style={[styles.ringFrequency, { color: currentSound.color }]}>
              {currentSound.label}
            </Text>
            <Text style={styles.ringDescription}>
              {currentSound.description}
            </Text>
          </Animated.View>

          {/* Decorative rings */}
          <View style={[styles.decoRing, {
            width: 200, height: 200, borderRadius: 100,
            borderColor: currentSound.color + '30',
          }]} />
          <View style={[styles.decoRing, {
            width: 220, height: 220, borderRadius: 110,
            borderColor: currentSound.color + '20',
          }]} />
        </Animated.View>
      </Animated.View>

      {/* Sound Selection */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.soundSelector}
        contentContainerStyle={styles.soundSelectorContent}
      >
        {SOUND_TYPES.map((sound) => (
          <TouchableOpacity
            key={sound.id}
            style={[
              styles.soundBtn,
              activeFrequency === sound.label && styles.soundBtnActive,
              { borderColor: activeFrequency === sound.label ? sound.color : 'rgba(255,255,255,0.1)' }
            ]}
            onPress={() => selectSound(sound)}
          >
            <Text style={styles.soundEmoji}>{sound.emoji}</Text>
            <Text style={[
              styles.soundLabel,
              activeFrequency === sound.label && { color: sound.color }
            ]}>
              {sound.label}
            </Text>
            <Text style={styles.soundDesc}>{sound.description}</Text>
            <View style={[styles.soundIndicator, {
              backgroundColor: activeFrequency === sound.label ? sound.color : 'rgba(255,255,255,0.1)',
            }]} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* HUD */}
      <View style={styles.hud}>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>🎵 SCORE</Text>
          <Text style={styles.hudValue}>{score}</Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>⚡ COMBO</Text>
          <Text style={[
            styles.hudValue,
            combo > 5 && styles.comboHigh,
            combo > 10 && styles.comboSuper,
          ]}>
            {combo}x
          </Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>🏆 MAX</Text>
          <Text style={styles.hudValue}>{maxCombo}</Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>🎯 SESSIONS</Text>
          <Text style={styles.hudValue}>{totalSessions}</Text>
        </View>
      </View>

      {/* Active Sound Status */}
      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>
          {isPlaying ? `🎵 ${activeFrequency} • ${currentSound.description}` : '🎵 Select a frequency to begin'}
        </Text>
        <View style={styles.statusIndicator}>
          <View style={[styles.statusDot, {
            backgroundColor: isPlaying ? currentSound.color : '#64748B',
            opacity: isPlaying ? 0.7 + Math.sin(Date.now() * 0.003) * 0.3 : 0.3,
          }]} />
          <Text style={styles.statusLabel}>{isPlaying ? 'Playing' : 'Paused'}</Text>
        </View>
      </View>

      {/* Vibration indicator */}
      {vibrationStrength > 0 && (
        <View style={styles.vibrationIndicator}>
          <View style={[styles.vibrationBar, {
            width: vibrationStrength * 100,
            backgroundColor: currentSound.color,
          }]} />
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: currentSound.color }]}
          onPress={() => {
            setIsPlaying(!isPlaying);
            if (!isPlaying) {
              createFloatingText(width / 2 - 30, height / 2 - 30, '▶️ Playing', '#34D399');
            } else {
              createFloatingText(width / 2 - 30, height / 2 - 30, '⏸️ Paused', '#F472B6');
            }
          }}
        >
          <Text style={styles.controlText}>
            {isPlaying ? '⏸️ Pause' : '▶️ Play'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1B4B',
    overflow: 'hidden',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gradientLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  soundWave: {
    position: 'absolute',
    borderWidth: 2,
  },
  particle: {
    position: 'absolute',
  },
  floatingText: {
    position: 'absolute',
    fontSize: 20,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  mainRingContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -90,
    marginLeft: -90,
  },
  soundRing: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  ringInner: {
    alignItems: 'center',
  },
  ringEmoji: {
    fontSize: 40,
  },
  ringFrequency: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 4,
  },
  ringDescription: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  decoRing: {
    position: 'absolute',
    borderWidth: 1,
  },
  soundSelector: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    maxHeight: 80,
  },
  soundSelectorContent: {
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  soundBtn: {
    backgroundColor: 'rgba(30, 27, 75, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 2,
    marginRight: 10,
    alignItems: 'center',
    minWidth: 80,
    backdropFilter: 'blur(10px)',
  },
  soundBtnActive: {
    backgroundColor: 'rgba(30, 27, 75, 0.95)',
    shadowColor: '#818CF8',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  soundEmoji: {
    fontSize: 20,
  },
  soundLabel: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  soundDesc: {
    color: '#64748B',
    fontSize: 8,
    marginTop: 1,
  },
  soundIndicator: {
    width: 20,
    height: 2,
    borderRadius: 1,
    marginTop: 4,
  },
  hud: {
    position: 'absolute',
    top: 180,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  hudItem: {
    backgroundColor: 'rgba(30, 27, 75, 0.8)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    minWidth: 55,
  },
  hudLabel: {
    color: '#64748B',
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hudValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  comboHigh: {
    color: '#F59E0B',
  },
  comboSuper: {
    color: '#FCD34D',
    textShadowColor: '#FCD34D',
    textShadowRadius: 10,
  },
  statusContainer: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(30, 27, 75, 0.8)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  statusText: {
    color: '#C7D2FE',
    fontSize: 13,
    fontWeight: '500',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusLabel: {
    color: '#94A3B8',
    fontSize: 10,
  },
  vibrationIndicator: {
    position: 'absolute',
    bottom: 100,
    left: 40,
    right: 40,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  vibrationBar: {
    height: '100%',
    borderRadius: 1,
  },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  controlBtn: {
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 30,
    shadowColor: '#818CF8',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  controlText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default SoundscapeGame;