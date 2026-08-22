import React, { useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Header } from '../components/Header';

export const SubOptionSelectorScreen = () => {
  const {
    currentRecommendation,
    selectedSubOption,
    setSelectedSubOption,
    setCurrentScreen
  } = useContext(AppContext);

  if (!currentRecommendation) return null;

  const handleSelect = (subOpt) => {
    setSelectedSubOption(subOpt);
    setCurrentScreen('GamePlayer');
  };

  return (
    <View style={styles.container}>
      <Header title="Select Game Scene" showBack onBack={() => setCurrentScreen('Intervention')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Choose Your Gamified Relaxation Scene</Text>
        <Text style={styles.sub}>
          Technique: {currentRecommendation.title}. Select your preferred sub-option scene below.
        </Text>

        {currentRecommendation.available_sub_options.map((sub) => {
          const isSelected = selectedSubOption && selectedSubOption.id === sub.id;
          return (
            <TouchableOpacity
              key={sub.id}
              style={[styles.card, isSelected && styles.cardSelected]}
              onPress={() => handleSelect(sub)}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, isSelected && styles.titleSelected]}>
                  {sub.title}
                </Text>
                {isSelected && <Text style={styles.badge}>PREFERRED DEFAULT</Text>}
              </View>
              <Text style={styles.cardDesc}>{sub.description}</Text>
              <Text style={styles.selectTxt}>Tap to Start Scene →</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  content: {
    padding: 16
  },
  heading: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4
  },
  sub: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 20
  },
  card: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#1E3A8A'
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700'
  },
  titleSelected: {
    color: '#38BDF8'
  },
  badge: {
    backgroundColor: '#38BDF8',
    color: '#0F172A',
    fontSize: 9,
    fontWeight: '800',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8
  },
  cardDesc: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 10
  },
  selectTxt: {
    color: '#38BDF8',
    fontWeight: '700',
    fontSize: 13
  }
});
