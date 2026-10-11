import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  Easing,
  Vibration,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeContext } from '../context/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');
const BOARD = Math.min(SCREEN_W - 64, 300);

/* ------------------------------------------------------------------ */
/*  Techniques (same ids / routing as before)                          */
/* ------------------------------------------------------------------ */
const TECHNIQUES = {
  autogenic_warmth: {
    id: 'autogenic_warmth',
    name: 'Warmth Flow',
    subtitle: 'Hold the glow and let warmth spread',
    emoji: '🔥',
    color: '#F59E0B',
  },
  pattern_alignment: {
    id: 'pattern_alignment',
    name: 'Color Match',
    subtitle: 'Settle each tile into place, no rush',
    emoji: '🧩',
    color: '#A78BFA',
  },
  stroop_decoupler: {
    id: 'stroop_decoupler',
    name: 'Color Clash',
    subtitle: 'Pop worry bubbles by the color of their ink',
    emoji: '🎯',
    color: '#38BDF8',
  },
};

const vibrate = (ms) => {
  if (Platform.OS !== 'web') {
    try { Vibration.vibrate(ms); } catch (e) { }
  }
};

/* ------------------------------------------------------------------ */
/*  Ambient background: three slow, drifting light orbs                */
/* ------------------------------------------------------------------ */
const DriftOrb = ({ size, color, top, left, duration, dx, dy }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, duration]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: 0.38,
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
        ],
      }}
    />
  );
};

const AmbientBackground = ({ isDarkMode, accent }) => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <LinearGradient
      colors={isDarkMode ? ['#0A1020', '#111B33', '#162544'] : ['#F3F8FF', '#E8F1FB', '#F7EEF8']}
      style={StyleSheet.absoluteFill}
    />
    <DriftOrb size={260} color={accent} top={-60} left={-80} duration={9000} dx={50} dy={40} />
    <DriftOrb size={200} color={isDarkMode ? '#2DD4BF' : '#7DD3FC'} top={380} left={SCREEN_W - 150} duration={11000} dx={-40} dy={-50} />
    <DriftOrb size={180} color={isDarkMode ? '#818CF8' : '#F9A8D4'} top={620} left={-60} duration={13000} dx={60} dy={-30} />
  </View>
);

/* ------------------------------------------------------------------ */
/*  Breath pacer: a quiet ring that breathes in 4s and out 6s          */
/*  Every activity sits under it so the whole screen has one rhythm.   */
/* ------------------------------------------------------------------ */
const BreathPacer = ({ color, isDarkMode }) => {
  const scale = useRef(new Animated.Value(0.7)).current;
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    let timer;
    let alive = true;
    const run = (p) => {
      if (!alive) return;
      setPhase(p);
      const inhale = p === 'in';
      Animated.timing(scale, {
        toValue: inhale ? 1 : 0.7,
        duration: inhale ? 4000 : 6000,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }).start();
      timer = setTimeout(() => run(inhale ? 'out' : 'in'), inhale ? 4000 : 6000);
    };
    run('in');
    return () => { alive = false; clearTimeout(timer); };
  }, [scale]);

  return (
    <View style={styles.pacerRow}>
      <View style={styles.pacerRingWrap}>
        <Animated.View style={[styles.pacerHalo, { backgroundColor: color, transform: [{ scale }] }]} />
        <Animated.View style={[styles.pacerCore, { borderColor: color, transform: [{ scale }] }]} />
      </View>
      <Text style={[styles.pacerText, { color: isDarkMode ? '#CBD5E1' : '#475569' }]}>
        {phase === 'in' ? 'Breathe in slowly' : 'Let it out, longer'}
      </Text>
    </View>
  );
};

/* ------------------------------------------------------------------ */
/*  Gentle feedback: expanding ring + soft word (replaces XP popups)   */
/* ------------------------------------------------------------------ */
const SoftRipple = ({ ripple }) => {
  const ringScale = ripple.anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.4] });
  const ringOpacity = ripple.anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.6, 0] });
  const wordY = ripple.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -26] });
  const wordOpacity = ripple.anim.interpolate({ inputRange: [0, 0.3, 0.8, 1], outputRange: [0, 1, 1, 0] });

  return (
    <View pointerEvents="none" style={[styles.rippleAnchor, { left: ripple.x, top: ripple.y }]}>
      <Animated.View
        style={[
          styles.rippleRing,
          { borderColor: ripple.color, opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      />
      {!!ripple.text && (
        <Animated.Text
          style={[styles.rippleWord, { color: ripple.color, opacity: wordOpacity, transform: [{ translateY: wordY }] }]}
        >
          {ripple.text}
        </Animated.Text>
      )}
    </View>
  );
};

/* ------------------------------------------------------------------ */
/*  1. Warmth Flow: press and hold the ember to carry warmth onward    */
/* ------------------------------------------------------------------ */
const THERMAL_STAGES = [
  { id: 'hands_arms', name: 'Hands & Arms', emoji: '🤲', cue: 'My hands and arms feel heavy and pleasantly warm.', color: '#FB7185' },
  { id: 'solar_plexus', name: 'Solar Plexus', emoji: '☀️', cue: 'My abdomen feels radiating soothing warmth.', color: '#FBBF24' },
  { id: 'cardiac_pulse', name: 'Cardiac Pulse', emoji: '🫀', cue: 'My heartbeat is calm, steady, and warm.', color: '#34D399' },
  { id: 'forehead_cool', name: 'Forehead Cool', emoji: '❄️', cue: 'My forehead feels comfortably cool and calm.', color: '#22D3EE' },
];
const HOLD_MS = 3500;

const AutogenicWarmthActivity = ({ isDarkMode, onTally, ripple }) => {
  const [activeZone, setActiveZone] = useState(0);
  const [done, setDone] = useState([]);
  const [holding, setHolding] = useState(false);

  const progress = useRef(new Animated.Value(0)).current; // JS-driven (ring fill)
  const glow = useRef(new Animated.Value(0)).current; // native (orb scale/halo)
  const idle = useRef(new Animated.Value(0)).current; // native (idle breathing)
  const cueFade = useRef(new Animated.Value(1)).current;
  const holdAnim = useRef(null);

  const stage = THERMAL_STAGES[activeZone] || THERMAL_STAGES[0];
  const ink = isDarkMode ? '#F1F5F9' : '#0F172A';
  const muted = isDarkMode ? '#94A3B8' : '#64748B';

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idle, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(idle, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [idle]);

  const completeStage = (event) => {
    vibrate(40);
    setDone((d) => (d.includes(activeZone) ? d : [...d, activeZone]));
    if (onTally) onTally();
    const next = (activeZone + 1) % THERMAL_STAGES.length;
    ripple(stage.color, next === 0 ? 'Whole body warm' : 'Warmth carried on', event);

    Animated.timing(cueFade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
      setActiveZone(next);
      if (next === 0) setDone([]);
      progress.setValue(0);
      Animated.timing(cueFade, { toValue: 1, duration: 700, useNativeDriver: true }).start();
    });
  };

  const onPressIn = (e) => {
    setHolding(true);
    const evt = e?.nativeEvent ? { nativeEvent: { ...e.nativeEvent } } : null;
    Animated.timing(glow, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    holdAnim.current = Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS * (1 - (progress.__getValue ? progress.__getValue() : 0)),
      easing: Easing.linear,
      useNativeDriver: false,
    });
    holdAnim.current.start(({ finished }) => {
      if (finished) {
        setHolding(false);
        Animated.timing(glow, { toValue: 0, duration: 800, useNativeDriver: true }).start();
        completeStage(evt);
      }
    });
  };

  const onPressOut = () => {
    setHolding(false);
    if (holdAnim.current) holdAnim.current.stop();
    Animated.timing(glow, { toValue: 0, duration: 900, useNativeDriver: true }).start();
    Animated.timing(progress, { toValue: 0, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  };

  const orbScale = Animated.multiply(
    idle.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }),
    glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] })
  );
  const haloOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.55] });
  const haloScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.activityContainer}>
      {/* Body path: warmth travels downward through four places */}
      <View style={styles.pathRow}>
        {THERMAL_STAGES.map((s, i) => {
          const isActive = i === activeZone;
          const isDone = done.includes(i);
          return (
            <View key={s.id} style={styles.pathItem}>
              <View
                style={[
                  styles.pathDot,
                  {
                    borderColor: s.color,
                    backgroundColor: isDone ? s.color : isActive ? `${s.color}33` : 'transparent',
                    transform: [{ scale: isActive ? 1.15 : 1 }],
                  },
                ]}
              >
                <Text style={styles.pathEmoji}>{s.emoji}</Text>
              </View>
              {i < THERMAL_STAGES.length - 1 && (
                <View style={[styles.pathLine, { backgroundColor: isDone ? s.color : isDarkMode ? '#334155' : '#CBD5E1' }]} />
              )}
            </View>
          );
        })}
      </View>

      {/* Ember orb */}
      <View style={styles.emberStage}>
        <Animated.View
          pointerEvents="none"
          style={[styles.emberHalo, { backgroundColor: stage.color, opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
        />
        <TouchableWithoutFeedback onPressIn={onPressIn} onPressOut={onPressOut}>
          <Animated.View style={[styles.emberOrbWrap, { transform: [{ scale: orbScale }] }]}>
            <LinearGradient
              colors={[`${stage.color}`, `${stage.color}99`]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={styles.emberOrb}
            >
              <Text style={styles.emberEmoji}>{stage.emoji}</Text>
              <Text style={styles.emberHint}>{holding ? 'Keep holding' : 'Press and hold'}</Text>
            </LinearGradient>
          </Animated.View>
        </TouchableWithoutFeedback>
      </View>

      {/* Hold progress */}
      <View style={[styles.holdTrack, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)' }]}>
        <Animated.View style={[styles.holdFill, { width: fillWidth, backgroundColor: stage.color }]} />
      </View>

      {/* Cue */}
      <Animated.View style={[styles.cueCard, { opacity: cueFade, borderColor: `${stage.color}66`, backgroundColor: isDarkMode ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.7)' }]}>
        <Text style={[styles.cueName, { color: stage.color }]}>{stage.name}</Text>
        <Text style={[styles.cueText, { color: ink }]}>{stage.cue}</Text>
        <Text style={[styles.cueFoot, { color: muted }]}>Repeat the phrase quietly while you hold.</Text>
      </Animated.View>
    </View>
  );
};

/* ------------------------------------------------------------------ */
/*  2. Color Match: soft tiles that bloom when they settle in place    */
/* ------------------------------------------------------------------ */
const COLOR_PALETTE = ['#FDA4AF', '#FCD34D', '#86EFAC', '#7DD3FC', '#C4B5FD'];
const TILE = Math.floor((BOARD - 2 * 10) / 3);

const BloomTile = ({ color, matched, onPress }) => {
  const bloom = useRef(new Animated.Value(matched ? 1 : 0)).current;
  const squish = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(bloom, { toValue: matched ? 1 : 0, friction: 5, tension: 60, useNativeDriver: true }).start();
  }, [matched, bloom]);

  const press = (e) => {
    Animated.sequence([
      Animated.timing(squish, { toValue: 0.92, duration: 90, useNativeDriver: true }),
      Animated.spring(squish, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
    onPress(e);
  };

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={press}>
      <Animated.View style={{ transform: [{ scale: squish }] }}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.tileGlow,
            { backgroundColor: color, opacity: bloom.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }), transform: [{ scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] }) }] },
          ]}
        />
        <View style={[styles.tile, { backgroundColor: color }]}>
          <Animated.View
            style={[styles.tileDot, { opacity: bloom, transform: [{ scale: bloom }] }]}
          />
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

const PatternAlignActivity = ({ isDarkMode, theme, onTally, ripple }) => {
  const [blueprint, setBlueprint] = useState([]);
  const [grid, setGrid] = useState([]);
  const [matches, setMatches] = useState(0);
  const [combos, setCombos] = useState(0);
  const sceneFade = useRef(new Animated.Value(1)).current;

  const ink = theme?.textPrimary || (isDarkMode ? '#F1F5F9' : '#0F172A');
  const muted = theme?.textMuted || (isDarkMode ? '#94A3B8' : '#64748B');

  const generateLevel = useCallback(() => {
    const pick = () => COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
    setBlueprint(Array.from({ length: 9 }, pick));
    setGrid(Array.from({ length: 9 }, pick));
    setMatches(0);
  }, []);

  useEffect(() => { generateLevel(); }, [generateLevel]);

  const handleTilePress = (index, event) => {
    vibrate(15);
    const newGrid = [...grid];
    const colorIdx = COLOR_PALETTE.indexOf(newGrid[index]);
    newGrid[index] = COLOR_PALETTE[(colorIdx + 1) % COLOR_PALETTE.length];
    setGrid(newGrid);

    let matchCount = 0;
    for (let i = 0; i < 9; i++) if (newGrid[i] === blueprint[i]) matchCount++;
    setMatches(matchCount);

    if (newGrid[index] === blueprint[index]) ripple(newGrid[index], 'Settled', event);

    if (matchCount === 9) {
      setCombos((c) => c + 1);
      if (onTally) onTally();
      ripple('#C4B5FD', 'Harmony', event);
      setTimeout(() => {
        Animated.timing(sceneFade, { toValue: 0, duration: 500, useNativeDriver: true }).start(() => {
          generateLevel();
          Animated.timing(sceneFade, { toValue: 1, duration: 700, useNativeDriver: true }).start();
        });
      }, 700);
    }
  };

  return (
    <View style={styles.activityContainer}>
      {/* Target: a small "memory" strip, kept quiet */}
      <View style={styles.targetStrip}>
        <Text style={[styles.targetLabel, { color: muted }]}>Match this pattern</Text>
        <View style={styles.targetMini}>
          {blueprint.map((c, i) => (
            <View key={`bp-${i}`} style={[styles.targetCell, { backgroundColor: c }]} />
          ))}
        </View>
      </View>

      <Animated.View style={[styles.boardCard, { opacity: sceneFade, backgroundColor: isDarkMode ? 'rgba(15,23,42,0.5)' : 'rgba(255,255,255,0.65)', borderColor: isDarkMode ? 'rgba(167,139,250,0.35)' : 'rgba(139,92,246,0.25)' }]}>
        <View style={styles.boardGrid}>
          {grid.map((color, idx) => (
            <BloomTile
              key={`tile-${idx}`}
              color={color}
              matched={color === blueprint[idx]}
              onPress={(e) => handleTilePress(idx, e)}
            />
          ))}
        </View>
      </Animated.View>

      {/* Progress as nine small beads, not a score */}
      <View style={styles.beadRow}>
        {Array.from({ length: 9 }).map((_, i) => (
          <View
            key={i}
            style={[styles.bead, { backgroundColor: i < matches ? '#A78BFA' : isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.12)' }]}
          />
        ))}
      </View>
      <Text style={[styles.softStat, { color: ink }]}>
        {matches} of 9 settled{combos > 0 ? `  ·  ${combos} ${combos === 1 ? 'harmony' : 'harmonies'}` : ''}
      </Text>
    </View>
  );
};

/* ------------------------------------------------------------------ */
/*  3. Color Clash: worry bubbles that pop by naming the ink color     */
/* ------------------------------------------------------------------ */
const STROOP_ITEMS = [
  { word: 'RED', colorName: 'BLUE', colorCode: '#3B82F6' },
  { word: 'GREEN', colorName: 'RED', colorCode: '#EF4444' },
  { word: 'YELLOW', colorName: 'GREEN', colorCode: '#10B981' },
  { word: 'BLUE', colorName: 'YELLOW', colorCode: '#F59E0B' },
  { word: 'PURPLE', colorName: 'RED', colorCode: '#EF4444' },
];

const COLOR_BUTTONS = [
  { name: 'RED', code: '#EF4444' },
  { name: 'BLUE', code: '#3B82F6' },
  { name: 'GREEN', code: '#10B981' },
  { name: 'YELLOW', code: '#F59E0B' },
];

const StroopDecouplerActivity = ({ isDarkMode, onTally, ripple }) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [streak, setStreak] = useState(0);
  const [hint, setHint] = useState('');

  const float = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current; // 1 = visible, 0 = popped
  const shake = useRef(new Animated.Value(0)).current;

  const currentItem = STROOP_ITEMS[currentIdx] || STROOP_ITEMS[0];
  const ink = isDarkMode ? '#F1F5F9' : '#0F172A';
  const muted = isDarkMode ? '#94A3B8' : '#64748B';

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  const nextBubble = () => {
    setCurrentIdx((prev) => (prev + 1) % STROOP_ITEMS.length);
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }).start();
  };

  const handleColorPress = (btnName, event) => {
    vibrate(20);
    if (btnName === currentItem.colorName) {
      setStreak((s) => s + 1);
      setHint('');
      if (onTally) onTally();
      ripple(currentItem.colorCode, 'Popped', event);
      Animated.timing(pop, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(nextBubble);
    } else {
      setStreak(0);
      setHint('Look at the ink color, not the letters.');
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 90, useNativeDriver: true }),
      ]).start();
    }
  };

  const bubbleScale = pop.interpolate({ inputRange: [0, 1], outputRange: [1.35, 1] });

  return (
    <View style={styles.activityContainer}>
      <View style={styles.bubbleSky}>
        <Animated.View
          style={[
            styles.bubble,
            {
              borderColor: `${currentItem.colorCode}88`,
              backgroundColor: isDarkMode ? 'rgba(148,163,184,0.10)' : 'rgba(255,255,255,0.55)',
              opacity: pop,
              transform: [
                { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [8, -8] }) },
                { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) },
                { scale: bubbleScale },
              ],
            },
          ]}
        >
          <View style={[styles.bubbleShine, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.9)' }]} />
          <Text style={[styles.stroopWord, { color: currentItem.colorCode }]}>{currentItem.word}</Text>
        </Animated.View>
      </View>

      <Text style={[styles.hintLine, { color: hint ? '#38BDF8' : muted }]}>
        {hint || 'Which color is the word written in?'}
      </Text>

      <View style={styles.orbRow}>
        {COLOR_BUTTONS.map((btn) => (
          <TouchableOpacity key={btn.name} activeOpacity={0.8} onPress={(e) => handleColorPress(btn.name, e)} style={styles.orbBtnWrap}>
            <View style={[styles.orbBtnGlow, { backgroundColor: btn.code }]} />
            <LinearGradient colors={[btn.code, `${btn.code}CC`]} style={styles.orbBtn}>
              <Text style={styles.orbBtnTxt}>{btn.name}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.softStat, { color: ink }]}>
        {streak > 0 ? `${streak} in a row` : 'Take your time'}
      </Text>
    </View>
  );
};

/* ------------------------------------------------------------------ */
/*  Container (props and technique routing unchanged)                  */
/* ------------------------------------------------------------------ */
export const CognitiveDeStressGame = ({
  mode = 'pattern_alignment',
  onTally,
  onFinish,
  subOptionId,
  onStartSession,
  initialDurationMin = 3,
}) => {
  const themeCtx = useContext(ThemeContext) || {};
  const theme = themeCtx.theme || {};
  const isDarkMode = themeCtx.isDarkMode ?? true;

  const [ripples, setRipples] = useState([]);
  const rootRef = useRef(null);
  const rootOffset = useRef({ x: 0, y: 0 });

  const extractString = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object') return val.id || val.mode || val.technique_id || val.key || val.title || '';
    return String(val);
  };

  const rawKey = (extractString(subOptionId) || extractString(mode) || 'pattern_alignment').toLowerCase();
  let key = 'pattern_alignment';
  if (rawKey.includes('warmth') || rawKey.includes('autogenic') || rawKey.includes('warm')) key = 'autogenic_warmth';
  else if (rawKey.includes('stroop') || rawKey.includes('clash') || rawKey.includes('decoupler')) key = 'stroop_decoupler';
  else if (rawKey.includes('pattern') || rawKey.includes('match') || rawKey.includes('alignment')) key = 'pattern_alignment';

  const tech = TECHNIQUES[key] || TECHNIQUES.pattern_alignment;

  const hasStartedRef = useRef(false);
  useEffect(() => {
    if (onStartSession && initialDurationMin && !hasStartedRef.current) {
      hasStartedRef.current = true;
      onStartSession(initialDurationMin * 60);
    }
  }, [initialDurationMin, onStartSession]);

  const measureRoot = () => {
    if (rootRef.current && rootRef.current.measureInWindow) {
      rootRef.current.measureInWindow((x, y) => {
        rootOffset.current = { x: x || 0, y: y || 0 };
      });
    }
  };

  const ripple = useCallback((color, text, event) => {
    const ne = event?.nativeEvent;
    if (!ne) return;
    const id = Date.now() + Math.random();
    const anim = new Animated.Value(0);
    const x = (ne.pageX ?? 0) - rootOffset.current.x;
    const y = (ne.pageY ?? 0) - rootOffset.current.y;
    setRipples((prev) => [...prev, { id, color, text, x, y, anim }]);
    Animated.timing(anim, { toValue: 1, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    });
  }, []);

  const ink = theme?.textPrimary || (isDarkMode ? '#F1F5F9' : '#0F172A');

  return (
    <View ref={rootRef} style={styles.root} onLayout={measureRoot} collapsable={false}>
      <AmbientBackground isDarkMode={isDarkMode} accent={tech.color} />

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        onScrollEndDrag={measureRoot}
      >
        <View style={styles.header}>
          <Text style={styles.headerEmoji}>{tech.emoji}</Text>
          <Text style={[styles.headerTitle, { color: ink }]}>{tech.name}</Text>
          <Text style={[styles.headerSub, { color: isDarkMode ? '#94A3B8' : '#64748B' }]}>{tech.subtitle}</Text>
        </View>

        <BreathPacer color={tech.color} isDarkMode={isDarkMode} />

        {key === 'autogenic_warmth' && <AutogenicWarmthActivity isDarkMode={isDarkMode} onTally={onTally} ripple={ripple} />}
        {key === 'pattern_alignment' && <PatternAlignActivity isDarkMode={isDarkMode} theme={theme} onTally={onTally} ripple={ripple} />}
        {key === 'stroop_decoupler' && <StroopDecouplerActivity isDarkMode={isDarkMode} onTally={onTally} ripple={ripple} />}
      </ScrollView>

      {/* Feedback layer */}
      {ripples.map((r) => (
        <SoftRipple key={r.id} ripple={r} />
      ))}
    </View>
  );
};

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  container: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, flexGrow: 1 },

  header: { alignItems: 'center', marginBottom: 6 },
  headerEmoji: { fontSize: 30 },
  headerTitle: { fontSize: 26, fontWeight: '300', letterSpacing: 0.4, marginTop: 4 },
  headerSub: { fontSize: 14, marginTop: 4, textAlign: 'center' },

  // Breath pacer
  pacerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginVertical: 16 },
  pacerRingWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pacerHalo: { position: 'absolute', width: 44, height: 44, borderRadius: 22, opacity: 0.22 },
  pacerCore: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  pacerText: { fontSize: 14, fontWeight: '500', minWidth: 150 },

  // Ripple feedback
  rippleAnchor: { position: 'absolute', zIndex: 999, width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  rippleRing: { position: 'absolute', width: 60, height: 60, borderRadius: 30, borderWidth: 2 },
  rippleWord: { position: 'absolute', width: 160, textAlign: 'center', fontSize: 15, fontWeight: '600', top: -44 },

  activityContainer: { alignItems: 'center', gap: 16 },

  // Warmth Flow
  pathRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pathItem: { flexDirection: 'row', alignItems: 'center' },
  pathDot: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pathEmoji: { fontSize: 20 },
  pathLine: { width: 22, height: 2, borderRadius: 1 },
  emberStage: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center' },
  emberHalo: { position: 'absolute', width: 190, height: 190, borderRadius: 95 },
  emberOrbWrap: { width: 170, height: 170, borderRadius: 85 },
  emberOrb: { flex: 1, borderRadius: 85, alignItems: 'center', justifyContent: 'center' },
  emberEmoji: { fontSize: 54 },
  emberHint: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '600', marginTop: 6 },
  holdTrack: { width: 200, height: 6, borderRadius: 3, overflow: 'hidden' },
  holdFill: { height: '100%', borderRadius: 3 },
  cueCard: { width: '100%', borderWidth: 1, borderRadius: 24, paddingVertical: 18, paddingHorizontal: 20, alignItems: 'center' },
  cueName: { fontSize: 16, fontWeight: '600' },
  cueText: { fontSize: 17, lineHeight: 26, fontStyle: 'italic', textAlign: 'center', marginTop: 8 },
  cueFoot: { fontSize: 12, marginTop: 10 },

  // Color Match
  targetStrip: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  targetLabel: { fontSize: 13 },
  targetMini: { width: 51, height: 51, flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  targetCell: { width: 15, height: 15, borderRadius: 5 },
  boardCard: { borderWidth: 1, borderRadius: 32, padding: 16 },
  boardGrid: { width: BOARD - 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  tile: { width: TILE - 8, height: TILE - 8, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  tileGlow: { position: 'absolute', top: -4, left: -4, width: TILE, height: TILE, borderRadius: 30 },
  tileDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.9)' },
  beadRow: { flexDirection: 'row', gap: 8 },
  bead: { width: 10, height: 10, borderRadius: 5 },
  softStat: { fontSize: 14, fontWeight: '500' },

  // Color Clash
  bubbleSky: { height: 220, alignItems: 'center', justifyContent: 'center' },
  bubble: { width: 200, height: 200, borderRadius: 100, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  bubbleShine: { position: 'absolute', top: 26, left: 40, width: 46, height: 22, borderRadius: 11, transform: [{ rotate: '-28deg' }] },
  stroopWord: { fontSize: 36, fontWeight: '800', letterSpacing: 1.5 },
  hintLine: { fontSize: 14, textAlign: 'center', minHeight: 20 },
  orbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center' },
  orbBtnWrap: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  orbBtnGlow: { position: 'absolute', width: 76, height: 76, borderRadius: 38, opacity: 0.25 },
  orbBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  orbBtnTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});

export default CognitiveDeStressGame;