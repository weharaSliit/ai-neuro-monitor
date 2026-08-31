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

  const techniques = [
    {
      id: 'water_lily_pond',
      title: 'Lily Pond Breathing',
      icon: '🪷',
      description: 'Extended exhale pacing synced with water lilies to lower stress.',
      color: '#10B981'
    },
    {
      id: 'diaphragmatic_pace',
      title: 'Deep Belly Pacing',
      icon: '🫁',
      description: 'Deep abdominal lower-lobe lung expansion for rapid pulse reduction.',
      color: '#0284C7'
    },
    {
      id: 'box_meditation',
      title: 'Box Breathing',
      icon: '🧊',
      description: 'Equal 4s square breathing rhythm for tactical calm and focus.',
      color: '#38BDF8'
    },
    {
      id: 'pattern_alignment',
      title: 'Memory Match',
      icon: '🧩',
      description: 'Tactile color pattern puzzle to clear intrusive worry and refocus.',
      color: '#F59E0B'
    },
    {
      id: 'body_scan_mindful',
      title: 'Mindful Body Scan',
      icon: '🧘‍♂️',
      description: 'Interactive anatomical body map to release muscle tension.',
      color: '#3B82F6'
    },
    {
      id: 'autogenic_warmth',
      title: 'Autogenic Thermal Focus',
      icon: '🔥',
      description: 'Vascular somatosensory focus to open blood flow and relax body.',
      color: '#EF4444'
    },
    {
      id: 'flower_meadow',
      title: 'Flower Meadow Garden Bloom',
      icon: '🌸',
      description: 'Interactive floral garden bloom entrainment for biophilic attention restoration (0.97 WESAD score).',
      color: '#F472B6'
    },
    {
      id: 'stroop_decoupler',
      title: 'Stroop Cognitive Decoupler',
      icon: '🎯',
      description: 'High-speed cognitive refocusing puzzle suppressing DMN rumination (0.95 WESAD recovery rating).',
      color: '#3B82F6'
    },
  ];

  const launchTechnique = (tech) => {
    setPreInterventionLabel(stressState);
    const subOpt = { id: tech.id, title: tech.title, description: tech.description };
    setSelectedSubOption(subOpt);
    setCurrentRecommendation({
      technique_id: tech.id,
      title: tech.title,
      description: tech.description,
      selected_sub_option: subOpt,
      available_sub_options: [subOpt],
      context_cluster_id: 1,
      blended_score: 0.95,
      physiological_sample: 0.95,
      preference_score: 0.95,
      execution_time_ms: 10.0
    });
    setCurrentScreen('GamePlayer');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Relaxation Catalog" showBack onBack={() => setCurrentScreen('Dashboard')} />

      <ScrollView contentContainerStyle={styles.content}>
        {techniques.map((tech) => (
          <TouchableOpacity
            key={tech.id}
            style={[styles.techCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border, borderLeftColor: tech.color, borderLeftWidth: 4 }]}
            onPress={() => launchTechnique(tech)}
            activeOpacity={0.85}
          >
            <View style={styles.techRow}>
              <Text style={styles.techIcon}>{tech.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.techTitle, { color: theme.textPrimary }]}>{tech.title}</Text>
                <Text style={[styles.techDesc, { color: theme.textMuted }]}>{tech.description}</Text>
              </View>
              <Text style={{ fontSize: 16, color: tech.color, marginLeft: 6 }}>▶</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  techCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    elevation: 2,
  },
  techRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  techIcon: {
    fontSize: 28,
  },
  techTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  techDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
});

export default MethodsScreen;
