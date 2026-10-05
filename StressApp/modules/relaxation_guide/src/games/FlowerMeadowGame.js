import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
  TouchableOpacity,
  Easing,
  ImageBackground,
  Vibration
} from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

const { width, height } = Dimensions.get('window');

// Color Palette
const PALETTE = {
  lotus: '#F472B6',
  lotusGlow: '#EC4899',
  breathIn: '#818CF8',
  breathHold: '#60A5FA',
  breathOut: '#34D399',
  breathRest: '#A78BFA',
  hudBg: 'rgba(15,10,26,0.85)',
  white: '#FFFFFF',
  gold: '#F59E0B',
};

// Breathing Timing (4-7-8 Protocol)
const BREATH_TIMING = {
  inhale: 4000,
  hold: 7000,
  exhale: 8000,
  rest: 2000,
};

// ---- UI-only constants (gamification layer) ----
const PHASE_ORDER = ['inhale', 'hold', 'exhale', 'rest'];
const PHASE_ICONS = { inhale: '🌱', hold: '🕊️', exhale: '🌺', rest: '🌙' };
const PHASE_COLORS = {
  inhale: PALETTE.breathIn,
  hold: PALETTE.breathHold,
  exhale: PALETTE.breathOut,
  rest: PALETTE.breathRest,
};
const XP_PER_LEVEL = 500;
const DAILY_GOAL_CYCLES = 4;
const LEVEL_TITLES = ['Seedling', 'Sprout', 'Budding', 'Blossom', 'Lotus Master'];

let _idCounter = 0;
const uid = () => `${Date.now()}_${++_idCounter}_${Math.random().toString(36).substr(2, 6)}`;
const rand = (min, max) => min + Math.random() * (max - min);

// ---------- Small animated UI pieces ----------

// Floating text that rises and fades out
const FloatingText = ({ text, color, x, y }) => {
  const rise = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(rise, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.Text
      pointerEvents="none"
      style={[
        styles.floatingText,
        {
          color,
          left: x,
          top: y,
          opacity: rise.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -70] }) },
            { scale: pop },
          ],
        },
      ]}
    >
      {text}
    </Animated.Text>
  );
};

// Ripple that expands from the tap point
const Ripple = ({ x, y }) => {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ripple,
        {
          left: x - 40,
          top: y - 40,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.2, 2.2] }) }],
        },
      ]}
    />
  );
};

// Flower that pops in and gently sways
const GardenFlower = ({ flw }) => {
  const grow = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(grow, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: rand(1800, 2800), easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: rand(1800, 2800), easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.gardenFlower,
        {
          left: flw.x,
          top: flw.y,
          transform: [
            { scale: Animated.multiply(grow, flw.scale) },
            { rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] }) },
          ],
        },
      ]}
    >
      <Text style={styles.gardenFlowerEmoji}>{flw.emoji}</Text>
    </Animated.View>
  );
};

export const FlowerMeadowGame = () => {
  // Game States
  const [breathPhase, setBreathPhase] = useState('inhale');
  const [cycleCount, setCycleCount] = useState(0);
  const [score, setScore] = useState(400);
  const [combo, setCombo] = useState(2);
  const [gardenFlowers, setGardenFlowers] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [dewDrops, setDewDrops] = useState([]);
  const [sessionStarted, setSessionStarted] = useState(true);

  // UI-only states
  const [countdown, setCountdown] = useState(BREATH_TIMING.inhale / 1000);
  const [ripples, setRipples] = useState([]);

  // Animations
  const bloomScale = useRef(new Animated.Value(0.7)).current;
  const bloomGlow = useRef(new Animated.Value(0.3)).current;
  const innerPulse = useRef(new Animated.Value(1)).current;
  const phaseTextAnim = useRef(new Animated.Value(1)).current;
  const comboBump = useRef(new Animated.Value(1)).current;
  const scoreBump = useRef(new Animated.Value(1)).current;
  const ambientDrift = useRef(new Animated.Value(0)).current;

  // Initialize interactive falling Dew Drops / Stardust
  useEffect(() => {
    const drops = [];
    for (let i = 0; i < 6; i++) {
      drops.push({
        id: uid(),
        x: rand(30, width - 60),
        y: rand(100, height * 0.4),
        emoji: ['💧', '✨', '🌸', '🪷', '🌟'][Math.floor(Math.random() * 5)],
        speed: rand(1, 2.5),
        scale: rand(0.8, 1.2),
      });
    }
    setDewDrops(drops);
  }, []);

  // Dew drop falling movement loop
  useEffect(() => {
    if (!sessionStarted) return;
    const interval = setInterval(() => {
      setDewDrops((prev) =>
        prev.map((drop) => {
          let nextY = drop.y + drop.speed;
          if (nextY > height * 0.6) {
            nextY = 80;
            drop.x = rand(30, width - 60);
          }
          return { ...drop, y: nextY };
        })
      );
    }, 40);
    return () => clearInterval(interval);
  }, [sessionStarted]);

  // UI: phase countdown (seconds left in the current breath phase)
  useEffect(() => {
    setCountdown(Math.round(BREATH_TIMING[breathPhase] / 1000));
    const tick = setInterval(() => {
      setCountdown((c) => (c > 1 ? c - 1 : 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [breathPhase]);

  // UI: slow ambient drift of the halo rings
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(ambientDrift, { toValue: 1, duration: 3500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ambientDrift, { toValue: 0, duration: 3500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // UI: bump animations when score / combo change
  useEffect(() => {
    Animated.sequence([
      Animated.timing(scoreBump, { toValue: 1.2, duration: 120, useNativeDriver: true }),
      Animated.spring(scoreBump, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [score]);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(comboBump, { toValue: 1.3, duration: 120, useNativeDriver: true }),
      Animated.spring(comboBump, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [combo]);

  // UI: celebrate every completed breath cycle
  useEffect(() => {
    if (cycleCount === 0) return;
    const reachedGoal = cycleCount % DAILY_GOAL_CYCLES === 0;
    spawnFloatingText(
      reachedGoal ? '🏆 Calm Goal Reached!' : '🌸 Cycle Complete!',
      PALETTE.gold,
      width / 2 - 80,
      height * 0.3
    );
    Vibration.vibrate(reachedGoal ? [0, 60, 40, 60, 40, 120] : 40);
  }, [cycleCount]);

  // Breathing Cycle Engine (4-7-8)
  useEffect(() => {
    let timer;
    Animated.sequence([
      Animated.timing(phaseTextAnim, { toValue: 1.15, duration: 200, useNativeDriver: true }),
      Animated.timing(phaseTextAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();

    switch (breathPhase) {
      case 'inhale': {
        Animated.parallel([
          Animated.timing(bloomScale, {
            toValue: 1.4,
            duration: BREATH_TIMING.inhale,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            useNativeDriver: true,
          }),
          Animated.timing(bloomGlow, {
            toValue: 1,
            duration: BREATH_TIMING.inhale,
            useNativeDriver: true,
          }),
        ]).start();

        timer = setTimeout(() => {
          setBreathPhase('hold');
          spawnFloatingText('🌬️ Hold Breath', PALETTE.breathHold, width / 2 - 50, height / 2 - 60);
        }, BREATH_TIMING.inhale);
        break;
      }

      case 'hold': {
        Animated.loop(
          Animated.sequence([
            Animated.timing(innerPulse, { toValue: 1.08, duration: 800, useNativeDriver: true }),
            Animated.timing(innerPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
          ]),
          { iterations: -1 }
        ).start();

        timer = setTimeout(() => {
          innerPulse.stopAnimation();
          setBreathPhase('exhale');
          spawnFloatingText('🌸 Exhale & Release', PALETTE.breathOut, width / 2 - 50, height / 2 - 60);
        }, BREATH_TIMING.hold);
        break;
      }

      case 'exhale': {
        Animated.parallel([
          Animated.timing(bloomScale, {
            toValue: 0.7,
            duration: BREATH_TIMING.exhale,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            useNativeDriver: true,
          }),
          Animated.timing(bloomGlow, {
            toValue: 0.3,
            duration: BREATH_TIMING.exhale,
            useNativeDriver: true,
          }),
        ]).start();

        timer = setTimeout(() => {
          setBreathPhase('rest');
          setCycleCount((c) => c + 1);
          plantFlower();
        }, BREATH_TIMING.exhale);
        break;
      }

      case 'rest': {
        timer = setTimeout(() => {
          setBreathPhase('inhale');
          spawnFloatingText('🌱 Deep Inhale', PALETTE.breathIn, width / 2 - 50, height / 2 - 60);
        }, BREATH_TIMING.rest);
        break;
      }

      default:
        break;
    }

    return () => clearTimeout(timer);
  }, [breathPhase]);

  const plantFlower = () => {
    const emojis = ['🌸', '🌺', '🌷', '🌻', '🌹', '🪷', '🌼'];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    setGardenFlowers((prev) => [
      ...prev.slice(-12),
      {
        id: uid(),
        emoji,
        x: rand(40, width - 80),
        y: rand(height * 0.52, height * 0.68),
        scale: rand(0.9, 1.3),
      },
    ]);
  };

  const spawnFloatingText = (text, color, x, y) => {
    const id = uid();
    setFloatingTexts((prev) => [...prev, { id, text, color, x, y }]);
    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter((t) => t.id !== id));
    }, 1500);
  };

  // UI: tap ripple
  const spawnRipple = (x, y) => {
    const id = uid();
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 800);
  };

  // Interactive Tap Handler (Catch Dew Drops & Stardust)
  const handleTouchScreen = (e) => {
    const touchX = e.nativeEvent.pageX || width / 2;
    const touchY = e.nativeEvent.pageY || height / 2;

    Vibration.vibrate(20);
    setScore((s) => s + 50);
    setCombo((c) => c + 1);
    spawnFloatingText('✨ +50 STARDUST!', '#F59E0B', touchX - 50, touchY - 30);
    spawnRipple(touchX, touchY);
    plantFlower();
  };

  // Tap Dew Drop
  const handleCatchDewDrop = (dropId, dropX, dropY) => {
    Vibration.vibrate([0, 30, 20, 30]);
    setScore((s) => s + 100);
    spawnFloatingText('💧 DEW CATCH +100!', '#38BDF8', dropX - 40, dropY - 20);
    spawnRipple(dropX + 22, dropY + 22);

    setDewDrops((prev) =>
      prev.map((d) => (d.id === dropId ? { ...d, y: 80, x: rand(30, width - 60) } : d))
    );
    plantFlower();
  };

  const getPhaseDetails = () => {
    switch (breathPhase) {
      case 'inhale':
        return { text: 'Inhale Deeply (4s)', sub: 'Expand with the blooming lotus', icon: '🌱', color: PALETTE.breathIn };
      case 'hold':
        return { text: 'Hold Breath (7s)', sub: 'Feel calm energy center inside', icon: '🕊️', color: PALETTE.breathHold };
      case 'exhale':
        return { text: 'Slow Exhale (8s)', sub: 'Release tension & bloom garden', icon: '🌺', color: PALETTE.breathOut };
      case 'rest':
        return { text: 'Rest & Relax (2s)', sub: 'Prepare for next calm wave', icon: '🌙', color: PALETTE.breathRest };
      default:
        return { text: 'Breathe', sub: 'Follow the bloom', icon: '🌸', color: PALETTE.lotus };
    }
  };

  const phase = getPhaseDetails();

  // UI-derived gamification values (no game logic changed)
  const level = Math.floor(score / XP_PER_LEVEL) + 1;
  const levelTitle = LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
  const xpPercent = ((score % XP_PER_LEVEL) / XP_PER_LEVEL) * 100;
  const goalDone = cycleCount % DAILY_GOAL_CYCLES;
  const haloOpacity = bloomGlow.interpolate({ inputRange: [0.3, 1], outputRange: [0.25, 0.75] });
  const driftScale = ambientDrift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <TouchableWithoutFeedback onPress={handleTouchScreen}>
      <View style={styles.container}>
        {/* Rich Background Image Asset */}
        <ImageBackground
          source={require('../assets/zen_garden_bg.png')}
          style={styles.bgImage}
          resizeMode="cover"
        >
          <View style={styles.overlayShade} />

          {/* ===== Top HUD: level, XP, score, combo, daily goal ===== */}
          <View style={styles.hud} pointerEvents="none">
            <View style={styles.hudRow}>
              <View style={styles.levelBlock}>
                <View style={styles.levelBadge}>
                  <Text style={styles.levelBadgeNum}>{level}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.levelTitle}>{levelTitle}</Text>
                  <View style={styles.xpTrack}>
                    <View style={[styles.xpFill, { width: `${xpPercent}%` }]} />
                  </View>
                  <Text style={styles.xpLabel}>
                    {score % XP_PER_LEVEL} / {XP_PER_LEVEL} Zen XP
                  </Text>
                </View>
              </View>

              <View style={styles.statsCol}>
                <Animated.View style={[styles.statPill, { transform: [{ scale: scoreBump }] }]}>
                  <Text style={styles.statPillText}>✨ {score}</Text>
                </Animated.View>
                <Animated.View
                  style={[styles.statPill, styles.comboPill, { transform: [{ scale: comboBump }] }]}
                >
                  <Text style={styles.statPillText}>🔥 x{combo}</Text>
                </Animated.View>
              </View>
            </View>

            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Calm goal</Text>
              <View style={styles.goalDots}>
                {Array.from({ length: DAILY_GOAL_CYCLES }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.goalDot,
                      i < goalDone && { backgroundColor: PALETTE.gold, borderColor: PALETTE.gold },
                    ]}
                  >
                    {i < goalDone && <Text style={styles.goalDotCheck}>🌸</Text>}
                  </View>
                ))}
              </View>
              <Text style={styles.goalLabel}>
                {goalDone}/{DAILY_GOAL_CYCLES}
              </Text>
            </View>
          </View>

          {/* Floating Interactive Dew Drops / Stardust */}
          {dewDrops.map((drop) => (
            <TouchableOpacity
              key={drop.id}
              style={[
                styles.dewDrop,
                {
                  left: drop.x,
                  top: drop.y,
                  transform: [{ scale: drop.scale }],
                },
              ]}
              onPress={() => handleCatchDewDrop(drop.id, drop.x, drop.y)}
              activeOpacity={0.7}
            >
              <Text style={styles.dewEmoji}>{drop.emoji}</Text>
            </TouchableOpacity>
          ))}

          {/* Planted Flowers Sanctuary */}
          {gardenFlowers.map((flw) => (
            <GardenFlower key={flw.id} flw={flw} />
          ))}

          {/* Center Interactive Blooming Lotus */}
          <View style={styles.bloomCenter} pointerEvents="none">
            {/* Outer breathing halo rings */}
            <Animated.View
              style={[
                styles.haloRing,
                styles.haloOuter,
                {
                  borderColor: phase.color,
                  opacity: Animated.multiply(haloOpacity, 0.5),
                  transform: [{ scale: Animated.multiply(Animated.multiply(bloomScale, 1.45), driftScale) }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.haloRing,
                styles.haloMid,
                {
                  borderColor: phase.color,
                  opacity: haloOpacity,
                  transform: [{ scale: Animated.multiply(bloomScale, 1.2) }],
                },
              ]}
            />

            <Animated.View
              style={[
                styles.bloomGlowCircle,
                {
                  borderColor: phase.color,
                  shadowColor: phase.color,
                  transform: [{ scale: Animated.multiply(bloomScale, innerPulse) }],
                },
              ]}
            >
              <Text style={styles.centerFlowerEmoji}>🌸</Text>
            </Animated.View>

            {/* Phase countdown badge */}
            <View style={[styles.countdownBadge, { borderColor: phase.color }]}>
              <Text style={[styles.countdownText, { color: phase.color }]}>{countdown}</Text>
            </View>
          </View>

          {/* Tap ripples */}
          {ripples.map((r) => (
            <Ripple key={r.id} x={r.x} y={r.y} />
          ))}

          {/* Floating Text Animations */}
          {floatingTexts.map((txt) => (
            <FloatingText key={txt.id} text={txt.text} color={txt.color} x={txt.x} y={txt.y} />
          ))}

          {/* Breath Phase Card Banner */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.phaseCard,
              {
                borderColor: phase.color,
                transform: [{ scale: phaseTextAnim }],
              },
            ]}
          >
            {/* Phase journey tracker */}
            <View style={styles.phaseTracker}>
              {PHASE_ORDER.map((p) => {
                const active = p === breathPhase;
                return (
                  <View
                    key={p}
                    style={[
                      styles.trackerStep,
                      active && { backgroundColor: PHASE_COLORS[p], borderColor: PHASE_COLORS[p] },
                    ]}
                  >
                    <Text style={[styles.trackerIcon, !active && { opacity: 0.5 }]}>{PHASE_ICONS[p]}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.phaseMainRow}>
              <Text style={{ fontSize: 28 }}>{phase.icon}</Text>
              <View style={styles.phaseTextBlock}>
                <Text style={[styles.phaseTitle, { color: phase.color }]}>{phase.text}</Text>
                <Text style={styles.phaseSub}>{phase.sub}</Text>
              </View>
              <View style={styles.cycleBadge}>
                <Text style={styles.cycleTxt}>🌸 {cycleCount} Cycles</Text>
              </View>
            </View>
          </Animated.View>

          {/* Bottom Interactive Hint */}
          <View style={styles.controlHint} pointerEvents="none">
            <Text style={styles.controlHintText}>
              👇 Tap falling dew drops & screen to plant flowers & boost Zen XP!
            </Text>
            <Text style={styles.controlHintSub}>
              🌸 {gardenFlowers.length} flowers bloomed in your sanctuary
            </Text>
          </View>
        </ImageBackground>
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  bgImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlayShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },

  // ---- HUD ----
  hud: {
    position: 'absolute',
    top: 44,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  hudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  levelBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  levelBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PALETTE.lotusGlow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FBCFE8',
  },
  levelBadgeNum: {
    color: PALETTE.white,
    fontSize: 18,
    fontWeight: '900',
  },
  levelTitle: {
    color: '#FBCFE8',
    fontSize: 13,
    fontWeight: '800',
  },
  xpTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginTop: 4,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: PALETTE.gold,
  },
  xpLabel: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  statsCol: {
    alignItems: 'flex-end',
    gap: 5,
  },
  statPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: PALETTE.gold,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  comboPill: {
    backgroundColor: 'rgba(236, 72, 153, 0.22)',
    borderColor: PALETTE.lotusGlow,
  },
  statPillText: {
    color: PALETTE.white,
    fontSize: 12,
    fontWeight: '900',
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 9,
    gap: 8,
  },
  goalLabel: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '800',
  },
  goalDots: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  goalDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalDotCheck: {
    fontSize: 12,
  },

  // ---- Dew drops ----
  dewDrop: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    elevation: 6,
    shadowColor: '#38BDF8',
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  dewEmoji: {
    fontSize: 24,
  },
  gardenFlower: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gardenFlowerEmoji: {
    fontSize: 28,
  },

  // ---- Lotus ----
  bloomCenter: {
    position: 'absolute',
    left: '50%',
    marginLeft: -80,
    top: '40%',
    marginTop: -80,
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  haloRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  haloOuter: {
    borderWidth: 1.5,
    backgroundColor: 'rgba(129, 140, 248, 0.06)',
  },
  haloMid: {
    borderWidth: 2.5,
    backgroundColor: 'rgba(244, 114, 182, 0.08)',
  },
  bloomGlowCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(244, 114, 182, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3.5,
    elevation: 12,
    shadowOpacity: 0.9,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  centerFlowerEmoji: {
    fontSize: 64,
  },
  countdownBadge: {
    position: 'absolute',
    bottom: -46,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    fontSize: 18,
    fontWeight: '900',
  },
  ripple: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2.5,
    borderColor: '#FDE68A',
    backgroundColor: 'rgba(253, 230, 138, 0.15)',
  },
  floatingText: {
    position: 'absolute',
    fontSize: 16,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },

  // ---- Phase card ----
  phaseCard: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 2,
    gap: 8,
    minWidth: 280,
    elevation: 8,
  },
  phaseTracker: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  trackerStep: {
    width: 34,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackerIcon: {
    fontSize: 12,
  },
  phaseMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  phaseTextBlock: {
    flex: 1,
  },
  phaseTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  phaseSub: {
    color: '#CBD5E1',
    fontSize: 11,
    marginTop: 2,
  },
  cycleBadge: {
    backgroundColor: '#EC4899',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cycleTxt: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  controlHint: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  controlHintText: {
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  controlHintSub: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
});

export default FlowerMeadowGame;