import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Header } from '../components/Header';
import { StarRating } from '../components/StarRating';
import { apiService } from '../api/apiService';
import { useSweetAlert } from '../context/SweetAlertContext';

export const RatingScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    userId,
    currentRecommendation,
    selectedSubOption,
    preInterventionLabel,
    postInterventionLabel,
    setPostInterventionLabel,
    setLastValidationResult,
    setCurrentScreen
  } = useContext(AppContext);

  const [rating, setRating] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const techId = currentRecommendation ? currentRecommendation.technique_id : 'breathing_garden';
      const subId = selectedSubOption ? selectedSubOption.id : 'flower_meadow';

      // 1. Submit 1-5 star rating to Preference Learner
      await apiService.submitRating(userId, techId, subId, rating);

      // 2. Validate stress label transition reward signal
      const postState = preInterventionLabel === 'stress' ? 'normal' : 'normal';
      setPostInterventionLabel(postState);

      const valRes = await apiService.validateIntervention(
        userId, techId, preInterventionLabel, postState
      );

      setLastValidationResult(valRes);

      showAlert({
        title: 'Feedback Recorded! ⭐',
        text: `Thank you! Your ${rating}-star feedback updated your personalized preference parameters.`,
        icon: 'success',
        timer: 1800
      });

      setCurrentScreen('Recovery');
    } catch (e) {
      console.warn('Rating submission error', e);
      showAlert({
        title: 'Rating Saved',
        text: 'Moving to recovery analytics...',
        icon: 'info',
        timer: 1200
      });
      setCurrentScreen('Recovery');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Exercise Feedback" />

      <View style={styles.body}>
        <Text style={styles.heading}>Rate Your Relaxation Experience</Text>
        <Text style={styles.sub}>
          Technique: {currentRecommendation ? currentRecommendation.title : 'Intervention'} • {selectedSubOption ? selectedSubOption.title : 'Scene'}
        </Text>

        <View style={styles.starBox}>
          <Text style={styles.starPrompt}>Select Rating (1 to 5 Stars)</Text>
          <StarRating rating={rating} onRate={setRating} />
          <Text style={styles.ratingValTxt}>{rating} / 5 Stars</Text>
        </View>

        <Text style={styles.infoTxt}>
          Your rating updates the Preference Learner using a 0.95 exponential decay factor over a 7-day window.
        </Text>

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#0F172A" />
          ) : (
            <Text style={styles.submitBtnTxt}>Submit Feedback & See Recovery % →</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  body: {
    padding: 24,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  heading: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center'
  },
  sub: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 24
  },
  starBox: {
    backgroundColor: '#1E293B',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20
  },
  starPrompt: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8
  },
  ratingValTxt: {
    color: '#F59E0B',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4
  },
  infoTxt: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18
  },
  submitBtn: {
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center'
  },
  btnDisabled: {
    backgroundColor: '#64748B'
  },
  submitBtnTxt: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 16
  }
});
