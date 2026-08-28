import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Dimensions
} from 'react-native';
import Svg, { Circle, G, Path, Defs, RadialGradient, Stop } from 'react-native-svg';
import Icon from './Icon';
import { COLORS } from '../physiological/config/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * InteractiveBreathingGuide
 * High-impact, immersive guided breathwork and calibration visualizer.
 * Inspired directly by the "Breathe In..." Mindful UI in reference image 3.
 */
export default function InteractiveBreathingGuide({
  compact = false,
  onComplete = null,
  initialDurationSeconds = 120,
  onCalibratePress = null,
}) {
  const [isActive, setIsActive] = useState(false);
  const [phase, setPhase] = useState('Ready to begin');
  const [phaseSub, setPhaseSub] = useState('4-4-4-2 Autonomic Pacing');
  const [secondsRemaining, setSecondsRemaining] = useState(initialDurationSeconds);

  // Animation drivers
  const scaleAnim = useRef(new Animated.Value(1.0)).current;
  const outerRippleAnim = useRef(new Animated.Value(1.0)).current;
  const opacityAnim = useRef(new Animated.Value(0.4)).current;
  const ringRotateAnim = useRef(new Animated.Value(0)).current;

  // Timing constants (4s Inhale, 4s Hold, 4s Exhale, 2s Rest)
  const INHALE_MS = 4000;
  const HOLD_MS = 4000;
  const EXHALE_MS = 4000;
  const REST_MS = 2000;

  useEffect(() => {
    let timer;
    if (isActive && secondsRemaining > 0) {
      timer = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            setIsActive(false);
            if (onComplete) onComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isActive, secondsRemaining, onComplete]);

  // Breathing cycle orchestration
  useEffect(() => {
    let isCancelled = false;

    const runCycle = () => {
      if (!isActive || isCancelled) return;

      // Phase 1: Inhale
      setPhase('Breathe In…');
      setPhaseSub('Fill your lungs smoothly');
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1.45,
          duration: INHALE_MS,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(outerRippleAnim, {
          toValue: 1.6,
          duration: INHALE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.9,
          duration: INHALE_MS,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (isCancelled || !isActive) return;

        // Phase 2: Hold
        setPhase('Hold…');
        setPhaseSub('Retain air effortlessly');
        setTimeout(() => {
          if (isCancelled || !isActive) return;

          // Phase 3: Exhale
          setPhase('Breathe Out…');
          setPhaseSub('Release all tension slowly');
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1.0,
              duration: EXHALE_MS,
              easing: Easing.bezier(0.4, 0, 0.2, 1),
              useNativeDriver: true,
            }),
            Animated.timing(outerRippleAnim, {
              toValue: 1.05,
              duration: EXHALE_MS,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0.35,
              duration: EXHALE_MS,
              useNativeDriver: true,
            }),
          ]).start(() => {
            if (isCancelled || !isActive) return;

            // Phase 4: Rest
            setPhase('Rest & Settle…');
            setPhaseSub('Prepare for next cycle');
            setTimeout(() => {
              if (!isCancelled && isActive) {
                runCycle();
              }
            }, REST_MS);
          });
        }, HOLD_MS);
      });
    };

    if (isActive) {
      runCycle();
    } else {
      setPhase('Ready to begin');
      setPhaseSub('4-4-4-2 Autonomic Pacing');
      Animated.timing(scaleAnim, {
        toValue: 1.0,
        duration: 600,
        useNativeDriver: true,
      }).start();
      Animated.timing(outerRippleAnim, {
        toValue: 1.0,
        duration: 600,
        useNativeDriver: true,
      }).start();
      Animated.timing(opacityAnim, {
        toValue: 0.35,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      isCancelled = true;
    };
  }, [isActive, scaleAnim, outerRippleAnim, opacityAnim]);

  const toggleActive = () => {
    if (!isActive && secondsRemaining === 0) {
      setSecondsRemaining(initialDurationSeconds);
    }
    setIsActive(!isActive);
  };

  const reset = () => {
    setIsActive(false);
    setSecondsRemaining(initialDurationSeconds);
    setPhase('Ready to begin');
    setPhaseSub('4-4-4-2 Autonomic Pacing');
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const discSize = compact ? 130 : 170;

  return (
    <View style={[styles.cardContainer, compact && styles.cardCompact]}>
      {/* Top Header Row with Sound/Pacing Chip */}
      <View style={styles.headerRow}>
        <View style={styles.modeTag}>
          <Icon name="weather-windy" size={13} color={COLORS.normalDark} />
          <Text style={styles.modeTagText}>Autonomic Bio-Calibration</Text>
        </View>
        <View style={styles.soundChip}>
          <Icon name="music" size={12} color={COLORS.light.textSub} />
          <Text style={styles.soundChipText}>432 Hz Calm Wave</Text>
        </View>
      </View>

      {/* Main Concentric Animated Ripple Area */}
      <View style={[styles.visualArea, { height: discSize + 70 }]}>
        {/* Outermost Concentric Halo Ripple */}
        <Animated.View
          style={[
            styles.outerHalo,
            {
              width: discSize + 64,
              height: discSize + 64,
              borderRadius: (discSize + 64) / 2,
              transform: [{ scale: outerRippleAnim }],
              opacity: opacityAnim,
            },
          ]}
        />

        {/* Middle Soft Sage Ring */}
        <Animated.View
          style={[
            styles.middleRing,
            {
              width: discSize + 30,
              height: discSize + 30,
              borderRadius: (discSize + 30) / 2,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        />

        {/* Core Solid Breathing Disc */}
        <View
          style={[
            styles.coreDisc,
            {
              width: discSize,
              height: discSize,
              borderRadius: discSize / 2,
            },
          ]}
        >
          <Text style={styles.phaseTitle}>{phase}</Text>
          <Text style={styles.phaseSubtitle}>{phaseSub}</Text>
          {isActive && (
            <View style={styles.timeBadge}>
              <Text style={styles.timerText}>{formatTime(secondsRemaining)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Progress & Pacing Stepper Dots */}
      <View style={styles.stepperRow}>
        <View style={[styles.stepDot, phase.includes('In') && styles.stepDotActive]} />
        <View style={[styles.stepDot, phase.includes('Hold') && styles.stepDotActive]} />
        <View style={[styles.stepDot, phase.includes('Out') && styles.stepDotActive]} />
        <View style={[styles.stepDot, phase.includes('Rest') && styles.stepDotActive]} />
      </View>

      {/* Interactive Controls Row */}
      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[styles.primaryButton, isActive && styles.primaryButtonActive]}
          onPress={toggleActive}
          activeOpacity={0.88}
        >
          <Icon
            name={isActive ? 'pause' : 'play'}
            size={18}
            color="#FFFFFF"
          />
          <Text style={styles.buttonText}>
            {isActive ? 'Pause Rhythm' : 'Start Calming Breath'}
          </Text>
        </TouchableOpacity>

        {isActive && (
          <TouchableOpacity
            style={styles.resetButton}
            onPress={reset}
            activeOpacity={0.75}
          >
            <Icon name="refresh" size={18} color={COLORS.light.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Direct Calibration Shortcut if provided */}
      {onCalibratePress && (
        <TouchableOpacity
          style={styles.calibShortcut}
          onPress={onCalibratePress}
          activeOpacity={0.8}
        >
          <Text style={styles.calibShortcutText}>
            Sync with Sensor Baseline Calibration →
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.light.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  cardCompact: {
    padding: 14,
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.normalSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.normal + '30',
  },
  modeTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.normalDark,
  },
  soundChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.light.pillBg,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  soundChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.light.textSub,
  },
  visualArea: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginVertical: 6,
  },
  outerHalo: {
    position: 'absolute',
    backgroundColor: '#E5F4E7',
    borderWidth: 1.5,
    borderColor: '#9ECB9F80',
  },
  middleRing: {
    position: 'absolute',
    backgroundColor: '#D1EBD4',
    borderWidth: 1.5,
    borderColor: '#7EBA83',
  },
  coreDisc: {
    backgroundColor: COLORS.normal,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.normalDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
    paddingHorizontal: 16,
  },
  phaseTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  phaseSubtitle: {
    color: '#FFFFFFE0',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  timeBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 8,
  },
  timerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 12,
  },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.light.pillBg,
  },
  stepDotActive: {
    backgroundColor: COLORS.normal,
    width: 18,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.normal,
    paddingVertical: 13,
    paddingHorizontal: 26,
    borderRadius: 26,
    shadowColor: COLORS.normalDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryButtonActive: {
    backgroundColor: COLORS.brand,
    shadowColor: COLORS.brandDark,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  resetButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.light.pillBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calibShortcut: {
    marginTop: 12,
    paddingVertical: 4,
  },
  calibShortcutText: {
    color: COLORS.brand,
    fontSize: 11,
    fontWeight: '700',
  },
});
