import React, { useState, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { useSweetAlert } from '../context/SweetAlertContext';
import { apiService } from '../api/apiService';

const QUESTIONS = [
  {
    id: 'stress_source',
    question: '1. What is your primary source of stress?',
    options: [
      { label: '💼 Work & Tight Deadlines', value: 'work' },
      { label: '📚 Academic & Exam Pressure', value: 'academic' },
      { label: '😴 Sleep & Physical Fatigue', value: 'fatigue' },
      { label: '🧠 Overthinking & Anxiety Loops', value: 'anxiety' },
      { label: '⚡ General Daily Overwhelm', value: 'general' }
    ]
  },
  {
    id: 'relaxation_style',
    question: '2. Which relaxation style works best for you?',
    options: [
      { label: '🧘 Guided Meditation & Breathwork', value: 'guided_meditation' },
      { label: '🌸 Visual Breathing Gardens', value: 'breathing_garden' },
      { label: '🧼 Tactile De-Stress Popping & Sand', value: 'cognitive_destress' }
    ]
  },
  {
    id: 'stress_frequency',
    question: '3. How frequently do you feel acute stress?',
    options: [
      { label: '🌱 Occasionally (1-2 times a week)', value: 'occasional' },
      { label: '⚡ Daily Peak Hours', value: 'daily' },
      { label: '🔥 Multiple Times a Day', value: 'frequent' },
      { label: '🌊 Constant High Tension', value: 'constant' }
    ]
  }
];

export const OnboardingQuestionsScreen = () => {
  const { showAlert } = useSweetAlert();
  const { setCurrentScreen, userId, setOnboardingAnswers, setOnboardingRecommendation } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [answers, setAnswers] = useState({
    stress_source: 'work',
    relaxation_style: 'guided_meditation',
    stress_frequency: 'daily'
  });

  const [loading, setLoading] = useState(false);

  const handleSelect = (questionId, value) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Save answers in context & backend
      if (setOnboardingAnswers) setOnboardingAnswers(answers);

      // Determine initial tailored recommendation
      let recTitle = 'Guided Meditation & Breathwork';
      let recTechId = 'guided_meditation';
      let recReason = 'Ideal for quick stress relief and restoring body calm.';

      if (answers.relaxation_style === 'breathing_garden' || answers.stress_source === 'anxiety') {
        recTitle = 'Breathing Garden (Flower Meadow)';
        recTechId = 'breathing_garden';
        recReason = 'Guided 4-7-8 breathing with soothing blooming visuals.';
      } else if (answers.relaxation_style === 'cognitive_destress') {
        recTitle = 'Cognitive De-Stress Arcade';
        recTechId = 'cognitive_destress';
        recReason = 'Simple interactive exercises to quickly release physical tension.';
      }

      const recommendationData = {
        title: recTitle,
        technique_id: recTechId,
        reason: recReason,
        answers: answers
      };

      if (setOnboardingRecommendation) setOnboardingRecommendation(recommendationData);

      // Save to backend API optional log
      try {
        await apiService.saveOnboardingAnswers(userId, answers);
      } catch (e) {
        console.log('Saved answers locally');
      }

      showAlert({
        title: 'Profile Saved! 📋',
        text: 'Your stress profile & relaxation preferences have been recorded. Proceeding to Hardware Permissions...',
        icon: 'success',
        timer: 2000
      });

      setCurrentScreen('Permissions');
    } catch (err) {
      showAlert({
        title: 'Error',
        text: 'Failed to record answers. Please try again.',
        icon: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Personalization Survey" showBack onBack={() => setCurrentScreen('PrivacyPolicy')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.heading, { color: theme.textPrimary }]}>Tailor Your Relaxation Plan</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Answer a few quick questions so Calm AI can record your stress profile in history and recommend optimal relaxation techniques.
        </Text>

        {QUESTIONS.map((q) => (
          <View key={q.id} style={[styles.qCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <Text style={[styles.qTitle, { color: theme.textPrimary }]}>{q.question}</Text>
            <View style={styles.optionsGrid}>
              {q.options.map((opt) => {
                const isSelected = answers[q.id] === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.optBtn,
                      { backgroundColor: theme.bgCard, borderColor: theme.border },
                      isSelected && { backgroundColor: theme.accent, borderColor: theme.accent }
                    ]}
                    onPress={() => handleSelect(q.id, opt.value)}
                  >
                    <Text
                      style={[
                        styles.optTxt,
                        { color: theme.textPrimary },
                        isSelected && { color: theme.accentText, fontWeight: '800' }
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: theme.accent }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={[styles.submitBtnTxt, { color: theme.accentText }]}>Save Profile & Proceed →</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    padding: 18
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4
  },
  sub: {
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 18
  },
  qCard: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1
  },
  qTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 12
  },
  optionsGrid: {
    gap: 8
  },
  optBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1
  },
  optTxt: {
    fontSize: 13,
    fontWeight: '600'
  },
  submitBtn: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24
  },
  submitBtnTxt: {
    fontWeight: '800',
    fontSize: 16
  }
});
