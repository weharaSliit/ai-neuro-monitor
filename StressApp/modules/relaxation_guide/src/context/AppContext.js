import React, { createContext, useState, useEffect } from 'react';
import { apiService } from '../api/apiService';

export const AppContext = createContext();

// userId/username are the identity of whoever is logged into the host app
// (StressApp's AuthContext) -- this module has no sign-in/sign-up of its own
// and never mints its own identity. initialUserId is required for any of the
// live telemetry endpoints to resolve real Firebase data (see firebase_service.py);
// the 'guest_' fallback only exists so this module still renders standalone in dev.
export const AppProvider = ({ children, initialUserId, initialUsername, initialIsNewUser = false, onExit = null }) => {
  const [currentScreen, setCurrentScreen] = useState('Dashboard');
  const [userId, setUserId] = useState(initialUserId || `user_${Date.now()}`);
  const [username, setUsername] = useState(initialUsername || 'Participant');
  const [userEmail, setUserEmail] = useState('');
  const [pendingVerificationCode, setPendingVerificationCode] = useState('');
  const [isGuest, setIsGuest] = useState(!initialUserId);

  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [identityChecked, setIdentityChecked] = useState(true);

  // Live Multi-Member Telemetry & Stress State (2 inputs: fused_stress_label & stress_probability)
  const [stressState, setStressState] = useState('normal');
  const [stressProbability, setStressProbability] = useState(0.15);
  const [simMode, setSimMode] = useState('normal');

  const [isSafetyOverride, setIsSafetyOverride] = useState(false);
  const [isAlertTriggered, setIsAlertTriggered] = useState(false);
  const [telemetryMessage, setTelemetryMessage] = useState('');
  const [hasLivePacket, setHasLivePacket] = useState(false);

  // Active Intervention State
  const [currentRecommendation, setCurrentRecommendation] = useState(null);
  const [selectedSubOption, setSelectedSubOption] = useState(null);
  const [preInterventionLabel, setPreInterventionLabel] = useState('stress');
  const [postInterventionLabel, setPostInterventionLabel] = useState('normal');
  const [lastValidationResult, setLastValidationResult] = useState(null);

  // Suitability Warning Modal State
  const [suitabilityModalVisible, setSuitabilityModalVisible] = useState(false);
  const [suitabilityData, setSuitabilityData] = useState(null);

  // Real-time Trend Line History & User Baseline (2s Polling)
  const [stressTrendHistory, setStressTrendHistory] = useState([]);
  const [userBaseline, setUserBaseline] = useState(null);
  const [baselineAchievedModal, setBaselineAchievedModal] = useState({ visible: false, prob: '0.0', baseline: '0.0' });
  const [baselineNotReachedModal, setBaselineNotReachedModal] = useState({ visible: false, alternativeRecommendation: null, prob_stress: 0.5 });
  const hasNotifiedBaselineRef = React.useRef(false);

  // Intervention History
  const [historyList, setHistoryList] = useState([]);

  // Onboarding Answers
  const [onboardingAnswers, setOnboardingAnswers] = useState(null);

  // Telemetry poll loop (every 2 seconds).
  useEffect(() => {
    let interval = null;
    interval = setInterval(async () => {
      try {
        const telemetry = simMode === 'normal'
          ? await apiService.getLiveFusionTelemetry(userId)
          : await apiService.getProcessedTelemetry(userId, 0.0);
        setStressState(telemetry.effective_label);
        setIsSafetyOverride(telemetry.is_safety_override);
        setIsAlertTriggered(telemetry.is_alert_triggered);
        setTelemetryMessage(telemetry.message);
        if (typeof telemetry.has_live_packet === 'boolean') {
          setHasLivePacket(telemetry.has_live_packet);
        }
        if (typeof telemetry.is_calibrated === 'boolean') {
          setIsCalibrated(telemetry.is_calibrated);
        }
        const activeBaseline = (typeof telemetry.user_baseline === 'number' && telemetry.user_baseline > 0)
          ? telemetry.user_baseline
          : null;
        setUserBaseline(activeBaseline);

        if (telemetry.features_flat && telemetry.features_flat.length >= 1) {
          const prob = telemetry.features_flat[0];
          setStressProbability(prob);
          setStressTrendHistory(prev => {
            const nextArr = [...prev, prob];
            return nextArr.slice(-12);
          });

          // Check if live probability has reached or dropped below personal baseline from Firebase (only when stream is live)
          if (telemetry.has_live_packet && activeBaseline && prob <= activeBaseline) {
            if (!hasNotifiedBaselineRef.current) {
              hasNotifiedBaselineRef.current = true;
              setPostInterventionLabel('normal');
              setLastValidationResult(prev => ({
                ...(prev || {}),
                reward: 1.0,
                recovery_percentage: 100.0,
                transition: '🎉 Baseline Achieved! (Normal Equilibrium Restored)',
                is_normal: true,
                is_normal_reached: true,
                closed_loop_status: {
                  guidance_message: '🎉 Baseline Achieved! Real-time bio-feedback verified your live stress probability returned to optimal resting equilibrium.'
                }
              }));
              setBaselineAchievedModal({
                visible: true,
                prob: (prob * 100).toFixed(1),
                baseline: (activeBaseline * 100).toFixed(1)
              });
            }
          } else {
            hasNotifiedBaselineRef.current = false;
          }
        }
      } catch (e) {
        console.warn('Telemetry polling error', e);
      }
    }, 2000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [userId, simMode, userBaseline]);

  // Update simulator mode manually
  const updateSimMode = async (mode) => {
    setSimMode(mode);
    await apiService.setSimulatorMode(mode);
    const telemetry = mode === 'normal'
      ? await apiService.getLiveFusionTelemetry(userId)
      : await apiService.getProcessedTelemetry(userId, 0.0);
    setStressState(telemetry.effective_label);
    setIsSafetyOverride(telemetry.is_safety_override);
    setIsAlertTriggered(telemetry.is_alert_triggered);
    setTelemetryMessage(telemetry.message);
    if (telemetry.features_flat && telemetry.features_flat.length >= 1) {
      const prob = telemetry.features_flat[0];
      setStressProbability(prob);
      setStressTrendHistory(prev => [...prev.slice(-11), prob]);
    }
    if (typeof telemetry.user_baseline === 'number') {
      setUserBaseline(telemetry.user_baseline);
    }
  };

  return (
    <AppContext.Provider
      value={{
        hostExit: onExit,
        identityChecked,
        currentScreen,
        setCurrentScreen,
        userId,
        setUserId,
        username,
        setUsername,
        userEmail,
        setUserEmail,
        pendingVerificationCode,
        setPendingVerificationCode,
        isGuest,
        setIsGuest,
        privacyAccepted,
        setPrivacyAccepted,
        isCalibrated,
        setIsCalibrated,
        stressState,
        setStressState,
        stressProbability,
        setStressProbability,
        stressTrendHistory,
        userBaseline,
        baselineAchievedModal,
        setBaselineAchievedModal,
        simMode,
        updateSimMode,
        isSafetyOverride,
        isAlertTriggered,
        telemetryMessage,
        hasLivePacket,
        currentRecommendation,
        setCurrentRecommendation,
        selectedSubOption,
        setSelectedSubOption,
        preInterventionLabel,
        setPreInterventionLabel,
        postInterventionLabel,
        setPostInterventionLabel,
        lastValidationResult,
        setLastValidationResult,
        suitabilityModalVisible,
        setSuitabilityModalVisible,
        suitabilityData,
        setSuitabilityData,
        historyList,
        setHistoryList,
        baselineAchievedModal,
        setBaselineAchievedModal,
        baselineNotReachedModal,
        setBaselineNotReachedModal,
        onboardingAnswers,
        setOnboardingAnswers
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
