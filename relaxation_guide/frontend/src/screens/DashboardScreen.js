import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { StressBadge } from '../components/StressBadge';
import { MemberTelemetryCard } from '../components/MemberTelemetryCard';
import { TelemetrySimulatorCard } from '../components/TelemetrySimulatorCard';
import { apiService } from '../api/apiService';

import { useSweetAlert } from '../context/SweetAlertContext';

const MOTIVATIONAL_QUOTES = [
  { quote: "You don't have to control your thoughts; you just have to stop letting them control you.", author: "Dan Millman" },
  { quote: "Breathe in peace, exhale tension. Every moment is a fresh start for your nervous system.", author: "Mindfulness Wisdom" },
  { quote: "Your calm mind is the ultimate weapon against your daily challenges.", author: "Marcus Aurelius" },
  { quote: "Within you, there is a stillness and a sanctuary to which you can retreat at any time.", author: "Hermann Hesse" },
  { quote: "Tension is who you think you should be. Relaxation is who you are.", author: "Chinese Proverb" }
];

export const DashboardScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    userId,
    username,
    setCurrentScreen,
    stressState,
    stressProbability,
    simMode,
    updateSimMode,
    isSafetyOverride,
    isAlertTriggered,
    telemetryMessage,
    setCurrentRecommendation,
    setPreInterventionLabel,
    onboardingRecommendation,
    hasShownOnboardingAlert,
    setHasShownOnboardingAlert
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (onboardingRecommendation && !hasShownOnboardingAlert) {
      setHasShownOnboardingAlert(true);
      showAlert({
        title: '🎯 Personal Relaxation Plan Ready!',
        text: `Welcome ${username}!\n\nBased on your onboarding survey & 60-second baseline calibration:\n\n• Primary Recommended Technique: ${onboardingRecommendation.title}\n• Personalized Rationale: ${onboardingRecommendation.reason}`,
        icon: 'success',
        confirmButtonText: 'OK / Explore Dashboard 🚀'
      });
    }
  }, [onboardingRecommendation, hasShownOnboardingAlert]);

  const showDailyMotivation = () => {
    const randomItem = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
    showAlert({
      title: '💡 Daily Resilience Boost',
      text: `"${randomItem.quote}"\n\n— ${randomItem.author}\n\n🔥 Keep up your daily streak to earn XP & unlock research badges!`,
      icon: 'celebration',
      confirmButtonText: 'Stay Focused 💪'
    });
  };

  const triggerIntervention = async () => {
    setLoading(true);
    try {
      setPreInterventionLabel(stressState);
      
      const telemetry = await apiService.getProcessedTelemetry(userId, 0.0);
      
      const recommendation = await apiService.getIntervention(userId, {
        user_id: userId,
        timestamp: Date.now() / 1000,
        fused_stress_label: stressState,
        stress_probability: stressState === 'stress' ? 0.88 : (stressState === 'pre-stress' ? 0.55 : 0.15),
        seconds_since_last_packet: 0.0
      });

      setCurrentRecommendation(recommendation);

      showAlert({
        title: 'Intervention Selected! 🎯',
        text: `Based on your live signals (${stressState.toUpperCase()}), Calm AI selected: ${recommendation.title}.`,
        icon: 'info',
        confirmButtonText: 'Start Session ▶️',
        onConfirm: () => setCurrentScreen('Intervention')
      });
    } catch (e) {
      console.warn('Intervention error', e);
      showAlert({
        title: 'Connection Warning',
        text: 'Unable to reach backend. Loading local flow games...',
        icon: 'warning',
        onConfirm: () => setCurrentScreen('Intervention')
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Calm AI Home" />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.userBanner}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={[styles.welcomeTxt, { color: theme.textPrimary }]}>Welcome, {username}</Text>
              <Text style={[styles.subTxt, { color: theme.textMuted }]}>Closed-Loop Bio-Feedback System Active • ID: {userId}</Text>
            </View>

            <TouchableOpacity style={styles.quoteBtn} onPress={showDailyMotivation}>
              <Text style={styles.quoteBtnTxt}>💡 Quote</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Live Combined Stress State Display */}
        <View style={[styles.stressBox, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <Text style={[styles.boxLabel, { color: theme.textSecondary }]}>Combined Effective Stress State</Text>
          <StressBadge label={stressState} isOverride={isSafetyOverride} />
        </View>

        {/* Real-time Signals & Stress Levels of Multimodal Fusion Model */}
        <MemberTelemetryCard
          stressState={stressState}
          stressProbability={stressProbability}
        />

        {/* Closed-Loop Target Monitor Status Card */}
        <View style={[styles.loopCard, { backgroundColor: theme.bgSecondary, borderColor: stressState === 'normal' ? theme.success : theme.warning }]}>
          <View style={styles.loopHeader}>
            <Text style={styles.loopIcon}>{stressState === 'normal' ? '✅' : '🔄'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.loopTitle, { color: theme.textPrimary }]}>
                {stressState === 'normal' ? 'Nervous System Baseline Achieved' : 'Closed-Loop Progress Monitor'}
              </Text>
              <Text style={[styles.loopDesc, { color: theme.textSecondary }]}>
                {stressState === 'normal'
                  ? 'Optimal autonomic baseline. Your nervous system is relaxed.'
                  : 'System is monitoring your signals until target Normal state is reached.'}
              </Text>
            </View>
          </View>
        </View>

        {/* Hardware Signal Simulator Card (For testing missing value handler & safety overrides) */}
        <TelemetrySimulatorCard
          currentMode={simMode}
          onModeChange={updateSimMode}
          isOverride={isSafetyOverride}
          isAlert={isAlertTriggered}
          message={telemetryMessage}
        />

        {/* Action Button to launch Bandit Intervention */}
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: theme.accent }, loading && { opacity: 0.6 }]}
          onPress={triggerIntervention}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={[styles.actionBtnTxt, { color: theme.accentText }]}>🚀 Launch Personalized Intervention →</Text>
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
    padding: 16
  },
  userBanner: {
    marginBottom: 10
  },
  welcomeTxt: {
    fontSize: 20,
    fontWeight: '800'
  },
  subTxt: {
    fontSize: 11,
    marginTop: 2
  },
  quoteBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F59E0B'
  },
  quoteBtnTxt: {
    color: '#F59E0B',
    fontWeight: '800',
    fontSize: 12
  },
  stressBox: {
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    alignItems: 'center'
  },
  boxLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6
  },
  loopCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 10
  },
  loopHeader: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  loopIcon: {
    fontSize: 22,
    marginRight: 10
  },
  loopTitle: {
    fontSize: 13,
    fontWeight: '700'
  },
  loopDesc: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15
  },
  actionBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginVertical: 10,
    elevation: 3
  },
  actionBtnTxt: {
    fontWeight: '800',
    fontSize: 15
  }
});
