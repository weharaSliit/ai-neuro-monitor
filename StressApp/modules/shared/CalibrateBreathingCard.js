import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import axios from 'axios';
import physiologicalApi from '../physiological/api/client';
import { API_BASE, DEVICE_ID } from '../physiological/config/config';
import { COLORS } from '../physiological/config/theme';
import { eegClient } from './eegApiClient';
import Icon from './Icon';
import { useCalibrationSummary, useDeviceStatus } from './CalibrationGate';
import LiveCalibrationGraphs from './LiveCalibrationGraphs';

// ============================================================
// CalibrateBreathingCard -- calm-breathing baseline calibration.
// Same calls and rules as before (one Start button runs Ring + Headband
// together, whichever are online; each device reports its own progress;
// completion waits for every online device). Only the presentation is
// new, and matches the website's version (web/src/components/
// BreathingCalibration.jsx):
//   idle     -> plain explanation, which devices will be used, Start
//   running  -> breathing circle inside a progress ring (% + time left),
//               one progress bar per device in plain words
//   complete -> clear "saved" state; error -> friendly retry
// ============================================================

const RING_CONTACT_POLL_MS = 5000;
const IN_PROGRESS_STATUSES = ['settling', 'capturing', 'saving'];
const POLL_INTERVAL_MS = 2000;
const BREATH_TIMINGS = { inhale: 4000, hold: 4000, exhale: 4000, rest: 2000 };
// Expected end-to-end durations (settle + capture), used for the progress
// estimate and "time left" -- same figures the old card showed as text.
const EXPECTED_SEC = { ring: 210, eeg: 85 };
const ORB = 190;
const RING_STROKE = 8;

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
        // a single missed poll doesn't mean it failed -- the next tick tries again
      }
    }, POLL_INTERVAL_MS);
  }, [onUpdate, stop]);

  useEffect(() => () => stop(), [stop]);
  return run;
}

// 0..1 progress for one device, or null when it isn't taking part.
function deviceProgress(state, expected, elapsedSec, totalSec) {
  if (!expected) return null;
  if (!state.triggered) return 0;
  if (state.status === 'error') return 0;
  if (!IN_PROGRESS_STATUSES.includes(state.status)) return 1;
  const timeFrac = Math.min(0.95, elapsedSec / totalSec);
  if (state.status === 'saving') return 0.97;
  if (state.status === 'capturing' && state.window_idx != null && state.n_windows) {
    return Math.min(0.96, Math.max(timeFrac, 0.15 + 0.8 * (state.window_idx / state.n_windows)));
  }
  return timeFrac;
}

function deviceWords(state, expected) {
  if (!expected) return 'Not connected — skipped';
  if (!state.triggered) return 'Getting ready…';
  if (state.status === 'error') return state.message || 'Something went wrong';
  if (state.status === 'settling') return 'Letting the sensor settle…';
  if (state.status === 'capturing') {
    return state.window_idx != null && state.n_windows != null
      ? `Learning your calm (${state.window_idx} of ${state.n_windows})`
      : 'Learning your calm…';
  }
  if (state.status === 'saving') return 'Saving…';
  return 'Done ✓';
}

function freshnessLine(ring, eeg) {
  const sides = [ring, eeg].filter((s) => s?.ok !== false && s?.exists && s.age_days != null);
  if (!sides.length) return { text: 'Not calibrated yet — this takes about 3½ minutes.', warn: true };
  const age = Math.min(...sides.map((s) => s.age_days));
  const days = Math.floor(age);
  const when = days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const stale = sides.some((s) => s.is_stale_soft);
  return {
    text: `Last calibrated ${when}${stale ? ' — time to recalibrate.' : ' — recalibrate about once a week.'}`,
    warn: stale,
  };
}

function DeviceProgressRow({ icon, tint, label, words, progress, failed }) {
  const off = progress == null;
  return (
    <View style={styles.devRow}>
      <View style={[styles.devIcon, { backgroundColor: (off ? COLORS.light.border : tint) + '22' }]}>
        <Icon name={icon} size={16} color={off ? COLORS.light.textMuted : tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.devHead}>
          <Text style={styles.devLabel}>{label}</Text>
          {!off && <Text style={styles.devPct}>{Math.round(progress * 100)}%</Text>}
        </View>
        <Text style={[styles.devWords, failed && { color: COLORS.stressDark }]} numberOfLines={2}>{words}</Text>
        {!off && (
          <View style={styles.barBg}>
            <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: failed ? COLORS.stress : tint }]} />
          </View>
        )}
      </View>
    </View>
  );
}

export default function CalibrateBreathingCard({ userId, token, eegDb, onComplete }) {
  const { ring, eeg, refresh } = useCalibrationSummary(userId, token);
  const { ringOnline, eegOnline, eegSessionId } = useDeviceStatus(userId, eegDb);
  const [stage, setStage] = useState('idle'); // idle | running | complete | error
  const [ringState, setRingState] = useState({ triggered: false, status: 'idle' });
  const [eegState, setEegState] = useState({ triggered: false, status: 'idle' });
  const [errorMsg, setErrorMsg] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const runRing = useCaptureRunner((data) => setRingState((r) => ({ ...r, ...data })));
  const runEeg = useCaptureRunner((data) => setEegState((e) => ({ ...e, ...data })));

  // Single combined trigger -- one Start runs Ring and EEG together
  // (whichever are actually online); each still reports its own progress.
  const start = useCallback(() => {
    if (!ringOnline && !eegOnline) {
      setErrorMsg('No device detected — turn on and wear your ring or headband first.');
      setStage('error');
      return;
    }
    setErrorMsg(null);
    setStartedAt(Date.now());
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

  // "Expected" (online), not just "triggered", gates completion -- an
  // online device must be started AND finish; an offline one is skipped.
  const ringExpected = ringOnline;
  const eegExpected = eegOnline && !!eegSessionId;

  // eegSessionId can arrive a moment after Start (fresh registration) --
  // fire a device the moment it becomes expected while already running.
  useEffect(() => {
    if (stage !== 'running') return;
    if (ringExpected && !ringState.triggered) {
      setRingState((r) => ({ ...r, triggered: true }));
      runRing(
        () => physiologicalApi.post('/calibrate/start', {}),
        () => physiologicalApi.get('/calibrate/status'),
      );
    }
    if (eegExpected && !eegState.triggered) {
      setEegState((e) => ({ ...e, triggered: true }));
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      runEeg(
        () => eegClient.post('/calibrate/start', { session_id: eegSessionId }, { headers }),
        () => eegClient.get('/calibrate/status', { headers }),
      );
    }
  }, [stage, ringExpected, eegExpected, ringState.triggered, eegState.triggered, eegSessionId, token, runRing, runEeg]);

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

  // 1s clock for the progress estimate / time left.
  useEffect(() => {
    if (stage !== 'running') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const retry = () => {
    setStage('idle');
    setErrorMsg(null);
    setStartedAt(null);
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

  // ── Breathing pacer ──
  const [breathPhase, setBreathPhase] = useState('inhale');
  const scaleAnim = useRef(new Animated.Value(0.82)).current;
  const idlePulse = useRef(new Animated.Value(0)).current;
  const calibrating = stage === 'running';

  useEffect(() => {
    if (calibrating) return undefined;
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
    if (!calibrating) return undefined;
    let timer;
    if (breathPhase === 'inhale') {
      Animated.timing(scaleAnim, { toValue: 1, duration: BREATH_TIMINGS.inhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
      timer = setTimeout(() => setBreathPhase('hold'), BREATH_TIMINGS.inhale);
    } else if (breathPhase === 'hold') {
      timer = setTimeout(() => setBreathPhase('exhale'), BREATH_TIMINGS.hold);
    } else if (breathPhase === 'exhale') {
      Animated.timing(scaleAnim, { toValue: 0.82, duration: BREATH_TIMINGS.exhale, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
      timer = setTimeout(() => setBreathPhase('rest'), BREATH_TIMINGS.exhale);
    } else {
      timer = setTimeout(() => setBreathPhase('inhale'), BREATH_TIMINGS.rest);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [breathPhase, calibrating]);

  const breathText = breathPhase === 'inhale' ? 'Breathe in'
    : breathPhase === 'hold' ? 'Hold'
      : breathPhase === 'exhale' ? 'Breathe out' : 'Rest';

  // ── Progress ──
  const elapsedSec = startedAt ? (now - startedAt) / 1000 : 0;
  const ringP = deviceProgress(ringState, ringExpected, elapsedSec, EXPECTED_SEC.ring);
  const eegP = deviceProgress(eegState, eegExpected, elapsedSec, EXPECTED_SEC.eeg);
  const parts = [ringP, eegP].filter((p) => p != null);
  const overall = stage === 'complete' ? 1 : parts.length ? Math.min(...parts) : 0;
  const longest = Math.max(ringExpected ? EXPECTED_SEC.ring : 0, eegExpected ? EXPECTED_SEC.eeg : 0);
  const leftSec = Math.max(0, Math.round(longest - elapsedSec));
  const leftText = leftSec > 60 ? `about ${Math.ceil(leftSec / 60)} min left` : leftSec > 0 ? `about ${leftSec}s left` : 'finishing up…';

  const R = (ORB - RING_STROKE) / 2;
  const C = 2 * Math.PI * R;
  const fresh = freshnessLine(ring, eeg);
  const orbScale = calibrating ? scaleAnim : idlePulse.interpolate({ inputRange: [0, 1], outputRange: [0.86, 0.92] });

  return (
    <View style={styles.container}>
      {stage === 'idle' && (
        <View style={[styles.freshness, { backgroundColor: fresh.warn ? COLORS.warningSoft : COLORS.normalSoft }]}>
          <Icon name={fresh.warn ? 'clock-alert-outline' : 'check-circle-outline'} size={16}
            color={fresh.warn ? COLORS.warningDark : COLORS.normalDark} />
          <Text style={[styles.freshnessText, { color: fresh.warn ? COLORS.warningDark : COLORS.normalDark }]}>{fresh.text}</Text>
        </View>
      )}

      {/* Breathing orb inside a progress ring */}
      <View style={styles.orbWrap}>
        <Svg width={ORB} height={ORB} style={StyleSheet.absoluteFill}>
          <Circle cx={ORB / 2} cy={ORB / 2} r={R} stroke={COLORS.light.borderSoft} strokeWidth={RING_STROKE} fill="none" />
          {(calibrating || stage === 'complete') && (
            <Circle
              cx={ORB / 2} cy={ORB / 2} r={R}
              stroke={stage === 'complete' ? COLORS.normal : COLORS.brand}
              strokeWidth={RING_STROKE} fill="none" strokeLinecap="round"
              strokeDasharray={`${C} ${C}`} strokeDashoffset={C * (1 - overall)}
              transform={`rotate(-90 ${ORB / 2} ${ORB / 2})`}
            />
          )}
        </Svg>
        <Animated.View style={[styles.orb, {
          backgroundColor: stage === 'complete' ? COLORS.normal : stage === 'error' ? COLORS.stress : COLORS.brand,
          transform: [{ scale: orbScale }],
        }]}>
          <Text style={styles.orbWord}>
            {calibrating ? breathText : stage === 'complete' ? '✓' : stage === 'error' ? '!' : '🌬️'}
          </Text>
          {calibrating && <Text style={styles.orbPct}>{Math.round(overall * 100)}%</Text>}
        </Animated.View>
      </View>

      {stage === 'idle' && (
        <>
          <Text style={styles.lead}>Sit comfortably, keep still, and breathe slowly with the circle.</Text>
          <Text style={styles.sub}>We learn what “calm” looks like for you. It takes about 3½ minutes.</Text>
          <View style={styles.chipsRow}>
            <View style={[styles.chip, { backgroundColor: ringOnline ? COLORS.normalSoft : COLORS.light.pillBg }]}>
              <Icon name="heart-pulse" size={14} color={ringOnline ? COLORS.normalDark : COLORS.light.textMuted} />
              <Text style={[styles.chipText, { color: ringOnline ? COLORS.normalDark : COLORS.light.textMuted }]}>
                Ring {ringOnline ? 'ready' : 'off'}
              </Text>
            </View>
            <View style={[styles.chip, { backgroundColor: eegOnline ? COLORS.normalSoft : COLORS.light.pillBg }]}>
              <Icon name="brain" size={14} color={eegOnline ? COLORS.normalDark : COLORS.light.textMuted} />
              <Text style={[styles.chipText, { color: eegOnline ? COLORS.normalDark : COLORS.light.textMuted }]}>
                Headband {eegOnline ? 'ready' : 'off'}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.startBtn, !ringOnline && !eegOnline && styles.startBtnOff]} onPress={start} activeOpacity={0.85}>
            <Icon name="play" size={18} color="#FFFFFF" />
            <Text style={styles.startBtnText}>Start calibration</Text>
          </TouchableOpacity>
          {!ringOnline && !eegOnline && (
            <Text style={styles.sub}>Turn on and wear at least one device first.</Text>
          )}
        </>
      )}

      {stage === 'running' && (
        <>
          <Text style={styles.lead}>{breathText === 'Rest' ? 'Relax…' : `${breathText}…`}</Text>
          <Text style={styles.sub}>{leftText} · keep still</Text>
          <View style={styles.devices}>
            <DeviceProgressRow icon="heart-pulse" tint={COLORS.hrv} label="Ring" progress={ringP}
              words={deviceWords(ringState, ringExpected)} failed={ringState.status === 'error'} />
            <DeviceProgressRow icon="brain" tint={COLORS.warning} label="Headband" progress={eegP}
              words={deviceWords(eegState, eegExpected)} failed={eegState.status === 'error'} />
          </View>
          {ringState.triggered && ringFingerDetected === false && (
            <View style={[styles.freshness, { backgroundColor: COLORS.warningSoft, marginTop: 12 }]}>
              <Icon name="alert-outline" size={16} color={COLORS.warningDark} />
              <Text style={[styles.freshnessText, { color: COLORS.warningDark }]}>No finger on the ring — adjust it for a clean reading.</Text>
            </View>
          )}
        </>
      )}

      {stage === 'complete' && (
        <>
          <Text style={styles.lead}>All done — your calm baseline is saved.</Text>
          <Text style={styles.sub}>Your readings are now judged against your own body.</Text>
        </>
      )}

      {stage === 'error' && (
        <>
          <Text style={[styles.lead, { color: COLORS.stressDark }]}>{errorMsg || 'Calibration failed'}</Text>
          <TouchableOpacity style={styles.startBtn} onPress={retry} activeOpacity={0.85}>
            <Icon name="refresh" size={18} color="#FFFFFF" />
            <Text style={styles.startBtnText}>Try again</Text>
          </TouchableOpacity>
        </>
      )}

      {stage !== 'idle' && (
        <LiveCalibrationGraphs phase="baseline" ringOnline={ringOnline} eegOnline={eegOnline} token={token} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 4 },
  freshness: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch',
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginBottom: 6,
  },
  freshnessText: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  orbWrap: { width: ORB, height: ORB, alignItems: 'center', justifyContent: 'center', marginVertical: 14 },
  orb: {
    width: ORB - 40, height: ORB - 40, borderRadius: (ORB - 40) / 2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.brandDark, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 6,
  },
  orbWord: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  orbPct: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '800', marginTop: 2 },
  lead: { fontSize: 15, fontWeight: '800', color: COLORS.light.text, textAlign: 'center' },
  sub: { fontSize: 12, fontWeight: '600', color: COLORS.light.textMuted, textAlign: 'center', marginTop: 4, lineHeight: 17 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  chipText: { fontSize: 12, fontWeight: '800' },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch',
    marginTop: 16, paddingVertical: 14, borderRadius: 16, backgroundColor: COLORS.brand,
    shadowColor: COLORS.brandDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 3,
  },
  startBtnOff: { opacity: 0.55 },
  startBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  devices: { alignSelf: 'stretch', marginTop: 16, gap: 12 },
  devRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  devIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  devHead: { flexDirection: 'row', justifyContent: 'space-between' },
  devLabel: { fontSize: 13, fontWeight: '800', color: COLORS.light.text },
  devPct: { fontSize: 12, fontWeight: '800', color: COLORS.light.textSub },
  devWords: { fontSize: 12, fontWeight: '600', color: COLORS.light.textMuted, marginTop: 1 },
  barBg: { height: 8, borderRadius: 4, backgroundColor: COLORS.light.borderSoft, marginTop: 6, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
});
