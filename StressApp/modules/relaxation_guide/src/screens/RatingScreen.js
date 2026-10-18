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

const FEEDBACK_LEVELS = [
  { val: 1, emoji: '😫', label: 'Still very stressed', color: '#EF4444' },
  { val: 2, emoji: '😕', label: 'Slightly better', color: '#F59E0B' },
  { val: 3, emoji: '😐', label: 'Neutral', color: '#60A5FA' },
  { val: 4, emoji: '🙂', label: 'Calm', color: '#34D399' },
  { val: 5, emoji: '😌', label: 'Deeply relaxed', color: '#10B981' },
];

export const RatingScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    userId, currentRecommendation, selectedSubOption,
    preInterventionLabel, setPostInterventionLabel,
    setLastValidationResult, setCurrentScreen, setHistoryList, historyList,
    getInterventionTrajectory, getInterventionElapsed, logEvidenceEvent, finishEvidenceSession
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  // States
  const [feedback, setFeedback] = useState(null); // 1-5 emoji rating, chosen by the user
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

  const selectedLevel = FEEDBACK_LEVELS.find((l) => l.val === feedback) || null;

  const handleSubmit = async () => {
    if (!feedback) return;
    setSubmitting(true);
    try {
      const techId = currentRecommendation?.technique_id || selectedSubOption?.id || 'water_lily_pond';
      const subId = selectedSubOption?.id || techId;

      const mappedRating = feedback;

      let postState = feedback >= 4 ? 'normal' : 'stress';
      setPostInterventionLabel(postState);

      const clusterId = currentRecommendation?.context_cluster_id ?? 0;
      // The rating and the validation do not depend on each other, so they run together
      // (one wait instead of two, each with a short timeout; offline results are used if it fails).
      const [, valRes] = await Promise.all([
        apiService.submitRating(userId, techId, subId, mappedRating),
        apiService.validateIntervention(
          userId, techId, preInterventionLabel, postState, clusterId, mappedRating,
          {
            sessionId: currentRecommendation?.session_id,
            stressTrajectory: getInterventionTrajectory(),
            durationSeconds: getInterventionElapsed()
          }
        )
      ]);
      setLastValidationResult(valRes);

      logEvidenceEvent && logEvidenceEvent('rated', { stars: mappedRating });
      finishEvidenceSession && finishEvidenceSession({
        technique_id: techId,
        stars: mappedRating,
        measured: !!valRes?.measured,
        reward: valRes?.reward ?? null,
        recovery_percentage: valRes?.recovery_percentage ?? null,
        reward_components: valRes?.reward_components ?? null,
        is_normal_reached: valRes?.is_normal_reached ?? null,
        next_technique_id: valRes?.alternative_recommendation?.technique_id ?? null,
        ended_at: Date.now() / 1000,
      });

      // Record detailed session into history
      const newEntry = {
        id: `val_sess_${Date.now()}`,
        timestamp: Date.now() / 1000,
        technique_id: techId,
        sub_option_id: subId,
        pre_label: preInterventionLabel || 'stress',
        post_label: postState,
        star_rating: mappedRating,
        recovery_pct: valRes?.recovery_percentage,
        reward: valRes?.reward
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
      <Header title="Feedback" showBack onBack={() => setCurrentScreen('Dashboard')} />

      {/* ─── THANK YOU COMPLETION SCREEN ─── */}
      {isSubmitted ? (
        <View style={styles.thankYouContainer}>
          <View style={[styles.thankYouCard, { backgroundColor: theme.bgSecondary, borderColor: '#10B981' }]}>
            <Text style={styles.thankYouEmoji}>🎉</Text>
            <Text style={styles.thankYouTitle}>THANK YOU!</Text>
            <Text style={styles.thankYouSub}>
              Your feedback has been recorded.
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
          {/* ─── FEEDBACK: 5 EMOJI RATING ─── */}
          <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardHeaderIcon}>⭐</Text>
              <View>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>How do you feel now?</Text>
                <Text style={[styles.cardSub, { color: theme.textMuted }]}>Tap one emoji (1 to 5 stars)</Text>
              </View>
            </View>

            <View style={styles.emojiRow}>
              {FEEDBACK_LEVELS.map((item) => {
                const isSelected = feedback === item.val;
                return (
                  <TouchableOpacity
                    key={item.val}
                    style={[
                      styles.emojiBtn,
                      { borderColor: isSelected ? item.color : '#334155' },
                      isSelected && { backgroundColor: `${item.color}33` }
                    ]}
                    onPress={() => setFeedback(item.val)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.emojiTxt, !isSelected && feedback !== null && { opacity: 0.45 }]}>
                      {item.emoji}
                    </Text>
                    <Text style={[styles.emojiStars, { color: isSelected ? item.color : theme.textMuted }]}>
                      {item.val}★
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.emojiLabel, { color: selectedLevel ? selectedLevel.color : theme.textMuted }]}>
              {selectedLevel ? selectedLevel.label : 'Select your feedback'}
            </Text>
          </View>

          {/* SUBMIT BUTTON */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
            <TouchableOpacity
              style={[styles.submitBtnWrapper, !feedback && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={submitting || !feedback}
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
                  <Text style={styles.submitBtnTxt}>SUBMIT FEEDBACK ▶</Text>
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
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 4,
  },
  emojiBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 2,
  },
  emojiTxt: {
    fontSize: 32,
  },
  emojiStars: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
  },
  emojiLabel: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 12,
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
