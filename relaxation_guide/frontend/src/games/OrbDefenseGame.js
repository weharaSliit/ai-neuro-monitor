import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  Animated,
  Dimensions
} from 'react-native';

const { width, height } = Dimensions.get('window');
const CENTER_X = width / 2;
const CENTER_Y = height / 2;

export const OrbDefenseGame = () => {
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [shieldAngle, setShieldAngle] = useState(0); // Angle in degrees
  const [projectiles, setProjectiles] = useState([]);
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [coreHealth, setCoreHealth] = useState(100);

  const gameLoop = useRef(null);
  const spawnTimer = useRef(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Handle touch around the screen to point shield towards touch point
  const handleTouch = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;
    const dx = locationX - CENTER_X;
    const dy = locationY - CENTER_Y;
    let angleRad = Math.atan2(dy, dx);
    let angleDeg = (angleRad * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 360;
    setShieldAngle(angleDeg);
  };

  // Spawn incoming projectiles towards the center
  useEffect(() => {
    spawnTimer.current = setInterval(() => {
      const angleDeg = Math.random() * 360;
      const angleRad = (angleDeg * Math.PI) / 180;
      const spawnRadius = width * 0.6;
      const startX = CENTER_X + Math.cos(angleRad) * spawnRadius;
      const startY = CENTER_Y + Math.sin(angleRad) * spawnRadius;

      setProjectiles(prev => [...prev, {
        id: Date.now() + Math.random(),
        x: startX,
        y: startY,
        angleDeg,
        speed: 2.5 + Math.random() * 1.5,
        color: Math.random() > 0.5 ? '#F43F5E' : '#A855F7',
        label: '☄️ Tension',
      }]);
    }, 1100);

    return () => clearInterval(spawnTimer.current);
  }, []);

  // Main game loop
  useEffect(() => {
    gameLoop.current = setInterval(() => {
      setProjectiles(prev => {
        const next = [];
        for (let p of prev) {
          const dx = CENTER_X - p.x;
          const dy = CENTER_Y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Check Shield Deflection at radius ~80px
          if (dist <= 85 && dist >= 65) {
            let pAngle = Math.atan2(p.y - CENTER_Y, p.x - CENTER_X) * (180 / Math.PI);
            if (pAngle < 0) pAngle += 360;

            // Shield covers ~60 degree arc around shieldAngle
            let diff = Math.abs(pAngle - shieldAngle);
            if (diff > 180) diff = 360 - diff;

            if (diff <= 40) {
              // Deflected successfully!
              const bonus = 20 * (combo + 1);
              setScore(s => s + bonus);
              setCombo(c => c + 1);
              createParticles(p.x, p.y, '#38BDF8', 20);
              createFloatingText(p.x, p.y, `+${bonus} SHIELD DEFLECT!`, '#38BDF8');
              continue; // Destroy projectile
            }
          }

          // Check Core Impact at radius ~35px
          if (dist <= 35) {
            setCombo(0);
            setCoreHealth(ch => Math.max(0, ch - 10));
            createFloatingText(CENTER_X, CENTER_Y - 40, '💥 CORE IMPACT!', '#EF4444');
            Animated.sequence([
              Animated.timing(shakeAnim, { toValue: 8, duration: 40, useNativeDriver: true }),
              Animated.timing(shakeAnim, { toValue: -8, duration: 40, useNativeDriver: true }),
              Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
            ]).start();
            continue; // Destroy projectile
          }

          // Move towards center
          const angleRad = Math.atan2(dy, dx);
          const nextX = p.x + Math.cos(angleRad) * p.speed;
          const nextY = p.y + Math.sin(angleRad) * p.speed;
          next.push({ ...p, x: nextX, y: nextY });
        }
        return next;
      });

      // Update particles
      setParticles(prev => prev.map(pt => ({
        ...pt,
        x: pt.x + pt.vx,
        y: pt.y + pt.vy,
        opacity: pt.life - 0.04,
        life: pt.life - 0.04,
      })).filter(pt => pt.life > 0));

      // Update floating texts
      setFloatingTexts(prev => prev.map(ft => ({
        ...ft,
        y: ft.y + ft.vy,
        opacity: ft.opacity - 0.03,
      })).filter(ft => ft.opacity > 0));

    }, 16);

    return () => clearInterval(gameLoop.current);
  }, [shieldAngle, combo]);

  const createParticles = (x, y, color, count) => {
    const newP = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      newP.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 5,
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

  const shieldRad = (shieldAngle * Math.PI) / 180;
  const shieldX = CENTER_X + Math.cos(shieldRad) * 75;
  const shieldY = CENTER_Y + Math.sin(shieldRad) * 75;

  return (
    <TouchableWithoutFeedback onPress={handleTouch}>
      <Animated.View style={[styles.container, { transform: [{ translateX: shakeAnim }] }]}>
        {/* HUD */}
        <View style={styles.hud}>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>🛡️ DEFENSE SCORE</Text>
            <Text style={styles.hudValue}>{score}</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>⚡ DEFLECT COMBO</Text>
            <Text style={styles.hudValue}>{combo}x</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>❤️ CORE HEALTH</Text>
            <Text style={[styles.hudValue, coreHealth < 40 && { color: '#EF4444' }]}>{coreHealth}%</Text>
          </View>
        </View>

        {/* Floating text */}
        {floatingTexts.map(ft => (
          <Text key={ft.id} style={[styles.floatingText, { left: ft.x - 40, top: ft.y, color: ft.color, opacity: ft.opacity }]}>
            {ft.text}
          </Text>
        ))}

        {/* Particles */}
        {particles.map(pt => (
          <View key={pt.id} style={[styles.particle, { left: pt.x, top: pt.y, width: pt.size, height: pt.size, backgroundColor: pt.color, opacity: pt.opacity }]} />
        ))}

        {/* Central Core */}
        <View style={[styles.core, { left: CENTER_X - 35, top: CENTER_Y - 35 }]}>
          <Text style={styles.coreEmoji}>🌐</Text>
        </View>

        {/* Shield Ring Segment */}
        <View
          style={[
            styles.shield,
            {
              left: shieldX - 25,
              top: shieldY - 25,
              transform: [{ rotate: `${shieldAngle + 90}deg` }],
            }
          ]}
        />

        {/* Projectiles */}
        {projectiles.map(p => (
          <View key={p.id} style={[styles.projectile, { left: p.x - 16, top: p.y - 16, backgroundColor: p.color }]}>
            <Text style={styles.projEmoji}>☄️</Text>
          </View>
        ))}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerTxt}>🛡️ TAP ANYWHERE TO ROTATE YOUR SHIELD & DEFLECT PROJECTILES</Text>
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
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
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
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
  core: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#0284C7',
    borderWidth: 3,
    borderColor: '#38BDF8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#38BDF8',
    shadowRadius: 20,
    shadowOpacity: 1,
  },
  coreEmoji: {
    fontSize: 32,
  },
  shield: {
    position: 'absolute',
    width: 50,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#38BDF8',
    borderWidth: 2,
    borderColor: '#E0F2FE',
    shadowColor: '#38BDF8',
    shadowRadius: 15,
    shadowOpacity: 1,
  },
  projectile: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  projEmoji: {
    fontSize: 18,
  },
  particle: {
    position: 'absolute',
    borderRadius: 10,
  },
  floatingText: {
    position: 'absolute',
    fontSize: 14,
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
