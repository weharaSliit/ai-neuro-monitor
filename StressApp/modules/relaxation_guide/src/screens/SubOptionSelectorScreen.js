import React, { useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Easing } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';

// Game sub-option icons and visual theme metadata
const SUB_OPTION_META = {
  // Focus Arcade
  resonance_circle: { icon: '🔄', tag: 'Heart Rhythm Coherence', accent: '#60A5FA', bg: 'rgba(96, 165, 250, 0.12)' },
  mindful_sweep: { icon: '🧠', tag: 'Attention Scanning', accent: '#34D399', bg: 'rgba(52, 211, 153, 0.12)' },
  serenity_spiral: { icon: '🌀', tag: 'Visual Flow State', accent: '#FBBF24', bg: 'rgba(251, 191, 36, 0.12)' },

  // Guided Meditation & Breathwork
  box_meditation: { icon: '📦', tag: '4-4-4-4 Rhythm', accent: '#38BDF8', bg: 'rgba(56, 189, 248, 0.12)' },
  chakra_harmonizer: { icon: '✨', tag: 'Energy Alignment', accent: '#EC4899', bg: 'rgba(236, 72, 153, 0.12)' },
  silent_zen_timer: { icon: '🔔', tag: 'Minimalist Zen Timer', accent: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },

  // Nature Sensory Environments
  rain_scene: { icon: '🌧️', tag: 'Raindrops & Ripples', accent: '#0284C7', bg: 'rgba(2, 132, 199, 0.12)' },
  forest_scene: { icon: '🌲', tag: 'Firefly Forest', accent: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
  ocean_scene: { icon: '🌊', tag: 'Deep Ocean Waves', accent: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' },

  // Breathing Garden
  flower_meadow: { icon: '🌺', tag: 'Bloom Garden · 4-7-8 Breath', accent: '#EC4899', bg: 'rgba(236, 72, 153, 0.12)' },
  water_lily_pond: { icon: '🪷', tag: 'Koi Pond & Lilies', accent: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.12)' },
  cosmic_nebula: { icon: '🌌', tag: 'Star Dust Expansion', accent: '#A78BFA', bg: 'rgba(167, 139, 250, 0.12)' },

  // Cognitive De-Stress Arcade
  muscle: { icon: '🧘', tag: 'Progressive Muscle Relaxation', accent: '#D97706', bg: 'rgba(217, 119, 6, 0.12)' },
  pattern: { icon: '🧩', tag: 'Pattern Alignment (Visuospatial)', accent: '#7E57C2', bg: 'rgba(126, 87, 194, 0.12)' },
  nature: { icon: '🌿', tag: 'Soft Fascination Nature Viewing', accent: '#2E7D5B', bg: 'rgba(46, 125, 91, 0.12)' },
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
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true })
    ]).start();
  }, []);

  if (!currentRecommendation) return null;

  const handleSelect = (subOpt) => {
    setSelectedSubOption(subOpt);
    setCurrentScreen('GamePlayer');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Select Game Scene" showBack onBack={() => setCurrentScreen('Intervention')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Header Recommendation Banner */}
          <View style={[styles.recBanner, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <Text style={[styles.recTag, { color: theme.accent }]}>RECOMMENDED CATEGORY</Text>
            <Text style={[styles.heading, { color: theme.textPrimary }]}>{currentRecommendation.title}</Text>
            <Text style={[styles.sub, { color: theme.textMuted }]}>
              {currentRecommendation.reason || 'Select your preferred interactive sub-option game scene below to begin your session.'}
            </Text>
          </View>

          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Available Sub-Option Games ({currentRecommendation.available_sub_options?.length || 0})</Text>

          {currentRecommendation.available_sub_options.map((sub) => {
            const isSelected = selectedSubOption && selectedSubOption.id === sub.id;
            const meta = SUB_OPTION_META[sub.id] || { icon: '🎮', tag: 'Interactive Game', accent: theme.accent, bg: 'rgba(56, 189, 248, 0.12)' };

            return (
              <TouchableOpacity
                key={sub.id}
                style={[
                  styles.card,
                  { backgroundColor: theme.bgSecondary, borderColor: isSelected ? meta.accent : theme.border },
                  isSelected && { backgroundColor: meta.bg }
                ]}
                onPress={() => handleSelect(sub)}
                activeOpacity={0.8}
              >
                {/* Left Colored Accent Indicator */}
                <View style={[styles.accentLine, { backgroundColor: meta.accent }]} />

                <View style={styles.cardInner}>
                  {/* Top Row: Icon + Title + Badge */}
                  <View style={styles.cardHeader}>
                    <View style={styles.titleRow}>
                      <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}>
                        <Text style={styles.iconTxt}>{meta.icon}</Text>
                      </View>
                      <View>
                        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{sub.title}</Text>
                        <View style={[styles.tagPill, { backgroundColor: meta.bg }]}>
                          <Text style={[styles.tagTxt, { color: meta.accent }]}>✨ {meta.tag}</Text>
                        </View>
                      </View>
                    </View>

                    {isSelected && (
                      <View style={[styles.selectedBadge, { backgroundColor: meta.accent }]}>
                        <Text style={styles.selectedBadgeTxt}>SELECTED</Text>
                      </View>
                    )}
                  </View>

                  <Text style={[styles.cardDesc, { color: theme.textSecondary }]}>{sub.description}</Text>

                  {/* Bottom Action Footer */}
                  <View style={styles.cardFooter}>
                    <Text style={[styles.selectTxt, { color: meta.accent }]}>Tap to Launch Scene →</Text>
                    <Text style={[styles.playBtnIcon, { color: meta.accent }]}>▶️</Text>
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
    padding: 16
  },
  recBanner: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 18
  },
  recTag: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: 'uppercase'
  },
  heading: {
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 6
  },
  sub: {
    fontSize: 12,
    lineHeight: 18
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12
  },
  card: {
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1.5,
    flexDirection: 'row',
    overflow: 'hidden',
    elevation: 3
  },
  accentLine: {
    width: 6
  },
  cardInner: {
    flex: 1,
    padding: 14
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10
  },
  iconTxt: {
    fontSize: 22
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  tagPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4
  },
  tagTxt: {
    fontSize: 9,
    fontWeight: '800'
  },
  selectedBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10
  },
  selectedBadgeTxt: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  cardDesc: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)'
  },
  selectTxt: {
    fontWeight: '800',
    fontSize: 12
  },
  playBtnIcon: {
    fontSize: 12
  }
});
