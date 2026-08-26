import React, { createContext, useState, useEffect } from 'react';
import { apiService } from '../api/apiService';

export const AppContext = createContext();

// userId/username are the identity of whoever is logged into the host app
// (StressApp's AuthContext) -- this module has no sign-in/sign-up of its own
// and never mints its own identity. initialUserId is required for any of the
// live telemetry endpoints to resolve real Firebase data (see firebase_service.py);
// the 'guest_' fallback only exists so this module still renders standalone in dev.
export const AppProvider = ({ children, initialUserId, initialUsername, initialIsNewUser = false, onExit = null }) => {
  const [currentScreen, setCurrentScreen] = useState('PrivacyPolicy');
  const [userId, setUserId] = useState(initialUserId || `guest_${Date.now()}`);
  const [username, setUsername] = useState(initialUsername || 'Participant');
  const [userEmail, setUserEmail] = useState('');
  const [pendingVerificationCode, setPendingVerificationCode] = useState('');
  const [isGuest, setIsGuest] = useState(!initialUserId);

  // Individual Permission Toggles (Grant Access screen)
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [permMember1, setPermMember1] = useState(true);  // Member 1: EEG Earbud
  const [permMember2, setPermMember2] = useState(true);  // Member 2: Smart Ring
  const [permMember3, setPermMember3] = useState(true);  // Member 3: Smartphone Phenotype
  const [permVoice, setPermVoice] = useState(true);      // AI Counselor Voice/Microphone

  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);

  // Returning-user check: has this identity already finished the one-time
  // Privacy/Onboarding/Permissions/Calibration flow before, on any device?
  // Baseline + survey data are captured once, at first login after
  // registration (BaselineCalibrationScreen / OnboardingQuestionsScreen).
  // On every later login this flag is true, so the whole flow is skipped
  // and the user lands straight on the Dashboard. Policy/Survey/Calibration
  // remain reachable afterwards from the Profile screen if the user wants
  // to revisit them, just never shown again automatically.
  const [identityChecked, setIdentityChecked] = useState(!initialUserId);

  useEffect(() => {
    if (!initialUserId) return;
    let cancelled = false;
    (async () => {
      const alreadyOnboarded = await apiService.getCalibrationStatus(initialUserId);
      if (cancelled) return;
      // Skip calibration & onboarding if user is an existing registered user or already calibrated
      if (alreadyOnboarded || initialIsNewUser === false) {
        setPrivacyAccepted(true);
        setPermissionsGranted(true);
        setIsCalibrated(true);
        setCurrentScreen('Dashboard');
        apiService.completeCalibration(initialUserId);
      }
      setIdentityChecked(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUserId, initialIsNewUser]);

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

  // Telemetry poll loop (every 2 seconds).
  // "normal" sim mode means no manual test override is active, so we read
  // real-time fused probability straight from fusion_en_sessions in Firebase.
  // Any other sim mode (pre-stress/stress/safety_override_test) is a manual
  // developer override and goes through the simulator instead.
  useEffect(() => {
    let interval = null;
    if (isCalibrated) {
      interval = setInterval(async () => {
        try {
          const telemetry = simMode === 'normal'
            ? await apiService.getLiveFusionTelemetry(userId)
            : await apiService.getProcessedTelemetry(userId, 0.0);
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
  }, [isCalibrated, userId, simMode]);

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
      setStressProbability(telemetry.features_flat[0]);
    }
  };

  return (
    <AppContext.Provider
      value={{
        // The host app's (StressApp's) real logout function -- this module
        // has no login/logout of its own, so the Profile screen's "Log Out"
        // button calls straight through to it. Null when run standalone.
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
