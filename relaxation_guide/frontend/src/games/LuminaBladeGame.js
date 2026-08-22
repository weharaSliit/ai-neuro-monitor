import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  Dimensions
} from 'react-native';

const { width, height } = Dimensions.get('window');

export const LuminaBladeGame = () => {
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [slicedCount, setSlicedCount] = useState(0);

  const [orbs, setOrbs] = useState([]);
  const [bladeTrails, setBladeTrails] = useState([]);
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);

  const gameLoop = useRef(null);
  const spawnTimer = useRef(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Swipe gesture handling for blade cuts
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (evt, gestureState) => {
      const { locationX, locationY } = evt.nativeEvent;
      // Add blade trail point
      setBladeTrails(prev => [...prev.slice(-12), { id: Date.now() + Math.random(), x: locationX, y: locationY }]);

      // Check collision with flying orbs
      setOrbs(prev => {
        const nextOrbs = [];
        for (let orb of prev) {
          if (!orb.isSliced && Math.abs(orb.x - locationX) < 45 && Math.abs(orb.y - locationY) < 45) {
            // Slice orb!
            if (orb.isBomb) {
              // Hit bomb
              setCombo(0);
              createFloatingText(locationX, locationY, '💥 BOMB HIT!', '#EF4444');
              Animated.sequence([
                Animated.timing(shakeAnim, { toValue: 10, duration: 40, useNativeDriver: true }),
                Animated.timing(shakeAnim, { toValue: -10, duration: 40, useNativeDriver: true }),
                Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
              ]).start();
            } else {
              // Sliced stress orb!
              const bonus = 15 * (combo + 1);
              setScore(s => s + bonus);
              setSlicedCount(sc => sc + 1);
              setCombo(c => {
                const nextC = c + 1;
                if (nextC > maxCombo) setMaxCombo(nextC);
                return nextC;
              });
              createParticles(locationX, locationY, orb.color, 25);
              createFloatingText(locationX, locationY, `+${bonus} ⚡ SLICE`, orb.color);
            }
            continue; // Remove sliced orb
          }
          nextOrbs.push(orb);
        }
        return nextOrbs;
      });
    },
  });

  // Spawn flying stress orbs
  useEffect(() => {
    spawnTimer.current = setInterval(() => {
      const isBomb = Math.random() < 0.15;
      const startX = 50 + Math.random() * (width - 100);
      const vx = (Math.random() - 0.5) * 4;
      const vy = -12 - Math.random() * 6; // Initial upward velocity

      const orbTypes = [
        { label: 'Anxiety', color: '#F43F5E' },
        { label: 'Overthink', color: '#A855F7' },
        { label: 'Fatigue', color: '#3B82F6' },
        { label: 'Tension', color: '#10B981' },
      ];
      const type = orbTypes[Math.floor(Math.random() * orbTypes.length)];

      setOrbs(prev => [...prev, {
        id: Date.now() + Math.random(),
        x: startX,
        y: height + 30,
        vx,
        vy,
        color: isBomb ? '#EF4444' : type.color,
        label: isBomb ? '💣 Bomb' : type.label,
        isBomb,
        isSliced: false,
      }]);
    }, 900);

    return () => clearInterval(spawnTimer.current);
  }, []);

  // Physics game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      // Update orb trajectories with gravity
      setOrbs(prev => {
        const next = [];
        for (let o of prev) {
          const nextY = o.y + o.vy;
          const nextVy = o.vy + 0.38; // Gravity
          const nextX = o.x + o.vx;

          if (nextY < height + 60) {
            next.push({ ...o, x: nextX, y: nextY, vy: nextVy });
          }
        }
        return next;
      });

      // Fade blade trails
      setBladeTrails(prev => prev.slice(1));

      // Update particles
      setParticles(prev => prev.map(p => ({
        ...p,
        x: p.x + p.vx,
        y: p.y + p.vy,
        opacity: p.life - 0.04,
        life: p.life - 0.04,
      })).filter(p => p.life > 0));

      // Update floating text
      setFloatingTexts(prev => prev.map(ft => ({
        ...ft,
        y: ft.y + ft.vy,
        opacity: ft.opacity - 0.03,
      })).filter(ft => ft.opacity > 0));

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, [combo, maxCombo]);

  const createParticles = (x, y, color, count) => {
    const newP = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 7;
      newP.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 6,
        color,
        life: 1,
      });
    }
    setParticles(prev => [...prev, ...newP]);
  };

  const createFloatingText = (x, y, text, color) => {
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

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <Animated.View style={[styles.canvas, { transform: [{ translateX: shakeAnim }] }]}>
        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>⚔️ SLICE SCORE</Text>
            <Text style={styles.hudValue}>{score}</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>⚡ COMBO STREAK</Text>
            <Text style={[styles.hudValue, combo > 5 && styles.comboHigh]}>{combo}x</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>💥 SLICED</Text>
            <Text style={styles.hudValue}>{slicedCount}</Text>
          </View>
        </View>

        {/* Floating text */}
        {floatingTexts.map(ft => (
          <Text key={ft.id} style={[styles.floatingText, { left: ft.x, top: ft.y, color: ft.color, opacity: ft.opacity }]}>
            {ft.text}
          </Text>
        ))}

        {/* Particles */}
        {particles.map(p => (
          <View key={p.id} style={[styles.particle, { left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color, opacity: p.opacity }]} />
        ))}

        {/* Blade Trails */}
        {bladeTrails.map((pt, idx) => (
          <View
            key={pt.id}
            style={[
              styles.bladeTrail,
              { left: pt.x - 6, top: pt.y - 6, opacity: (idx + 1) / bladeTrails.length }
            ]}
          />
        ))}

        {/* Flying Stress Orbs */}
        {orbs.map(orb => (
          <View
            key={orb.id}
            style={[
              styles.orb,
              { left: orb.x - 30, top: orb.y - 30, backgroundColor: orb.color, borderColor: '#FFFFFF' }
            ]}
          >
            <Text style={styles.orbText}>{orb.label}</Text>
          </View>
        ))}

        {/* Footer info */}
        <View style={styles.footer}>
          <Text style={styles.footerTxt}>⚔️ SWIPE FINGER ACROSS SCREEN TO SLICE STRESS ORBS</Text>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  canvas: {
    flex: 1,
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
    borderColor: 'rgba(236, 72, 153, 0.3)',
  },
  hudLabel: {
    color: '#EC4899',
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
  orb: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#F472B6',
    shadowRadius: 12,
    shadowOpacity: 0.8,
  },
  orbText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  bladeTrail: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowRadius: 8,
    shadowOpacity: 1,
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
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
