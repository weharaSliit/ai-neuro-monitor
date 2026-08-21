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
import { soundEngine } from '../utils/SoundEngine';

const { width, height } = Dimensions.get('window');

/**
 * MeditationGame
 * Displays 5 visually distinct, bespoke relaxation experiences:
 * 1. Box Meditation (Cyan Water Box Pacing with Dynamic Audio Breath Sync)
 * 2. Zen Body Scan (Emerald Aura Node PMR Scan)
 * 3. Chakra Harmonizer (Lotus Energy Mandala with 432Hz Align)
 * 4. Silent Zen Timer (Japanese Bronze Bell Chimes)
 * 5. Acoustic Meditation (Celestial Soundwave Frequency Bar Visualizer)
 */
export const MeditationGame = ({ initialMode, mode }) => {
  const startingMode = mode || initialMode || 'box_meditation';
  const [activeMode, setActiveMode] = useState(startingMode);
  const [secondsLeft, setSecondsLeft] = useState(4);
  const [phaseText, setPhaseText] = useState('🌬️ Inhale...');
  const [isPaused, setIsPaused] = useState(false);
  const [cyclesCompleted, setCyclesCompleted] = useState(0);
  const [activeBodyNode, setActiveBodyNode] = useState(0);

  const defaultSounds = {
    box_meditation: 'piano_rain',
    zen_body_scan: 'zen_flute',
    chakra_meditation: 'chakra_breath',
    transcendental_mind: 'singing_bowl',
    sound_meditation: 'ocean_harp',
  };

  const [selectedSound, setSelectedSound] = useState(defaultSounds[startingMode] || 'piano_rain');
  const [isPlayingSound, setIsPlayingSound] = useState(true);

  // Sync mode state when prop changes
  useEffect(() => {
    const target = mode || initialMode;
    if (target && target !== activeMode) {
      setActiveMode(target);
      if (defaultSounds[target]) {
        setSelectedSound(defaultSounds[target]);
      }
    }
  }, [mode, initialMode]);

  // Animation values
  const auraScale = useRef(new Animated.Value(1)).current;
  const auraGlow = useRef(new Animated.Value(0.4)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const waveAnim1 = useRef(new Animated.Value(0.5)).current;
  const waveAnim2 = useRef(new Animated.Value(0.3)).current;
  const waveAnim3 = useRef(new Animated.Value(0.7)).current;

  const meditationModes = [
    {
      id: 'box_meditation',
      title: 'Box Meditation',
      badge: '4-4-4-4 Square',
      icon: '📦',
      color: '#0284C7',
      bgGradient: ['#0A192F', '#0F2B48'],
      desc: 'Equal 4s square breath pacing for autonomic heart rate variability balancing with audio biofeedback',
      emojis: ['📦', '🧊', '⏹️', '🌬️', '💧', '🧘'],
      artworkTitle: 'ZEN WATER BOX',
    },
    {
      id: 'zen_body_scan',
      title: 'Zen Body Scan',
      badge: 'PMR Scan',
      icon: '🧘',
      color: '#10B981',
      bgGradient: ['#051A10', '#0D3322'],
      desc: 'Progressive muscle relaxation sequentially scanning awareness to release somatic tension',
      emojis: ['🧘', '💆', '🌿', '🌟', '🦶', '💚'],
      artworkTitle: 'EMERALD AURA SCAN',
    },
    {
      id: 'chakra_meditation',
      title: 'Chakra Harmonizer',
      badge: '432Hz Align',
      icon: '✨',
      color: '#EC4899',
      bgGradient: ['#1A0B2E', '#320E48'],
      desc: 'Resonant 432Hz harmonic energy alignment across all 7 vital chakra centers',
      emojis: ['✨', '🔮', '🌸', '☯️', '💫', '🪷'],
      artworkTitle: 'LOTUS ENERGY MANDALA',
    },
    {
      id: 'transcendental_mind',
      title: 'Silent Zen Timer',
      badge: 'Quiet Presence',
      icon: '🔔',
      color: '#F59E0B',
      bgGradient: ['#1F1504', '#3D2A08'],
      desc: 'Minimalist quiet presence timer with periodic Japanese singing bowl bell chimes',
      emojis: ['🔔', '🪨', '⛩️', '🪵', '🌙', '☯️'],
      artworkTitle: 'BRONZE SINGING BOWL',
    },
    {
      id: 'sound_meditation',
      title: 'Acoustic Meditation',
      badge: 'Binaural Sound',
      icon: '🎵',
      color: '#818CF8',
      bgGradient: ['#090D2A', '#1E1B4B'],
      desc: 'Celestial ocean soundwaves & acoustic instrumental music for deep mental calm',
      emojis: ['🎵', '🎶', '🌊', '🎧', '🌌', '🔮'],
      artworkTitle: 'CELESTIAL SOUNDWAVES',
    },
  ];

  const soundTracks = [
    { id: 'piano_rain', name: 'Ambient Piano & Rain', icon: '🎹', desc: 'Acoustic piano + soft rain (Lowers Cortisol)' },
    { id: 'zen_flute', name: 'Bamboo Zen Flute', icon: '🎋', desc: 'Shakuhachi bamboo melodies (Alpha Wave Boost)' },
    { id: 'ocean_harp', name: 'Acoustic Harp & Waves', icon: '🪕', desc: 'Plucked harp over sea tides (Baroreflex Sync)' },
    { id: 'chakra_breath', name: '432Hz Chakra Breath', icon: '🕉️', desc: 'Dynamic Solfeggio pad swelling on Inhale/Exhale' },
    { id: 'singing_bowl', name: 'Tibetan Bronze Bowl', icon: '🔔', desc: '528Hz bronze bell with decay (Vagal Tone)' },
  ];

  const bodyScanNodes = [
    { id: 0, label: 'Crown & Mind', icon: '💆' },
    { id: 1, label: 'Shoulders & Neck', icon: '🧘' },
    { id: 2, label: 'Heart & Chest', icon: '💚' },
    { id: 3, label: 'Solar Plexus & Core', icon: '🌟' },
    { id: 4, label: 'Grounding Feet', icon: '🦶' },
  ];

  const chakraRings = [
    { name: 'Crown', color: '#9333EA', freq: '768Hz' },
    { name: 'Third Eye', color: '#4F46E5', freq: '720Hz' },
    { name: 'Throat', color: '#0284C7', freq: '672Hz' },
    { name: 'Heart', color: '#10B981', freq: '528Hz' },
    { name: 'Solar', color: '#EAB308', freq: '432Hz' },
    { name: 'Sacral', color: '#F97316', freq: '360Hz' },
    { name: 'Root', color: '#EF4444', freq: '288Hz' },
  ];

  const currentConfig = meditationModes.find(m => m.id === activeMode) || meditationModes[0];

  useEffect(() => {
    if (isPlayingSound && !isPaused) {
      soundEngine.playSoundTrack(selectedSound);
    } else {
      soundEngine.stopSound();
    }
    return () => {
      soundEngine.stopSound();
    };
  }, [selectedSound, isPlayingSound, isPaused]);

  // Ambient soundwave bar animation loop
  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(waveAnim1, { toValue: 1.0, duration: 800, useNativeDriver: true }),
          Animated.timing(waveAnim1, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(waveAnim2, { toValue: 0.2, duration: 1100, useNativeDriver: true }),
          Animated.timing(waveAnim2, { toValue: 0.9, duration: 1100, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(waveAnim3, { toValue: 0.8, duration: 950, useNativeDriver: true }),
          Animated.timing(waveAnim3, { toValue: 0.4, duration: 950, useNativeDriver: true }),
        ])
      ])
    ).start();
  }, []);

  // Pacing cycle logic for different modes with Audio Bio-feedback
  useEffect(() => {
    if (isPaused) return;

    let cycleStep = 0;
    const runCycle = () => {
      if (activeMode === 'box_meditation') {
        const steps = [
          { label: '🌬️ Inhale (4s)', phase: 'inhale', sec: 4, scale: 1.4, glow: 0.9 },
          { label: '⏸️ Hold Top (4s)', phase: 'hold', sec: 4, scale: 1.4, glow: 0.9 },
          { label: '😮‍💨 Exhale (4s)', phase: 'exhale', sec: 4, scale: 1.0, glow: 0.3 },
          { label: '⏸️ Rest Hold (4s)', phase: 'rest', sec: 4, scale: 1.0, glow: 0.3 },
        ];
        const curr = steps[cycleStep % 4];
        setPhaseText(curr.label);
        setSecondsLeft(curr.sec);

        // Modulate Smartphone Audio in Real-Time to guide breath
        soundEngine.updateBreathPhase(curr.phase, curr.sec);

        Animated.parallel([
          Animated.timing(auraScale, { toValue: curr.scale, duration: curr.sec * 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(auraGlow, { toValue: curr.glow, duration: curr.sec * 1000, useNativeDriver: true }),
        ]).start();

        cycleStep++;
        if (cycleStep % 4 === 0) setCyclesCompleted(c => c + 1);

      } else if (activeMode === 'zen_body_scan') {
        setActiveBodyNode(prev => (prev + 1) % bodyScanNodes.length);
        const currNode = bodyScanNodes[cycleStep % bodyScanNodes.length];
        setPhaseText(`${currNode.icon} Relax ${currNode.label}`);
        setSecondsLeft(5);

        const phase = cycleStep % 2 === 0 ? 'inhale' : 'exhale';
        soundEngine.updateBreathPhase(phase, 5);

        Animated.sequence([
          Animated.timing(auraScale, { toValue: 1.3, duration: 2500, useNativeDriver: true }),
          Animated.timing(auraScale, { toValue: 1.0, duration: 2500, useNativeDriver: true }),
        ]).start();

        cycleStep++;
        if (cycleStep % bodyScanNodes.length === 0) setCyclesCompleted(c => c + 1);

      } else if (activeMode === 'chakra_meditation') {
        const currChakra = chakraRings[cycleStep % chakraRings.length];
        setPhaseText(`✨ ${currChakra.name} Chakra (${currChakra.freq})`);
        setSecondsLeft(6);

        const phase = cycleStep % 2 === 0 ? 'inhale' : 'exhale';
        soundEngine.updateBreathPhase(phase, 6);

        Animated.sequence([
          Animated.timing(auraScale, { toValue: 1.35, duration: 3000, useNativeDriver: true }),
          Animated.timing(auraScale, { toValue: 1.0, duration: 3000, useNativeDriver: true }),
        ]).start();

        cycleStep++;
        if (cycleStep % chakraRings.length === 0) setCyclesCompleted(c => c + 1);

      } else if (activeMode === 'transcendental_mind') {
        setPhaseText('🔔 Silent Zen Presence');
        setSecondsLeft(8);
        soundEngine.updateBreathPhase('hold', 8);

        Animated.sequence([
          Animated.timing(auraScale, { toValue: 1.15, duration: 4000, useNativeDriver: true }),
          Animated.timing(auraScale, { toValue: 1.0, duration: 4000, useNativeDriver: true }),
        ]).start();

        cycleStep++;
        setCyclesCompleted(c => c + 1);

      } else {
        // Acoustic Meditation
        setPhaseText('🎵 Resonant Soundwave Flow');
        setSecondsLeft(6);
        soundEngine.updateBreathPhase('inhale', 6);

        Animated.sequence([
          Animated.timing(auraScale, { toValue: 1.25, duration: 3000, useNativeDriver: true }),
          Animated.timing(auraScale, { toValue: 1.0, duration: 3000, useNativeDriver: true }),
        ]).start();

        cycleStep++;
        setCyclesCompleted(c => c + 1);
      }
    };

    runCycle();
    const intervalTime = activeMode === 'box_meditation' ? 4000 : activeMode === 'zen_body_scan' ? 5000 : 6000;
    const timer = setInterval(runCycle, intervalTime);
    return () => clearInterval(timer);
  }, [activeMode, isPaused]);

  // Handle Canvas Tap Interaction
  const handleCanvasTap = (evt) => {
    const locX = evt && evt.nativeEvent ? evt.nativeEvent.locationX : width / 2;
    soundEngine.playTouchChime(locX / width);

    if (Platform.OS !== 'web') {
      Vibration.vibrate(10);
    }
    rippleAnim.setValue(0);
    Animated.timing(rippleAnim, {
      toValue: 1,
      duration: 1200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const spin = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, { backgroundColor: currentConfig.bgGradient[0] }]}>
      {/* Mode Switcher Header Tabs */}
      <View style={styles.headerTabScroll}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeScrollRow}>
          {meditationModes.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[
                styles.modeTab,
                activeMode === m.id && { backgroundColor: m.color, borderColor: m.color }
              ]}
              onPress={() => {
                setActiveMode(m.id);
                setCyclesCompleted(0);
              }}
            >
              <Text style={styles.modeTabIcon}>{m.icon}</Text>
              <Text style={[styles.modeTabText, activeMode === m.id && styles.modeTabTextActive]}>
                {m.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Mode Badge & Description */}
      <View style={styles.badgeRow}>
        <View style={[styles.badgeContainer, { backgroundColor: `${currentConfig.color}25`, borderColor: currentConfig.color }]}>
          <Text style={[styles.badgeText, { color: currentConfig.color }]}>{currentConfig.badge}</Text>
        </View>
        <Text style={styles.cyclesText}>Cycles: {cyclesCompleted}</Text>
      </View>

      {/* Bespoke Interactive Visual Canvas */}
      <TouchableOpacity activeOpacity={0.9} style={styles.canvasContainer} onPress={handleCanvasTap}>
        {/* Ripple Shockwave Overlay */}
        <Animated.View
          style={[
            styles.rippleCircle,
            {
              borderColor: currentConfig.color,
              opacity: rippleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
              transform: [{ scale: rippleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.5] }) }],
            }
          ]}
        />

        {/* MODE 1: Box Meditation Water Canvas */}
        {activeMode === 'box_meditation' && (
          <View style={styles.artworkBoxContainer}>
            <Animated.View
              style={[
                styles.zenSquare,
                {
                  borderColor: currentConfig.color,
                  shadowColor: currentConfig.color,
                  transform: [{ scale: auraScale }],
                }
              ]}
            >
              <Text style={styles.centerEmoji}>🧘</Text>
              <Text style={styles.artworkTitleText}>{currentConfig.artworkTitle}</Text>
            </Animated.View>
            <View style={styles.cornerDotTL} />
            <View style={styles.cornerDotTR} />
            <View style={styles.cornerDotBL} />
            <View style={styles.cornerDotBR} />
          </View>
        )}

        {/* MODE 2: Zen Body Scan Emerald Aura Nodes */}
        {activeMode === 'zen_body_scan' && (
          <View style={styles.artworkBoxContainer}>
            <Animated.View style={[styles.auraCircle, { backgroundColor: `${currentConfig.color}20`, transform: [{ scale: auraScale }] }]}>
              <View style={styles.bodyNodeColumn}>
                {bodyScanNodes.map(node => (
                  <View
                    key={node.id}
                    style={[
                      styles.bodyNodePill,
                      activeBodyNode === node.id && { backgroundColor: currentConfig.color, borderColor: '#FFFFFF', scale: 1.1 }
                    ]}
                  >
                    <Text style={styles.bodyNodeIcon}>{node.icon}</Text>
                    <Text style={[styles.bodyNodeText, activeBodyNode === node.id && styles.bodyNodeTextActive]}>
                      {node.label}
                    </Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          </View>
        )}

        {/* MODE 3: Chakra Harmonizer Energy Mandala Rings */}
        {activeMode === 'chakra_meditation' && (
          <View style={styles.artworkBoxContainer}>
            <Animated.View style={[styles.auraCircle, { transform: [{ scale: auraScale }] }]}>
              {chakraRings.map((c, idx) => (
                <View
                  key={c.name}
                  style={[
                    styles.chakraRingItem,
                    {
                      width: 220 - idx * 24,
                      height: 220 - idx * 24,
                      borderRadius: (220 - idx * 24) / 2,
                      borderColor: c.color,
                    }
                  ]}
                />
              ))}
              <Text style={[styles.centerEmoji, { position: 'absolute' }]}>🪷</Text>
            </Animated.View>
          </View>
        )}

        {/* MODE 4: Silent Zen Bronze Bowl Timer */}
        {activeMode === 'transcendental_mind' && (
          <View style={styles.artworkBoxContainer}>
            <Animated.View style={[styles.singingBowlOuter, { borderColor: currentConfig.color, transform: [{ scale: auraScale }] }]}>
              <View style={[styles.singingBowlInner, { backgroundColor: `${currentConfig.color}30` }]}>
                <Text style={styles.bowlEmoji}>🔔</Text>
              </View>
            </Animated.View>
          </View>
        )}

        {/* MODE 5: Acoustic Meditation Soundwave Bar Visualizer */}
        {activeMode === 'sound_meditation' && (
          <View style={styles.artworkBoxContainer}>
            <View style={styles.waveBarContainer}>
              <Animated.View style={[styles.waveBar, { height: 110, backgroundColor: currentConfig.color, transform: [{ scaleY: waveAnim1 }] }]} />
              <Animated.View style={[styles.waveBar, { height: 140, backgroundColor: '#A7F3D0', transform: [{ scaleY: waveAnim2 }] }]} />
              <Animated.View style={[styles.waveBar, { height: 170, backgroundColor: currentConfig.color, transform: [{ scaleY: waveAnim3 }] }]} />
              <Animated.View style={[styles.waveBar, { height: 130, backgroundColor: '#FDE68A', transform: [{ scaleY: waveAnim1 }] }]} />
              <Animated.View style={[styles.waveBar, { height: 90, backgroundColor: currentConfig.color, transform: [{ scaleY: waveAnim2 }] }]} />
            </View>
          </View>
        )}
      </TouchableOpacity>

      {/* Central Guidance Phase Text */}
      <View style={styles.guidanceBox}>
        <Text style={[styles.phaseTextDisplay, { color: currentConfig.color }]}>{phaseText}</Text>
        <Text style={styles.subtextInstruction}>Tap screen to release tension • Sync breath with smartphone audio</Text>
      </View>

      {/* Instrumental Relaxation Sound Controls */}
      <View style={styles.soundControlCard}>
        <Text style={styles.soundControlHeader}>🎵 Instrumental Relaxation Soundscape</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.soundScrollRow}>
          {soundTracks.map(st => (
            <TouchableOpacity
              key={st.id}
              style={[
                styles.soundChip,
                selectedSound === st.id && { backgroundColor: currentConfig.color, borderColor: currentConfig.color }
              ]}
              onPress={() => {
                setSelectedSound(st.id);
                setIsPlayingSound(true);
              }}
            >
              <Text style={styles.soundChipIcon}>{st.icon}</Text>
              <Text style={[styles.soundChipText, selectedSound === st.id && styles.soundChipTextActive]}>
                {st.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Play/Pause Control Footer */}
      <View style={styles.footerControls}>
        <TouchableOpacity
          style={[styles.playBtn, { backgroundColor: currentConfig.color }]}
          onPress={() => setIsPaused(!isPaused)}
        >
          <Text style={styles.playBtnText}>{isPaused ? '▶ Resume' : '⏸ Pause'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.audioToggleBtn}
          onPress={() => setIsPlayingSound(!isPlayingSound)}
        >
          <Text style={styles.audioToggleText}>{isPlayingSound ? '🔊 Speaker On' : '🔇 Audio Muted'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  headerTabScroll: {
    width: '100%',
    paddingHorizontal: 12,
  },
  modeScrollRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
  },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    gap: 6,
  },
  modeTabIcon: {
    fontSize: 16,
  },
  modeTabText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: width * 0.88,
    marginVertical: 6,
  },
  badgeContainer: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cyclesText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
  },
  canvasContainer: {
    width: width * 0.85,
    height: width * 0.75,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  artworkBoxContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  rippleCircle: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
  },
  zenSquare: {
    width: 170,
    height: 170,
    borderRadius: 36,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 25,
  },
  centerEmoji: {
    fontSize: 44,
  },
  artworkTitleText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 6,
  },
  cornerDotTL: { position: 'absolute', top: 10, left: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  cornerDotTR: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  cornerDotBL: { position: 'absolute', bottom: 10, left: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  cornerDotBR: { position: 'absolute', bottom: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  auraCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyNodeColumn: {
    gap: 6,
    width: '100%',
    alignItems: 'center',
  },
  bodyNodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: '80%',
    gap: 8,
  },
  bodyNodeIcon: { fontSize: 14 },
  bodyNodeText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500' },
  bodyNodeTextActive: { color: '#FFFFFF', fontWeight: '700' },
  chakraRingItem: {
    position: 'absolute',
    borderWidth: 2,
    opacity: 0.75,
  },
  singingBowlOuter: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  singingBowlInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bowlEmoji: { fontSize: 48 },
  waveBarContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    height: 180,
  },
  waveBar: {
    width: 16,
    borderRadius: 8,
  },
  guidanceBox: {
    alignItems: 'center',
    marginVertical: 4,
  },
  phaseTextDisplay: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  subtextInstruction: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    marginTop: 4,
  },
  soundControlCard: {
    width: width * 0.9,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  soundControlHeader: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  soundScrollRow: {
    flexDirection: 'row',
    gap: 8,
  },
  soundChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 6,
  },
  soundChipIcon: { fontSize: 14 },
  soundChipText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500' },
  soundChipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  footerControls: {
    flexDirection: 'row',
    gap: 12,
    width: width * 0.88,
    justifyContent: 'center',
  },
  playBtn: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  playBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  audioToggleBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioToggleText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
});
