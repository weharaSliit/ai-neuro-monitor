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
      title: "Breathwork & Meditation",
      icon: "🧘‍♀️",
      sub_options: [
        { id: "water_lily_pond", title: "Lily Pond Breathing", description: "Deep breathing with water lilies." },
        { id: "vagus_humming", title: "Humming Exhale", description: "Humming to lower stress quickly." },
        { id: "diaphragmatic_pace", title: "Deep Belly Breathing", description: "Deep belly breathing for quick calm." },
        { id: "box_meditation", title: "Box Breathing", description: "4-4-4-4 rhythm for balance." }
      ]
    },
    {
      id: "breathing_garden",
      title: "Breathing Garden",
      icon: "🌸",
      sub_options: [
        { id: "cosmic_nebula", title: "Cosmic Nebula", description: "Starlight breathing rhythm." },
        { id: "flower_meadow", title: "Flower Meadow", description: "4-7-8 breathing with flowers." }
      ]
    },
    {
      id: "cognitive_destress",
      title: "Quick Relief",
      icon: "🌿",
      sub_options: [
        { id: "soft_fascination", title: "Nature Scenery", description: "Calming nature scenery." },
        { id: "progressive_muscle", title: "Muscle Release", description: "Release body muscle tension." },
        { id: "guided_imagery", title: "Forest Walk", description: "Peaceful forest walk imagery." },
        { id: "pattern_alignment", title: "Memory Match", description: "Fun pattern match for focus." }
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
      description: `Selected ${subOpt.title} from Catalog`,
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
      <Header title="Relaxation Catalog" showBack onBack={() => setCurrentScreen('Dashboard')} />

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
        <Text style={[styles.heading, { color: theme.textPrimary }]}>Relaxation Catalog</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Choose an exercise to start relaxing.
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
