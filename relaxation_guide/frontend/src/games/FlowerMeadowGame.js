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

export const FlowerMeadowGame = () => {
  const [breathPhase, setBreathPhase] = useState('inhale');
  const [cycleCount, setCycleCount] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [perfectBreaths, setPerfectBreaths] = useState(0);
  const [gameState, setGameState] = useState('ready');
  const [petals, setPetals] = useState([]);
  const [butterflies, setButterflies] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [particles, setParticles] = useState([]);
  const [flowers, setFlowers] = useState([]);

  // Animation values
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const petalAnim = useRef(new Animated.Value(0)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;

  // Flower types
  const FLOWER_TYPES = [
    { emoji: '🌺', color: '#EC4899', name: 'Hibiscus' },
    { emoji: '🌻', color: '#F59E0B', name: 'Sunflower' },
    { emoji: '🌸', color: '#F472B6', name: 'Cherry' },
    { emoji: '🌷', color: '#EF4444', name: 'Tulip' },
    { emoji: '🌹', color: '#DC2626', name: 'Rose' },
    { emoji: '🌼', color: '#FCD34D', name: 'Daisy' },
    { emoji: '💐', color: '#A78BFA', name: 'Bouquet' },
  ];

  // Create initial flower meadow
  useEffect(() => {
    const meadow = [];
    for (let i = 0; i < 12; i++) {
      meadow.push({
        id: i,
        type: FLOWER_TYPES[i % FLOWER_TYPES.length],
        x: 20 + Math.random() * (width - 40),
        y: 20 + Math.random() * (height - 40),
        size: 30 + Math.random() * 20,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.5,
        bloom: 0,
      });
    }
    setFlowers(meadow);
  }, []);

  // Create butterflies
  useEffect(() => {
    const butterflyInterval = setInterval(() => {
      if (butterflies.length < 8) {
        const newButterfly = {
          id: Date.now() + Math.random(),
          x: Math.random() * width,
          y: Math.random() * height,
          targetX: Math.random() * width,
          targetY: Math.random() * height,
          size: 15 + Math.random() * 10,
          rotation: 0,
          wingAngle: 0,
          color: `hsl(${Math.random() * 60 + 280}, 70%, 60%)`,
          speed: 0.5 + Math.random() * 1,
        };
        setButterflies(prev => [...prev, newButterfly]);
      }
    }, 3000);
    return () => clearInterval(butterflyInterval);
  }, [butterflies.length]);

  // Create floating petals
  useEffect(() => {
    const petalInterval = setInterval(() => {
      if (petals.length < 15) {
        const newPetal = {
          id: Date.now() + Math.random(),
          x: Math.random() * width,
          y: -20,
          size: 8 + Math.random() * 12,
          speed: 0.5 + Math.random() * 1.5,
          wobble: Math.random() * 2 - 1,
          rotation: Math.random() * 360,
          color: `hsl(${320 + Math.random() * 40}, 70%, 70%)`,
          opacity: 0.6 + Math.random() * 0.4,
        };
        setPetals(prev => [...prev, newPetal]);
      }
    }, 2000);
    return () => clearInterval(petalInterval);
  }, [petals.length]);

  // Create particle effects
  const createParticles = (x, y, count = 30) => {
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
        color: `hsl(${300 + Math.random() * 60}, 80%, ${60 + Math.random() * 30}%)`,
        gravity: 0.05 + Math.random() * 0.05,
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
      vy: -1.5 - Math.random() * 1,
      scale: 1,
    }]);
  };

  // Handle touch interaction
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;

    // Create flower bloom effect
    createParticles(locationX, locationY, 40);

    // Check if touching during optimal breath phase
    if (breathPhase === 'exhale' || breathPhase === 'hold') {
      const bonus = breathPhase === 'exhale' ? 25 : 15;
      const comboBonus = Math.floor(combo / 3) + 1;
      const points = bonus * comboBonus;

      setScore(prev => prev + points);
      setCombo(prev => prev + 1);

      if (breathPhase === 'exhale') {
        setPerfectBreaths(prev => prev + 1);
      }

      createFloatingText(
        locationX - 30,
        locationY - 40,
        `✨ +${points}`,
        breathPhase === 'exhale' ? '#34D399' : '#FCD34D'
      );

      // Combo milestone
      if (combo > 0 && combo % 5 === 0) {
        createFloatingText(
          locationX - 50,
          locationY - 80,
          `🌸 ${combo + 1}x BLOOM!`,
          '#F472B6'
        );
        // Spawn extra particles
        createParticles(locationX, locationY, 60);
      }

      // Animate flower bloom
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Miss / wrong phase
      createFloatingText(
        locationX - 30,
        locationY - 20,
        '⏳ Wait...',
        '#94A3B8'
      );
      setCombo(0);
    }
  };

  // Breathing cycle
  useEffect(() => {
    const cycleDuration = {
      inhale: 4000,
      hold: 7000,
      exhale: 8000,
      rest: 1000,
    };

    let timer;

    switch (breathPhase) {
      case 'inhale':
        // Expand flower
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.6,
            duration: cycleDuration.inhale,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: cycleDuration.inhale,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(rotateAnim, {
            toValue: 1,
            duration: cycleDuration.inhale,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ]).start();

        timer = setTimeout(() => {
          setBreathPhase('hold');
          createFloatingText(width / 2 - 50, height / 2 - 100, '🌬️ Hold...', '#60A5FA');
        }, cycleDuration.inhale);
        break;

      case 'hold':
        // Glow intensifies
        Animated.timing(glowAnim, {
          toValue: 1.5,
          duration: cycleDuration.hold,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start();

        timer = setTimeout(() => {
          setBreathPhase('exhale');
          createFloatingText(width / 2 - 50, height / 2 - 100, '🌺 Exhale!', '#34D399');
        }, cycleDuration.hold);
        break;

      case 'exhale':
        // Contract flower with blooming effect
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 0.8,
            duration: cycleDuration.exhale,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.3,
            duration: cycleDuration.exhale,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        timer = setTimeout(() => {
          setBreathPhase('rest');
          setCycleCount(prev => prev + 1);

          // Bonus for completing cycle
          const cycleBonus = 50 + perfectBreaths * 2;
          setScore(prev => prev + cycleBonus);
          createFloatingText(
            width / 2 - 40,
            height / 2 + 100,
            `🌿 +${cycleBonus}`,
            '#A78BFA'
          );

          // Spawn flower bloom particles
          createParticles(width / 2, height / 2, 50);

          setTimeout(() => {
            setBreathPhase('inhale');
            createFloatingText(width / 2 - 50, height / 2 - 120, '🌱 Inhale...', '#818CF8');
          }, cycleDuration.rest);
        }, cycleDuration.exhale);
        break;

      default:
        break;
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [breathPhase]);

  // Update butterflies
  useEffect(() => {
    const butterflyUpdate = setInterval(() => {
      setButterflies(prev => prev.map(b => {
        // Move towards target
        const dx = b.targetX - b.x;
        const dy = b.targetY - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 10) {
          // Set new target
          return {
            ...b,
            targetX: Math.random() * width,
            targetY: Math.random() * height,
            wingAngle: (b.wingAngle + 0.2) % (Math.PI * 2),
          };
        }

        return {
          ...b,
          x: b.x + (dx / dist) * b.speed * 0.5,
          y: b.y + (dy / dist) * b.speed * 0.5,
          rotation: Math.atan2(dy, dx),
          wingAngle: (b.wingAngle + 0.2) % (Math.PI * 2),
        };
      }));
    }, 50);

    return () => clearInterval(butterflyUpdate);
  }, []);

  // Update petals
  useEffect(() => {
    const petalUpdate = setInterval(() => {
      setPetals(prev => prev.map(p => ({
        ...p,
        y: p.y + p.speed,
        x: p.x + Math.sin(Date.now() * 0.001 + p.wobble) * 0.5,
        rotation: p.rotation + 0.5,
      })).filter(p => p.y < height + 20));
    }, 16);

    return () => clearInterval(petalUpdate);
  }, []);

  // Update particles
  useEffect(() => {
    const particleUpdate = setInterval(() => {
      setParticles(prev => prev.map(p => ({
        ...p,
        x: p.x + p.vx,
        y: p.y + p.vy,
        vy: p.vy + p.gravity,
        life: p.life - 0.02,
        size: p.size * 0.99,
      })).filter(p => p.life > 0));
    }, 16);

    return () => clearInterval(particleUpdate);
  }, []);

  // Update floating texts
  useEffect(() => {
    const textUpdate = setInterval(() => {
      setFloatingTexts(prev => prev.map(t => ({
        ...t,
        y: t.y + t.vy,
        opacity: t.opacity - 0.02,
        scale: t.scale + 0.01,
      })).filter(t => t.opacity > 0));
    }, 16);

    return () => clearInterval(textUpdate);
  }, []);

  // Get phase info
  const getPhaseInfo = () => {
    switch (breathPhase) {
      case 'inhale': return {
        icon: '🌱',
        text: 'Breathe In',
        sub: 'Expand with the flower',
        color: '#818CF8',
        progress: (scaleAnim._value - 1) / 0.6
      };
      case 'hold': return {
        icon: '🕊️',
        text: 'Hold',
        sub: 'Embrace the calm',
        color: '#60A5FA',
        progress: 1
      };
      case 'exhale': return {
        icon: '🌺',
        text: 'Breathe Out',
        sub: 'Release and bloom',
        color: '#34D399',
        progress: 1 - (scaleAnim._value - 0.8) / 0.2
      };
      default: return {
        icon: '🌸',
        text: 'Rest',
        sub: 'Prepare for next cycle',
        color: '#A78BFA',
        progress: 0
      };
    }
  };

  const phaseInfo = getPhaseInfo();

  return (
    <TouchableWithoutFeedback onPress={handleTouch}>
      <View style={styles.container}>
        {/* Background gradient */}
        <View style={styles.bgGradient}>
          <View style={[styles.gradientLayer, { backgroundColor: '#0F0A1A' }]} />
        </View>

        {/* Butterflies */}
        {butterflies.map(b => (
          <Animated.View
            key={b.id}
            style={[
              styles.butterfly,
              {
                left: b.x - b.size / 2,
                top: b.y - b.size / 2,
                width: b.size,
                height: b.size * 0.7,
                transform: [
                  { rotate: `${b.rotation}rad` },
                  { scaleX: Math.cos(b.wingAngle) },
                ],
              }
            ]}
          >
            <View style={[styles.butterflyWing, {
              backgroundColor: b.color,
              transform: [{ scaleX: Math.sin(b.wingAngle) }],
            }]} />
            <View style={[styles.butterflyWing, {
              backgroundColor: b.color,
              transform: [{ scaleX: Math.cos(b.wingAngle) }],
            }]} />
          </Animated.View>
        ))}

        {/* Floating Petals */}
        {petals.map(p => (
          <Animated.View
            key={p.id}
            style={[
              styles.petal,
              {
                left: p.x - p.size / 2,
                top: p.y - p.size / 2,
                width: p.size,
                height: p.size * 0.7,
                backgroundColor: p.color,
                opacity: p.opacity,
                transform: [{ rotate: `${p.rotation}deg` }],
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

        {/* Background Flowers */}
        {flowers.map(flower => (
          <View
            key={flower.id}
            style={[
              styles.backgroundFlower,
              {
                left: flower.x,
                top: flower.y,
                fontSize: flower.size,
                transform: [
                  { rotate: `${flower.rotation}deg` },
                  { scale: flower.scale },
                ],
              }
            ]}
          >
            <Text style={{ fontSize: flower.size }}>{flower.type.emoji}</Text>
          </View>
        ))}

        {/* Main Flower */}
        <Animated.View
          style={[
            styles.flowerContainer,
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
            styles.flowerGlow,
            {
              opacity: glowAnim,
              shadowOpacity: glowAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 0.9],
              }),
            }
          ]}>
            <View style={styles.flowerInner}>
              <Text style={styles.flowerEmoji}>🌺</Text>
              <View style={styles.flowerPetalRing}>
                {['🌸', '🌷', '🌹', '🌻', '🌸', '🌷'].map((emoji, i) => (
                  <View
                    key={i}
                    style={[
                      styles.petalRingItem,
                      {
                        transform: [
                          { rotate: `${i * 60}deg` },
                          { translateX: 50 },
                        ],
                      }
                    ]}
                  >
                    <Text style={styles.petalRingEmoji}>{emoji}</Text>
                  </View>
                ))}
              </View>
            </View>
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
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, {
              width: `${phaseInfo.progress * 100}%`,
              backgroundColor: phaseInfo.color,
            }]} />
          </View>
        </View>

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>🌸 CYCLES</Text>
            <Text style={styles.hudValue}>{cycleCount}</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>✨ SCORE</Text>
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
            <Text style={styles.hudLabel}>🎯 PERFECT</Text>
            <Text style={styles.hudValue}>{perfectBreaths}</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <Text style={styles.controlText}>
            👆 Tap the flower during Exhale for bonus points
          </Text>
          <Text style={styles.controlSubtext}>
            Follow the breathing cycle to bloom your garden
          </Text>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0A1A',
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
    flex: 1,
    opacity: 0.8,
  },
  butterfly: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  butterflyWing: {
    position: 'absolute',
    width: '100%',
    height: '50%',
    borderRadius: 10,
    opacity: 0.6,
  },
  petal: {
    position: 'absolute',
    borderRadius: 10,
    opacity: 0.5,
  },
  particle: {
    position: 'absolute',
  },
  floatingText: {
    position: 'absolute',
    fontSize: 24,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  backgroundFlower: {
    position: 'absolute',
    opacity: 0.3,
  },
  flowerContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flowerGlow: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(244, 114, 182, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F472B6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 50,
    elevation: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  flowerInner: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  flowerEmoji: {
    fontSize: 70,
  },
  flowerPetalRing: {
    position: 'absolute',
    width: 180,
    height: 180,
  },
  petalRingItem: {
    position: 'absolute',
    left: 80,
    top: 80,
  },
  petalRingEmoji: {
    fontSize: 20,
  },
  phaseContainer: {
    position: 'absolute',
    bottom: 120,
    backgroundColor: 'rgba(15, 10, 26, 0.8)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    minWidth: 200,
    backdropFilter: 'blur(10px)',
  },
  phaseIcon: {
    fontSize: 28,
  },
  phaseText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 4,
  },
  phaseSubtext: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  progressContainer: {
    width: 150,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginTop: 8,
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
    flexWrap: 'wrap',
  },
  hudItem: {
    backgroundColor: 'rgba(15, 10, 26, 0.7)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    minWidth: 60,
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
    fontSize: 16,
    fontWeight: 'bold',
  },
  comboHigh: {
    color: '#F472B6',
  },
  comboSuper: {
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
});