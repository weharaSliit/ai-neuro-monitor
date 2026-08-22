import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
  Easing
} from 'react-native';

const { width, height } = Dimensions.get('window');

export const BreathingLightGame = () => {
  const [breathPhase, setBreathPhase] = useState('inhale'); // inhale, hold, exhale, rest
  const [cycleCount, setCycleCount] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [breathTimer, setBreathTimer] = useState(0);
  const [gameState, setGameState] = useState('ready'); // ready, breathing, holding, exhaling, complete

  // Animation values
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;
  const particleAnims = useRef([]).current;

  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [ripples, setRipples] = useState([]);

  // Breathing cycle timing (in milliseconds)
  const BREATH_TIMINGS = {
    inhale: 4000,
    hold: 2000,
    exhale: 4000,
    rest: 1000
  };

  // Create particle system
  const createParticles = (x, y, count = 30) => {
    const newParticles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 50 + Math.random() * 150;
      newParticles.push({
        id: Date.now() + Math.random(),
        x: x + Math.cos(angle) * Math.random() * 30,
        y: y + Math.sin(angle) * Math.random() * 30,
        targetX: x + Math.cos(angle) * distance,
        targetY: y + Math.sin(angle) * distance,
        size: 2 + Math.random() * 8,
        color: `hsl(${240 + Math.random() * 40}, ${80 + Math.random() * 20}%, ${60 + Math.random() * 30}%)`,
        progress: 0,
        speed: 0.005 + Math.random() * 0.015,
        rotation: Math.random() * 360,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Floating text effect
  const createFloatingText = (x, y, text, color = '#C7D2FE') => {
    setFloatingTexts(prev => [...prev, {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${Math.random()}`,
      x: x - 40,
      y,
      text,
      color,
      opacity: 1,
      scale: 1,
    }]);
  };

  // Handle touch interaction
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;

    // Create ripple effect
    setRipples(prev => [...prev, {
      id: Date.now(),
      x: locationX,
      y: locationY,
      scale: 0,
      opacity: 1,
    }]);

    // Create particles at touch point
    createParticles(locationX, locationY, 40);

    // Score bonus for tapping during inhale/exhale
    if (gameState === 'breathing' || gameState === 'holding') {
      const bonus = breathPhase === 'inhale' ? 15 : breathPhase === 'exhale' ? 20 : 10;
      const newScore = score + bonus;
      setScore(newScore);
      setStreak(prev => prev + 1);

      createFloatingText(
        locationX,
        locationY - 30,
        `+${bonus} 💨`,
        breathPhase === 'inhale' ? '#A5B4FC' : '#FDE68A'
      );

      // Combo bonuses
      if (streak > 5 && streak % 5 === 0) {
        createFloatingText(
          locationX,
          locationY - 70,
          `🔥 ${streak}x COMBO!`,
          '#F472B6'
        );
      }

      // Trigger glow pulse
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.6,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  // Breathing cycle
  useEffect(() => {
    if (gameState === 'ready') {
      // Start the game after a brief delay
      const timer = setTimeout(() => setGameState('breathing'), 1000);
      return () => clearTimeout(timer);
    }

    if (gameState === 'breathing' || gameState === 'holding' || gameState === 'exhaling') {
      let timer;

      switch (breathPhase) {
        case 'inhale':
          // Expand animation
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1.6,
              duration: BREATH_TIMINGS.inhale,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(glowAnim, {
              toValue: 1,
              duration: BREATH_TIMINGS.inhale,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(rotateAnim, {
              toValue: 1,
              duration: BREATH_TIMINGS.inhale,
              easing: Easing.linear,
              useNativeDriver: true,
            }),
          ]).start();

          timer = setTimeout(() => {
            setBreathPhase('hold');
            setGameState('holding');
            createFloatingText(width / 2 - 50, height / 2 - 100, '⏸️ HOLD', '#60A5FA');
          }, BREATH_TIMINGS.inhale);
          break;

        case 'hold':
          // Maintain glow
          Animated.timing(glowAnim, {
            toValue: 1.2,
            duration: BREATH_TIMINGS.hold,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }).start();

          timer = setTimeout(() => {
            setBreathPhase('exhale');
            setGameState('exhaling');
            createFloatingText(width / 2 - 50, height / 2 - 100, '😮‍💨 EXHALE', '#FBBF24');
          }, BREATH_TIMINGS.hold);
          break;

        case 'exhale':
          // Contract animation
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1,
              duration: BREATH_TIMINGS.exhale,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(glowAnim, {
              toValue: 0.3,
              duration: BREATH_TIMINGS.exhale,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]).start();

          // Add bonus for completing exhale
          const exhaleBonus = 25 + streak * 2;
          setScore(prev => prev + exhaleBonus);
          setCycleCount(prev => prev + 1);
          createFloatingText(
            width / 2 - 40,
            height / 2 + 80,
            `✨ +${exhaleBonus}`,
            '#34D399'
          );

          timer = setTimeout(() => {
            setBreathPhase('rest');
            setGameState('ready');
            // Reset for next cycle after rest
            setTimeout(() => {
              setBreathPhase('inhale');
              setGameState('breathing');
              createFloatingText(width / 2 - 50, height / 2 - 120, '🌬️ INHALE', '#818CF8');
            }, BREATH_TIMINGS.rest);
          }, BREATH_TIMINGS.exhale);
          break;

        default:
          break;
      }

      return () => {
        if (timer) clearTimeout(timer);
      };
    }
  }, [breathPhase, gameState, streak]);

  // Update particles animation
  useEffect(() => {
    const particleInterval = setInterval(() => {
      setParticles(prev => prev.map(p => ({
        ...p,
        progress: p.progress + p.speed,
        x: p.x + (p.targetX - p.x) * 0.02,
        y: p.y + (p.targetY - p.y) * 0.02,
        rotation: p.rotation + 1,
        size: p.size * (1 - p.progress * 0.3),
      })).filter(p => p.progress < 1));
    }, 16);

    return () => clearInterval(particleInterval);
  }, []);

  // Update floating texts
  useEffect(() => {
    const textInterval = setInterval(() => {
      setFloatingTexts(prev => prev.map(t => ({
        ...t,
        y: t.y - 1,
        opacity: t.opacity - 0.01,
        scale: t.scale + 0.01,
      })).filter(t => t.opacity > 0));
    }, 16);

    return () => clearInterval(textInterval);
  }, []);

  // Update ripples
  useEffect(() => {
    const rippleInterval = setInterval(() => {
      setRipples(prev => prev.map(r => ({
        ...r,
        scale: r.scale + 0.03,
        opacity: r.opacity - 0.02,
      })).filter(r => r.opacity > 0));
    }, 16);

    return () => clearInterval(rippleInterval);
  }, []);

  // Calculate breath progress for UI
  const getBreathProgress = () => {
    if (breathPhase === 'inhale') {
      return scaleAnim._value / 1.6;
    } else if (breathPhase === 'exhale') {
      return 1 - (scaleAnim._value - 1) / 0.6;
    }
    return breathPhase === 'hold' ? 1 : 0;
  };

  // Get breath phase icon and color
  const getBreathInfo = () => {
    switch (breathPhase) {
      case 'inhale': return { icon: '🌬️', color: '#818CF8', text: 'BREATHE IN' };
      case 'hold': return { icon: '⏸️', color: '#60A5FA', text: 'HOLD' };
      case 'exhale': return { icon: '😮‍💨', color: '#FBBF24', text: 'BREATHE OUT' };
      default: return { icon: '✨', color: '#818CF8', text: 'READY' };
    }
  };

  const breathInfo = getBreathInfo();
  const progress = getBreathProgress();

  return (
    <TouchableWithoutFeedback onPress={handleTouch}>
      <View style={styles.container}>
        {/* Background gradient overlay */}
        <View style={styles.bgGradient} />

        {/* Particle system */}
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
                opacity: 1 - p.progress,
                transform: [
                  { rotate: `${p.rotation}deg` },
                  { scale: 1 - p.progress * 0.5 },
                ],
              }
            ]}
          />
        ))}

        {/* Ripple effects */}
        {ripples.map(r => (
          <Animated.View
            key={r.id}
            style={[
              styles.ripple,
              {
                left: r.x - 50,
                top: r.y - 50,
                width: 100 + r.scale * 200,
                height: 100 + r.scale * 200,
                borderRadius: 50 + r.scale * 100,
                opacity: r.opacity * 0.5,
                borderColor: `rgba(129, 140, 248, ${r.opacity * 0.5})`,
              }
            ]}
          />
        ))}

        {/* Floating texts */}
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

        {/* Main breathing sphere */}
        <Animated.View
          style={[
            styles.sphereContainer,
            {
              transform: [
                { scale: scaleAnim },
                {
                  rotate: rotateAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '360deg'],
                  })
                },
              ],
            }
          ]}
        >
          <Animated.View style={[
            styles.auraSphere,
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
            <View style={styles.auraCore}>
              <Text style={styles.breathIcon}>{breathInfo.icon}</Text>
            </View>
          </Animated.View>
        </Animated.View>

        {/* Breath progress circle */}
        <View style={styles.progressContainer}>
          <View style={styles.progressCircle}>
            <Text style={styles.breathPhaseText}>{breathInfo.text}</Text>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBar, {
                width: `${progress * 100}%`,
                backgroundColor: breathInfo.color,
              }]} />
            </View>
          </View>
        </View>

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudLeft}>
            <Text style={styles.hudLabel}>🌀 CYCLES</Text>
            <Text style={styles.hudValue}>{cycleCount}</Text>
          </View>
          <View style={styles.hudCenter}>
            <Text style={styles.hudLabel}>💫 SCORE</Text>
            <Text style={styles.hudValue}>{score}</Text>
          </View>
          <View style={styles.hudRight}>
            <Text style={styles.hudLabel}>⚡ STREAK</Text>
            <Text style={[
              styles.hudValue,
              streak > 5 && styles.streakHigh,
              streak > 10 && styles.streakSuper,
            ]}>
              {streak}x
            </Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlText}>👆 Tap to amplify</Text>
            <Text style={styles.controlSubtext}>Touch the light during breathing for bonus points</Text>
          </View>
        </View>

        {/* Status indicator */}
        <View style={[styles.statusIndicator, { borderColor: breathInfo.color }]}>
          <Text style={[styles.statusText, { color: breathInfo.color }]}>
            {breathPhase === 'inhale' ? '🌬️ Inhale...' :
              breathPhase === 'hold' ? '⏸️ Hold...' :
                breathPhase === 'exhale' ? '😮‍💨 Exhale...' :
                  '✨ Ready'}
          </Text>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0A2A',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at center, #1A1040 0%, #0F0A2A 100%)',
  },
  sphereContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  auraSphere: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#818CF8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#818CF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 50,
    elevation: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  auraCore: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  breathIcon: {
    fontSize: 32,
  },
  particle: {
    position: 'absolute',
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  ripple: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 50,
  },
  floatingText: {
    position: 'absolute',
    fontSize: 20,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  progressContainer: {
    position: 'absolute',
    bottom: 120,
    alignItems: 'center',
  },
  progressCircle: {
    backgroundColor: 'rgba(15, 10, 42, 0.8)',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.2)',
    alignItems: 'center',
  },
  breathPhaseText: {
    color: '#C7D2FE',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: 8,
  },
  progressBarContainer: {
    width: 200,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  hud: {
    position: 'absolute',
    top: 30,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  hudLeft: {
    backgroundColor: 'rgba(15, 10, 42, 0.8)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.2)',
    alignItems: 'center',
  },
  hudCenter: {
    backgroundColor: 'rgba(15, 10, 42, 0.8)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.2)',
    alignItems: 'center',
  },
  hudRight: {
    backgroundColor: 'rgba(15, 10, 42, 0.8)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 114, 182, 0.2)',
    alignItems: 'center',
  },
  hudLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1,
  },
  hudValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  streakHigh: {
    color: '#F472B6',
  },
  streakSuper: {
    color: '#F59E0B',
    textShadowColor: '#F59E0B',
    textShadowRadius: 10,
  },
  controls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  controlGroup: {
    backgroundColor: 'rgba(15, 10, 42, 0.7)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.1)',
    alignItems: 'center',
  },
  controlText: {
    color: '#A5B4FC',
    fontSize: 13,
    fontWeight: '600',
  },
  controlSubtext: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  statusIndicator: {
    position: 'absolute',
    top: 100,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#818CF8',
    backgroundColor: 'rgba(15, 10, 42, 0.6)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
});