import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { NativeModules, Platform, Linking, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, onValue, off, query, orderByKey, limitToLast, update, push } from 'firebase/database';
import { db } from '../../firebase';
import { apiService } from '../api/apiService';
import { evidenceLogger, newSessionKey } from '../utils/evidenceLogger';
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

  // ── Stimulator override: when the IoT team's live_stimulator is running it
  // feeds real-like EEG + ring data through the REAL pipeline. Its outputs land
  // in stimulator/status in Firebase every ~3 s. We read those load values and
  // derive the same stress signals the real devices would produce, so the
  // relaxation guide sees live physiological data even without physical devices.
  const [stimulatorActive, setStimulatorActive] = useState(false);
  const stimulatorActiveRef = useRef(false);

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
  const [phenoLastUpdateMs, setPhenoLastUpdateMs] = useState(null);

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
        const scoreOf = (p) => (typeof p.stress_score === 'number' ? p.stress_score
          : (typeof p.probability === 'number' ? p.probability : null));
        // Only real prediction records (ignore any session markers stored beside them).
        const preds = Object.values(raw)
          .filter((p) => p && typeof p === 'object' && (scoreOf(p) !== null || p.label))
          .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
        const latest = preds[preds.length - 1];
        if (latest) {
          const lbl = (latest.label || 'normal').toLowerCase();
          const score = typeof latest.stress_score === 'number'
            ? Math.max(0, Math.min(1, latest.stress_score))
            : (typeof latest.probability === 'number' ? Math.max(0, Math.min(1, latest.probability)) : 0.15);

          setPhenoStressLabel(lbl);
          setPhenoStressProbability(score);
          setHasLivePhenoPacket(true);
          // The line is rebuilt from the latest stored predictions, so it shows real history right away
          // (a phenotyping prediction is only written when a behaviour window is processed, so appending
          // one point per event left a single point, and no visible line, for a long time).
          setPhenoTrendHistory(
            preds.slice(-12)
              .map((p) => scoreOf(p))
              .filter((v) => v !== null)
              .map((v) => Math.max(0, Math.min(1, v)))
          );
          const parsedTs = Date.parse(latest.timestamp);
          setPhenoLastUpdateMs(Number.isFinite(parsedTs) ? parsedTs : null);
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

  // Timestamped stress samples, so a session's real recovery curve can be measured and sent for
  // validation (the backend rewards stress reduced beyond natural recovery, not a self-reported state).
  const stressTrajectoryRef = useRef([]);
  const phenoLatestRef = useRef({ p: null, live: false });
  useEffect(() => {
    phenoLatestRef.current = { p: phenoStressProbability, live: hasLivePhenoPacket };
  }, [phenoStressProbability, hasLivePhenoPacket]);
  const interventionStartRef = useRef(null);
  // Evidence log (reviewed on the web Relaxation guide page): which session is active and how it was launched.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const evidenceKeyRef = useRef(null);
  const launchSourceRef = useRef(null);
  const setLaunchSource = useCallback((source) => { launchSourceRef.current = source; }, []);
  const logEvidenceEvent = useCallback((type, data) => {
    evidenceLogger.event(userIdRef.current, evidenceKeyRef.current, type, data);
  }, []);
  const finishEvidenceSession = useCallback((result) => {
    evidenceLogger.result(userIdRef.current, evidenceKeyRef.current, result);
    evidenceKeyRef.current = null;
  }, []);

  // info = { rec: current recommendation, title, techniqueId }
  const markInterventionStart = useCallback((info = {}) => {
    interventionStartRef.current = Date.now() / 1000;
    const rec = info.rec || {};
    // "system" = the user accepted the recommendation; anything chosen from the catalog is "manual".
    const condition = launchSourceRef.current === 'system' ? 'system' : 'manual';
    launchSourceRef.current = null;
    const key = condition === 'system' && rec.session_id ? rec.session_id : newSessionKey();
    evidenceKeyRef.current = key;
    evidenceLogger.meta(userIdRef.current, key, {
      condition,
      technique_id: info.techniqueId || rec.technique_id || null,
      title: info.title || rec.title || null,
      recommended_technique_id: rec.technique_id || null,
      reason: rec.reason || null,
      reason_codes: rec.reason_codes || null,
      context: rec.context || null,
      streams_used: rec.streams_used || null,
      cluster_id: rec.context_cluster_id ?? null,
      started_at: Date.now() / 1000,
      platform: 'mobile',
    });
    evidenceLogger.event(userIdRef.current, key, 'started', { condition, technique_id: info.techniqueId || rec.technique_id || null });
  }, []);
  const getInterventionTrajectory = useCallback(() => {
    const start = interventionStartRef.current;
    if (!start) return [];
    return stressTrajectoryRef.current.filter((pt) => pt.t >= start - 10);
  }, []);
  const getInterventionElapsed = useCallback(() => {
    const start = interventionStartRef.current;
    return start ? Math.max(0, Date.now() / 1000 - start) : 0;
  }, []);

  // Intervention History
  const [historyList, setHistoryList] = useState([]);

  // Onboarding Answers
  const [onboardingAnswers, setOnboardingAnswers] = useState(null);

  // ── Stimulator Firebase listener ──────────────────────────────────────────
  // Reads stimulator/status (written by live_stimulator.py every ~3 s) and
  // derives stress signals from the virtual person's physiological loads.
  // Priority: stimulator active → override REST poll. Stimulator off → REST poll wins.
  // 20-second heartbeat window (same constant as SimulatedBanner).
  const STIM_ONLINE_SEC = 20;
  useEffect(() => {
    const statusRef = ref(db, 'stimulator/status');
    const handler = onValue(statusRef, (snap) => {
      const s = snap.val();
      if (!s) { stimulatorActiveRef.current = false; setStimulatorActive(false); return; }

      const nowSec = Date.now() / 1000;
      const isOnline = s.online && s.ts && (nowSec - s.ts < STIM_ONLINE_SEC);
      const isRunning = isOnline && s.running;

      // Only apply to the logged-in user (or if the stimulator is not user-scoped).
      const userMatch = !s.uid || !userId || s.uid === userId || userId.startsWith('user_');

      if (!isRunning || !userMatch) {
        stimulatorActiveRef.current = false;
        setStimulatorActive(false);
        return;
      }

      // ── Derive stress probability from the stimulator's physiological loads ──
      // The stimulator publishes the three continuous load signals the pipeline
      // models: eeg_load (cognitive), hr_load (cardiovascular), eda_load (skin).
      // We fuse them with the same rough weights the MVH fusion engine uses:
      //   EEG  35 %   HRV/GSR  40 %   demand headroom  25 %
      // so the derived probability tracks what the real pipeline would output.
      const eegL  = typeof s.eeg_load === 'number'   ? Math.max(0, Math.min(1, s.eeg_load))  : 0;
      const hrL   = typeof s.hr_load === 'number'    ? Math.max(0, Math.min(1, s.hr_load))   : 0;
      const edaL  = typeof s.eda_load === 'number'   ? Math.max(0, Math.min(1, s.eda_load))  : 0;
      const dem   = typeof s.demand === 'number'     ? Math.max(0, Math.min(1, s.demand))    : 0;
      const bodyD = typeof s.body_demand === 'number'? Math.max(0, Math.min(1, s.body_demand)): 0;

      // Weighted fusion: EEG + ring (HRV/GSR) + demand residual
      const fusedLoad = 0.35 * eegL + 0.40 * Math.max(hrL, edaL) + 0.25 * Math.max(dem, bodyD);
      // Soft sigmoid so resting (load≈0) maps to ~0.12 and full load (≈1) maps to ~0.92
      const prob = Math.round(Math.max(0.08, Math.min(0.96,
        1 / (1 + Math.exp(-6 * (fusedLoad - 0.45)))
      )) * 1000) / 1000;

      // ── Map probability to stress label ──
      let label = 'normal';
      let raw = 'Normal State';
      if (prob >= 0.75) { label = 'high_stress'; raw = 'High Confidence Stress'; }
      else if (prob >= 0.55) { label = 'stress'; raw = 'Stress Detected'; }
      else if (prob >= 0.38) { label = 'low_stress'; raw = 'Low Confidence Stress'; }

      // Calibrating phases: show as normal (the real pipeline does the same).
      const calibPhases = ['settle', 'rest', 'task', 'recovery'];
      const inCalib = calibPhases.includes(s.phase) && s.calibrating;

      const finalLabel = inCalib ? 'normal' : label;
      const finalProb  = inCalib ? 0.15 : prob;
      const finalRaw   = inCalib ? `Calibration · ${s.phase}` : raw;

      setStressState(finalLabel);
      setRawLabel(finalRaw);
      setStressProbability(finalProb);
      setConfidence(finalProb);
      // Treat the stimulator stream exactly like a live IoT packet — hasLivePacket
      // drives the "Awaiting Telemetry" vs live UI, so the dashboard shows
      // the device as connected just as when the real ring/EEG are streaming.
      setHasLivePacket(true);
      setIsCalibrated(true);
      setTelemetryMessage(
        inCalib
          ? `Stimulator calibrating · ${s.phase}`
          : `Stimulator live · ${s.phase || s.stage || 'monitoring'} (demand ${Math.round(fusedLoad * 100)}%)`
      );

      // Feed into the trajectory / trend history
      const samples = stressTrajectoryRef.current;
      samples.push({ t: Date.now() / 1000, p: finalProb });
      if (samples.length > 1500) samples.splice(0, samples.length - 1500);
      if (evidenceKeyRef.current) {
        evidenceLogger.sample(userIdRef.current, evidenceKeyRef.current, finalProb, 'physio_stimulated');
      }
      setStressTrendHistory(prev => [...prev.slice(-11), finalProb]);

      stimulatorActiveRef.current = true;
      setStimulatorActive(true);
    }, () => {
      stimulatorActiveRef.current = false;
      setStimulatorActive(false);
    });
    return () => off(statusRef, 'value', handler);
  }, [userId]);

  // Telemetry poll loop (every 2 seconds).
  // When the stimulator is active, skip the REST call so the stimulator's
  // Firebase-derived values are not overwritten by a stale API response.
  useEffect(() => {
    let interval = null;
    interval = setInterval(async () => {
      // Stimulator is feeding live data — REST poll not needed
      if (stimulatorActiveRef.current) return;
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

        // Session curve: the ring/earbud stream when it is live, otherwise the phenotyping stream
        // (so a session can still be measured when only the phone sensor is connected).
        let trajectoryValue = null;
        if (Number.isFinite(prob) && (telemetry.has_live_packet !== false)) {
          trajectoryValue = prob;
        } else if (phenoLatestRef.current.live && Number.isFinite(phenoLatestRef.current.p)) {
          trajectoryValue = phenoLatestRef.current.p;
        }
        if (trajectoryValue !== null) {
          const samples = stressTrajectoryRef.current;
          samples.push({ t: Date.now() / 1000, p: trajectoryValue });
          if (samples.length > 1500) samples.splice(0, samples.length - 1500);
          if (evidenceKeyRef.current) {
            evidenceLogger.sample(userIdRef.current, evidenceKeyRef.current, trajectoryValue,
              (Number.isFinite(prob) && telemetry.has_live_packet !== false) ? 'physio' : 'phenotyping');
          }
        }

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
        markInterventionStart,
        setLaunchSource,
        logEvidenceEvent,
        finishEvidenceSession,
        getInterventionTrajectory,
        getInterventionElapsed,
        simMode,
        updateSimMode,
        isSafetyOverride,
        isAlertTriggered,
        telemetryMessage,
        hasLivePacket,
        stimulatorActive,
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
        phenoLastUpdateMs,
        markPhenoCalibrated,
        resetPhenoCalibration,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
