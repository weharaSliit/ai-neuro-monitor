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

export const OceanGame = () => {
  const [bubbles, setBubbles] = useState([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [collected, setCollected] = useState(0);
  const [gameState, setGameState] = useState('playing');
  const [fish, setFish] = useState([]);
  const [jellyfish, setJellyfish] = useState([]);
  const [seaweed, setSeaweed] = useState([]);
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [lightRays, setLightRays] = useState([]);

  const waveAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const depthAnim = useRef(new Animated.Value(0)).current;

  const spawnTimer = useRef(null);
  const gameLoop = useRef(null);

  // Bubble types with different properties
  const BUBBLE_TYPES = [
    { emoji: '🫧', color: '#7DD3FC', points: 10, size: 30, speed: 0.5 },
    { emoji: '🐠', color: '#FCD34D', points: 15, size: 35, speed: 0.7 },
    { emoji: '🐟', color: '#F472B6', points: 20, size: 32, speed: 0.6 },
    { emoji: '🐡', color: '#34D399', points: 25, size: 38, speed: 0.4 },
    { emoji: '🐙', color: '#A78BFA', points: 30, size: 40, speed: 0.3 },
  ];

  // Create initial bubbles
  useEffect(() => {
    const initialBubbles = [];
    for (let i = 0; i < 8; i++) {
      initialBubbles.push(createBubble(true));
    }
    setBubbles(initialBubbles);
  }, []);

  // Create light rays
  useEffect(() => {
    const newRays = [];
    for (let i = 0; i < 8; i++) {
      newRays.push({
        id: i,
        x: Math.random() * width,
        width: 20 + Math.random() * 30,
        opacity: 0.1 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
    setLightRays(newRays);
  }, []);

  // Create fish
  useEffect(() => {
    const fishInterval = setInterval(() => {
      if (fish.length < 6) {
        const newFish = {
          id: Date.now() + Math.random(),
          x: -50 - Math.random() * 100,
          y: 50 + Math.random() * (height * 0.7),
          size: 20 + Math.random() * 15,
          speed: 1 + Math.random() * 2,
          color: `hsl(${200 + Math.random() * 40}, 70%, ${50 + Math.random() * 30}%)`,
          direction: 1,
          phase: Math.random() * Math.PI * 2,
        };
        setFish(prev => [...prev, newFish]);
      }
    }, 3000);
    return () => clearInterval(fishInterval);
  }, [fish.length]);

  // Create jellyfish
  useEffect(() => {
    const jellyInterval = setInterval(() => {
      if (jellyfish.length < 4) {
        const newJelly = {
          id: Date.now() + Math.random(),
          x: 50 + Math.random() * (width - 100),
          y: -30 - Math.random() * 50,
          size: 25 + Math.random() * 20,
          speed: 0.3 + Math.random() * 0.5,
          color: `hsl(${280 + Math.random() * 40}, 80%, ${60 + Math.random() * 30}%)`,
          phase: Math.random() * Math.PI * 2,
          tentacles: 4 + Math.floor(Math.random() * 4),
        };
        setJellyfish(prev => [...prev, newJelly]);
      }
    }, 5000);
    return () => clearInterval(jellyInterval);
  }, [jellyfish.length]);

  // Create seaweed
  useEffect(() => {
    const seaweedPlants = [];
    for (let i = 0; i < 12; i++) {
      seaweedPlants.push({
        id: i,
        x: Math.random() * width,
        height: 60 + Math.random() * 80,
        width: 8 + Math.random() * 12,
        color: `hsl(${140 + Math.random() * 40}, 70%, ${30 + Math.random() * 20}%)`,
        phase: Math.random() * Math.PI * 2,
        segments: 4 + Math.floor(Math.random() * 4),
      });
    }
    setSeaweed(seaweedPlants);
  }, []);

  // Create a new bubble
  const createBubble = (isInitial = false) => {
    const type = BUBBLE_TYPES[Math.floor(Math.random() * BUBBLE_TYPES.length)];
    const size = type.size * (0.8 + Math.random() * 0.4);
    const x = 30 + Math.random() * (width - 60 - size);
    const y = isInitial ? 50 + Math.random() * (height * 0.7 - 100) : height + 30 + Math.random() * 50;

    return {
      id: Date.now() + Math.random(),
      type,
      x,
      y,
      size,
      speed: type.speed * (0.8 + Math.random() * 0.4),
      opacity: 0.7 + Math.random() * 0.3,
      rotation: Math.random() * 360,
      phase: Math.random() * Math.PI * 2,
      isPopping: false,
      scale: 0.8 + Math.random() * 0.4,
    };
  };

  // Create particle explosion
  const createExplosion = (x, y, color, count = 30) => {
    const newParticles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 1 + Math.random() * 5;
      newParticles.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 2,
        life: 1,
        size: 2 + Math.random() * 6,
        color: color || `hsl(${200 + Math.random() * 40}, 80%, 70%)`,
        gravity: 0.02,
        bubble: true,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Create floating text
  const createFloatingText = (x, y, text, color = '#7DD3FC') => {
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

  // Pop bubble
  const popBubble = (bubble) => {
    if (bubble.isPopping || gameState === 'paused') return;

    setBubbles(prev => prev.map(b =>
      b.id === bubble.id ? { ...b, isPopping: true } : b
    ));

    // Create explosion
    createExplosion(bubble.x + bubble.size / 2, bubble.y + bubble.size / 2, bubble.type.color, 35);

    // Calculate score
    const comboBonus = Math.floor(combo / 3) + 1;
    const points = bubble.type.points * comboBonus;
    setScore(prev => prev + points);
    setCombo(prev => prev + 1);
    setCollected(prev => prev + 1);

    if (combo + 1 > maxCombo) {
      setMaxCombo(combo + 1);
    }

    // Floating text
    let text = `+${points}`;
    if (combo > 0) {
      text += ` x${comboBonus}`;
    }
    createFloatingText(
      bubble.x + bubble.size / 2 - 30,
      bubble.y - 10,
      text,
      bubble.type.color
    );

    // Combo milestones
    if (combo > 0 && combo % 5 === 0) {
      createFloatingText(
        bubble.x + bubble.size / 2 - 50,
        bubble.y - 50,
        `🌊 ${combo + 1}x COMBO!`,
        '#FCD34D'
      );

      // Spawn bonus bubbles
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const bonusBubble = createBubble();
          bonusBubble.x = bubble.x + (Math.random() - 0.5) * 150;
          bonusBubble.y = bubble.y + (Math.random() - 0.5) * 150;
          setBubbles(prev => [...prev, bonusBubble]);
        }, i * 200);
      }
    }

    // Screen shake
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

    // Glow pulse
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // Remove bubble after animation
    setTimeout(() => {
      setBubbles(prev => prev.filter(b => b.id !== bubble.id));

      // Spawn new bubble
      setTimeout(() => {
        const newBubble = createBubble();
        setBubbles(prev => [...prev, newBubble]);
      }, 500 + Math.random() * 1000);
    }, 300);
  };

  // Handle touch
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;

    // Check if touching a bubble
    const hitBubble = bubbles.find(b =>
      !b.isPopping &&
      locationX > b.x && locationX < b.x + b.size &&
      locationY > b.y && locationY < b.y + b.size
    );

    if (hitBubble) {
      popBubble(hitBubble);
    } else {
      // Miss - create ripple
      createExplosion(locationX, locationY, '#60A5FA', 10);
      createFloatingText(locationX - 20, locationY - 20, '💧', '#60A5FA');
      setCombo(0);
    }
  };

  // Game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update wave animation
      waveAnim.setValue(Math.sin(Date.now() * 0.001) * 5);
      depthAnim.setValue(Math.sin(Date.now() * 0.0005) * 3);

      // Update bubbles - float upward with wobble
      setBubbles(prev => prev.map(b => {
        if (b.isPopping) return b;
        return {
          ...b,
          y: b.y - b.speed * 0.5,
          x: b.x + Math.sin(b.phase + Date.now() * 0.001) * 0.3,
          rotation: b.rotation + 0.3,
        };
      }).filter(b => b.y > -50));

      // Update fish
      setFish(prev => prev.map(f => ({
        ...f,
        x: f.x + f.speed * f.direction,
        y: f.y + Math.sin(f.phase + Date.now() * 0.001) * 0.5,
      })).filter(f => f.x < width + 100));

      // Update jellyfish
      setJellyfish(prev => prev.map(j => ({
        ...j,
        y: j.y + j.speed * Math.sin(Date.now() * 0.001 + j.phase) * 0.5,
        x: j.x + Math.cos(Date.now() * 0.0005 + j.phase) * 0.2,
        phase: j.phase + 0.01,
      })).filter(j => j.y < height + 100));

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

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, []);

  // Spawn new bubbles
  useEffect(() => {
    spawnTimer.current = setInterval(() => {
      if (bubbles.length < 10 + Math.floor(collected / 20)) {
        const newBubble = createBubble();
        setBubbles(prev => [...prev, newBubble]);
      }
    }, 1500);

    return () => clearInterval(spawnTimer.current);
  }, [collected]);

  return (
    <TouchableWithoutFeedback onPress={handleTouch}>
      <Animated.View style={[
        styles.container,
        { transform: [{ translateX: shakeAnim }] }
      ]}>
        {/* Deep ocean gradient */}
        <View style={styles.oceanGradient}>
          <View style={[styles.oceanLayer, { backgroundColor: '#0C4A6E' }]} />
          <View style={[styles.oceanLayer, {
            backgroundColor: '#075985',
            transform: [{ translateY: depthAnim }],
          }]} />
        </View>

        {/* Light rays */}
        {lightRays.map(ray => (
          <View
            key={ray.id}
            style={[
              styles.lightRay,
              {
                left: ray.x,
                width: ray.width,
                opacity: ray.opacity * (0.7 + Math.sin(Date.now() * 0.0005 + ray.phase) * 0.3),
                transform: [
                  { rotate: `${-15 + Math.sin(Date.now() * 0.0003 + ray.id) * 5}deg` },
                ],
              }
            ]}
          />
        ))}

        {/* Seaweed */}
        {seaweed.map(plant => (
          <View
            key={plant.id}
            style={[
              styles.seaweed,
              {
                left: plant.x,
                bottom: 0,
                width: plant.width,
                height: plant.height * (0.8 + Math.sin(Date.now() * 0.001 + plant.phase) * 0.2),
                backgroundColor: plant.color,
                transform: [
                  { skewX: `${Math.sin(Date.now() * 0.001 + plant.phase) * 5}deg` },
                ],
              }
            ]}
          />
        ))}

        {/* Fish */}
        {fish.map(f => (
          <View
            key={f.id}
            style={[
              styles.fish,
              {
                left: f.x - f.size / 2,
                top: f.y - f.size / 2,
                width: f.size * 2,
                height: f.size,
                transform: [
                  { scaleX: f.direction },
                  { rotate: `${Math.sin(f.phase + Date.now() * 0.001) * 5}deg` },
                ],
              }
            ]}
          >
            <View style={[styles.fishBody, { backgroundColor: f.color }]}>
              <View style={[styles.fishTail, {
                borderLeftColor: f.color,
                transform: [{ rotate: `${Math.sin(Date.now() * 0.005 + f.phase) * 20}deg` }],
              }]} />
              <View style={styles.fishEye} />
            </View>
          </View>
        ))}

        {/* Jellyfish */}
        {jellyfish.map(j => (
          <View
            key={j.id}
            style={[
              styles.jellyfish,
              {
                left: j.x - j.size / 2,
                top: j.y - j.size / 2,
                width: j.size,
                height: j.size * 1.2,
                opacity: 0.7 + Math.sin(Date.now() * 0.002 + j.phase) * 0.3,
              }
            ]}
          >
            <View style={[styles.jellyfishDome, { backgroundColor: j.color }]}>
              {Array.from({ length: j.tentacles }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.jellyfishTentacle,
                    {
                      backgroundColor: j.color,
                      left: (i / j.tentacles) * 100,
                      height: j.size * (0.5 + Math.sin(Date.now() * 0.003 + j.phase + i) * 0.3),
                    }
                  ]}
                />
              ))}
            </View>
          </View>
        ))}

        {/* Bubbles */}
        {bubbles.map(b => (
          <Animated.View
            key={b.id}
            style={[
              styles.bubbleContainer,
              {
                left: b.x,
                top: b.y,
                width: b.size,
                height: b.size,
                opacity: b.opacity,
                transform: [
                  { rotate: `${b.rotation}deg` },
                  { scale: b.isPopping ? 0.1 : b.scale },
                ],
              }
            ]}
          >
            <View style={[
              styles.bubble,
              {
                width: b.size,
                height: b.size,
                borderRadius: b.size / 2,
                backgroundColor: `${b.type.color}40`,
                borderColor: b.type.color,
              }
            ]}>
              <Text style={[styles.bubbleEmoji, { fontSize: b.size * 0.5 }]}>
                {b.type.emoji}
              </Text>
              <View style={[styles.bubbleHighlight, {
                width: b.size * 0.3,
                height: b.size * 0.2,
                borderRadius: b.size * 0.15,
              }]} />
            </View>
          </Animated.View>
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

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>🫧 BUBBLES</Text>
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

        {/* Ocean depth indicator */}
        <View style={styles.depthIndicator}>
          <Text style={styles.depthText}>
            {collected < 10 ? '🌊 Shallows' :
              collected < 30 ? '🐠 Coral Reef' :
                collected < 60 ? '🐙 Deep Waters' :
                  collected < 100 ? '🐋 Ocean Depths' :
                    '✨ Abyssal Zone'}
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlText}>
              👆 Tap bubbles to release ocean magic
            </Text>
            <Text style={styles.controlSubtext}>
              Each bubble holds different treasures • Build combos for bonuses
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
    backgroundColor: '#0C4A6E',
    overflow: 'hidden',
  },
  oceanGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  oceanLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  lightRay: {
    position: 'absolute',
    top: -100,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    transform: [{ rotate: '-15deg' }],
  },
  seaweed: {
    position: 'absolute',
    borderRadius: 4,
    opacity: 0.6,
  },
  fish: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fishBody: {
    width: '100%',
    height: '60%',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  fishTail: {
    position: 'absolute',
    right: -20,
    top: -5,
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderRightWidth: 20,
    borderBottomWidth: 10,
    borderStyle: 'solid',
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  fishEye: {
    position: 'absolute',
    right: 10,
    top: 5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  jellyfish: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  jellyfishDome: {
    width: '100%',
    height: '50%',
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  jellyfishTentacle: {
    position: 'absolute',
    bottom: -10,
    width: 2,
    borderRadius: 2,
    opacity: 0.5,
  },
  bubbleContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bubble: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#7DD3FC',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  bubbleEmoji: {
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  bubbleHighlight: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
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
    backgroundColor: 'rgba(12, 74, 110, 0.8)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    minWidth: 60,
  },
  hudLabel: {
    color: '#7DD3FC',
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
  depthIndicator: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(12, 74, 110, 0.6)',
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  depthText: {
    color: '#BAE6FD',
    fontSize: 12,
    fontWeight: '600',
  },
  controls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  controlGroup: {
    backgroundColor: 'rgba(12, 74, 110, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  controlText: {
    color: '#BAE6FD',
    fontSize: 12,
    fontWeight: '500',
  },
  controlSubtext: {
    color: '#7DD3FC',
    fontSize: 10,
    marginTop: 2,
  },
  glowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#7DD3FC',
    pointerEvents: 'none',
  },
});

export default OceanGame;