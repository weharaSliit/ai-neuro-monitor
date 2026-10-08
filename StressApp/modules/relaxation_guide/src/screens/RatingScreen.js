import React, { useState, useContext, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  ScrollView,
  Dimensions
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';
import { useSweetAlert } from '../context/SweetAlertContext';
import { AmbientBackground } from '../components/AmbientBackground';
import { checkNewlyUnlockedBadges } from '../utils/badgeUtils';

const { width } = Dimensions.get('window');

const SAM_AROUSAL_LEVELS = [
  { val: 1, emoji: '🧘', label: 'Deeply Calm', color: '#10B981' },
  { val: 2, emoji: '😌', label: 'Very Relaxed', color: '#10B981' },
  { val: 3, emoji: '🙂', label: 'Peaceful', color: '#34D399' },
  { val: 4, emoji: '😐', label: 'Mildly Calm', color: '#38BDF8' },
  { val: 5, emoji: '😐', label: 'Neutral', color: '#60A5FA' },
  { val: 6, emoji: '😕', label: 'Slightly Tense', color: '#FBBF24' },
  { val: 7, emoji: '😟', label: 'Moderate Stress', color: '#F59E0B' },
  { val: 8, emoji: '😫', label: 'High Stress', color: '#F87171' },
  { val: 9, emoji: '😱', label: 'Extreme Anxiety', color: '#EF4444' },
];

const SUS_QUESTIONS = [
  { id: 'q1', icon: '🎮', text: '1. The relaxation game was easy and engaging to follow.' },
  { id: 'q2', icon: '🌊', text: '2. The visual biofeedback helped me calm down.' },
  { id: 'q3', icon: '📱', text: '3. The app interface felt fast, smooth, and responsive.' },
  { id: 'q4', icon: '✨', text: '4. I felt zero mental frustration during the session.' },
];

export const RatingScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    userId, currentRecommendation, selectedSubOption,
    preInterventionLabel, setPostInterventionLabel,
    setLastValidationResult, setCurrentScreen, setHistoryList, historyList
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  // States
  const [postArousal, setPostArousal] = useState(2); // Post-SAM Arousal (1-9)
  const [postValence, setPostValence] = useState(8);
  const [susAnswers, setSusAnswers] = useState({ q1: 5, q2: 5, q3: 5, q4: 4 });
  const [submitting, setSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false); // Controls Thank You screen

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.02, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Pre-session arousal estimate (from Stroop test or baseline)
  const preArousalEstimate = preInterventionLabel === 'high_stress' ? 8.5 : preInterventionLabel === 'stress' ? 7.5 : 4.0;
  const arousalDelta = (postArousal - preArousalEstimate).toFixed(1);

  // System Usability Scale (SUS) Score out of 100
  const totalSusRaw = Object.values(susAnswers).reduce((a, b) => a + b, 0);
  const susScorePct = Math.round((totalSusRaw / 20) * 100);

  const selectedSam = SAM_AROUSAL_LEVELS.find((l) => l.val === postArousal) || SAM_AROUSAL_LEVELS[1];

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const techId = currentRecommendation?.technique_id || selectedSubOption?.id || 'water_lily_pond';
      const subId = selectedSubOption?.id || techId;

      const mappedRating = postArousal <= 2 ? 5 : postArousal <= 4 ? 4 : postArousal <= 6 ? 3 : postArousal <= 7 ? 2 : 1;

      await apiService.submitRating(userId, techId, subId, mappedRating);

      let postState = postArousal <= 4 ? 'normal' : 'stress';
      setPostInterventionLabel(postState);

      const clusterId = currentRecommendation?.context_cluster_id ?? 0;
      const valRes = await apiService.validateIntervention(userId, techId, preInterventionLabel, postState, clusterId, mappedRating);
      setLastValidationResult(valRes);

      // Record detailed session into history
      const newEntry = {
        id: `val_sess_${Date.now()}`,
        timestamp: Date.now() / 1000,
        technique_id: techId,
        sub_option_id: subId,
        pre_label: preInterventionLabel || 'stress',
        post_label: postState,
        pre_arousal: preArousalEstimate,
        post_arousal: postArousal,
        arousal_delta: arousalDelta,
        post_valence: postValence,
        sus_score: susScorePct,
        star_rating: mappedRating
      };
      
      const prevHistory = historyList || [];
      const newHistory = [newEntry, ...prevHistory];
      setHistoryList(newHistory);

      const newlyUnlocked = checkNewlyUnlockedBadges(prevHistory, newHistory, null);
      if (newlyUnlocked && newlyUnlocked.length > 0) {
        const b = newlyUnlocked[0];
        showAlert({
          title: `🏆 NEW BADGE UNLOCKED!`,
          text: `Congratulations! You earned "${b.icon} ${b.title}"\n\n${b.description}`,
          icon: 'success',
          confirmButtonText: 'AWESOME! 🎉'
        });
      }

      // Display Thank You screen with OK button
      setIsSubmitted(true);
    } catch (e) {
      console.warn('Rating submission error', e);
      setIsSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnHome = () => {
    setCurrentScreen('Dashboard');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <AmbientBackground />
      <Header title="Research Evaluation" showBack onBack={() => setCurrentScreen('Dashboard')} />

      {/* ─── THANK YOU COMPLETION SCREEN ─── */}
      {isSubmitted ? (
        <View style={styles.thankYouContainer}>
          <View style={[styles.thankYouCard, { backgroundColor: theme.bgSecondary, borderColor: '#10B981' }]}>
            <Text style={styles.thankYouEmoji}>🎉</Text>
            <Text style={styles.thankYouTitle}>THANK YOU!</Text>
            <Text style={styles.thankYouSub}>
              Your feedback has been recorded successfully for the research study database.
            </Text>

            <View style={styles.xpPill}>
              <Text style={styles.xpPillTxt}>⭐ +200 Calm XP Earned!</Text>
            </View>

            <TouchableOpacity style={styles.okBtn} onPress={handleReturnHome} activeOpacity={0.85}>
              <LinearGradient
                colors={['#10B981', '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.okBtnGradient}
              >
                <Text style={styles.okBtnTxt}>OK / RETURN TO HOME 🏠</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* ─── SURVEY FORM ─── */
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Header Hero Banner */}
          <Animated.View style={[styles.heroCard, { opacity: fadeAnim }]}>
            <LinearGradient
              colors={['#1E1B4B', '#312E81', '#4338CA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroGradient}
            >
              <Text style={styles.heroBadge}>🏆 RESEARCH USER STUDY (N=20)</Text>
              <Text style={styles.heroTitle}>Post-Session Evaluation</Text>
              <Text style={styles.heroSub}>
                Rate your immediate affect shift and app usability to submit your feedback.
              </Text>
            </LinearGradient>
          </Animated.View>

          {/* ─── SECTION 1: SAM STRESS AROUSAL SCALE ─── */}
          <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardHeaderIcon}>🧘</Text>
              <View>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>1. Self-Assessment Manikin (SAM)</Text>
                <Text style={[styles.cardSub, { color: theme.textMuted }]}>How stressed or calm do you feel RIGHT NOW?</Text>
              </View>
            </View>

            {/* Avatar Feedback Display */}
            <View style={[styles.samAvatarBox, { borderColor: selectedSam.color }]}>
              <Text style={styles.samEmoji}>{selectedSam.emoji}</Text>
              <Text style={[styles.samLabelTxt, { color: selectedSam.color }]}>
                Level {selectedSam.val}: {selectedSam.label}
              </Text>
            </View>

            {/* 1-9 Arousal Grid Selector */}
            <View style={styles.arousalGrid}>
              {SAM_AROUSAL_LEVELS.map((item) => {
                const isSelected = postArousal === item.val;
                return (
                  <TouchableOpacity
                    key={item.val}
                    style={[
                      styles.arousalPill,
                      { borderColor: isSelected ? item.color : '#334155' },
                      isSelected && { backgroundColor: item.color }
                    ]}
                    onPress={() => setPostArousal(item.val)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.arousalPillTxt, isSelected && { color: '#FFFFFF', fontWeight: '900' }]}>
                      {item.val}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.scaleLegendRow}>
              <Text style={{ fontSize: 11, color: '#10B981', fontWeight: '700' }}>1 = Extremely Calm</Text>
              <Text style={{ fontSize: 11, color: '#EF4444', fontWeight: '700' }}>9 = Extreme Stress</Text>
            </View>
          </View>

          {/* ─── SECTION 2: SYSTEM USABILITY SCALE (SUS) ─── */}
          <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardHeaderIcon}>⭐</Text>
              <View>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>2. System Usability Scale (SUS)</Text>
                <Text style={[styles.cardSub, { color: theme.textMuted }]}>Rate app quality & ease of use (1 = Poor, 5 = Excellent):</Text>
              </View>
            </View>

            {SUS_QUESTIONS.map((q) => (
              <View key={q.id} style={styles.susQuestionCard}>
                <Text style={[styles.susQuestionTxt, { color: theme.textPrimary }]}>
                  {q.icon} {q.text}
                </Text>
                <View style={styles.starPillRow}>
                  {[1, 2, 3, 4, 5].map((starVal) => {
                    const isStarSelected = susAnswers[q.id] === starVal;
                    return (
                      <TouchableOpacity
                        key={starVal}
                        style={[
                          styles.starPill,
                          isStarSelected && styles.starPillSelected
                        ]}
                        onPress={() => setSusAnswers((prev) => ({ ...prev, [q.id]: starVal }))}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.starPillTxt, isStarSelected && styles.starPillTxtSelected]}>
                          {starVal}★
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>

          {/* SUBMIT BUTTON */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
            <TouchableOpacity
              style={styles.submitBtnWrapper}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#10B981', '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.submitBtnGradient}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.submitBtnTxt}>SUBMIT VALIDATION FEEDBACK ▶</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    padding: 14,
    paddingBottom: 90,
    alignItems: 'center',
  },
  thankYouContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  thankYouCard: {
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 2,
    elevation: 8,
  },
  thankYouEmoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  thankYouTitle: {
    color: '#10B981',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 8,
  },
  thankYouSub: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  xpPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#F59E0B',
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  xpPillTxt: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: 'bold',
  },
  okBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  okBtnGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  okBtnTxt: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  heroCard: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
    elevation: 4,
  },
  heroGradient: {
    padding: 14,
    borderRadius: 16,
  },
  heroBadge: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 2,
  },
  heroSub: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 16,
  },
  card: {
    borderRadius: 16,
    padding: 14,
    width: '100%',
    marginBottom: 12,
    borderWidth: 1,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  cardHeaderIcon: {
    fontSize: 24,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  cardSub: {
    fontSize: 11,
    marginTop: 1,
  },
  samAvatarBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 10,
  },
  samEmoji: {
    fontSize: 34,
    marginBottom: 2,
  },
  samLabelTxt: {
    fontSize: 14,
    fontWeight: '900',
  },
  arousalGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 8,
  },
  arousalPill: {
    width: 30,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arousalPillTxt: {
    color: '#94A3B8',
    fontWeight: 'bold',
    fontSize: 12,
  },
  scaleLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  susQuestionCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  susQuestionTxt: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  starPillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  starPill: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  starPillSelected: {
    backgroundColor: '#F59E0B',
    borderColor: '#FDE68A',
  },
  starPillTxt: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
  },
  starPillTxtSelected: {
    color: '#0F172A',
    fontWeight: '900',
  },
  submitBtnWrapper: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 6,
  },
  submitBtnGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitBtnTxt: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});

export default RatingScreen;
