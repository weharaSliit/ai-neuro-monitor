import React, { useState, useContext, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Easing, ScrollView } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { StarRating } from '../components/StarRating';
import { apiService } from '../api/apiService';
import { useSweetAlert } from '../context/SweetAlertContext';

const MOOD_OPTIONS = [
  { emoji: '😔', label: 'No help', rating: 1 },
  { emoji: '😐', label: 'Slight relief', rating: 2 },
  { emoji: '🙂', label: 'Better', rating: 3 },
  { emoji: '😊', label: 'Much better', rating: 4 },
  { emoji: '🤩', label: 'Amazing!', rating: 5 },
];

export const RatingScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    userId, currentRecommendation, selectedSubOption,
    preInterventionLabel, setPostInterventionLabel,
    setLastValidationResult, setBaselineNotReachedModal, setCurrentScreen
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Animations
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide   = useRef(new Animated.Value(-20)).current;
  const cardOpacity   = useRef(new Animated.Value(0)).current;
  const cardSlide     = useRef(new Animated.Value(30)).current;
  const moodOpacity   = useRef(new Animated.Value(0)).current;
  const btnOpacity    = useRef(new Animated.Value(0)).current;
  const btnScale      = useRef(new Animated.Value(1)).current;
  const starScales    = MOOD_OPTIONS.map(() => useRef(new Animated.Value(1)).current);
  const bgGlow        = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(120, [
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(headerSlide, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(cardOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(cardSlide, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
      ]),
      Animated.timing(moodOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(btnScale, { toValue: 1.015, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(btnScale, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const selectMood = (r, idx) => {
    setRating(r);
    // Bounce the selected star
    Animated.sequence([
      Animated.spring(starScales[idx], { toValue: 1.4, tension: 300, friction: 6, useNativeDriver: true }),
      Animated.spring(starScales[idx], { toValue: 1, tension: 300, friction: 8, useNativeDriver: true }),
    ]).start();
    // Glow the background
    Animated.timing(bgGlow, { toValue: r / 5, duration: 400, useNativeDriver: false }).start();
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      showAlert({ title: 'Please Rate', text: 'Select how you felt after this session.', icon: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      const techId = currentRecommendation?.technique_id || 'breathing_garden';
      const subId  = selectedSubOption?.id || 'flower_meadow';
      await apiService.submitRating(userId, techId, subId, rating);
      
      let postState = 'normal';
      if (rating <= 2) {
        postState = preInterventionLabel || 'stress';
      } else {
        postState = 'normal';
      }

      setPostInterventionLabel(postState);
      const clusterId = currentRecommendation?.context_cluster_id ?? 0;
      const valRes = await apiService.validateIntervention(userId, techId, preInterventionLabel, postState, clusterId, rating);
      setLastValidationResult(valRes);
      setCurrentScreen('Recovery');
    } catch (e) {
      setCurrentScreen('Recovery');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedMood = MOOD_OPTIONS.find(m => m.rating === rating);
  const glowColor = bgGlow.interpolate({
    inputRange: [0, 0.4, 0.8, 1],
    outputRange: ['rgba(239,68,68,0.00)', 'rgba(245,158,11,0.06)', 'rgba(16,185,129,0.06)', 'rgba(56,189,248,0.08)'],
  });

  return (
    <Animated.View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Animated.View style={{ backgroundColor: glowColor, position: 'absolute', inset: 0 }} />
      <Header title="Exercise Feedback" />

      <ScrollView contentContainerStyle={styles.body}>
        {/* Technique badge */}
        <Animated.View style={[styles.techBadge, { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: headerOpacity, transform: [{ translateY: headerSlide }] }]}>
          <Text style={styles.techIcon}>🎮</Text>
          <View>
            <Text style={[styles.techLabel, { color: theme.textMuted }]}>Technique Completed</Text>
            <Text style={[styles.techName, { color: theme.accent }]}>
              {currentRecommendation?.title || 'Breathing Garden'}
            </Text>
            <Text style={[styles.techSub, { color: theme.textMuted }]}>
              {selectedSubOption?.title || 'Relaxation Scene'}
            </Text>
          </View>
        </Animated.View>

        {/* Heading */}
        <Animated.View style={[{ opacity: cardOpacity, transform: [{ translateY: cardSlide }], width: '100%' }]}>
          <Text style={[styles.heading, { color: theme.textPrimary }]}>How do you feel?</Text>
          <Text style={[styles.sub, { color: theme.textSecondary }]}>
            Your honest feedback helps personalize future recommendations.
          </Text>

          {/* Mood emoji selector */}
          <Animated.View style={[styles.moodRow, { opacity: moodOpacity }]}>
            {MOOD_OPTIONS.map((m, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => selectMood(m.rating, i)}
                style={[
                  styles.moodBtn,
                  { backgroundColor: rating === m.rating ? theme.accent + '20' : theme.bgSecondary, borderColor: rating === m.rating ? theme.accent : theme.border }
                ]}
                activeOpacity={0.8}
              >
                <Animated.Text style={[styles.moodEmoji, { transform: [{ scale: starScales[i] }] }]}>
                  {m.emoji}
                </Animated.Text>
                <Text style={[styles.moodLabel, { color: rating === m.rating ? theme.accent : theme.textMuted }]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </Animated.View>

          {/* Star rating */}
          <View style={[styles.starBox, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            {selectedMood && (
              <Text style={[styles.moodMessage, { color: theme.textSecondary }]}>
                {selectedMood.emoji}  {selectedMood.label}
              </Text>
            )}
            <Text style={[styles.starPrompt, { color: theme.textSecondary }]}>
              {rating === 0 ? 'Tap a mood above or select stars below' : `${rating} / 5 Stars`}
            </Text>
            <StarRating rating={rating} onRate={r => selectMood(r, r - 1)} />
          </View>

          <Text style={[styles.infoTxt, { color: theme.textMuted }]}>
            Ratings update your Preference Learner with a 0.95 exponential decay factor over a 7-day window.
          </Text>
        </Animated.View>

        {/* Submit */}
        <Animated.View style={{ opacity: btnOpacity, transform: [{ scale: btnScale }], width: '100%' }}>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: rating > 0 ? theme.accent : theme.border }]}
            onPress={handleSubmit}
            disabled={submitting || rating === 0}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <Text style={[styles.submitBtnTxt, { color: rating > 0 ? theme.accentText : theme.textMuted }]}>
                {rating > 0 ? `Submit ${rating}-Star Feedback  →` : 'Select your mood first'}
              </Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 20, gap: 16, alignItems: 'center', paddingBottom: 40 },
  techBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 18, borderWidth: 1, width: '100%',
  },
  techIcon: { fontSize: 32 },
  techLabel: { fontSize: 11, fontWeight: '600' },
  techName: { fontSize: 15, fontWeight: '800' },
  techSub: { fontSize: 12, marginTop: 1 },
  heading: { fontSize: 24, fontWeight: '900', marginBottom: 4 },
  sub: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  moodRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  moodBtn: {
    flex: 1, padding: 10, borderRadius: 16, borderWidth: 1.5,
    alignItems: 'center', gap: 4,
  },
  moodEmoji: { fontSize: 26 },
  moodLabel: { fontSize: 9, fontWeight: '700', textAlign: 'center' },
  starBox: {
    padding: 20, borderRadius: 20, borderWidth: 1,
    alignItems: 'center', gap: 8, width: '100%',
  },
  moodMessage: { fontSize: 16, fontWeight: '700' },
  starPrompt: { fontSize: 13, fontWeight: '600' },
  infoTxt: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  submitBtn: {
    paddingVertical: 16, borderRadius: 18,
    alignItems: 'center', width: '100%',
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
  submitBtnTxt: { fontWeight: '800', fontSize: 15 },
});
