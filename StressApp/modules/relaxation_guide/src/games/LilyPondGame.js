import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Easing,
  Vibration,
  ImageBackground,
} from 'react-native';

const { width, height } = Dimensions.get('window');

// 4-7-8 Stress Reduction Protocol (unchanged)
const BREATH_TIMING = {
  inhale: 4000,
  hold: 7000,
  exhale: 8000,
  rest: 2000,
};

const PHASE_ORDER = ['inhale', 'hold', 'exhale', 'rest'];
const SESSION_CYCLES = 4; // 4 rounds is the classic starter session for 4-7-8

// Layout
const CX = width / 2;
const CY = height * 0.33;
const RING_R = 122;
const RING_DOTS = 32;
const FAR = Math.min(width * 0.46, 190);

let _idCounter = 0;
const uid = () => `${Date.now()}_${++_idCounter}_${Math.random().toString(36).substr(2, 6)}`;
const rand = (min, max) => min + Math.random() * (max - min);

const PHASE_UI = {
  inhale: { title: 'Breathe in', sub: 'Slowly through your nose and let the lotus open', color: '#A5B4FC' },
  hold: { title: 'Hold', sub: 'Stay still while the light gathers', color: '#7DD3FC' },
  exhale: { title: 'Breathe out', sub: 'Through your mouth, and send the light across the pond', color: '#6EE7B7' },
  rest: { title: 'Rest', sub: 'Let the water settle', color: '#C4B5FD' },
};

const PHASE_TINTS = {
  inhale: 'rgba(99, 102, 241, 0.48)',
  hold: 'rgba(59, 130, 246, 0.45)',
  exhale: 'rgba(16, 185, 129, 0.45)',
  rest: 'rgba(139, 92, 246, 0.48)',
};

/* ---------- small building blocks ---------- */

// One lotus petal. The zero-size parent is rotated, the child slides outward as `bloom` grows.
const Petal = ({ angle, bloom, w, h, from, to, color }) => (
  <View style={[styles.zero, { transform: [{ rotate: `${angle}deg` }] }]}>
    <Animated.View
      style={{
        position: 'absolute',
        left: -w / 2,
        top: -h / 2,
        width: w,
        height: h,
        borderRadius: w / 2,
        backgroundColor: color,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.55)',
        transform: [
          { translateY: bloom.interpolate({ inputRange: [0.7, 1.4], outputRange: [-from, -to] }) },
          { scale: bloom.interpolate({ inputRange: [0.7, 1.4], outputRange: [0.65, 1.05] }) },
        ],
      }}
    />
  </View>
);

// One bead on the breath ring. Lights up once the ring progress passes its position.
const RingDot = ({ index, progress, color }) => {
  const t = index / RING_DOTS;
  return (
    <View style={[styles.zero, { transform: [{ rotate: `${(index / RING_DOTS) * 360}deg` }] }]}>
      <Animated.View
        style={[
          styles.ringDot,
          {
            top: -RING_R - 3,
            backgroundColor: color,
            opacity: progress.interpolate({
              inputRange: [t, t + 0.02],
              outputRange: [0.22, 1],
              extrapolate: 'clamp',
            }),
          },
        ]}
      />
    </View>
  );
};

export const LilyPondGame = (props = {}) => {
  const { initialScreen, initialDurationMin, onStartSession, onTally, onFinish } = props;
  const [breathPhase, setBreathPhase] = useState('inhale');
  const [cycleCount, setCycleCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(4);
  const [ripples, setRipples] = useState([]);
  const [engaged, setEngaged] = useState(false);
  const [flow, setFlow] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);

  // Fireflies that gather on the inhale and scatter on the exhale
  const [fireflies] = useState(() =>
    Array.from({ length: 14 }, () => {
      const a = rand(0, Math.PI * 2);
      const near = rand(70, 115);
      const far = rand(FAR * 0.75, FAR);
      return {
        id: uid(),
        size: rand(5, 9),
        color: Math.random() > 0.5 ? '#FDE68A' : '#FFFFFF',
        fx: Math.cos(a) * far,
        fy: Math.sin(a) * far,
        nx: Math.cos(a) * near,
        ny: Math.sin(a) * near,
        tw: new Animated.Value(rand(0.25, 1)),
      };
    })
  );

  // Animated values
  const bloomScale = useRef(new Animated.Value(0.7)).current;
  const bloomGlow = useRef(new Animated.Value(0.3)).current;
  const phaseAnim = useRef(new Animated.Value(1)).current;
  const gather = useRef(new Animated.Value(0)).current;
  const ringProgress = useRef(new Animated.Value(0)).current;
  const phaseProgress = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const swirl = useRef(new Animated.Value(0)).current;
  const touchPos = useRef(new Animated.ValueXY({ x: -200, y: -200 })).current;
  const touchScale = useRef(new Animated.Value(0.5)).current;
  const touchOpacity = useRef(new Animated.Value(0)).current;

  const tints = useRef({
    inhale: new Animated.Value(1),
    hold: new Animated.Value(0),
    exhale: new Animated.Value(0),
    rest: new Animated.Value(0),
  }).current;

  useEffect(() => {
    PHASE_ORDER.forEach((p) => {
      Animated.timing(tints[p], { toValue: p === breathPhase ? 1 : 0, duration: 1400, useNativeDriver: true }).start();
    });
  }, [breathPhase]);

  // Refs for the "flow" sync score
  const touchingRef = useRef(false);
  const engagedRef = useRef(false);
  const phaseRef = useRef('inhale');
  const syncRef = useRef({ good: 0, total: 0 });
  phaseRef.current = breathPhase;

  /* ---------- ambient loops ---------- */
  useEffect(() => {
    const loops = [
      Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 90000, easing: Easing.linear, useNativeDriver: true })
      ),
      Animated.loop(
        Animated.timing(swirl, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: true })
      ),
      ...fireflies.map((f) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(f.tw, { toValue: 1, duration: rand(1200, 2600), useNativeDriver: true }),
            Animated.timing(f.tw, { toValue: 0.25, duration: rand(1200, 2600), useNativeDriver: true }),
          ])
        )
      ),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);

  /* ---------- 4-7-8 breathing engine (same timing logic as before) ---------- */
  useEffect(() => {
    if (sessionDone) return undefined;
    let timer;

    Animated.sequence([
      Animated.timing(phaseAnim, { toValue: 1.12, duration: 200, useNativeDriver: true }),
      Animated.timing(phaseAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
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
        timer = setTimeout(() => setBreathPhase('hold'), BREATH_TIMING.inhale);
        break;
      }
      case 'hold': {
        timer = setTimeout(() => setBreathPhase('exhale'), BREATH_TIMING.hold);
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
        }, BREATH_TIMING.exhale);
        break;
      }
      case 'rest': {
        timer = setTimeout(() => setBreathPhase('inhale'), BREATH_TIMING.rest);
        break;
      }
      default:
        break;
    }

    return () => clearTimeout(timer);
  }, [breathPhase, sessionDone]);

  /* ---------- visuals that follow the phase: ring, timeline, fireflies, countdown ---------- */
  useEffect(() => {
    if (sessionDone) return undefined;
    const dur = BREATH_TIMING[breathPhase];

    phaseProgress.setValue(0);
    Animated.timing(phaseProgress, {
      toValue: 1,
      duration: dur,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    if (breathPhase === 'inhale') {
      ringProgress.setValue(0);
      Animated.timing(ringProgress, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: false }).start();
      Animated.timing(gather, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
    } else if (breathPhase === 'hold') {
      ringProgress.setValue(1);
    } else if (breathPhase === 'exhale') {
      Animated.timing(ringProgress, { toValue: 0, duration: dur, easing: Easing.linear, useNativeDriver: false }).start();
      Animated.timing(gather, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
    } else {
      ringProgress.setValue(0);
    }

    if (breathPhase !== 'rest') Vibration.vibrate(15); // soft cue at each phase change

    setSecondsLeft(Math.round(dur / 1000));
    const iv = setInterval(() => setSecondsLeft((s) => Math.max(1, s - 1)), 1000);
    return () => clearInterval(iv);
  }, [breathPhase, sessionDone]);

  /* ---------- session end ---------- */
  useEffect(() => {
    if (cycleCount >= SESSION_CYCLES) setSessionDone(true);
  }, [cycleCount]);

  const restartSession = () => {
    syncRef.current = { good: 0, total: 0 };
    setFlow(0);
    setCycleCount(0);
    setSessionDone(false);
  };

  /* ---------- flow score: finger down while breathing in/holding, finger up while breathing out ---------- */
  useEffect(() => {
    const iv = setInterval(() => {
      const p = phaseRef.current;
      if (!engagedRef.current || p === 'rest') return;
      const inSync = p === 'exhale' ? !touchingRef.current : touchingRef.current;
      syncRef.current.total += 1;
      if (inSync) syncRef.current.good += 1;
      const pct = Math.round((syncRef.current.good / syncRef.current.total) * 100);
      setFlow((prev) => (prev === pct ? prev : pct));
    }, 250);
    return () => clearInterval(iv);
  }, []);

  /* ---------- touch: press and hold the water like a lung ---------- */
  const addRipple = (x, y) => {
    const r = { id: uid(), x, y, anim: new Animated.Value(0) };
    setRipples((prev) => [...prev.slice(-5), r]);
    Animated.timing(r.anim, {
      toValue: 1,
      duration: 1400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    setTimeout(() => setRipples((prev) => prev.filter((i) => i.id !== r.id)), 1500);
  };

  const onGrant = (e) => {
    const { pageX, pageY } = e.nativeEvent;
    touchingRef.current = true;
    engagedRef.current = true;
    setEngaged(true);
    Vibration.vibrate(10);
    touchPos.setValue({ x: pageX - 35, y: pageY - 35 });
    touchScale.setValue(0.5);
    Animated.parallel([
      Animated.spring(touchScale, { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.timing(touchOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    addRipple(pageX, pageY);
  };

  const onMove = (e) => {
    const { pageX, pageY } = e.nativeEvent;
    touchPos.setValue({ x: pageX - 35, y: pageY - 35 });
  };

  const onRelease = (e) => {
    const { pageX, pageY } = e.nativeEvent;
    touchingRef.current = false;
    Animated.parallel([
      Animated.timing(touchScale, { toValue: 1.6, duration: 500, useNativeDriver: true }),
      Animated.timing(touchOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
    addRipple(pageX, pageY);
  };

  /* ---------- render ---------- */
  const ui = PHASE_UI[breathPhase];
  const phaseIdx = PHASE_ORDER.indexOf(breathPhase);
  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const swirlDeg = swirl.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  const segments = [
    { key: 'inhale', flex: 4, label: '4s in' },
    { key: 'hold', flex: 7, label: '7s hold' },
    { key: 'exhale', flex: 8, label: '8s out' },
  ];

  return (
    <View
      style={styles.container}
      onStartShouldSetResponder={() => !sessionDone}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onRelease}
    >
      {/* Background image (the only thing kept from the old design) */}
      <ImageBackground
        source={require('../assets/zen_lotus_bg.png')}
        style={styles.bgImage}
        resizeMode="cover"
      >
        <View style={styles.overlayShade} pointerEvents="none" />

        {/* Phase dynamic background tints */}
        {PHASE_ORDER.map((p) => (
          <Animated.View
            key={p}
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, { backgroundColor: PHASE_TINTS[p], opacity: tints[p] }]}
          />
        ))}

        {/* Fireflies: drift in on the inhale, scatter on the exhale */}
        <View style={[styles.anchor, { left: CX, top: CY }]} pointerEvents="none">
          <Animated.View style={[styles.zero, { transform: [{ rotate: swirlDeg }] }]}>
            {fireflies.map((f) => (
              <Animated.View
                key={f.id}
                style={{
                  position: 'absolute',
                  left: -f.size / 2,
                  top: -f.size / 2,
                  width: f.size,
                  height: f.size,
                  borderRadius: f.size / 2,
                  backgroundColor: f.color,
                  shadowColor: f.color,
                  shadowOpacity: 1,
                  shadowRadius: 6,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 4,
                  opacity: f.tw,
                  transform: [
                    { translateX: gather.interpolate({ inputRange: [0, 1], outputRange: [f.fx, f.nx] }) },
                    { translateY: gather.interpolate({ inputRange: [0, 1], outputRange: [f.fy, f.ny] }) },
                  ],
                }}
              />
            ))}
          </Animated.View>
        </View>

        {/* Water ripples */}
        {ripples.map((rip) => (
          <Animated.View
            key={rip.id}
            pointerEvents="none"
            style={[
              styles.rippleRing,
              {
                left: rip.x - 50,
                top: rip.y - 50,
                opacity: rip.anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
                transform: [{ scale: rip.anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.6] }) }],
              },
            ]}
          />
        ))}

        {/* The breathing lotus */}
        <View style={[styles.anchor, { left: CX, top: CY }]} pointerEvents="none">
          {/* Halo */}
          <Animated.View
            style={[
              styles.halo,
              {
                backgroundColor: ui.color,
                opacity: bloomGlow.interpolate({ inputRange: [0.3, 1], outputRange: [0.1, 0.3] }),
                transform: [{ scale: bloomScale }],
              },
            ]}
          />

          {/* Breath ring: fills on inhale, full on hold, drains on exhale */}
          {Array.from({ length: RING_DOTS }).map((_, i) => (
            <RingDot key={i} index={i} progress={ringProgress} color={ui.color} />
          ))}

          {/* A single bead circles the ring while you hold */}
          {breathPhase === 'hold' && (
            <Animated.View
              style={[
                styles.zero,
                {
                  transform: [
                    {
                      rotate: phaseProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '720deg'],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.comet} />
            </Animated.View>
          )}

          {/* Petals */}
          <Animated.View style={[styles.zero, { transform: [{ rotate: spinDeg }] }]}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Petal key={`o${i}`} angle={i * 45} bloom={bloomScale} w={40} h={84} from={16} to={46} color="rgba(249,168,212,0.8)" />
            ))}
            {Array.from({ length: 8 }).map((_, i) => (
              <Petal key={`m${i}`} angle={i * 45 + 22.5} bloom={bloomScale} w={34} h={70} from={10} to={32} color="rgba(251,207,232,0.9)" />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <Petal key={`i${i}`} angle={i * 60 + 10} bloom={bloomScale} w={26} h={50} from={4} to={16} color="rgba(255,241,246,0.95)" />
            ))}
          </Animated.View>

          {/* Core with the live count */}
          <Animated.View
            style={[
              styles.core,
              { borderColor: ui.color, transform: [{ scale: phaseAnim }] },
            ]}
          >
            <Text style={styles.coreNumber}>{breathPhase === 'rest' ? '•' : secondsLeft}</Text>
          </Animated.View>
        </View>

        {/* Finger orb */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.touchOrb,
            {
              borderColor: ui.color,
              opacity: touchOpacity,
              transform: [...touchPos.getTranslateTransform(), { scale: touchScale }],
            },
          ]}
        />

        {/* Top bar: session progress and flow */}
        <View style={styles.topBar} pointerEvents="none">
          <View style={styles.pips}>
            {Array.from({ length: SESSION_CYCLES }).map((_, i) => (
              <View key={i} style={[styles.pip, i < cycleCount && styles.pipFilled]} />
            ))}
          </View>
          {engaged && <Text style={styles.flowText}>Flow {flow}%</Text>}
        </View>

        {/* Guideline hint sentence */}
        {!sessionDone && (
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>Press & hold the water to breathe in • Release to breathe out</Text>
          </View>
        )}

        {/* Bottom panel: phase instruction and 4-7-8 timeline */}
        <View style={styles.panel} pointerEvents="none">
          <Text style={[styles.panelTitle, { color: ui.color }]}>{ui.title}</Text>
          <Text style={styles.panelSub}>{ui.sub}</Text>

          <View style={styles.timeline}>
            {segments.map((seg, i) => {
              const done = i < phaseIdx;
              const active = i === phaseIdx;
              return (
                <View key={seg.key} style={{ flex: seg.flex }}>
                  <View style={styles.track}>
                    {done && <View style={[styles.fill, { width: '100%', backgroundColor: PHASE_UI[seg.key].color }]} />}
                    {active && (
                      <Animated.View
                        style={[
                          styles.fill,
                          {
                            backgroundColor: ui.color,
                            width: phaseProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                          },
                        ]}
                      />
                    )}
                  </View>
                  <Text style={[styles.segLabel, active && { color: '#FFFFFF' }]}>{seg.label}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Session complete */}
        {sessionDone && (
          <View style={styles.doneOverlay}>
            <View style={styles.doneCard}>
              <Text style={styles.doneEmoji}>🪷</Text>
              <Text style={styles.doneTitle}>Session complete</Text>
              <Text style={styles.doneBody}>
                {SESSION_CYCLES} rounds of 4-7-8 breathing. Notice how your shoulders and jaw feel.
              </Text>
              {engaged && <Text style={styles.doneFlow}>Flow {flow}%</Text>}
              <TouchableOpacity style={styles.doneButton} onPress={restartSession} activeOpacity={0.8}>
                <Text style={styles.doneButtonText}>Breathe again</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ImageBackground>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#041D17',
  },
  bgImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlayShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 29, 23, 0.16)',
  },

  // zero-size anchors used for radial layouts
  anchor: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
  zero: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  },

  halo: {
    position: 'absolute',
    left: -130,
    top: -130,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  ringDot: {
    position: 'absolute',
    left: -3,
    top: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  comet: {
    position: 'absolute',
    left: -7,
    top: -RING_R - 7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  core: {
    position: 'absolute',
    left: -29,
    top: -29,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255, 236, 179, 0.95)',
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  coreNumber: {
    fontSize: 26,
    fontWeight: '300',
    color: '#064E3B',
  },

  rippleRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  touchOrb: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },

  topBar: {
    position: 'absolute',
    top: 56,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pips: {
    flexDirection: 'row',
    gap: 8,
  },
  pip: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  pipFilled: {
    backgroundColor: '#F9A8D4',
  },
  flowText: {
    color: '#E7FBF1',
    fontSize: 13,
    fontWeight: '600',
  },

  hint: {
    position: 'absolute',
    top: 44,
    left: 14,
    right: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(6, 28, 24, 0.72)',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(253, 230, 138, 0.28)',
  },
  hintText: {
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },

  panel: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 85,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: 'rgba(6, 28, 24, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  panelTitle: {
    fontSize: 28,
    fontWeight: '300',
    letterSpacing: 0.5,
  },
  panelSub: {
    color: '#E7FBF1',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  timeline: {
    flexDirection: 'row',
    gap: 6,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  segLabel: {
    marginTop: 6,
    color: 'rgba(231,251,241,0.55)',
    fontSize: 11,
  },

  doneOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 29, 23, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  doneCard: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    padding: 24,
    borderRadius: 28,
    backgroundColor: 'rgba(6, 28, 24, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  doneEmoji: {
    fontSize: 48,
  },
  doneTitle: {
    marginTop: 8,
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '300',
  },
  doneBody: {
    marginTop: 8,
    color: '#E7FBF1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  doneFlow: {
    marginTop: 12,
    color: '#6EE7B7',
    fontSize: 14,
    fontWeight: '600',
  },
  doneButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 24,
    backgroundColor: '#F9A8D4',
  },
  doneButtonText: {
    color: '#064E3B',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default LilyPondGame;