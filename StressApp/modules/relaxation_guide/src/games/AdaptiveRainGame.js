import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  Dimensions,
  Animated,
  Easing,
  Vibration,
  Platform
} from 'react-native';

import { soundEngine } from '../utils/SoundEngine';

// Cross-platform LinearGradient fallback
const LinearGradient = ({ colors, style, children }) => {
  const bg = colors && colors.length > 0 ? colors[0] : 'transparent';
  return (
    <View style={[style, { backgroundColor: bg }]}>
      {children}
    </View>
  );
};

const { width, height } = Dimensions.get('window');

export const AdaptiveRainGame = () => {
  // Core game state
  const [raindrops, setRaindrops] = useState([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [gameState, setGameState] = useState('calm');
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [ripples, setRipples] = useState([]);
  const [clouds, setClouds] = useState([]);
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const [achievements, setAchievements] = useState([]);
  const [breathPhase, setBreathPhase] = useState('inhale');
  const [breathTimer, setBreathTimer] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [lastTapTime, setLastTapTime] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);

  // Animation refs
  const breathAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const gameLoop = useRef(null);
  const breathInterval = useRef(null);
  const tapAnim = useRef(new Animated.Value(1)).current;
  const interactionTimer = useRef(null);

  // Color palette for different moods
  const colors = {
    calm: {
      primary: '#4A90D9',
      secondary: '#81D4FA',
      background: '#0A1628',
      accent: '#64B5F6',
      glow: 'rgba(100, 180, 255, 0.3)',
      gradient: ['#0A1628', '#0D2040']
    },
    breeze: {
      primary: '#43A047',
      secondary: '#81C784',
      background: '#0B2035',
      accent: '#A5D6A7',
      glow: 'rgba(67, 160, 71, 0.3)',
      gradient: ['#0B2035', '#0D2A1A']
    },
    storm: {
      primary: '#5C6BC0',
      secondary: '#7986CB',
      background: '#0A0A1A',
      accent: '#9FA8DA',
      glow: 'rgba(92, 107, 192, 0.3)',
      gradient: ['#0A0A1A', '#1A0A2A']
    }
  };

  const currentColors = colors[gameState] || colors.calm;

  // Raindrop emojis with varied sizes
  const raindropEmojis = ['💧', '🌧️', '💦', '❄️', '☔'];
  const breathEmojis = ['💎', '✨', '🌟', '💫', '🌈'];
  const mindfulnessMessages = [
    '🌿 Breathe...', '✨ Calm', '🌸 Peace', '💫 Focus',
    '🌊 Flow', '🌙 Relax', '☯️ Balance', '🧘 Zen',
    '🌈 Serene', '🌺 Tranquil'
  ];

  // Create initial clouds with more variety
  useEffect(() => {
    const initialClouds = [];
    for (let i = 0; i < 8; i++) {
      initialClouds.push({
        id: Date.now() + Math.random() * 1000,
        x: Math.random() * width,
        y: 20 + Math.random() * height * 0.3,
        width: 60 + Math.random() * 150,
        opacity: 0.2 + Math.random() * 0.3,
        speed: 0.05 + Math.random() * 0.15,
        rotation: (Math.random() - 0.5) * 10,
      });
    }
    setClouds(initialClouds);
  }, []);

  // Create raindrop with enhanced properties
  const createRaindrop = (x, y, isBreath = false) => {
    const size = isBreath ? 20 + Math.random() * 12 : 16 + Math.random() * 18;
    const speed = isBreath ? 0.3 + Math.random() * 0.3 : 0.5 + Math.random() * 0.8;
    const opacity = isBreath ? 0.7 + Math.random() * 0.3 : 0.4 + Math.random() * 0.5;

    const emojis = isBreath ? breathEmojis : raindropEmojis;
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];

    return {
      id: Date.now() + Math.random() * 10000,
      x: x || Math.random() * width,
      y: y || -50 - Math.random() * 150,
      size,
      speed,
      opacity,
      emoji,
      rotation: Math.random() * 360,
      wobble: (Math.random() - 0.5) * 0.8,
      phase: Math.random() * Math.PI * 2,
      isBreath,
      glow: isBreath ? 0.5 + Math.random() * 0.4 : 0,
      scale: 1,
      hue: Math.random() * 30 + 190, // Blue-green range
    };
  };

  // Enhanced ripple effect with color
  const createRipple = (x, y) => {
    const newRipple = {
      id: Date.now() + Math.random() * 10000,
      x,
      y,
      radius: 0,
      maxRadius: 40 + Math.random() * 100,
      opacity: 0.8,
      speed: 0.3 + Math.random() * 0.7,
      color: currentColors.accent,
    };
    setRipples(prev => [...prev, newRipple]);

    // Haptic feedback for touch
    if (Platform.OS !== 'web') {
      Vibration.vibrate(5);
    }

    // Generate floating text
    if (Math.random() < 0.2) {
      const msg = mindfulnessMessages[Math.floor(Math.random() * mindfulnessMessages.length)];
      createFloatingText(x, y - 30, msg, currentColors.accent);
    }
  };

  // Enhanced particle system
  const createSplash = (x, y, count = 20) => {
    const newParticles = [];
    const colors = [currentColors.accent, currentColors.secondary, '#FFFFFF'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 0.5 + Math.random() * 3;
      newParticles.push({
        id: Date.now() + Math.random() * 10000,
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 1.5,
        life: 0.6 + Math.random() * 0.4,
        size: 2 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        spin: (Math.random() - 0.5) * 4,
        gravity: 0.05 + Math.random() * 0.05,
        fadeSpeed: 0.005 + Math.random() * 0.01,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Enhanced floating text
  const createFloatingText = (x, y, text, color = '#B3E5FC') => {
    const scale = 0.5 + Math.random() * 0.5;
    setFloatingTexts(prev => [...prev, {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      x: x + (Math.random() - 0.5) * 60,
      y,
      text,
      color,
      opacity: 1,
      vy: -0.8 - Math.random() * 0.8,
      vx: (Math.random() - 0.5) * 0.5,
      scale: scale,
      initialX: x,
      wobble: Math.random() * Math.PI * 2,
      rotation: (Math.random() - 0.5) * 20,
    }]);
  };

  // Breathing exercise with visual feedback
  const toggleBreathPhase = () => {
    const newPhase = breathPhase === 'inhale' ? 'exhale' : 'inhale';
    setBreathPhase(newPhase);

    // Dynamic acoustic biofeedback on phone speakers
    soundEngine.updateBreathPhase(newPhase, 4);

    const breathPoints = breathPhase === 'inhale' ? 8 : 12;
    setXp(prev => prev + breathPoints);

    // Create breath-specific particles
    for (let i = 0; i < 5; i++) {
      const drop = createRaindrop(
        width * 0.2 + Math.random() * width * 0.6,
        height * 0.2 + Math.random() * height * 0.2,
        true
      );
      setRaindrops(prev => [...prev, drop]);
    }

    // Create gentle glow pulse
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Handle touch with enhanced interaction
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;

    // Track interaction
    const now = Date.now();
    if (now - lastTapTime < 100) return;
    setLastTapTime(now);
    setTapCount(prev => prev + 1);
    setIsInteracting(true);

    // Create visual effects & interactive touch sound chime
    soundEngine.playTouchChime(locationX / width);
    createRipple(locationX, locationY);
    createSplash(locationX, locationY, 15);

    // Combo and scoring with multiplier
    const newCombo = combo + 1;
    setCombo(newCombo);

    const basePoints = 3 + Math.floor(Math.random() * 4);
    const comboMultiplier = Math.min(Math.floor(newCombo / 5) + 1, 5);
    const points = basePoints * comboMultiplier;

    setScore(prev => prev + points);
    setXp(prev => prev + points);

    // Visual feedback for combo
    if (newCombo > 0 && newCombo % 5 === 0) {
      const comboText = ['🔥', '⚡', '🌟', '💫', '🌈'][Math.min(Math.floor(newCombo / 5) - 1, 4)];
      createFloatingText(locationX, locationY - 80, `${comboText} ${newCombo}x Combo!`, '#FFD54F');

      // Haptic feedback for milestones
      if (Platform.OS !== 'web') {
        Vibration.vibrate([5, 10, 5]);
      }
    }

    // Level up check
    const xpNeeded = level * 25;
    if (xp > xpNeeded) {
      const newLevel = level + 1;
      setLevel(newLevel);
      createFloatingText(width / 2, height / 2 - 50, `🎉 Level ${newLevel}!`, '#FFD700');

      // Extra celebration particles
      for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 50 + Math.random() * 150;
        const x = width / 2 + Math.cos(angle) * distance;
        const y = height / 2 + Math.sin(angle) * distance;
        createSplash(x, y, 10);
      }
    }

    // Update game state based on interaction
    if (newCombo > 8 && gameState === 'calm') {
      setGameState('breeze');
      createFloatingText(width / 2, height * 0.3, '🍃 Gentle Breeze', '#A5D6A7');
    } else if (newCombo > 15 && gameState === 'breeze') {
      setGameState('storm');
      createFloatingText(width / 2, height * 0.3, '🌧️ Calm Storm', '#7986CB');
    } else if (newCombo < 3 && gameState !== 'calm') {
      setGameState('calm');
      createFloatingText(width / 2, height * 0.3, '🌤️ Serene Calm', '#81D4FA');
    }

    // Reset interaction timer
    if (interactionTimer.current) {
      clearTimeout(interactionTimer.current);
    }
    interactionTimer.current = setTimeout(() => {
      setIsInteracting(false);
    }, 1000);

    // Check achievements
    checkAchievements();
  };

  // Achievement system
  const checkAchievements = () => {
    const newAchievements = [];
    const achievementMap = [
      { id: 'first_touch', name: '🌟 First Touch', desc: 'Start your journey', check: () => tapCount === 1 },
      { id: 'calm_collector', name: '🌱 Mindful Collector', desc: 'Score 100 points', check: () => score >= 100 },
      { id: 'zen_master', name: '🧘 Zen Master', desc: 'Reach 10 combo', check: () => combo >= 10 },
      { id: 'mindful_journey', name: '🌸 Mindful Journey', desc: 'Earn 100 XP', check: () => xp >= 100 },
      { id: 'breath_master', name: '💨 Breath Master', desc: 'Complete 5 breath cycles', check: () => breathTimer >= 20 },
      { id: 'serenity_seeker', name: '🌊 Serenity Seeker', desc: 'Reach level 3', check: () => level >= 3 },
    ];

    achievementMap.forEach(a => {
      if (a.check() && !achievements.find(ach => ach.id === a.id)) {
        newAchievements.push({ id: a.id, name: a.name, desc: a.desc });
      }
    });

    if (newAchievements.length > 0) {
      setAchievements(prev => [...prev, ...newAchievements]);
      newAchievements.forEach(a => {
        createFloatingText(width / 2, height / 2, `${a.name} 🏆`, '#FFD700');
        if (Platform.OS !== 'web') {
          Vibration.vibrate([10, 20, 10, 20, 10]);
        }
      });
    }
  };

  // Breathing exercise loop
  useEffect(() => {
    breathInterval.current = setInterval(() => {
      setBreathTimer(prev => {
        const newTime = prev + 1;
        if (newTime >= 4) {
          toggleBreathPhase();
          return 0;
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(breathInterval.current);
  }, [breathPhase]);

  // Main game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update raindrops
      setRaindrops(prev => {
        const updated = prev.map(drop => ({
          ...drop,
          y: drop.y + drop.speed * (gameState === 'storm' ? 1.8 : gameState === 'breeze' ? 0.9 : 0.6),
          x: drop.x + Math.sin(drop.phase + Date.now() * 0.001) * drop.wobble * 0.5,
          rotation: drop.rotation + 0.3,
          glow: drop.isBreath ? drop.glow + Math.sin(Date.now() * 0.003) * 0.03 : drop.glow,
          scale: drop.isBreath ? 1 + Math.sin(Date.now() * 0.002) * 0.05 : 1,
          opacity: drop.y > height ? drop.opacity * 0.95 : drop.opacity,
        }));
        return updated.filter(drop => drop.y < height + 100);
      });

      // Update ripples
      setRipples(prev => {
        const updated = prev.map(ripple => ({
          ...ripple,
          radius: ripple.radius + ripple.speed,
          opacity: ripple.opacity - 0.008,
        }));
        return updated.filter(ripple => ripple.opacity > 0 && ripple.radius < ripple.maxRadius);
      });

      // Update particles
      setParticles(prev => {
        const updated = prev.map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          vy: p.vy + p.gravity,
          life: p.life - p.fadeSpeed,
          rotation: p.rotation + p.spin,
          size: p.size * (1 - (1 - p.life) * 0.3),
        }));
        return updated.filter(p => p.life > 0);
      });

      // Update floating texts
      setFloatingTexts(prev => {
        const updated = prev.map(t => ({
          ...t,
          y: t.y + t.vy,
          x: t.x + t.vx + Math.sin(t.wobble + Date.now() * 0.001) * 0.3,
          opacity: t.opacity - 0.008,
          scale: t.scale + 0.003,
          rotation: t.rotation + 0.1,
        }));
        return updated.filter(t => t.opacity > 0);
      });

      // Update clouds
      setClouds(prev => {
        return prev.map(cloud => ({
          ...cloud,
          x: cloud.x + cloud.speed,
          y: cloud.y + Math.sin(Date.now() * 0.0002 + cloud.id) * 0.1,
        }));
      });

      // Auto-generate raindrops
      const intensity = gameState === 'storm' ? 0.6 : gameState === 'breeze' ? 0.35 : 0.15;
      if (Math.random() < intensity) {
        const drop = createRaindrop();
        setRaindrops(prev => [...prev, drop]);
      }

      // Generate occasional breath drops
      if (Math.random() < 0.02 && gameState !== 'storm') {
        const drop = createRaindrop(
          width * 0.2 + Math.random() * width * 0.6,
          height * 0.1 + Math.random() * height * 0.1,
          true
        );
        setRaindrops(prev => [...prev, drop]);
      }

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, [gameState]);

  // Breathing animation with enhanced visuals
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, {
          toValue: 1,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathAnim, {
          toValue: 0,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  // Pulse animation for interaction feedback
  useEffect(() => {
    if (isInteracting) {
      Animated.spring(pulseAnim, {
        toValue: 1.02,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(pulseAnim, {
        toValue: 1,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isInteracting]);

  // Tap animation
  useEffect(() => {
    Animated.sequence([
      Animated.spring(tapAnim, {
        toValue: 0.8,
        friction: 2,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.spring(tapAnim, {
        toValue: 1,
        friction: 2,
        tension: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [tapCount]);

  return (
    <TouchableWithoutFeedback onPress={handleTouch}>
      <View style={[styles.container, { backgroundColor: currentColors.background }]}>
        <LinearGradient
          colors={currentColors.gradient}
          style={styles.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />

        {/* Clouds */}
        {clouds.map((cloud) => (
          <Animated.View
            key={cloud.id}
            style={[
              styles.cloud,
              {
                left: cloud.x - cloud.width / 2,
                top: cloud.y,
                width: cloud.width,
                height: cloud.width * 0.35,
                opacity: cloud.opacity,
                borderRadius: cloud.width * 0.5,
                transform: [
                  { scaleX: 1 + Math.sin(cloud.id + Date.now() * 0.0001) * 0.03 },
                  { rotate: `${cloud.rotation}deg` },
                ],
                backgroundColor: `rgba(255,255,255,${cloud.opacity * 0.1})`,
              }
            ]}
          />
        ))}

        {/* Breathing Guide */}
        <Animated.View
          style={[
            styles.breathContainer,
            {
              transform: [
                {
                  scale: breathAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.95, 1.15],
                  })
                },
                {
                  scale: glowAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.1],
                  })
                }
              ],
              opacity: breathAnim.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0.7, 1, 0.7],
              }),
              borderColor: currentColors.accent,
              shadowColor: currentColors.accent,
            }
          ]}
        >
          <Text style={[styles.breathText, { color: currentColors.accent }]}>
            {breathPhase === 'inhale' ? '🌬️ Breathe In' : '🌿 Breathe Out'}
          </Text>
          <View style={styles.breathTimerContainer}>
            <Animated.View
              style={[
                styles.breathTimerFill,
                {
                  width: `${(breathTimer / 4) * 100}%`,
                  backgroundColor: currentColors.accent,
                }
              ]}
            />
          </View>
          <Text style={styles.breathInstruction}>Tap anywhere to create ripples</Text>
        </Animated.View>

        {/* Ripples */}
        {ripples.map((ripple) => (
          <Animated.View
            key={ripple.id}
            style={[
              styles.ripple,
              {
                left: ripple.x - ripple.radius,
                top: ripple.y - ripple.radius,
                width: ripple.radius * 2,
                height: ripple.radius * 2,
                opacity: ripple.opacity,
                borderRadius: ripple.radius,
                borderColor: ripple.color,
                backgroundColor: `rgba(255,255,255,${ripple.opacity * 0.05})`,
              }
            ]}
          />
        ))}

        {/* Raindrops */}
        {raindrops.map((drop) => (
          <Animated.Text
            key={drop.id}
            style={[
              styles.raindropText,
              {
                left: drop.x - drop.size / 2,
                top: drop.y - drop.size / 2,
                fontSize: drop.size,
                opacity: drop.opacity,
                transform: [
                  { rotate: `${drop.rotation}deg` },
                  { scale: drop.scale || 1 },
                ],
                textShadowColor: drop.isBreath ? currentColors.accent : currentColors.secondary,
                textShadowRadius: drop.isBreath ? 25 : 15,
                color: drop.isBreath ? '#FFFFFF' : currentColors.secondary,
                ...(drop.isBreath && {
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowOpacity: 0.8,
                }),
              }
            ]}
          >
            {drop.emoji}
          </Animated.Text>
        ))}

        {/* Particles */}
        {particles.map((p) => (
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
                transform: [{ rotate: `${p.rotation}deg` }],
                borderRadius: p.size / 2,
              }
            ]}
          />
        ))}

        {/* Floating Texts */}
        {floatingTexts.map((t) => (
          <Animated.Text
            key={t.id}
            style={[
              styles.floatingText,
              {
                left: t.x - 30,
                top: t.y,
                opacity: t.opacity,
                color: t.color,
                transform: [
                  { scale: t.scale || 1 },
                  { rotate: `${t.rotation || 0}deg` },
                ],
                textShadowColor: 'rgba(0,0,0,0.3)',
                textShadowRadius: 5,
              }
            ]}
          >
            {t.text}
          </Animated.Text>
        ))}

        {/* HUD */}
        <Animated.View style={[
          styles.hud,
          { transform: [{ scale: pulseAnim }] }
        ]}>
          <View style={styles.hudLeft}>
            <View style={[styles.scoreContainer, { borderColor: currentColors.accent }]}>
              <Text style={styles.scoreLabel}>🌊 Mindful Score</Text>
              <Text style={[styles.scoreValue, { color: currentColors.accent }]}>
                {score.toLocaleString()}
              </Text>
            </View>

            <View style={styles.levelContainer}>
              <Text style={styles.levelLabel}>🌱 Level {level}</Text>
              <View style={styles.xpBar}>
                <Animated.View
                  style={[
                    styles.xpFill,
                    {
                      width: `${(xp % 25) / 25 * 100}%`,
                      backgroundColor: currentColors.accent,
                    }
                  ]}
                />
              </View>
            </View>
          </View>

          <View style={styles.hudRight}>
            <View style={[styles.comboContainer, { borderColor: currentColors.accent }]}>
              <Text style={styles.comboLabel}>✨ Flow</Text>
              <Text style={[
                styles.comboValue,
                combo > 10 && styles.comboHigh,
                combo > 15 && styles.comboSuper,
                { color: combo > 10 ? '#FFD54F' : currentColors.accent }
              ]}>
                {combo}x
              </Text>
            </View>

            <View style={[styles.statusContainer, { borderColor: currentColors.accent }]}>
              <Text style={[
                styles.statusText,
                gameState === 'calm' && styles.calmStatus,
                gameState === 'breeze' && styles.breezeStatus,
                gameState === 'storm' && styles.stormStatus,
              ]}>
                {gameState === 'storm' ? '🌧️ Storm' :
                  gameState === 'breeze' ? '🍃 Breeze' : '🌤️ Calm'}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Achievements */}
        {achievements.length > 0 && (
          <Animated.View style={[
            styles.achievementContainer,
            {
              opacity: achievements.length > 0 ? 1 : 0,
              transform: [{ translateY: achievements.length > 0 ? 0 : 20 }],
            }
          ]}>
            <Text style={styles.achievementLabel}>🏆 Achievements</Text>
            <View style={styles.achievementList}>
              {achievements.slice(-3).map((a) => (
                <Text key={a.id} style={styles.achievementItem}>
                  {a.name}
                </Text>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Interactive Stats */}
        <Animated.View style={[
          styles.bottomContainer,
          {
            opacity: showStats ? 1 : 0.3,
            transform: [{ scale: showStats ? 1 : 0.95 }],
          }
        ]}>
          <TouchableWithoutFeedback onPress={() => setShowStats(!showStats)}>
            <View style={styles.statsToggle}>
              <Text style={styles.statsText}>
                💧 {raindrops.length} • ✨ {particles.length} • 🌊 {ripples.length}
              </Text>
              <Text style={styles.statsHint}>Tap to toggle details</Text>
            </View>
          </TouchableWithoutFeedback>

          {showStats && (
            <View style={styles.statsDetail}>
              <Text style={styles.statsDetailText}>
                Interactions: {tapCount} • Achievements: {achievements.length}
              </Text>
              <Text style={styles.statsDetailText}>
                Level Progress: {Math.floor((xp % 25) / 25 * 100)}%
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Breathing status indicator */}
        <View style={styles.breathingIndicator}>
          <View style={[styles.breathingDot, {
            backgroundColor: breathPhase === 'inhale' ? '#4CAF50' : '#2196F3',
            transform: [{ scale: breathPhase === 'inhale' ? 1.2 : 0.8 }],
          }]} />
          <Text style={styles.breathingStatus}>
            {breathPhase === 'inhale' ? 'Inhaling...' : 'Exhaling...'}
          </Text>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  gradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cloud: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  breathContainer: {
    position: 'absolute',
    top: height * 0.35,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  breathText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  breathTimerContainer: {
    width: 70,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginVertical: 8,
    overflow: 'hidden',
  },
  breathTimerFill: {
    height: '100%',
    borderRadius: 2,
  },
  breathInstruction: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  ripple: {
    position: 'absolute',
    borderWidth: 2,
  },
  raindropText: {
    position: 'absolute',
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 0 },
    textShadowOpacity: 0.5,
  },
  particle: {
    position: 'absolute',
  },
  floatingText: {
    position: 'absolute',
    fontSize: 20,
    fontWeight: '300',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  hud: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  hudLeft: {
    gap: 8,
  },
  hudRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  scoreContainer: {
    backgroundColor: 'rgba(10, 30, 50, 0.6)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  scoreLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontWeight: '400',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  scoreValue: {
    fontSize: 24,
    fontWeight: '300',
    textShadowRadius: 5,
  },
  levelContainer: {
    backgroundColor: 'rgba(10, 30, 50, 0.4)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  levelLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 8,
    fontWeight: '300',
  },
  xpBar: {
    width: 60,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 1,
    marginTop: 2,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    borderRadius: 1,
  },
  comboContainer: {
    backgroundColor: 'rgba(20, 10, 40, 0.4)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  comboLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 8,
    fontWeight: '300',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  comboValue: {
    fontSize: 20,
    fontWeight: '300',
  },
  comboHigh: {
    fontSize: 24,
    textShadowColor: 'rgba(255, 213, 79, 0.3)',
    textShadowRadius: 10,
  },
  comboSuper: {
    fontSize: 28,
    textShadowColor: 'rgba(255, 213, 79, 0.5)',
    textShadowRadius: 15,
  },
  statusContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '300',
    opacity: 0.8,
  },
  calmStatus: { color: '#81D4FA' },
  breezeStatus: { color: '#A5D6A7' },
  stormStatus: { color: '#7986CB' },
  achievementContainer: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.1)',
  },
  achievementLabel: {
    color: 'rgba(255,215,0,0.5)',
    fontSize: 8,
    fontWeight: '300',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  achievementList: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  achievementItem: {
    color: 'rgba(255,215,0,0.7)',
    fontSize: 10,
    backgroundColor: 'rgba(255,215,0,0.05)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 30,
    alignItems: 'center',
  },
  statsToggle: {
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  statsText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 9,
    fontWeight: '300',
  },
  statsHint: {
    color: 'rgba(255,255,255,0.1)',
    fontSize: 7,
    marginTop: 2,
  },
  statsDetail: {
    marginTop: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    padding: 8,
    borderRadius: 6,
  },
  statsDetailText: {
    color: 'rgba(255,255,255,0.15)',
    fontSize: 8,
    marginVertical: 1,
  },
  breathingIndicator: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  breathingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  breathingStatus: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 8,
  },
});