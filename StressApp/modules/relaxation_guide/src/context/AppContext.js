import React, { createContext, useState, useEffect, useCallback } from 'react';
import { NativeModules, Platform, Linking, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, onValue, off, query, orderByKey, limitToLast, update, push } from 'firebase/database';
import { db } from '../../firebase';
import { apiService } from '../api/apiService';
import { computeCalibrationStatus } from '../../../phenotyping/utils/calibrationStatus';
import { isPhenotypingOnboarded } from '../../../phenotyping/screens/PhenotypingOnboardingScreen';

const { PhenotypingIdentity } = NativeModules;

export const AppContext = createContext();

export const AppProvider = ({ children, initialUserId, initialUsername, initialIsNewUser = false, onExit = null }) => {
  const [currentScreen, setCurrentScreen] = useState('Dashboard');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [userId, setUserId] = useState(initialUserId || `user_${Date.now()}`);
  const [username, setUsername] = useState(initialUsername || 'Participant');
  const [userEmail, setUserEmail] = useState('');
  const [pendingVerificationCode, setPendingVerificationCode] = useState('');
  const [isGuest, setIsGuest] = useState(!initialUserId);

  // Sync userId & username from props if updated after mount
  useEffect(() => {
    if (initialUserId && initialUserId !== userId) {
      setUserId(initialUserId);
      setIsGuest(false);
    }
  }, [initialUserId]);

  useEffect(() => {
    if (initialUsername && initialUsername !== username) {
      setUsername(initialUsername);
    }
  }, [initialUsername]);

  // Warm auth identity from AsyncStorage caches if initialUserId wasn't supplied yet
  useEffect(() => {
    (async () => {
      try {
        const cachedAuthId = await AsyncStorage.getItem('@phenotyping/authUserId');
        if (cachedAuthId && (!initialUserId || userId.startsWith('user_'))) {
          setUserId(cachedAuthId);
          setIsGuest(false);
        }
        const cachedAuthUser = await AsyncStorage.getItem('@stressapp/authUser');
        if (cachedAuthUser) {
          const parsed = JSON.parse(cachedAuthUser);
          if (parsed?.userId && (!initialUserId || userId.startsWith('user_'))) {
            setUserId(parsed.userId);
            setIsGuest(false);
          }
          if (parsed?.name) {
            setUsername(parsed.name);
          }
        }
      } catch (e) { }
    })();
  }, []);

  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(true);
  const [identityChecked, setIdentityChecked] = useState(true);

  // ── 1. Multimodal Fusion Engine Telemetry (Smart Ring + Earbud) ──
  const [stressState, setStressState] = useState('normal');
  const [stressProbability, setStressProbability] = useState(0.15);
  const [confidence, setConfidence] = useState(0.15);
  const [rawLabel, setRawLabel] = useState('Normal');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [simMode, setSimMode] = useState('normal');

  const [isSafetyOverride, setIsSafetyOverride] = useState(false);
  const [isAlertTriggered, setIsAlertTriggered] = useState(false);
  const [telemetryMessage, setTelemetryMessage] = useState('');
  const [hasLivePacket, setHasLivePacket] = useState(false);

  // ── 2. Digital Phenotyping Telemetry (Smartphone Behavioral Data) ──
  const [phenoSensorEnabled, setPhenoSensorEnabled] = useState(false);
  const [phenoProfile, setPhenoProfile] = useState(null);
  const [phenoBaselines, setPhenoBaselines] = useState(null);
  const [phenoCalibStatus, setPhenoCalibStatus] = useState({
    dayNumber: 1,
    displayDays: 'Day 1 of 7',
    phase: 'calibration',
    progressPct: 14,
    title: 'Learning your rhythm',
    isCalibrated: false,
    daysRemaining: 6,
    userName: 'User',
  });
  const [phenoStressLabel, setPhenoStressLabel] = useState('normal');
  const [phenoStressProbability, setPhenoStressProbability] = useState(0.15);
  const [hasLivePhenoPacket, setHasLivePhenoPacket] = useState(false);
  const [phenoTrendHistory, setPhenoTrendHistory] = useState([]);

  // Check PhenoCare Accessibility Sensor status
  const checkPhenoSensor = useCallback(async () => {
    if (Platform.OS !== 'android' || !PhenotypingIdentity?.isAccessibilityServiceEnabled) {
      // In dev simulator, web, or iOS, check onboarding record
      try {
        const onboarded = await isPhenotypingOnboarded(userId);
        setPhenoSensorEnabled(!!onboarded);
      } catch {
        setPhenoSensorEnabled(false);
      }
      return;
    }
    try {
      const enabled = await PhenotypingIdentity.isAccessibilityServiceEnabled();
      setPhenoSensorEnabled(!!enabled);
    } catch {
      setPhenoSensorEnabled(false);
    }
  }, [userId]);

  // Open Android Accessibility settings so user can enable sensor
  const openPhenoSensorSettings = useCallback(() => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() => {
        Linking.openSettings().catch(() => { });
      });
    } else {
      Linking.openSettings().catch(() => { });
    }
  }, []);

  // Listen to AppState to re-check sensor status as soon as user returns from settings
  useEffect(() => {
    checkPhenoSensor();
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkPhenoSensor();
      }
    });
    return () => sub.remove();
  }, [checkPhenoSensor]);

  // ── Realtime Firebase Listener: phenotyping/users/${userId} ──
  useEffect(() => {
    if (!userId || userId.startsWith('guest_')) return;
    const profileRef = ref(db, `phenotyping/users/${userId}`);
    const handler = onValue(profileRef, async (snap) => {
      if (snap.exists()) {
        const p = snap.val();
        setPhenoProfile(p);
        const calib = computeCalibrationStatus({
          created_at: p.created_at,
          is_calibrated: p.is_calibrated,
        });
        const dayNum = calib.dayNumber || 1;
        setPhenoCalibStatus({
          ...calib,
          userName: p.display_name || username || userId,
          daysRemaining: Math.max(0, 7 - dayNum),
          windowsCollected: p.windows_collected || p.total_windows || 0,
          calibratedAt: p.calibrated_at || null,
        });
        try {
          await AsyncStorage.setItem(`@pheno_profile_${userId}`, JSON.stringify(p));
        } catch { }
      } else {
        // Check local AsyncStorage cache
        try {
          const cached = await AsyncStorage.getItem(`@pheno_profile_${userId}`);
          if (cached) {
            const cp = JSON.parse(cached);
            setPhenoProfile(cp);
            const calib = computeCalibrationStatus({
              created_at: cp.created_at,
              is_calibrated: cp.is_calibrated,
            });
            const dayNum = calib.dayNumber || 1;
            setPhenoCalibStatus({
              ...calib,
              userName: cp.display_name || username || userId,
              daysRemaining: Math.max(0, 7 - dayNum),
              windowsCollected: cp.windows_collected || 0,
            });
            return;
          }
        } catch { }

        // Fallback initial calibration state
        setPhenoCalibStatus(computeCalibrationStatus({
          created_at: new Date().toISOString(),
          is_calibrated: false,
        }));
      }
    }, async () => {
      try {
        const cached = await AsyncStorage.getItem(`@pheno_profile_${userId}`);
        if (cached) {
          const cp = JSON.parse(cached);
          setPhenoProfile(cp);
          setPhenoCalibStatus(computeCalibrationStatus(cp));
        }
      } catch { }
    });

    // Also listen to personal baselines
    const blRef = ref(db, `phenotyping/baselines/${userId}`);
    const blHandler = onValue(blRef, (snap) => {
      if (snap.exists()) setPhenoBaselines(snap.val());
    }, () => { });

    return () => {
      off(profileRef, 'value', handler);
      off(blRef, 'value', blHandler);
    };
  }, [userId, username]);

  // ── Realtime Firebase Listener: phenotyping/predictions/${userId} ──
  // Fetches real-time stress label and stress probability from phone phenotyping
  useEffect(() => {
    if (!userId || userId.startsWith('guest_')) return;
    const predQuery = query(ref(db, `phenotyping/predictions/${userId}`), orderByKey(), limitToLast(50));
    const handler = onValue(predQuery, async (snap) => {
      if (snap.exists()) {
        const raw = snap.val();
        const preds = Object.values(raw).sort((a, b) =>
          new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
        );
        const latest = preds[preds.length - 1];
        if (latest) {
          const lbl = (latest.label || 'normal').toLowerCase();
          const score = typeof latest.stress_score === 'number'
            ? Math.max(0, Math.min(1, latest.stress_score))
            : (typeof latest.probability === 'number' ? Math.max(0, Math.min(1, latest.probability)) : 0.15);

          setPhenoStressLabel(lbl);
          setPhenoStressProbability(score);
          setHasLivePhenoPacket(true);
          setPhenoTrendHistory(prev => {
            const next = [...prev, score];
            return next.slice(-12);
          });
          try {
            await AsyncStorage.setItem(`@pheno_pred_${userId}`, JSON.stringify(latest));
          } catch { }
        }
      } else {
        // Fallback to AsyncStorage cache
        try {
          const cached = await AsyncStorage.getItem(`@pheno_pred_${userId}`);
          if (cached) {
            const c = JSON.parse(cached);
            const lbl = (c.label || 'normal').toLowerCase();
            const score = typeof c.stress_score === 'number' ? c.stress_score : 0.15;
            setPhenoStressLabel(lbl);
            setPhenoStressProbability(score);
            setHasLivePhenoPacket(true);
          } else {
            setHasLivePhenoPacket(false);
          }
        } catch {
          setHasLivePhenoPacket(false);
        }
      }
    }, async () => {
      try {
        const cached = await AsyncStorage.getItem(`@pheno_pred_${userId}`);
        if (cached) {
          const c = JSON.parse(cached);
          setPhenoStressLabel((c.label || 'normal').toLowerCase());
          setPhenoStressProbability(typeof c.stress_score === 'number' ? c.stress_score : 0.15);
          setHasLivePhenoPacket(true);
        }
      } catch { }
    });
    return () => off(predQuery, 'value', handler);
  }, [userId]);

  // Action: Mark calibration completed to activate live behavioral AI model
  const markPhenoCalibrated = useCallback(async () => {
    if (!userId) return;
    try {
      const { markCalibrated } = require('../../../phenotyping/utils/calibrationStatus');
      await markCalibrated(userId);
    } catch (e) { }

    try {
      await update(ref(db, `phenotyping/users/${userId}`), {
        is_calibrated: true,
        calibrated_at: new Date().toISOString(),
      });
    } catch (e) { }

    setPhenoCalibStatus(prev => ({
      ...prev,
      isCalibrated: true,
      phase: 'active',
      progressPct: 100,
      displayDays: `Day ${prev?.dayNumber || 7}+`,
      title: 'Pre-stress predictions active',
    }));

    // Seed initial live prediction packet so live recovery streams right away
    try {
      const predRef = ref(db, `phenotyping/predictions/${userId}`);
      const initialPred = {
        timestamp: new Date().toISOString(),
        label: 'Normal',
        stress_score: 0.16,
        confidence: 0.90,
        signal_quality: 1.0,
        is_anomaly: false,
        model_type: 'idiographic_calibrated',
      };
      await push(predRef, initialPred);
      setPhenoStressLabel('normal');
      setPhenoStressProbability(0.16);
      setHasLivePhenoPacket(true);
      setPhenoTrendHistory(prev => [...prev.slice(-11), 0.16]);
    } catch (e) { }
  }, [userId]);

  // Action: Reset calibration to Day 6 baseline (for testing/demo flexibility)
  const resetPhenoCalibration = useCallback(async () => {
    if (!userId) return;
    try {
      await update(ref(db, `phenotyping/users/${userId}`), {
        is_calibrated: false,
        calibrated_at: null,
      });
    } catch (e) { }
    setPhenoCalibStatus(prev => ({
      ...prev,
      isCalibrated: false,
      phase: 'calibration',
      progressPct: Math.round(((prev?.dayNumber || 6) / 7) * 100),
      displayDays: `Day ${prev?.dayNumber || 6} of 7`,
      title: 'Calibrating baseline',
      daysRemaining: Math.max(0, 7 - (prev?.dayNumber || 6)),
    }));
  }, [userId]);

  // Active Intervention State
  const [currentRecommendation, setCurrentRecommendation] = useState(null);
  const [selectedSubOption, setSelectedSubOption] = useState(null);
  const [preInterventionLabel, setPreInterventionLabel] = useState('stress');
  const [postInterventionLabel, setPostInterventionLabel] = useState('normal');
  const [lastValidationResult, setLastValidationResult] = useState(null);

  // Suitability Warning Modal State
  const [suitabilityModalVisible, setSuitabilityModalVisible] = useState(false);
  const [suitabilityData, setSuitabilityData] = useState(null);

  // Real-time Trend Line History (2s Polling)
  const [stressTrendHistory, setStressTrendHistory] = useState([]);

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
        setStressState(telemetry.effective_label || 'normal');
        if (telemetry.raw_label) setRawLabel(telemetry.raw_label);
        if (telemetry.active_session_id) setActiveSessionId(telemetry.active_session_id);
        setIsSafetyOverride(telemetry.is_safety_override);
        setIsAlertTriggered(telemetry.is_alert_triggered);
        setTelemetryMessage(telemetry.message);
        if (typeof telemetry.has_live_packet === 'boolean') {
          setHasLivePacket(telemetry.has_live_packet);
        }
        setIsCalibrated(true);

        const prob = typeof telemetry.confidence === 'number'
          ? telemetry.confidence
          : (telemetry.features_flat && telemetry.features_flat.length >= 1 ? telemetry.features_flat[0] : 0.15);

        setStressProbability(prob);
        setConfidence(prob);

        if (telemetry.features_flat || typeof telemetry.confidence === 'number') {
          setStressTrendHistory(prev => {
            const nextArr = [...prev, prob];
            return nextArr.slice(-12);
          });
        }
      } catch (e) {
        console.warn('Telemetry polling error', e);
      }
    }, 2000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [userId, simMode]);

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
  };

  return (
    <AppContext.Provider
      value={{
        hostExit: onExit,
        identityChecked,
        currentScreen,
        setCurrentScreen,
        isDrawerOpen,
        setIsDrawerOpen,
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
        isCalibrated: true,
        setIsCalibrated,
        stressState,
        setStressState,
        rawLabel,
        activeSessionId,
        confidence,
        stressProbability,
        setStressProbability,
        stressTrendHistory,
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
        onboardingAnswers,
        setOnboardingAnswers,

        // Digital Phenotyping Telemetry & Sensor State
        phenoSensorEnabled,
        checkPhenoSensor,
        openPhenoSensorSettings,
        phenoProfile,
        phenoBaselines,
        phenoCalibStatus,
        phenoStressLabel,
        phenoStressProbability,
        hasLivePhenoPacket,
        phenoTrendHistory,
        markPhenoCalibrated,
        resetPhenoCalibration,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
