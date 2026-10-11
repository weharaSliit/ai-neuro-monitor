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
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, G, Ellipse } from 'react-native-svg';
import { ThemeContext } from '../context/ThemeContext';

const { width } = Dimensions.get('window');

// ---------------------------------------------------------------------------
// Gamification constants: soft progression, rewards only (no penalties, no fail)
// ---------------------------------------------------------------------------
const XP_PER_LEVEL = 300;
const CYCLE_GOAL = 5;
const LEVEL_TITLES = ['Seedling', 'Drifting Cloud', 'Calm Lake', 'Moonlit Mind', 'Still Mountain'];

// ---------------------------------------------------------------------------
// Mindful Body Scan Region Catalog
// ---------------------------------------------------------------------------
const BODY_SCAN_REGIONS = [
  {
    id: 'head_jaw',
    name: 'Head & Mind',
    nerve: 'Mind Unwind',
    cue: 'Unclench your jaw and soften your forehead.',
    benefit: 'Clears mental fog and eases racing thoughts.',
    icon: '🧠',
    color: '#7DD3FC',
    nodeY: 28,
  },
  {
    id: 'shoulders_neck',
    name: 'Shoulders & Neck',
    nerve: 'Tension Release',
    cue: 'Let your shoulders drop away from your ears.',
    benefit: 'Melts physical weight and tightness.',
    icon: '💆‍♂️',
    color: '#C4B5FD',
    nodeY: 62,
  },
  {
    id: 'chest_heart',
    name: 'Heart Center',
    nerve: 'Heart Harmony',
    cue: 'Breathe warmth gently into your chest.',
    benefit: 'Soothes a busy heart and anxious feelings.',
    icon: '🫀',
    color: '#F9A8D4',
    nodeY: 96,
  },
  {
    id: 'abdomen_core',
    name: 'Solar Core',
    nerve: 'Belly Calm',
    cue: 'Send soft, slow waves of breath into your belly.',
    benefit: 'Invites deep, whole-body relaxation.',
    icon: '☀️',
    color: '#FCD34D',
    nodeY: 132,
  },
  {
    id: 'feet_grounding',
    name: 'Grounded Roots',
    nerve: 'Rooted Peace',
    cue: 'Feel your feet heavy and anchored.',
    benefit: 'Draws restless energy down into the earth.',
    icon: '👣',
    color: '#6EE7B7',
    nodeY: 185,
  },
];

// ---------------------------------------------------------------------------
// Ambient floating light motes (calm background life)
// ---------------------------------------------------------------------------
const Mote = ({ left, top, size, delay, duration, color }) => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
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
        left: `${left}%`,
        top: `${top}%`,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.55, 0] }),
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -70] }) }],
      }}
    />
  );
};

const AmbientMotes = ({ color = 'rgba(255,255,255,0.9)', count = 14 }) => {
  const motes = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: Math.random() * 94 + 2,
        top: Math.random() * 80 + 10,
        size: 3 + Math.random() * 4,
        delay: Math.random() * 4000,
        duration: 6000 + Math.random() * 5000,
      })),
    [count]
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {motes.map((m) => (
        <Mote key={m.id} {...m} color={color} />
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Pop-able bubble (tap for a gentle reward, it drifts back after a moment)
// ---------------------------------------------------------------------------
const CalmBubble = ({ style, size = 34, delay = 0, onPop }) => {
  const [visible, setVisible] = useState(true);
  const bob = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 2600 + delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 2600 + delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        style,
        { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => {
          onPop && onPop();
          setVisible(false);
          timer.current = setTimeout(() => setVisible(true), 3500);
        }}
        style={[styles.bubble, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View style={styles.bubbleShine} />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ===========================================================================
// Core Gamified Meditation Engine
// ===========================================================================
export const MindfulMeditationEngine = (props) => {
  const {
    activeMode: rawActiveMode,
    mode,
    initialMode,
    subOptionId,
    onFinishSession,
    isPaused = false,
  } = props;

  const extractString = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object') return val.id || val.mode || val.technique_id || val.key || val.title || '';
    return String(val);
  };

  const rawModeStr =
    extractString(mode) ||
    extractString(initialMode) ||
    extractString(subOptionId) ||
    extractString(rawActiveMode) ||
    'box_meditation';
  const s = rawModeStr.toLowerCase();

  let activeMode = 'box_meditation';
  if (s.includes('body') || s.includes('scan') || s.includes('sweep') || s.includes('mindful')) {
    activeMode = 'body_scan_mindful';
  } else if (s.includes('diaphragmatic') || s.includes('belly') || s.includes('deep') || s.includes('pace')) {
    activeMode = 'diaphragmatic_pace';
  } else if (s.includes('bio') || s.includes('rhythm') || s.includes('tap')) {
    activeMode = 'bio_rhythm_tap';
  } else {
    activeMode = 'box_meditation';
  }

  const themeContext = React.useContext(ThemeContext);
  const isDarkMode = themeContext?.isDarkMode ?? true;

  // Local Game States
  const [activeBodyRegion, setActiveBodyRegion] = useState(0);
  const [cyclesCompleted, setCyclesCompleted] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(4);
  const [phaseIdx, setPhaseIdx] = useState(0); // 0: Inhale, 1: Hold, 2: Exhale, 3: Rest
  const [rhythmStreak, setRhythmStreak] = useState(0);
  const [coherenceScore, setCoherenceScore] = useState(96);
  const [xpPopups, setXpPopups] = useState([]);
  const [totalXp, setTotalXp] = useState(0);
  const [softenedZones, setSoftenedZones] = useState([]);
  const [tapHint, setTapHint] = useState('');

  // Animated Values
  const boxProgressAnim = useRef(new Animated.Value(0)).current;
  const corePulseScale = useRef(new Animated.Value(1.0)).current;
  const waveHeightAnim = useRef(new Animated.Value(0.3)).current;
  const tapRippleAnim = useRef(new Animated.Value(0)).current;
  const crestDrift = useRef(new Animated.Value(0)).current;
  const scaleRef = useRef(1);

  // Level math
  const level = Math.floor(totalXp / XP_PER_LEVEL);
  const levelTitle = LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)];
  const levelPct = ((totalXp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100;

  // Slow ambient loop (water crest drift)
  useEffect(() => {
    const crest = Animated.loop(
      Animated.sequence([
        Animated.timing(crestDrift, { toValue: 1, duration: 5000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(crestDrift, { toValue: 0, duration: 5000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    crest.start();
    return () => crest.stop();
  }, []);

  // Floating reward popup (soft, short, never alarming)
  const triggerXpPopup = (amountText, xp = 0, customX = null, customY = null) => {
    const id = Date.now() + Math.random();
    const newPopup = {
      id,
      text: amountText,
      anim: new Animated.Value(0),
      x: customX !== null ? customX : width * 0.28 + (Math.random() * 40 - 20),
      y: customY !== null ? customY : 90 + (Math.random() * 24 - 12),
    };

    if (xp > 0) setTotalXp((t) => t + xp);
    setXpPopups((prev) => [...prev.slice(-3), newPopup]);

    Animated.timing(newPopup.anim, {
      toValue: 1,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setXpPopups((prev) => prev.filter((p) => p.id !== id));
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. STARLIGHT BOX ENGINE (4-4-4-4 perimeter trace)
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (activeMode !== 'box_meditation' || isPaused) return;

    let currentPhase = 0;
    let sec = 4;
    setSecondsLeft(4);
    setPhaseIdx(0);

    const runBoxAnimation = () => {
      boxProgressAnim.setValue(0);
      Animated.timing(boxProgressAnim, {
        toValue: 4,
        duration: 16000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished && !isPaused) {
          setCyclesCompleted((c) => c + 1);
          triggerXpPopup('Full cycle  +100', 100);
          runBoxAnimation();
        }
      });
    };

    runBoxAnimation();

    const updatePhaseScale = (phase) => {
      const targets = [1.3, 1.33, 0.85, 1.0];
      const easings = [Easing.inOut(Easing.ease), Easing.linear, Easing.inOut(Easing.ease), Easing.linear];
      Animated.timing(corePulseScale, {
        toValue: targets[phase],
        duration: 4000,
        easing: easings[phase],
        useNativeDriver: true,
      }).start();
    };

    updatePhaseScale(0);

    const interval = setInterval(() => {
      sec -= 1;
      if (sec <= 0) {
        currentPhase = (currentPhase + 1) % 4;
        setPhaseIdx(currentPhase);
        updatePhaseScale(currentPhase);
        sec = 4;
      }
      setSecondsLeft(sec);
    }, 1000);

    return () => {
      clearInterval(interval);
      boxProgressAnim.stopAnimation();
    };
  }, [activeMode, isPaused]);

  // Tapping the glowing node of the current phase = "in flow" reward.
  // Tapping another node is never punished, only gently redirected.
  const handleBoxTap = (nodePhase) => {
    if (Platform.OS !== 'web') Vibration.vibrate(10);
    if (nodePhase === 'CENTER' || nodePhase === phaseIdx) {
      triggerXpPopup('In flow  +25', 25);
      setRhythmStreak((st) => st + 1);
      setTapHint('');
    } else {
      setTapHint('Follow the glowing star. No rush.');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. TIDE POOL PACING ENGINE (4s inhale / 6s extended exhale)
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (activeMode !== 'diaphragmatic_pace' || isPaused) return;

    let isInhale = true;
    let sec = 4;
    setSecondsLeft(4);
    setPhaseIdx(0);

    const updateWave = () => {
      if (isInhale) {
        setPhaseIdx(0);
        sec = 4;
        Animated.timing(waveHeightAnim, {
          toValue: 0.85,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }).start();
        Animated.timing(corePulseScale, {
          toValue: 1.3,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start();
      } else {
        setPhaseIdx(2);
        sec = 6;
        Animated.timing(waveHeightAnim, {
          toValue: 0.15,
          duration: 6000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }).start();
        Animated.timing(corePulseScale, {
          toValue: 0.85,
          duration: 6000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start();
      }
    };

    updateWave();

    const interval = setInterval(() => {
      sec -= 1;
      if (sec <= 0) {
        isInhale = !isInhale;
        if (isInhale) {
          setCyclesCompleted((c) => c + 1);
          triggerXpPopup('Tide rolled in  +100', 100);
        }
        updateWave();
      }
      setSecondsLeft(sec > 0 ? sec : isInhale ? 4 : 6);
    }, 1000);

    return () => clearInterval(interval);
  }, [activeMode, isPaused]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. LIGHT JOURNEY BODY SCAN ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (activeMode !== 'body_scan_mindful' || isPaused) return;

    let regionIdx = 0;
    const interval = setInterval(() => {
      regionIdx = (regionIdx + 1) % BODY_SCAN_REGIONS.length;
      setActiveBodyRegion(regionIdx);
      if (regionIdx === 0) {
        setCyclesCompleted((c) => c + 1);
        setSoftenedZones([]);
        triggerXpPopup('Body journey done  +100', 100);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [activeMode, isPaused]);

  const handleSoftenZone = () => {
    const reg = BODY_SCAN_REGIONS[activeBodyRegion];
    if (softenedZones.includes(reg.id)) {
      triggerXpPopup('Already soft and warm', 0);
      return;
    }
    if (Platform.OS !== 'web') Vibration.vibrate(10);
    setSoftenedZones((z) => [...z, reg.id]);
    triggerXpPopup(`${reg.name} softened  +50`, 50);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. HEARTBEAT GLOW ENGINE (tap with the pulse)
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (activeMode !== 'bio_rhythm_tap' || isPaused) return;

    const listenerId = corePulseScale.addListener(({ value }) => {
      scaleRef.current = value;
    });

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(corePulseScale, { toValue: 1.35, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(corePulseScale, { toValue: 0.9, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulseAnim.start();

    return () => {
      pulseAnim.stop();
      corePulseScale.removeListener(listenerId);
    };
  }, [activeMode, isPaused]);

  // Every tap is rewarded. Tapping near the glow's peak earns a little more.
  const handleRhythmTap = () => {
    if (Platform.OS !== 'web') Vibration.vibrate(10);
    const nearPeak = scaleRef.current > 1.2;
    setRhythmStreak((st) => st + 1);
    setCoherenceScore((prev) => Math.min(100, prev + 1));
    triggerXpPopup(nearPeak ? 'In sync  +30' : 'Gentle beat  +15', nearPeak ? 30 : 15);

    tapRippleAnim.setValue(0);
    Animated.timing(tapRippleAnim, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  // Perimeter orb interpolation (frame is 220 wide, corners inset by 22)
  const orbX = boxProgressAnim.interpolate({
    inputRange: [0, 1, 2, 3, 4],
    outputRange: [22, 198, 198, 22, 22],
  });
  const orbY = boxProgressAnim.interpolate({
    inputRange: [0, 1, 2, 3, 4],
    outputRange: [22, 22, 198, 198, 22],
  });

  const getBoxPhaseDetails = () => {
    switch (phaseIdx) {
      case 0:
        return { title: 'Inhale', cue: 'Breathe in slowly, like drawing in starlight.', color: '#7DD3FC' };
      case 1:
        return { title: 'Hold', cue: 'Rest in the stillness. Nothing to do.', color: '#A5B4FC' };
      case 2:
        return { title: 'Exhale', cue: 'Let the breath leave, and let stress drift off with it.', color: '#6EE7B7' };
      case 3:
      default:
        return { title: 'Rest', cue: 'Pause softly before the next cycle.', color: '#F9A8D4' };
    }
  };

  const boxPhase = getBoxPhaseDetails();
  const currentRegion = BODY_SCAN_REGIONS[activeBodyRegion] || BODY_SCAN_REGIONS[0];
  const goalDone = cyclesCompleted >= CYCLE_GOAL;

  const gradientColors =
    activeMode === 'box_meditation'
      ? ['#0B1026', '#17204A', '#2A2F6B'] // Night sky
      : activeMode === 'diaphragmatic_pace'
        ? ['#073B4C', '#0E6E8C', '#58B8C8'] // Shallow sea
        : activeMode === 'body_scan_mindful'
          ? ['#1F1235', '#3B2A66', '#6A4FA3'] // Twilight
          : ['#0E2A2F', '#1A5A5F', '#7BA89A']; // Sage mist

  const accent =
    activeMode === 'box_meditation'
      ? boxPhase.color
      : activeMode === 'diaphragmatic_pace'
        ? '#7DD3FC'
        : activeMode === 'body_scan_mindful'
          ? currentRegion.color
          : '#99F6E4';

  // Shared progress header: level, XP bar, and a soft goal tracker
  const renderHeader = (extraChip) => (
    <View style={styles.headerCard}>
      <View style={styles.headerTopRow}>
        <View>
          <Text style={styles.levelLabel}>LEVEL {level + 1}</Text>
          <Text style={styles.levelTitle}>{levelTitle}</Text>
        </View>
        <View style={styles.goalDotsWrap}>
          <View style={styles.goalDotsRow}>
            {Array.from({ length: CYCLE_GOAL }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.goalDot,
                  i < cyclesCompleted && { backgroundColor: accent, borderColor: accent },
                ]}
              />
            ))}
          </View>
          <Text style={styles.goalText}>
            {goalDone ? 'Calm goal reached' : `${cyclesCompleted}/${CYCLE_GOAL} calm cycles`}
          </Text>
        </View>
      </View>
      <View style={styles.xpTrack}>
        <View style={[styles.xpFill, { width: `${Math.max(levelPct, 3)}%`, backgroundColor: accent }]} />
      </View>
      <View style={styles.headerChipsRow}>
        <View style={styles.statChip}>
          <Text style={styles.statChipText}>{totalXp} calm points</Text>
        </View>
        {extraChip}
      </View>
    </View>
  );

  return (
    <View style={styles.outerContainer}>
      <LinearGradient colors={gradientColors} style={styles.gradientBackground}>
        <AmbientMotes
          color={isDarkMode ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.8)'}
          count={activeMode === 'diaphragmatic_pace' ? 10 : 14}
        />

        {isPaused && (
          <View style={styles.pausedPill} pointerEvents="none">
            <Text style={styles.pausedText}>Paused. Breathe naturally.</Text>
          </View>
        )}

        {/* Floating reward popups */}
        {xpPopups.map((popup) => {
          const translateY = popup.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -50] });
          const opacity = popup.anim.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 1, 0] });
          return (
            <Animated.View
              key={popup.id}
              style={[styles.xpPopupContainer, { left: popup.x, top: popup.y, opacity, transform: [{ translateY }] }]}
              pointerEvents="none"
            >
              <View style={[styles.xpPopupPill, { borderColor: accent }]}>
                <Text style={styles.xpPopupText}>{popup.text}</Text>
              </View>
            </Animated.View>
          );
        })}

        {/* ═══════════════ MODE 1: STARLIGHT BOX ═══════════════ */}
        {activeMode === 'box_meditation' && (
          <ScrollView contentContainerStyle={styles.modeScrollContent} showsVerticalScrollIndicator={false}>
            {renderHeader(
              <View style={styles.statChip}>
                <Text style={styles.statChipText}>In-flow streak {rhythmStreak}</Text>
              </View>
            )}

            <View style={styles.boxArena}>
              <View style={[styles.squareFrame, { borderColor: boxPhase.color + '66' }]}>
                {[
                  { p: 0, label: 'Inhale', pos: styles.cornerTL },
                  { p: 1, label: 'Hold', pos: styles.cornerTR },
                  { p: 2, label: 'Exhale', pos: styles.cornerBR },
                  { p: 3, label: 'Rest', pos: styles.cornerBL },
                ].map((n) => {
                  const on = phaseIdx === n.p;
                  return (
                    <TouchableOpacity
                      key={n.p}
                      activeOpacity={0.75}
                      style={[
                        styles.cornerNode,
                        n.pos,
                        on && { backgroundColor: boxPhase.color + '33', borderColor: boxPhase.color },
                      ]}
                      onPress={() => handleBoxTap(n.p)}
                    >
                      <View style={[styles.cornerStar, on && { backgroundColor: boxPhase.color }]} />
                      <Text style={[styles.cornerNodeTxt, on && { color: '#FFFFFF' }]}>{n.label}</Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Light orb gliding along the edges */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.perimeterOrb,
                    { left: orbX, top: orbY, backgroundColor: boxPhase.color, shadowColor: boxPhase.color },
                  ]}
                >
                  <View style={styles.perimeterOrbCore} />
                </Animated.View>

                {/* Breathing core */}
                <TouchableOpacity activeOpacity={0.9} onPress={() => handleBoxTap('CENTER')}>
                  <Animated.View
                    style={[
                      styles.coreOrb,
                      { borderColor: boxPhase.color, transform: [{ scale: corePulseScale }] },
                    ]}
                  >
                    <Text style={styles.coreTimer}>{secondsLeft}</Text>
                    <Text style={[styles.corePhaseLabel, { color: boxPhase.color }]}>{boxPhase.title}</Text>
                  </Animated.View>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.guidanceBanner}>
              <Text style={[styles.guidanceBannerTitle, { color: boxPhase.color }]}>{boxPhase.title}</Text>
              <Text style={styles.guidanceBannerCue}>{boxPhase.cue}</Text>
              <Text style={styles.tapPromptTxt}>
                {tapHint || 'Tap the glowing star to collect calm points.'}
              </Text>
            </View>
          </ScrollView>
        )}

        {/* ═══════════════ MODE 2: TIDE POOL ═══════════════ */}
        {activeMode === 'diaphragmatic_pace' && (
          <ScrollView contentContainerStyle={styles.modeScrollContent} showsVerticalScrollIndicator={false}>
            {renderHeader(
              <View style={styles.statChip}>
                <Text style={styles.statChipText}>Belly breathing</Text>
              </View>
            )}

            <View style={styles.oceanArena}>
              <Animated.View
                style={[
                  styles.oceanWaveContainer,
                  {
                    height: waveHeightAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['20%', '90%'],
                    }),
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.waveCrest,
                    {
                      transform: [
                        { translateX: crestDrift.interpolate({ inputRange: [0, 1], outputRange: [-30, 30] }) },
                      ],
                    },
                  ]}
                />
                <LinearGradient colors={['#38BDF8AA', '#0284C7CC', '#075985EE']} style={styles.oceanWaveFill} />
              </Animated.View>

              <CalmBubble
                style={{ position: 'absolute', top: 30, right: 36 }}
                onPop={() => triggerXpPopup('Bubble popped  +15', 15)}
              />
              <CalmBubble
                size={26}
                delay={500}
                style={{ position: 'absolute', top: 70, left: 28 }}
                onPop={() => triggerXpPopup('Bubble popped  +15', 15)}
              />
              <CalmBubble
                size={20}
                delay={900}
                style={{ position: 'absolute', bottom: 38, right: 46 }}
                onPop={() => triggerXpPopup('Bubble popped  +15', 15)}
              />

              <Animated.View style={[styles.waveCenterOrb, { transform: [{ scale: corePulseScale }] }]}>
                <Text style={styles.waveTimerTxt}>{secondsLeft}</Text>
                <Text style={styles.wavePhaseTag}>{phaseIdx === 0 ? 'Breathe in' : 'Long slow out'}</Text>
              </Animated.View>
            </View>

            <View style={styles.guidanceBanner}>
              <Text style={[styles.guidanceBannerTitle, { color: '#7DD3FC' }]}>
                {phaseIdx === 0 ? 'Fill your belly (4s)' : 'Release like a receding tide (6s)'}
              </Text>
              <Text style={styles.guidanceBannerCue}>
                {phaseIdx === 0
                  ? 'Let your belly rise outward like a peaceful swell.'
                  : 'Let the air flow out smooth and long. The longer exhale tells your body it is safe.'}
              </Text>
              <Text style={styles.tapPromptTxt}>Pop the drifting bubbles whenever you like.</Text>
            </View>
          </ScrollView>
        )}

        {/* ═══════════════ MODE 3: LIGHT JOURNEY BODY SCAN ═══════════════ */}
        {activeMode === 'body_scan_mindful' && (
          <ScrollView contentContainerStyle={styles.modeScrollContent} showsVerticalScrollIndicator={false}>
            {renderHeader(
              <View style={styles.statChip}>
                <Text style={styles.statChipText}>
                  {softenedZones.length}/{BODY_SCAN_REGIONS.length} zones softened
                </Text>
              </View>
            )}

            <View style={styles.bodyScanArenaRow}>
              <View style={styles.silhouetteCard}>
                <Text style={[styles.silhouetteTitle, { color: currentRegion.color }]}>BODY MAP</Text>
                <View style={styles.svgContainer}>
                  <Svg width="120" height="210" viewBox="0 0 120 210">
                    <Circle cx="60" cy="28" r="14" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
                    <Line x1="60" y1="42" x2="60" y2="52" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
                    <Line x1="32" y1="58" x2="88" y2="58" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />
                    <Line x1="60" y1="52" x2="60" y2="135" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
                    <Line x1="32" y1="58" x2="22" y2="115" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />
                    <Line x1="88" y1="58" x2="98" y2="115" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />
                    <Line x1="60" y1="135" x2="42" y2="195" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />
                    <Line x1="60" y1="135" x2="78" y2="195" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />

                    {BODY_SCAN_REGIONS.map((reg, idx) => {
                      const isActive = activeBodyRegion === idx;
                      const softened = softenedZones.includes(reg.id);
                      return (
                        <G key={reg.id}>
                          {(isActive || softened) && (
                            <Ellipse
                              cx="60"
                              cy={reg.nodeY}
                              rx={isActive ? 26 : 16}
                              ry={isActive ? 20 : 12}
                              fill={reg.color}
                              opacity={isActive ? 0.28 : 0.16}
                            />
                          )}
                          <Circle
                            cx="60"
                            cy={reg.nodeY}
                            r={isActive ? 8 : 5}
                            fill={softened || isActive ? reg.color : 'rgba(255,255,255,0.35)'}
                            stroke="#FFFFFF"
                            strokeWidth={isActive ? 2 : 1}
                          />
                        </G>
                      );
                    })}
                  </Svg>
                </View>
              </View>

              <View style={styles.detailsRightCol}>
                <View style={[styles.activeZoneDetailCard, { borderColor: currentRegion.color + '99' }]}>
                  <View style={styles.activeZoneTopRow}>
                    <Text style={styles.activeZoneEmoji}>{currentRegion.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activeZoneTitle}>{currentRegion.name}</Text>
                      <Text style={[styles.activeZoneNerve, { color: currentRegion.color }]}>{currentRegion.nerve}</Text>
                    </View>
                  </View>
                  <Text style={styles.activeZoneCue}>{currentRegion.cue}</Text>
                  <View style={styles.activeZoneMechanismBox}>
                    <Text style={styles.activeZoneMechanismTxt}>{currentRegion.benefit}</Text>
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={handleSoftenZone}
                    style={[
                      styles.softenBtn,
                      {
                        backgroundColor: softenedZones.includes(currentRegion.id)
                          ? currentRegion.color + '33'
                          : currentRegion.color,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.softenBtnTxt,
                        { color: softenedZones.includes(currentRegion.id) ? '#FFFFFF' : '#1F1235' },
                      ]}
                    >
                      {softenedZones.includes(currentRegion.id) ? 'Softened' : 'Tap to soften this zone'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.zoneSelectorPillRow}>
                  {BODY_SCAN_REGIONS.map((reg, idx) => {
                    const isActive = activeBodyRegion === idx;
                    const softened = softenedZones.includes(reg.id);
                    return (
                      <TouchableOpacity
                        key={reg.id}
                        activeOpacity={0.8}
                        style={[
                          styles.zoneSelectorPill,
                          softened && { borderColor: reg.color },
                          isActive && { backgroundColor: reg.color + '55', borderColor: reg.color },
                        ]}
                        onPress={() => setActiveBodyRegion(idx)}
                      >
                        <Text style={styles.zonePillIcon}>{softened ? '✓' : reg.icon}</Text>
                        <Text style={[styles.zonePillTxt, { color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.75)' }]}>
                          {reg.name.split(' ')[0]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          </ScrollView>
        )}

        {/* ═══════════════ MODE 4: HEARTBEAT GLOW ═══════════════ */}
        {activeMode === 'bio_rhythm_tap' && (
          <ScrollView contentContainerStyle={styles.modeScrollContent} showsVerticalScrollIndicator={false}>
            {renderHeader(
              <View style={styles.statChip}>
                <Text style={styles.statChipText}>
                  {rhythmStreak} beats  ·  {coherenceScore}% coherence
                </Text>
              </View>
            )}

            <View style={styles.rhythmTapCenterWrap}>
              {/* Fixed target ring: tap when the glow reaches it */}
              <View style={styles.rhythmTargetRing} pointerEvents="none" />
              <TouchableOpacity activeOpacity={0.9} onPress={handleRhythmTap}>
                <Animated.View style={[styles.rhythmPulseContainer, { transform: [{ scale: corePulseScale }] }]}>
                  <Animated.View
                    style={[
                      styles.rhythmRippleRing,
                      {
                        opacity: tapRippleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
                        transform: [
                          { scale: tapRippleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.9] }) },
                        ],
                      },
                    ]}
                  />
                  <View style={styles.rhythmInnerGlow} />
                  <Text style={styles.rhythmTitleTxt}>Heartbeat Glow</Text>
                  <Text style={styles.rhythmActionTag}>tap as it brightens</Text>
                </Animated.View>
              </TouchableOpacity>
            </View>

            <View style={styles.guidanceBanner}>
              <Text style={[styles.guidanceBannerTitle, { color: '#99F6E4' }]}>Match the glow</Text>
              <Text style={styles.guidanceBannerCue}>
                Breathe in as it grows, out as it fades. Every tap counts, so there is no wrong beat.
              </Text>
            </View>
          </ScrollView>
        )}
      </LinearGradient>
    </View>
  );
};

const GLASS = 'rgba(255,255,255,0.08)';
const GLASS_BORDER = 'rgba(255,255,255,0.18)';

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  gradientBackground: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  modeScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    width: '100%',
  },
  pausedPill: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    zIndex: 50,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  pausedText: { color: '#E2E8F0', fontSize: 11, fontWeight: '600' },

  // Reward popups
  xpPopupContainer: { position: 'absolute', zIndex: 999, elevation: 10 },
  xpPopupPill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
  },
  xpPopupText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },

  // Header / progress
  headerCard: {
    width: '100%',
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 20,
    padding: 12,
    marginBottom: 12,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  levelLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  levelTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginTop: 1 },
  goalDotsWrap: { alignItems: 'flex-end' },
  goalDotsRow: { flexDirection: 'row', gap: 5 },
  goalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'transparent',
  },
  goalText: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600', marginTop: 4 },
  xpTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  xpFill: { height: 6, borderRadius: 3 },
  headerChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  statChip: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  statChipText: { color: '#F1F5F9', fontSize: 11, fontWeight: '600' },

  // Box arena
  boxArena: {
    width: 250,
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  squareFrame: {
    width: 220,
    height: 220,
    borderRadius: 30,
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.04)',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerNode: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  cornerStar: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  cornerNodeTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700' },
  cornerTL: { top: -15, left: -12 },
  cornerTR: { top: -15, right: -12 },
  cornerBR: { bottom: -15, right: -12 },
  cornerBL: { bottom: -15, left: -12 },

  perimeterOrb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
    marginTop: -10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 12,
    elevation: 8,
  },
  perimeterOrbCore: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' },

  coreOrb: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreTimer: { color: '#FFFFFF', fontSize: 30, fontWeight: '300' },
  corePhaseLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 1 },

  // Tide pool
  oceanArena: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    borderColor: 'rgba(125, 211, 252, 0.6)',
    backgroundColor: 'rgba(7, 59, 76, 0.4)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: 8,
  },
  oceanWaveContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
  },
  waveCrest: {
    position: 'absolute',
    top: -12,
    left: -100,
    width: 420,
    height: 28,
    borderRadius: 200,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  oceanWaveFill: { flex: 1 },
  bubble: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    padding: 5,
  },
  bubbleShine: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  waveCenterOrb: { alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  waveTimerTxt: { color: '#FFFFFF', fontSize: 34, fontWeight: '300' },
  wavePhaseTag: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },

  // Body scan
  bodyScanArenaRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    marginVertical: 4,
  },
  silhouetteCard: {
    width: 124,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  silhouetteTitle: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  svgContainer: { width: 120, height: 210, alignItems: 'center', justifyContent: 'center' },
  detailsRightCol: { flex: 1, gap: 8, justifyContent: 'space-between' },
  activeZoneDetailCard: {
    flex: 1,
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center',
  },
  activeZoneTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  activeZoneEmoji: { fontSize: 22 },
  activeZoneTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  activeZoneNerve: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  activeZoneCue: { color: '#E2E8F0', fontSize: 12, lineHeight: 17, marginBottom: 6 },
  activeZoneMechanismBox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: 8,
    borderRadius: 12,
    marginBottom: 8,
  },
  activeZoneMechanismTxt: { color: '#CBD5E1', fontSize: 10, lineHeight: 14 },
  softenBtn: {
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
  },
  softenBtnTxt: { fontSize: 11, fontWeight: '700' },
  zoneSelectorPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  zoneSelectorPill: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  zonePillIcon: { fontSize: 11, color: '#FFFFFF' },
  zonePillTxt: { fontSize: 9, fontWeight: '700' },

  // Heartbeat glow
  rhythmTapCenterWrap: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  rhythmTargetRing: {
    position: 'absolute',
    width: 170 * 1.35,
    height: 170 * 1.35,
    borderRadius: (170 * 1.35) / 2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(153, 246, 228, 0.45)',
  },
  rhythmPulseContainer: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 2,
    borderColor: '#99F6E4',
    backgroundColor: 'rgba(153, 246, 228, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rhythmInnerGlow: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(153, 246, 228, 0.18)',
  },
  rhythmRippleRing: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 2,
    borderColor: '#C4B5FD',
  },
  rhythmTitleTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.6 },
  rhythmActionTag: { color: '#99F6E4', fontSize: 11, fontWeight: '600', marginTop: 3 },

  // Guidance
  guidanceBanner: {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    alignItems: 'center',
    marginTop: 6,
  },
  guidanceBannerTitle: { fontSize: 15, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 },
  guidanceBannerCue: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
  },
  tapPromptTxt: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export const MeditationGame = MindfulMeditationEngine;
export default MindfulMeditationEngine;