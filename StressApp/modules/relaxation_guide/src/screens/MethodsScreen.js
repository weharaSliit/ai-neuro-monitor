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
      title: "Guided Breathwork & Vagal Pacing",
      icon: "🧘‍♀️",
      sub_options: [
        { id: "water_lily_pond", title: "Lily Pond Diaphragmatic Exhale", description: "Rapid HRV recovery with 4-6 diaphragmatic exhalations (WESAD Rank #1)" },
        { id: "vagus_humming", title: "Vagal Humming Exhale", description: "Vagal nerve stimulation through resonant acoustic vibration (WESAD Rank #2)" },
        { id: "diaphragmatic_pace", title: "Deep Abdominal Pacing", description: "Slow phrenic nerve breathing for rapid pulse reduction (WESAD Rank #5)" },
        { id: "box_meditation", title: "Box Breathing (4-4-4-4)", description: "Structured 4-4-4-4 square respiration for ANS equilibrium (WESAD Rank #6)" }
      ]
    },
    {
      id: "breathing_garden",
      title: "Breathing Garden Resonant Pacing",
      icon: "🌸",
      sub_options: [
        { id: "cosmic_nebula", title: "Cosmic Nebula (6 bpm)", description: "0.1 Hz baroreflex starlight pacing for heart coherence (WESAD Rank #3)" },
        { id: "flower_meadow", title: "Flower Meadow (4-7-8)", description: "4-7-8 parasympathetic extended exhalation bloom (WESAD Rank #4)" }
      ]
    },
    {
      id: "cognitive_destress",
      title: "Cognitive & Somatic De-Stress Protocol",
      icon: "🌿",
      sub_options: [
        { id: "soft_fascination", title: "Nature Restoration Viewing", description: "Attention Restoration (ART) viewing for directed attention recovery (WESAD Rank #7)" },
        { id: "progressive_muscle", title: "Progressive Muscle Release", description: "Step-by-step somatic muscle tension release (WESAD Rank #8)" },
        { id: "guided_imagery", title: "Guided Forest Walk", description: "Multisensory forest imagery walk for limbic system calming (WESAD Rank #9)" },
        { id: "pattern_alignment", title: "Visuospatial Memory Alignment", description: "Attentional refocusing memory alignment to disrupt rumination loops (WESAD Rank #10)" }
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
      description: `Selected ${subOpt.title} from Biofeedback Catalog`,
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
      confirmButtonText: 'Start Session ⚡',
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
        <Text style={[styles.heading, { color: theme.textPrimary }]}>WESAD-Validated Biofeedback Catalog</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Explore all 10 physiological stress relief protocols. Calm AI verifies your live autonomic signals before launching to maximize vagal tone recovery.
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
                    <Text style={[styles.tryBtnTxt, { color: theme.accentText }]}>Start →</Text>
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
