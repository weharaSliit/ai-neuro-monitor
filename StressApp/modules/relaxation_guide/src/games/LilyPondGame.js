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

export const LilyPondGame = () => {
  const [lilies, setLilies] = useState([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [totalBlooms, setTotalBlooms] = useState(0);
  const [gameState, setGameState] = useState('playing');
  const [pondRipples, setPondRipples] = useState([]);
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [frogs, setFrogs] = useState([]);
  const [dragonflies, setDragonflies] = useState([]);
  const [waterLilies, setWaterLilies] = useState([]);

  const waterAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const spawnTimer = useRef(null);
  const gameLoop = useRef(null);

  // Lily types with different properties
  const LILY_TYPES = [
    { emoji: '🪷', color: '#F472B6', points: 15, growthRate: 0.8, maxSize: 90 },
    { emoji: '🌸', color: '#EC4899', points: 20, growthRate: 1, maxSize: 80 },
    { emoji: '🌺', color: '#F43F5E', points: 25, growthRate: 1.2, maxSize: 70 },
    { emoji: '🌷', color: '#EF4444', points: 30, growthRate: 0.7, maxSize: 85 },
    { emoji: '🌻', color: '#F59E0B', points: 35, growthRate: 1.1, maxSize: 75 },
  ];

  // Create initial lilies
  useEffect(() => {
    const initialLilies = [];
    for (let i = 0; i < 5; i++) {
      initialLilies.push(createLily(true));
    }
    setLilies(initialLilies);
  }, []);

  // Create water lilies (background decoration)
  useEffect(() => {
    const waterLilyInterval = setInterval(() => {
      if (waterLilies.length < 15) {
        const newLily = {
          id: Date.now() + Math.random(),
          x: Math.random() * width,
          y: Math.random() * height * 0.8,
          size: 15 + Math.random() * 20,
          opacity: 0.1 + Math.random() * 0.2,
          rotation: Math.random() * 360,
          emoji: ['🪷', '🌿', '🍃', '☘️'][Math.floor(Math.random() * 4)],
        };
        setWaterLilies(prev => [...prev, newLily]);
      }
    }, 5000);
    return () => clearInterval(waterLilyInterval);
  }, [waterLilies.length]);

  // Create frogs
  useEffect(() => {
    const frogInterval = setInterval(() => {
      if (frogs.length < 3) {
        const newFrog = {
          id: Date.now() + Math.random(),
          x: Math.random() * width,
          y: Math.random() * height * 0.7,
          targetX: Math.random() * width,
          targetY: Math.random() * height * 0.7,
          size: 25 + Math.random() * 10,
          rotation: 0,
          jumpProgress: 0,
          color: `hsl(${120 + Math.random() * 40}, ${60 + Math.random() * 30}%, ${30 + Math.random() * 30}%)`,
          phase: Math.random() * Math.PI * 2,
        };
        setFrogs(prev => [...prev, newFrog]);
      }
    }, 4000);
    return () => clearInterval(frogInterval);
  }, [frogs.length]);

  // Create dragonflies
  useEffect(() => {
    const dragonflyInterval = setInterval(() => {
      if (dragonflies.length < 5) {
        const newDragonfly = {
          id: Date.now() + Math.random(),
          x: Math.random() * width,
          y: 50 + Math.random() * (height * 0.5),
          targetX: Math.random() * width,
          targetY: 50 + Math.random() * (height * 0.5),
          size: 12 + Math.random() * 8,
          wingAngle: 0,
          color: `hsl(${200 + Math.random() * 40}, 80%, 60%)`,
          speed: 1 + Math.random() * 2,
        };
        setDragonflies(prev => [...prev, newDragonfly]);
      }
    }, 3000);
    return () => clearInterval(dragonflyInterval);
  }, [dragonflies.length]);

  // Create a new lily
  const createLily = (isInitial = false) => {
    const type = LILY_TYPES[Math.floor(Math.random() * LILY_TYPES.length)];
    const size = 30 + Math.random() * 20;
    const x = 30 + Math.random() * (width - 60 - size);
    const y = isInitial ? 50 + Math.random() * (height * 0.7 - 100) : -30 - Math.random() * 50;

    return {
      id: Date.now() + Math.random(),
      type,
      x,
      y,
      size,
      targetSize: type.maxSize,
      growthProgress: 0,
      rotation: Math.random() * 360,
      opacity: 0.7 + Math.random() * 0.3,
      isGrowing: false,
      isFull: false,
      phase: Math.random() * Math.PI * 2,
    };
  };

  // Create water ripples
  const createRipple = (x, y) => {
    setPondRipples(prev => [...prev, {
      id: Date.now() + Math.random(),
      x,
      y,
      radius: 10,
      opacity: 1,
      maxRadius: 50 + Math.random() * 50,
    }]);
  };

  // Create particle effect
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
        color: color || `hsl(${320 + Math.random() * 40}, 80%, 70%)`,
        gravity: 0.05,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Create floating text
  const createFloatingText = (x, y, text, color = '#F472B6') => {
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

  // Grow lily on tap
  const growLily = (lily) => {
    if (lily.isFull || gameState === 'paused') return;

    // Update lily
    setLilies(prev => prev.map(l => {
      if (l.id === lily.id) {
        const newSize = l.size + l.type.growthRate * 5;
        const isFull = newSize >= l.type.maxSize;
        return {
          ...l,
          size: Math.min(newSize, l.type.maxSize),
          isFull,
          growthProgress: Math.min(newSize / l.type.maxSize, 1),
        };
      }
      return l;
    }));

    // Create ripple effect
    createRipple(lily.x + lily.size / 2, lily.y + lily.size / 2);

    // Calculate score
    const comboBonus = Math.floor(combo / 3) + 1;
    const points = lily.type.points * comboBonus;
    setScore(prev => prev + points);
    setCombo(prev => prev + 1);
    setTotalBlooms(prev => prev + 1);

    if (combo + 1 > maxCombo) {
      setMaxCombo(combo + 1);
    }

    // Floating text
    let text = `+${points}`;
    if (combo > 0) {
      text += ` x${comboBonus}`;
    }
    createFloatingText(
      lily.x + lily.size / 2 - 30,
      lily.y - 10,
      text,
      lily.type.color
    );

    // Combo milestones
    if (combo > 0 && combo % 5 === 0) {
      createFloatingText(
        lily.x + lily.size / 2 - 50,
        lily.y - 50,
        `🌸 ${combo + 1}x BLOOM!`,
        '#FCD34D'
      );

      // Spawn bonus lilies
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const bonusLily = createLily();
          bonusLily.x = lily.x + (Math.random() - 0.5) * 150;
          bonusLily.y = lily.y + (Math.random() - 0.5) * 150;
          setLilies(prev => [...prev, bonusLily]);
        }, i * 300);
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

    // Check if lily is full - spawn new one
    const updatedLily = lilies.find(l => l.id === lily.id);
    if (updatedLily && updatedLily.isFull) {
      // Remove after celebration
      setTimeout(() => {
        setLilies(prev => prev.filter(l => l.id !== lily.id));

        // Spawn new lily
        setTimeout(() => {
          const newLily = createLily();
          setLilies(prev => [...prev, newLily]);
        }, 500);
      }, 1000);
    }
  };

  // Handle touch
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;

    // Check if touching a lily
    const hitLily = lilies.find(l =>
      locationX > l.x && locationX < l.x + l.size &&
      locationY > l.y && locationY < l.y + l.size
    );

    if (hitLily) {
      growLily(hitLily);
    } else {
      // Miss - create ripple on water
      createRipple(locationX, locationY);
      createFloatingText(locationX - 20, locationY - 20, '💧', '#60A5FA');
      setCombo(0);
    }
  };

  // Game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update water animation
      waterAnim.setValue(Math.sin(Date.now() * 0.001) * 2);

      // Update lilies - gentle floating
      setLilies(prev => prev.map(l => ({
        ...l,
        y: l.y + Math.sin(Date.now() * 0.001 + l.phase) * 0.1,
        rotation: l.rotation + 0.1,
      })));

      // Update ripples
      setPondRipples(prev => prev.map(r => ({
        ...r,
        radius: r.radius + 0.5,
        opacity: r.opacity - 0.01,
      })).filter(r => r.opacity > 0));

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

      // Update frogs - jump animation
      setFrogs(prev => prev.map(f => {
        const dx = f.targetX - f.x;
        const dy = f.targetY - f.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 10) {
          return {
            ...f,
            targetX: Math.random() * width,
            targetY: 50 + Math.random() * (height * 0.7),
            jumpProgress: 0,
          };
        }

        return {
          ...f,
          x: f.x + (dx / dist) * 0.5,
          y: f.y + (dy / dist) * 0.5,
          rotation: Math.atan2(dy, dx),
          jumpProgress: (f.jumpProgress + 0.02) % (Math.PI * 2),
        };
      }));

      // Update dragonflies
      setDragonflies(prev => prev.map(d => {
        const dx = d.targetX - d.x;
        const dy = d.targetY - d.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
          return {
            ...d,
            targetX: Math.random() * width,
            targetY: 50 + Math.random() * (height * 0.5),
          };
        }

        return {
          ...d,
          x: d.x + (dx / dist) * d.speed * 0.3,
          y: d.y + (dy / dist) * d.speed * 0.3,
          wingAngle: (d.wingAngle + 0.3) % (Math.PI * 2),
        };
      }));

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, []);

  // Spawn new lilies
  useEffect(() => {
    spawnTimer.current = setInterval(() => {
      if (lilies.length < 7 + Math.floor(totalBlooms / 20)) {
        const newLily = createLily();
        setLilies(prev => [...prev, newLily]);
      }
    }, 5000);

    return () => clearInterval(spawnTimer.current);
  }, [totalBlooms]);

  return (
    <TouchableWithoutFeedback onPress={handleTouch}>
      <Animated.View style={[
        styles.container,
        { transform: [{ translateX: shakeAnim }] }
      ]}>
        {/* Water background animation */}
        <Animated.View style={[
          styles.waterBackground,
          {
            transform: [
              { translateY: waterAnim },
            ]
          }
        ]} />

        {/* Water lilies (decorative background) */}
        {waterLilies.map(l => (
          <View
            key={l.id}
            style={[
              styles.waterLilyDeco,
              {
                left: l.x,
                top: l.y,
                width: l.size,
                height: l.size,
                opacity: l.opacity,
                transform: [{ rotate: `${l.rotation}deg` }],
              }
            ]}
          >
            <Text style={{ fontSize: l.size }}>{l.emoji}</Text>
          </View>
        ))}

        {/* Dragonflies */}
        {dragonflies.map(d => (
          <View
            key={d.id}
            style={[
              styles.dragonfly,
              {
                left: d.x - d.size / 2,
                top: d.y - d.size / 2,
                width: d.size * 1.5,
                height: d.size,
              }
            ]}
          >
            <View style={[
              styles.dragonflyWing,
              {
                backgroundColor: d.color,
                transform: [{ scaleX: Math.sin(d.wingAngle) }],
              }
            ]} />
            <View style={[
              styles.dragonflyWing,
              {
                backgroundColor: d.color,
                transform: [{ scaleX: Math.cos(d.wingAngle) }],
              }
            ]} />
            <View style={[styles.dragonflyBody, { backgroundColor: d.color }]} />
          </View>
        ))}

        {/* Frogs */}
        {frogs.map(f => (
          <View
            key={f.id}
            style={[
              styles.frog,
              {
                left: f.x - f.size / 2,
                top: f.y - f.size / 2 - Math.sin(f.jumpProgress) * 20,
                width: f.size,
                height: f.size,
                transform: [{ rotate: `${f.rotation}rad` }],
              }
            ]}
          >
            <View style={[styles.frogBody, { backgroundColor: f.color }]}>
              <View style={styles.frogEyes}>
                <View style={styles.frogEye} />
                <View style={styles.frogEye} />
              </View>
            </View>
          </View>
        ))}

        {/* Pond ripples */}
        {pondRipples.map(r => (
          <Animated.View
            key={r.id}
            style={[
              styles.ripple,
              {
                left: r.x - r.radius / 2,
                top: r.y - r.radius / 2,
                width: r.radius * 2,
                height: r.radius * 2,
                borderRadius: r.radius,
                opacity: r.opacity * 0.5,
                borderWidth: 2,
                borderColor: `rgba(255, 255, 255, ${r.opacity * 0.5})`,
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

        {/* Lilies */}
        {lilies.map(l => (
          <Animated.View
            key={l.id}
            style={[
              styles.lilyContainer,
              {
                left: l.x,
                top: l.y - (l.size * 0.1),
                width: l.size,
                height: l.size,
                transform: [
                  { rotate: `${l.rotation}deg` },
                  { scale: l.isFull ? 1.1 : 1 },
                ],
              }
            ]}
          >
            <View style={[
              styles.lilyPad,
              {
                width: l.size,
                height: l.size * 0.5,
                borderRadius: l.size * 0.25,
                backgroundColor: l.isFull ? l.type.color : 'rgba(25, 135, 84, 0.4)',
                borderColor: l.isFull ? l.type.color : '#20C997',
                opacity: l.opacity,
              }
            ]}>
              <Text style={[
                styles.lilyEmoji,
                {
                  fontSize: l.size * 0.5,
                  transform: [{ scale: l.isFull ? 1.2 : 1 }],
                }
              ]}>
                {l.type.emoji}
              </Text>

              {/* Growth indicator */}
              {!l.isFull && (
                <View style={styles.growthIndicator}>
                  <View style={[
                    styles.growthFill,
                    {
                      width: `${l.growthProgress * 100}%`,
                      backgroundColor: l.type.color,
                    }
                  ]} />
                </View>
              )}
            </View>
          </Animated.View>
        ))}

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>🪷 BLOOMS</Text>
            <Text style={styles.hudValue}>{totalBlooms}</Text>
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

        {/* Pond status */}
        <View style={styles.pondStatus}>
          <Text style={styles.pondStatusText}>
            {lilies.length < 3 ? '🌱 Pond awakening...' :
              lilies.length < 5 ? '🌸 Lilies blooming' :
                lilies.length < 8 ? '🪷 Peaceful pond' :
                  '🌺 Magical garden'}
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlText}>
              👆 Tap lily pads to help them grow
            </Text>
            <Text style={styles.controlSubtext}>
              Each tap makes them bloom • Build combos for bonuses
            </Text>
          </View>
        </View>

        {/* Glow overlay */}
        <Animated.View style={[
          styles.glowOverlay,
          {
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.2],
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
    backgroundColor: '#0F5132',
    overflow: 'hidden',
  },
  waterBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at center, #0D6E3E 0%, #0F5132 50%, #064E3B 100%)',
  },
  waterLilyDeco: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dragonfly: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dragonflyWing: {
    position: 'absolute',
    width: '60%',
    height: '40%',
    borderRadius: 10,
    opacity: 0.6,
  },
  dragonflyBody: {
    position: 'absolute',
    width: '20%',
    height: '60%',
    borderRadius: 4,
  },
  frog: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  frogBody: {
    width: '100%',
    height: '100%',
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frogEyes: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '60%',
    marginTop: -10,
  },
  frogEye: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  ripple: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
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
  lilyContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lilyPad: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#20C997',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  lilyEmoji: {
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  growthIndicator: {
    position: 'absolute',
    bottom: -8,
    width: '80%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  growthFill: {
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
    flexWrap: 'wrap',
  },
  hudItem: {
    backgroundColor: 'rgba(15, 81, 50, 0.8)',
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
  pondStatus: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(15, 81, 50, 0.6)',
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  pondStatusText: {
    color: '#A7F3D0',
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
    backgroundColor: 'rgba(15, 81, 50, 0.8)',
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
    backgroundColor: '#F472B6',
    pointerEvents: 'none',
  },
});

export default LilyPondGame;