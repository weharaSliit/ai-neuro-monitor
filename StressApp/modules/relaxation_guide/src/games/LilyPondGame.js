import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  TouchableOpacity,
  Animated,
  Dimensions,
  Easing,
  Vibration,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';

const { width, height } = Dimensions.get('window');

const PETAL_COUNT_OUTER = 6;
const PETAL_COUNT_INNER = 6;
const DURATION_OPTIONS_MIN = [1, 2, 3];
const BPM_OPTIONS = [4.5, 5, 5.5, 6, 6.5, 7];
const AMBIENT_TICK_MS = 40;

const PATTERNS = {
  extended: {
    id: 'extended',
    label: 'Extended Exhale (Vagal Reset)',
    inhaleRatio: 0.40,
    exhaleRatio: 0.60,
    defaultBpm: 5.5,
    citation: 'Zaccaro et al., 2018, Frontiers in Human Neuroscience',
    blurb: 'Longer exhalations trigger vagal nerve activation to lower heart rate and calm autonomic stress.',
  },
  coherent: {
    id: 'coherent',
    label: 'Coherent Breathing (6 BPM Resonance)',
    inhaleRatio: 0.50,
    exhaleRatio: 0.50,
    defaultBpm: 6.0,
    citation: 'Lehrer & Gevirtz, 2014, Frontiers in Psychology',
    blurb: 'Equal 5s inhale and 5s exhale near cardiovascular resonance frequency for peak HRV oscillation.',
  },
};

const COLORS = {
  background: '#041D17',
  waterDark: '#07281F',
  waterLight: '#0E4434',
  padDark: '#0D402B',
  padBorder: '#1F6B4C',
  petalOuter: '#F472B6',
  petalInner: '#FB7185',
  petalGlow: 'rgba(244, 114, 182, 0.4)',
  stamen: '#F59E0B',
  centerCore: '#FDE047',
  accent: '#10B981',
  accentLight: '#6EE7B7',
  text: '#E7FBF1',
  textDim: 'rgba(231, 251, 241, 0.6)',
  rippleIn: '#34D399',
  rippleOut: '#38BDF8',
  rippleTouch: '#F472B6',
};

const LilyBreathingGame = ({
  onStartSession,
  onDurationChange,
  initialScreen = 'session',
  initialDurationMin = 1,
  initialBpm = 5.5,
}) => {
  const themeContext = React.useContext(ThemeContext);
  const theme = themeContext?.theme || {};
  const isDarkMode = themeContext?.isDarkMode ?? true;

  const [screen, setScreen] = useState(initialScreen);
  const [patternId, setPatternId] = useState('extended');
  const [bpm, setBpm] = useState(initialBpm || PATTERNS.extended.defaultBpm);
  const [durationMin, setDurationMin] = useState(initialDurationMin || 3);
  useEffect(() => {
    if (initialDurationMin) setDurationMin(initialDurationMin);
  }, [initialDurationMin]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [breathCount, setBreathCount] = useState(0);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'inhale' | 'exhale'
  const [isPaused, setIsPaused] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [ripples, setRipples] = useState([]);

  // Interactive fireflies/sparks in water
  const [fireflies, setFireflies] = useState(() =>
    Array.from({ length: 6 }, (_, i) => ({
      id: i,
      x: Math.random() * width,
      y: height * 0.15 + Math.random() * height * 0.5,
      size: 4 + Math.random() * 6,
      opacity: 0.3 + Math.random() * 0.5,
      speed: 0.4 + Math.random() * 0.6,
      angle: Math.random() * Math.PI * 2,
    }))
  );

  // Animated values
  const bloom = useRef(new Animated.Value(0)).current; // 0 closed -> 1 open
  const phaseProgress = useRef(new Animated.Value(0)).current; // 0 -> 1
  const phaseTextOpacity = useRef(new Animated.Value(1)).current;
  const pulseRingScale = useRef(new Animated.Value(1)).current;
  const screenFade = useRef(new Animated.Value(1)).current;
  const touchGlow = useRef(new Animated.Value(0)).current;

  const tickRef = useRef(null);
  const ambientRef = useRef(null);
  const isPressedRef = useRef(false);
  const pausedRef = useRef(false);
  const patternRef = useRef(patternId);
  const bpmRef = useRef(bpm);
  const currentPhaseDurationRef = useRef(0);

  const pattern = PATTERNS[patternId];
  const totalSeconds = durationMin * 60;

  useEffect(() => { patternRef.current = patternId; }, [patternId]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);

  const computeDurations = () => {
    const pat = PATTERNS[patternRef.current];
    const periodMs = (60 / bpmRef.current) * 1000;
    return {
      inhaleMs: periodMs * pat.inhaleRatio,
      exhaleMs: periodMs * pat.exhaleRatio,
    };
  };

  // Idle pulse animation for touch guide
  useEffect(() => {
    if (phase === 'idle' && !isPaused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseRingScale, {
            toValue: 1.25,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseRingScale, {
            toValue: 1.0,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseRingScale.stopAnimation();
      pulseRingScale.setValue(1);
    }
  }, [phase, isPaused]);

  // Overall session timer
  useEffect(() => {
    if (screen !== 'session') return;
    tickRef.current = setInterval(() => {
      if (pausedRef.current) return;
      setElapsedSeconds(prev => {
        const next = prev + 1;
        if (next >= totalSeconds) {
          clearInterval(tickRef.current);
          setScreen('complete');
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [screen, totalSeconds]);

  // Ambient pond animation loop: fireflies movement & ripple decay
  useEffect(() => {
    ambientRef.current = setInterval(() => {
      setFireflies(prev =>
        prev.map(f => {
          const newAngle = f.angle + (Math.random() - 0.5) * 0.2;
          let nx = f.x + Math.cos(newAngle) * f.speed;
          let ny = f.y + Math.sin(newAngle) * f.speed;
          if (nx < 10) nx = width - 20;
          if (nx > width - 10) nx = 20;
          if (ny < height * 0.1) ny = height * 0.65;
          if (ny > height * 0.7) ny = height * 0.15;
          return { ...f, x: nx, y: ny, angle: newAngle };
        })
      );

      setRipples(prev =>
        prev
          .map(r => ({
            ...r,
            radius: r.radius + (r.speed || 1.4),
            opacity: r.opacity - (r.fadeRate || 0.012),
          }))
          .filter(r => r.opacity > 0)
      );
    }, AMBIENT_TICK_MS);

    return () => clearInterval(ambientRef.current);
  }, []);

  const triggerHaptic = (type = 'light') => {
    if (Platform.OS !== 'web') {
      try {
        if (type === 'heavy') Vibration.vibrate(15);
        else Vibration.vibrate(8);
      } catch (e) {}
    }
  };

  const addRipple = (x, y, color = COLORS.rippleTouch, initialRadius = 15, speed = 1.6, fadeRate = 0.015) => {
    setRipples(prev => [
      ...prev.slice(-12),
      { id: Math.random(), x, y, radius: initialRadius, opacity: 0.7, color, speed, fadeRate },
    ]);
  };

  const crossfadePhaseText = () => {
    Animated.sequence([
      Animated.timing(phaseTextOpacity, { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(phaseTextOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const startExhale = () => {
    setPhase('exhale');
    crossfadePhaseText();
    const { exhaleMs } = computeDurations();
    currentPhaseDurationRef.current = exhaleMs;

    addRipple(width / 2, height * 0.42, COLORS.rippleOut, 20, 2.0, 0.01);

    phaseProgress.setValue(0);
    Animated.timing(phaseProgress, {
      toValue: 1,
      duration: exhaleMs,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    Animated.timing(bloom, {
      toValue: 0,
      duration: exhaleMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      setBreathCount(c => c + 1);
      triggerHaptic('heavy');
      setPhase('idle');
      if (isPressedRef.current && !pausedRef.current) {
        startInhale();
      }
    });
  };

  const startInhale = () => {
    setPhase('inhale');
    crossfadePhaseText();
    const { inhaleMs } = computeDurations();
    currentPhaseDurationRef.current = inhaleMs;
    triggerHaptic('light');

    addRipple(width / 2, height * 0.42, COLORS.rippleIn, 25, 2.4, 0.012);

    phaseProgress.setValue(0);
    Animated.timing(phaseProgress, {
      toValue: 1,
      duration: inhaleMs,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    Animated.timing(bloom, {
      toValue: 1,
      duration: inhaleMs,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        startExhale();
      }
    });
  };

  const handlePressIn = (evt) => {
    isPressedRef.current = true;
    setIsHolding(true);

    if (evt && evt.nativeEvent) {
      addRipple(evt.nativeEvent.pageX, evt.nativeEvent.pageY, COLORS.petalOuter, 10, 2.2);
    }

    Animated.timing(touchGlow, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    if (pausedRef.current) return;
    if (phase === 'idle') {
      startInhale();
    }
  };

  const handlePressOut = () => {
    isPressedRef.current = false;
    setIsHolding(false);
    Animated.timing(touchGlow, { toValue: 0, duration: 400, useNativeDriver: true }).start();

    if (phase === 'inhale') {
      bloom.stopAnimation(() => startExhale());
    }
  };

  const handlePondTap = (evt) => {
    if (evt && evt.nativeEvent) {
      const { pageX, pageY } = evt.nativeEvent;
      addRipple(pageX, pageY, COLORS.rippleTouch, 12, 1.8, 0.02);
      triggerHaptic('light');
    }
  };

  const togglePause = () => {
    const goingToPause = !isPaused;
    if (goingToPause) {
      bloom.stopAnimation();
      phaseProgress.stopAnimation();
    } else if (phase !== 'idle') {
      if (phase === 'inhale') startInhale();
      else if (phase === 'exhale') startExhale();
    }
    pausedRef.current = goingToPause;
    setIsPaused(goingToPause);
  };

  const fadeTo = (next) => {
    Animated.timing(screenFade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setScreen(next);
      Animated.timing(screenFade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    });
  };

  const startSession = () => {
    setElapsedSeconds(0);
    setBreathCount(0);
    setPhase('idle');
    setIsPaused(false);
    pausedRef.current = false;
    isPressedRef.current = false;
    bloom.setValue(0);
    phaseProgress.setValue(0);
    fadeTo('session');
  };

  const endSessionEarly = () => {
    clearInterval(tickRef.current);
    fadeTo('complete');
  };

  const selectPattern = (id) => {
    setPatternId(id);
    setBpm(PATTERNS[id].defaultBpm);
  };

  // Interpolated values for lotus blooming
  const petalColorOuter = bloom.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['#3E8261', '#F472B6', '#EC4899'],
  });
  const petalColorInner = bloom.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['#2F664C', '#FB7185', '#F43F5E'],
  });
  const lotusScale = bloom.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.25],
  });
  const lotusGlowRadius = bloom.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 35],
  });

  const phaseInstruction =
    phase === 'inhale'
      ? '🫁 Breathing in… (Lotus Blooming)'
      : phase === 'exhale'
      ? '💨 Breathing out… (Lotus Settling)'
      : '✨ Touch & Hold the Lily to Breathe In';

  // Dynamic Theme Colors for LilyPond
  const pondBg = isDarkMode ? COLORS.waterDark : '#E6F4F0';
  const padBg = isDarkMode ? COLORS.padDark : '#A7F3D0';
  const padBorderColor = isDarkMode ? COLORS.padBorder : '#34D399';
  const hudBgColor = isDarkMode ? 'rgba(4, 29, 23, 0.92)' : 'rgba(255, 255, 255, 0.95)';
  const hudBorderColor = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(6, 78, 59, 0.15)';
  const mainTxtColor = isDarkMode ? COLORS.text : '#064E3B';
  const dimTxtColor = isDarkMode ? COLORS.textDim : '#047857';

  useEffect(() => {
    if (screen === 'setup') {
      setScreen('session');
    }
  }, [screen]);

  if (screen === 'setup') return null;

  // =========================================================================
  // SESSION SCREEN
  // =========================================================================
  const progressPercent = Math.min(100, Math.round((elapsedSeconds / totalSeconds) * 100));

  return (
    <View style={[styles.sessionContainer, { backgroundColor: pondBg }]}>
      {/* Interactive Water Pond Surface */}
      <TouchableWithoutFeedback onPress={handlePondTap}>
        <View style={styles.pondCanvas}>
          {/* Ambient Floating Fireflies */}
          {fireflies.map(f => (
            <View
              key={f.id}
              pointerEvents="none"
              style={[
                styles.firefly,
                {
                  left: f.x,
                  top: f.y,
                  width: f.size,
                  height: f.size,
                  borderRadius: f.size / 2,
                  opacity: f.opacity,
                },
              ]}
            />
          ))}

          {/* Dynamic Water Ripples */}
          {ripples.map(r => (
            <View
              key={r.id}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: (r.x || width / 2) - r.radius,
                top: (r.y || height * 0.4) - r.radius,
                width: r.radius * 2,
                height: r.radius * 2,
                borderRadius: r.radius,
                borderWidth: 1.5,
                borderColor: r.color,
                opacity: r.opacity,
              }}
            />
          ))}

          {/* Floating Organic Lily Pad */}
          <View style={styles.lilyPad}>
            <View style={styles.lilyPadNotch} />
            <View style={styles.lilyPadVein1} />
            <View style={styles.lilyPadVein2} />
          </View>

          {/* Idle Pulse Guidance Ring around Lotus */}
          {phase === 'idle' && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pulseGuideRing,
                {
                  transform: [{ scale: pulseRingScale }],
                },
              ]}
            />
          )}

          {/* Interactive Touch Target & Glowing Lotus Centerpiece */}
          <TouchableWithoutFeedback onPressIn={handlePressIn} onPressOut={handlePressOut}>
            <Animated.View
              style={[
                styles.lotusContainer,
                {
                  transform: [{ scale: lotusScale }],
                  shadowRadius: lotusGlowRadius,
                },
              ]}
            >
              {/* Touch Aura Glow */}
              <Animated.View
                style={[
                  styles.lotusGlowAura,
                  {
                    opacity: touchGlow,
                    backgroundColor: COLORS.petalOuter,
                  },
                ]}
              />

              {/* Outer Blooming Petals (6 Petals) */}
              {Array.from({ length: PETAL_COUNT_OUTER }).map((_, i) => {
                const angle = (360 / PETAL_COUNT_OUTER) * i;
                return (
                  <Animated.View
                    key={`outer-${i}`}
                    style={[
                      styles.petalOuter,
                      {
                        backgroundColor: petalColorOuter,
                        transform: [
                          { rotate: `${angle}deg` },
                          {
                            translateY: bloom.interpolate({
                              inputRange: [0, 1],
                              outputRange: [-12, -42],
                            }),
                          },
                          {
                            scale: bloom.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.6, 1.2],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                );
              })}

              {/* Inner Blooming Petals (6 Petals offset) */}
              {Array.from({ length: PETAL_COUNT_INNER }).map((_, i) => {
                const angle = (360 / PETAL_COUNT_INNER) * i + 30;
                return (
                  <Animated.View
                    key={`inner-${i}`}
                    style={[
                      styles.petalInner,
                      {
                        backgroundColor: petalColorInner,
                        transform: [
                          { rotate: `${angle}deg` },
                          {
                            translateY: bloom.interpolate({
                              inputRange: [0, 1],
                              outputRange: [-8, -30],
                            }),
                          },
                          {
                            scale: bloom.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.5, 1.0],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                );
              })}

              {/* Glowing Golden Lotus Center Core */}
              <View style={styles.lotusCore}>
                <View style={styles.lotusCoreInner} />
                {/* Glowing Stamens */}
                {[0, 60, 120, 180, 240, 300].map(deg => (
                  <View
                    key={deg}
                    style={[
                      styles.stamenDot,
                      {
                        transform: [
                          { rotate: `${deg}deg` },
                          { translateY: -10 },
                        ],
                      },
                    ]}
                  />
                ))}
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>

      {/* Real-time Interactive Breathing Control Banner */}
      <View style={[styles.hudContainer, { backgroundColor: isDarkMode ? 'rgba(4, 29, 23, 0.88)' : (theme.bgSecondary || '#FFFFFF'), borderColor: theme.border }]}>
        {/* Phase Instruction Card */}
        <Animated.View style={[styles.instructionCard, { opacity: phaseTextOpacity }]}>
          <Text style={[styles.instructionText, { color: isDarkMode ? COLORS.text : (theme.textPrimary || '#0F172A') }]}>{phaseInstruction}</Text>
        </Animated.View>

        {/* Phase Rhythm Progress Bar */}
        <View style={styles.phaseBarTrack}>
          <Animated.View
            style={[
              styles.phaseBarFill,
              {
                width: phaseProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
                backgroundColor: phase === 'inhale' ? COLORS.accentLight : COLORS.rippleOut,
              },
            ]}
          />
        </View>

        {/* Breath Count & Realtime Stats */}
        <View style={styles.statsBadgeRow}>
          <View style={[styles.badgePill, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.06)' : (theme.bgPrimary || '#F8FAFC'), borderColor: theme.border }]}>
            <Ionicons name="sparkles" size={14} color={COLORS.accentLight} style={{ marginRight: 5 }} />
            <Text style={[styles.badgePillTxt, { color: isDarkMode ? COLORS.text : (theme.textPrimary || '#0F172A') }]}>{breathCount} Breaths Completed</Text>
          </View>
          <View style={[styles.badgePill, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.06)' : (theme.bgPrimary || '#F8FAFC'), borderColor: theme.border }]}>
            <Ionicons name="speedometer-outline" size={14} color={isDarkMode ? COLORS.textDim : theme.textSecondary} style={{ marginRight: 5 }} />
            <Text style={[styles.badgePillTxt, { color: isDarkMode ? COLORS.text : (theme.textPrimary || '#0F172A') }]}>{bpm} BPM</Text>
          </View>
        </View>

        {/* Interactive BPM Pace Stepper */}
        <View style={[styles.stepperContainer, { backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.25)' : (theme.bgPrimary || '#F8FAFC'), borderColor: theme.border }]}>
          <TouchableOpacity
            onPress={() => {
              setBpm(b => Math.max(4.5, Math.round((b - 0.5) * 10) / 10));
              triggerHaptic('light');
            }}
            style={styles.stepperBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="remove" size={18} color={isDarkMode ? COLORS.text : theme.textPrimary} />
          </TouchableOpacity>

          <Text style={[styles.stepperReadout, { color: isDarkMode ? COLORS.textDim : (theme.textSecondary || '#334155') }]}>{bpm.toFixed(1)} bpm pace</Text>

          <TouchableOpacity
            onPress={() => {
              setBpm(b => Math.min(7.0, Math.round((b + 0.5) * 10) / 10));
              triggerHaptic('light');
            }}
            style={styles.stepperBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={18} color={isDarkMode ? COLORS.text : theme.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Bottom Quick Controls */}
        <View style={styles.quickActionRow}>
          <TouchableOpacity onPress={togglePause} style={[styles.actionBtn, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : (theme.bgPrimary || '#F8FAFC') }]} activeOpacity={0.8}>
            <Ionicons name={isPaused ? 'play-circle-outline' : 'pause-circle-outline'} size={20} color={isDarkMode ? COLORS.text : theme.textPrimary} />
            <Text style={[styles.actionBtnTxt, { color: isDarkMode ? COLORS.text : (theme.textPrimary || '#0F172A') }]}>{isPaused ? 'Resume' : 'Pause'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={endSessionEarly} style={styles.actionBtn} activeOpacity={0.8}>
            <Ionicons name="stop-circle-outline" size={20} color="#F87171" />
            <Text style={[styles.actionBtnTxt, { color: '#F87171' }]}>End Session</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export const LilyPondGame = LilyBreathingGame;
export default LilyBreathingGame;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  setupWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    width: '100%',
    maxWidth: 480,
    paddingVertical: 20,
  },
  setupTitle: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  setupSubtitle: {
    color: COLORS.textDim,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20,
  },
  sectionLabel: {
    color: COLORS.accentLight,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    textAlign: 'center',
  },
  patternCard: {
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  patternCardActive: {
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  patternCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  patternName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  patternBlurb: {
    color: COLORS.textDim,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  patternCitation: {
    color: 'rgba(231, 251, 241, 0.35)',
    fontSize: 10,
    fontStyle: 'italic',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  chipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  chipText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#041D17',
    fontWeight: '800',
  },
  startButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
    elevation: 4,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  startButtonText: {
    color: '#041D17',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  // SESSION STYLES
  sessionContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: COLORS.waterDark,
  },
  pondCanvas: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  firefly: {
    position: 'absolute',
    backgroundColor: '#6EE7B7',
    shadowColor: '#6EE7B7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  lilyPad: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: COLORS.padDark,
    borderWidth: 2,
    borderColor: COLORS.padBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  lilyPadNotch: {
    position: 'absolute',
    top: 0,
    right: 90,
    width: 0,
    height: 0,
    borderLeftWidth: 20,
    borderRightWidth: 20,
    borderTopWidth: 100,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.waterDark,
  },
  lilyPadVein1: {
    position: 'absolute',
    top: 110,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: 'rgba(31, 107, 76, 0.4)',
  },
  lilyPadVein2: {
    position: 'absolute',
    left: 110,
    top: 20,
    bottom: 20,
    width: 1,
    backgroundColor: 'rgba(31, 107, 76, 0.4)',
  },

  pulseGuideRing: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: 'rgba(244, 114, 182, 0.4)',
    borderStyle: 'dashed',
  },
  lotusContainer: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: COLORS.petalOuter,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
  },
  lotusGlowAura: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  petalOuter: {
    position: 'absolute',
    width: 24,
    height: 60,
    borderRadius: 12,
    shadowColor: COLORS.petalOuter,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  petalInner: {
    position: 'absolute',
    width: 18,
    height: 48,
    borderRadius: 9,
  },
  lotusCore: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.stamen,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.centerCore,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    zIndex: 10,
  },
  lotusCoreInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.centerCore,
  },
  stamenDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.centerCore,
  },

  // HUD OVERLAY STYLES
  hudContainer: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    alignItems: 'center',
    width: '100%',
    maxWidth: 480,
    backgroundColor: 'rgba(4, 29, 23, 0.88)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  instructionCard: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 6,
  },
  instructionText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  phaseBarTrack: {
    width: '90%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  phaseBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  statsBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  badgePillTxt: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700',
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingVertical: 4,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 8,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperReadout: {
    color: COLORS.textDim,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 90,
    textAlign: 'center',
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  actionBtnTxt: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
});