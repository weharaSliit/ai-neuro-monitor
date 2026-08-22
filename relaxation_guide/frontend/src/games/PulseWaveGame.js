import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  Easing
} from 'react-native';

const { width, height } = Dimensions.get('window');

export const PulseWaveGame = () => {
  const [pulsePhase, setPulsePhase] = useState('inhale');
  const [heartRate, setHeartRate] = useState(72);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [cycles, setCycles] = useState(0);
  const [perfectPulses, setPerfectPulses] = useState(0);
  const [gameState, setGameState] = useState('playing');
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [waveRings, setWaveRings] = useState([]);
  const [energyOrbs, setEnergyOrbs] = useState([]);
  const [rhythmAccuracy, setRhythmAccuracy] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const beatAnim = useRef(new Animated.Value(1)).current;

  const pulseTimer = useRef(null);
  const gameLoop = useRef(null);
  const lastTapTime = useRef(Date.now());
  const rhythmHistory = useRef([]);

  // Create initial energy orbs
  useEffect(() => {
    const orbs = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const radius = 120 + Math.random() * 30;
      orbs.push({
        id: i,
        angle,
        radius,
        size: 6 + Math.random() * 10,
        color: `hsl(${260 + Math.random() * 40}, 80%, ${60 + Math.random() * 30}%)`,
        speed: 0.5 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
      });
    }
    setEnergyOrbs(orbs);
  }, []);

  // Create wave ring
  const createWaveRing = (x, y) => {
    setWaveRings(prev => [...prev, {
      id: Date.now() + Math.random(),
      x,
      y,
      radius: 20,
      maxRadius: 150 + Math.random() * 50,
      opacity: 1,
      color: `hsl(${260 + Math.random() * 40}, 80%, ${60 + Math.random() * 30}%)`,
      speed: 2 + Math.random() * 1,
    }]);
  };

  // Create particles
  const createParticles = (x, y, color, count = 30) => {
    const newParticles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 2 + Math.random() * 6;
      newParticles.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 2,
        life: 1,
        size: 2 + Math.random() * 6,
        color: color || `hsl(${280 + Math.random() * 40}, 80%, 70%)`,
        gravity: 0.05 + Math.random() * 0.05,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Create floating text
  const createFloatingText = (x, y, text, color = '#B388FF') => {
    setFloatingTexts(prev => [...prev, {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${Math.random()}`,
      x,
      y,
      text,
      color,
      opacity: 1,
      vy: -2 - Math.random() * 1.5,
      scale: 1,
    }]);
  };

  // Handle tap - simulate heartbeat
  const handleTap = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;
    const now = Date.now();
    const timeDiff = now - lastTapTime.current;
    lastTapTime.current = now;

    // Create visual effects
    createWaveRing(locationX, locationY);
    createParticles(locationX, locationY, '#B388FF', 25);

    // Calculate rhythm accuracy
    const expectedInterval = 1000 / (heartRate / 60);
    const accuracy = Math.max(0, 100 - Math.abs(timeDiff - expectedInterval) / expectedInterval * 100);
    setRhythmAccuracy(prev => prev * 0.7 + accuracy * 0.3);

    rhythmHistory.current.push(accuracy);
    if (rhythmHistory.current.length > 10) {
      rhythmHistory.current.shift();
    }

    // Score based on timing
    if (accuracy > 80) {
      const comboBonus = Math.floor(combo / 3) + 1;
      const points = Math.floor(accuracy / 10) * comboBonus;
      setScore(prev => prev + points);
      setCombo(prev => prev + 1);
      setPerfectPulses(prev => prev + 1);

      if (combo + 1 > maxCombo) {
        setMaxCombo(combo + 1);
      }

      // Floating text
      let text = `💓 +${points}`;
      if (combo > 0) {
        text += ` x${comboBonus}`;
      }
      if (accuracy > 95) {
        text += ' PERFECT!';
      }
      createFloatingText(locationX - 30, locationY - 30, text, accuracy > 95 ? '#FCD34D' : '#B388FF');

      // Combo milestones
      if (combo > 0 && combo % 5 === 0) {
        createFloatingText(
          locationX - 50,
          locationY - 70,
          `⚡ ${combo + 1}x RHYTHM!`,
          '#F59E0B'
        );
        // Bonus particles
        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            createParticles(
              locationX + (Math.random() - 0.5) * 100,
              locationY + (Math.random() - 0.5) * 100,
              '#F59E0B',
              15
            );
          }, i * 100);
        }
      }

      // Screen shake on high combo
      if (combo > 5) {
        Animated.sequence([
          Animated.timing(shakeAnim, {
            toValue: 3,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnim, {
            toValue: -3,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnim, {
            toValue: 0,
            duration: 50,
            useNativeDriver: true,
          }),
        ]).start();
      }

      // Beat animation
      Animated.sequence([
        Animated.timing(beatAnim, {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(beatAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

    } else {
      // Missed beat
      createFloatingText(locationX - 20, locationY - 20, '⏳ Miss', '#EF4444');
      setCombo(0);
    }

    // Update heart rate
    setHeartRate(prev => {
      const newRate = prev + (Math.random() - 0.5) * 2;
      return Math.max(60, Math.min(100, newRate));
    });

    // Check for cycle completion
    if (combo > 0 && combo % 10 === 0) {
      setCycles(prev => prev + 1);
      createFloatingText(width / 2 - 60, height / 2 - 100, '🔄 Cycle Complete!', '#34D399');
    }
  };

  // Pulse wave animation
  useEffect(() => {
    pulseTimer.current = setInterval(() => {
      setPulsePhase(prev => {
        if (prev === 'inhale') {
          Animated.parallel([
            Animated.timing(pulseAnim, {
              toValue: 1.6,
              duration: 2500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(glowAnim, {
              toValue: 1,
              duration: 2500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]).start();
          return 'hold';
        } else if (prev === 'hold') {
          Animated.timing(glowAnim, {
            toValue: 1.2,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }).start();
          return 'exhale';
        } else {
          Animated.parallel([
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 3000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(glowAnim, {
              toValue: 0.3,
              duration: 3000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]).start();
          return 'inhale';
        }
      });
    }, 3000);

    return () => clearInterval(pulseTimer.current);
  }, []);

  // Game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update energy orbs
      setEnergyOrbs(prev => prev.map(orb => ({
        ...orb,
        angle: orb.angle + orb.speed * 0.01,
        radius: orb.radius + Math.sin(Date.now() * 0.001 + orb.phase) * 5,
        size: orb.size * (0.995 + Math.sin(Date.now() * 0.002 + orb.phase) * 0.005),
      })));

      // Update wave rings
      setWaveRings(prev => prev.map(ring => ({
        ...ring,
        radius: ring.radius + ring.speed,
        opacity: ring.opacity - 0.02,
      })).filter(ring => ring.opacity > 0 && ring.radius < ring.maxRadius));

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

      // Update rotation
      rotateAnim.setValue((rotateAnim._value + 0.2) % 360);

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, []);

  // Get phase info
  const getPhaseInfo = () => {
    switch (pulsePhase) {
      case 'inhale': return {
        icon: '🌬️',
        text: 'Inhale',
        sub: 'Expand with the wave',
        color: '#818CF8',
      };
      case 'hold': return {
        icon: '🕊️',
        text: 'Hold',
        sub: 'Feel the resonance',
        color: '#A78BFA',
      };
      case 'exhale': return {
        icon: '💓',
        text: 'Exhale',
        sub: 'Release and flow',
        color: '#F472B6',
      };
      default: return {
        icon: '✨',
        text: 'Ready',
        sub: 'Follow the rhythm',
        color: '#B388FF',
      };
    }
  };

  const phaseInfo = getPhaseInfo();

  // Get heart rate status
  const getHeartRateStatus = () => {
    if (heartRate < 65) return '😌 Calm';
    if (heartRate < 75) return '🧘 Focused';
    if (heartRate < 85) return '💪 Active';
    return '⚡ Energized';
  };

  // Calculate average accuracy
  const avgAccuracy = rhythmHistory.current.length > 0
    ? rhythmHistory.current.reduce((a, b) => a + b, 0) / rhythmHistory.current.length
    : 0;

  return (
    <TouchableWithoutFeedback onPress={handleTap}>
      <Animated.View style={[
        styles.container,
        { transform: [{ translateX: shakeAnim }] }
      ]}>
        {/* Background gradient */}
        <View style={styles.bgGradient} />

        {/* Energy Orbs */}
        {energyOrbs.map(orb => {
          const x = width / 2 + Math.cos(orb.angle) * orb.radius;
          const y = height / 2 + Math.sin(orb.angle) * orb.radius;
          return (
            <Animated.View
              key={orb.id}
              style={[
                styles.energyOrb,
                {
                  left: x - orb.size / 2,
                  top: y - orb.size / 2,
                  width: orb.size,
                  height: orb.size,
                  borderRadius: orb.size / 2,
                  backgroundColor: orb.color,
                  opacity: 0.3 + Math.sin(Date.now() * 0.002 + orb.phase) * 0.2,
                }
              ]}
            />
          );
        })}

        {/* Wave Rings */}
        {waveRings.map(ring => (
          <Animated.View
            key={ring.id}
            style={[
              styles.waveRing,
              {
                left: ring.x - ring.radius,
                top: ring.y - ring.radius,
                width: ring.radius * 2,
                height: ring.radius * 2,
                borderRadius: ring.radius,
                borderColor: ring.color,
                opacity: ring.opacity * 0.5,
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

        {/* Main Pulse Wave */}
        <Animated.View style={[
          styles.pulseContainer,
          {
            transform: [
              { scale: pulseAnim },
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
            styles.pulseWave,
            {
              opacity: glowAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 1],
              }),
              shadowOpacity: glowAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 0.9],
              }),
            }
          ]}>
            <Animated.View style={[
              styles.pulseCore,
              {
                transform: [{ scale: beatAnim }],
              }
            ]}>
              <View style={styles.pulseInner}>
                <Text style={styles.heartIcon}>💓</Text>
                <Text style={styles.bpmText}>{Math.round(heartRate)} BPM</Text>
              </View>
            </Animated.View>

            {/* Pulse rings */}
            <View style={styles.pulseRing} />
            <View style={[styles.pulseRing, { width: 160, height: 160, borderRadius: 80 }]} />
            <View style={[styles.pulseRing, { width: 200, height: 200, borderRadius: 100 }]} />
          </Animated.View>
        </Animated.View>

        {/* Phase Indicator */}
        <View style={[styles.phaseContainer, { borderColor: phaseInfo.color }]}>
          <Text style={[styles.phaseIcon, { color: phaseInfo.color }]}>
            {phaseInfo.icon}
          </Text>
          <Text style={[styles.phaseText, { color: phaseInfo.color }]}>
            {phaseInfo.text}
          </Text>
          <Text style={styles.phaseSubtext}>{phaseInfo.sub}</Text>
        </View>

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>💓 HRV</Text>
            <Text style={styles.hudValue}>{getHeartRateStatus()}</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>⭐ SCORE</Text>
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
            <Text style={styles.hudLabel}>🎯 ACCURACY</Text>
            <Text style={styles.hudValue}>{Math.round(avgAccuracy)}%</Text>
          </View>
        </View>

        {/* Rhythm accuracy meter */}
        <View style={styles.accuracyContainer}>
          <View style={styles.accuracyBar}>
            <View style={[styles.accuracyFill, {
              width: `${Math.min(100, avgAccuracy)}%`,
              backgroundColor: avgAccuracy > 80 ? '#34D399' : avgAccuracy > 60 ? '#F59E0B' : '#EF4444',
            }]} />
          </View>
          <Text style={styles.accuracyLabel}>Rhythm Synchronization</Text>
        </View>

        {/* Status */}
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {cycles > 0 ? `🔄 ${cycles} cycles complete` : '🌱 Starting rhythm...'}
            {perfectPulses > 0 && ` • 💓 ${perfectPulses} perfect beats`}
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlText}>
              👆 Tap in rhythm with your heartbeat
            </Text>
            <Text style={styles.controlSubtext}>
              Follow the pulse wave for perfect synchronization
            </Text>
          </View>
        </View>

        {/* Glow overlay */}
        <Animated.View style={[
          styles.glowOverlay,
          {
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.1],
            })
          }
        ]} />
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1040',
    overflow: 'hidden',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at center, #2D1B69 0%, #1A1040 100%)',
  },
  energyOrb: {
    position: 'absolute',
  },
  waveRing: {
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
  pulseContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseWave: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(179, 136, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#B388FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 50,
    elevation: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pulseCore: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(179, 136, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#B388FF',
  },
  pulseInner: {
    alignItems: 'center',
  },
  heartIcon: {
    fontSize: 32,
  },
  bpmText: {
    color: '#D1C4E9',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 2,
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(179, 136, 255, 0.2)',
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  phaseContainer: {
    position: 'absolute',
    bottom: 120,
    backgroundColor: 'rgba(26, 16, 64, 0.8)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    minWidth: 180,
  },
  phaseIcon: {
    fontSize: 28,
  },
  phaseText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 2,
  },
  phaseSubtext: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  hud: {
    position: 'absolute',
    top: 30,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  hudItem: {
    backgroundColor: 'rgba(26, 16, 64, 0.8)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    minWidth: 60,
  },
  hudLabel: {
    color: '#94A3B8',
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
  accuracyContainer: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(26, 16, 64, 0.6)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  accuracyBar: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  accuracyFill: {
    height: '100%',
    borderRadius: 2,
  },
  accuracyLabel: {
    color: '#94A3B8',
    fontSize: 10,
  },
  statusContainer: {
    position: 'absolute',
    top: 130,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  statusText: {
    color: '#D1C4E9',
    fontSize: 11,
    fontWeight: '500',
  },
  controls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  controlGroup: {
    backgroundColor: 'rgba(26, 16, 64, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  controlText: {
    color: '#D1C4E9',
    fontSize: 12,
    fontWeight: '500',
  },
  controlSubtext: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
  glowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#B388FF',
    pointerEvents: 'none',
  },
});

export default PulseWaveGame;