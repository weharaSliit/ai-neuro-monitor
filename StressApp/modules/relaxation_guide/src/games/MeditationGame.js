import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  Easing,
  ScrollView,
  Platform,
  Vibration,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeContext } from '../context/ThemeContext';

const { width } = Dimensions.get('window');

/**
 * 🧘 MeditationGame — Minimalist Serene Relaxation Engine
 * Simplified, unified color palette: Calm Deep Teal & Soft Slate
 */
export const MeditationGame = ({ initialMode, mode, initialDurationMin, onStartSession }) => {
  const themeContext = React.useContext(ThemeContext);
  const theme = themeContext?.theme || {};
  const isDarkMode = themeContext?.isDarkMode ?? true;

  const activeModeKey = mode || initialMode || 'diaphragmatic_pace';
  const [activeMode, setActiveMode] = useState(activeModeKey);

  useEffect(() => {
    if (mode || initialMode) {
      setActiveMode(mode || initialMode);
    }
  }, [mode, initialMode]);

  // Session State
  const [isPaused, setIsPaused] = useState(false);
  const [cyclesCompleted, setCyclesCompleted] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(4);
  const [phaseTitle, setPhaseTitle] = useState('INHALE');
  const [phaseInstruction, setPhaseInstruction] = useState('Inhale deeply into lower lungs through nose');
  const [scientificTip, setScientificTip] = useState('Extended exhalation stimulates the Vagus nerve, lowering heart rate.');
  const [activeBodyRegion, setActiveBodyRegion] = useState(0);
  const [vagalBoost, setVagalBoost] = useState(15);

  // Animated values
  const boxLaserProgress = useRef(new Animated.Value(0)).current;
  const bellyCylinderHeight = useRef(new Animated.Value(0.3)).current;
  const zenBowlStrike = useRef(new Animated.Value(1)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;

  // Box Breathing 4-4-4-4 Tactical Respiration Pattern
  useEffect(() => {
    if (activeMode !== 'box_meditation' || isPaused) return;

    let step = 0;
    const runBoxCycle = () => {
      const edge = step % 4;
      if (edge === 0) {
        setPhaseTitle('1. INHALE (4s)');
        setPhaseInstruction('Inhale deeply into lower lungs through nose');
        setScientificTip('Inhaling expands lung volume, preparing for vagal equilibrium.');
        setSecondsLeft(4);
      } else if (edge === 1) {
        setPhaseTitle('2. HOLD TOP (4s)');
        setPhaseInstruction('Hold breath calmly with relaxed shoulders');
        setScientificTip('Holding breath balances O2 and CO2 levels in blood plasma.');
        setSecondsLeft(4);
      } else if (edge === 2) {
        setPhaseTitle('3. EXHALE (4s)');
        setPhaseInstruction('Release breath smoothly through mouth');
        setScientificTip('Exhaling stimulates the Vagus nerve, slowing heart rate.');
        setSecondsLeft(4);
      } else {
        setPhaseTitle('4. REST HOLD (4s)');
        setPhaseInstruction('Pause empty before next breath cycle');
        setScientificTip('Resting empty resets sympathetic cardiac drive to baseline.');
        setSecondsLeft(4);
      }

      boxLaserProgress.setValue(edge * 0.25);
      Animated.timing(boxLaserProgress, {
        toValue: (edge + 1) * 0.25,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();

      step++;
      if (step % 4 === 0) {
        setCyclesCompleted(c => c + 1);
        setVagalBoost(v => Math.min(95, v + 8));
      }
    };

    runBoxCycle();
    const interval = setInterval(runBoxCycle, 4000);
    return () => clearInterval(interval);
  }, [activeMode, isPaused]);

  // Deep Belly Pacing 4s Inhale / 6s Exhale Pattern
  useEffect(() => {
    if (activeMode !== 'diaphragmatic_pace' || isPaused) return;

    let isInhale = true;
    const runBellyCycle = () => {
      if (isInhale) {
        setPhaseTitle('BELLY INHALE (4s)');
        setPhaseInstruction('Expand lower abdomen outward slowly through nose');
        setScientificTip('Diaphragmatic expansion engages phrenic nerve abdominal receptors.');
        setSecondsLeft(4);
        Animated.timing(bellyCylinderHeight, {
          toValue: 0.95,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }).start();
      } else {
        setPhaseTitle('EXTENDED EXHALE (6s)');
        setPhaseInstruction('Soften stomach inward toward spine slowly through mouth');
        setScientificTip('6-second extended exhalation produces maximum HRV vagal recovery.');
        setSecondsLeft(6);
        Animated.timing(bellyCylinderHeight, {
          toValue: 0.25,
          duration: 6000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }).start();
        setCyclesCompleted(c => c + 1);
        setVagalBoost(v => Math.min(95, v + 10));
      }
      isInhale = !isInhale;
    };

    runBellyCycle();
    const interval = setInterval(runBellyCycle, isInhale ? 6000 : 4000);
    return () => clearInterval(interval);
  }, [activeMode, isPaused]);

  // Mindful Body Scan Somatic Tension Sweep
  useEffect(() => {
    if (activeMode !== 'body_scan_mindful' || isPaused) return;

    const regions = [
      { name: 'CROWN & FOREHEAD', instruction: 'Unclamp jaw & smooth forehead tension', tip: 'Releasing jaw muscles drops trigeminal nerve tension signal.' },
      { name: 'SHOULDERS & NECK', instruction: 'Drop shoulder blades downward away from ears', tip: 'Trapezius relaxation reduces cervical sympathetic trunk tightness.' },
      { name: 'CHEST & HEART', instruction: 'Breathe warm light directly into heart center', tip: 'Heart center focus increases cardiac vagal tone.' },
      { name: 'ABDOMEN & CORE', instruction: 'Release deep stomach muscle tightness', tip: 'Somatic core relaxation decreases abdominal cortisol pooling.' },
      { name: 'FEET & ANKLES', instruction: 'Feel heavy grounding connection into floor', tip: 'Peripheral limb awareness diverts blood flow away from anxious brain centers.' },
    ];

    let rIdx = 0;
    const runBodyCycle = () => {
      const reg = regions[rIdx % regions.length];
      setActiveBodyRegion(rIdx % regions.length);
      setPhaseTitle(reg.name);
      setPhaseInstruction(reg.instruction);
      setScientificTip(reg.tip);
      setSecondsLeft(6);
      rIdx++;
      if (rIdx % regions.length === 0) {
        setCyclesCompleted(c => c + 1);
        setVagalBoost(v => Math.min(95, v + 7));
      }
    };

    runBodyCycle();
    const interval = setInterval(runBodyCycle, 6000);
    return () => clearInterval(interval);
  }, [activeMode, isPaused]);

  // Silent Zen Open Monitoring Chime Pattern
  useEffect(() => {
    if (activeMode !== 'silent_zen_timer' || isPaused) return;

    setPhaseTitle('SILENT OPEN MONITORING');
    setPhaseInstruction('Unguided silent awareness • Rest in natural presence');
    setScientificTip('Open Monitoring meditation quiets Default Mode Network (DMN) rumination loops.');
    setSecondsLeft(8);

    const interval = setInterval(() => {
      setCyclesCompleted(c => c + 1);
      setVagalBoost(v => Math.min(95, v + 6));
    }, 8000);
    return () => clearInterval(interval);
  }, [activeMode, isPaused]);

  const handleStrikeBowl = () => {
    if (Platform.OS !== 'web') Vibration.vibrate(20);
    zenBowlStrike.setValue(1);
    Animated.sequence([
      Animated.timing(zenBowlStrike, { toValue: 1.35, duration: 200, useNativeDriver: true }),
      Animated.timing(zenBowlStrike, { toValue: 1.0, duration: 600, useNativeDriver: true }),
    ]).start();

    rippleAnim.setValue(0);
    Animated.timing(rippleAnim, {
      toValue: 1,
      duration: 1200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  // Serene Minimalist Palette (Teal & Slate)
  const getThemeDetails = () => {
    switch (activeMode) {
      case 'box_meditation':
        return { title: 'Box Breathing', badge: 'WESAD Score: 0.86 · 4-4-4-4 Square', icon: '🧊' };
      case 'diaphragmatic_pace':
        return { title: 'Deep Belly Pacing', badge: 'WESAD Score: 0.88 · 4s/6s Ratio', icon: '🫁' };
      case 'body_scan_mindful':
        return { title: 'Mindful Body Scan', badge: 'WESAD Score: 0.74 · Somatic Sweep', icon: '🧘‍♂️' };
      case 'silent_zen_timer':
      default:
        return { title: 'Silent Zen Presence', badge: 'WESAD Score: 0.55 · Zen Presence', icon: '⛩️' };
    }
  };

  const techInfo = getThemeDetails();
  const primaryTeal = '#0D9488';
  const textColor = isDarkMode ? '#FFFFFF' : '#0F172A';
  const subTextColor = isDarkMode ? 'rgba(255,255,255,0.7)' : '#475569';
  const bgGradient = isDarkMode ? ['#061D1A', '#0B2925'] : ['#F8FAFC', '#F0FDFA'];
  const cardBg = isDarkMode ? 'rgba(13, 148, 136, 0.15)' : '#FFFFFF';
  const borderColor = isDarkMode ? 'rgba(13, 148, 136, 0.35)' : '#CBD5E1';

  const bodyRegions = [
    { name: 'Head & Jaw', icon: '🧠' },
    { name: 'Shoulders & Neck', icon: '💆‍♂️' },
    { name: 'Chest & Heart', icon: '🫁' },
    { name: 'Abdomen & Core', icon: '✨' },
    { name: 'Feet & Grounding', icon: '👣' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false} bounces={false}>
      <LinearGradient colors={bgGradient} style={styles.gradientWrapper}>
        {/* Top Header Card */}
        <View style={[styles.headerCard, { backgroundColor: cardBg, borderColor }]}>
          <View style={[styles.headerIconRing, { backgroundColor: 'rgba(13, 148, 136, 0.2)' }]}>
            <Text style={styles.headerIcon}>{techInfo.icon}</Text>
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: textColor }]}>{techInfo.title}</Text>
            <Text style={[styles.headerBadge, { color: primaryTeal }]}>{techInfo.badge}</Text>
          </View>
          <View style={[styles.cycleBadge, { backgroundColor: primaryTeal }]}>
            <Text style={styles.cycleBadgeTxt}>{cyclesCompleted} Cycles</Text>
          </View>
        </View>

        {/* Live Vagal Activation Recovery Bar */}
        <View style={[styles.vagalMeterCard, { backgroundColor: cardBg, borderColor }]}>
          <View style={styles.vagalMeterHeader}>
            <Text style={[styles.vagalMeterTitle, { color: primaryTeal }]}>🌿 PHYSIOLOGICAL RECOVERY</Text>
            <Text style={[styles.vagalMeterVal, { color: primaryTeal }]}>+{vagalBoost}% Vagal Tone</Text>
          </View>
          <View style={styles.vagalTrack}>
            <View style={[styles.vagalFill, { width: `${vagalBoost}%`, backgroundColor: primaryTeal }]} />
          </View>
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            PATTERN 1: BOX BREATHING 4-4-4-4 TACTICAL SQUARE
           ═══════════════════════════════════════════════════════════════════ */}
        {activeMode === 'box_meditation' && (
          <View style={styles.canvasContainer}>
            <View style={[styles.laserSquareFrame, { borderColor: isDarkMode ? '#0D9488' : '#94A3B8' }]}>
              <View style={[styles.laserCornerNode, styles.cTL, phaseTitle.includes('1.') && styles.nodeActive]}>
                <Text style={styles.cNodeTxt}>Inhale 4s</Text>
              </View>
              <View style={[styles.laserCornerNode, styles.cTR, phaseTitle.includes('2.') && styles.nodeActive]}>
                <Text style={styles.cNodeTxt}>Hold 4s</Text>
              </View>
              <View style={[styles.laserCornerNode, styles.cBR, phaseTitle.includes('3.') && styles.nodeActive]}>
                <Text style={styles.cNodeTxt}>Exhale 4s</Text>
              </View>
              <View style={[styles.laserCornerNode, styles.cBL, phaseTitle.includes('4.') && styles.nodeActive]}>
                <Text style={styles.cNodeTxt}>Rest 4s</Text>
              </View>

              <View style={styles.laserCenterContent}>
                <Text style={styles.centerEmoji}>🧊</Text>
                <Text style={[styles.centerTimer, { color: textColor }]}>{secondsLeft}s</Text>
                <Text style={[styles.centerPhaseTag, { color: primaryTeal }]}>{phaseTitle}</Text>
              </View>
            </View>

            <View style={styles.edgeStatusRow}>
              <View style={[styles.edgePill, phaseTitle.includes('1.') && styles.edgePillActive]}>
                <Text style={styles.edgePillTxt}>Inhale</Text>
              </View>
              <View style={[styles.edgePill, phaseTitle.includes('2.') && styles.edgePillActive]}>
                <Text style={styles.edgePillTxt}>Hold</Text>
              </View>
              <View style={[styles.edgePill, phaseTitle.includes('3.') && styles.edgePillActive]}>
                <Text style={styles.edgePillTxt}>Exhale</Text>
              </View>
              <View style={[styles.edgePill, phaseTitle.includes('4.') && styles.edgePillActive]}>
                <Text style={styles.edgePillTxt}>Rest</Text>
              </View>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PATTERN 2: DEEP BELLY PACING 4s INHALE / 6s EXTENDED EXHALE
           ═══════════════════════════════════════════════════════════════════ */}
        {activeMode === 'diaphragmatic_pace' && (
          <View style={styles.canvasContainer}>
            <View style={styles.diaphragmGaugeRow}>
              <View style={styles.ribcageTicks}>
                <Text style={[styles.tickTxt, { color: subTextColor }]}>— 100% Full</Text>
                <Text style={[styles.tickTxt, { color: subTextColor }]}>— Mid Lungs</Text>
                <Text style={[styles.tickTxt, { color: subTextColor }]}>— Diaphragm</Text>
              </View>

              <View style={[styles.cylinderFrame, { borderColor: primaryTeal, backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.1)' : '#F0FDFA' }]}>
                <Animated.View
                  style={[
                    styles.cylinderLiquidFill,
                    {
                      backgroundColor: primaryTeal,
                      height: bellyCylinderHeight.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    }
                  ]}
                />
                <View style={styles.cylinderOverlayContent}>
                  <Text style={styles.centerEmoji}>🫁</Text>
                  <Text style={[styles.centerTimer, { color: textColor }]}>{secondsLeft}s</Text>
                  <Text style={[styles.centerPhaseTag, { color: '#FFFFFF' }]}>{phaseTitle}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PATTERN 3: MINDFUL BODY SCAN SOMATIC SWEEP
           ═══════════════════════════════════════════════════════════════════ */}
        {activeMode === 'body_scan_mindful' && (
          <View style={styles.canvasContainer}>
            <View style={styles.anatomicalMapCard}>
              <View style={styles.anatomicalSilhouette}>
                {bodyRegions.map((reg, idx) => (
                  <TouchableOpacity
                    key={idx}
                    activeOpacity={0.8}
                    style={[
                      styles.somaticZonePill,
                      { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#FFFFFF', borderColor },
                      activeBodyRegion === idx && {
                        backgroundColor: primaryTeal,
                        borderColor: primaryTeal,
                      }
                    ]}
                    onPress={() => setActiveBodyRegion(idx)}
                  >
                    <Text style={styles.somaticZoneIcon}>{reg.icon}</Text>
                    <Text style={[styles.somaticZoneName, { color: isDarkMode ? '#FFFFFF' : '#0F172A' }, activeBodyRegion === idx && styles.zoneTxtActive]}>
                      {reg.name}
                    </Text>
                    {activeBodyRegion === idx && <Text style={styles.activeDot}>🟢 Active Zone</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PATTERN 4: SILENT ZEN TIBETAN SINGING BOWL INSTRUMENT
           ═══════════════════════════════════════════════════════════════════ */}
        {activeMode === 'silent_zen_timer' && (
          <View style={styles.canvasContainer}>
            <TouchableOpacity activeOpacity={0.85} style={styles.zenInstrumentArea} onPress={handleStrikeBowl}>
              <Animated.View
                style={[
                  styles.singingBowlContainer,
                  {
                    borderColor: primaryTeal,
                    backgroundColor: isDarkMode ? 'rgba(13, 148, 136, 0.15)' : '#CCFBF1',
                    transform: [{ scale: zenBowlStrike }],
                  }
                ]}
              >
                <Animated.View
                  style={[
                    styles.bowlAcousticRipple,
                    {
                      borderColor: '#2DD4BF',
                      opacity: rippleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
                      transform: [{ scale: rippleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.3] }) }],
                    }
                  ]}
                />
                <Text style={styles.bowlEmojiIcon}>🥣</Text>
                <Text style={[styles.bowlTitleTxt, { color: textColor }]}>TIBETAN SINGING BOWL</Text>
                <Text style={[styles.bowlActionTag, { color: primaryTeal }]}>🔔 TAP TO STRIKE BOWL</Text>
              </Animated.View>
            </TouchableOpacity>
          </View>
        )}

        {/* Guidance Display Card */}
        <View style={[styles.guidanceCard, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[styles.guidanceTitle, { color: primaryTeal }]}>{phaseTitle}</Text>
          <Text style={[styles.guidanceInstruction, { color: textColor }]}>{phaseInstruction}</Text>
          <Text style={[styles.scientificTipTxt, { color: subTextColor }]}>💡 {scientificTip}</Text>
        </View>

        {/* Session Controls */}
        <TouchableOpacity
          style={[styles.sessionControlBtn, { backgroundColor: primaryTeal }]}
          onPress={() => setIsPaused(p => !p)}
          activeOpacity={0.85}
        >
          <Text style={styles.sessionControlBtnTxt}>{isPaused ? '▶  Resume Session' : '⏸  Pause Session'}</Text>
        </TouchableOpacity>
      </LinearGradient>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: { flexGrow: 1 },
  gradientWrapper: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 520,
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: width * 0.9,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    marginBottom: 6,
    gap: 12,
  },
  headerIconRing: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { fontSize: 24 },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  headerBadge: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  cycleBadge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  cycleBadgeTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },

  vagalMeterCard: {
    width: width * 0.9,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  vagalMeterHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  vagalMeterTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  vagalMeterVal: { fontSize: 11, fontWeight: '800' },
  vagalTrack: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  vagalFill: { height: '100%', borderRadius: 3 },

  canvasContainer: {
    width: width * 0.9,
    height: Math.min(width * 0.68, 250),
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },

  // Box Breathing Laser Frame
  laserSquareFrame: {
    width: 180,
    height: 180,
    borderRadius: 22,
    borderWidth: 2.5,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laserCornerNode: {
    position: 'absolute',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
  },
  cTL: { top: -10, left: -10 },
  cTR: { top: -10, right: -10 },
  cBR: { bottom: -10, right: -10 },
  cBL: { bottom: -10, left: -10 },
  cNodeTxt: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  nodeActive: { backgroundColor: '#0D9488' },
  laserCenterContent: { alignItems: 'center', justifyContent: 'center' },
  edgeStatusRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  edgePill: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.06)' },
  edgePillActive: { backgroundColor: '#0D9488' },
  edgePillTxt: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },

  // Deep Belly Cylinder
  diaphragmGaugeRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  ribcageTicks: { gap: 14 },
  tickTxt: { fontSize: 10, fontWeight: '700' },
  cylinderFrame: {
    width: 120,
    height: 190,
    borderRadius: 24,
    borderWidth: 2.5,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  cylinderLiquidFill: { width: '100%', borderRadius: 20 },
  cylinderOverlayContent: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Mindful Body Scan Map
  anatomicalMapCard: { width: '100%', height: '100%', justifyContent: 'center' },
  anatomicalSilhouette: { width: '100%', gap: 5 },
  somaticZonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  somaticZoneIcon: { fontSize: 15 },
  somaticZoneName: { flex: 1, fontSize: 11, fontWeight: '700' },
  zoneTxtActive: { color: '#FFFFFF', fontWeight: '800' },
  activeDot: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },

  // Tibetan Singing Bowl
  zenInstrumentArea: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  singingBowlContainer: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  bowlAcousticRipple: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
  },
  bowlEmojiIcon: { fontSize: 40, marginBottom: 4 },
  bowlTitleTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textAlign: 'center' },
  bowlActionTag: { fontSize: 9, fontWeight: '800', marginTop: 4, letterSpacing: 0.5 },

  // Shared Typography
  centerEmoji: { fontSize: 30, marginBottom: 2 },
  centerTimer: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  centerPhaseTag: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 2, textTransform: 'uppercase' },

  // Guidance Card
  guidanceCard: {
    width: width * 0.9,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    marginVertical: 6,
  },
  guidanceTitle: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center' },
  guidanceInstruction: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 3 },
  scientificTipTxt: { fontSize: 10, fontWeight: '600', textAlign: 'center', marginTop: 6 },

  // Session Control Button
  sessionControlBtn: {
    width: width * 0.9,
    paddingVertical: 14,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  sessionControlBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
});