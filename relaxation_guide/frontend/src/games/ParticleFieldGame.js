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

export const ParticleFieldGame = () => {
  const [particles, setParticles] = useState([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [totalCollected, setTotalCollected] = useState(0);
  const [gameState, setGameState] = useState('playing');
  const [trails, setTrails] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [energyBursts, setEnergyBursts] = useState([]);
  const [fieldStrength, setFieldStrength] = useState(1);

  const glowAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const fieldAnim = useRef(new Animated.Value(0)).current;

  const touchRef = useRef({ x: 0, y: 0 });
  const spawnTimer = useRef(null);
  const gameLoop = useRef(null);

  // Particle types with different properties
  const PARTICLE_TYPES = [
    { color: '#38BDF8', glow: '#7DD3FC', points: 10, size: 20, speed: 0.5 },
    { color: '#F472B6', glow: '#F9A8D4', points: 15, size: 22, speed: 0.7 },
    { color: '#34D399', glow: '#6EE7B7', points: 20, size: 18, speed: 0.6 },
    { color: '#F59E0B', glow: '#FCD34D', points: 25, size: 24, speed: 0.4 },
    { color: '#A78BFA', glow: '#C4B5FD', points: 30, size: 20, speed: 0.8 },
    { color: '#F43F5E', glow: '#FDA4AF', points: 35, size: 16, speed: 0.9 },
  ];

  // Create initial particles
  useEffect(() => {
    const initialParticles = [];
    for (let i = 0; i < 15; i++) {
      initialParticles.push(createParticle(true));
    }
    setParticles(initialParticles);
  }, []);

  // Create a new particle
  const createParticle = (isInitial = false) => {
    const type = PARTICLE_TYPES[Math.floor(Math.random() * PARTICLE_TYPES.length)];
    const size = type.size * (0.8 + Math.random() * 0.4);
    const x = 30 + Math.random() * (width - 60 - size);
    const y = isInitial ? 50 + Math.random() * (height * 0.7 - 100) : -30 - Math.random() * 50;

    return {
      id: Date.now() + Math.random(),
      type,
      x,
      y,
      targetX: x,
      targetY: y,
      size,
      speed: type.speed * (0.5 + Math.random() * 0.5),
      opacity: 0.6 + Math.random() * 0.4,
      rotation: Math.random() * 360,
      phase: Math.random() * Math.PI * 2,
      isCollected: false,
      scale: 0.5 + Math.random() * 0.5,
      pulse: Math.random() * Math.PI * 2,
      trail: [],
    };
  };

  // Create trail effect
  const createTrail = (x, y, color) => {
    setTrails(prev => [...prev, {
      id: Date.now() + Math.random(),
      x,
      y,
      color,
      opacity: 1,
      size: 4 + Math.random() * 8,
      life: 1,
    }]);
  };

  // Create energy burst
  const createEnergyBurst = (x, y, color, count = 40) => {
    const newBursts = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 50 + Math.random() * 150;
      newBursts.push({
        id: Date.now() + Math.random(),
        x,
        y,
        targetX: x + Math.cos(angle) * distance,
        targetY: y + Math.sin(angle) * distance,
        size: 2 + Math.random() * 6,
        color: color,
        progress: 0,
        speed: 0.02 + Math.random() * 0.03,
        rotation: Math.random() * 360,
      });
    }
    setEnergyBursts(prev => [...prev, ...newBursts]);
  };

  // Create floating text
  const createFloatingText = (x, y, text, color = '#FFFFFF') => {
    setFloatingTexts(prev => [...prev, {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${Math.random()}`,
      x,
      y,
      text,
      color,
      opacity: 1,
      vy: -2 - Math.random() * 1.5,
      scale: 1,
      rotation: (Math.random() - 0.5) * 20,
    }]);
  };

  // Collect particle
  const collectParticle = (particle) => {
    if (particle.isCollected) return;

    setParticles(prev => prev.map(p =>
      p.id === particle.id ? { ...p, isCollected: true } : p
    ));

    // Create energy burst
    createEnergyBurst(particle.x + particle.size / 2, particle.y + particle.size / 2, particle.type.color, 50);

    // Create trail
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        createTrail(
          particle.x + Math.random() * particle.size,
          particle.y + Math.random() * particle.size,
          particle.type.color
        );
      }, i * 20);
    }

    // Calculate score
    const comboBonus = Math.floor(combo / 3) + 1;
    const points = particle.type.points * comboBonus * fieldStrength;
    setScore(prev => prev + points);
    setCombo(prev => prev + 1);
    setTotalCollected(prev => prev + 1);
    setFieldStrength(prev => Math.min(prev + 0.01, 3));

    if (combo + 1 > maxCombo) {
      setMaxCombo(combo + 1);
    }

    // Floating text
    let text = `+${Math.round(points)}`;
    if (combo > 0) {
      text += ` x${comboBonus}`;
    }
    if (fieldStrength > 1.5) {
      text += ` ⚡`;
    }
    createFloatingText(
      particle.x + particle.size / 2 - 30,
      particle.y - 10,
      text,
      particle.type.color
    );

    // Combo milestones
    if (combo > 0 && combo % 5 === 0) {
      createFloatingText(
        particle.x + particle.size / 2 - 50,
        particle.y - 50,
        `✨ ${combo + 1}x COMBO!`,
        '#FCD34D'
      );

      // Spawn bonus particles
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          const bonusParticle = createParticle();
          bonusParticle.x = particle.x + (Math.random() - 0.5) * 200;
          bonusParticle.y = particle.y + (Math.random() - 0.5) * 200;
          setParticles(prev => [...prev, bonusParticle]);
        }, i * 100);
      }
    }

    // Screen shake
    if (combo > 3) {
      Animated.sequence([
        Animated.timing(shakeAnim, {
          toValue: 4,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: -4,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 2,
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
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();

    // Remove particle after animation
    setTimeout(() => {
      setParticles(prev => prev.filter(p => p.id !== particle.id));

      // Spawn new particle
      setTimeout(() => {
        const newParticle = createParticle();
        setParticles(prev => [...prev, newParticle]);
      }, 500 + Math.random() * 1000);
    }, 400);
  };

  // Handle touch
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;
    touchRef.current = { x: locationX, y: locationY };

    // Create touch ripple effect
    createTrail(locationX, locationY, '#38BDF8');
    createEnergyBurst(locationX, locationY, '#60A5FA', 15);

    // Attract particles towards touch point
    setParticles(prev => prev.map(p => {
      if (p.isCollected) return p;

      const dx = locationX - (p.x + p.size / 2);
      const dy = locationY - (p.y + p.size / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 150) {
        const attraction = Math.max(0, 1 - dist / 150) * 5;
        return {
          ...p,
          x: p.x + (dx / dist) * attraction,
          y: p.y + (dy / dist) * attraction,
          scale: p.scale + Math.max(0, 1 - dist / 150) * 0.1,
        };
      }
      return p;
    }));

    // Check for collected particles
    const collected = particles.find(p =>
      !p.isCollected &&
      locationX > p.x && locationX < p.x + p.size &&
      locationY > p.y && locationY < p.y + p.size
    );

    if (collected) {
      collectParticle(collected);
    } else {
      // Miss effect
      createFloatingText(locationX - 20, locationY - 20, '⚡', '#60A5FA');
      setCombo(0);
    }
  };

  // Pan responder for drag
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (evt, gestureState) => {
      const { locationX, locationY } = evt.nativeEvent;
      touchRef.current = { x: locationX, y: locationY };

      // Create trail
      createTrail(locationX, locationY, '#7DD3FC');

      // Attract particles
      setParticles(prev => prev.map(p => {
        if (p.isCollected) return p;

        const dx = locationX - (p.x + p.size / 2);
        const dy = locationY - (p.y + p.size / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 200) {
          const attraction = Math.max(0, 1 - dist / 200) * 3;
          return {
            ...p,
            x: p.x + (dx / dist) * attraction,
            y: p.y + (dy / dist) * attraction,
            scale: p.scale + Math.max(0, 1 - dist / 200) * 0.05,
          };
        }
        return p;
      }));
    },
  });

  // Game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update particles - float and pulse
      setParticles(prev => prev.map(p => {
        if (p.isCollected) return p;

        // Gentle floating motion
        const floatX = Math.sin(p.phase + Date.now() * 0.001) * 0.2;
        const floatY = Math.cos(p.phase + Date.now() * 0.001) * 0.2;

        return {
          ...p,
          x: p.x + floatX,
          y: p.y + floatY,
          rotation: p.rotation + 0.3,
          pulse: p.pulse + 0.02,
          scale: p.scale * (0.999 + Math.sin(p.pulse) * 0.001),
        };
      }));

      // Update trails
      setTrails(prev => prev.map(t => ({
        ...t,
        opacity: t.opacity - 0.02,
        size: t.size * 0.99,
        life: t.life - 0.02,
      })).filter(t => t.life > 0));

      // Update energy bursts
      setEnergyBursts(prev => {
        const updated = prev.map(b => ({
          ...b,
          x: b.x + (b.targetX - b.x) * b.speed,
          y: b.y + (b.targetY - b.y) * b.speed,
          progress: b.progress + b.speed,
          rotation: b.rotation + 2,
          size: b.size * (1 - b.progress * 0.3),
        }));
        return updated.filter(b => b.progress < 1);
      });

      // Update floating texts
      setFloatingTexts(prev => {
        const updated = prev.map(t => ({
          ...t,
          y: t.y + t.vy,
          opacity: t.opacity - 0.02,
          scale: t.scale + 0.01,
          rotation: t.rotation * 0.99,
        }));
        return updated.filter(t => t.opacity > 0);
      });

      // Pulse field animation
      fieldAnim.setValue(Math.sin(Date.now() * 0.001) * 0.5 + 0.5);

      // Decrease field strength over time
      if (fieldStrength > 1) {
        setFieldStrength(prev => Math.max(1, prev - 0.001));
      }

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, [fieldStrength]);

  // Spawn new particles
  useEffect(() => {
    spawnTimer.current = setInterval(() => {
      if (particles.length < 20 + Math.floor(totalCollected / 10)) {
        const newParticle = createParticle();
        setParticles(prev => [...prev, newParticle]);
      }
    }, 2000);

    return () => clearInterval(spawnTimer.current);
  }, [totalCollected]);

  return (
    <TouchableWithoutFeedback onPress={handleTouch} {...panResponder.panHandlers}>
      <Animated.View style={[
        styles.container,
        { transform: [{ translateX: shakeAnim }] }
      ]}>
        {/* Background gradient with pulse */}
        <View style={styles.bgGradient}>
          <Animated.View style={[
            styles.fieldPulse,
            {
              opacity: fieldAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.1, 0.3],
              }),
            }
          ]} />
        </View>

        {/* Grid lines for depth */}
        <View style={styles.gridContainer}>
          {Array.from({ length: 10 }).map((_, i) => (
            <View key={i} style={[styles.gridLine, {
              top: (i / 10) * height,
              opacity: 0.05 + (i / 10) * 0.05,
            }]} />
          ))}
          {Array.from({ length: 10 }).map((_, i) => (
            <View key={i} style={[styles.gridLineVertical, {
              left: (i / 10) * width,
              opacity: 0.05 + (i / 10) * 0.05,
            }]} />
          ))}
        </View>

        {/* Trails */}
        {trails.map(t => (
          <View
            key={t.id}
            style={[
              styles.trail,
              {
                left: t.x - t.size / 2,
                top: t.y - t.size / 2,
                width: t.size,
                height: t.size,
                backgroundColor: t.color,
                opacity: t.opacity * 0.5,
                borderRadius: t.size / 2,
              }
            ]}
          />
        ))}

        {/* Energy Bursts */}
        {energyBursts.map(b => (
          <Animated.View
            key={b.id}
            style={[
              styles.energyBurst,
              {
                left: b.x - b.size / 2,
                top: b.y - b.size / 2,
                width: b.size,
                height: b.size,
                backgroundColor: b.color,
                opacity: 1 - b.progress,
                borderRadius: b.size / 2,
                transform: [
                  { rotate: `${b.rotation}deg` },
                  { scale: 1 + b.progress * 0.5 },
                ],
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
                transform: [
                  { scale: t.scale },
                  { rotate: `${t.rotation}deg` },
                ],
              }
            ]}
          >
            {t.text}
          </Animated.Text>
        ))}

        {/* Particles */}
        {particles.map(p => (
          <Animated.View
            key={p.id}
            style={[
              styles.particleContainer,
              {
                left: p.x,
                top: p.y,
                width: p.size,
                height: p.size,
                opacity: p.opacity,
                transform: [
                  { rotate: `${p.rotation}deg` },
                  { scale: p.isCollected ? 0.1 : p.scale },
                ],
              }
            ]}
          >
            <View style={[
              styles.particle,
              {
                width: p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: p.type.color,
                shadowColor: p.type.glow,
                shadowOpacity: 0.5,
                shadowRadius: p.size * 0.5,
              }
            ]}>
              <View style={[
                styles.particleCore,
                {
                  width: p.size * 0.4,
                  height: p.size * 0.4,
                  borderRadius: p.size * 0.2,
                  backgroundColor: p.type.glow,
                }
              ]} />
              <View style={[
                styles.particleHighlight,
                {
                  width: p.size * 0.2,
                  height: p.size * 0.15,
                  borderRadius: p.size * 0.1,
                  top: p.size * 0.15,
                  right: p.size * 0.15,
                  backgroundColor: 'rgba(255,255,255,0.3)',
                }
              ]} />
            </View>
          </Animated.View>
        ))}

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>✨ PARTICLES</Text>
            <Text style={styles.hudValue}>{totalCollected}</Text>
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
            <Text style={styles.hudLabel}>🌀 FIELD</Text>
            <Text style={styles.hudValue}>{fieldStrength.toFixed(1)}x</Text>
          </View>
        </View>

        {/* Field strength indicator */}
        <View style={styles.fieldIndicator}>
          <View style={styles.fieldBar}>
            <View style={[styles.fieldFill, {
              width: `${(fieldStrength / 3) * 100}%`,
              backgroundColor: fieldStrength > 2 ? '#F59E0B' : '#38BDF8',
            }]} />
          </View>
          <Text style={styles.fieldLabel}>Field Strength</Text>
        </View>

        {/* Status */}
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {particles.length < 10 ? '🌱 Gathering energy...' :
              particles.length < 20 ? '⚡ Field active' :
                '✨ Quantum field engaged'}
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlText}>
              👆 Touch & drag to attract particles
            </Text>
            <Text style={styles.controlSubtext}>
              Build combos to increase your field strength
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
    backgroundColor: '#0F172A',
    overflow: 'hidden',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at center, #1E293B 0%, #0F172A 100%)',
  },
  fieldPulse: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'radial-gradient(circle at center, #38BDF8 0%, transparent 70%)',
  },
  gridContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.3,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#38BDF8',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#38BDF8',
  },
  trail: {
    position: 'absolute',
  },
  energyBurst: {
    position: 'absolute',
  },
  floatingText: {
    position: 'absolute',
    fontSize: 22,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  particleContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  particle: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  particleCore: {
    backgroundColor: '#FFFFFF',
  },
  particleHighlight: {
    position: 'absolute',
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
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
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
  fieldIndicator: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  fieldBar: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  fieldFill: {
    height: '100%',
    borderRadius: 2,
  },
  fieldLabel: {
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
    color: '#7DD3FC',
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
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  controlText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  controlSubtext: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 2,
  },
  glowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#38BDF8',
    pointerEvents: 'none',
  },
});

export default ParticleFieldGame;