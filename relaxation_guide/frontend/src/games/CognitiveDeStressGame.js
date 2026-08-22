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

export const CognitiveDeStressGame = () => {
  const [bubbles, setBubbles] = useState([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [totalPopped, setTotalPopped] = useState(0);
  const [gameState, setGameState] = useState('playing');
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [powerups, setPowerups] = useState([]);
  const [shakeAnim] = useState(new Animated.Value(0));
  const [glowAnim] = useState(new Animated.Value(0));

  const spawnTimer = useRef(null);
  const gameLoop = useRef(null);
  const difficultyLevel = useRef(1);

  // Stress-related bubble types with colors and effects
  const STRESS_TYPES = [
    { id: 'tension', label: 'Tension', color: '#EF4444', emoji: '😰', points: 10 },
    { id: 'worry', label: 'Worry', color: '#F59E0B', emoji: '😟', points: 15 },
    { id: 'fatigue', label: 'Fatigue', color: '#8B5CF6', emoji: '😩', points: 20 },
    { id: 'overthink', label: 'Overthink', color: '#EC4899', emoji: '🤔', points: 25 },
    { id: 'anxiety', label: 'Anxiety', color: '#F472B6', emoji: '😬', points: 30 },
    { id: 'stress', label: 'Stress', color: '#DC2626', emoji: '😫', points: 35 },
  ];

  // Power-up types
  const POWERUP_TYPES = [
    { id: 'multiplier', label: 'x2', color: '#FCD34D', emoji: '⭐', duration: 5000 },
    { id: 'bomb', label: '💥', color: '#EF4444', emoji: '💥', duration: 0 },
    { id: 'slow', label: '🐢', color: '#34D399', emoji: '🐢', duration: 3000 },
  ];

  // Create a new bubble
  const createBubble = (customType = null) => {
    const type = customType || STRESS_TYPES[Math.floor(Math.random() * STRESS_TYPES.length)];
    const size = 60 + Math.random() * 50;
    const x = 30 + Math.random() * (width - 60 - size);
    const y = -50 - Math.random() * 100;
    const speed = 0.5 + Math.random() * (1 + difficultyLevel.current * 0.1);
    const wobble = Math.random() * 2 - 1;
    const phase = Math.random() * Math.PI * 2;

    return {
      id: Date.now() + Math.random(),
      type,
      x,
      y,
      size,
      speed,
      wobble,
      phase,
      opacity: 1,
      scale: 0.8 + Math.random() * 0.4,
      rotation: Math.random() * 360,
      isPopping: false,
      popProgress: 0,
      points: type.points * difficultyLevel.current,
    };
  };

  // Create particle explosion
  const createExplosion = (x, y, color, count = 25) => {
    const newParticles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 2 + Math.random() * 8;
      newParticles.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 2,
        life: 1,
        size: 3 + Math.random() * 8,
        color: color,
        gravity: 0.1 + Math.random() * 0.1,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
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
      vy: -2 - Math.random() * 1,
      scale: 1,
    }]);
  };

  // Pop bubble with effects
  const popBubble = (bubble) => {
    if (bubble.isPopping) return;

    // Mark as popping
    setBubbles(prev => prev.map(b =>
      b.id === bubble.id ? { ...b, isPopping: true } : b
    ));

    // Create explosion
    createExplosion(bubble.x + bubble.size / 2, bubble.y + bubble.size / 2, bubble.type.color, 30);

    // Calculate score with combo
    const comboBonus = Math.floor(combo / 5) + 1;
    const points = bubble.points * comboBonus;
    setScore(prev => prev + points);
    setCombo(prev => prev + 1);
    setTotalPopped(prev => prev + 1);

    if (combo + 1 > maxCombo) {
      setMaxCombo(combo + 1);
    }

    // Floating text with combo info
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

    // Combo milestone
    if (combo > 0 && combo % 5 === 0) {
      createFloatingText(
        bubble.x + bubble.size / 2 - 50,
        bubble.y - 50,
        `🔥 ${combo + 1}x COMBO!`,
        '#FCD34D'
      );

      // Spawn power-up on combo milestones
      if (combo % 10 === 0) {
        spawnPowerup(bubble.x + bubble.size / 2, bubble.y);
      }
    }

    // Screen shake on high combo
    if (combo > 5) {
      Animated.sequence([
        Animated.timing(shakeAnim, {
          toValue: 5,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: -5,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 3,
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

    // Remove bubble after animation
    setTimeout(() => {
      setBubbles(prev => prev.filter(b => b.id !== bubble.id));
    }, 300);
  };

  // Spawn power-up
  const spawnPowerup = (x, y) => {
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    setPowerups(prev => [...prev, {
      id: Date.now() + Math.random(),
      type,
      x: x - 25,
      y: y - 25,
      size: 50,
      opacity: 1,
      rotation: 0,
    }]);
  };

  // Collect power-up
  const collectPowerup = (powerup) => {
    setPowerups(prev => prev.filter(p => p.id !== powerup.id));

    createExplosion(powerup.x + 25, powerup.y + 25, powerup.type.color, 40);
    createFloatingText(
      powerup.x,
      powerup.y - 20,
      `✨ ${powerup.type.emoji} ${powerup.type.label}`,
      powerup.type.color
    );

    // Apply power-up effect
    switch (powerup.type.id) {
      case 'multiplier':
        setScore(prev => prev * 2);
        createFloatingText(powerup.x, powerup.y - 60, '⚡ SCORE x2!', '#FCD34D');
        break;
      case 'bomb':
        // Clear all bubbles with explosion
        setBubbles(prev => {
          prev.forEach(b => {
            if (!b.isPopping) {
              createExplosion(b.x + b.size / 2, b.y + b.size / 2, '#EF4444', 15);
            }
          });
          return [];
        });
        createFloatingText(width / 2 - 50, height / 2, '💥 BOMB!', '#EF4444');
        break;
      case 'slow':
        // Slow down all bubbles
        setBubbles(prev => prev.map(b => ({
          ...b,
          speed: b.speed * 0.5,
        })));
        setTimeout(() => {
          setBubbles(prev => prev.map(b => ({
            ...b,
            speed: b.speed * 2,
          })));
        }, powerup.type.duration);
        createFloatingText(powerup.x, powerup.y - 60, '🐢 SLOWED!', '#34D399');
        break;
    }
  };

  // Spawn bubbles
  useEffect(() => {
    spawnTimer.current = setInterval(() => {
      const count = Math.floor(1 + difficultyLevel.current / 2);
      const newBubbles = [];
      for (let i = 0; i < count; i++) {
        newBubbles.push(createBubble());
      }
      setBubbles(prev => [...prev, ...newBubbles]);
    }, 1500 / difficultyLevel.current);

    return () => clearInterval(spawnTimer.current);
  }, []);

  // Game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update bubbles
      setBubbles(prev => {
        const updated = prev.map(bubble => ({
          ...bubble,
          y: bubble.y + bubble.speed,
          x: bubble.x + Math.sin(bubble.phase + Date.now() * 0.001) * bubble.wobble * 0.5,
          rotation: bubble.rotation + 0.5,
          opacity: bubble.y > height - 50 ? bubble.opacity * 0.99 : bubble.opacity,
        }));
        // Remove bubbles that go off screen or get too small
        return updated.filter(b => b.y < height + 100 && b.opacity > 0.1);
      });

      // Update particles
      setParticles(prev => {
        const updated = prev.map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          vy: p.vy + p.gravity,
          life: p.life - 0.02,
          size: p.size * 0.99,
        }));
        return updated.filter(p => p.life > 0);
      });

      // Update floating texts
      setFloatingTexts(prev => {
        const updated = prev.map(t => ({
          ...t,
          y: t.y + t.vy,
          opacity: t.opacity - 0.02,
          scale: t.scale + 0.01,
        }));
        return updated.filter(t => t.opacity > 0);
      });

      // Update powerups
      setPowerups(prev => {
        const updated = prev.map(p => ({
          ...p,
          y: p.y + 0.5,
          rotation: p.rotation + 1,
          opacity: p.y > height - 100 ? p.opacity * 0.99 : p.opacity,
        }));
        return updated.filter(p => p.y < height + 50 && p.opacity > 0.1);
      });

      // Increase difficulty
      if (totalPopped > 0 && totalPopped % 10 === 0) {
        difficultyLevel.current = Math.min(difficultyLevel.current + 0.2, 5);
      }

      // Check game over condition (too many bubbles)
      setBubbles(prev => {
        if (prev.length > 30) {
          setGameState('gameover');
        }
        return prev;
      });

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, [totalPopped]);

  // Touch handler
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;

    // Check if touching a powerup
    const powerupHit = powerups.find(p =>
      locationX > p.x && locationX < p.x + p.size &&
      locationY > p.y && locationY < p.y + p.size
    );
    if (powerupHit) {
      collectPowerup(powerupHit);
      return;
    }

    // Check if touching a bubble
    const bubbleHit = bubbles.find(b =>
      !b.isPopping &&
      locationX > b.x && locationX < b.x + b.size &&
      locationY > b.y && locationY < b.y + b.size
    );

    if (bubbleHit) {
      popBubble(bubbleHit);
    } else {
      // Miss effect
      createFloatingText(locationX - 20, locationY - 20, '❌ Miss!', '#EF4444');
      setCombo(0);
    }
  };

  // Reset game
  const resetGame = () => {
    setBubbles([]);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setTotalPopped(0);
    setParticles([]);
    setFloatingTexts([]);
    setPowerups([]);
    difficultyLevel.current = 1;
    setGameState('playing');
  };

  // Get stress type color based on score
  const getMoodColor = () => {
    if (score < 100) return '#FCD34D';
    if (score < 300) return '#34D399';
    if (score < 500) return '#60A5FA';
    return '#A78BFA';
  };

  return (
    <TouchableWithoutFeedback onPress={handleTouch}>
      <Animated.View style={[
        styles.container,
        { transform: [{ translateX: shakeAnim }] }
      ]}>
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

        {/* Bubbles */}
        {bubbles.map(bubble => (
          <Animated.View
            key={bubble.id}
            style={[
              styles.bubble,
              {
                left: bubble.x,
                top: bubble.y,
                width: bubble.size,
                height: bubble.size,
                borderRadius: bubble.size / 2,
                backgroundColor: bubble.type.color + '40',
                borderColor: bubble.type.color,
                opacity: bubble.opacity,
                transform: [
                  { scale: bubble.isPopping ? 0.1 : bubble.scale },
                  { rotate: `${bubble.rotation}deg` },
                ],
              }
            ]}
          >
            <Text style={styles.bubbleEmoji}>{bubble.type.emoji}</Text>
            <Text style={[styles.bubbleLabel, { color: bubble.type.color }]}>
              {bubble.type.label}
            </Text>
          </Animated.View>
        ))}

        {/* Powerups */}
        {powerups.map(powerup => (
          <Animated.View
            key={powerup.id}
            style={[
              styles.powerup,
              {
                left: powerup.x,
                top: powerup.y,
                width: powerup.size,
                height: powerup.size,
                borderRadius: powerup.size / 2,
                backgroundColor: powerup.type.color + '60',
                borderColor: powerup.type.color,
                opacity: powerup.opacity,
                transform: [{ rotate: `${powerup.rotation}deg` }],
              }
            ]}
          >
            <Text style={styles.powerupEmoji}>{powerup.type.emoji}</Text>
          </Animated.View>
        ))}

        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudLeft}>
            <Text style={styles.hudLabel}>🎯 SCORE</Text>
            <Text style={styles.hudValue}>{score}</Text>
          </View>

          <View style={styles.hudCenter}>
            <Text style={styles.hudLabel}>⚡ COMBO</Text>
            <Text style={[
              styles.hudValue,
              combo > 5 && styles.comboHigh,
              combo > 10 && styles.comboSuper,
            ]}>
              {combo}x
            </Text>
          </View>

          <View style={styles.hudRight}>
            <Text style={styles.hudLabel}>💨 POPPED</Text>
            <Text style={styles.hudValue}>{totalPopped}</Text>
          </View>
        </View>

        {/* Status bar */}
        <View style={styles.statusBar}>
          <View style={[styles.moodIndicator, { backgroundColor: getMoodColor() }]} />
          <Text style={styles.statusText}>
            {gameState === 'gameover' ? '😵 Game Over!' :
              difficultyLevel.current < 2 ? '😌 Relaxed' :
                difficultyLevel.current < 3 ? '🧘 Focused' :
                  difficultyLevel.current < 4 ? '💪 Challenging' :
                    '⚡ Intense!'}
          </Text>
          <Text style={styles.difficultyText}>
            Level {Math.floor(difficultyLevel.current)}
          </Text>
        </View>

        {/* Bottom controls */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlText}>
              {gameState === 'gameover' ?
                '💔 Too many stress bubbles! Tap to restart' :
                `👆 Tap bubbles to release stress • ${STRESS_TYPES.length} stress types`}
            </Text>
            {gameState === 'gameover' && (
              <TouchableWithoutFeedback onPress={resetGame}>
                <View style={styles.restartButton}>
                  <Text style={styles.restartText}>🔄 Play Again</Text>
                </View>
              </TouchableWithoutFeedback>
            )}
          </View>
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0A1A',
    overflow: 'hidden',
  },
  particle: {
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
  bubble: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  bubbleEmoji: {
    fontSize: 24,
  },
  bubbleLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  powerup: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#FCD34D',
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  powerupEmoji: {
    fontSize: 28,
  },
  hud: {
    position: 'absolute',
    top: 30,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  hudLeft: {
    backgroundColor: 'rgba(15, 10, 26, 0.8)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.2)',
    alignItems: 'center',
  },
  hudCenter: {
    backgroundColor: 'rgba(15, 10, 26, 0.8)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.2)',
    alignItems: 'center',
  },
  hudRight: {
    backgroundColor: 'rgba(15, 10, 26, 0.8)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
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
  comboHigh: {
    color: '#F472B6',
  },
  comboSuper: {
    color: '#F59E0B',
    textShadowColor: '#F59E0B',
    textShadowRadius: 10,
  },
  statusBar: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 10, 26, 0.6)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    zIndex: 10,
  },
  moodIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    color: '#C7D2FE',
    fontSize: 11,
    fontWeight: '600',
    marginRight: 12,
  },
  difficultyText: {
    color: '#64748B',
    fontSize: 10,
  },
  controls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  controlGroup: {
    backgroundColor: 'rgba(15, 10, 26, 0.7)',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  controlText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
  restartButton: {
    marginTop: 8,
    backgroundColor: 'rgba(236, 72, 153, 0.2)',
    paddingVertical: 6,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EC4899',
  },
  restartText: {
    color: '#EC4899',
    fontSize: 14,
    fontWeight: 'bold',
  },
});