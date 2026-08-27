import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
  TouchableOpacity,
  Easing,
  Platform,
} from 'react-native';

const { width, height } = Dimensions.get('window');
const CENTER_X = width / 2;
const CENTER_Y = height / 2 - 30;

/* ═══════════════════════════════════════════════════════
   PREMIUM FLOWER MEADOW – Healthcare Relaxation Game
   ═══════════════════════════════════════════════════════ */

// ─── Color Palette ───────────────────────────────────
const PALETTE = {
  // Sky gradient layers (dawn → dusk cycle)
  skyTop:     '#0B0D2E',
  skyMid:     '#1A1040',
  skyBottom:  '#2D1B69',
  // Meadow ground
  ground:     '#0D1117',
  groundGlow: '#1A2332',
  // Accent
  lotus:      '#F472B6',
  lotusGlow:  '#EC4899',
  petalPink:  '#F9A8D4',
  petalLav:   '#C4B5FD',
  petalGold:  '#FDE68A',
  breathIn:   '#818CF8',
  breathHold: '#60A5FA',
  breathOut:  '#34D399',
  breathRest: '#A78BFA',
  // HUD
  hudBg:      'rgba(15,10,26,0.85)',
  hudBorder:  'rgba(255,255,255,0.08)',
  textMuted:  '#64748B',
  textDim:    '#94A3B8',
  white:      '#FFFFFF',
  danger:     '#EF4444',
  gold:       '#F59E0B',
  emerald:    '#10B981',
};

// ─── Flower Species (unlockable) ─────────────────────
const FLOWER_SPECIES = [
  { id: 'cherry',    emoji: '🌸', name: 'Cherry Blossom', color: '#F9A8D4', unlock: 0 },
  { id: 'hibiscus',  emoji: '🌺', name: 'Hibiscus',      color: '#F472B6', unlock: 0 },
  { id: 'tulip',     emoji: '🌷', name: 'Tulip',         color: '#FB7185', unlock: 2 },
  { id: 'sunflower', emoji: '🌻', name: 'Sunflower',     color: '#FBBF24', unlock: 3 },
  { id: 'rose',      emoji: '🌹', name: 'Rose',          color: '#F43F5E', unlock: 5 },
  { id: 'daisy',     emoji: '🌼', name: 'Daisy',         color: '#FDE68A', unlock: 7 },
  { id: 'bouquet',   emoji: '💐', name: 'Bouquet',       color: '#C084FC', unlock: 10 },
  { id: 'lotus',     emoji: '🪷', name: 'Sacred Lotus',  color: '#E879F9', unlock: 15 },
];

// ─── Breathing Timing (4-7-8 Medical Protocol) ──────
const BREATH_TIMING = {
  inhale:  4000,
  hold:    7000,
  exhale:  8000,
  rest:    2000,
};
const TOTAL_CYCLE_MS = BREATH_TIMING.inhale + BREATH_TIMING.hold + BREATH_TIMING.exhale + BREATH_TIMING.rest;

// ─── Helper: generate unique ID ─────────────────────
let _idCounter = 0;
const uid = () => `${Date.now()}_${++_idCounter}_${Math.random().toString(36).substr(2, 6)}`;

// ─── Helper: random in range ────────────────────────
const rand = (min, max) => min + Math.random() * (max - min);

/* ═══════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════ */
export const FlowerMeadowGame = () => {
  // ── State ──────────────────────────────────────────
  const [breathPhase, setBreathPhase] = useState('ready');
  const [cycleCount, setCycleCount] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [perfectBreaths, setPerfectBreaths] = useState(0);
  const [calmMeter, setCalmMeter] = useState(0);       // 0–100
  const [gardenFlowers, setGardenFlowers] = useState([]); // planted flowers
  const [petals, setPetals] = useState([]);
  const [fireflies, setFireflies] = useState([]);
  const [particles, setParticles] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [pollenDots, setPollenDots] = useState([]);
  const [stars, setStars] = useState([]);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [showTutorial, setShowTutorial] = useState(true);

  // ── Animation refs ─────────────────────────────────
  const bloomScale      = useRef(new Animated.Value(0.6)).current;
  const bloomGlow       = useRef(new Animated.Value(0)).current;
  const bloomRotate     = useRef(new Animated.Value(0)).current;
  const petalRingScale  = useRef(new Animated.Value(0.4)).current;
  const innerPulse      = useRef(new Animated.Value(1)).current;
  const calmBarWidth    = useRef(new Animated.Value(0)).current;
  const skyHue          = useRef(new Animated.Value(0)).current;
  const groundGlow      = useRef(new Animated.Value(0)).current;
  const tutorialOpacity = useRef(new Animated.Value(1)).current;
  const breathRingAnim  = useRef(new Animated.Value(0)).current;
  const phaseTextAnim   = useRef(new Animated.Value(0)).current;

  // ── Refs ───────────────────────────────────────────
  const breathPhaseRef = useRef(breathPhase);
  const comboRef       = useRef(combo);
  const cycleRef       = useRef(cycleCount);
  useEffect(() => { breathPhaseRef.current = breathPhase; }, [breathPhase]);
  useEffect(() => { comboRef.current = combo; }, [combo]);
  useEffect(() => { cycleRef.current = cycleCount; }, [cycleCount]);

  // ════════════════════════════════════════════════════
  //  INITIALISATION – stars, fireflies, initial garden
  // ════════════════════════════════════════════════════
  useEffect(() => {
    // Stars
    const s = [];
    for (let i = 0; i < 60; i++) {
      s.push({
        id: uid(),
        x: rand(0, width),
        y: rand(0, height * 0.55),
        size: rand(1, 3),
        twinkle: rand(0.3, 1),
        speed: rand(0.005, 0.02),
        phase: rand(0, Math.PI * 2),
      });
    }
    setStars(s);

    // Initial fireflies
    const ff = [];
    for (let i = 0; i < 6; i++) {
      ff.push(createFirefly());
    }
    setFireflies(ff);

    // Pollen dots (ambient)
    const pd = [];
    for (let i = 0; i < 20; i++) {
      pd.push({
        id: uid(),
        x: rand(0, width),
        y: rand(height * 0.5, height),
        size: rand(2, 5),
        opacity: rand(0.15, 0.45),
        speed: rand(0.2, 0.8),
        drift: rand(-0.3, 0.3),
        phase: rand(0, Math.PI * 2),
      });
    }
    setPollenDots(pd);
  }, []);

  // ── Factory: firefly ───────────────────────────────
  const createFirefly = useCallback(() => ({
    id: uid(),
    x: rand(20, width - 20),
    y: rand(height * 0.3, height * 0.85),
    targetX: rand(20, width - 20),
    targetY: rand(height * 0.3, height * 0.85),
    size: rand(3, 7),
    glow: rand(0.4, 1),
    color: `hsl(${rand(40, 65)}, 100%, ${rand(70, 90)}%)`,
    speed: rand(0.3, 0.8),
    pulsePhase: rand(0, Math.PI * 2),
  }), []);

  // ════════════════════════════════════════════════════
  //  SESSION TIMER
  // ════════════════════════════════════════════════════
  useEffect(() => {
    if (!sessionStarted) return;
    const iv = setInterval(() => setElapsedSec(p => p + 1), 1000);
    return () => clearInterval(iv);
  }, [sessionStarted]);

  // ════════════════════════════════════════════════════
  //  START SESSION
  // ════════════════════════════════════════════════════
  const startSession = useCallback(() => {
    setSessionStarted(true);
    setShowTutorial(false);
    Animated.timing(tutorialOpacity, {
      toValue: 0,
      duration: 600,
      useNativeDriver: true,
    }).start(() => setBreathPhase('inhale'));
  }, []);

  // ════════════════════════════════════════════════════
  //  BREATHING ENGINE
  // ════════════════════════════════════════════════════
  useEffect(() => {
    if (breathPhase === 'ready') return;
    let timer;

    // Phase text pop-in animation
    Animated.sequence([
      Animated.timing(phaseTextAnim, { toValue: 1.15, duration: 200, useNativeDriver: true }),
      Animated.timing(phaseTextAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();

    switch (breathPhase) {
      case 'inhale': {
        // Bloom expands, glow rises, petals fan out
        Animated.parallel([
          Animated.timing(bloomScale, {
            toValue: 1.5,
            duration: BREATH_TIMING.inhale,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            useNativeDriver: true,
          }),
          Animated.timing(bloomGlow, {
            toValue: 1,
            duration: BREATH_TIMING.inhale,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(petalRingScale, {
            toValue: 1.2,
            duration: BREATH_TIMING.inhale,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            useNativeDriver: true,
          }),
          Animated.timing(breathRingAnim, {
            toValue: 1,
            duration: BREATH_TIMING.inhale,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(groundGlow, {
            toValue: 0.6,
            duration: BREATH_TIMING.inhale,
            useNativeDriver: true,
          }),
        ]).start();

        // Slow rotation
        Animated.timing(bloomRotate, {
          toValue: 1,
          duration: BREATH_TIMING.inhale,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start();

        timer = setTimeout(() => {
          setBreathPhase('hold');
          spawnPhaseText('🌬️ Hold Breath', PALETTE.breathHold);
        }, BREATH_TIMING.inhale);
        break;
      }

      case 'hold': {
        // Gentle pulse during hold
        Animated.loop(
          Animated.sequence([
            Animated.timing(innerPulse, {
              toValue: 1.08,
              duration: 800,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(innerPulse, {
              toValue: 1,
              duration: 800,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          { iterations: -1 }
        ).start();

        // Intensify glow
        Animated.timing(bloomGlow, {
          toValue: 1.5,
          duration: BREATH_TIMING.hold,
          useNativeDriver: true,
        }).start();

        timer = setTimeout(() => {
          innerPulse.stopAnimation();
          innerPulse.setValue(1);
          setBreathPhase('exhale');
          spawnPhaseText('🌺 Exhale Slowly', PALETTE.breathOut);
        }, BREATH_TIMING.hold);
        break;
      }

      case 'exhale': {
        // Contract, dim, release petal burst
        Animated.parallel([
          Animated.timing(bloomScale, {
            toValue: 0.7,
            duration: BREATH_TIMING.exhale,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            useNativeDriver: true,
          }),
          Animated.timing(bloomGlow, {
            toValue: 0.25,
            duration: BREATH_TIMING.exhale,
            useNativeDriver: true,
          }),
          Animated.timing(petalRingScale, {
            toValue: 0.5,
            duration: BREATH_TIMING.exhale,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            useNativeDriver: true,
          }),
          Animated.timing(breathRingAnim, {
            toValue: 0,
            duration: BREATH_TIMING.exhale,
            useNativeDriver: true,
          }),
          Animated.timing(groundGlow, {
            toValue: 0.2,
            duration: BREATH_TIMING.exhale,
            useNativeDriver: true,
          }),
        ]).start();

        // Spawn petal shower
        spawnPetalShower(12);

        timer = setTimeout(() => {
          setBreathPhase('rest');
          const c = cycleRef.current + 1;
          setCycleCount(c);

          // Cycle completion bonus
          const bonus = 50 + perfectBreaths * 3;
          setScore(prev => prev + bonus);
          setCalmMeter(prev => Math.min(100, prev + 8));

          // Plant a flower in the garden
          plantGardenFlower(c);

          spawnPhaseText(`🌿 +${bonus} Cycle Complete!`, PALETTE.breathRest);
          createParticles(CENTER_X, CENTER_Y, 50, PALETTE.petalPink);
        }, BREATH_TIMING.exhale);
        break;
      }

      case 'rest': {
        timer = setTimeout(() => {
          setBreathPhase('inhale');
          bloomRotate.setValue(0);
          spawnPhaseText('🌱 Breathe In...', PALETTE.breathIn);
        }, BREATH_TIMING.rest);
        break;
      }

      default:
        break;
    }

    return () => { if (timer) clearTimeout(timer); };
  }, [breathPhase]);

  // ── Calm meter bar animation ───────────────────────
  useEffect(() => {
    Animated.spring(calmBarWidth, {
      toValue: calmMeter,
      friction: 8,
      tension: 40,
      useNativeDriver: false,
    }).start();
  }, [calmMeter]);

  // ════════════════════════════════════════════════════
  //  GARDEN PLANTING
  // ════════════════════════════════════════════════════
  const plantGardenFlower = useCallback((cycle) => {
    const available = FLOWER_SPECIES.filter(f => f.unlock <= cycle);
    const species = available[Math.floor(Math.random() * available.length)];

    // Place along bottom meadow strip
    const gardenY = height * 0.78 + rand(0, height * 0.12);
    const gardenX = rand(20, width - 40);

    setGardenFlowers(prev => [...prev, {
      id: uid(),
      species,
      x: gardenX,
      y: gardenY,
      size: rand(20, 34),
      growthStage: 0, // will animate to 1
      swayPhase: rand(0, Math.PI * 2),
    }]);
  }, []);

  // ════════════════════════════════════════════════════
  //  TOUCH INTERACTION
  // ════════════════════════════════════════════════════
  const handleTouch = useCallback((evt) => {
    if (!sessionStarted) return;
    const { locationX, locationY } = evt.nativeEvent;

    // Particle burst at touch point
    createParticles(locationX, locationY, 25, PALETTE.petalPink);

    const phase = breathPhaseRef.current;
    if (phase === 'exhale' || phase === 'hold') {
      const bonus = phase === 'exhale' ? 30 : 18;
      const comboMult = Math.floor(comboRef.current / 3) + 1;
      const points = bonus * comboMult;

      setScore(prev => prev + points);
      setCombo(prev => prev + 1);
      setCalmMeter(prev => Math.min(100, prev + 2));

      if (phase === 'exhale') {
        setPerfectBreaths(prev => prev + 1);
      }

      spawnFloatingText(locationX - 30, locationY - 50, `✨ +${points}`,
        phase === 'exhale' ? PALETTE.breathOut : PALETTE.petalGold);

      // Combo milestone
      if (comboRef.current > 0 && comboRef.current % 5 === 0) {
        spawnFloatingText(locationX - 60, locationY - 90,
          `🌸 ${comboRef.current + 1}x BLOOM!`, PALETTE.lotusGlow);
        createParticles(locationX, locationY, 45, PALETTE.lotus);
      }

      // Bloom pop animation
      Animated.sequence([
        Animated.timing(bloomScale, { toValue: bloomScale._value * 1.15, duration: 120, useNativeDriver: true }),
        Animated.timing(bloomScale, { toValue: bloomScale._value, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      spawnFloatingText(locationX - 25, locationY - 30, '⏳ Wait...', PALETTE.textMuted);
      setCombo(0);
    }
  }, [sessionStarted]);

  // ════════════════════════════════════════════════════
  //  PARTICLE / TEXT FACTORIES
  // ════════════════════════════════════════════════════
  const createParticles = useCallback((x, y, count, baseColor) => {
    const batch = [];
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const vel = rand(1, 6);
      const hueShift = rand(-20, 20);
      batch.push({
        id: uid(),
        x, y,
        vx: Math.cos(angle) * vel,
        vy: Math.sin(angle) * vel - 2,
        life: 1,
        size: rand(2, 8),
        color: baseColor || `hsl(${320 + hueShift}, 80%, ${60 + rand(0, 25)}%)`,
        gravity: rand(0.03, 0.07),
        glow: rand(0.3, 0.8),
      });
    }
    setParticles(prev => [...prev, ...batch]);
  }, []);

  const spawnFloatingText = useCallback((x, y, text, color) => {
    setFloatingTexts(prev => [...prev, {
      id: uid(), x, y, text, color,
      opacity: 1, vy: -1.2 - rand(0, 1), scale: 1,
    }]);
  }, []);

  const spawnPhaseText = useCallback((text, color) => {
    spawnFloatingText(CENTER_X - 80, CENTER_Y - 130, text, color);
  }, []);

  const spawnPetalShower = useCallback((count) => {
    const batch = [];
    for (let i = 0; i < count; i++) {
      batch.push({
        id: uid(),
        x: rand(0, width),
        y: -rand(10, 40),
        size: rand(8, 16),
        speed: rand(0.6, 1.8),
        wobble: rand(-1.5, 1.5),
        rotation: rand(0, 360),
        color: [PALETTE.petalPink, PALETTE.petalLav, PALETTE.petalGold, PALETTE.lotus][Math.floor(rand(0, 4))],
        opacity: rand(0.45, 0.85),
      });
    }
    setPetals(prev => [...prev, ...batch]);
  }, []);

  // ════════════════════════════════════════════════════
  //  ANIMATION LOOPS
  // ════════════════════════════════════════════════════

  // ── Stars twinkle ──────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setStars(prev => prev.map(s => ({
        ...s,
        twinkle: 0.3 + Math.abs(Math.sin(Date.now() * s.speed + s.phase)) * 0.7,
      })));
    }, 80);
    return () => clearInterval(iv);
  }, []);

  // ── Fireflies ──────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setFireflies(prev => {
        let arr = prev.map(f => {
          const dx = f.targetX - f.x;
          const dy = f.targetY - f.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 8) {
            return { ...f, targetX: rand(20, width - 20), targetY: rand(height * 0.3, height * 0.85), pulsePhase: f.pulsePhase + 0.15 };
          }
          return {
            ...f,
            x: f.x + (dx / dist) * f.speed,
            y: f.y + (dy / dist) * f.speed + Math.sin(Date.now() * 0.003 + f.pulsePhase) * 0.3,
            glow: 0.3 + Math.abs(Math.sin(Date.now() * 0.004 + f.pulsePhase)) * 0.7,
            pulsePhase: f.pulsePhase + 0.05,
          };
        });
        // Spawn new fireflies up to 10
        if (arr.length < 10 && Math.random() < 0.02) {
          arr.push(createFirefly());
        }
        return arr;
      });
    }, 40);
    return () => clearInterval(iv);
  }, [createFirefly]);

  // ── Petals fall ────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setPetals(prev => prev.map(p => ({
        ...p,
        y: p.y + p.speed,
        x: p.x + Math.sin(Date.now() * 0.001 + p.wobble) * 0.6,
        rotation: p.rotation + 0.8,
        opacity: p.opacity - 0.002,
      })).filter(p => p.y < height + 30 && p.opacity > 0));
    }, 16);
    return () => clearInterval(iv);
  }, []);

  // ── Ambient petal spawn ────────────────────────────
  useEffect(() => {
    if (!sessionStarted) return;
    const iv = setInterval(() => {
      if (petals.length < 18) {
        spawnPetalShower(1);
      }
    }, 3500);
    return () => clearInterval(iv);
  }, [sessionStarted, petals.length]);

  // ── Particles physics ─────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setParticles(prev => prev.map(p => ({
        ...p,
        x: p.x + p.vx,
        y: p.y + p.vy,
        vy: p.vy + p.gravity,
        life: p.life - 0.018,
        size: p.size * 0.985,
      })).filter(p => p.life > 0));
    }, 16);
    return () => clearInterval(iv);
  }, []);

  // ── Floating texts ─────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setFloatingTexts(prev => prev.map(t => ({
        ...t,
        y: t.y + t.vy,
        opacity: t.opacity - 0.015,
        scale: t.scale + 0.005,
      })).filter(t => t.opacity > 0));
    }, 16);
    return () => clearInterval(iv);
  }, []);

  // ── Pollen drift ───────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setPollenDots(prev => prev.map(p => ({
        ...p,
        x: p.x + p.drift + Math.sin(Date.now() * 0.0008 + p.phase) * 0.3,
        y: p.y - p.speed * 0.3,
        opacity: 0.15 + Math.abs(Math.sin(Date.now() * 0.002 + p.phase)) * 0.3,
      })).map(p => p.y < height * 0.4 ? { ...p, y: height + 10, x: rand(0, width) } : p));
    }, 40);
    return () => clearInterval(iv);
  }, []);

  // ── Garden flower growth animation ─────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setGardenFlowers(prev => prev.map(f => ({
        ...f,
        growthStage: Math.min(1, f.growthStage + 0.02),
        swayPhase: f.swayPhase + 0.03,
      })));
    }, 40);
    return () => clearInterval(iv);
  }, []);

  // ════════════════════════════════════════════════════
  //  DERIVED STATE
  // ════════════════════════════════════════════════════
  const getPhaseConfig = () => {
    switch (breathPhase) {
      case 'inhale': return { icon: '🌱', text: 'Breathe In', sub: 'Expand with the flower', color: PALETTE.breathIn, ring: 'rgba(129,140,248,0.3)' };
      case 'hold':   return { icon: '🕊️', text: 'Hold',       sub: 'Embrace the stillness',  color: PALETTE.breathHold, ring: 'rgba(96,165,250,0.3)' };
      case 'exhale': return { icon: '🌺', text: 'Breathe Out', sub: 'Release and bloom',      color: PALETTE.breathOut, ring: 'rgba(52,211,153,0.3)' };
      case 'rest':   return { icon: '🌙', text: 'Rest',        sub: 'Prepare for next cycle', color: PALETTE.breathRest, ring: 'rgba(167,139,250,0.3)' };
      default:       return { icon: '🌸', text: 'Ready',       sub: 'Tap to begin',           color: PALETTE.petalPink, ring: 'rgba(244,114,182,0.2)' };
    }
  };

  const phase = getPhaseConfig();
  const formattedTime = `${Math.floor(elapsedSec / 60).toString().padStart(2, '0')}:${(elapsedSec % 60).toString().padStart(2, '0')}`;
  const calmLevel = calmMeter >= 80 ? 'Deep Calm' : calmMeter >= 50 ? 'Relaxing' : calmMeter >= 25 ? 'Settling' : 'Warming Up';
  const calmColor = calmMeter >= 80 ? PALETTE.emerald : calmMeter >= 50 ? PALETTE.breathOut : calmMeter >= 25 ? PALETTE.gold : PALETTE.textDim;

  // ════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════
  return (
    <TouchableWithoutFeedback onPress={sessionStarted ? handleTouch : startSession}>
      <View style={styles.container}>

        {/* ─── Layer 0: Night Sky ───────────────── */}
        <View style={styles.sky}>
          <View style={[styles.skyLayer, { backgroundColor: PALETTE.skyTop, opacity: 0.95 }]} />
          <View style={[styles.skyLayer, { backgroundColor: PALETTE.skyMid, opacity: 0.5, top: '30%' }]} />
          <View style={[styles.skyLayer, { backgroundColor: PALETTE.skyBottom, opacity: 0.35, top: '55%' }]} />
        </View>

        {/* ─── Layer 1: Stars ──────────────────── */}
        {stars.map(s => (
          <View
            key={s.id}
            style={[styles.star, {
              left: s.x,
              top: s.y,
              width: s.size,
              height: s.size,
              borderRadius: s.size / 2,
              opacity: s.twinkle,
              backgroundColor: '#fff',
              shadowColor: '#E0E7FF',
              shadowRadius: s.size * 3,
              shadowOpacity: s.twinkle * 0.8,
            }]}
          />
        ))}

        {/* ─── Layer 2: Ground / Meadow ────────── */}
        <Animated.View style={[styles.ground, { opacity: groundGlow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }]}>
          <View style={styles.groundGradient} />
          <View style={styles.groundHighlight} />
        </Animated.View>

        {/* ─── Layer 3: Pollen Dots ────────────── */}
        {pollenDots.map(p => (
          <View
            key={p.id}
            style={[styles.pollenDot, {
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              opacity: p.opacity,
              backgroundColor: PALETTE.petalGold,
              shadowColor: PALETTE.petalGold,
              shadowRadius: p.size * 2,
              shadowOpacity: p.opacity,
            }]}
          />
        ))}

        {/* ─── Layer 4: Garden Flowers ─────────── */}
        {gardenFlowers.map(f => (
          <View
            key={f.id}
            style={[styles.gardenFlower, {
              left: f.x,
              top: f.y,
              transform: [
                { scale: f.growthStage },
                { rotate: `${Math.sin(f.swayPhase) * 5}deg` },
              ],
              opacity: 0.4 + f.growthStage * 0.6,
            }]}
          >
            {/* Stem */}
            <View style={[styles.flowerStem, { height: f.size * 0.8 * f.growthStage }]} />
            {/* Bloom */}
            <Text style={{ fontSize: f.size, textAlign: 'center' }}>{f.species.emoji}</Text>
            {/* Glow */}
            <View style={[styles.flowerGlowDot, {
              backgroundColor: f.species.color,
              shadowColor: f.species.color,
              shadowRadius: 8,
              shadowOpacity: 0.5 * f.growthStage,
              opacity: 0.4 * f.growthStage,
            }]} />
          </View>
        ))}

        {/* ─── Layer 5: Fireflies ──────────────── */}
        {fireflies.map(f => (
          <View
            key={f.id}
            style={[styles.firefly, {
              left: f.x - f.size / 2,
              top: f.y - f.size / 2,
              width: f.size,
              height: f.size,
              borderRadius: f.size / 2,
              backgroundColor: f.color,
              opacity: f.glow,
              shadowColor: f.color,
              shadowRadius: f.size * 4,
              shadowOpacity: f.glow,
            }]}
          />
        ))}

        {/* ─── Layer 6: Falling Petals ─────────── */}
        {petals.map(p => (
          <View
            key={p.id}
            style={[styles.petal, {
              left: p.x - p.size / 2,
              top: p.y - p.size / 2,
              width: p.size,
              height: p.size * 0.65,
              backgroundColor: p.color,
              opacity: p.opacity,
              borderRadius: p.size / 2,
              transform: [{ rotate: `${p.rotation}deg` }, { scaleY: 0.7 }],
              shadowColor: p.color,
              shadowRadius: 4,
              shadowOpacity: 0.4,
            }]}
          />
        ))}

        {/* ─── Layer 7: Particles ──────────────── */}
        {particles.map(p => (
          <View
            key={p.id}
            style={[styles.particle, {
              left: p.x - p.size / 2,
              top: p.y - p.size / 2,
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: p.color,
              opacity: p.life,
              shadowColor: p.color,
              shadowRadius: p.size * 2,
              shadowOpacity: p.life * p.glow,
            }]}
          />
        ))}

        {/* ─── Layer 8: Floating Texts ─────────── */}
        {floatingTexts.map(t => (
          <Text
            key={t.id}
            style={[styles.floatingText, {
              left: t.x,
              top: t.y,
              opacity: t.opacity,
              color: t.color,
              transform: [{ scale: t.scale }],
            }]}
          >
            {t.text}
          </Text>
        ))}

        {/* ═══════════════════════════════════════
            CENTRAL BLOOM MANDALA
            ═══════════════════════════════════════ */}
        <View style={styles.bloomCenter}>
          {/* Outer breath ring */}
          <Animated.View style={[styles.breathRing, {
            borderColor: phase.color,
            opacity: breathRingAnim.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.5] }),
            transform: [
              { scale: bloomScale.interpolate({ inputRange: [0.6, 1.5], outputRange: [1.3, 2.2] }) },
            ],
          }]} />

          {/* Outer glow halo */}
          <Animated.View style={[styles.outerGlow, {
            opacity: bloomGlow.interpolate({ inputRange: [0, 1.5], outputRange: [0.1, 0.6] }),
            backgroundColor: phase.ring,
            transform: [{ scale: bloomScale.interpolate({ inputRange: [0.6, 1.5], outputRange: [1.2, 2] }) }],
          }]} />

          {/* Petal ring (outer orbit) */}
          <Animated.View style={[styles.petalRing, {
            transform: [
              { scale: petalRingScale },
              { rotate: bloomRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
            ],
          }]}>
            {['🌸', '🌷', '🌹', '🌻', '🌸', '🌷', '🌼', '🌺'].map((emoji, i) => (
              <View
                key={i}
                style={[styles.orbitPetal, {
                  transform: [
                    { rotate: `${i * 45}deg` },
                    { translateX: 75 },
                  ],
                }]}
              >
                <Text style={{ fontSize: 22 }}>{emoji}</Text>
              </View>
            ))}
          </Animated.View>

          {/* Main bloom body */}
          <Animated.View style={[styles.bloomBody, {
            transform: [
              { scale: Animated.multiply(bloomScale, innerPulse) },
              { rotate: bloomRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
            ],
          }]}>
            <Animated.View style={[styles.bloomGlowCircle, {
              opacity: bloomGlow,
              shadowOpacity: bloomGlow.interpolate({ inputRange: [0, 1.5], outputRange: [0.3, 1] }),
            }]}>
              {/* Inner petal circle */}
              <View style={styles.innerPetalCircle}>
                {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                  <View
                    key={i}
                    style={[styles.innerPetal, {
                      transform: [{ rotate: `${deg}deg` }, { translateY: -28 }],
                      backgroundColor: [PALETTE.petalPink, PALETTE.petalLav, PALETTE.petalGold,
                                        PALETTE.lotus, PALETTE.petalPink, PALETTE.petalLav][i],
                      opacity: 0.35,
                    }]}
                  />
                ))}
              </View>

              {/* Center flower emoji */}
              <Text style={styles.centerFlowerEmoji}>🌺</Text>

              {/* Inner shimmer ring */}
              <Animated.View style={[styles.shimmerRing, {
                borderColor: phase.color,
                opacity: bloomGlow.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.35] }),
              }]} />
            </Animated.View>
          </Animated.View>
        </View>

        {/* ═══════════════════════════════════════
            BREATH PHASE INDICATOR
            ═══════════════════════════════════════ */}
        {sessionStarted && (
          <Animated.View style={[styles.phaseCard, {
            borderColor: phase.color,
            transform: [{ scale: phaseTextAnim }],
          }]}>
            <Text style={{ fontSize: 30 }}>{phase.icon}</Text>
            <View style={styles.phaseTextBlock}>
              <Text style={[styles.phaseTitle, { color: phase.color }]}>{phase.text}</Text>
              <Text style={styles.phaseSub}>{phase.sub}</Text>
            </View>
            {/* Breath phase progress dots */}
            <View style={styles.phaseDots}>
              {['inhale', 'hold', 'exhale', 'rest'].map((p, i) => (
                <View key={p} style={[styles.phaseDot, {
                  backgroundColor: breathPhase === p ? phase.color : 'rgba(255,255,255,0.1)',
                  ...(breathPhase === p && { shadowColor: phase.color, shadowRadius: 6, shadowOpacity: 0.6 }),
                }]} />
              ))}
            </View>
          </Animated.View>
        )}

        {/* ═══════════════════════════════════════
            PROFESSIONAL HUD
            ═══════════════════════════════════════ */}
        {sessionStarted && (
          <View style={styles.hud}>
            {/* Top stats row */}
            <View style={styles.hudRow}>
              <View style={styles.hudChip}>
                <Text style={styles.hudChipLabel}>⏱️ TIME</Text>
                <Text style={styles.hudChipValue}>{formattedTime}</Text>
              </View>
              <View style={styles.hudChip}>
                <Text style={styles.hudChipLabel}>🌸 CYCLES</Text>
                <Text style={styles.hudChipValue}>{cycleCount}</Text>
              </View>
              <View style={styles.hudChip}>
                <Text style={styles.hudChipLabel}>✨ SCORE</Text>
                <Text style={styles.hudChipValue}>{score}</Text>
              </View>
              <View style={[styles.hudChip, combo > 5 && { borderColor: PALETTE.lotus }]}>
                <Text style={styles.hudChipLabel}>⚡ COMBO</Text>
                <Text style={[styles.hudChipValue,
                  combo > 5 && { color: PALETTE.lotus },
                  combo > 10 && { color: PALETTE.gold },
                ]}>{combo}x</Text>
              </View>
            </View>

            {/* Calm Meter */}
            <View style={styles.calmMeterContainer}>
              <View style={styles.calmMeterHeader}>
                <Text style={styles.calmMeterTitle}>🧘 Calm Level</Text>
                <Text style={[styles.calmMeterLevel, { color: calmColor }]}>{calmLevel}</Text>
              </View>
              <View style={styles.calmMeterTrack}>
                <Animated.View style={[styles.calmMeterFill, {
                  width: calmBarWidth.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: calmColor,
                  shadowColor: calmColor,
                }]} />
                {/* Milestone markers */}
                {[25, 50, 80].map(mark => (
                  <View key={mark} style={[styles.calmMilestone, { left: `${mark}%` }]} />
                ))}
              </View>
              <View style={styles.calmMeterLabels}>
                <Text style={styles.calmMeterLabel}>Warming Up</Text>
                <Text style={styles.calmMeterLabel}>Settling</Text>
                <Text style={styles.calmMeterLabel}>Relaxing</Text>
                <Text style={styles.calmMeterLabel}>Deep Calm</Text>
              </View>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════
            GARDEN PROGRESS BAR
            ═══════════════════════════════════════ */}
        {sessionStarted && gardenFlowers.length > 0 && (
          <View style={styles.gardenProgress}>
            <Text style={styles.gardenProgressTitle}>🌿 Your Garden</Text>
            <View style={styles.gardenProgressRow}>
              {gardenFlowers.slice(-8).map(f => (
                <View key={f.id} style={[styles.gardenProgressFlower, {
                  opacity: 0.5 + f.growthStage * 0.5,
                  transform: [{ scale: 0.5 + f.growthStage * 0.5 }],
                }]}>
                  <Text style={{ fontSize: 18 }}>{f.species.emoji}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════
            TUTORIAL OVERLAY
            ═══════════════════════════════════════ */}
        {showTutorial && (
          <Animated.View style={[styles.tutorialOverlay, { opacity: tutorialOpacity }]}>
            <View style={styles.tutorialCard}>
              <Text style={styles.tutorialIcon}>🌺</Text>
              <Text style={styles.tutorialTitle}>Bloom Garden</Text>
              <Text style={styles.tutorialSubtitle}>Guided 4-7-8 Breath Relaxation</Text>

              <View style={styles.tutorialDivider} />

              <View style={styles.tutorialStep}>
                <Text style={[styles.tutorialStepIcon, { color: PALETTE.breathIn }]}>🌱</Text>
                <View style={styles.tutorialStepText}>
                  <Text style={styles.tutorialStepTitle}>Inhale (4s)</Text>
                  <Text style={styles.tutorialStepDesc}>Watch the flower expand as you breathe in</Text>
                </View>
              </View>

              <View style={styles.tutorialStep}>
                <Text style={[styles.tutorialStepIcon, { color: PALETTE.breathHold }]}>🕊️</Text>
                <View style={styles.tutorialStepText}>
                  <Text style={styles.tutorialStepTitle}>Hold (7s)</Text>
                  <Text style={styles.tutorialStepDesc}>Tap during hold phase for bonus calm points</Text>
                </View>
              </View>

              <View style={styles.tutorialStep}>
                <Text style={[styles.tutorialStepIcon, { color: PALETTE.breathOut }]}>🌺</Text>
                <View style={styles.tutorialStepText}>
                  <Text style={styles.tutorialStepTitle}>Exhale (8s)</Text>
                  <Text style={styles.tutorialStepDesc}>Release and bloom — tap for perfect breaths</Text>
                </View>
              </View>

              <View style={styles.tutorialStep}>
                <Text style={[styles.tutorialStepIcon, { color: PALETTE.breathRest }]}>🌙</Text>
                <View style={styles.tutorialStepText}>
                  <Text style={styles.tutorialStepTitle}>Rest (2s)</Text>
                  <Text style={styles.tutorialStepDesc}>A new flower grows in your garden each cycle</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.tutorialButton} onPress={startSession} activeOpacity={0.8}>
                <Text style={styles.tutorialButtonText}>🌸 Begin Bloom Session</Text>
              </TouchableOpacity>

              <Text style={styles.tutorialFooter}>Medical 4-7-8 breathing protocol</Text>
            </View>
          </Animated.View>
        )}

        {/* ═══════════════════════════════════════
            BOTTOM CONTROL HINT
            ═══════════════════════════════════════ */}
        {sessionStarted && (
          <View style={styles.controlHint}>
            <Text style={styles.controlHintText}>
              👆 Tap during Exhale or Hold for bloom points
            </Text>
            <Text style={styles.controlHintSub}>
              🌿 {gardenFlowers.length} flower{gardenFlowers.length !== 1 ? 's' : ''} planted  ·  🎯 {perfectBreaths} perfect breath{perfectBreaths !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
};

/* ═══════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PALETTE.skyTop,
    overflow: 'hidden',
  },

  // ── Sky ────────────────────────────────────────────
  sky: {
    ...StyleSheet.absoluteFillObject,
  },
  skyLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
  },

  // ── Stars ─────────────────────────────────────────
  star: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },

  // ── Ground ────────────────────────────────────────
  ground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: height * 0.32,
  },
  groundGradient: {
    flex: 1,
    backgroundColor: 'rgba(16,24,40,0.85)',
    borderTopLeftRadius: 200,
    borderTopRightRadius: 200,
  },
  groundHighlight: {
    position: 'absolute',
    bottom: 0,
    left: '10%',
    right: '10%',
    height: 3,
    backgroundColor: 'rgba(167,139,250,0.15)',
    borderRadius: 2,
  },

  // ── Pollen ────────────────────────────────────────
  pollenDot: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
  },

  // ── Garden Flowers ────────────────────────────────
  gardenFlower: {
    position: 'absolute',
    alignItems: 'center',
  },
  flowerStem: {
    width: 2,
    backgroundColor: 'rgba(52,211,153,0.4)',
    borderRadius: 1,
    marginBottom: -2,
  },
  flowerGlowDot: {
    position: 'absolute',
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },

  // ── Fireflies ─────────────────────────────────────
  firefly: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },

  // ── Petals ────────────────────────────────────────
  petal: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
  },

  // ── Particles ─────────────────────────────────────
  particle: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
  },

  // ── Floating Text ─────────────────────────────────
  floatingText: {
    position: 'absolute',
    fontSize: 22,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 6,
  },

  // ── Central Bloom ─────────────────────────────────
  bloomCenter: {
    position: 'absolute',
    left: '50%',
    marginLeft: -100,
    top: '46%',
    marginTop: -100,
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  breathRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  outerGlow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
  },
  petalRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orbitPetal: {
    position: 'absolute',
    left: 89,
    top: 89,
  },
  bloomBody: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  bloomGlowCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(244,114,182,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: PALETTE.lotusGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 40,
    elevation: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(244,114,182,0.2)',
  },
  innerPetalCircle: {
    position: 'absolute',
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerPetal: {
    position: 'absolute',
    width: 18,
    height: 30,
    borderRadius: 9,
    alignSelf: 'center',
  },
  centerFlowerEmoji: {
    fontSize: 54,
    textShadowColor: 'rgba(244,114,182,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  shimmerRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
  },

  // ── Phase Card ────────────────────────────────────
  phaseCard: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PALETTE.hudBg,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1.5,
    gap: 10,
    minWidth: 220,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12 },
      android: { elevation: 8 },
    }),
  },
  phaseTextBlock: {
    flex: 1,
  },
  phaseTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  phaseSub: {
    color: PALETTE.textDim,
    fontSize: 11,
    marginTop: 1,
  },
  phaseDots: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  phaseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    shadowOffset: { width: 0, height: 0 },
  },

  // ── HUD ───────────────────────────────────────────
  hud: {
    position: 'absolute',
    top: 6,
    left: 8,
    right: 8,
  },
  hudRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  hudChip: {
    flex: 1,
    backgroundColor: PALETTE.hudBg,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PALETTE.hudBorder,
    alignItems: 'center',
  },
  hudChipLabel: {
    color: PALETTE.textMuted,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  hudChipValue: {
    color: PALETTE.white,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 1,
  },

  // ── Calm Meter ────────────────────────────────────
  calmMeterContainer: {
    marginTop: 4,
    backgroundColor: PALETTE.hudBg,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: PALETTE.hudBorder,
  },
  calmMeterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  calmMeterTitle: {
    color: PALETTE.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  calmMeterLevel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  calmMeterTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  calmMeterFill: {
    height: '100%',
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 0.6,
  },
  calmMilestone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  calmMeterLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  calmMeterLabel: {
    color: PALETTE.textMuted,
    fontSize: 7,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // ── Garden Progress ───────────────────────────────
  gardenProgress: {
    position: 'absolute',
    bottom: 105,
    left: 20,
    right: 20,
    backgroundColor: PALETTE.hudBg,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: PALETTE.hudBorder,
  },
  gardenProgressTitle: {
    color: PALETTE.textDim,
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
  },
  gardenProgressRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  gardenProgressFlower: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Tutorial ──────────────────────────────────────
  tutorialOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(11,13,46,0.88)',
    zIndex: 100,
  },
  tutorialCard: {
    width: width * 0.88,
    maxWidth: 380,
    backgroundColor: 'rgba(20,16,50,0.95)',
    borderRadius: 28,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244,114,182,0.25)',
    ...Platform.select({
      ios: { shadowColor: PALETTE.lotus, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 24 },
      android: { elevation: 16 },
    }),
  },
  tutorialIcon: {
    fontSize: 56,
    marginBottom: 8,
  },
  tutorialTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: PALETTE.white,
    letterSpacing: 1,
  },
  tutorialSubtitle: {
    fontSize: 13,
    color: PALETTE.textDim,
    marginTop: 4,
    fontWeight: '500',
  },
  tutorialDivider: {
    width: '80%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 18,
  },
  tutorialStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
    width: '100%',
  },
  tutorialStepIcon: {
    fontSize: 24,
    marginTop: 2,
  },
  tutorialStepText: {
    flex: 1,
  },
  tutorialStepTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: PALETTE.white,
  },
  tutorialStepDesc: {
    fontSize: 12,
    color: PALETTE.textDim,
    marginTop: 2,
    lineHeight: 16,
  },
  tutorialButton: {
    marginTop: 10,
    backgroundColor: PALETTE.lotus,
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 22,
    width: '100%',
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: PALETTE.lotus, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
      android: { elevation: 8 },
    }),
  },
  tutorialButtonText: {
    color: PALETTE.white,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tutorialFooter: {
    marginTop: 14,
    color: PALETTE.textMuted,
    fontSize: 10,
    fontWeight: '500',
    fontStyle: 'italic',
    letterSpacing: 0.5,
  },

  // ── Control Hint ──────────────────────────────────
  controlHint: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  controlHintText: {
    color: PALETTE.textDim,
    fontSize: 12,
    fontWeight: '500',
  },
  controlHintSub: {
    color: PALETTE.textMuted,
    fontSize: 10,
    marginTop: 3,
    fontWeight: '400',
  },
});