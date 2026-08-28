import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import { ref, get, update } from 'firebase/database';
import { db } from '../../firebase';
import { useAuth } from '../../../../context/AuthContext';
import { AppContext } from '../context/AppContext';
import physiologicalApi from '../../../physiological/api/client';
import { API_BASE, DEVICE_ID } from '../../../physiological/config/config';
import { eegClient } from '../../../shared/eegApiClient';

const IN_PROGRESS_STATUSES = ['settling', 'capturing', 'saving'];
const POLL_INTERVAL_MS = 2000;

// Breathing cycle timing (in milliseconds) -- purely the visual pace, no
// relation to how long the underlying capture actually takes (Ring
// ~210s, EEG ~85s -- see the capture status text instead).
const BREATH_TIMINGS = { inhale: 4000, hold: 2000, exhale: 4000, rest: 1000 };

// -- one modality's capture: start it, poll until it leaves settling/
// capturing/saving, report status changes back via onUpdate. Shared shape
// for Ring and EEG -- they differ only in which client/session_id to use.
function useCaptureRunner(onUpdate) {
  const pollRef = useRef(null);
  const stop = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const run = useCallback(async (startFn, statusFn) => {
    onUpdate({ status: 'settling' });
    try {
      await startFn();
    } catch (e) {
      if (e?.response?.status !== 409) {
        onUpdate({ status: 'error', message: e?.response?.data?.error || e.message });
        return;
      }
      // 409 -- already in progress somewhere; just start watching it.
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await statusFn();
        onUpdate(res.data);
        if (res.data?.status && !IN_PROGRESS_STATUSES.includes(res.data.status)) {
          stop();
        }
      } catch (e) {
        // A single missed poll doesn't mean the capture failed -- Render
        // cold starts can drop one request; the next tick tries again.
      }
    }, POLL_INTERVAL_MS);
  }, [onUpdate, stop]);

  useEffect(() => () => stop(), [stop]);
  return run;
}

export const BreathingLightGame = ({ onCalibrationComplete }) => {
  const { token } = useAuth();
  const { setCurrentScreen } = useContext(AppContext);

  // -- Breathing visual state (unchanged animation, no game mechanics) --
  const [breathPhase, setBreathPhase] = useState('inhale');
  const [gameState, setGameState] = useState('ready');
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  // -- Calibration orchestration state --
  // 'detecting' | 'no_device' | 'running' | 'complete' | 'error'
  const [stage, setStage] = useState('detecting');
  const [ring, setRing] = useState({ triggered: false, status: 'idle' });
  const [eeg, setEeg] = useState({ triggered: false, status: 'idle' });
  const [errorMsg, setErrorMsg] = useState(null);
  const combinedWrittenRef = useRef(false);

  const runRing = useCaptureRunner((data) => setRing((r) => ({ ...r, ...data })));
  const runEeg = useCaptureRunner((data) => setEeg((e) => ({ ...e, ...data })));

  // Device detection on mount -- Ring via its device-status endpoint (same
  // check FusionSessionScreen.js already does), EEG via the live
  // psychological/current_session_id Firebase pointer (same one
  // StressApp/context/AuthContext.js's CURRENT_SESSION_ID_ROOTS mints at
  // login and shares across psychological/fusion_en/fusion_en_sessions --
  // also exactly the id the combined-calibration write below nests under).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let ringOnline = false;
      let eegSessionId = null;
      try {
        const res = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
        ringOnline = (res.data?.status || 'offline') === 'online';
      } catch (e) {
        ringOnline = false;
      }
      try {
        const snap = await get(ref(db, 'psychological/current_session_id'));
        eegSessionId = snap.val() || null;
      } catch (e) {
        eegSessionId = null;
      }
      if (cancelled) return;

      if (!ringOnline && !eegSessionId) {
        setStage('no_device');
        return;
      }

      setStage('running');
      if (ringOnline) {
        setRing((r) => ({ ...r, triggered: true }));
        runRing(
          () => physiologicalApi.post('/calibrate/start', {}),
          () => physiologicalApi.get('/calibrate/status'),
        );
      }
      if (eegSessionId) {
        setEeg((e) => ({ ...e, triggered: true }));
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        runEeg(
          () => eegClient.post('/calibrate/start', { session_id: eegSessionId }, { headers }),
          () => eegClient.get('/calibrate/status', { headers }),
        );
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aggregate completion: once every triggered modality has left
  // settling/capturing/saving, write the combined record (only if BOTH
  // were triggered and both actually succeeded) and hand off.
  useEffect(() => {
    if (stage !== 'running') return;
    const ringSettled = !ring.triggered || !IN_PROGRESS_STATUSES.includes(ring.status);
    const eegSettled = !eeg.triggered || !IN_PROGRESS_STATUSES.includes(eeg.status);
    if (!ringSettled || !eegSettled) return;

    const ringOk = ring.triggered && ring.status === 'done';
    const eegOk = eeg.triggered && eeg.status === 'done';
    const anyFailed = (ring.triggered && ring.status === 'error') || (eeg.triggered && eeg.status === 'error');

    (async () => {
      if (ring.triggered && eeg.triggered && ringOk && eegOk && !combinedWrittenRef.current) {
        combinedWrittenRef.current = true;
        try {
          const snap = await get(ref(db, 'psychological/current_session_id'));
          const userIdSnap = await get(ref(db, 'psychological/current_user_id'));
          const sessionId = snap.val();
          const userId = userIdSnap.val();
          if (sessionId && userId) {
            await update(ref(db), {
              [`fusion_en_sessions/${userId}/${sessionId}/combined_calibration`]: {
                at: new Date().toISOString(),
                ring_calibrated: true,
                eeg_calibrated: true,
                session_id: sessionId,
              },
            });
          }
        } catch (e) {
          // Best-effort marker -- each modality's own baseline is already
          // saved regardless, so a failed combined-write here isn't fatal.
        }
      }
      if (anyFailed) {
        setErrorMsg((ring.triggered && ring.status === 'error' && ring.message)
          || (eeg.triggered && eeg.status === 'error' && eeg.message)
          || 'Calibration failed');
        setStage('error');
      } else {
        setStage('complete');
      }
    })();
  }, [stage, ring, eeg]);

  // Breathing cycle -- only runs while a capture is actually in progress.
  const calibrating = stage === 'running';
  useEffect(() => {
    if (!calibrating) return;

    if (gameState === 'ready') {
      const timer = setTimeout(() => setGameState('breathing'), 1000);
      return () => clearTimeout(timer);
    }

    let timer;
    switch (breathPhase) {
      case 'inhale':
        Animated.parallel([
          Animated.timing(scaleAnim, { toValue: 1.6, duration: BREATH_TIMINGS.inhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 1, duration: BREATH_TIMINGS.inhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(rotateAnim, { toValue: 1, duration: BREATH_TIMINGS.inhale, easing: Easing.linear, useNativeDriver: true }),
        ]).start();
        timer = setTimeout(() => { setBreathPhase('hold'); setGameState('holding'); }, BREATH_TIMINGS.inhale);
        break;

      case 'hold':
        Animated.timing(glowAnim, { toValue: 1.2, duration: BREATH_TIMINGS.hold, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
        timer = setTimeout(() => { setBreathPhase('exhale'); setGameState('exhaling'); }, BREATH_TIMINGS.hold);
        break;

      case 'exhale':
        Animated.parallel([
          Animated.timing(scaleAnim, { toValue: 1, duration: BREATH_TIMINGS.exhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.3, duration: BREATH_TIMINGS.exhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]).start();
        timer = setTimeout(() => {
          setBreathPhase('rest');
          setGameState('ready');
          setTimeout(() => { setBreathPhase('inhale'); setGameState('breathing'); }, BREATH_TIMINGS.rest);
        }, BREATH_TIMINGS.exhale);
        break;

      default:
        break;
    }

    return () => { if (timer) clearTimeout(timer); };
  }, [breathPhase, gameState, calibrating]);

  const getBreathInfo = () => {
    switch (breathPhase) {
      case 'inhale': return { icon: '🌬️', color: '#818CF8', text: 'BREATHE IN' };
      case 'hold': return { icon: '⏸️', color: '#60A5FA', text: 'HOLD' };
      case 'exhale': return { icon: '😮‍💨', color: '#FBBF24', text: 'BREATHE OUT' };
      default: return { icon: '✨', color: '#818CF8', text: 'READY' };
    }
  };
  const breathInfo = getBreathInfo();

  const durationHint = ring.triggered ? '~3.5 minutes' : eeg.triggered ? '~85 seconds' : '';

  const statusText = () => {
    if (stage === 'detecting') return 'Looking for your Ring / EEG headband…';
    if (stage === 'no_device') return 'No device detected — connect your Ring or EEG headband first';
    if (stage === 'error') return errorMsg || 'Calibration failed';
    if (stage === 'complete') return 'Calibration complete — your baseline has been saved.';
    const anySettling = (ring.triggered && ring.status === 'settling') || (eeg.triggered && eeg.status === 'settling');
    const anySaving = (ring.triggered && ring.status === 'saving') || (eeg.triggered && eeg.status === 'saving');
    if (anySettling) return 'Settling — first few seconds discarded';
    if (anySaving) return 'Saving your personal baseline…';
    return 'Capturing — sit still and breathe calmly';
  };

  return (
    <View style={styles.container}>
      <View style={styles.bgGradient} />

      {/* Main breathing sphere */}
      <Animated.View
        style={[
          styles.sphereContainer,
          {
            transform: [
              { scale: scaleAnim },
              { rotate: rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
            ],
          },
        ]}
      >
        <Animated.View style={[
          styles.auraSphere,
          {
            opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
            shadowOpacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.9] }),
          },
        ]}>
          <View style={styles.auraCore}>
            {stage === 'detecting' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.breathIcon}>{breathInfo.icon}</Text>
            )}
          </View>
        </Animated.View>
      </Animated.View>

      {/* Breath phase readout */}
      {calibrating && (
        <View style={styles.progressContainer}>
          <View style={styles.progressCircle}>
            <Text style={styles.breathPhaseText}>{breathInfo.text}</Text>
          </View>
        </View>
      )}

      {/* Calibration status */}
      <View style={styles.statusPanel}>
        <Text style={styles.statusTitle}>Calibrate — Calm Breathing</Text>
        <Text style={styles.statusBody}>{statusText()}</Text>
        {calibrating && durationHint ? (
          <Text style={styles.statusSub}>Expected duration: {durationHint}</Text>
        ) : null}
        {(stage === 'no_device' || stage === 'error') && (
          <TouchableOpacity style={styles.backBtn} onPress={() => setCurrentScreen('SubOptionSelector')}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        {stage === 'complete' && (
          <TouchableOpacity style={styles.backBtn} onPress={() => onCalibrationComplete && onCalibrationComplete()}>
            <Text style={styles.backBtnText}>Done →</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0A2A',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  bgGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0F0A2A',
  },
  sphereContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  auraSphere: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#818CF8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#818CF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 50,
    elevation: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  auraCore: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  breathIcon: {
    fontSize: 32,
  },
  progressContainer: {
    position: 'absolute',
    bottom: 160,
    alignItems: 'center',
  },
  progressCircle: {
    backgroundColor: 'rgba(15, 10, 42, 0.8)',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.2)',
    alignItems: 'center',
  },
  breathPhaseText: {
    color: '#C7D2FE',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 2,
  },
  statusPanel: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(15, 10, 42, 0.85)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.2)',
    padding: 16,
    alignItems: 'center',
  },
  statusTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  statusBody: {
    color: '#C7D2FE',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  statusSub: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 6,
  },
  backBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: '#818CF8',
  },
  backBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
