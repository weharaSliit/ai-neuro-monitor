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

export const ZenRunnerGame = () => {
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [crystals, setCrystals] = useState(0);
  const [gameState, setGameState] = useState('playing'); // playing, paused, gameover

  // Player state
  const playerY = useRef(new Animated.Value(height * 0.55)).current;
  const isJumping = useRef(false);

  // Game objects
  const [obstacles, setObstacles] = useState([]);
  const [gems, setGems] = useState([]);
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  const gameLoop = useRef(null);
  const spawnTimer = useRef(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Player jump mechanic
  const handleJump = () => {
    if (isJumping.current || gameState !== 'playing') return;
    isJumping.current = true;

    // Create jump particle trail
    createJumpParticles(100, playerY._value + 20);

    Animated.sequence([
      Animated.timing(playerY, {
        toValue: height * 0.35,
        duration: 400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(playerY, {
        toValue: height * 0.55,
        duration: 400,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start(() => {
      isJumping.current = false;
    });
  };

  // Particles for jump
  const createJumpParticles = (x, y) => {
    const newParticles = [];
    for (let i = 0; i < 15; i++) {
      newParticles.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        size: 3 + Math.random() * 6,
        color: '#38BDF8',
        life: 1,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  // Floating text
  const createFloatingText = (x, y, text, color = '#FCD34D') => {
    setFloatingTexts(prev => [...prev, {
      id: Date.now() + Math.random(),
      x,
      y,
      text,
      color,
      opacity: 1,
      vy: -2,
    }]);
  };

  // Spawn obstacles and gems
  useEffect(() => {
    if (gameState !== 'playing') return;

    spawnTimer.current = setInterval(() => {
      const type = Math.random() > 0.4 ? 'gem' : 'obstacle';
      const newX = width + 50;

      if (type === 'gem') {
        const isHigh = Math.random() > 0.5;
        setGems(prev => [...prev, {
          id: Date.now() + Math.random(),
          x: newX,
          y: isHigh ? height * 0.38 : height * 0.55,
          size: 30,
          color: Math.random() > 0.5 ? '#F472B6' : '#38BDF8',
          points: 25,
        }]);
      } else {
        setObstacles(prev => [...prev, {
          id: Date.now() + Math.random(),
          x: newX,
          y: height * 0.55,
          width: 30,
          height: 45,
          color: '#EF4444',
          label: '⚡ Tension',
        }]);
      }
    }, 1400 / speedMultiplier);

    return () => clearInterval(spawnTimer.current);
  }, [gameState, speedMultiplier]);

  // Main game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    gameLoop.current = setInterval(() => {
      const baseSpeed = 6 * speedMultiplier;
      const pY = playerY._value;

      // Move gems & check collision
      setGems(prev => {
        const nextGems = [];
        for (let g of prev) {
          const nextX = g.x - baseSpeed;
          // Collision check with player (player at X=100)
          if (Math.abs(nextX - 100) < 35 && Math.abs(g.y - pY) < 40) {
            // Gem collected!
            const bonus = 10 * (combo + 1);
            setScore(s => s + bonus);
            setCrystals(c => c + 1);
            setCombo(c => {
              const nextC = c + 1;
              if (nextC > maxCombo) setMaxCombo(nextC);
              return nextC;
            });
            createFloatingText(100, pY - 30, `+${bonus} 💎`, '#FCD34D');
            continue; // Remove gem
          }
          if (nextX > -50) nextGems.push({ ...g, x: nextX });
        }
        return nextGems;
      });

      // Move obstacles & check collision
      setObstacles(prev => {
        const nextObs = [];
        for (let o of prev) {
          const nextX = o.x - baseSpeed;
          // Collision check with player
          if (Math.abs(nextX - 100) < 30 && Math.abs(o.y - pY) < 30) {
            // Hit obstacle - break combo & shake screen
            setCombo(0);
            createFloatingText(100, pY - 30, '💔 Reset Combo', '#EF4444');
            Animated.sequence([
              Animated.timing(shakeAnim, { toValue: 6, duration: 40, useNativeDriver: true }),
              Animated.timing(shakeAnim, { toValue: -6, duration: 40, useNativeDriver: true }),
              Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
            ]).start();
            continue; // Remove obstacle
          }
          if (nextX > -50) nextObs.push({ ...o, x: nextX });
        }
        return nextObs;
      });

      // Update particles
      setParticles(prev => prev.map(p => ({
        ...p,
        x: p.x + p.vx,
        y: p.y + p.vy,
        opacity: p.life - 0.03,
        life: p.life - 0.03,
      })).filter(p => p.life > 0));

      // Update floating texts
      setFloatingTexts(prev => prev.map(ft => ({
        ...ft,
        y: ft.y + ft.vy,
        opacity: ft.opacity - 0.02,
      })).filter(ft => ft.opacity > 0));

      // Increment score passively for running
      setScore(s => s + 1);

      // Gradually increase speed
      setSpeedMultiplier(sm => Math.min(sm + 0.0002, 2.2));

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, [gameState, speedMultiplier, combo, maxCombo]);

  return (
    <TouchableWithoutFeedback onPress={handleJump}>
      <Animated.View style={[styles.container, { transform: [{ translateX: shakeAnim }] }]}>
        {/* HUD Header */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>🏃 ZEN SCORE</Text>
            <Text style={styles.hudValue}>{score}</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>⚡ COMBO</Text>
            <Text style={[styles.hudValue, combo > 5 && styles.comboHigh]}>{combo}x</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>💎 CRYSTALS</Text>
            <Text style={styles.hudValue}>{crystals}</Text>
          </View>
        </View>

        {/* Floating texts */}
        {floatingTexts.map(ft => (
          <Text key={ft.id} style={[styles.floatingText, { left: ft.x, top: ft.y, color: ft.color, opacity: ft.opacity }]}>
            {ft.text}
          </Text>
        ))}

        {/* Particles */}
        {particles.map(p => (
          <View
            key={p.id}
            style={[
              styles.particle,
              { left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color, opacity: p.opacity }
            ]}
          />
        ))}

        {/* Gems */}
        {gems.map(g => (
          <View key={g.id} style={[styles.gem, { left: g.x, top: g.y - g.size / 2, backgroundColor: g.color }]}>
            <Text style={styles.gemIcon}>💎</Text>
          </View>
        ))}

        {/* Obstacles */}
        {obstacles.map(o => (
          <View key={o.id} style={[styles.obstacle, { left: o.x, top: o.y - o.height / 2 }]}>
            <Text style={styles.obstacleIcon}>🧱</Text>
          </View>
        ))}

        {/* Player Avatar */}
        <Animated.View style={[styles.player, { top: Animated.add(playerY, new Animated.Value(-25)) }]}>
          <View style={styles.playerCore}>
            <Text style={styles.playerEmoji}>🏃</Text>
          </View>
        </Animated.View>

        {/* Ground Line */}
        <View style={styles.ground} />

        {/* Touch instruction footer */}
        <View style={styles.footer}>
          <Text style={styles.footerTxt}>👆 TAP ANYWHERE TO JUMP OVER OBSTACLES & HARVEST CRYSTALS</Text>
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090D16',
    overflow: 'hidden',
  },
  hud: {
    position: 'absolute',
    top: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  hudItem: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  hudLabel: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  hudValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  comboHigh: {
    color: '#F472B6',
  },
  player: {
    position: 'absolute',
    left: 100,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  playerCore: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#38BDF8',
    shadowColor: '#38BDF8',
    shadowRadius: 10,
    shadowOpacity: 0.8,
  },
  playerEmoji: {
    fontSize: 24,
  },
  gem: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gemIcon: {
    fontSize: 18,
  },
  obstacle: {
    position: 'absolute',
    width: 36,
    height: 46,
    backgroundColor: '#7F1D1D',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  obstacleIcon: {
    fontSize: 20,
  },
  ground: {
    position: 'absolute',
    bottom: height * 0.38,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#38BDF8',
    shadowColor: '#38BDF8',
    shadowRadius: 10,
    shadowOpacity: 0.9,
  },
  particle: {
    position: 'absolute',
    borderRadius: 10,
  },
  floatingText: {
    position: 'absolute',
    fontSize: 16,
    fontWeight: '800',
    zIndex: 15,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerTxt: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
