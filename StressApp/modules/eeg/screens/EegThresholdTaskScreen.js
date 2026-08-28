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
// Two different transports, same UI: EEG has no on-demand task-capture
// endpoint (mqtt_bridge.py's always-on session is the only thing with
// live MQTT access -- this screen just sets a Firebase flag and watches
// for the result); physiological has a real on-demand
// POST /calibrate/threshold/start + poll /calibrate/threshold/status,
// same shape as its own baseline capture.
//
// Reached from AccountSetupScreen.js once CalibrateBreathingCard's
// baseline capture completes -- see App.js's 'ThresholdCalibration' route.
// Skippable, same "no dead end" philosophy as the rest of onboarding
// (AccountSetupScreen.js's own header comment) -- finishing OR skipping
// both flips isNewUser off via completeOnboarding() and continues into
// the app.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Keyboard } from 'react-native';
import { ref, onValue, off, set } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Button from '../../shared/Button';
import Icon, { NAMES } from '../../shared/Icon';
import physiologicalApi from '../../physiological/api/client';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';

// 75s, not a bare 60s -- chosen to comfortably exceed BOTH backends'
// worst-case capture time (EEG: up to ~53s from flag-detection to 2 full
// 25s blocks; physiological: one full 60s window from trigger), so the
// quiz's own countdown absorbs that time instead of the user hitting a
// visible "Working…" gap after it ends on the common case. See this
// project's own note on the tradeoff (slightly longer onboarding vs. a
// gap that reads as "is this broken?").
const TASK_DURATION_SEC = 75;
// Worst case per mqtt_bridge.py's own task-phase design: up to 2 full 25s
// blocks (~50s) to accumulate from whenever the flag is first noticed
// (polled every THRESHOLD_TASK_POLL_INTERVAL_SEC=3s there), plus the
// /calibrate/threshold POST + its own retry margin -- with the quiz now
// running 75s, this residual timeout mostly just covers a genuinely slow/
// failed capture, not the normal case; 90s still gives a safe margin
// without leaving the user staring at a spinner forever if something
// actually did fail.
const WAITING_TIMEOUT_SEC = 90;
const RING_POLL_INTERVAL_MS = 2000;
const RING_IN_PROGRESS = ['capturing', 'saving'];

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
  const { user, completeOnboarding } = useAuth();
  const userId = user?.userId;

  const [sessionId, setSessionId] = useState(null);
  const [phase, setPhase] = useState('intro'); // intro | quiz | waiting | result
  const [secondsLeft, setSecondsLeft] = useState(TASK_DURATION_SEC);
  const [problem, setProblem] = useState(null);
  const [answerText, setAnswerText] = useState('');
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [eegResult, setEegResult] = useState(null);
  const [ringResult, setRingResult] = useState(null);
  const [ringTriggered, setRingTriggered] = useState(false);
  const [waitedSec, setWaitedSec] = useState(0);

  const quizTimerRef = useRef(null);
  const waitTimerRef = useRef(null);
  const ringPollRef = useRef(null);

  const finish = useCallback(() => {
    completeOnboarding();
    navigation.replace('Physiological');
  }, [completeOnboarding, navigation]);

  // Same current_session_id pointer EegSummaryScreen.js already watches --
  // this screen assumes baseline calibration for that session has already
  // succeeded (mqtt_bridge.py only starts polling task_phase_requested
  // once its own `calibrated` flag is true; requesting the task phase
  // before then just has nothing to capture it).
  useEffect(() => {
    if (!userId) return undefined;
    const pointerRef = ref(db, 'psychological/current_session_id');
    const handler = onValue(pointerRef, (snapshot) => {
      setSessionId(snapshot.val() || null);
    });
    return () => off(pointerRef, 'value', handler);
  }, [userId]);

  const startQuiz = useCallback(() => {
    if (!userId) return;

    if (sessionId) {
      // Plain Firebase write, not an API call -- mqtt_bridge.py is the
      // only thing with live MQTT access to actually capture EEG task
      // blocks, so this screen's job for EEG is just setting this flag
      // and watching for the result (see file header comment).
      set(ref(db, `psychological/${userId}/${sessionId}/task_phase_requested`), Date.now()).catch(() => {});
    }

    // Physiological's real on-demand trigger -- a 409 here just means a
    // capture from an earlier attempt is still running; that's fine, the
    // poll below picks up whatever's in progress either way.
    setRingTriggered(true);
    physiologicalApi.post('/calibrate/threshold/start', {}).catch(() => {});

    setEegResult(null);
    setRingResult(null);
    setScore({ correct: 0, total: 0 });
    setProblem(generateProblem());
    setAnswerText('');
    setSecondsLeft(TASK_DURATION_SEC);
    setPhase('quiz');
  }, [userId, sessionId]);

  useEffect(() => {
    if (phase !== 'quiz') return undefined;
    quizTimerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(quizTimerRef.current);
          Keyboard.dismiss();
          setPhase('waiting');
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

  // Watches for mqtt_bridge.py's /calibrate/threshold POST landing --
  // see push_threshold_result()'s docstring (backend/psychological/
  // firebase_service.py). Left subscribed throughout so a result that
  // happens to already exist from a prior attempt (e.g. screen re-entered)
  // shows up immediately rather than needing a fresh task run.
  useEffect(() => {
    if (!userId || !sessionId) return undefined;
    const resultRef = ref(db, `psychological/${userId}/${sessionId}/threshold_result`);
    const handler = onValue(resultRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setEegResult(data);
    });
    return () => off(resultRef, 'value', handler);
  }, [userId, sessionId]);

  // Polls physiological's /calibrate/threshold/status -- same shape
  // CalibrateBreathingCard.js's useCaptureRunner already uses for baseline
  // capture, kept local here rather than importing that unexported hook.
  useEffect(() => {
    if (phase !== 'waiting' || !ringTriggered) return undefined;
    const poll = async () => {
      try {
        const res = await physiologicalApi.get('/calibrate/threshold/status');
        if (res.data?.status && !RING_IN_PROGRESS.includes(res.data.status)) {
          setRingResult(res.data);
          clearInterval(ringPollRef.current);
        }
      } catch {
        // a single missed poll doesn't mean it failed -- the next tick tries again
      }
    };
    poll();
    ringPollRef.current = setInterval(poll, RING_POLL_INTERVAL_MS);
    return () => clearInterval(ringPollRef.current);
  }, [phase, ringTriggered]);

  // Both sides settled (or were never triggered) -> show results.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const eegSettled = !sessionId || eegResult != null;
    const ringSettled = !ringTriggered || ringResult != null;
    if (eegSettled && ringSettled) setPhase('result');
  }, [phase, sessionId, eegResult, ringTriggered, ringResult]);

  useEffect(() => {
    if (phase !== 'waiting') {
      setWaitedSec(0);
      return undefined;
    }
    waitTimerRef.current = setInterval(() => setWaitedSec((s) => s + 1), 1000);
    return () => clearInterval(waitTimerRef.current);
  }, [phase]);

  const timedOut = phase === 'waiting' && waitedSec >= WAITING_TIMEOUT_SEC;

  function summarize(label, result, personalizedKey) {
    if (!result) return { label, detail: 'Not run this time.', color: COLORS.light?.textMuted || '#888' };
    if (result.status === 'ok') {
      const pct = Math.round((result[personalizedKey] || 0) * 100);
      return { label, detail: `Personalized at ${pct}%.`, color: COLORS.normal };
    }
    if (result.status === 'error') {
      return { label, detail: result.error || 'Failed -- standard threshold stays in place.', color: COLORS.warning };
    }
    return { label, detail: 'Rest and task scores weren’t different enough -- using the standard threshold.', color: COLORS.warning };
  }

  const eegSummary = useMemo(() => summarize('EEG', eegResult, 'personal_high_load_p'), [eegResult, COLORS]);
  const ringSummary = useMemo(() => summarize('Ring', ringResult, 'personal_stress_threshold'), [ringResult, COLORS]);

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

        {phase === 'waiting' && (
          <Card elevated style={styles.card}>
            <Text style={[styles.title, { color: t.text }]}>Measuring your response…</Text>
            <Text style={[styles.body, { color: t.textMuted, marginTop: 8 }]}>
              You answered {score.correct}/{score.total} correctly. Hold still for a moment while your
              last few readings are analyzed.
            </Text>
            {timedOut ? (
              <>
                <Text style={[styles.warn, { color: COLORS.warning, marginTop: 12 }]}>
                  This is taking longer than expected -- check that your device(s) are still connected.
                </Text>
                <Button label="Try Again" onPress={startQuiz} variant="outline" style={{ marginTop: 12 }} />
                <TouchableOpacity onPress={finish} activeOpacity={0.7} style={styles.skipRow}>
                  <Text style={[styles.skipText, { color: t.textMuted }]}>Skip for now →</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={[styles.body, { color: t.textMuted, marginTop: 12 }]}>Working…</Text>
            )}
          </Card>
        )}

        {phase === 'result' && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Icon name={NAMES.eeg} size={22} color={COLORS.brand} />
              <Text style={[styles.title, { color: t.text }]}>Threshold Results</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={[styles.resultLabel, { color: t.text }]}>{eegSummary.label}</Text>
              <Text style={[styles.resultDetail, { color: eegSummary.color }]}>{eegSummary.detail}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={[styles.resultLabel, { color: t.text }]}>{ringSummary.label}</Text>
              <Text style={[styles.resultDetail, { color: ringSummary.color }]}>{ringSummary.detail}</Text>
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
  resultRow: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ffffff22' },
  resultLabel: { fontSize: 13, fontWeight: '800' },
  resultDetail: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  doneButton: { marginTop: 18, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  doneButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  skipRow: { alignItems: 'center', paddingVertical: 14 },
  skipText: { fontSize: 13, fontWeight: '700' },
});
