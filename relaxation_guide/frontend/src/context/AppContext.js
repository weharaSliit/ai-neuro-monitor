import React, { createContext, useState, useEffect } from 'react';
import { apiService } from '../api/apiService';

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [currentScreen, setCurrentScreen] = useState('Splash');
  const [userId, setUserId] = useState('user_calm_ai');
  const [username, setUsername] = useState('Research Participant');
  const [userEmail, setUserEmail] = useState('');
  const [pendingVerificationCode, setPendingVerificationCode] = useState('');
  const [isGuest, setIsGuest] = useState(false);

  // Individual Permission Toggles (Grant Access screen)
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [permMember1, setPermMember1] = useState(true);  // Member 1: EEG Earbud
  const [permMember2, setPermMember2] = useState(true);  // Member 2: Smart Ring
  const [permMember3, setPermMember3] = useState(true);  // Member 3: Smartphone Phenotype
  const [permVoice, setPermVoice] = useState(true);      // AI Counselor Voice/Microphone

  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);

  // Live Multi-Member Telemetry & Stress State (2 inputs: fused_stress_label & stress_probability)
  const [stressState, setStressState] = useState('normal');
  const [stressProbability, setStressProbability] = useState(0.15);
  const [simMode, setSimMode] = useState('normal');

  const [isSafetyOverride, setIsSafetyOverride] = useState(false);
  const [isAlertTriggered, setIsAlertTriggered] = useState(false);
  const [telemetryMessage, setTelemetryMessage] = useState('');

  // Active Intervention State
  const [currentRecommendation, setCurrentRecommendation] = useState(null);
  const [selectedSubOption, setSelectedSubOption] = useState(null);
  const [preInterventionLabel, setPreInterventionLabel] = useState('stress');
  const [postInterventionLabel, setPostInterventionLabel] = useState('normal');
  const [lastValidationResult, setLastValidationResult] = useState(null);

  // Suitability Warning Modal State
  const [suitabilityModalVisible, setSuitabilityModalVisible] = useState(false);
  const [suitabilityData, setSuitabilityData] = useState(null);

  // Intervention History
  const [historyList, setHistoryList] = useState([]);

  // Onboarding Questions & Recommendations
  const [onboardingAnswers, setOnboardingAnswers] = useState(null);
  const [onboardingRecommendation, setOnboardingRecommendation] = useState(null);
  const [hasShownOnboardingAlert, setHasShownOnboardingAlert] = useState(false);

  // Telemetry poll loop (every 2 seconds from fusion_en_sessions)
  useEffect(() => {
    let interval = null;
    if (isCalibrated) {
      interval = setInterval(async () => {
        try {
          const telemetry = await apiService.getProcessedTelemetry(userId, 0.0);
          setStressState(telemetry.effective_label);
          setIsSafetyOverride(telemetry.is_safety_override);
          setIsAlertTriggered(telemetry.is_alert_triggered);
          setTelemetryMessage(telemetry.message);
          
          if (telemetry.features_flat && telemetry.features_flat.length >= 1) {
            setStressProbability(telemetry.features_flat[0]);
          }
        } catch (e) {
          console.warn('Telemetry polling error', e);
        }
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isCalibrated, userId]);

  // Update simulator mode manually
  const updateSimMode = async (mode) => {
    setSimMode(mode);
    await apiService.setSimulatorMode(mode);
    const telemetry = await apiService.getProcessedTelemetry(userId, 0.0);
    setStressState(telemetry.effective_label);
    setIsSafetyOverride(telemetry.is_safety_override);
    setIsAlertTriggered(telemetry.is_alert_triggered);
    setTelemetryMessage(telemetry.message);
    if (telemetry.features_flat && telemetry.features_flat.length >= 1) {
      setStressProbability(telemetry.features_flat[0]);
    }
  };

  return (
    <AppContext.Provider
      value={{
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
        permissionsGranted,
        setPermissionsGranted,
        permMember1,
        setPermMember1,
        permMember2,
        setPermMember2,
        permMember3,
        setPermMember3,
        permVoice,
        setPermVoice,
        privacyAccepted,
        setPrivacyAccepted,
        isCalibrated,
        setIsCalibrated,
        stressState,
        setStressState,
        stressProbability,
        setStressProbability,
        simMode,
        updateSimMode,
        isSafetyOverride,
        isAlertTriggered,
        telemetryMessage,
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
        onboardingAnswers,
        setOnboardingAnswers,
        onboardingRecommendation,
        setOnboardingRecommendation,
        hasShownOnboardingAlert,
        setHasShownOnboardingAlert
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
