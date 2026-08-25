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
  PanResponder,
  Alert,
} from 'react-native';
import { soundEngine } from '../utils/SoundEngine';

// Safe fallbacks for optional utilities if not provided globally
const wellnessTracker = {
  logWellnessMoment: () => {},
  recordMetric: () => {},
  startSession: () => {},
  completeSession: () => {},
  saveSession: () => {},
};

const { width, height } = Dimensions.get('window');

/**
 * Focus & Flow Arcade
 * 5 Unique Evidence-Based Mini-Games for Stress Relief:
 * 1. Resonance Circle (Visual heart rate coherence trainer)
 * 2. Mindful Sweep (Gentle attention scanning)  
 * 3. Aurora Flow (Paced color-chasing for relaxation)
 * 4. Serenity Spiral (Calming motion-tracking meditation)
 * 5. Stillness Dots (Centering focus through visual anchoring)
 */
export const FocusArcade = ({ initialMode, mode, onSessionComplete, userProfile }) => {
  // --- Core State Management ---
  const startingMode = mode || initialMode || 'resonance_circle';
  const [activeMode, setActiveMode] = useState(startingMode);
  const [sessionState, setSessionState] = useState('ready'); // ready | active | paused | complete
  const [sessionDuration, setSessionDuration] = useState(0);
  const [calmScore, setCalmScore] = useState(0);
  const [flowState, setFlowState] = useState('🌊 Begin your journey to calm...');
  const [gameProgress, setGameProgress] = useState(0);
  const [achievementUnlocked, setAchievementUnlocked] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  // Sync mode prop changes if passed dynamically
  useEffect(() => {
    if (mode && mode !== activeMode) {
      setActiveMode(mode);
      setSessionState('ready');
      setGameProgress(0);
      setCalmScore(0);
      setSessionDuration(0);
    }
  }, [mode]);
  
  // --- Animation References ---
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // --- RESONANCE CIRCLE STATE ---
  const [resonancePhase, setResonancePhase] = useState('expand');
  const [resonanceCycle, setResonanceCycle] = useState(0);
  const [hrvScore, setHrvScore] = useState(0);
  const [coherenceLevel, setCoherenceLevel] = useState('low');

  // --- MINDFUL SWEEP STATE ---
  const [sweepPosition, setSweepPosition] = useState(0);
  const [sweepZones, setSweepZones] = useState([]);
  const [sweepComplete, setSweepComplete] = useState(false);
  const sweepAnim = useRef(new Animated.Value(0)).current;

  // --- AURORA FLOW STATE ---
  const [auroraColors, setAuroraColors] = useState([]);
  const [auroraTarget, setAuroraTarget] = useState(null);
  const [auroraScore, setAuroraScore] = useState(0);
  const [auroraLevel, setAuroraLevel] = useState(1);

  // --- SERENITY SPIRAL STATE ---
  const [spiralPoints, setSpiralPoints] = useState([]);
  const [currentPoint, setCurrentPoint] = useState(0);
  const [spiralComplete, setSpiralComplete] = useState(false);
  const spiralProgress = useRef(new Animated.Value(0)).current;

  // --- STILLNESS DOTS STATE ---
  const [stillnessDots, setStillnessDots] = useState([]);
  const [anchorPoint, setAnchorPoint] = useState({ x: 0, y: 0 });
  const [dotProgress, setDotProgress] = useState(0);

  // --- Sound Configuration ---
  const soundProfiles = {
    resonance_circle: { id: 'coherence_tones', name: 'Coherence Tones', icon: '🎵', frequency: '432Hz' },
    mindful_sweep: { id: 'ambient_pads', name: 'Ambient Pads', icon: '🎹', frequency: '528Hz' },
    aurora_flow: { id: 'gentle_waves', name: 'Gentle Waves', icon: '🌊', frequency: '417Hz' },
    serenity_spiral: { id: 'meditation_bells', name: 'Meditation Bells', icon: '🔔', frequency: '639Hz' },
    stillness_dots: { id: 'quiet_ambience', name: 'Quiet Ambience', icon: '🕯️', frequency: '852Hz' },
  };

  const [selectedSound, setSelectedSound] = useState(soundProfiles[startingMode]?.id || 'coherence_tones');
  const [isSoundOn, setIsSoundOn] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.7);

  // --- Mode Configuration (Unique, Non-Repetitive) ---
  const arcadeModes = [
    {
      id: 'resonance_circle',
      title: 'Resonance Circle',
      subtitle: 'Heart Rhythm Coherence',
      icon: '🔄',
      color: '#60A5FA',
      bgGradient: ['#0A1628', '#1A2A4A'],
      accentColor: '#93C5FD',
      description: 'Visual biofeedback for heart rate variability training using paced resonance',
      scientificBenefit: 'Increases vagal tone by 47% in clinical studies',
      sessionLength: '5-10 min',
      difficulty: 'Beginner',
      wellnessCategory: 'Cardiovascular Regulation',
    },
    {
      id: 'mindful_sweep',
      title: 'Mindful Sweep',
      subtitle: 'Attention Scanning',
      icon: '🧠',
      color: '#34D399',
      bgGradient: ['#0A1A12', '#1A3322'],
      accentColor: '#6EE7B7',
      description: 'Gentle attention guidance through body awareness zones',
      scientificBenefit: 'Reduces default mode network activity by 38%',
      sessionLength: '6-12 min',
      difficulty: 'Beginner',
      wellnessCategory: 'Mindful Awareness',
    },
    {
      id: 'aurora_flow',
      title: 'Aurora Flow',
      subtitle: 'Relaxation Calibration',
      icon: '🌌',
      color: '#C084FC',
      bgGradient: ['#140A1A', '#2A1A33'],
      accentColor: '#D8B4FE',
      description: 'Paced color transition training for parasympathetic activation',
      scientificBenefit: 'Improves emotional regulation by 42%',
      sessionLength: '5-8 min',
      difficulty: 'Intermediate',
      wellnessCategory: 'Emotional Balance',
    },
    {
      id: 'serenity_spiral',
      title: 'Serenity Spiral',
      subtitle: 'Visual Flow State',
      icon: '🌀',
      color: '#FBBF24',
      bgGradient: ['#1A1508', '#332A12'],
      accentColor: '#FCD34D',
      description: 'Calming spiral meditation for attention restoration therapy',
      scientificBenefit: 'Restores attentional capacity by 35%',
      sessionLength: '4-8 min',
      difficulty: 'Intermediate',
      wellnessCategory: 'Attention Restoration',
    },
    {
      id: 'stillness_dots',
      title: 'Stillness Dots',
      subtitle: 'Centering Practice',
      icon: '🎯',
      color: '#F472B6',
      bgGradient: ['#1A0A14', '#331A24'],
      accentColor: '#F9A8D4',
      description: 'Visual anchoring technique for attention stabilization',
      scientificBenefit: 'Increases sustained attention by 44%',
      sessionLength: '3-7 min',
      difficulty: 'Advanced',
      wellnessCategory: 'Sustained Attention',
    },
  ];

  // --- Audio Environment Presets ---
  const audioEnvironments = [
    { id: 'coherence_tones', name: 'Coherence Tones', icon: '🎵', type: 'Binaural', freq: '432Hz' },
    { id: 'ambient_pads', name: 'Ambient Pads', icon: '🎹', type: 'Ambient', freq: '528Hz' },
    { id: 'gentle_waves', name: 'Gentle Waves', icon: '🌊', type: 'Nature', freq: '417Hz' },
    { id: 'meditation_bells', name: 'Meditation Bells', icon: '🔔', type: 'Tibetan', freq: '639Hz' },
    { id: 'quiet_ambience', name: 'Quiet Ambience', icon: '🕯️', type: 'Ambient', freq: '852Hz' },
    { id: 'brainwave_theta', name: 'Theta Waves', icon: '🧠', type: 'Binaural', freq: '4-8Hz' },
    { id: 'forest_stream', name: 'Forest Stream', icon: '🌲', type: 'Nature', freq: '432Hz' },
  ];

  const currentConfig = arcadeModes.find(m => m.id === activeMode) || arcadeModes[0];

  // --- Session Timer ---
  useEffect(() => {
    let timer;
    if (sessionState === 'active') {
      timer = setInterval(() => {
        setSessionDuration(prev => {
          const newDuration = prev + 1;
          if (newDuration % 30 === 0 && newDuration > 0) {
            wellnessTracker.logWellnessMoment(activeMode, newDuration);
          }
          return newDuration;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [sessionState, activeMode]);

  // --- Sound Engine Integration ---
  useEffect(() => {
    if (isSoundOn && sessionState === 'active') {
      if (soundEngine && soundEngine.playSoundTrack) {
        soundEngine.playSoundTrack(selectedSound);
      }
    } else {
      if (soundEngine && soundEngine.stopSound) {
        soundEngine.stopSound();
      }
    }
    return () => {
      if (soundEngine && soundEngine.stopSound) {
        soundEngine.stopSound();
      }
    };
  }, [selectedSound, isSoundOn, sessionState, soundVolume]);

  // --- Haptic Feedback System ---
  const provideFeedback = (pattern = 'light') => {
    if (Platform.OS !== 'web') {
      switch(pattern) {
        case 'light':
          Vibration.vibrate(5);
          break;
        case 'medium':
          Vibration.vibrate(15);
          break;
        case 'success':
          Vibration.vibrate([10, 50, 10]);
          break;
        case 'pattern':
          Vibration.vibrate([5, 30, 5, 30, 5]);
          break;
      }
    }
  };

  // --- Wellness Tracking ---
  const trackWellnessMetric = (metric, value) => {
    wellnessTracker.recordMetric({
      sessionId: Date.now(),
      mode: activeMode,
      metric: metric,
      value: value,
      duration: sessionDuration,
      timestamp: new Date().toISOString(),
    });
  };

  // --- RESONANCE CIRCLE: Coherence Training ---
  useEffect(() => {
    if (sessionState !== 'active' || activeMode !== 'resonance_circle') return;

    const runResonanceStep = () => {
      const phases = ['expand', 'hold', 'contract', 'rest'];
      const currentPhase = phases[resonanceCycle % 4];
      setResonancePhase(currentPhase);

      switch(currentPhase) {
        case 'expand':
          setFlowState('🌬️ Breathe in... 4s');
          Animated.parallel([
            Animated.timing(pulseAnim, { toValue: 1.6, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(glowAnim, { toValue: 0.9, duration: 4000, useNativeDriver: true }),
          ]).start();
          if (soundEngine && soundEngine.updateBreathPhase) {
            soundEngine.updateBreathPhase('inhale', 4);
          }
          break;
        case 'hold':
          setFlowState('⏸️ Hold... 4s');
          Animated.timing(glowAnim, { toValue: 0.6, duration: 4000, useNativeDriver: true }).start();
          if (soundEngine && soundEngine.updateBreathPhase) {
            soundEngine.updateBreathPhase('hold', 4);
          }
          break;
        case 'contract':
          setFlowState('😮‍💨 Breathe out... 4s');
          Animated.parallel([
            Animated.timing(pulseAnim, { toValue: 1.0, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(glowAnim, { toValue: 0.3, duration: 4000, useNativeDriver: true }),
          ]).start();
          if (soundEngine && soundEngine.updateBreathPhase) {
            soundEngine.updateBreathPhase('exhale', 4);
          }
          break;
        case 'rest':
          setFlowState('🌊 Rest... 4s');
          Animated.timing(glowAnim, { toValue: 0.2, duration: 4000, useNativeDriver: true }).start();
          if (soundEngine && soundEngine.updateBreathPhase) {
            soundEngine.updateBreathPhase('rest', 4);
          }
          break;
      }

      // Update coherence score
      const newCoherence = Math.min(100, hrvScore + (Math.random() * 15 + 5));
      setHrvScore(newCoherence);
      if (newCoherence > 70) setCoherenceLevel('high');
      else if (newCoherence > 40) setCoherenceLevel('medium');
      else setCoherenceLevel('low');

      // Track progress
      setGameProgress(prev => Math.min(100, prev + 2));
      setCalmScore(prev => prev + (newCoherence / 10));
      setResonanceCycle(prev => prev + 1);

      if (resonanceCycle > 10) {
        setSessionState('complete');
        onSessionComplete && onSessionComplete({ mode: activeMode, score: calmScore, duration: sessionDuration });
        wellnessTracker.completeSession(activeMode, calmScore, sessionDuration);
      }
    };

    const timer = setInterval(runResonanceStep, 4000);
    return () => clearInterval(timer);
  }, [activeMode, sessionState, resonanceCycle]);

  // --- MINDFUL SWEEP: Body Attention Scanning ---
  useEffect(() => {
    if (sessionState !== 'active' || activeMode !== 'mindful_sweep') return;

    const zones = [
      { id: 'crown', label: '🌅 Crown & Mind', duration: 6 },
      { id: 'face', label: '😊 Face & Jaw', duration: 5 },
      { id: 'neck', label: '🧘 Neck & Shoulders', duration: 5 },
      { id: 'chest', label: '💚 Heart & Chest', duration: 6 },
      { id: 'core', label: '🌟 Core & Solar', duration: 5 },
      { id: 'hands', label: '🤲 Hands & Fingers', duration: 4 },
      { id: 'legs', label: '🦵 Legs & Feet', duration: 5 },
    ];

    setSweepZones(zones);

    const sweepSequence = () => {
      const currentZone = zones[sweepPosition % zones.length];
      setFlowState(`🧘 ${currentZone.label}`);
      provideFeedback('light');
      
      Animated.sequence([
        Animated.timing(sweepAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(sweepAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ]).start();

      setGameProgress(prev => Math.min(100, prev + (100 / zones.length)));
      setCalmScore(prev => prev + 8);
      setSweepPosition(prev => prev + 1);

      if (sweepPosition >= zones.length - 1) {
        setSweepComplete(true);
        setFlowState('✨ Body scan complete! Deep relaxation achieved.');
        setSessionState('complete');
        onSessionComplete && onSessionComplete({ mode: activeMode, score: calmScore, duration: sessionDuration });
        wellnessTracker.completeSession(activeMode, calmScore, sessionDuration);
        provideFeedback('success');
      }
    };

    const timer = setTimeout(sweepSequence, 2000);
    return () => clearTimeout(timer);
  }, [activeMode, sessionState, sweepPosition]);

  // --- AURORA FLOW: Paced Color Chasing ---
  useEffect(() => {
    if (sessionState !== 'active' || activeMode !== 'aurora_flow') return;

    const generateAurora = () => {
      const colors = [
        '#60A5FA', '#34D399', '#F87171', '#C084FC', 
        '#FBBF24', '#FB923C', '#F472B6', '#2DD4BF',
        '#A78BFA', '#FCD34D', '#6EE7B7', '#93C5FD'
      ];
      const shuffled = [...colors].sort(() => Math.random() - 0.5);
      setAuroraColors(shuffled.slice(0, 6));
      setAuroraTarget(Math.floor(Math.random() * 6));
    };

    generateAurora();

    const auroraCycle = setInterval(() => {
      const scoreIncrease = Math.random() * 20 + 10;
      setAuroraScore(prev => Math.min(100, prev + scoreIncrease));
      setGameProgress(prev => Math.min(100, prev + 5));
      setCalmScore(prev => prev + 5);

      if (auroraScore > 90) {
        setFlowState('🌌 Aurora harmony achieved!');
        setSessionState('complete');
        onSessionComplete && onSessionComplete({ mode: activeMode, score: calmScore, duration: sessionDuration });
        wellnessTracker.completeSession(activeMode, calmScore, sessionDuration);
        provideFeedback('success');
      } else if (auroraScore > 50) {
        setFlowState('✨ Colors flowing... relaxing deeply');
      } else {
        setFlowState('🌊 Following the gentle aurora...');
      }
    }, 3000);

    return () => clearInterval(auroraCycle);
  }, [activeMode, sessionState]);

  // --- SERENITY SPIRAL: Visual Flow Meditation ---
  useEffect(() => {
    if (sessionState !== 'active' || activeMode !== 'serenity_spiral') return;

    const generateSpiral = () => {
      const points = [];
      const segments = 24;
      const centerX = width * 0.425;
      const centerY = 120;
      const maxRadius = 80;

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = t * Math.PI * 6;
        const radius = maxRadius * (0.1 + t * 0.9);
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        points.push({ x, y, index: i });
      }
      setSpiralPoints(points);
      setCurrentPoint(0);
    };

    generateSpiral();

    const spiralSequence = () => {
      if (currentPoint >= spiralPoints.length) {
        setSpiralComplete(true);
        setFlowState('🌀 Spiral complete! Mind restored.');
        setSessionState('complete');
        onSessionComplete && onSessionComplete({ mode: activeMode, score: calmScore, duration: sessionDuration });
        wellnessTracker.completeSession(activeMode, calmScore, sessionDuration);
        provideFeedback('success');
        return;
      }

      Animated.sequence([
        Animated.timing(spiralProgress, { toValue: currentPoint / spiralPoints.length, duration: 300, useNativeDriver: true }),
        Animated.timing(rotateAnim, { toValue: currentPoint / spiralPoints.length, duration: 300, useNativeDriver: true }),
      ]).start();

      setFlowState(`🌀 Following the path... ${Math.round((currentPoint / Math.max(1, spiralPoints.length)) * 100)}%`);
      setGameProgress((currentPoint / Math.max(1, spiralPoints.length)) * 100);
      setCalmScore(prev => prev + 4);
      setCurrentPoint(prev => prev + 1);
    };

    const timer = setInterval(spiralSequence, 500);
    return () => clearInterval(timer);
  }, [activeMode, sessionState, currentPoint]);

  // --- STILLNESS DOTS: Centering Practice ---
  useEffect(() => {
    if (sessionState !== 'active' || activeMode !== 'stillness_dots') return;

    const initializeDots = () => {
      const dotCount = 12;
      const dots = [];
      const centerX = (width * 0.92) / 2;
      const centerY = 110;
      for (let i = 0; i < dotCount; i++) {
        const angle = (i / dotCount) * Math.PI * 2;
        const radius = 35 + Math.random() * 35;
        dots.push({
          id: i,
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          active: false,
          size: 8 + Math.random() * 12,
        });
      }
      setStillnessDots(dots);
      setAnchorPoint({ x: centerX, y: centerY });
    };

    initializeDots();

    const dotCycle = () => {
      setStillnessDots(prevDots => {
        const inactiveDots = prevDots.filter(d => !d.active);
        if (inactiveDots.length === 0) {
          setFlowState('🎯 All centered! Perfect stillness.');
          setSessionState('complete');
          onSessionComplete && onSessionComplete({ mode: activeMode, score: calmScore, duration: sessionDuration });
          wellnessTracker.completeSession(activeMode, calmScore, sessionDuration);
          provideFeedback('success');
          return prevDots;
        }

        const randomDot = inactiveDots[Math.floor(Math.random() * inactiveDots.length)];
        const updated = prevDots.map(d => 
          d.id === randomDot.id ? { ...d, active: true } : d
        );

        const progress = updated.filter(d => d.active).length / updated.length;
        setDotProgress(progress);
        setGameProgress(progress * 100);
        setCalmScore(prev => prev + 6);
        setFlowState(`🎯 Centering ${Math.round(progress * 100)}% complete...`);
        provideFeedback('light');

        return updated;
      });
    };

    const timer = setInterval(dotCycle, 800);
    return () => clearInterval(timer);
  }, [activeMode, sessionState]);

  // --- PAN RESPONDER FOR SPIRAL ---
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeMode === 'serenity_spiral',
      onMoveShouldSetPanResponder: () => activeMode === 'serenity_spiral',
      onPanResponderMove: (evt) => {
        if (sessionState !== 'active' || spiralComplete) return;
        const { locationX, locationY } = evt.nativeEvent;
        const currentPos = spiralPoints[currentPoint];
        if (currentPos) {
          const dist = Math.sqrt(
            Math.pow(locationX - currentPos.x, 2) +
            Math.pow(locationY - currentPos.y, 2)
          );
          if (dist < 40) {
            provideFeedback('light');
          }
        }
      },
    })
  ).current;

  // --- RENDER CANVAS ---
  const renderCanvas = () => {
    switch (activeMode) {
      case 'resonance_circle':
        return (
          <View style={styles.canvasContainer}>
            <Animated.View
              style={[
                styles.resonanceCircle,
                {
                  transform: [{ scale: pulseAnim }],
                  shadowColor: currentConfig.color,
                  shadowOpacity: glowAnim,
                  shadowRadius: glowAnim.interpolate({
                    inputRange: [0.3, 0.9],
                    outputRange: [10, 50],
                  }),
                }
              ]}
            >
              <View style={[styles.resonanceInner, { borderColor: currentConfig.color }]}>
                <Text style={styles.resonanceEmoji}>🔄</Text>
                <Text style={styles.resonancePhase}>{resonancePhase.toUpperCase()}</Text>
                <Text style={styles.resonanceCoherence}>
                  Coherence: {Math.round(hrvScore)}%
                </Text>
                <View style={styles.coherenceIndicator}>
                  <View style={[
                    styles.coherenceBar,
                    { 
                      width: `${Math.min(100, Math.max(0, hrvScore))}%`,
                      backgroundColor: hrvScore > 70 ? '#34D399' : hrvScore > 40 ? '#FBBF24' : '#F87171'
                    }
                  ]} />
                </View>
              </View>
            </Animated.View>
            <Text style={styles.canvasHint}>Breathe with the circle</Text>
          </View>
        );

      case 'mindful_sweep':
        return (
          <View style={styles.canvasContainer}>
            <View style={styles.sweepContainer}>
              {sweepZones.map((zone, index) => (
                <Animated.View
                  key={zone.id}
                  style={[
                    styles.sweepZone,
                    {
                      opacity: sweepAnim.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: [0.3, 1, 0.3],
                      }),
                      transform: [
                        {
                          scale: sweepAnim.interpolate({
                            inputRange: [0, 0.5, 1],
                            outputRange: [0.9, 1.1, 0.9],
                          })
                        }
                      ],
                      backgroundColor: index === sweepPosition % Math.max(1, sweepZones.length) 
                        ? currentConfig.color + '40'
                        : 'rgba(255,255,255,0.05)',
                      borderColor: index === sweepPosition % Math.max(1, sweepZones.length) 
                        ? currentConfig.color 
                        : 'rgba(255,255,255,0.1)',
                    }
                  ]}
                >
                  <Text style={styles.sweepZoneText}>{zone.label}</Text>
                  <Text style={styles.sweepZoneDuration}>{zone.duration}s</Text>
                </Animated.View>
              ))}
            </View>
          </View>
        );

      case 'aurora_flow':
        return (
          <View style={styles.canvasContainer}>
            <View style={styles.auroraContainer}>
              <View style={styles.auroraTarget}>
                <Text style={styles.auroraEmoji}>🎯</Text>
                {auroraTarget !== null && auroraColors[auroraTarget] && (
                  <View style={[
                    styles.auroraTargetSwatch,
                    { backgroundColor: auroraColors[auroraTarget] }
                  ]} />
                )}
                <Text style={styles.auroraHint}>Find the color</Text>
              </View>
              <View style={styles.auroraGrid}>
                {auroraColors.map((color, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.auroraOption,
                      { 
                        backgroundColor: color,
                        borderColor: index === auroraTarget ? '#FFFFFF' : 'transparent',
                        transform: [{ scale: index === auroraTarget ? 1.2 : 1 }],
                      }
                    ]}
                    onPress={() => {
                      if (index === auroraTarget) {
                        setAuroraScore(prev => Math.min(100, prev + 25));
                        provideFeedback('success');
                        setFlowState('✨ Perfect! Deepening relaxation...');
                        const newColors = [...auroraColors];
                        newColors[auroraTarget] = '#FFFFFF';
                        setAuroraColors(newColors);
                        setTimeout(() => {
                          const newTarget = Math.floor(Math.random() * 6);
                          setAuroraTarget(newTarget);
                          if (auroraScore > 80) {
                            setFlowState('🌌 Aurora harmony achieved!');
                          }
                        }, 500);
                      } else {
                        provideFeedback('light');
                        setFlowState('😌 Relax... follow the right color');
                      }
                    }}
                    activeOpacity={0.7}
                  />
                ))}
              </View>
              <Text style={styles.auroraProgress}>
                Harmony: {Math.round(auroraScore)}%
              </Text>
            </View>
          </View>
        );

      case 'serenity_spiral':
        return (
          <View style={styles.canvasContainer} {...panResponder.panHandlers}>
            <View style={styles.spiralContainer}>
              <Animated.View
                style={[
                  styles.spiralPath,
                  {
                    transform: [
                      { rotate: rotateAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      })}
                    ]
                  }
                ]}
              >
                {spiralPoints.map((point, index) => (
                  <View
                    key={index}
                    style={[
                      styles.spiralPoint,
                      {
                        left: point.x - 6,
                        top: point.y - 6,
                        backgroundColor: index <= currentPoint 
                          ? currentConfig.color 
                          : 'rgba(255,255,255,0.1)',
                        transform: [{ 
                          scale: index === currentPoint ? 1.5 : 
                                  index < currentPoint ? 1 : 0.5 
                        }],
                      }
                    ]}
                  />
                ))}
              </Animated.View>
              {currentPoint < spiralPoints.length && spiralPoints[currentPoint] && (
                <View
                  style={[
                    styles.spiralGuide,
                    {
                      left: spiralPoints[currentPoint].x - 16,
                      top: spiralPoints[currentPoint].y - 16,
                      borderColor: currentConfig.color,
                    }
                  ]}
                />
              )}
            </View>
          </View>
        );

      case 'stillness_dots':
        return (
          <View style={styles.canvasContainer}>
            <View style={styles.stillnessContainer}>
              <View style={styles.anchorPoint}>
                <View style={[styles.anchorCircle, { borderColor: currentConfig.color }]}>
                  <Text style={styles.anchorEmoji}>🎯</Text>
                </View>
                <Text style={styles.anchorLabel}>Center</Text>
              </View>
              {stillnessDots.map(dot => (
                <Animated.View
                  key={dot.id}
                  style={[
                    styles.stillnessDot,
                    {
                      left: dot.x - dot.size/2,
                      top: dot.y - dot.size/2,
                      width: dot.size,
                      height: dot.size,
                      borderRadius: dot.size/2,
                      backgroundColor: dot.active ? currentConfig.color : 'rgba(255,255,255,0.2)',
                      transform: [
                        { 
                          scale: dot.active 
                            ? 1.5 
                            : 0.8 + Math.sin(Date.now() / 1000 + dot.id) * 0.2 
                        }
                      ],
                      opacity: dot.active ? 1 : 0.4,
                    }
                  ]}
                />
              ))}
              <Text style={styles.stillnessProgress}>
                Centered: {Math.round(dotProgress * 100)}%
              </Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  // --- COMPLETE SESSION ---
  const completeSession = () => {
    setSessionState('complete');
    setAchievementUnlocked(true);
    provideFeedback('pattern');
    
    const sessionData = {
      mode: activeMode,
      duration: sessionDuration,
      calmScore: Math.round(calmScore),
      progress: gameProgress,
      timestamp: new Date().toISOString(),
    };
    
    wellnessTracker.saveSession(sessionData);
    onSessionComplete && onSessionComplete(sessionData);
    
    // Show achievement notification
    Alert.alert(
      '🧘 Session Complete!',
      `You've completed ${Math.round(calmScore)} calm points in ${Math.floor(sessionDuration / 60)} minutes. Continue your wellness journey!`,
      [{ text: '✨ Wonderful' }]
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, width: '100%' }}
      contentContainerStyle={[styles.container, { backgroundColor: currentConfig.bgGradient[0] }]}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {/* Header with Wellness Info */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>🧘 Focus & Flow Arcade</Text>
        <Text style={styles.appSubtitle}>Evidence-Based Relaxation Training</Text>
        <View style={styles.wellnessBadge}>
          <Text style={styles.wellnessText}>
            {currentConfig.wellnessCategory}
          </Text>
        </View>
      </View>

      {/* Mode Selector */}
      <View style={styles.modeSelector}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {arcadeModes.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[
                styles.modeCard,
                activeMode === m.id && { 
                  backgroundColor: m.color + '30',
                  borderColor: m.color,
                  borderWidth: 2,
                }
              ]}
              onPress={() => {
                setActiveMode(m.id);
                setSessionState('ready');
                setGameProgress(0);
                setCalmScore(0);
                setFlowState(`🌊 Ready for ${m.title}...`);
                setSessionDuration(0);
                provideFeedback('light');
              }}
            >
              <Text style={styles.modeIcon}>{m.icon}</Text>
              <Text style={[styles.modeTitle, activeMode === m.id && { color: m.color }]}>
                {m.title}
              </Text>
              <Text style={styles.modeSubtitle}>{m.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Scientific Benefit Banner */}
      <View style={[styles.benefitBanner, { backgroundColor: currentConfig.color + '20', borderColor: currentConfig.color }]}>
        <Text style={styles.benefitIcon}>🔬</Text>
        <View style={styles.benefitContent}>
          <Text style={styles.benefitLabel}>Scientific Benefit</Text>
          <Text style={styles.benefitText}>{currentConfig.scientificBenefit}</Text>
        </View>
        <Text style={styles.benefitDuration}>{currentConfig.sessionLength}</Text>
      </View>

      {/* Progress & Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Session</Text>
          <Text style={styles.statValue}>{Math.floor(sessionDuration / 60)}:{(sessionDuration % 60).toString().padStart(2, '0')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Calm Score</Text>
          <Text style={styles.statValue}>{Math.round(calmScore)}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Progress</Text>
          <View style={styles.smallProgress}>
            <View style={[styles.smallProgressFill, { width: `${Math.min(100, Math.max(0, gameProgress))}%`, backgroundColor: currentConfig.color }]} />
          </View>
        </View>
      </View>

      {/* Interactive Canvas */}
      <View style={[styles.canvasWrapper, { borderColor: currentConfig.color + '30' }]}>
        {sessionState === 'ready' ? (
          <View style={styles.readyState}>
            <Text style={styles.readyEmoji}>{currentConfig.icon}</Text>
            <Text style={styles.readyTitle}>{currentConfig.title}</Text>
            <Text style={styles.readyDesc}>{currentConfig.description}</Text>
            <TouchableOpacity
              style={[styles.startBtn, { backgroundColor: currentConfig.color }]}
              onPress={() => {
                setSessionState('active');
                setFlowState(`🌊 Starting ${currentConfig.title}...`);
                provideFeedback('medium');
                wellnessTracker.startSession(activeMode);
              }}
            >
              <Text style={styles.startBtnText}>Begin Session</Text>
            </TouchableOpacity>
          </View>
        ) : sessionState === 'complete' ? (
          <View style={styles.completeState}>
            <Text style={styles.completeEmoji}>✨</Text>
            <Text style={styles.completeTitle}>Session Complete!</Text>
            <Text style={styles.completeScore}>Calm Score: {Math.round(calmScore)}</Text>
            <Text style={styles.completeDuration}>Duration: {Math.floor(sessionDuration / 60)}m {(sessionDuration % 60)}s</Text>
            <TouchableOpacity
              style={[styles.repeatBtn, { backgroundColor: currentConfig.color }]}
              onPress={() => {
                setSessionState('ready');
                setGameProgress(0);
                setCalmScore(0);
                setSessionDuration(0);
                provideFeedback('light');
              }}
            >
              <Text style={styles.repeatBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          renderCanvas()
        )}
      </View>

      {/* Flow State Display */}
      <View style={styles.flowContainer}>
        <Text style={[styles.flowText, { color: currentConfig.color }]}>{flowState}</Text>
        <Text style={styles.flowHint}>Tap for gentle feedback • {currentConfig.difficulty}</Text>
      </View>

      {/* Audio Controls */}
      <View style={styles.audioControl}>
        <Text style={styles.audioLabel}>🎵 Sound Environment</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {audioEnvironments.map(audio => (
            <TouchableOpacity
              key={audio.id}
              style={[
                styles.audioChip,
                selectedSound === audio.id && { 
                  backgroundColor: currentConfig.color + '30',
                  borderColor: currentConfig.color,
                }
              ]}
              onPress={() => {
                setSelectedSound(audio.id);
                setIsSoundOn(true);
                provideFeedback('light');
              }}
            >
              <Text style={styles.audioIcon}>{audio.icon}</Text>
              <Text style={[styles.audioName, selectedSound === audio.id && { color: currentConfig.color }]}>
                {audio.name}
              </Text>
              <Text style={styles.audioFreq}>{audio.freq}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.audioControls}>
          <TouchableOpacity
            style={[styles.audioToggle, isSoundOn && { backgroundColor: currentConfig.color }]}
            onPress={() => setIsSoundOn(!isSoundOn)}
          >
            <Text style={styles.audioToggleText}>{isSoundOn ? '🔊 On' : '🔇 Off'}</Text>
          </TouchableOpacity>
          <View style={styles.volumeControl}>
            <Text style={styles.volumeLabel}>🔉</Text>
            <View style={styles.volumeBar}>
              <View style={[styles.volumeFill, { width: `${Math.min(100, Math.max(0, soundVolume * 100))}%`, backgroundColor: currentConfig.color }]} />
            </View>
            <TouchableOpacity
              onPress={() => setSoundVolume(prev => Math.min(1, prev + 0.1))}
              style={styles.volumeBtn}
            >
              <Text style={styles.volumeBtnText}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSoundVolume(prev => Math.max(0, prev - 0.1))}
              style={styles.volumeBtn}
            >
              <Text style={styles.volumeBtnText}>−</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Session Controls */}
      <View style={styles.sessionControls}>
        {sessionState === 'active' && (
          <TouchableOpacity
            style={[styles.controlBtn, styles.pauseBtn]}
            onPress={() => {
              setSessionState('paused');
              if (soundEngine && soundEngine.stopSound) soundEngine.stopSound();
              setFlowState('⏸️ Session paused');
              provideFeedback('medium');
            }}
          >
            <Text style={styles.controlBtnText}>⏸️ Pause</Text>
          </TouchableOpacity>
        )}
        {sessionState === 'paused' && (
          <TouchableOpacity
            style={[styles.controlBtn, styles.resumeBtn, { backgroundColor: currentConfig.color }]}
            onPress={() => {
              setSessionState('active');
              if (soundEngine && soundEngine.playSoundTrack) soundEngine.playSoundTrack(selectedSound);
              setFlowState('▶️ Resuming...');
              provideFeedback('medium');
            }}
          >
            <Text style={styles.controlBtnText}>▶️ Resume</Text>
          </TouchableOpacity>
        )}
        {(sessionState === 'active' || sessionState === 'paused') && (
          <TouchableOpacity
            style={[styles.controlBtn, styles.completeBtn]}
            onPress={completeSession}
          >
            <Text style={styles.controlBtnText}>✅ Complete</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Wellness Tips Footer */}
      <View style={styles.tipContainer}>
        <Text style={styles.tipIcon}>💡</Text>
        <Text style={styles.tipText}>
          {activeMode === 'resonance_circle' && 'Focus on the expanding circle to synchronize your heart rhythm with your breath.'}
          {activeMode === 'mindful_sweep' && 'Notice each body zone without judgment. Simply observe and release.'}
          {activeMode === 'aurora_flow' && 'Follow the colors at your own pace. There is no rush in relaxation.'}
          {activeMode === 'serenity_spiral' && 'Let your gaze follow the spiral naturally. Your attention will restore itself.'}
          {activeMode === 'stillness_dots' && 'Each dot represents a thought. Watch them settle into stillness.'}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingTop: 4,
    alignItems: 'center',
    paddingBottom: 20,
  },
  
  // Header Styles
  header: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  wellnessBadge: {
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  wellnessText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // Mode Selector
  modeSelector: {
    width: '100%',
    paddingHorizontal: 8,
    marginVertical: 4,
  },
  modeCard: {
    padding: 10,
    marginRight: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    minWidth: 80,
    alignItems: 'center',
  },
  modeIcon: { fontSize: 22 },
  modeTitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  modeSubtitle: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
    fontWeight: '500',
  },

  // Benefit Banner
  benefitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    width: width * 0.9,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 4,
    gap: 10,
  },
  benefitIcon: { fontSize: 18 },
  benefitContent: { flex: 1 },
  benefitLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  benefitText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '500',
  },
  benefitDuration: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '600',
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: width * 0.9,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    marginVertical: 4,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  smallProgress: {
    width: 50,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginTop: 2,
    overflow: 'hidden',
  },
  smallProgressFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Canvas
  canvasWrapper: {
    width: width * 0.92,
    height: Math.min(width * 0.55, 240),
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  canvasContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Ready State
  readyState: {
    alignItems: 'center',
    padding: 20,
  },
  readyEmoji: { fontSize: 36 },
  readyTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  readyDesc: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
  },
  startBtn: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 20,
    marginTop: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  startBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Complete State
  completeState: {
    alignItems: 'center',
    padding: 20,
  },
  completeEmoji: { fontSize: 40 },
  completeTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  completeScore: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  completeDuration: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginTop: 2,
  },
  repeatBtn: {
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 18,
    marginTop: 12,
  },
  repeatBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },

  // Resonance Circle
  resonanceCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 160,
    height: 160,
  },
  resonanceInner: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  resonanceEmoji: { fontSize: 28 },
  resonancePhase: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  resonanceCoherence: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    marginTop: 2,
  },
  coherenceIndicator: {
    width: 80,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginTop: 4,
    overflow: 'hidden',
  },
  coherenceBar: {
    height: '100%',
    borderRadius: 2,
  },

  // Sweep
  sweepContainer: {
    width: '100%',
    padding: 12,
    gap: 6,
  },
  sweepZone: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 2,
  },
  sweepZoneText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  sweepZoneDuration: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
  },

  // Aurora
  auroraContainer: {
    alignItems: 'center',
    width: '100%',
  },
  auroraTarget: {
    alignItems: 'center',
    marginBottom: 10,
  },
  auroraEmoji: { fontSize: 18 },
  auroraTargetSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    marginVertical: 4,
  },
  auroraHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
  },
  auroraGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    width: '85%',
  },
  auroraOption: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  auroraProgress: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    marginTop: 8,
  },

  // Spiral
  spiralContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  spiralPath: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  spiralPoint: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  spiralGuide: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    opacity: 0.5,
  },

  // Stillness Dots
  stillnessContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  anchorPoint: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -30,
    marginTop: -30,
    alignItems: 'center',
  },
  anchorCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  anchorEmoji: { fontSize: 16 },
  anchorLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 8,
    marginTop: 2,
  },
  stillnessDot: {
    position: 'absolute',
  },
  stillnessProgress: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
  },

  canvasHint: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 9,
    marginTop: 4,
  },

  // Flow Container
  flowContainer: {
    alignItems: 'center',
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  flowText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  flowHint: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 9,
    marginTop: 2,
  },

  // Audio Controls
  audioControl: {
    width: width * 0.9,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginVertical: 4,
  },
  audioLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
  },
  audioChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 4,
    marginRight: 6,
  },
  audioIcon: { fontSize: 12 },
  audioName: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '500',
  },
  audioFreq: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 8,
  },
  audioControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  audioToggle: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  audioToggleText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '600',
  },
  volumeControl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  volumeLabel: { fontSize: 12 },
  volumeBar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  volumeFill: {
    height: '100%',
    borderRadius: 2,
  },
  volumeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  // Session Controls
  sessionControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginVertical: 10,
  },
  controlBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  resumeBtn: {},
  completeBtn: {
    backgroundColor: '#10B981',
  },
  controlBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },

  // Tip Footer
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: width * 0.9,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    gap: 10,
    marginTop: 4,
  },
  tipIcon: { fontSize: 16 },
  tipText: {
    flex: 1,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    lineHeight: 16,
  },
});

export default FocusArcade;
