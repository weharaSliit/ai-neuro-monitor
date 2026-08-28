// ============================================================
// EegThresholdTaskScreen.js
//
// Onboarding personal-threshold calibration: a short (60s) deliberate
// mental-arithmetic task run right after resting-baseline calibration, so
// this user's own high_load_p can be derived from how their own score
// moves between Rest and Task -- see backend/psychological/sam40/
// decision.py::compute_personal_threshold()'s docstring for the method,
// and backend/psychological/mqtt_bridge.py's task-phase capture for how
// the actual EEG blocks get captured (this screen has no raw-EEG access
// of its own -- it only ever reads/writes Firebase).
//
// Flow: intro -> quiz (60s countdown, interactive arithmetic) -> waiting
// (task_phase_requested flag set, mqtt_bridge.py captures 2 task blocks
// and POSTs them to /calibrate/threshold) -> result (watches
// psychological/{userId}/{sessionId}/threshold_result for the outcome).
//
// Deliberately standalone -- not wired into CalibrationGate.js's
// navigation, since that file (and the baseline /calibrate/start +
// /calibrate/status flow it drives) is a teammate's own in-progress,
// not-yet-merged work. Reachable directly (e.g. from EegSummaryScreen or
// a nav link) once that baseline flow lands; assumes baseline calibration
// for the current session has ALREADY succeeded (mqtt_bridge.py only
// starts polling for task_phase_requested once its own `calibrated` flag
// is true).
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Keyboard } from 'react-native';
import { ref, onValue, off, set } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Button from '../../shared/Button';
import Icon, { NAMES } from '../../shared/Icon';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';

const TASK_DURATION_SEC = 60;
// Worst case per mqtt_bridge.py's own task-phase design: up to 2 full 25s
// blocks (~50s) to accumulate from whenever the flag is first noticed
// (polled every THRESHOLD_TASK_POLL_INTERVAL_SEC=3s there), plus the
// /calibrate/threshold POST + its own retry margin -- 90s covers that
// with room, without leaving the user staring at a spinner forever if
// something actually did fail.
const WAITING_TIMEOUT_SEC = 90;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Simple two-operand problems, mixed operators, difficulty roughly
// matched to "solvable in a few seconds of real mental arithmetic" --
// the goal is genuine cognitive load for ~60s, not a hard puzzle.
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
  const { user } = useAuth();
  const userId = user?.userId;

  const [sessionId, setSessionId] = useState(null);
  const [phase, setPhase] = useState('intro'); // intro | quiz | waiting | result
  const [secondsLeft, setSecondsLeft] = useState(TASK_DURATION_SEC);
  const [problem, setProblem] = useState(null);
  const [answerText, setAnswerText] = useState('');
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [thresholdResult, setThresholdResult] = useState(null);
  const [waitedSec, setWaitedSec] = useState(0);

  const quizTimerRef = useRef(null);
  const waitTimerRef = useRef(null);

  // Same current_session_id pointer EegSummaryScreen.js already watches --
  // this screen assumes baseline calibration for that session has already
  // succeeded (mqtt_bridge.py only starts polling task_phase_requested
  // once its own `calibrated` flag is true; requesting the task phase
  // before then just has nothing to capture it).
  useEffect(() => {
    if (!userId) return;
    const pointerRef = ref(db, 'psychological/current_session_id');
    const handler = onValue(pointerRef, (snapshot) => {
      setSessionId(snapshot.val() || null);
    });
    return () => off(pointerRef, 'value', handler);
  }, [userId]);

  const startQuiz = useCallback(() => {
    if (!userId || !sessionId) return;
    // Plain Firebase write, not an API call -- mqtt_bridge.py is the only
    // thing with live MQTT access to actually capture task blocks, so this
    // screen's whole job is setting this flag and then watching for the
    // result (see this file's header comment).
    set(ref(db, `psychological/${userId}/${sessionId}/task_phase_requested`), Date.now()).catch(() => {});
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
  // firebase_service.py). Only meaningful once phase is 'waiting'; left
  // subscribed throughout so a result that happens to already exist from
  // this same session's prior attempt (e.g. screen re-entered) shows up
  // immediately rather than needing a fresh task run.
  useEffect(() => {
    if (!userId || !sessionId) return undefined;
    const resultRef = ref(db, `psychological/${userId}/${sessionId}/threshold_result`);
    const handler = onValue(resultRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setThresholdResult(data);
        setPhase((p) => (p === 'waiting' ? 'result' : p));
      }
    });
    return () => off(resultRef, 'value', handler);
  }, [userId, sessionId]);

  useEffect(() => {
    if (phase !== 'waiting') {
      setWaitedSec(0);
      return undefined;
    }
    waitTimerRef.current = setInterval(() => setWaitedSec((s) => s + 1), 1000);
    return () => clearInterval(waitTimerRef.current);
  }, [phase]);

  const timedOut = phase === 'waiting' && waitedSec >= WAITING_TIMEOUT_SEC;

  const resultSummary = useMemo(() => {
    if (!thresholdResult) return null;
    if (thresholdResult.status === 'ok') {
      const pct = Math.round((thresholdResult.personal_high_load_p || 0) * 100);
      return {
        title: 'Personal threshold set',
        detail: `Your high-cognitive-load threshold is now personalized at ${pct}%, `
          + `based on how your own score moved between rest and this task.`,
        color: COLORS.normal,
      };
    }
    return {
      title: 'Using the standard threshold',
      detail: 'Your task and resting scores weren’t different enough to personalize confidently '
        + '-- the standard threshold stays in place. You can retry this any time.',
      color: COLORS.warning,
    };
  }, [thresholdResult, COLORS]);

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
              this deliberately induces cognitive load so we can measure how YOUR EEG signal moves
              between rest and a real high-load state, instead of relying on a population average.
            </Text>
            {!sessionId && (
              <Text style={[styles.warn, { color: COLORS.warning }]}>
                Waiting for an active, calibrated EEG session before this can start.
              </Text>
            )}
            <Button
              label="Start Task"
              onPress={startQuiz}
              disabled={!userId || !sessionId}
              variant="primary"
              style={{ marginTop: 16 }}
            />
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
              headband's last few readings are analyzed.
            </Text>
            {timedOut ? (
              <>
                <Text style={[styles.warn, { color: COLORS.warning, marginTop: 12 }]}>
                  This is taking longer than expected -- check that the headband is still connected.
                </Text>
                <Button label="Try Again" onPress={startQuiz} variant="outline" style={{ marginTop: 12 }} />
              </>
            ) : (
              <Text style={[styles.body, { color: t.textMuted, marginTop: 12 }]}>Working…</Text>
            )}
          </Card>
        )}

        {phase === 'result' && resultSummary && (
          <Card elevated accentColor={resultSummary.color} style={styles.card}>
            <View style={styles.headerRow}>
              <Icon name={NAMES.eeg} size={22} color={resultSummary.color} />
              <Text style={[styles.title, { color: t.text }]}>{resultSummary.title}</Text>
            </View>
            <Text style={[styles.body, { color: t.textMuted }]}>{resultSummary.detail}</Text>
            <TouchableOpacity
              style={[styles.doneButton, { backgroundColor: COLORS.brand }]}
              onPress={() => (navigation?.goBack ? navigation.goBack() : null)}
            >
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
  doneButton: { marginTop: 18, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  doneButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
