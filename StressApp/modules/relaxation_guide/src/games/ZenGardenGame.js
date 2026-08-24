import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  PanResponder,
  Easing
} from 'react-native';

const { width, height } = Dimensions.get('window');

export const ZenGardenGame = () => {
  const [stones, setStones] = useState([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [totalBalanced, setTotalBalanced] = useState(0);
  const [gameState, setGameState] = useState('playing');
  const [sandPattern, setSandPattern] = useState([]);
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [sandRipples, setSandRipples] = useState([]);
  const [zenLevel, setZenLevel] = useState(1);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const sandAnim = useRef(new Animated.Value(0)).current;

  const spawnTimer = useRef(null);
  const gameLoop = useRef(null);
  const touchRef = useRef({ x: 0, y: 0 });

  // Stone types with different properties
  const STONE_TYPES = [
    {
      id: 'calm',
      label: 'Calm',
      emoji: '🪨',
      color: '#78350F',
      glow: '#D97706',
      points: 10,
      size: 50,
      stability: 0.8
    },
    {
      id: 'balance',
      label: 'Balance',
      emoji: '⚖️',
      color: '#92400E',
      glow: '#F59E0B',
      points: 15,
      size: 55,
      stability: 0.7
    },
    {
      id: 'clarity',
      label: 'Clarity',
      emoji: '💎',
      color: '#1E3A5F',
      glow: '#60A5FA',
      points: 20,
      size: 45,
      stability: 0.9
    },
    {
      id: 'peace',
      label: 'Peace',
      emoji: '☮️',
      color: '#065F46',
      glow: '#34D399',
      points: 25,
      size: 60,
      stability: 0.6
    },
    {
      id: 'wisdom',
      label: 'Wisdom',
      emoji: '🧘',
      color: '#5B21B6',
      glow: '#8B5CF6',
      points: 30,
      size: 50,
      stability: 0.85
    },
  ];

  // Create initial stones
  useEffect(() => {
    const initialStones = [];
    for (let i = 0; i < 5; i++) {
      initialStones.push(createStone(true));
    }
    setStones(initialStones);
  }, []);

  // Create sand pattern
  useEffect(() => {
    const pattern = [];
    for (let i = 0; i < 30; i++) {
      pattern.push({
        id: i,
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 2 + Math.random() * 4,
        opacity: 0.1 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
    setSandPattern(pattern);
  }, []);

  // Create a new stone
  const createStone = (isInitial = false) => {
    const type = STONE_TYPES[Math.floor(Math.random() * STONE_TYPES.length)];
    const size = type.size * (0.8 + Math.random() * 0.4);
    const x = 30 + Math.random() * (width - 60 - size);
    const y = isInitial ? 50 + Math.random() * (height * 0.6 - 100) : -30 - Math.random() * 50;

    return {
      id: Date.now() + Math.random(),
      type,
      x,
      y,
      size,
      rotation: Math.random() * 360,
      opacity: 0.7 + Math.random() * 0.3,
      scale: 0.8 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      isBalanced: false,
      balanceProgress: 0,
      wobble: Math.random() * 2 - 1,
    };
  };

  // Create sand ripple
  const createSandRipple = (x, y) => {
    setSandRipples(prev => [...prev, {
      id: Date.now() + Math.random(),
      x,
      y,
      radius: 10,
      maxRadius: 80 + Math.random() * 40,
      opacity: 1,
      speed: 1 + Math.random() * 2,
    }]);
  };

  // Create particles (sand particles)
  const createParticles = (x, y, color, count = 20) => {
    const newParticles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 0.5 + Math.random() * 2;
      newParticles.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 1,
        life: 1,
        size: 2 + Math.random() * 4,
        color: color || '#D97706',
        gravity: 0.02,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Create floating text
  const createFloatingText = (x, y, text, color = '#FDE68A') => {
    setFloatingTexts(prev => [...prev, {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${Math.random()}`,
      x,
      y,
      text,
      color,
      opacity: 1,
      vy: -1.5 - Math.random() * 1,
      scale: 1,
    }]);
  };

  // Balance stone (tap to stack)
  const balanceStone = (stone) => {
    if (stone.isBalanced) return;

    // Mark as balancing
    setStones(prev => prev.map(s =>
      s.id === stone.id ? { ...s, isBalanced: true, balanceProgress: 1 } : s
    ));

    // Create effects
    createSandRipple(stone.x + stone.size / 2, stone.y + stone.size / 2);
    createParticles(stone.x + stone.size / 2, stone.y + stone.size / 2, stone.type.glow, 25);

    // Calculate score with combo
    const comboBonus = Math.floor(combo / 3) + 1;
    const points = stone.type.points * comboBonus * (1 + zenLevel * 0.1);
    setScore(prev => prev + Math.round(points));
    setCombo(prev => prev + 1);
    setTotalBalanced(prev => prev + 1);
    setZenLevel(prev => Math.min(prev + 0.1, 10));

    if (combo + 1 > maxCombo) {
      setMaxCombo(combo + 1);
    }

    // Floating text
    let text = `🧘 +${Math.round(points)}`;
    if (combo > 0) {
      text += ` x${comboBonus}`;
    }
    createFloatingText(
      stone.x + stone.size / 2 - 30,
      stone.y - 10,
      text,
      stone.type.glow
    );

    // Combo milestones
    if (combo > 0 && combo % 5 === 0) {
      createFloatingText(
        stone.x + stone.size / 2 - 50,
        stone.y - 50,
        `✨ ${combo + 1}x ZEN!`,
        '#FCD34D'
      );

      // Spawn bonus stones
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const bonusStone = createStone();
          bonusStone.x = stone.x + (Math.random() - 0.5) * 150;
          bonusStone.y = stone.y + (Math.random() - 0.5) * 150;
          setStones(prev => [...prev, bonusStone]);
        }, i * 300);
      }
    }

    // Screen shake
    if (combo > 5) {
      Animated.sequence([
        Animated.timing(shakeAnim, {
          toValue: 2,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: -2,
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

    // Glow pulse
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();

    // Scale animation
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1.1,
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

    // Remove stone after animation
    setTimeout(() => {
      setStones(prev => prev.filter(s => s.id !== stone.id));

      // Spawn new stone
      setTimeout(() => {
        const newStone = createStone();
        setStones(prev => [...prev, newStone]);
      }, 1000 + Math.random() * 2000);
    }, 800);
  };

  // Handle touch
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;
    touchRef.current = { x: locationX, y: locationY };

    // Create sand ripple
    createSandRipple(locationX, locationY);
    createParticles(locationX, locationY, '#D97706', 10);

    // Check if touching a stone
    const hitStone = stones.find(s =>
      !s.isBalanced &&
      locationX > s.x && locationX < s.x + s.size &&
      locationY > s.y && locationY < s.y + s.size
    );

    if (hitStone) {
      balanceStone(hitStone);
    } else {
      // Rake sand effect
      createFloatingText(locationX - 20, locationY - 20, '🌊', '#FDE68A');
      setCombo(0);
    }
  };

  // Pan responder for sand raking
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (evt, gestureState) => {
      const { locationX, locationY } = evt.nativeEvent;
      touchRef.current = { x: locationX, y: locationY };

      // Create sand ripples while dragging
      if (Math.random() < 0.3) {
        createSandRipple(locationX, locationY);
        createParticles(locationX, locationY, '#D97706', 5);
      }
    },
  });

  // Game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update stones - gentle floating
      setStones(prev => prev.map(s => {
        if (s.isBalanced) return s;
        return {
          ...s,
          y: s.y + Math.sin(Date.now() * 0.001 + s.phase) * 0.1,
          rotation: s.rotation + 0.2,
        };
      }));

      // Update sand ripples
      setSandRipples(prev => prev.map(r => ({
        ...r,
        radius: r.radius + r.speed,
        opacity: r.opacity - 0.02,
      })).filter(r => r.opacity > 0 && r.radius < r.maxRadius));

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

      // Update sand animation
      sandAnim.setValue(Math.sin(Date.now() * 0.0005) * 2);

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, []);

  // Spawn new stones
  useEffect(() => {
    spawnTimer.current = setInterval(() => {
      if (stones.length < 6 + Math.floor(totalBalanced / 10)) {
        const newStone = createStone();
        setStones(prev => [...prev, newStone]);
      }
    }, 3000);

    return () => clearInterval(spawnTimer.current);
  }, [totalBalanced]);

  // Get zen level status
  const getZenStatus = () => {
    if (zenLevel < 2) return '🌱 Beginning';
    if (zenLevel < 4) return '🧘 Focused';
    if (zenLevel < 6) return '🌊 Flowing';
    if (zenLevel < 8) return '✨ Enlightened';
    return '🌈 Master';
  };

  return (
    <TouchableWithoutFeedback onPress={handleTouch} {...panResponder.panHandlers}>
      <Animated.View style={[
        styles.container,
        { transform: [{ translateX: shakeAnim }] }
      ]}>
        {/* Sand background */}
        <View style={styles.sandBackground}>
          <Animated.View style={[
            styles.sandLayer,
            {
              transform: [
                { translateX: sandAnim },
                {
                  translateY: sandAnim.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [-5, 5],
                  })
                },
              ],
            }
          ]} />
        </View>

        {/* Sand pattern */}
        {sandPattern.map(p => (
          <View
            key={p.id}
            style={[
              styles.sandParticle,
              {
                left: p.x + Math.sin(Date.now() * 0.0005 + p.phase) * 2,
                top: p.y + Math.cos(Date.now() * 0.0005 + p.phase) * 2,
                width: p.radius * 2,
                height: p.radius * 2,
                borderRadius: p.radius,
                opacity: p.opacity * (0.7 + Math.sin(Date.now() * 0.001 + p.phase) * 0.3),
              }
            ]}
          />
        ))}

        {/* Sand ripples */}
        {sandRipples.map(r => (
          <Animated.View
            key={r.id}
            style={[
              styles.sandRipple,
              {
                left: r.x - r.radius,
                top: r.y - r.radius,
                width: r.radius * 2,
                height: r.radius * 2,
                borderRadius: r.radius,
                opacity: r.opacity * 0.3,
                borderColor: `rgba(251, 191, 36, ${r.opacity * 0.5})`,
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

        {/* Stones */}
        {stones.map(s => (
          <Animated.View
            key={s.id}
            style={[
              styles.stoneContainer,
              {
                left: s.x,
                top: s.y,
                width: s.size,
                height: s.size * 0.6,
                transform: [
                  { rotate: `${s.rotation}deg` },
                  { scale: s.isBalanced ? 1.2 : s.scale },
                ],
                opacity: s.opacity,
              }
            ]}
          >
            <View style={[
              styles.stone,
              {
                width: s.size,
                height: s.size * 0.6,
                borderRadius: s.size * 0.3,
                backgroundColor: s.type.color,
                borderColor: s.type.glow,
                shadowColor: s.type.glow,
                shadowOpacity: s.isBalanced ? 0.8 : 0.3,
                shadowRadius: s.isBalanced ? 20 : 10,
              }
            ]}>
              <Text style={styles.stoneEmoji}>{s.type.emoji}</Text>
              <Text style={[styles.stoneLabel, { color: s.type.glow }]}>
                {s.type.label}
              </Text>
              {s.isBalanced && (
                <View style={styles.balanceIndicator}>
                  <Text style={styles.balanceText}>⚖️</Text>
                </View>
              )}
            </View>
          </Animated.View>
        ))}

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>🪨 BALANCED</Text>
            <Text style={styles.hudValue}>{totalBalanced}</Text>
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
            <Text style={styles.hudLabel}>🏆 MAX</Text>
            <Text style={styles.hudValue}>{maxCombo}</Text>
          </View>
        </View>

        {/* Zen level indicator */}
        <View style={styles.zenContainer}>
          <View style={styles.zenBar}>
            <View style={[styles.zenFill, {
              width: `${(zenLevel / 10) * 100}%`,
              backgroundColor: zenLevel > 7 ? '#F59E0B' : '#D97706',
            }]} />
          </View>
          <Text style={styles.zenText}>
            {getZenStatus()} • Level {Math.floor(zenLevel)}
          </Text>
        </View>

        {/* Status */}
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {stones.length < 3 ? '🌱 Rake the sand...' :
              stones.length < 5 ? '🪨 Place stones mindfully' :
                '🧘 Zen garden flourishing'}
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlText}>
              👆 Tap stones to balance • Drag to rake sand
            </Text>
            <Text style={styles.controlSubtext}>
              Each balanced stone brings inner peace
            </Text>
          </View>
        </View>

        {/* Glow overlay */}
        <Animated.View style={[
          styles.glowOverlay,
          {
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.15],
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
    backgroundColor: '#1A0A02',
    overflow: 'hidden',
  },
  sandBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at center, #2D1A04 0%, #1A0A02 100%)',
  },
  sandLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at center, #4A2C0A 0%, #2D1A04 100%)',
    opacity: 0.3,
  },
  sandParticle: {
    position: 'absolute',
    backgroundColor: '#D97706',
  },
  sandRipple: {
    position: 'absolute',
    borderWidth: 1,
  },
  particle: {
    position: 'absolute',
  },
  floatingText: {
    position: 'absolute',
    fontSize: 18,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  stoneContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stone: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  stoneEmoji: {
    fontSize: 20,
  },
  stoneLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  balanceIndicator: {
    position: 'absolute',
    top: -15,
    right: -10,
  },
  balanceText: {
    fontSize: 14,
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
    backgroundColor: 'rgba(26, 10, 2, 0.8)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    minWidth: 55,
  },
  hudLabel: {
    color: '#94A3B8',
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hudValue: {
    color: '#FDE68A',
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
  zenContainer: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(26, 10, 2, 0.6)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  zenBar: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  zenFill: {
    height: '100%',
    borderRadius: 2,
  },
  zenText: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '600',
  },
  statusContainer: {
    position: 'absolute',
    top: 130,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  statusText: {
    color: '#D97706',
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
    backgroundColor: 'rgba(26, 10, 2, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  controlText: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '500',
  },
  controlSubtext: {
    color: '#D97706',
    fontSize: 10,
    marginTop: 2,
  },
  glowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#D97706',
    pointerEvents: 'none',
  },
});

export default ZenGardenGame;