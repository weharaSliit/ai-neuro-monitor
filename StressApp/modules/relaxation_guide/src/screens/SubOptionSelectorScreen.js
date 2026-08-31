import React, { useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';

// Sub-option metadata
const SUB_OPTION_META = {
  water_lily_pond: {
    icon: '🪷',
    tag: 'Fast HRV Recovery',
    vagal: 'Vagal Boost',
    mechanism: '4-6 Deep Exhalations',
    accent: '#10B981',
    bg: 'rgba(16, 185, 129, 0.14)',
    glow: '#059669',
    badge: '🏆 TOP PICK'
  },
  cosmic_nebula: {
    icon: '🌌',
    tag: 'Starlight Pacing (6 bpm)',
    vagal: 'Heart Coherence',
    mechanism: 'Rhythmic Starlight',
    accent: '#A78BFA',
    bg: 'rgba(167, 139, 250, 0.14)',
    glow: '#8B5CF6',
    badge: '✨ RECOMMENDED'
  },
  flower_meadow: {
    icon: '🌸',
    tag: '4-7-8 Breathing Bloom',
    vagal: 'Heart Deceleration',
    mechanism: 'Extended Exhales',
    accent: '#EC4899',
    bg: 'rgba(236, 72, 153, 0.14)',
    glow: '#DB2777',
    badge: '🌸 POPULAR'
  },
  diaphragmatic_pace: {
    icon: '🫁',
    tag: 'Deep Belly Pacing',
    vagal: 'Pulse Reduction',
    mechanism: 'Deep Abdominal Respiration',
    accent: '#3B82F6',
    bg: 'rgba(59, 130, 246, 0.14)',
    glow: '#2563EB',
    badge: '🌿 DEEP CALM'
  },
  box_meditation: {
    icon: '🧊',
    tag: '4-4-4-4 Box Breathing',
    vagal: 'Equilibrium',
    mechanism: 'Equal Rhythm Breathing',
    accent: '#0EA5E9',
    bg: 'rgba(14, 165, 233, 0.14)',
    glow: '#0284C7',
    badge: '🧊 BALANCED'
  },
  progressive_muscle: {
    icon: '💪',
    tag: 'Muscle Tension Release',
    vagal: 'Somatic Release',
    mechanism: 'Tense & Release Cycling',
    accent: '#D97706',
    bg: 'rgba(217, 119, 6, 0.14)',
    glow: '#B45309',
    badge: '💪 RELIEF'
  },
  pattern_alignment: {
    icon: '🧠',
    tag: 'Memory Focus Match',
    vagal: 'Focus Reset',
    mechanism: 'Visual Pattern Matching',
    accent: '#7E57C2',
    bg: 'rgba(126, 87, 194, 0.14)',
    glow: '#5E35B1',
    badge: '🎯 FOCUS'
  },
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

  // Auto-redirect: each technique is now standalone, no sub-option selection needed
  useEffect(() => {
    if (currentRecommendation?.selected_sub_option) {
      setSelectedSubOption(currentRecommendation.selected_sub_option);
      setCurrentScreen('GamePlayer');
    }
  }, []);

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
      <Header title="Select Biofeedback Module" showBack onBack={() => setCurrentScreen('Intervention')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Header Recommendation Banner */}
          <View style={[styles.recBanner, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.bannerHeaderRow}>
              <Text style={[styles.recTag, { color: theme.accent }]}>🔬 EVIDENCE-BASED PHYSIOLOGICAL PROTOCOL</Text>
              <View style={[styles.livePill, { backgroundColor: 'rgba(16, 185, 129, 0.18)' }]}>
                <View style={styles.liveDot} />
                <Text style={styles.livePillTxt}>HRV RESONANT</Text>
              </View>
            </View>

            <Text style={[styles.heading, { color: theme.textPrimary }]}>{currentRecommendation.title}</Text>
            <Text style={[styles.sub, { color: theme.textMuted }]}>
              {currentRecommendation.reason || 'Select your targeted biofeedback technique below to initiate real-time HRV pacing and vagal nerve stimulation.'}
            </Text>
          </View>

          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
            Physiological Stress Relief Interventions ({currentRecommendation.available_sub_options?.length || 0})
          </Text>

          {currentRecommendation.available_sub_options.map((sub) => {
            const isSelected = selectedSubOption && selectedSubOption.id === sub.id;
            const meta = SUB_OPTION_META[sub.id] || {
              icon: '🧬',
              tag: 'Biofeedback Technique',
              vagal: 'ANS Recovery',
              mechanism: 'Autonomic Regulation',
              accent: theme.accent,
              bg: 'rgba(56, 189, 248, 0.12)',
              glow: theme.accent,
              badge: 'VALIDATED TECH'
            };

            return (
              <TouchableOpacity
                key={sub.id}
                style={[
                  styles.card,
                  { backgroundColor: theme.bgSecondary, borderColor: isSelected ? meta.accent : theme.border },
                  isSelected && { backgroundColor: meta.bg, borderColor: meta.accent }
                ]}
                onPress={() => handleSelect(sub)}
                activeOpacity={0.85}
              >
                {/* Left Colored Accent Indicator */}
                <View style={[styles.accentLine, { backgroundColor: meta.accent }]} />

                <View style={styles.cardInner}>
                  {/* Top Row: Icon + Title + Badge */}
                  <View style={styles.cardHeader}>
                    <View style={styles.titleRow}>
                      <View style={[styles.iconWrap, { backgroundColor: meta.bg, borderColor: meta.accent }]}>
                        <Text style={styles.iconTxt}>{meta.icon}</Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={styles.titleHeaderWrap}>
                          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{sub.title}</Text>
                          {isSelected && (
                            <View style={[styles.selectedBadge, { backgroundColor: meta.accent }]}>
                              <Text style={styles.selectedBadgeTxt}>ACTIVE</Text>
                            </View>
                          )}
                        </View>

                        <View style={styles.badgeRow}>
                          <View style={[styles.rankPill, { backgroundColor: meta.bg, borderColor: meta.accent }]}>
                            <Text style={[styles.rankPillTxt, { color: meta.accent }]}>{meta.badge}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>

                  <Text style={[styles.cardDesc, { color: theme.textSecondary }]}>{sub.description}</Text>

                  {/* Physiological Metrics Badges Row */}
                  <View style={styles.metricsRow}>
                    <View style={[styles.metricPill, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.metricTxt, { color: meta.accent }]}>⚡ {meta.vagal}</Text>
                    </View>
                    <View style={[styles.metricPill, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                      <Text style={[styles.metricTxt, { color: theme.textMuted }]}>🔬 {meta.mechanism}</Text>
                    </View>
                  </View>

                  {/* Bottom Action Footer */}
                  <View style={styles.cardFooter}>
                    <Text style={[styles.selectTxt, { color: meta.accent }]}>
                      ⚡ Start Biofeedback Session
                    </Text>
                    <View style={[styles.launchPill, { backgroundColor: meta.accent }]}>
                      <Text style={styles.launchPillTxt}>Launch →</Text>
                    </View>
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
    borderRadius: 20,
    borderWidth: 1.5,
    marginBottom: 20
  },
  bannerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  recTag: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5
  },
  livePillTxt: {
    fontSize: 8,
    fontWeight: '900',
    color: '#10B981',
    letterSpacing: 0.5
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
    marginBottom: 14
  },
  card: {
    borderRadius: 20,
    marginBottom: 16,
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
    padding: 15
  },
  cardHeader: {
    marginBottom: 8
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  iconTxt: {
    fontSize: 24
  },
  titleHeaderWrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '900',
    flex: 1
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 4
  },
  rankPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1
  },
  rankPillTxt: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  selectedBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginLeft: 6
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
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12
  },
  metricPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10
  },
  metricTxt: {
    fontSize: 10,
    fontWeight: '800'
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)'
  },
  selectTxt: {
    fontWeight: '800',
    fontSize: 12
  },
  launchPill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 10
  },
  launchPillTxt: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900'
  }
});
