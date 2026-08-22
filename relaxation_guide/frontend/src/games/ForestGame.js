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

export const ForestGame = () => {
  const [fireflies, setFireflies] = useState([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [collected, setCollected] = useState(0);
  const [gameState, setGameState] = useState('playing');
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [moonlight, setMoonlight] = useState(1);
  const [stars, setStars] = useState([]);

  const glowAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const forestAnim = useRef(new Animated.Value(0)).current;

  const spawnTimer = useRef(null);
  const gameLoop = useRef(null);

  // Firefly types with different colors and behaviors
  const FIREFLY_TYPES = [
    { color: '#F59E0B', glow: '#FCD34D', points: 10, size: 20, speed: 0.5 },
    { color: '#10B981', glow: '#34D399', points: 15, size: 25, speed: 0.7 },
    { color: '#8B5CF6', glow: '#A78BFA', points: 20, size: 22, speed: 0.6 },
    { color: '#EC4899', glow: '#F472B6', points: 25, size: 18, speed: 0.8 },
    { color: '#3B82F6', glow: '#60A5FA', points: 30, size: 24, speed: 0.4 },
  ];

  // Create stars in the background
  useEffect(() => {
    const newStars = [];
    for (let i = 0; i < 50; i++) {
      newStars.push({
        id: i,
        x: Math.random() * width,
        y: Math.random() * height * 0.6,
        size: 1 + Math.random() * 2,
        opacity: 0.3 + Math.random() * 0.7,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
    setStars(newStars);
  }, []);

  // Create initial fireflies
  useEffect(() => {
    const initialFireflies = [];
    for (let i = 0; i < 6; i++) {
      initialFireflies.push(createFirefly(true));
    }
    setFireflies(initialFireflies);
  }, []);

  // Create falling leaves
  useEffect(() => {
    const leafInterval = setInterval(() => {
      if (leaves.length < 20) {
        const newLeaf = {
          id: Date.now() + Math.random(),
          x: Math.random() * width,
          y: -20,
          size: 8 + Math.random() * 12,
          speed: 0.5 + Math.random() * 1.5,
          wobble: Math.random() * 2 - 1,
          rotation: Math.random() * 360,
          color: `hsl(${120 + Math.random() * 40}, ${60 + Math.random() * 30}%, ${30 + Math.random() * 30}%)`,
          opacity: 0.4 + Math.random() * 0.4,
        };
        setLeaves(prev => [...prev, newLeaf]);
      }
    }, 1500);
    return () => clearInterval(leafInterval);
  }, [leaves.length]);

  // Create a new firefly
  const createFirefly = (isInitial = false) => {
    const type = FIREFLY_TYPES[Math.floor(Math.random() * FIREFLY_TYPES.length)];
    const size = type.size;
    const x = 30 + Math.random() * (width - 60 - size);
    const y = isInitial ? 50 + Math.random() * (height * 0.7 - 100) : -30 - Math.random() * 50;

    return {
      id: Date.now() + Math.random(),
      type,
      x,
      y,
      targetX: 30 + Math.random() * (width - 60 - size),
      targetY: 50 + Math.random() * (height * 0.7 - 100),
      size,
      speed: 0.2 + Math.random() * 0.3,
      opacity: 0.7 + Math.random() * 0.3,
      rotation: Math.random() * 360,
      active: true,
      glowIntensity: 0.5 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      isPopping: false,
    };
  };

  // Create particle explosion
  const createExplosion = (x, y, color, count = 30) => {
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
        color: color,
        gravity: 0.05 + Math.random() * 0.05,
        trail: [],
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Create floating text
  const createFloatingText = (x, y, text, color = '#FCD34D') => {
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

  // Collect firefly
  const collectFirefly = (firefly) => {
    if (firefly.isPopping) return;

    setFireflies(prev => prev.map(f =>
      f.id === firefly.id ? { ...f, isPopping: true } : f
    ));

    // Create explosion
    createExplosion(firefly.x + firefly.size / 2, firefly.y + firefly.size / 2, firefly.type.glow, 35);

    // Calculate score
    const comboBonus = Math.floor(combo / 3) + 1;
    const points = firefly.type.points * comboBonus;
    setScore(prev => prev + points);
    setCombo(prev => prev + 1);
    setCollected(prev => prev + 1);

    if (combo + 1 > maxCombo) {
      setMaxCombo(combo + 1);
    }

    // Floating text
    let text = `✨ +${points}`;
    if (combo > 0) {
      text += ` x${comboBonus}`;
    }
    createFloatingText(
      firefly.x + firefly.size / 2 - 30,
      firefly.y - 10,
      text,
      firefly.type.glow
    );

    // Combo milestones
    if (combo > 0 && combo % 5 === 0) {
      createFloatingText(
        firefly.x + firefly.size / 2 - 50,
        firefly.y - 50,
        `🔥 ${combo + 1}x COMBO!`,
        '#F59E0B'
      );

      // Spawn bonus fireflies
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const bonusFly = createFirefly();
          bonusFly.x = firefly.x + (Math.random() - 0.5) * 100;
          bonusFly.y = firefly.y + (Math.random() - 0.5) * 100;
          setFireflies(prev => [...prev, bonusFly]);
        }, i * 200);
      }
    }

    // Screen shake
    if (combo > 3) {
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

    // Glow pulse
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Remove firefly after animation
    setTimeout(() => {
      setFireflies(prev => prev.filter(f => f.id !== firefly.id));

      // Spawn new firefly
      if (gameState === 'playing') {
        setTimeout(() => {
          const newFly = createFirefly();
          setFireflies(prev => [...prev, newFly]);
        }, 1000 + Math.random() * 2000);
      }
    }, 300);
  };

  // Handle touch
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;

    // Check if touching a firefly
    const hitFirefly = fireflies.find(f =>
      !f.isPopping &&
      locationX > f.x && locationX < f.x + f.size &&
      locationY > f.y && locationY < f.y + f.size
    );

    if (hitFirefly) {
      collectFirefly(hitFirefly);
    } else {
      // Miss - create small effect
      createFloatingText(locationX - 20, locationY - 20, '🌿', '#34D399');
      setCombo(0);
    }
  };

  // Game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update fireflies
      setFireflies(prev => prev.map(f => {
        if (f.isPopping) return f;

        // Move towards target
        const dx = f.targetX - f.x;
        const dy = f.targetY - f.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
          // Set new target
          return {
            ...f,
            targetX: 30 + Math.random() * (width - 60 - f.size),
            targetY: 50 + Math.random() * (height * 0.7 - 100),
            phase: f.phase + 0.1,
          };
        }

        // Wobble movement
        const wobbleX = Math.sin(f.phase + Date.now() * 0.001) * 0.5;
        const wobbleY = Math.cos(f.phase + Date.now() * 0.001) * 0.5;

        return {
          ...f,
          x: f.x + (dx / dist) * f.speed * 0.5 + wobbleX,
          y: f.y + (dy / dist) * f.speed * 0.5 + wobbleY,
          rotation: f.rotation + 0.5,
          glowIntensity: 0.5 + Math.sin(Date.now() * 0.003 + f.phase) * 0.3,
        };
      }));

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

      // Update leaves
      setLeaves(prev => prev.map(l => ({
        ...l,
        y: l.y + l.speed,
        x: l.x + Math.sin(Date.now() * 0.001 + l.wobble) * 0.5,
        rotation: l.rotation + 0.5,
      })).filter(l => l.y < height + 20));

      // Update moonlight
      setMoonlight(0.8 + Math.sin(Date.now() * 0.0001) * 0.2);

      // Spawn new fireflies if needed
      setFireflies(prev => {
        const active = prev.filter(f => !f.isPopping);
        if (active.length < 4 + Math.floor(collected / 10) && gameState === 'playing') {
          if (Math.random() < 0.02) {
            const newFly = createFirefly();
            return [...prev, newFly];
          }
        }
        return prev;
      });

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, [collected, gameState]);

  // Reset game
  const resetGame = () => {
    setFireflies([]);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setCollected(0);
    setParticles([]);
    setFloatingTexts([]);
    setGameState('playing');

    // Spawn initial fireflies
    setTimeout(() => {
      const newFireflies = [];
      for (let i = 0; i < 6; i++) {
        newFireflies.push(createFirefly(true));
      }
      setFireflies(newFireflies);
    }, 500);
  };

  // Get forest mood
  const getForestMood = () => {
    if (collected < 10) return '🌙 Night';
    if (collected < 30) return '🌿 Awakening';
    if (collected < 60) return '🌳 Alive';
    if (collected < 100) return '🌲 Mystical';
    return '✨ Enchanted';
  };

  return (
    <TouchableWithoutFeedback onPress={handleTouch}>
      <Animated.View style={[
        styles.container,
        { transform: [{ translateX: shakeAnim }] }
      ]}>
        {/* Background gradient */}
        <View style={styles.bgGradient} />

        {/* Stars */}
        {stars.map(star => (
          <View
            key={star.id}
            style={[
              styles.star,
              {
                left: star.x,
                top: star.y,
                width: star.size,
                height: star.size,
                opacity: star.opacity * (0.7 + Math.sin(Date.now() * 0.001 + star.twinkle) * 0.3),
                borderRadius: star.size / 2,
              }
            ]}
          />
        ))}

        {/* Moonlight effect */}
        <View style={[styles.moonlight, { opacity: moonlight * 0.3 }]} />

        {/* Falling leaves */}
        {leaves.map(leaf => (
          <Animated.View
            key={leaf.id}
            style={[
              styles.leaf,
              {
                left: leaf.x - leaf.size / 2,
                top: leaf.y - leaf.size / 2,
                width: leaf.size,
                height: leaf.size * 0.6,
                backgroundColor: leaf.color,
                opacity: leaf.opacity,
                transform: [{ rotate: `${leaf.rotation}deg` }],
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
                shadowOpacity: 0.5,
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

        {/* Fireflies */}
        {fireflies.map(f => (
          <Animated.View
            key={f.id}
            style={[
              styles.fireflyContainer,
              {
                left: f.x,
                top: f.y,
                width: f.size,
                height: f.size,
                transform: [
                  { rotate: `${f.rotation}deg` },
                  { scale: f.isPopping ? 0.1 : 1 },
                ],
              }
            ]}
          >
            <View style={[
              styles.fireflyGlow,
              {
                backgroundColor: f.type.color,
                opacity: f.glowIntensity * 0.8,
                width: f.size * 1.5,
                height: f.size * 1.5,
                borderRadius: f.size * 0.75,
              }
            ]} />
            <View style={[
              styles.fireflyBody,
              {
                backgroundColor: f.type.color,
                width: f.size * 0.6,
                height: f.size * 0.6,
                borderRadius: f.size * 0.3,
                borderColor: f.type.glow,
              }
            ]}>
              <View style={[styles.fireflyInner, { backgroundColor: f.type.glow }]} />
            </View>
          </Animated.View>
        ))}

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>✨ FIREFLIES</Text>
            <Text style={styles.hudValue}>{collected}</Text>
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

        {/* Forest mood */}
        <View style={styles.moodContainer}>
          <Text style={styles.moodText}>{getForestMood()}</Text>
          <Text style={styles.moodSubtext}>🌲 Forest Spirit Level {Math.floor(collected / 10) + 1}</Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlText}>
              👆 Tap fireflies to collect their light
            </Text>
            <Text style={styles.controlSubtext}>
              Each firefly has different value • Build combos for bonuses
            </Text>
          </View>
        </View>

        {/* Glow overlay */}
        <Animated.View style={[
          styles.glowOverlay,
          {
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.3],
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
    backgroundColor: '#064E3B',
    overflow: 'hidden',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at center, #065F46 0%, #064E3B 50%, #022C22 100%)',
  },
  star: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
  moonlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at 30% 20%, #60A5FA 0%, transparent 70%)',
  },
  leaf: {
    position: 'absolute',
    borderRadius: 2,
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
  fireflyContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fireflyGlow: {
    position: 'absolute',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  fireflyBody: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  fireflyInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
    backgroundColor: 'rgba(6, 78, 59, 0.8)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    minWidth: 60,
  },
  hudLabel: {
    color: '#6EE7B7',
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hudValue: {
    color: '#FFFFFF',
    fontSize: 16,
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
  moodContainer: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(6, 78, 59, 0.6)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  moodText: {
    color: '#A7F3D0',
    fontSize: 14,
    fontWeight: 'bold',
  },
  moodSubtext: {
    color: '#6EE7B7',
    fontSize: 10,
    marginTop: 2,
  },
  controls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  controlGroup: {
    backgroundColor: 'rgba(6, 78, 59, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  controlText: {
    color: '#A7F3D0',
    fontSize: 12,
    fontWeight: '500',
  },
  controlSubtext: {
    color: '#6EE7B7',
    fontSize: 10,
    marginTop: 2,
  },
  glowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FCD34D',
    pointerEvents: 'none',
  },
});

export default ForestGame;