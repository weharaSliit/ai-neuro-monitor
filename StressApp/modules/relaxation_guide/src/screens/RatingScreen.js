import React, { useState, useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Easing, ScrollView } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';
import { useSweetAlert } from '../context/SweetAlertContext';
import { AmbientBackground } from '../components/AmbientBackground';

const MOOD_OPTIONS = [
  { emoji: '😔', label: 'No help', rating: 1, xp: 50 },
  { emoji: '😐', label: 'Slight relief', rating: 2, xp: 100 },
  { emoji: '🙂', label: 'Better', rating: 3, xp: 150 },
  { emoji: '😊', label: 'Much better', rating: 4, xp: 200 },
  { emoji: '🤩', label: 'Amazing!', rating: 5, xp: 300 },
];

export const RatingScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    userId, currentRecommendation, selectedSubOption,
    preInterventionLabel, setPostInterventionLabel,
    setLastValidationResult, setCurrentScreen, setHistoryList
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [rating, setRating] = useState(4);
  const [submitting, setSubmitting] = useState(false);

  const starScales = MOOD_OPTIONS.map(() => useRef(new Animated.Value(1)).current);
  const pulseAnim  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const selectMood = (r, idx) => {
    setRating(r);
    Animated.sequence([
      Animated.spring(starScales[idx], { toValue: 1.4, tension: 300, friction: 6, useNativeDriver: true }),
      Animated.spring(starScales[idx], { toValue: 1, tension: 300, friction: 8, useNativeDriver: true }),
    ]).start();
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      showAlert({ title: 'Please Rate', text: 'Select how you felt after playing.', icon: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      const techId = currentRecommendation?.technique_id || selectedSubOption?.id || 'water_lily_pond';
      const subId  = selectedSubOption?.id || techId;
      await apiService.submitRating(userId, techId, subId, rating);
      
      let postState = rating <= 2 ? (preInterventionLabel || 'stress') : 'normal';
      setPostInterventionLabel(postState);

      const clusterId = currentRecommendation?.context_cluster_id ?? 0;
      const valRes = await apiService.validateIntervention(userId, techId, preInterventionLabel, postState, clusterId, rating);
      setLastValidationResult(valRes);

      // Record session dynamically into AppContext history
      const newEntry = {
        id: `sess_${Date.now()}`,
        timestamp: Date.now() / 1000,
        technique_id: techId,
        sub_option_id: subId,
        pre_label: preInterventionLabel || 'stress',
        post_label: postState,
        recovery_pct: valRes?.recovery_percentage ?? (rating >= 4 ? 98 : rating >= 3 ? 92 : 60),
        reward: valRes?.reward ?? (rating >= 3 ? 1.0 : 0.4),
        star_rating: rating
      };
      setHistoryList(prev => [newEntry, ...(prev || [])]);

      setCurrentScreen('PerformanceOverview');
    } catch (e) {
      setCurrentScreen('PerformanceOverview');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedOption = MOOD_OPTIONS.find(m => m.rating === rating);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <AmbientBackground />
      <Header title="Level Victory!" />

      <ScrollView contentContainerStyle={styles.body}>
        {/* Victory Trophy Badge */}
        <View style={styles.trophyCard}>
          <Text style={styles.trophyEmoji}>🏆</Text>
          <Text style={styles.victoryTitle}>LEVEL COMPLETED!</Text>
          <Text style={styles.victorySub}>How do you feel after this session?</Text>
        </View>

        {/* Rating Mood Options */}
        <View style={styles.moodGrid}>
          {MOOD_OPTIONS.map((opt, idx) => {
            const isSelected = rating === opt.rating;
            return (
              <TouchableOpacity
                key={opt.rating}
                style={[
                  styles.moodCard,
                  { backgroundColor: theme.bgSecondary, borderColor: isSelected ? '#F59E0B' : theme.border },
                  isSelected && styles.moodCardSelected
                ]}
                onPress={() => selectMood(opt.rating, idx)}
                activeOpacity={0.8}
              >
                <Animated.Text style={[styles.moodEmoji, { transform: [{ scale: starScales[idx] }] }]}>
                  {opt.emoji}
                </Animated.Text>
                <Text style={[styles.moodLabel, { color: isSelected ? '#F59E0B' : theme.textPrimary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Reward XP Banner */}
        {selectedOption && (
          <View style={styles.xpBanner}>
            <Text style={styles.xpTxt}>⭐ +{selectedOption.xp} CALM XP EARNED!</Text>
          </View>
        )}

        {/* Submit Claim Button */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
          <TouchableOpacity
            style={styles.claimBtn}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.claimBtnTxt}>Claim Rewards & Finish ▶</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    padding: 20,
    alignItems: 'center',
  },
  trophyCard: {
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 10,
  },
  trophyEmoji: {
    fontSize: 72,
    marginBottom: 8,
  },
  victoryTitle: {
    color: '#F59E0B',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  victorySub: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24,
  },
  moodCard: {
    width: 62,
    height: 80,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  moodCardSelected: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    elevation: 6,
  },
  moodEmoji: {
    fontSize: 30,
    marginBottom: 4,
  },
  moodLabel: {
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
  },
  xpBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F59E0B',
    marginBottom: 24,
  },
  xpTxt: {
    color: '#F59E0B',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  claimBtn: {
    backgroundColor: '#10B981',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 22,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#A7F3D0',
    elevation: 8,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  claimBtnTxt: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});

export default RatingScreen;
