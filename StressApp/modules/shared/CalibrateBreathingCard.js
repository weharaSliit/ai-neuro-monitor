import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import axios from 'axios';
import physiologicalApi from '../physiological/api/client';
import { API_BASE, DEVICE_ID } from '../physiological/config/config';
import { COLORS } from '../physiological/config/theme';
import { eegClient } from './eegApiClient';
import StatusDot from './StatusDot';
import { useCalibrationSummary, useDeviceStatus, useSignupAge } from './CalibrationGate';

const RING_CONTACT_POLL_MS = 5000;

const IN_PROGRESS_STATUSES = ['settling', 'capturing', 'saving'];
const POLL_INTERVAL_MS = 2000;
const BREATH_TIMINGS = { inhale: 4000, hold: 4000, exhale: 4000, rest: 2000 };

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
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await statusFn();
        onUpdate(res.data);
        if (res.data?.status && !IN_PROGRESS_STATUSES.includes(res.data.status)) {
          stop();
        }
      } catch (e) {

      }
    }, POLL_INTERVAL_MS);
  }, [onUpdate, stop]);

  useEffect(() => () => stop(), [stop]);
  return run;
}
function DayBars({ label, status, signupAgeDays }) {
  if (!status?.ok) return null;
  const usingSignup = !status.exists;
  if (usingSignup && signupAgeDays == null) return null;

  const ageDays = usingSignup ? signupAgeDays : (status.age_days ?? 0);
  const filled = Math.min(7, Math.floor(ageDays));
  const softStale = usingSignup ? signupAgeDays >= 7 : status.is_stale_soft;
  const hardStale = usingSignup ? false : status.is_stale_hard;

  return (
    <View style={styles.dayBarsBlock}>
      <Text style={styles.dayBarsLabel}>{label}{usingSignup ? ' — since you joined' : ''}</Text>
      <View style={styles.dayBarsRow}>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <View key={d} style={[styles.dayBarFill, d <= filled ? styles.dayBarFillOn : styles.dayBarFillOff]} />
        ))}
      </View>
      {softStale && (
        <Text style={styles.dayBarsNote}>
          {hardStale ? 'Expired — recalibrate' : usingSignup ? '7 days reached — recommended to calibrate' : 'Recommended to recalibrate'}
        </Text>
      )}
    </View>
  );
}

// One row per device -- both Ring and Headband are started together by
// the single Calibrate button below, but each shows its own independent
// progress here (not a combined bar), since one can finish, fail, or get
// skipped for insufficient data well before the other does. A device
// that's simply not connected shows "Not connected" and is left alone --
// never attempted, never counted as failed, same as before.
function DeviceCalibrateRow({ label, expected, state, durationHint }) {
  const statusLabel = () => {
    if (!expected) return 'Not connected';
    if (!state.triggered) return 'Waiting to start…';
    if (state.status === 'error') return state.message || 'Failed';
    if (state.status === 'settling') return 'Settling…';
    if (state.status === 'saving') return 'Saving…';
    if (state.status === 'capturing') {
      return state.window_idx != null && state.n_windows != null
        ? `Capturing (${state.window_idx}/${state.n_windows})`
        : 'Capturing…';
    }
    return 'Done ✓';
  };

  return (
    <View style={styles.deviceCalibRow}>
      <View style={styles.deviceCalibLabelRow}>
        <StatusDot color={expected ? COLORS.normal : COLORS.light.border} active={expected} size={7} />
        <Text style={styles.deviceCalibLabel}>{label}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[
          styles.miniStatusText,
          !expected && { color: COLORS.light.textMuted },
          expected && state.status === 'error' && { color: COLORS.stress },
          expected && state.triggered && !IN_PROGRESS_STATUSES.includes(state.status) && state.status !== 'error' && { color: COLORS.normalDark },
        ]}>
          {statusLabel()}
        </Text>
        {expected && state.triggered && IN_PROGRESS_STATUSES.includes(state.status) && durationHint ? (
          <Text style={styles.miniStatusSub}>~{durationHint}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function CalibrateBreathingCard({ userId, token, eegDb, onComplete }) {
  const { ring, eeg, refresh } = useCalibrationSummary(userId, token);
  const signupAgeDays = useSignupAge(userId, eegDb);
  const { ringOnline, eegOnline, eegSessionId } = useDeviceStatus(userId, eegDb);
  const [stage, setStage] = useState('idle'); // idle | running | complete | error
  const [ringState, setRingState] = useState({ triggered: false, status: 'idle' });
  const [eegState, setEegState] = useState({ triggered: false, status: 'idle' });
  const [errorMsg, setErrorMsg] = useState(null);

  const runRing = useCaptureRunner((data) => setRingState((r) => ({ ...r, ...data })));
  const runEeg = useCaptureRunner((data) => setEegState((e) => ({ ...e, ...data })));

  // Single combined trigger -- one "Calibrate" action starts both Ring
  // and EEG together (whichever are actually online), same as the
  // original design; DeviceCalibrateRow below still shows each device's
  // own independent progress rather than one merged bar, since they
  // settle, fail, or get skipped on their own separate timelines.
  const start = useCallback(() => {
    if (!ringOnline && !eegOnline) {
      setErrorMsg('No device detected — connect your Ring or EEG headband first.');
      setStage('error');
      return;
    }

    setErrorMsg(null);
    setStage('running');

    if (ringOnline) {
      setRingState((r) => ({ ...r, triggered: true }));
      runRing(
        () => physiologicalApi.post('/calibrate/start', {}),
        () => physiologicalApi.get('/calibrate/status'),
      );
    }
    if (eegOnline && eegSessionId) {
      setEegState((e) => ({ ...e, triggered: true }));
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      runEeg(
        () => eegClient.post('/calibrate/start', { session_id: eegSessionId }, { headers }),
        () => eegClient.get('/calibrate/status', { headers }),
      );
    }
  }, [ringOnline, eegOnline, eegSessionId, token, runRing, runEeg]);

  // "Expected" (not just "triggered") is what actually gates completion --
  // a device that's online is expected to eventually be calibrated, even
  // before its button has been pressed, so completion correctly waits for
  // BOTH online devices to be individually started and finished, instead
  // of firing the moment just one of them settles because the other
  // "wasn't triggered yet" (which used to look identical to "not
  // available at all" when both devices shared one combined Start
  // button). A device that's genuinely offline is skipped entirely, same
  // as before.
  const ringExpected = ringOnline;
  const eegExpected = eegOnline && !!eegSessionId;

  useEffect(() => {
    if (stage !== 'running') return;
    if (!ringState.triggered && !eegState.triggered) return;

    const ringDone = !ringExpected || (ringState.triggered && !IN_PROGRESS_STATUSES.includes(ringState.status));
    const eegDone = !eegExpected || (eegState.triggered && !IN_PROGRESS_STATUSES.includes(eegState.status));
    if (!ringDone || !eegDone) return;

    const anyFailed = (ringState.triggered && ringState.status === 'error')
      || (eegState.triggered && eegState.status === 'error');
    if (anyFailed) {
      setErrorMsg((ringState.triggered && ringState.status === 'error' && ringState.message)
        || (eegState.triggered && eegState.status === 'error' && eegState.message)
        || 'Calibration failed');
      setStage('error');
    } else {
      setStage('complete');
    }
    refresh();
  }, [stage, ringState, eegState, ringExpected, eegExpected, refresh]);

  useEffect(() => {
    if (stage === 'complete' && onComplete) onComplete();
  }, [stage]);

  const retry = () => {
    setStage('idle');
    setErrorMsg(null);
    setRingState({ triggered: false, status: 'idle' });
    setEegState({ triggered: false, status: 'idle' });
  };

  const [ringFingerDetected, setRingFingerDetected] = useState(null);
  useEffect(() => {
    if (!(ringState.triggered && IN_PROGRESS_STATUSES.includes(ringState.status))) {
      setRingFingerDetected(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
        if (!cancelled) {
          setRingFingerDetected(res.data?.finger_detected === undefined ? null : !!res.data.finger_detected);
        }
      } catch {
        // leave last-known value on a transient failure
      }
    };
    poll();
    const id = setInterval(poll, RING_CONTACT_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [ringState.triggered, ringState.status]);

  const [breathPhase, setBreathPhase] = useState('inhale');
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.35)).current;
  const idlePulse = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const calibrating = stage === 'running';

  useEffect(() => {
    if (calibrating) return;
    idlePulse.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idlePulse, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(idlePulse, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [calibrating, idlePulse]);

  useEffect(() => {
    if (!calibrating) return;
    let timer;
    if (breathPhase === 'inhale') {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 1.35, duration: BREATH_TIMINGS.inhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 1, duration: BREATH_TIMINGS.inhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(rotateAnim, { toValue: 1, duration: BREATH_TIMINGS.inhale, easing: Easing.linear, useNativeDriver: true }),
      ]).start();
      timer = setTimeout(() => setBreathPhase('hold'), BREATH_TIMINGS.inhale);
    } else if (breathPhase === 'hold') {
      timer = setTimeout(() => setBreathPhase('exhale'), BREATH_TIMINGS.hold);
    } else if (breathPhase === 'exhale') {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 1, duration: BREATH_TIMINGS.exhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.35, duration: BREATH_TIMINGS.exhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]).start();
      timer = setTimeout(() => setBreathPhase('rest'), BREATH_TIMINGS.exhale);
    } else {
      timer = setTimeout(() => setBreathPhase('inhale'), BREATH_TIMINGS.rest);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [breathPhase, calibrating]);

  const displayScale = calibrating
    ? scaleAnim
    : idlePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const haloOpacity = calibrating
    ? glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] })
    : idlePulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.4] });

  const breathText = breathPhase === 'inhale' ? 'Breathe In'
    : breathPhase === 'hold' ? 'Hold'
      : breathPhase === 'exhale' ? 'Breathe Out' : 'Rest';

  return (
    <View style={styles.container}>
      <DayBars label="Ring" status={ring} signupAgeDays={signupAgeDays} />
      <DayBars label="EEG" status={eeg} signupAgeDays={signupAgeDays} />

      {/* Idle: a single combined Calibrate action, same real connectivity
          the trigger itself gates on. Once running, each device's own
          progress drops down below instead. */}
      {stage === 'idle' && (
        <Text style={styles.startLink} onPress={start}>Calibrate →</Text>
      )}

      {stage === 'running' && (
        <>
          <DeviceCalibrateRow label="Ring" expected={ringExpected} state={ringState} durationHint="3.5 minutes" />
          <DeviceCalibrateRow label="Headband" expected={eegExpected} state={eegState} durationHint="85 seconds" />
        </>
      )}

      <View style={styles.visualArea}>
        <Animated.View style={[styles.outerHalo, { opacity: haloOpacity, transform: [{ scale: displayScale }] }]}>
          <View style={styles.middleRing}>
            <Animated.View style={[styles.auraSphere, {
              transform: [{
                rotate: rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
              }],
            }]}>
              <View style={styles.auraCore}>
                <Text style={styles.breathText}>
                  {stage === 'running' ? breathText : stage === 'complete' ? '✓' : stage === 'error' ? '!' : '🌬️'}
                </Text>
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </View>

      {stage === 'running' && ringState.triggered && ringFingerDetected === false && (
        <Text style={styles.contactWarning}>⚠ No finger detected on the ring — adjust it for a clean reading</Text>
      )}

      {stage === 'complete' && (
        <Text style={styles.statusText}>Calibration complete — your baseline has been saved.</Text>
      )}
      {stage === 'error' && (
        <>
          <Text style={styles.statusText}>{errorMsg || 'Calibration failed'}</Text>
          <Text style={styles.startLink} onPress={retry}>Try Again</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dayBarsBlock: {
    width: '100%',
    marginBottom: 14,
  },
  dayBarsLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.light.textMuted,
    marginBottom: 6,
  },
  dayBarsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dayBarFill: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  dayBarFillOn: {
    backgroundColor: COLORS.brand,
  },
  dayBarFillOff: {
    backgroundColor: COLORS.light.border,
  },
  dayBarsNote: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.warningDark,
    marginTop: 4,
  },
  noDeviceText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.light.textMuted,
    textAlign: 'center',
    marginBottom: 10,
  },
  deviceCalibRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.light.border,
  },
  deviceCalibLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceCalibLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.light.text,
  },
  miniStartLink: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.brand,
  },
  miniStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.light.textMuted,
  },
  miniStatusSub: {
    fontSize: 10,
    color: COLORS.light.textMuted,
    marginTop: 1,
  },
  visualArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  outerHalo: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: COLORS.brandSoft,
    borderWidth: 1.5,
    borderColor: COLORS.brandLight + '60',
    alignItems: 'center',
    justifyContent: 'center',
  },
  middleRing: {
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor: COLORS.brandLight + '30',
    borderWidth: 1,
    borderColor: COLORS.brandLight + '80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraSphere: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: COLORS.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.brandDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  auraCore: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  breathText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.light.text,
    textAlign: 'center',
    marginTop: 4,
  },
  statusSub: {
    fontSize: 11,
    color: COLORS.light.textMuted,
    marginTop: 4,
  },
  contactWarning: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.warningDark,
    marginTop: 8,
    textAlign: 'center',
  },
  startLink: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.brand,
  },
});
