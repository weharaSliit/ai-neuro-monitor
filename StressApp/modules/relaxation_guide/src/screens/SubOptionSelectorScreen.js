import React, { useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { AmbientBackground } from '../components/AmbientBackground';

const SIMPLE_SUB_META = {
  flower_meadow: { icon: '🌸', title: 'Calm Meadow', tag: 'Garden Bloom', accent: '#EC4899', badge: '🌸 POPULAR' },
  breathing_garden: { icon: '🌸', title: 'Calm Meadow', tag: 'Garden Bloom', accent: '#EC4899', badge: '🌸 POPULAR' },
  water_lily_pond: { icon: '🪷', title: 'Zen Lily Pond', tag: 'Breathe & Float', accent: '#10B981', badge: '⭐ TOP PICK' },
  box_meditation: { icon: '🧊', title: 'Focus Box', tag: 'Square Rhythm', accent: '#0EA5E9', badge: '🧊 BALANCED' },
  guided_meditation: { icon: '🧊', title: 'Focus Box', tag: 'Square Rhythm', accent: '#0EA5E9', badge: '🧊 BALANCED' },
  diaphragmatic_pace: { icon: '🫁', title: 'Deep Belly Calm', tag: 'Relax Body', accent: '#3B82F6', badge: '🌿 DEEP CALM' },
  pattern_alignment: { icon: '🧩', title: 'Color Match', tag: 'Brain Puzzle', accent: '#F59E0B', badge: '🎯 FOCUS' },
  body_scan_mindful: { icon: '🧘‍♂️', title: 'Body Sweep', tag: 'Release Tension', accent: '#8B5CF6', badge: '🧘 MINDFUL' },
  autogenic_warmth: { icon: '🔥', title: 'Warmth Flow', tag: 'Thermal Warmth', accent: '#EF4444', badge: '🔥 THERMAL' },
  stroop_decoupler: { icon: '🎯', title: 'Color Clash', tag: 'Quick Focus', accent: '#06B6D4', badge: '🎯 RAPID' },
  pmr_crystal_squeeze: { icon: '💎', title: 'Somatic PMR', tag: 'Muscle Iso-Tension', accent: '#EC4899', badge: '💎 SOMATIC' },
  progressive_muscle: { icon: '💎', title: 'Somatic PMR', tag: 'Muscle Iso-Tension', accent: '#EC4899', badge: '💎 SOMATIC' },
  emdr_saccadic_trace: { icon: '✨', title: 'Cosmic Trace', tag: 'EMDR Saccadic', accent: '#38BDF8', badge: '✨ COSMIC' },
  cosmic_nebula: { icon: '✨', title: 'Cosmic Trace', tag: 'EMDR Saccadic', accent: '#38BDF8', badge: '✨ COSMIC' },
  galvanic_biofeedback_flow: { icon: '💧', title: 'Bio GSR Pool', tag: 'GSR Fluid Biofeedback', accent: '#06B6D4', badge: '💧 BIOFEEDBACK' },
};

export const SubOptionSelectorScreen = () => {
  const {
    currentRecommendation,
    selectedSubOption,
    setSelectedSubOption,
    setCurrentScreen
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);

  const fadeAnim = useRef(new Animated.Value(0)).current;


  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  if (!currentRecommendation) return null;

  const handleSelect = (subOpt) => {
    setSelectedSubOption(subOpt);
    setCurrentScreen('GamePlayer');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <AmbientBackground />
      <Header title="Select Relaxation Game" showBack onBack={() => setCurrentScreen('Intervention')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={[styles.heading, { color: theme.textPrimary }]}>Choose a Mode</Text>

          {currentRecommendation.available_sub_options.map((sub) => {
            const meta = SIMPLE_SUB_META[sub.id] || {
              icon: '🎮',
              title: sub.title,
              tag: 'Relaxation Game',
              accent: theme.accent,
              badge: '⭐ FEATURED'
            };

            return (
              <TouchableOpacity
                key={sub.id}
                style={[
                  styles.card,
                  { backgroundColor: theme.bgSecondary, borderColor: meta.accent }
                ]}
                onPress={() => handleSelect(sub)}
                activeOpacity={0.85}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.iconTxt}>{meta.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{meta.title}</Text>
                    <Text style={[styles.cardTag, { color: meta.accent }]}>{meta.tag}</Text>
                  </View>
                  <View style={[styles.launchPill, { backgroundColor: meta.accent }]}>
                    <Text style={styles.launchPillTxt}>Play ▶</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    padding: 16,
    paddingBottom: 85,
  },
  heading: {
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 16
  },
  card: {
    borderRadius: 20,
    marginBottom: 14,
    borderWidth: 2,
    padding: 16,
    elevation: 3
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  iconTxt: {
    fontSize: 32,
    marginRight: 14
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '900'
  },
  cardTag: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2
  },
  launchPill: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  launchPillTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900'
  }
});

export default SubOptionSelectorScreen;
