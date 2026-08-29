// ============================================================
// EegThresholdTaskScreen.js
//
// Onboarding personal-threshold calibration for BOTH components: a short
// (75s) deliberate mental-arithmetic task run right after resting-baseline
// calibration (AccountSetupScreen's CalibrateBreathingCard), so each
// modality's own high-load/stress threshold can be derived from how THIS
// user's own score moves between Rest and Task, instead of a fixed
// population value -- see:
//   - backend/psychological/sam40/decision.py::compute_personal_threshold()
//   - backend/physiological/predictor.py::compute_personal_stress_threshold()
//
// Same transport for both now: EEG and Ring each expose an on-demand
// POST /calibrate/threshold/start + poll /calibrate/threshold/status,
// same shape as their own baseline capture -- no dependency on
// mqtt_bridge.py's always-on loop (an earlier version of this screen set
// a Firebase flag for EEG's always-on bridge to notice, which only
// worked if that separate process happened to be running; EEG's
// eeg_calibration_capture.py now has its own on-demand capture, mirroring
// physiological's calibration_capture.py exactly -- see
// backend/psychological/eeg_calibration_capture.py::run_eeg_threshold_capture()).
//
// EEG and Ring are tracked and shown INDEPENDENTLY (each its own status
// row, own retry) -- NOT gated on both settling before either is visible,
// so one running slower than the other never hides an already-successful
// result behind a generic timeout.
//
// Reached from AccountSetupScreen.js once CalibrateBreathingCard's
// baseline capture completes -- see App.js's 'ThresholdCalibration' route.
// Skippable, same "no dead end" philosophy as the rest of onboarding
// (AccountSetupScreen.js's own header comment) -- Done is always
// available once the task starts, whether or not either side has
// actually finished; finishing OR skipping both flips isNewUser off via
// completeOnboarding() and continues into the app.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Keyboard } from 'react-native';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Button from '../../shared/Button';
import Icon, { NAMES } from '../../shared/Icon';
import { eegClient } from '../../shared/eegApiClient';
import physiologicalApi from '../../physiological/api/client';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';

// 75s, not a bare 60s -- chosen to comfortably exceed BOTH backends'
// worst-case capture time (EEG: up to ~53s from flag-detection to 2 full
// 25s blocks; physiological: one full 60s window from trigger), so the
// quiz's own countdown absorbs that time instead of the user hitting a
// visible "Working…" gap after it ends on the common case.
const TASK_DURATION_SEC = 75;
// Per-side "this looks stuck" warning -- independent per side now, not a
// single combined gate (see file header). 90s from when EACH side was
// triggered, not from quiz-end, so a side that's slow but still working
// isn't unfairly flagged just because the other side already finished.
const STUCK_WARNING_SEC = 90;
const POLL_INTERVAL_MS = 2000;
const IN_PROGRESS = ['capturing', 'saving'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Simple two-operand problems, mixed operators, difficulty roughly
// matched to "solvable in a few seconds of real mental arithmetic" --
// the goal is genuine cognitive load for the task's duration, not a hard puzzle.
function generateProblem() {
  const ops = ['+', '-', '×'];
  const op = ops[randomInt(0, ops.length - 1)];
  let a, b, answer;
  if (op === '+') {
    a = randomInt(23, 89);
    b = randomInt(14, 78);
    answer = a + b;
  } else if (op === '-') {
    a = randomInt(40, 99);
    b = randomInt(11, a - 1);
    answer = a - b;
  } else {
    a = randomInt(3, 12);
    b = randomInt(3, 12);
    answer = a * b;
  }
  return { a, b, op, answer };
}

export default function EegThresholdTaskScreen({ navigation }) {
  const { theme: t, COLORS } = useTheme();
  const { user, token, completeOnboarding } = useAuth();
  const userId = user?.userId;

  const [sessionId, setSessionId] = useState(null);
  const [phase, setPhase] = useState('intro'); // intro | quiz | review
  const [secondsLeft, setSecondsLeft] = useState(TASK_DURATION_SEC);
  const [problem, setProblem] = useState(null);
  const [answerText, setAnswerText] = useState('');
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const [eegResult, setEegResult] = useState(null);
  const [eegTriggeredAt, setEegTriggeredAt] = useState(null);
  const [ringResult, setRingResult] = useState(null);
  const [ringTriggeredAt, setRingTriggeredAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const quizTimerRef = useRef(null);
  const tickRef = useRef(null);
  const eegPollRef = useRef(null);
  const ringPollRef = useRef(null);

  const finish = useCallback(() => {
    completeOnboarding();
    navigation.replace('Physiological');
  }, [completeOnboarding, navigation]);

  // Same current_session_id pointer EegSummaryScreen.js already watches --
  // this screen assumes baseline calibration for that session has already
  // succeeded (both /calibrate/start routes only produce a usable session/
  // baseline once they've actually finished; triggering the threshold
  // task before then just has nothing to score against).
  useEffect(() => {
    if (!userId) return undefined;
    const pointerRef = ref(db, 'psychological/current_session_id');
    const handler = onValue(pointerRef, (snapshot) => {
      setSessionId(snapshot.val() || null);
    });
    return () => off(pointerRef, 'value', handler);
  }, [userId]);

  const triggerEeg = useCallback(() => {
    if (!userId || !sessionId) return;
    setEegResult(null);
    setEegTriggeredAt(Date.now());
    // On-demand, same shape as Ring's own trigger below -- see file header.
    // A 409 here just means a capture from an earlier attempt is still
    // running; that's fine, the poll below picks up whatever's in
    // progress either way.
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    eegClient.post('/calibrate/threshold/start', { session_id: sessionId }, { headers }).catch(() => {});
  }, [userId, sessionId, token]);

  const triggerRing = useCallback(() => {
    setRingResult(null);
    setRingTriggeredAt(Date.now());
    // A 409 here just means a capture from an earlier attempt is still
    // running; that's fine, the poll below picks up whatever's in
    // progress either way.
    physiologicalApi.post('/calibrate/threshold/start', {}).catch(() => {});
  }, []);

  const startQuiz = useCallback(() => {
    if (!userId) return;
    triggerEeg();
    triggerRing();
    setScore({ correct: 0, total: 0 });
    setProblem(generateProblem());
    setAnswerText('');
    setSecondsLeft(TASK_DURATION_SEC);
    setPhase('quiz');
  }, [userId, triggerEeg, triggerRing]);

  useEffect(() => {
    if (phase !== 'quiz') return undefined;
    quizTimerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(quizTimerRef.current);
          Keyboard.dismiss();
          setPhase('review');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(quizTimerRef.current);
  }, [phase]);

  const submitAnswer = useCallback(() => {
    if (!problem || answerText.trim() === '') return;
    const isCorrect = Number(answerText.trim()) === problem.answer;
    setScore((s) => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    setProblem(generateProblem());
    setAnswerText('');
  }, [problem, answerText]);

  // Polls EEG's /calibrate/threshold/status -- same on-demand shape as
  // Ring's own poll below, and the same pattern CalibrateBreathingCard.js's
  // useCaptureRunner already uses for baseline capture (kept local here
  // rather than importing that unexported hook). Independent of Ring's
  // own state entirely -- keeps polling and reporting its own result
  // regardless of whether Ring ever settles (see file header).
  useEffect(() => {
    if (!eegTriggeredAt || eegResult != null) return undefined;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const poll = async () => {
      try {
        const res = await eegClient.get('/calibrate/threshold/status', { headers });
        if (res.data?.status && !IN_PROGRESS.includes(res.data.status)) {
          setEegResult(res.data);
          clearInterval(eegPollRef.current);
        }
      } catch {
        // a single missed poll doesn't mean it failed -- the next tick tries again
      }
    };
    poll();
    eegPollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(eegPollRef.current);
  }, [eegTriggeredAt, eegResult, token]);

  // Polls physiological's /calibrate/threshold/status.
  useEffect(() => {
    if (!ringTriggeredAt || ringResult != null) return undefined;
    const poll = async () => {
      try {
        const res = await physiologicalApi.get('/calibrate/threshold/status');
        if (res.data?.status && !IN_PROGRESS.includes(res.data.status)) {
          setRingResult(res.data);
          clearInterval(ringPollRef.current);
        }
      } catch {
        // a single missed poll doesn't mean it failed -- the next tick tries again
      }
    };
    poll();
    ringPollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(ringPollRef.current);
  }, [ringTriggeredAt, ringResult]);

  // Local clock tick for the "still working, N s" / stuck-warning display
  // -- only runs while something is actually pending, not the whole time
  // the screen is mounted.
  useEffect(() => {
    const eegPending = eegTriggeredAt && !eegResult;
    const ringPending = ringTriggeredAt && !ringResult;
    if (!eegPending && !ringPending) return undefined;
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickRef.current);
  }, [eegTriggeredAt, eegResult, ringTriggeredAt, ringResult]);

  function sideStatus(result, triggeredAt, personalizedKey, retry) {
    if (!triggeredAt) return { detail: 'Not run this time.', color: COLORS.light?.textMuted || '#888', retry: null };
    if (!result) {
      const stuck = (now - triggeredAt) / 1000 >= STUCK_WARNING_SEC;
      return stuck
        ? { detail: 'Taking longer than expected -- check the device is still connected.', color: COLORS.warning, retry }
        : { detail: 'Working…', color: COLORS.light?.textMuted || '#888', retry: null };
    }
    if (result.status === 'ok') {
      const pct = Math.round((result[personalizedKey] || 0) * 100);
      return { detail: `Personalized at ${pct}%.`, color: COLORS.normal, retry: null };
    }
    if (result.status === 'error') {
      return { detail: result.error || 'Failed -- standard threshold stays in place.', color: COLORS.warning, retry };
    }
    return { detail: 'Rest and task scores weren’t different enough -- using the standard threshold.', color: COLORS.normal, retry: null };
  }

  const eegStatus = useMemo(
    () => sideStatus(eegResult, eegTriggeredAt, 'personal_high_load_p', triggerEeg),
    [eegResult, eegTriggeredAt, now, COLORS, triggerEeg],
  );
  const ringStatus = useMemo(
    () => sideStatus(ringResult, ringTriggeredAt, 'personal_stress_threshold', triggerRing),
    [ringResult, ringTriggeredAt, now, COLORS, triggerRing],
  );

  return (
    <ScreenBackground>
      <View style={styles.container}>
        {phase === 'intro' && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Icon name={NAMES.eeg} size={22} color={COLORS.brand} />
              <Text style={[styles.title, { color: t.text }]}>Personalize Your Threshold</Text>
            </View>
            <Text style={[styles.body, { color: t.textMuted }]}>
              For {TASK_DURATION_SEC} seconds you'll solve quick arithmetic problems back to back --
              this deliberately induces cognitive load so we can measure how YOUR signal moves
              between rest and a real high-load state, for both your Ring and EEG, instead of
              relying on a population average.
            </Text>
            <Button label="Start Task" onPress={startQuiz} disabled={!userId} variant="primary" style={{ marginTop: 16 }} />
            <TouchableOpacity onPress={finish} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={[styles.skipText, { color: t.textMuted }]}>Skip for now →</Text>
            </TouchableOpacity>
          </Card>
        )}

        {phase === 'quiz' && problem && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={[styles.timer, { color: COLORS.brand }]}>{secondsLeft}s</Text>
              <Text style={[styles.scoreText, { color: t.textMuted }]}>
                {score.correct}/{score.total} correct
              </Text>
            </View>
            <Text style={[styles.problem, { color: t.text }]}>
              {problem.a} {problem.op} {problem.b} = ?
            </Text>
            <TextInput
              style={[styles.input, { color: t.text, borderColor: t.border }]}
              value={answerText}
              onChangeText={setAnswerText}
              keyboardType="number-pad"
              autoFocus
              onSubmitEditing={submitAnswer}
              placeholder="Your answer"
              placeholderTextColor={t.textMuted}
            />
            <Button label="Submit" onPress={submitAnswer} variant="primary" style={{ marginTop: 12 }} />
          </Card>
        )}

        {phase === 'review' && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Icon name={NAMES.eeg} size={22} color={COLORS.brand} />
              <Text style={[styles.title, { color: t.text }]}>Threshold Results</Text>
            </View>
            <Text style={[styles.body, { color: t.textMuted }]}>
              You answered {score.correct}/{score.total} correctly. Each device reports independently
              below -- one taking longer doesn't hold up the other.
            </Text>

            <View style={styles.resultRow}>
              <View style={styles.resultRowHeader}>
                <Text style={[styles.resultLabel, { color: t.text }]}>EEG</Text>
                {eegStatus.retry && (
                  <TouchableOpacity onPress={eegStatus.retry}>
                    <Text style={[styles.retryText, { color: COLORS.brand }]}>Try Again</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={[styles.resultDetail, { color: eegStatus.color }]}>{eegStatus.detail}</Text>
            </View>

            <View style={styles.resultRow}>
              <View style={styles.resultRowHeader}>
                <Text style={[styles.resultLabel, { color: t.text }]}>Ring</Text>
                {ringStatus.retry && (
                  <TouchableOpacity onPress={ringStatus.retry}>
                    <Text style={[styles.retryText, { color: COLORS.brand }]}>Try Again</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={[styles.resultDetail, { color: ringStatus.color }]}>{ringStatus.detail}</Text>
            </View>

            <TouchableOpacity style={[styles.doneButton, { backgroundColor: COLORS.brand }]} onPress={finish}>
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </Card>
        )}
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  title: { fontSize: 19, fontWeight: '900' },
  body: { fontSize: 13, lineHeight: 19 },
  warn: { fontSize: 12, fontWeight: '700', marginTop: 10 },
  timer: { fontSize: 32, fontWeight: '900' },
  scoreText: { fontSize: 13, fontWeight: '700' },
  problem: { fontSize: 30, fontWeight: '900', textAlign: 'center', marginVertical: 24 },
  input: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 18, textAlign: 'center',
  },
  resultRow: { paddingVertical: 10, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ffffff22' },
  resultRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultLabel: { fontSize: 13, fontWeight: '800' },
  resultDetail: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  retryText: { fontSize: 12, fontWeight: '800' },
  doneButton: { marginTop: 18, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  doneButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  skipRow: { alignItems: 'center', paddingVertical: 14 },
  skipText: { fontSize: 13, fontWeight: '700' },
});
