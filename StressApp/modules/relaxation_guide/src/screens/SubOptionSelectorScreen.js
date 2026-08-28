import React, { useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Easing } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';

// Game sub-option icons and visual theme metadata (WESAD Rank #1 to #10 Priority Order)
const SUB_OPTION_META = {
  // Rank #1 Priority
  water_lily_pond: { icon: '🪷', tag: 'Rank #1 · 100% Recovery (89s)', accent: '#10B981', bg: 'rgba(16, 185, 129, 0.14)', priority: 'TOP PRIORITY #1' },
  // Rank #2 Priority
  vagus_humming: { icon: '🧘‍♀️', tag: 'Rank #2 · Vagal Nerve Resonant Exhale', accent: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.14)', priority: 'PRIORITY #2' },
  // Rank #3 Priority
  cosmic_nebula: { icon: '🌌', tag: 'Rank #3 · 6bpm Resonance Frequency', accent: '#A78BFA', bg: 'rgba(167, 139, 250, 0.14)', priority: 'PRIORITY #3' },
  // Rank #4 Priority
  flower_meadow: { icon: '🌺', tag: 'Rank #4 · 4-7-8 Parasympathetic Bloom', accent: '#EC4899', bg: 'rgba(236, 72, 153, 0.14)', priority: 'PRIORITY #4' },
  // Rank #5 Priority
  diaphragmatic_pace: { icon: '🫁', tag: 'Rank #5 · Deep Abdominal Pacing', accent: '#3B82F6', bg: 'rgba(59, 130, 246, 0.14)', priority: 'PRIORITY #5' },
  // Rank #6 Priority
  box_meditation: { icon: '📦', tag: 'Rank #6 · 4-4-4-4 Square Pacing', accent: '#38BDF8', bg: 'rgba(56, 189, 248, 0.14)', priority: 'PRIORITY #6' },
  // Rank #7 Priority
  soft_fascination: { icon: '🌿', tag: 'Rank #7 · Biophilic Attention Restoration', accent: '#059669', bg: 'rgba(5, 150, 105, 0.14)', priority: 'PRIORITY #7' },
  // Rank #8 Priority
  progressive_muscle: { icon: '🦾', tag: 'Rank #8 · Somatic Tension Discharge', accent: '#D97706', bg: 'rgba(217, 119, 6, 0.14)', priority: 'PRIORITY #8' },
  // Rank #9 Priority
  guided_imagery: { icon: '🌲', tag: 'Rank #9 · Forest Trail Imagery Walk', accent: '#047857', bg: 'rgba(4, 120, 87, 0.14)', priority: 'PRIORITY #9' },
  // Rank #10 Priority
  pattern_alignment: { icon: '🧩', tag: 'Rank #10 · Visuospatial Memory Alignment', accent: '#7E57C2', bg: 'rgba(126, 87, 194, 0.14)', priority: 'PRIORITY #10' },
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
