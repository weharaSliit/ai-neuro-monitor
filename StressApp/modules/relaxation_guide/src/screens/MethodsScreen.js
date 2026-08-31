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
      description: 'Systematic attentional sweep across body regions to drop tension.',
      color: '#3B82F6'
    },
    {
      id: 'autogenic_warmth',
      title: 'Autogenic Thermal Focus',
      icon: '🔥',
      description: 'Somatosensory thermal warmth focus for deep body relaxation.',
      color: '#EF4444'
    },
    {
      id: 'silent_zen_timer',
      title: 'Silent Zen Presence',
      icon: '⛩️',
      description: 'Unguided silent presence meditation with peaceful chime intervals.',
      color: '#14B8A6'
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
      blended_score: 0.85,
      physiological_sample: 0.8,
      preference_score: 0.9,
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
    flex: 1
  },
  content: {
    padding: 16,
    gap: 8
  },
  techCard: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  techRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  techIcon: {
    fontSize: 24
  },
  techTitle: {
    fontSize: 14,
    fontWeight: '700'
  },
  techDesc: {
    fontSize: 12,
    marginTop: 2
  },
  badgePill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1
  },
  badgeTxt: {
    fontSize: 10,
    fontWeight: '800'
  },
  evidenceTxt: {
    fontSize: 10,
    marginTop: 4,
    fontStyle: 'italic'
  }
});
