import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Easing,
  Vibration,
  Platform,
  PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Ellipse, Path, Line, Rect, Defs, Stop, ClipPath, LinearGradient as SvgLinearGradient } from 'react-native-svg';

const { width: SCREEN_W } = Dimensions.get('window');
const STAGE_W = SCREEN_W - 24;
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

const vibrate = (p = 30) => {
  if (Platform.OS !== 'web') {
    try { Vibration.vibrate(p); } catch (e) { }
  }
};

/* ===========================================================================
   SHARED BUILDING BLOCKS
   =========================================================================== */

// Collapsible biophysical / clinical evidence note (keeps the thesis badge, saves screen space)
const EvidenceChip = ({ title, text, accent = '#FDE68A' }) => {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => setOpen((o) => !o)} style={styles.chip}>
      <View style={styles.chipRow}>
        <View style={[styles.chipDot, { backgroundColor: accent }]} />
        <Text style={styles.chipTitle}>{title}</Text>
        <Text style={styles.chipHint}>{open ? 'hide' : 'why it works'}</Text>
      </View>
      {open && <Text style={styles.chipText}>{text}</Text>}
    </TouchableOpacity>
  );
};

// Expanding ring that removes itself when finished
const Ripple = ({ size = 120, color = '#fff', duration = 2600, maxScale = 2.4, style, onDone }) => {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished && onDone) onDone();
    });
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
          transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.3, maxScale] }) }],
        },
        style,
      ]}
    />
  );
};



/* ===========================================================================
   TECHNIQUE 2: Progressive Muscle Relaxation  ->  "Origami Knot"
   Press and hold to fold a paper knot tighter (tense). Let go and it unfolds
   into an open bloom (release). Each round targets a different muscle group.
   Evidence: tension-release lowers trapezius EMG and skin conductance (WESAD).
   =========================================================================== */
const PMR_PARTS = ['fists', 'shoulders', 'jaw', 'toes'];
const RING_R = 104;
const RING_C = 2 * Math.PI * RING_R;

export const PMRMuscleReleaseGame = ({ onTally, onFinish }) => {
  const [phase, setPhase] = useState('idle'); // idle | hold | release
  const [progress, setProgress] = useState(0);
  const [rounds, setRounds] = useState(0);

  const k = useRef(new Animated.Value(0)).current; // 1 = tight, 0 = rest, -1 = bloom
  const burst = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);
  const resetT = useRef(null);
  const shakeLoop = useRef(null);
  const prog = useRef(0);
  const phaseRef = useRef('idle');

  const setPh = (p) => { phaseRef.current = p; setPhase(p); };

  const stopShake = () => {
    if (shakeLoop.current) shakeLoop.current.stop();
    shake.setValue(0);
  };

  useEffect(() => () => {
    clearInterval(timer.current);
    clearTimeout(resetT.current);
    if (shakeLoop.current) shakeLoop.current.stop();
  }, []);

  const release = () => {
    clearInterval(timer.current);
    stopShake();
    setPh('release');
    setProgress(100);
    vibrate([0, 40, 30, 70]);
    if (onTally) onTally();
    burst.setValue(0);
    Animated.parallel([
      Animated.spring(k, { toValue: -1, friction: 5, tension: 40, useNativeDriver: true }),
      Animated.timing(burst, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    resetT.current = setTimeout(() => {
      Animated.timing(k, { toValue: 0, duration: 900, useNativeDriver: true }).start();
      prog.current = 0;
      setProgress(0);
      setRounds((r) => r + 1);
      setPh('idle');
    }, 4500);
  };

  const startHold = () => {
    if (phaseRef.current === 'release') return;
    setPh('hold');
    vibrate(15);
    shakeLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
      ])
    );
    shakeLoop.current.start();
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      prog.current = Math.min(100, prog.current + 2);
      setProgress(prog.current);
      Animated.timing(k, { toValue: prog.current / 100, duration: 100, easing: Easing.linear, useNativeDriver: true }).start();
      if (prog.current >= 100) release();
    }, 100);
  };

  const endHold = () => {
    if (phaseRef.current !== 'hold') return;
    clearInterval(timer.current);
    stopShake();
    if (prog.current >= 35) {
      release();
    } else {
      prog.current = 0;
      setProgress(0);
      setPh('idle');
      Animated.spring(k, { toValue: 0, friction: 6, useNativeDriver: true }).start();
    }
  };

  const tint = phase === 'release' ? '#7FE5D0' : phase === 'hold' ? '#FF6B8B' : '#C4B5FD';
  const part = PMR_PARTS[rounds % PMR_PARTS.length];
  const headline =
    phase === 'hold' ? `Squeeze your ${part}` : phase === 'release' ? 'Let go. Feel the warmth.' : 'Press and hold the knot';
  const sub =
    phase === 'hold'
      ? `${progress}% tension`
      : phase === 'release'
        ? 'Notice the difference'
        : `Round ${rounds + 1}: tighten your ${part} as you press`;

  return (
    <View style={styles.gameContainer}>
      <LinearGradient colors={['#1B1030', '#3A1740', '#5B2250']} style={StyleSheet.absoluteFill} />
      <EvidenceChip
        title="WESAD · muscle release"
        text="Brief isometric tension followed by sudden release relaxes the muscle and is linked to lower trapezius EMG and falling skin conductance (SCL)."
        accent="#FF6B8B"
      />

      <View style={{ alignItems: 'center', marginTop: 10 }}>
        <TouchableOpacity activeOpacity={1} onPressIn={startHold} onPressOut={endHold} style={styles.pmrStage}>
          <Svg width={240} height={240} style={StyleSheet.absoluteFill}>
            <Circle cx="120" cy="120" r={RING_R} stroke="rgba(255,255,255,0.12)" strokeWidth="4" fill="none" />
            <Circle
              cx="120"
              cy="120"
              r={RING_R}
              stroke={tint}
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${RING_C}`}
              strokeDashoffset={RING_C * (1 - progress / 100)}
              rotation="-90"
              origin="120,120"
            />
          </Svg>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.pmrFold,
              { transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-2.5, 2.5] }) }] },
            ]}
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Animated.View
                key={i}
                style={[
                  styles.pmrLayer,
                  {
                    borderColor: tint,
                    backgroundColor: tint + '1F',
                    opacity: k.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.32, 0.55, 0.9] }),
                    transform: [
                      { rotate: k.interpolate({ inputRange: [-1, 0, 1], outputRange: [`${i * 30 + 15}deg`, `${i * 12}deg`, `${i * 5}deg`] }) },
                      { scale: k.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.0 + i * 0.07, 0.78 + i * 0.04, 0.5 + i * 0.025] }) },
                    ],
                  },
                ]}
              />
            ))}
          </Animated.View>

          {Array.from({ length: 12 }).map((_, i) => {
            const ang = (i / 12) * Math.PI * 2;
            return (
              <Animated.View
                key={`b${i}`}
                pointerEvents="none"
                style={[
                  styles.pmrSpark,
                  {
                    opacity: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
                    transform: [
                      { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(ang) * 125] }) },
                      { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(ang) * 125] }) },
                    ],
                  },
                ]}
              />
            );
          })}
        </TouchableOpacity>
      </View>

      <Text style={styles.pmrHeadline}>{headline}</Text>
      <Text style={styles.pmrSub}>{sub}</Text>
      <View style={styles.pmrPips}>
        {PMR_PARTS.map((p, i) => (
          <View key={p} style={[styles.pmrPip, { backgroundColor: i < rounds % (PMR_PARTS.length + 1) ? '#7FE5D0' : 'rgba(255,255,255,0.2)' }]} />
        ))}
      </View>
    </View>
  );
};

/* ===========================================================================
   TECHNIQUE 3: Bilateral Saccadic Tracking  ->  "Firefly Over Still Water"
   A comet-tailed firefly crosses a night lake. A drawn eye follows it, the lake
   reflects it, and every edge crossing releases a ripple. Choose your own pace.
   Evidence: bilateral eye movement down-regulates amygdala response, steadies R-R intervals (WESAD).
   =========================================================================== */
const PACES = [
  { id: 'slow', label: 'Slow', ms: 3200 },
  { id: 'steady', label: 'Steady', ms: 2400 },
  { id: 'brisk', label: 'Brisk', ms: 1800 },
];
const TRAIL = 5;
const ORB = 36;
const ORB_TOP = 44;

const Orb = ({ s, strong }) => (
  <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: strong ? 'rgba(125,211,252,0.35)' : 'rgba(125,211,252,0.22)', alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: s * 0.5, height: s * 0.5, borderRadius: s * 0.25, backgroundColor: strong ? '#F0FBFF' : '#BDEBFF' }} />
  </View>
);

export const EMDRSaccadicTraceGame = ({ onTally, onFinish }) => {
  const [pace, setPace] = useState(PACES[1]);
  const [sweeps, setSweeps] = useState(0);
  const [edges, setEdges] = useState([]);
  const anims = useRef(Array.from({ length: TRAIL }, () => new Animated.Value(0))).current;
  const range = STAGE_W - ORB;

  const stars = useMemo(
    () => Array.from({ length: 22 }, (_, i) => ({ x: ((i * 53) % 100) / 100 * SCREEN_W, y: ((i * 37) % 100) * 1.7 + 8, r: 0.8 + ((i * 7) % 10) / 10 })),
    []
  );

  useEffect(() => {
    const seqs = anims.map((v, j) => {
      v.setValue(0);
      return Animated.sequence([
        Animated.delay(j * 75),
        Animated.loop(
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: pace.ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(v, { toValue: 0, duration: pace.ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          ])
        ),
      ]);
    });
    seqs.forEach((s) => s.start());

    let side = 'right';
    const t = setInterval(() => {
      const s = side;
      setEdges((e) => [...e.slice(-3), { id: Date.now() + Math.random(), side: s }]);
      vibrate(12);
      if (s === 'left') {
        setSweeps((c) => c + 1);
        if (onTally) onTally();
      }
      side = s === 'right' ? 'left' : 'right';
    }, pace.ms);

    return () => { seqs.forEach((s) => s.stop()); clearInterval(t); };
  }, [pace]);

  const tx = (v) => v.interpolate({ inputRange: [0, 1], outputRange: [0, range] });

  return (
    <View style={styles.gameContainer}>
      <LinearGradient colors={['#031629', '#06304F', '#0B4F78']} style={StyleSheet.absoluteFill} />
      <Svg width={SCREEN_W} height={200} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
        {stars.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={0.55} />
        ))}
      </Svg>

      <EvidenceChip
        title="WESAD · bilateral tracking"
        text="Smooth horizontal pursuit engages the superior colliculus and locus coeruleus, damping amygdala threat response and stabilizing ECG R-R intervals."
        accent="#38BDF8"
      />

      {/* Drawn eye: the iris follows the firefly */}
      <View style={styles.eyeWrap}>
        <Svg width={120} height={56} viewBox="0 0 120 56" style={StyleSheet.absoluteFill}>
          <Path d="M4 28 Q60 -10 116 28 Q60 66 4 28 Z" stroke="rgba(224,247,255,0.8)" strokeWidth="2" fill="rgba(3,22,41,0.5)" />
        </Svg>
        <Animated.View
          style={[styles.iris, { transform: [{ translateX: anims[0].interpolate({ inputRange: [0, 1], outputRange: [-28, 28] }) }] }]}
        >
          <View style={styles.pupil} />
          <View style={styles.irisShine} />
        </Animated.View>
      </View>

      {/* Night lake track */}
      <View style={styles.emdrTrack}>
        <View style={styles.lakeBody} />
        <View style={styles.lakeLine} />

        {edges.map((e) => (
          <View key={e.id} pointerEvents="none" style={[styles.edgeWrap, e.side === 'left' ? { left: 0 } : { right: 0 }]}>
            <Ripple size={ORB} color="#7DD3FC" duration={1600} maxScale={2.8} onDone={() => setEdges((l) => l.filter((x) => x.id !== e.id))} />
          </View>
        ))}

        {/* reflection */}
        <Animated.View style={{ position: 'absolute', top: 112, left: 0, opacity: 0.2, transform: [{ translateX: tx(anims[0]) }, { scaleY: 0.6 }] }}>
          <Orb s={ORB} />
        </Animated.View>

        {/* comet trail then the lead firefly on top */}
        {[...anims.keys()].reverse().map((j) => (
          <Animated.View
            key={j}
            style={{
              position: 'absolute',
              top: ORB_TOP,
              left: 0,
              opacity: j === 0 ? 1 : 0.62 - j * 0.11,
              transform: [{ translateX: tx(anims[j]) }, { scale: 1 - j * 0.14 }],
            }}
          >
            <Orb s={ORB} strong={j === 0} />
          </Animated.View>
        ))}
      </View>

      <Text style={styles.emdrInstruction}>Follow the light with your eyes only. Keep your head still and your jaw soft.</Text>
      <Text style={styles.emdrCount}>{sweeps} full sweeps</Text>

      <View style={styles.paceRow}>
        {PACES.map((p) => (
          <TouchableOpacity
            key={p.id}
            activeOpacity={0.8}
            onPress={() => setPace(p)}
            style={[styles.paceChip, pace.id === p.id && styles.paceChipOn]}
          >
            <Text style={[styles.paceTxt, pace.id === p.id && { color: '#031629' }]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};



/* ===========================================================================
   TECHNIQUE 5: GSR / EDA Biofeedback  ->  "Cooling Pool"
   Heat creeps back into the pool on its own (sympathetic arousal). Glide a finger
   across the water to send cooling ripples and keep it calm. The drop gauge fills as you cool.
   Evidence: closed-loop EDA biofeedback trains users to lower SCR bursts (WESAD).
   =========================================================================== */
const DROP = 'M28 4 C28 4 6 32 6 50 A22 22 0 0 0 50 50 C50 32 28 4 28 4 Z';

export const BioGSRLiquidPoolGame = ({ onTally, onFinish }) => {
  const [cool, setCool] = useState(60);
  const [ripples, setRipples] = useState([]);
  const coolAnim = useRef(new Animated.Value(0.6)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const lastRipple = useRef(0);
  const coolRef = useRef(cool);
  coolRef.current = cool;

  useEffect(() => {
    Animated.timing(coolAnim, { toValue: cool / 100, duration: 500, useNativeDriver: true }).start();
  }, [cool]);

  useEffect(() => {
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    l.start();
    // heat slowly creeps back; a calm pool breathes a gentle ripple of its own
    const heat = setInterval(() => setCool((c) => Math.max(20, c - 1)), 1600);
    const breathe = setInterval(() => {
      if (coolRef.current > 60) {
        const id = Date.now() + Math.random();
        setRipples((r) => [...r.slice(-9), { id, x: 40 + Math.random() * (STAGE_W - 80), y: 40 + Math.random() * 180 }]);
      }
    }, 2800);
    return () => { l.stop(); clearInterval(heat); clearInterval(breathe); };
  }, []);

  const touchRef = useRef();
  touchRef.current = (e, first) => {
    const now = Date.now();
    if (!first && now - lastRipple.current < 110) return;
    lastRipple.current = now;
    const { locationX: x, locationY: y } = e.nativeEvent;
    const id = now + Math.random();
    setRipples((r) => [...r.slice(-9), { id, x, y }]);
    setCool((c) => Math.min(100, c + (first ? 2 : 1)));
    if (first) {
      vibrate(15);
      if (onTally) onTally();
    }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => touchRef.current(e, true),
      onPanResponderMove: (e) => touchRef.current(e, false),
    })
  ).current;

  const rippleColor = cool > 70 ? '#9AF0FF' : '#FFD7A8';
  const msg =
    cool > 85 ? 'The pool is still. Stay with it.' : cool > 55 ? 'Keep gliding slowly.' : 'Your skin signal is running warm. Touch the water.';
  const yFill = 76 - (cool / 100) * 72;

  return (
    <View style={styles.gameContainer}>
      <LinearGradient colors={['#0B1220', '#0B1220']} style={StyleSheet.absoluteFill} />
      <EvidenceChip
        title="WESAD · EDA biofeedback"
        text="Seeing your arousal fall in real time trains you to calm sudomotor activity, reducing phasic SCR bursts measured in micro-Siemens."
        accent="#67E8F9"
      />

      <View style={styles.poolWrap} {...pan.panHandlers}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: coolAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }) }]}>
          <LinearGradient colors={['#3A0D0D', '#9A2F1B', '#F59E0B']} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: coolAnim.interpolate({ inputRange: [0, 0.4, 0.8], outputRange: [0, 1, 0], extrapolate: 'clamp' }) }]}>
          <LinearGradient colors={['#1E1B4B', '#4C1D95', '#8B5CF6']} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: coolAnim.interpolate({ inputRange: [0.4, 0.8], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
          <LinearGradient colors={['#083344', '#0E7490', '#67E8F9']} style={StyleSheet.absoluteFill} />
        </Animated.View>

        {/* heat shimmer, fades as the pool cools */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 10,
            left: 0,
            right: 0,
            opacity: coolAnim.interpolate({ inputRange: [0, 0.6], outputRange: [0.75, 0], extrapolate: 'clamp' }),
            transform: [{ translateY: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }],
          }}
        >
          <Svg width={STAGE_W} height={60}>
            {[0, 1, 2].map((i) => (
              <Path key={i} d={`M${20 + i * 8} ${50 - i * 6} Q${STAGE_W / 4} ${30 - i * 6} ${STAGE_W / 2} ${50 - i * 6} T${STAGE_W - 20} ${50 - i * 6}`} stroke="rgba(255,255,255,0.35)" strokeWidth="2" fill="none" strokeLinecap="round" />
            ))}
          </Svg>
        </Animated.View>

        {ripples.map((r) => (
          <Ripple
            key={r.id}
            size={70}
            color={rippleColor}
            duration={1900}
            maxScale={3}
            style={{ left: r.x - 35, top: r.y - 35 }}
            onDone={() => setRipples((l) => l.filter((x) => x.id !== r.id))}
          />
        ))}

        <View pointerEvents="none" style={styles.poolCenter}>
          <Text style={styles.poolTitle}>Glide a finger across the water</Text>
          <Text style={styles.poolSub}>{msg}</Text>
        </View>
      </View>

      <View style={styles.gaugeRow}>
        <Svg width={56} height={76} viewBox="0 0 56 76">
          <Defs>
            <ClipPath id="dropClip">
              <Path d={DROP} />
            </ClipPath>
          </Defs>
          <Rect x="0" y={yFill} width="56" height="76" fill={cool > 70 ? '#67E8F9' : cool > 40 ? '#A78BFA' : '#FBBF24'} clipPath="url(#dropClip)" />
          <Path d={DROP} stroke="rgba(255,255,255,0.8)" strokeWidth="2" fill="none" />
        </Svg>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.gaugeNum}>{cool}%</Text>
          <Text style={styles.gaugeLbl}>calm in the skin signal</Text>
        </View>
      </View>
    </View>
  );
};

/* ===========================================================================
   STYLES
   =========================================================================== */
const styles = StyleSheet.create({
  gameContainer: { flex: 1, padding: 12 },

  // evidence chip
  chip: { backgroundColor: 'rgba(8,12,28,0.6)', borderRadius: 14, paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 6 },
  chipRow: { flexDirection: 'row', alignItems: 'center' },
  chipDot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
  chipTitle: { flex: 1, color: '#F1F5F9', fontSize: 11, fontWeight: '700' },
  chipHint: { color: '#94A3B8', fontSize: 10 },
  chipText: { color: '#CBD5E1', fontSize: 10.5, lineHeight: 15, marginTop: 6 },



  // 2 pmr
  pmrStage: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center' },
  pmrFold: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  pmrLayer: { position: 'absolute', width: 150, height: 150, borderRadius: 34, borderWidth: 2 },
  pmrSpark: { position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: '#7FE5D0' },
  pmrHeadline: { color: '#fff', fontFamily: SERIF, fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  pmrSub: { color: '#FBCFE8', fontSize: 11.5, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
  pmrPips: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 14 },
  pmrPip: { width: 28, height: 5, borderRadius: 3 },

  // 3 emdr
  eyeWrap: { width: 120, height: 56, alignSelf: 'center', marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  iris: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#38BDF8', alignItems: 'center', justifyContent: 'center' },
  pupil: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#031629' },
  irisShine: { position: 'absolute', top: 5, left: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' },
  emdrTrack: { height: 170, marginTop: 8 },
  lakeBody: { position: 'absolute', left: -12, right: -12, top: 96, bottom: 0, backgroundColor: 'rgba(255,255,255,0.05)' },
  lakeLine: { position: 'absolute', left: 0, right: 0, top: 96, height: 1, backgroundColor: 'rgba(224,247,255,0.35)' },
  edgeWrap: { position: 'absolute', top: ORB_TOP, width: ORB, height: ORB, alignItems: 'center', justifyContent: 'center' },
  emdrInstruction: { color: '#E0F2FE', fontSize: 12, textAlign: 'center', marginTop: 6, paddingHorizontal: 16, lineHeight: 17 },
  emdrCount: { color: '#7DD3FC', fontFamily: SERIF, fontSize: 14, textAlign: 'center', marginTop: 6 },
  paceRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  paceChip: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(125,211,252,0.6)' },
  paceChipOn: { backgroundColor: '#7DD3FC' },
  paceTxt: { color: '#BAE6FD', fontSize: 12, fontWeight: '700' },



  // 5 pool
  poolWrap: { flex: 1, minHeight: 240, borderRadius: 28, overflow: 'hidden', marginTop: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  poolCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  poolTitle: { color: '#fff', fontFamily: SERIF, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  poolSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11.5, textAlign: 'center', marginTop: 6 },
  gaugeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 8 },
  gaugeNum: { color: '#fff', fontFamily: SERIF, fontSize: 26, fontWeight: '700' },
  gaugeLbl: { color: '#94A3B8', fontSize: 11.5, marginTop: 1 },
});