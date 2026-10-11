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
  Vibration,
} from 'react-native';
import Svg, { Path, Circle, Ellipse, G, Defs, RadialGradient, LinearGradient, Stop } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

/* =====================================================================
   FlowerMeadowGame – "Living Meadow" edition, v2
   Same game logic as the original (4-7-8 breathing, tap to plant,
   catch the falling things, score / combo / cycles).

   What's new in v2: the falling tappable items are no longer icons in
   bubbles. They are small living things, each with its own behaviour:

     • Dew droplet   – glassy water drop that wobbles (squash & stretch),
                       shimmers, and leaves a tiny trail
     • Lotus bud     – petals slowly open and close as it falls
     • Wish seed     – dandelion seed that sways under its parachute
     • Fairy wisp    – glowing spirit with orbiting sparks and a tail
     • Blossom       – cherry blossom tumbling in 3D

   Each one drifts side to side while it falls, glows softly, and bursts
   in its own colours when caught. Ambient falling petals now tumble in 3D
   as well.
   ===================================================================== */

// ---------- Palette ----------
const PALETTE = {
  lotus: '#F472B6',
  lotusGlow: '#EC4899',
  breathIn: '#818CF8',
  breathHold: '#60A5FA',
  breathOut: '#34D399',
  breathRest: '#A78BFA',
  white: '#FFFFFF',
  gold: '#F59E0B',
};

// ---------- 4-7-8 timing (unchanged) ----------
const BREATH_TIMING = { inhale: 4000, hold: 7000, exhale: 8000, rest: 2000 };

// ---------- UI constants ----------
const PHASE_ORDER = ['inhale', 'hold', 'exhale', 'rest'];
const PHASE_COLORS = {
  inhale: PALETTE.breathIn,
  hold: PALETTE.breathHold,
  exhale: PALETTE.breathOut,
  rest: PALETTE.breathRest,
};
const PHASE_TINTS = {
  inhale: 'rgba(99, 102, 241, 0.52)',
  hold: 'rgba(59, 130, 246, 0.48)',
  exhale: 'rgba(16, 185, 129, 0.48)',
  rest: 'rgba(139, 92, 246, 0.52)',
};
const XP_PER_LEVEL = 500;
const DAILY_GOAL_CYCLES = 4;
const LEVEL_TITLES = ['Seedling', 'Sprout', 'Budding', 'Blossom', 'Lotus Master'];

const BLOOM_TOP = height * 0.22;
const BLOOM_CX = width / 2;
const BLOOM_CY = BLOOM_TOP + 65;
const LOTUS = 130;
const CREATURE_BOX = 56;

let _idCounter = 0;
const uid = () => `${Date.now()}_${++_idCounter}_${Math.random().toString(36).substr(2, 6)}`;
const rand = (min, max) => min + Math.random() * (max - min);

// ---------- Falling creatures: kinds & metadata ----------
const CREATURE_KINDS = ['drop', 'bud', 'seed', 'wisp', 'blossom'];
const CREATURE_META = {
  drop: { label: 'DEW CATCH', color: '#38BDF8', burst: ['#BAE6FD', '#FFFFFF'], aura: '56,189,248' },
  bud: { label: 'LOTUS BUD', color: '#F472B6', burst: ['#F9A8D4', '#FDE68A'], aura: '244,114,182' },
  seed: { label: 'WISH SEED', color: '#E2E8F0', burst: ['#FFFFFF', '#E0E7FF'], aura: '226,232,240' },
  wisp: { label: 'FAIRY WISP', color: '#67E8F9', burst: ['#A5F3FC', '#FDE68A'], aura: '103,232,249' },
  blossom: { label: 'BLOSSOM', color: '#FBCFE8', burst: ['#FBCFE8', '#FFFFFF'], aura: '251,207,232' },
};
const randomKind = () => CREATURE_KINDS[Math.floor(Math.random() * CREATURE_KINDS.length)];

// ---------- Static scene data (generated once) ----------
const STARS = Array.from({ length: 24 }, () => ({
  x: rand(6, width - 18),
  y: rand(6, height * 0.4),
  size: rand(7, 15),
  dur: rand(1200, 3200),
  delay: rand(0, 2500),
  color: Math.random() > 0.7 ? '#FDE68A' : '#FFFFFF',
}));

const FIREFLIES = Array.from({ length: 9 }, () => {
  const x = rand(20, width - 40);
  const y = rand(height * 0.28, height * 0.72);
  return {
    x,
    y,
    dx: rand(18, 46),
    dy: rand(14, 36),
    durX: rand(3200, 6200),
    durY: rand(3600, 6800),
    flicker: rand(900, 2200),
    pullX: (BLOOM_CX - x) * 0.55,
    pullY: (BLOOM_CY - y) * 0.55,
    size: rand(22, 34),
  };
});

const BUTTERFLIES = [
  { y: height * 0.46, color: '#F9A8D4', color2: '#EC4899', dur: 16000, delay: 1000, size: 46 },
  { y: height * 0.58, color: '#93C5FD', color2: '#6366F1', dur: 22000, delay: 6000, size: 38 },
];

const FALLING_PETALS = Array.from({ length: 7 }, (_, i) => ({
  id: i,
  x: rand(10, width - 20),
  dur: rand(16000, 26000),
  delay: i * 1300,
  size: rand(16, 24),
  color: ['#F9A8D4', '#FBCFE8', '#F472B6', '#FDE68A'][i % 4],
  color2: ['#EC4899', '#F9A8D4', '#BE185D', '#F59E0B'][i % 4],
}));

const FLOWER_STYLES = [
  { kind: 'daisy', c1: '#FFFFFF', c2: '#FBBF24' },
  { kind: 'bloom', c1: '#F472B6', c2: '#FDE68A' },
  { kind: 'bloom', c1: '#A78BFA', c2: '#FDE68A' },
  { kind: 'tulip', c1: '#FB7185', c2: '#FECDD3' },
  { kind: 'daisy', c1: '#FBBF24', c2: '#92400E' },
  { kind: 'tulip', c1: '#60A5FA', c2: '#DBEAFE' },
  { kind: 'bloom', c1: '#FB923C', c2: '#FEF3C7' },
];

// ---------- SVG helpers ----------
const SPARKLE = 'M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z';
const STAR5 = 'M12 2 L14.9 8.6 L22 9.3 L16.6 14 L18.2 21 L12 17.3 L5.8 21 L7.4 14 L2 9.3 L9.1 8.6 Z';
const FLAME = 'M12 2 C12 7 7 9 7 14 A5 5 0 0 0 17 14 C17 11 15 10 15 7 C13.5 8 12 6 12 2 Z';

// A petal pointing up from (cx, baseY)
const petalPath = (cx, baseY, len, w) =>
  `M${cx} ${baseY} C${cx - w} ${baseY - len * 0.35} ${cx - w} ${baseY - len * 0.75} ${cx} ${baseY - len} ` +
  `C${cx + w} ${baseY - len * 0.75} ${cx + w} ${baseY - len * 0.35} ${cx} ${baseY} Z`;

const Icon = ({ d, size = 14, color = '#fff' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d={d} fill={color} />
  </Svg>
);

// Animated 0→1→0 loop value
const useSine = (dur, delay = 0) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: dur, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return v;
};

// Animated 0→1 linear loop value (for continuous rotation)
const useSpin = (dur) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []);
  return v;
};

// ---------- Phase icons (drawn, no emoji) ----------
const PhaseIcon = ({ phase, size = 20, color = '#fff' }) => {
  const s = { width: size, height: size };
  switch (phase) {
    case 'inhale':
      return (
        <Svg {...s} viewBox="0 0 24 24">
          <Path d="M12 22 V12" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
          <Path d="M12 14 C6 14 4 9 4 6 C9 6 12 9 12 14 Z" fill={color} />
          <Path d="M12 12 C12 7 15 4 20 4 C20 9 17 12 12 12 Z" fill={color} />
        </Svg>
      );
    case 'hold':
      return (
        <Svg {...s} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" fill="none" />
          <Circle cx="12" cy="12" r="3.5" fill={color} />
        </Svg>
      );
    case 'exhale':
      return (
        <Svg {...s} viewBox="0 0 24 24">
          <Path d="M12 3 C18 10 18 16 12 21 C6 16 6 10 12 3 Z" fill={color} />
        </Svg>
      );
    default:
      return (
        <Svg {...s} viewBox="0 0 24 24">
          <Path d="M20 14.5 A8.5 8.5 0 1 1 9.5 4 A7 7 0 0 0 20 14.5 Z" fill={color} />
        </Svg>
      );
  }
};

// ---------- Drawn lotus (3 petal layers + golden centre) ----------
const PetalLayer = ({ id, count, offset, len, w, c1, c2, style }) => (
  <Animated.View pointerEvents="none" style={[styles.lotusLayer, style]}>
    <Svg width={LOTUS} height={LOTUS} viewBox="0 0 200 200">
      <Defs>
        <LinearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={c1} />
          <Stop offset="1" stopColor={c2} />
        </LinearGradient>
      </Defs>
      {Array.from({ length: count }).map((_, i) => (
        <G key={i} rotation={offset + (360 / count) * i} origin="100, 100">
          <Path d={petalPath(100, 104, len, w)} fill={`url(#${id})`} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
        </G>
      ))}
    </Svg>
  </Animated.View>
);

const LotusArt = ({ open, drift }) => {
  const back = open.interpolate({ inputRange: [0.3, 1], outputRange: [0.8, 1.08] });
  const mid = open.interpolate({ inputRange: [0.3, 1], outputRange: [0.7, 1.05] });
  const front = open.interpolate({ inputRange: [0.3, 1], outputRange: [0.55, 1] });
  const spin = drift.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] });
  const spinR = drift.interpolate({ inputRange: [0, 1], outputRange: ['5deg', '-5deg'] });
  return (
    <View style={styles.lotusWrap} pointerEvents="none">
      <PetalLayer id="lb" count={8} offset={22.5} len={96} w={28} c1="#9D174D" c2="#F472B6" style={{ transform: [{ scale: back }, { rotate: spin }] }} />
      <PetalLayer id="lm" count={8} offset={0} len={80} w={24} c1="#DB2777" c2="#F9A8D4" style={{ transform: [{ scale: mid }, { rotate: spinR }] }} />
      <PetalLayer id="lf" count={5} offset={36} len={62} w={20} c1="#F472B6" c2="#FDF2F8" style={{ transform: [{ scale: front }] }} />
      <Animated.View style={[styles.lotusLayer, { transform: [{ scale: front }] }]}>
        <Svg width={LOTUS} height={LOTUS} viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="lc" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FEF08A" />
              <Stop offset="1" stopColor="#F59E0B" />
            </RadialGradient>
          </Defs>
          <Circle cx="100" cy="100" r="15" fill="url(#lc)" />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * 45 * Math.PI) / 180;
            return <Circle key={i} cx={100 + Math.cos(a) * 21} cy={100 + Math.sin(a) * 21} r="2.6" fill="#FDE68A" />;
          })}
        </Svg>
      </Animated.View>
    </View>
  );
};

const MandalaRing = ({ color, opacity }) => {
  const spin = useSpin(40000);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: 230,
        height: 230,
        opacity,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}
    >
      <Svg width={230} height={230} viewBox="0 0 230 230">
        <Circle cx="115" cy="115" r="108" stroke={color} strokeWidth="1" strokeDasharray="3 6" fill="none" />
        {Array.from({ length: 16 }).map((_, i) => (
          <G key={i} rotation={i * 22.5} origin="115, 115">
            <Path d={petalPath(115, 40, 22, 6)} stroke={color} strokeWidth="1.2" fill="none" />
          </G>
        ))}
      </Svg>
    </Animated.View>
  );
};

// ---------- Garden flower art ----------
const FlowerSVG = ({ kind, c1, c2 }) => (
  <Svg width={44} height={64} viewBox="0 0 44 64">
    <Path d="M22 62 C22 50 21 44 22 28" stroke="#16A34A" strokeWidth="3" fill="none" strokeLinecap="round" />
    <Path d="M22 52 C12 52 8 46 8 40 C16 40 22 44 22 52 Z" fill="#22C55E" />
    <Path d="M22 47 C32 47 36 41 36 35 C28 35 22 39 22 47 Z" fill="#16A34A" />
    {kind === 'daisy' &&
      Array.from({ length: 10 }).map((_, i) => (
        <G key={i} rotation={i * 36} origin="22, 20">
          <Path d={petalPath(22, 20, 17, 3.6)} fill={c1} stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" />
        </G>
      ))}
    {kind === 'bloom' &&
      Array.from({ length: 6 }).map((_, i) => (
        <G key={i} rotation={i * 60} origin="22, 20">
          <Path d={petalPath(22, 20, 16, 7.5)} fill={c1} stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" />
        </G>
      ))}
    {kind === 'tulip' && (
      <>
        <Path d="M11 8 C11 26 33 26 33 8 L28 15 L22 4 L16 15 Z" fill={c1} />
        <Path d="M16 15 L22 4 L28 15 C26 22 18 22 16 15 Z" fill={c2} opacity="0.55" />
      </>
    )}
    {kind !== 'tulip' && <Circle cx="22" cy="20" r="4.2" fill={c2} />}
  </Svg>
);

const GardenFlower = ({ flw, breath }) => {
  const grow = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(grow, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: rand(1800, 2800), easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: rand(1800, 2800), easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const pulse = breath.interpolate({ inputRange: [0.7, 1.4], outputRange: [0.94, 1.1] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.gardenFlower,
        {
          left: flw.x,
          top: flw.y,
          transform: [
            { translateY: grow.interpolate({ inputRange: [0, 1], outputRange: [32 * flw.scale, 0] }) },
            { scale: Animated.multiply(Animated.multiply(grow, flw.scale), pulse) },
            { rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] }) },
          ],
        },
      ]}
    >
      <FlowerSVG kind={flw.style.kind} c1={flw.style.c1} c2={flw.style.c2} />
    </Animated.View>
  );
};

// =====================================================================
// LIVING FALLING THINGS (tappable)
// =====================================================================

// Soft glowing aura behind each creature (replaces the old bubble ring)
const Aura = ({ kind, size = 76 }) => {
  const pulse = useSine(rand(1100, 1800));
  const rgb = `rgb(${CREATURE_META[kind].aura})`;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) }],
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Defs>
          <RadialGradient id={`aura_${kind}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={rgb} stopOpacity="0.5" />
            <Stop offset="1" stopColor={rgb} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="20" cy="20" r="20" fill={`url(#aura_${kind})`} />
      </Svg>
    </Animated.View>
  );
};

// 1) Dew droplet: glassy water with squash & stretch, shimmer, trail
const DewDroplet = () => {
  const wob = useSine(1000);
  const shine = useSine(1500, 300);
  const trail = useSine(650);
  return (
    <View style={{ width: 34, height: 44, alignItems: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -16,
          opacity: trail.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.75] }),
          transform: [{ translateY: trail.interpolate({ inputRange: [0, 1], outputRange: [4, -4] }) }],
        }}
      >
        <Svg width={14} height={22} viewBox="0 0 14 22">
          <Circle cx="7" cy="4" r="1.4" fill="#BAE6FD" />
          <Circle cx="4.5" cy="11" r="1.1" fill="#BAE6FD" opacity="0.8" />
          <Circle cx="9" cy="17" r="0.9" fill="#BAE6FD" opacity="0.6" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={{
          transform: [
            { scaleY: wob.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
            { scaleX: wob.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) },
          ],
        }}
      >
        <Svg width={34} height={44} viewBox="0 0 34 44">
          <Defs>
            <LinearGradient id="dropBody" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#E0F2FE" stopOpacity="0.95" />
              <Stop offset="0.55" stopColor="#38BDF8" stopOpacity="0.8" />
              <Stop offset="1" stopColor="#0369A1" stopOpacity="0.9" />
            </LinearGradient>
          </Defs>
          <Path
            d="M17 2 C25 14 31 22 31 29 A14 14 0 0 1 3 29 C3 22 9 14 17 2 Z"
            fill="url(#dropBody)"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="1"
          />
          <Path d="M8 32 A9 9 0 0 0 20 39" stroke="rgba(255,255,255,0.55)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </Svg>
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', opacity: shine.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }}
        >
          <Svg width={34} height={44} viewBox="0 0 34 44">
            <Ellipse cx="11" cy="25" rx="2.6" ry="6" fill="#FFFFFF" transform="rotate(18 11 25)" />
            <Circle cx="22" cy="19" r="1.7" fill="#FFFFFF" />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

// 2) Lotus bud: petals open and close around a glowing heart
const LotusBud = () => {
  const open = useSine(2000);
  const H = 34;
  const pivot = (deg) => [{ translateY: H / 2 }, { rotate: deg }, { translateY: -H / 2 }];
  const petal = (fill, w) => (
    <Svg width={w + 4} height={H} viewBox={`0 0 ${w + 4} ${H}`}>
      <Path d={petalPath((w + 4) / 2, H - 1, H - 3, w / 2)} fill={fill} stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />
    </Svg>
  );
  return (
    <View style={{ width: 44, height: H + 10, alignItems: 'center' }}>
      {/* glowing heart revealed when open */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 14,
          opacity: open.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
          transform: [{ scale: open.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.2] }) }],
        }}
      >
        <Svg width={16} height={16} viewBox="0 0 16 16">
          <Defs>
            <RadialGradient id="budHeart" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FEF08A" />
              <Stop offset="1" stopColor="#F59E0B" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="8" cy="8" r="8" fill="url(#budHeart)" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={{ position: 'absolute', bottom: 8, transform: pivot(open.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '-44deg'] })) }}
      >
        {petal('#BE185D', 16)}
      </Animated.View>
      <Animated.View
        style={{ position: 'absolute', bottom: 8, transform: pivot(open.interpolate({ inputRange: [0, 1], outputRange: ['6deg', '44deg'] })) }}
      >
        {petal('#DB2777', 16)}
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute',
          bottom: 8,
          transform: [{ scale: open.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
        }}
      >
        {petal('#F472B6', 18)}
      </Animated.View>
      <View style={{ position: 'absolute', bottom: 0 }}>
        <Svg width={30} height={14} viewBox="0 0 30 14">
          <Path d="M15 2 C8 2 3 6 2 12 C9 12 14 9 15 2 Z" fill="#16A34A" />
          <Path d="M15 2 C22 2 27 6 28 12 C21 12 16 9 15 2 Z" fill="#22C55E" />
        </Svg>
      </View>
    </View>
  );
};

// 3) Wish seed: dandelion seed swaying under its parachute
const DandelionSeed = () => {
  const sway = useSine(2300);
  const bob = useSine(1400);
  return (
    <Animated.View
      style={{
        transform: [
          { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [-3, 3] }) },
          { rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['-14deg', '14deg'] }) },
        ],
      }}
    >
      <Svg width={46} height={56} viewBox="0 0 46 56">
        {Array.from({ length: 15 }).map((_, i) => {
          const a = ((-80 + i * (160 / 14)) * Math.PI) / 180;
          const x2 = 23 + Math.sin(a) * 20;
          const y2 = 24 - Math.cos(a) * 20;
          return (
            <G key={i}>
              <Path d={`M23 24 L${x2} ${y2}`} stroke="rgba(255,255,255,0.9)" strokeWidth="0.9" />
              <Circle cx={x2} cy={y2} r="1.6" fill="#FFFFFF" opacity="0.9" />
            </G>
          );
        })}
        <Path d="M23 24 L23 38" stroke="#E5E7EB" strokeWidth="1.2" />
        <Path d="M23 36 C20 40 21 48 23 53 C25 48 26 40 23 36 Z" fill="#A16207" />
      </Svg>
    </Animated.View>
  );
};

// 4) Fairy wisp: glowing spirit with orbiting sparks and a flickering tail
const Wisp = () => {
  const pulse = useSine(850);
  const flick = useSine(420);
  const orbitA = useSpin(2600);
  const orbitB = useSpin(3900);
  return (
    <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -16,
          opacity: flick.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] }),
          transform: [{ scaleY: flick.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
        }}
      >
        <Svg width={16} height={30} viewBox="0 0 16 30">
          <Defs>
            <LinearGradient id="wispTail" x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0" stopColor="#A5F3FC" stopOpacity="0.8" />
              <Stop offset="1" stopColor="#A5F3FC" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d="M8 0 C14 10 15 20 8 30 C1 20 2 10 8 0 Z" fill="url(#wispTail)" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={{
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.2] }) }],
        }}
      >
        <Svg width={30} height={30} viewBox="0 0 30 30">
          <Defs>
            <RadialGradient id="wispCore" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.35" stopColor="#A5F3FC" stopOpacity="0.95" />
              <Stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="15" cy="15" r="15" fill="url(#wispCore)" />
        </Svg>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          transform: [{ rotate: orbitA.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
        }}
      >
        <Svg width={44} height={44} viewBox="0 0 44 44">
          <Circle cx="22" cy="3" r="2.3" fill="#FDE68A" />
          <Circle cx="22" cy="3" r="4.2" fill="#FDE68A" opacity="0.25" />
        </Svg>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          transform: [{ rotate: orbitB.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] }) }],
        }}
      >
        <Svg width={44} height={44} viewBox="0 0 44 44">
          <Circle cx="22" cy="9" r="1.7" fill="#FFFFFF" />
          <Circle cx="22" cy="35" r="1.4" fill="#BAE6FD" />
        </Svg>
      </Animated.View>
    </View>
  );
};

// 5) Cherry blossom tumbling in 3D
const TumblingBlossom = () => {
  const flip = useSpin(3200);
  const tilt = useSine(1800);
  return (
    <Animated.View
      style={{
        transform: [
          { perspective: 400 },
          { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          { rotateZ: tilt.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '20deg'] }) },
        ],
      }}
    >
      <Svg width={42} height={42} viewBox="-21 -21 42 42">
        <Defs>
          <RadialGradient id="blsm" cx="50%" cy="60%" r="60%">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#F9A8D4" />
          </RadialGradient>
        </Defs>
        {Array.from({ length: 5 }).map((_, i) => (
          <G key={i} rotation={i * 72}>
            <Path
              d="M0 0 C-9 -5 -11 -16 -4.5 -19 L0 -15 L4.5 -19 C11 -16 9 -5 0 0 Z"
              fill="url(#blsm)"
              stroke="#F472B6"
              strokeWidth="0.6"
            />
          </G>
        ))}
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i * 60 * Math.PI) / 180;
          return (
            <G key={`s${i}`}>
              <Path d={`M0 0 L${Math.cos(a) * 6} ${Math.sin(a) * 6}`} stroke="#FB7185" strokeWidth="0.7" />
              <Circle cx={Math.cos(a) * 6} cy={Math.sin(a) * 6} r="1" fill="#FDE68A" />
            </G>
          );
        })}
        <Circle cx="0" cy="0" r="2.6" fill="#FDE68A" />
      </Svg>
    </Animated.View>
  );
};

// Wrapper: aura + creature + gentle side-to-side drift while falling
const Creature = ({ kind }) => {
  const drift = useSine(rand(1800, 2800));
  let body;
  switch (kind) {
    case 'bud':
      body = <LotusBud />;
      break;
    case 'seed':
      body = <DandelionSeed />;
      break;
    case 'wisp':
      body = <Wisp />;
      break;
    case 'blossom':
      body = <TumblingBlossom />;
      break;
    default:
      body = <DewDroplet />;
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-12, 12] }) }],
      }}
    >
      <Aura kind={kind} />
      {body}
    </Animated.View>
  );
};

// ---------- Native Driver Driven Falling Creature (Staggered, 60 FPS, Consistent Icons) ----------
const FallingCreature = ({ drop, onCatch }) => {
  const fallAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const animRef = useRef(null);
  const [posX, setPosX] = useState(drop.x);
  const kind = drop.kind; // Consistent creature identity — NO sudden icon morphing!

  const startY = 60;
  const endY = height * 0.58;

  const startFallSequence = (initialDelay = 0) => {
    fallAnim.setValue(0);
    opacityAnim.setValue(1);

    const fallDuration = rand(14000, 18000); // Relaxing 14-18s fall

    // Sequence: optional initial delay -> linear fall -> fade out -> pause & reset
    animRef.current = Animated.sequence([
      Animated.delay(initialDelay),
      Animated.timing(fallAnim, {
        toValue: 1,
        duration: fallDuration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
    ]);

    animRef.current.start(({ finished }) => {
      if (finished) {
        setPosX(rand(30, width - 60));
        startFallSequence(rand(1500, 3500)); // Pause 1.5 - 3.5s before falling again
      }
    });
  };

  useEffect(() => {
    startFallSequence(drop.initialDelay || 0);

    return () => {
      if (animRef.current) animRef.current.stop();
    };
  }, []);

  const handlePress = () => {
    // Get approximate current Y position for splash / burst / score
    // @ts-ignore
    const currentProgress = fallAnim._value || 0;
    const currentY = startY + currentProgress * (endY - startY);

    onCatch(drop.id, posX, currentY, kind);

    if (animRef.current) animRef.current.stop();

    Animated.timing(opacityAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setPosX(rand(30, width - 60));
      startFallSequence(rand(1000, 2500));
    });
  };

  const translateY = fallAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [startY, endY],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.creatureHit,
        {
          left: posX,
          opacity: opacityAnim,
          transform: [{ translateY }, { scale: drop.scale }],
        },
      ]}
    >
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.85}
        hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
      >
        <Creature kind={kind} />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ---------- Tap effects ----------
const Ripple = ({ x, y }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
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

const BURST_ANGLES = [0, 51, 103, 154, 206, 257, 309];
const Burst = ({ x, y, colors = ['#F9A8D4', '#FDE68A'] }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - 7, top: y - 7 }}>
      {BURST_ANGLES.map((a, i) => {
        const rad = (a * Math.PI) / 180;
        const dist = 46 + (i % 3) * 16;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(rad) * dist] }) },
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(rad) * dist] }) },
                { scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1.2, 0.4] }) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '120deg'] }) },
              ],
            }}
          >
            <Icon d={SPARKLE} size={14} color={colors[i % 2]} />
          </Animated.View>
        );
      })}
    </View>
  );
};

const FloatingText = ({ text, color, x, y }) => {
  const rise = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(rise, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
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
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -70] }) }, { scale: pop }],
        },
      ]}
    >
      {text}
    </Animated.Text>
  );
};

// ---------- Living background pieces ----------
const TwinkleStar = ({ s, boost }) => {
  const tw = useSine(s.dur, s.delay);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: s.x,
        top: s.y,
        opacity: Animated.multiply(tw.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), boost),
        transform: [
          { scale: tw.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.15] }) },
          { rotate: tw.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) },
        ],
      }}
    >
      <Icon d={SPARKLE} size={s.size} color={s.color} />
    </Animated.View>
  );
};

const ShootingStar = ({ startX, startY, delay }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: startX,
        top: startY,
        opacity: t.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 0.8, 0] }),
        transform: [{ rotate: '24deg' }, { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, 300] }) }],
      }}
    >
      <Svg width={110} height={8} viewBox="0 0 110 8">
        <Defs>
          <LinearGradient id={`ss${delay}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Path d="M0 4 L104 2 L104 6 Z" fill={`url(#ss${delay})`} />
        <Circle cx="104" cy="4" r="3.2" fill="#FFFFFF" />
      </Svg>
    </Animated.View>
  );
};

const MistBand = ({ top, dur, opacity }) => {
  const d = useSine(dur);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left: -width * 0.2,
        width: width * 1.4,
        height: 120,
        borderRadius: 60,
        backgroundColor: `rgba(255,255,255,${opacity})`,
        transform: [{ translateX: d.interpolate({ inputRange: [0, 1], outputRange: [-40, 40] }) }],
      }}
    />
  );
};

const Firefly = ({ f, gather }) => {
  const wx = useSine(f.durX);
  const wy = useSine(f.durY);
  const glow = useSine(f.flicker);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: f.x,
        top: f.y,
        opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
        transform: [
          { translateX: Animated.add(wx.interpolate({ inputRange: [0, 1], outputRange: [-f.dx, f.dx] }), Animated.multiply(gather, f.pullX)) },
          { translateY: Animated.add(wy.interpolate({ inputRange: [0, 1], outputRange: [-f.dy, f.dy] }), Animated.multiply(gather, f.pullY)) },
        ],
      }}
    >
      <Svg width={f.size} height={f.size} viewBox="0 0 40 40">
        <Defs>
          <RadialGradient id="ff" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FEF9C3" stopOpacity="1" />
            <Stop offset="0.35" stopColor="#FDE047" stopOpacity="0.8" />
            <Stop offset="1" stopColor="#FACC15" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="20" cy="20" r="20" fill="url(#ff)" />
        <Circle cx="20" cy="20" r="3" fill="#FFFBEB" />
      </Svg>
    </Animated.View>
  );
};

const Butterfly = ({ b }) => {
  const x = useRef(new Animated.Value(0)).current;
  const bob = useSine(1700);
  const flap = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const fly = Animated.loop(
      Animated.sequence([
        Animated.delay(b.delay),
        Animated.timing(x, { toValue: 1, duration: b.dur, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    const wings = Animated.loop(
      Animated.sequence([
        Animated.timing(flap, { toValue: 1, duration: 170, useNativeDriver: true }),
        Animated.timing(flap, { toValue: 0, duration: 170, useNativeDriver: true }),
      ])
    );
    fly.start();
    wings.start();
    return () => {
      fly.stop();
      wings.stop();
    };
  }, []);
  const S = b.size;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: b.y,
        left: 0,
        width: S,
        height: S,
        transform: [
          { translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-S - 10, width + 10] }) },
          { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] }) },
          { rotate: bob.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] }) },
        ],
      }}
    >
      <Animated.View style={{ position: 'absolute', transform: [{ scaleX: flap.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }) }] }}>
        <Svg width={S} height={S} viewBox="0 0 60 60">
          <G>
            <Path d="M30 28 C18 4 2 8 4 24 C5 32 18 34 30 30 Z" fill={b.color} stroke={b.color2} strokeWidth="1.2" />
            <Path d="M30 32 C16 34 8 44 14 52 C22 56 30 44 30 32 Z" fill={b.color2} opacity="0.85" />
            <G transform="translate(60,0) scale(-1,1)">
              <Path d="M30 28 C18 4 2 8 4 24 C5 32 18 34 30 30 Z" fill={b.color} stroke={b.color2} strokeWidth="1.2" />
              <Path d="M30 32 C16 34 8 44 14 52 C22 56 30 44 30 32 Z" fill={b.color2} opacity="0.85" />
            </G>
            <Circle cx="12" cy="20" r="2.5" fill="#fff" opacity="0.7" />
            <Circle cx="48" cy="20" r="2.5" fill="#fff" opacity="0.7" />
          </G>
        </Svg>
      </Animated.View>
      <Svg width={S} height={S} viewBox="0 0 60 60" style={{ position: 'absolute' }}>
        <Ellipse cx="30" cy="31" rx="1.8" ry="11" fill="#1E293B" />
        <Path d="M30 21 C28 15 25 13 23 12 M30 21 C32 15 35 13 37 12" stroke="#1E293B" strokeWidth="1" fill="none" />
      </Svg>
    </Animated.View>
  );
};

// Ambient petals now tumble in 3D as they fall
const FallingPetal = ({ p }) => {
  const fall = useRef(new Animated.Value(0)).current;
  const sway = useSine(rand(1800, 3000));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(p.delay),
        Animated.timing(fall, { toValue: 1, duration: p.dur, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(fall, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: p.x,
        top: 0,
        opacity: fall.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 0.9, 0.9, 0] }),
        transform: [
          { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-30, height * 0.92] }) },
          { translateX: sway.interpolate({ inputRange: [0, 1], outputRange: [-30, 30] }) },
          { perspective: 500 },
          { rotateY: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '1260deg'] }) },
          { rotateX: sway.interpolate({ inputRange: [0, 1], outputRange: ['-40deg', '40deg'] }) },
          { rotateZ: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        ],
      }}
    >
      <Svg width={p.size} height={p.size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id={`fp${p.id}`} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={p.color2} />
            <Stop offset="1" stopColor={p.color} />
          </LinearGradient>
        </Defs>
        <Path d="M12 2 C20 8 20 18 12 22 C4 18 4 8 12 2 Z" fill={`url(#fp${p.id})`} />
        <Path d="M12 4 L12 20" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
      </Svg>
    </Animated.View>
  );
};

// =====================================================================
export const FlowerMeadowGame = (props = {}) => {
  const { initialScreen, initialDurationMin, onStartSession, onTally, onFinish } = props;

  // Game States (unchanged logic)
  const [breathPhase, setBreathPhase] = useState('inhale');
  const [cycleCount, setCycleCount] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [gardenFlowers, setGardenFlowers] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [dewDrops, setDewDrops] = useState([]);
  const [sessionStarted] = useState(true);

  // UI-only states
  const [countdown, setCountdown] = useState(BREATH_TIMING.inhale / 1000);
  const [ripples, setRipples] = useState([]);
  const [bursts, setBursts] = useState([]);

  // Animations
  const bloomScale = useRef(new Animated.Value(0.7)).current;
  const bloomGlow = useRef(new Animated.Value(0.3)).current;
  const innerPulse = useRef(new Animated.Value(1)).current;
  const phaseTextAnim = useRef(new Animated.Value(1)).current;
  const comboBump = useRef(new Animated.Value(1)).current;
  const scoreBump = useRef(new Animated.Value(1)).current;
  const ambientDrift = useRef(new Animated.Value(0)).current;
  const tints = useRef({
    inhale: new Animated.Value(1),
    hold: new Animated.Value(0),
    exhale: new Animated.Value(0),
    rest: new Animated.Value(0),
  }).current;

  // Falling creatures init with staggered entry & fixed creature kinds
  useEffect(() => {
    const kinds = ['drop', 'bud', 'seed', 'wisp', 'blossom', 'drop'];
    const drops = [];
    for (let i = 0; i < 6; i++) {
      drops.push({
        id: uid(),
        x: rand(30, width - 60),
        kind: kinds[i],
        scale: rand(0.95, 1.15),
        initialDelay: i * 2800, // Staggered entry: 0s, 2.8s, 5.6s, 8.4s, 11.2s, 14.0s
      });
    }
    setDewDrops(drops);
  }, []);

  // Phase countdown
  useEffect(() => {
    setCountdown(Math.round(BREATH_TIMING[breathPhase] / 1000));
    const tick = setInterval(() => setCountdown((c) => (c > 1 ? c - 1 : 1)), 1000);
    return () => clearInterval(tick);
  }, [breathPhase]);

  // Ambient drift for halo rings & lotus sway
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ambientDrift, { toValue: 1, duration: 3500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ambientDrift, { toValue: 0, duration: 3500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Sky tint follows breath phase
  useEffect(() => {
    PHASE_ORDER.forEach((p) => {
      Animated.timing(tints[p], { toValue: p === breathPhase ? 1 : 0, duration: 1400, useNativeDriver: true }).start();
    });
  }, [breathPhase]);

  // Bump animations
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

  // Celebrate every completed cycle
  useEffect(() => {
    if (cycleCount === 0) return;
    const reachedGoal = cycleCount % DAILY_GOAL_CYCLES === 0;
    spawnFloatingText(reachedGoal ? 'Calm Goal Reached!' : 'Cycle Complete!', PALETTE.gold, width / 2 - 80, height * 0.3);
    spawnBurst(width / 2, BLOOM_CY);
    Vibration.vibrate(reachedGoal ? [0, 60, 40, 60, 40, 120] : 40);
  }, [cycleCount]);

  // Breathing engine (4-7-8, unchanged)
  useEffect(() => {
    let timer;
    Animated.sequence([
      Animated.timing(phaseTextAnim, { toValue: 1.15, duration: 200, useNativeDriver: true }),
      Animated.timing(phaseTextAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();

    switch (breathPhase) {
      case 'inhale':
        Animated.parallel([
          Animated.timing(bloomScale, { toValue: 1.4, duration: BREATH_TIMING.inhale, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: true }),
          Animated.timing(bloomGlow, { toValue: 1, duration: BREATH_TIMING.inhale, useNativeDriver: true }),
        ]).start();
        timer = setTimeout(() => setBreathPhase('hold'), BREATH_TIMING.inhale);
        break;

      case 'hold':
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
        }, BREATH_TIMING.hold);
        break;

      case 'exhale':
        Animated.parallel([
          Animated.timing(bloomScale, { toValue: 0.7, duration: BREATH_TIMING.exhale, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: true }),
          Animated.timing(bloomGlow, { toValue: 0.3, duration: BREATH_TIMING.exhale, useNativeDriver: true }),
        ]).start();
        timer = setTimeout(() => {
          setBreathPhase('rest');
          setCycleCount((c) => c + 1);
          plantFlower();
        }, BREATH_TIMING.exhale);
        break;

      case 'rest':
        timer = setTimeout(() => setBreathPhase('inhale'), BREATH_TIMING.rest);
        break;

      default:
        break;
    }
    return () => clearTimeout(timer);
  }, [breathPhase]);

  // ---------- actions ----------
  const plantFlower = (atX) => {
    const style = FLOWER_STYLES[Math.floor(Math.random() * FLOWER_STYLES.length)];
    const x = atX !== undefined ? Math.max(8, Math.min(width - 52, atX - 22)) : rand(24, width - 64);
    setGardenFlowers((prev) => [
      ...prev.slice(-12),
      { id: uid(), style, x, y: rand(height * 0.66, height * 0.8), scale: rand(0.9, 1.3) },
    ]);
  };

  const spawnFloatingText = (text, color, x, y) => {
    const id = uid();
    setFloatingTexts((prev) => [...prev, { id, text, color, x, y }]);
    setTimeout(() => setFloatingTexts((prev) => prev.filter((t) => t.id !== id)), 1500);
  };

  const spawnRipple = (x, y) => {
    const id = uid();
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 800);
  };

  const spawnBurst = (x, y, colors) => {
    const id = uid();
    setBursts((prev) => [...prev, { id, x, y, colors }]);
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), 900);
  };

  const handleTouchScreen = (e) => {
    const touchX = e.nativeEvent.pageX || width / 2;
    const touchY = e.nativeEvent.pageY || height / 2;
    Vibration.vibrate(20);
    setScore((s) => s + 50);
    setCombo((c) => c + 1);
    spawnFloatingText('+50 STARDUST', PALETTE.gold, touchX - 50, touchY - 30);
    spawnRipple(touchX, touchY);
    spawnBurst(touchX, touchY);
    plantFlower(touchX);
  };

  const handleCatchDewDrop = (dropId, dropX, dropY, kind) => {
    const meta = CREATURE_META[kind] || CREATURE_META.drop;
    Vibration.vibrate([0, 30, 20, 30]);
    setScore((s) => s + 100);
    spawnFloatingText(`${meta.label} +100`, meta.color, dropX - 40, dropY - 20);
    spawnRipple(dropX + CREATURE_BOX / 2, dropY + CREATURE_BOX / 2);
    spawnBurst(dropX + CREATURE_BOX / 2, dropY + CREATURE_BOX / 2, meta.burst);
    setDewDrops((prev) =>
      prev.map((d) => (d.id === dropId ? { ...d, y: 80, x: rand(30, width - 60), kind: randomKind() } : d))
    );
    plantFlower(dropX + CREATURE_BOX / 2);
  };

  const getPhaseDetails = () => {
    switch (breathPhase) {
      case 'inhale':
        return { title: 'Inhale Deeply', sub: 'Expand with the blooming lotus', color: PALETTE.breathIn };
      case 'hold':
        return { title: 'Hold Breath', sub: 'Feel calm energy center inside', color: PALETTE.breathHold };
      case 'exhale':
        return { title: 'Slow Exhale', sub: 'Release tension & bloom garden', color: PALETTE.breathOut };
      case 'rest':
        return { title: 'Rest & Relax', sub: 'Prepare for next calm wave', color: PALETTE.breathRest };
      default:
        return { title: 'Breathe', sub: 'Follow the bloom', color: PALETTE.lotus };
    }
  };
  const phase = getPhaseDetails();

  // Derived values
  const level = Math.floor(score / XP_PER_LEVEL) + 1;
  const levelTitle = LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
  const xpPercent = ((score % XP_PER_LEVEL) / XP_PER_LEVEL) * 100;
  const goalDone = cycleCount % DAILY_GOAL_CYCLES;
  const haloOpacity = bloomGlow.interpolate({ inputRange: [0.3, 1], outputRange: [0.25, 0.75] });
  const driftScale = ambientDrift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const gather = bloomGlow.interpolate({ inputRange: [0.3, 1], outputRange: [0, 1] });
  const starBoost = bloomGlow.interpolate({ inputRange: [0.3, 1], outputRange: [0.55, 1] });

  return (
    <TouchableWithoutFeedback onPress={handleTouchScreen}>
      <View style={styles.container}>
        <ImageBackground source={require('../assets/zen_garden_bg.png')} style={styles.bgImage} resizeMode="cover">
          <View style={styles.overlayShade} />

          {/* ===== Living background ===== */}
          {PHASE_ORDER.map((p) => (
            <Animated.View
              key={p}
              pointerEvents="none"
              style={[StyleSheet.absoluteFillObject, { backgroundColor: PHASE_TINTS[p], opacity: tints[p] }]}
            />
          ))}

          {STARS.map((s, i) => (
            <TwinkleStar key={i} s={s} boost={starBoost} />
          ))}
          <ShootingStar startX={-40} startY={height * 0.08} delay={5000} />
          <ShootingStar startX={width * 0.2} startY={height * 0.02} delay={11000} />

          <MistBand top={height * 0.58} dur={9000} opacity={0.07} />
          <MistBand top={height * 0.7} dur={13000} opacity={0.09} />

          {FIREFLIES.map((f, i) => (
            <Firefly key={i} f={f} gather={gather} />
          ))}
          {BUTTERFLIES.map((b, i) => (
            <Butterfly key={i} b={b} />
          ))}
          {FALLING_PETALS.map((p) => (
            <FallingPetal key={p.id} p={p} />
          ))}

          {/* ===== Top HUD (Seedling level, XP & calm goal) ===== */}
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
                <Animated.View style={[styles.statPill, styles.pillRow, { transform: [{ scale: scoreBump }] }]}>
                  <Icon d={SPARKLE} size={13} color="#FDE68A" />
                  <Text style={styles.statPillText}>{score}</Text>
                </Animated.View>
                <Animated.View style={[styles.statPill, styles.comboPill, styles.pillRow, { transform: [{ scale: comboBump }] }]}>
                  <Icon d={FLAME} size={13} color="#FB7185" />
                  <Text style={styles.statPillText}>x{combo}</Text>
                </Animated.View>
              </View>
            </View>

            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Calm goal</Text>
              <View style={styles.goalDots}>
                {Array.from({ length: DAILY_GOAL_CYCLES }).map((_, i) => (
                  <View key={i} style={[styles.goalDot, i < goalDone && { backgroundColor: PALETTE.gold, borderColor: PALETTE.gold }]}>
                    {i < goalDone && <Icon d={STAR5} size={13} color="#FFFFFF" />}
                  </View>
                ))}
              </View>
              <Text style={styles.goalLabel}>
                {goalDone}/{DAILY_GOAL_CYCLES}
              </Text>
            </View>
          </View>

          {/* Living falling things: tap to catch (60 FPS native driver animation) */}
          {dewDrops.map((drop) => (
            <FallingCreature key={drop.id} drop={drop} onCatch={handleCatchDewDrop} />
          ))}

          {/* Planted flowers sanctuary (breathes with you) */}
          {gardenFlowers.map((flw) => (
            <GardenFlower key={flw.id} flw={flw} breath={bloomScale} />
          ))}

          {/* Center lotus & guide */}
          <View style={styles.centerContainer} pointerEvents="box-none">
            <View style={styles.bloomCenter} pointerEvents="none">
              <MandalaRing color={phase.color} opacity={haloOpacity} />
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
                  { borderColor: phase.color, opacity: haloOpacity, transform: [{ scale: Animated.multiply(bloomScale, 1.2) }] },
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
                <LotusArt open={bloomGlow} drift={ambientDrift} />
              </Animated.View>

              <View style={[styles.countdownBadge, { borderColor: phase.color }]}>
                <Text style={[styles.countdownText, { color: phase.color }]}>{countdown}s</Text>
              </View>
            </View>

            <Animated.View pointerEvents="none" style={[styles.centerGuideBox, { transform: [{ scale: phaseTextAnim }] }]}>
              <View style={styles.phaseTitleRow}>
                <PhaseIcon phase={breathPhase} size={22} color={phase.color} />
                <Text style={[styles.centerPhaseTitle, { color: phase.color }]}>{phase.title}</Text>
              </View>
              <Text style={styles.centerPhaseSub}>{phase.sub}</Text>

              <View style={styles.centerPhaseTracker}>
                {PHASE_ORDER.map((p) => {
                  const active = p === breathPhase;
                  return (
                    <View
                      key={p}
                      style={[styles.centerTrackerStep, active && { backgroundColor: PHASE_COLORS[p], borderColor: PHASE_COLORS[p], width: 26 }]}
                    >
                      {active && <PhaseIcon phase={p} size={9} color="#0F172A" />}
                    </View>
                  );
                })}
              </View>

              <View style={[styles.centerCycleBadge, styles.pillRow]}>
                <Svg width={13} height={13} viewBox="0 0 44 64">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <G key={i} rotation={i * 60} origin="22, 32">
                      <Path d={petalPath(22, 32, 20, 9)} fill="#F9A8D4" />
                    </G>
                  ))}
                  <Circle cx="22" cy="32" r="6" fill="#FDE68A" />
                </Svg>
                <Text style={styles.centerCycleTxt}>
                  {cycleCount} {cycleCount === 1 ? 'Cycle' : 'Cycles'}
                </Text>
              </View>
            </Animated.View>
          </View>

          {/* Tap effects */}
          {ripples.map((r) => (
            <Ripple key={r.id} x={r.x} y={r.y} />
          ))}
          {bursts.map((b) => (
            <Burst key={b.id} x={b.x} y={b.y} colors={b.colors} />
          ))}

          {floatingTexts.map((txt) => (
            <FloatingText key={txt.id} text={txt.text} color={txt.color} x={txt.x} y={txt.y} />
          ))}

          {/* Bottom hint */}
          <View style={styles.controlHint} pointerEvents="none">
            <Text style={styles.controlHintText}>Catch the falling dew, buds, seeds & wisps. Tap anywhere to bloom flowers.</Text>
            <Text style={styles.controlHintSub}>{gardenFlowers.length} flowers bloomed in your sanctuary</Text>
          </View>
        </ImageBackground>
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  bgImage: { flex: 1, width: '100%', height: '100%' },
  overlayShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.16)' },

  // ---- HUD ----
  hud: {
    position: 'absolute',
    top: 4,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  hudRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  levelBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PALETTE.lotusGlow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FBCFE8',
  },
  levelBadgeNum: { color: PALETTE.white, fontSize: 16, fontWeight: '900' },
  levelTitle: { color: '#FBCFE8', fontSize: 12, fontWeight: '800' },
  xpTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 3, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: 3, backgroundColor: PALETTE.gold },
  xpLabel: { color: '#94A3B8', fontSize: 8.5, fontWeight: '700', marginTop: 2 },
  statsCol: { alignItems: 'flex-end', gap: 4 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: PALETTE.gold,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  comboPill: { backgroundColor: 'rgba(236, 72, 153, 0.22)', borderColor: PALETTE.lotusGlow },
  statPillText: { color: PALETTE.white, fontSize: 11, fontWeight: '900' },
  goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6 },
  goalLabel: { color: '#CBD5E1', fontSize: 9.5, fontWeight: '800' },
  goalDots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  goalDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ---- Living falling things (no bubble, just the creature + glow) ----
  creatureHit: {
    position: 'absolute',
    width: CREATURE_BOX,
    height: CREATURE_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gardenFlower: { position: 'absolute', width: 44, height: 64, alignItems: 'center', justifyContent: 'center' },

  // ---- Center & lotus ----
  centerContainer: { position: 'absolute', top: BLOOM_TOP, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  bloomCenter: { width: 140, height: 140, justifyContent: 'center', alignItems: 'center' },
  haloRing: { position: 'absolute', width: 130, height: 130, borderRadius: 65 },
  haloOuter: { borderWidth: 1.5, backgroundColor: 'rgba(129, 140, 248, 0.06)' },
  haloMid: { borderWidth: 2.5, backgroundColor: 'rgba(244, 114, 182, 0.08)' },
  bloomGlowCircle: {
    width: LOTUS,
    height: LOTUS,
    borderRadius: LOTUS / 2,
    backgroundColor: 'rgba(244, 114, 182, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    elevation: 12,
    shadowOpacity: 0.9,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    overflow: 'visible',
  },
  lotusWrap: { width: LOTUS, height: LOTUS, alignItems: 'center', justifyContent: 'center' },
  lotusLayer: { position: 'absolute', width: LOTUS, height: LOTUS },
  countdownBadge: {
    position: 'absolute',
    bottom: -14,
    paddingHorizontal: 8,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: { fontSize: 13, fontWeight: '900' },
  centerGuideBox: {
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderRadius: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    minWidth: 210,
  },
  phaseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  centerPhaseTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  centerPhaseSub: { color: '#CBD5E1', fontSize: 10.5, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  centerPhaseTracker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 4 },
  centerTrackerStep: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerCycleBadge: {
    backgroundColor: 'rgba(236, 72, 153, 0.25)',
    borderColor: '#EC4899',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
  centerCycleTxt: { color: '#FBCFE8', fontSize: 10, fontWeight: '800' },
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
  controlHint: { position: 'absolute', bottom: 12, left: 10, right: 10, alignItems: 'center' },
  controlHintText: { color: '#FDE68A', fontSize: 9.5, fontWeight: '800', textAlign: 'center' },
  controlHintSub: { color: '#94A3B8', fontSize: 8.5, fontWeight: '700', marginTop: 1 },
});

export default FlowerMeadowGame;