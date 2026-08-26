import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { SuitabilityModal } from '../components/SuitabilityModal';
import { apiService } from '../api/apiService';
import { useSweetAlert } from '../context/SweetAlertContext';

export const MethodsScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    userId,
    stressState,
    stressProbability,
    setCurrentScreen,
    setCurrentRecommendation,
    setSelectedSubOption,
    setPreInterventionLabel
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);
  const [loadingId, setLoadingId] = useState(null);
  const [modalData, setModalData] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingSubOption, setPendingSubOption] = useState(null);

  const categories = [
    {
      id: "guided_meditation",
      title: "Guided Meditation & Breathwork",
      icon: "🧘",
      sub_options: [
        { id: "box_meditation", title: "Box Meditation", description: "Structured 4-4-4-4 visual pacing for rapid calm." },
        { id: "zen_body_scan", title: "Zen Body Scan", description: "Mindful muscle relaxation with expanding aura visuals." },
        { id: "chakra_meditation", title: "Chakra Harmonizer", description: "432Hz & 528Hz frequency alignment for mental focus." },
        { id: "transcendental_mind", title: "Silent Zen Timer", description: "Minimalist meditation timer with periodic bells." },
        { id: "sound_meditation", title: "Acoustic Meditation", description: "Resonant soundscape meditation for presence." }
      ]
    },
    {
      id: "focus_arcade",
      title: "Focus & Flow Arcade",
      icon: "🎮",
      sub_options: [
        { id: "resonance_circle", title: "Resonance Circle", description: "Visual biofeedback for heart rate variability training using paced resonance." },
        { id: "mindful_sweep", title: "Mindful Sweep", description: "Gentle attention guidance through body awareness zones." },
        { id: "aurora_flow", title: "Aurora Flow", description: "Paced color transition training for parasympathetic activation." },
        { id: "serenity_spiral", title: "Serenity Spiral", description: "Calming spiral meditation for attention restoration therapy." },
        { id: "stillness_dots", title: "Stillness Dots", description: "Visual anchoring technique for attention stabilization." }
      ]
    },
    {
      id: "adaptive_environment",
      title: "Adaptive Ambient Soundscapes",
      icon: "🌧️",
      sub_options: [
        { id: "gentle_rain", title: "Gentle Rain Acoustics", description: "Real-time synthesized raindrops." },
        { id: "ocean_waves", title: "Ocean Tides", description: "Low frequency binaural wave rhythm." },
        { id: "forest_stream", title: "Forest Stream", description: "Chirping acoustics and water soundscape." },
        { id: "healing_tones", title: "432Hz Healing Tones", description: "Deep harmonic meditation frequency." }
      ]
    },
    {
      id: "breathing_garden",
      title: "Breathing Garden",
      icon: "🌸",
      sub_options: [
        { id: "flower_meadow", title: "Bloom Garden", description: "Guided 4-7-8 breath relaxation with living garden ecosystem." },
        { id: "lotus_breath", title: "Lotus Cycle", description: "Rhythmic lotus petal breath syncing." },
        { id: "zen_garden", title: "Zen Garden Rake", description: "Interactive sand rake breathing focus." }
      ]
    },
    {
      id: "cognitive_destress",
      title: "Cognitive Destress & Fidget",
      icon: "🧩",
      sub_options: [
        { id: "bubble_pop", title: "Zen Bubble Pop", description: "Tactile bubble tension release." },
        { id: "pattern_align", title: "Pattern Alignment", description: "Mindful geometric alignment." },
        { id: "stress_shatter", title: "Stress Release Shatter", description: "Touch glass shatter physics." },
        { id: "cloud_float", title: "Cloud Floating", description: "Drifting cloud steering." },
        { id: "sand_drop", title: "Cascade Sand", description: "Flowing sand physics focus." }
      ]
    }
  ];

  const handleTryMethod = async (cat, subOpt) => {
    setLoadingId(subOpt.id);
    setPreInterventionLabel(stressState);
    try {
      // Run Smart Suitability Checker
      const suit = await apiService.checkSuitability(userId, cat.id, stressState, stressProbability);
      setPendingSubOption({ category: cat, subOpt });

      if (!suit.is_suitable) {
        setModalData(suit);
        setModalVisible(true);
      } else {
        launchGame(cat, subOpt);
      }
    } catch (e) {
      launchGame(cat, subOpt);
    } finally {
      setLoadingId(null);
    }
  };

  const launchGame = (cat, subOpt) => {
    setSelectedSubOption(subOpt);
    setCurrentRecommendation({
      technique_id: cat.id,
      title: cat.title,
      description: `Selected ${subOpt.title} from Relaxation Catalog`,
      selected_sub_option: subOpt,
      available_sub_options: cat.sub_options,
      context_cluster_id: 1,
      blended_score: 0.85,
      physiological_sample: 0.8,
      preference_score: 0.9,
      execution_time_ms: 10.0
    });

    showAlert({
      title: `Launching ${subOpt.title} ${cat.icon}`,
      text: subOpt.description,
      icon: 'info',
      confirmButtonText: 'Play Session ▶️',
      onConfirm: () => setCurrentScreen('GamePlayer')
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Relaxation Methods Catalog" showBack onBack={() => setCurrentScreen('Dashboard')} />

      <SuitabilityModal
        visible={modalVisible}
        data={modalData}
        onProceed={() => {
          setModalVisible(false);
          if (pendingSubOption) launchGame(pendingSubOption.category, pendingSubOption.subOpt);
        }}
        onSwitch={() => {
          setModalVisible(false);
          // Switch to recommended Breathing Garden
          launchGame(categories[1], categories[1].sub_options[0]);
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.heading, { color: theme.textPrimary }]}>All 15 Relaxation Techniques</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Explore our full catalog. Calm AI checks your live physiological signals before launching to ensure optimal vagus recovery.
        </Text>

        {categories.map((cat) => (
          <View key={cat.id} style={[styles.catCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.catHeader}>
              <Text style={styles.catIcon}>{cat.icon}</Text>
              <Text style={[styles.catTitle, { color: theme.textPrimary }]}>{cat.title}</Text>
            </View>

            {cat.sub_options.map((sub) => (
              <View key={sub.id} style={[styles.subRow, { backgroundColor: theme.bgPrimary }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.subTitle, { color: theme.textPrimary }]}>{sub.title}</Text>
                  <Text style={[styles.subDesc, { color: theme.textMuted }]}>{sub.description}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.tryBtn, { backgroundColor: theme.accent }]}
                  onPress={() => handleTryMethod(cat, sub)}
                  disabled={loadingId === sub.id}
                >
                  {loadingId === sub.id ? (
                    <ActivityIndicator size="small" color={theme.accentText} />
                  ) : (
                    <Text style={[styles.tryBtnTxt, { color: theme.accentText }]}>Try →</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ))}
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
  heading: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4
  },
  sub: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16
  },
  catCard: {
    padding: 14,
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1
  },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10
  },
  catIcon: {
    fontSize: 22,
    marginRight: 8
  },
  catTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    marginBottom: 6
  },
  subTitle: {
    fontSize: 13,
    fontWeight: '700'
  },
  subDesc: {
    fontSize: 11,
    marginTop: 2
  },
  tryBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginLeft: 8
  },
  tryBtnTxt: {
    fontSize: 12,
    fontWeight: '800'
  }
});
