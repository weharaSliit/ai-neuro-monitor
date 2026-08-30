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

// Two back-to-back timed activities now, not one -- WESAD's own stress
// induction combined arithmetic with public-speaking-style pressure, and a
// single easy maths quiz alone is a weak proxy for genuine stress (just
// cognitive load). MATH_DURATION_SEC + STROOP_DURATION_SEC (80s total)
// still comfortably covers N_TASK_WIN(=1) x WINDOW_SEC(=60s) with margin
// (see backend/physiological/calibration_capture.py's
// _capture_timeout_sec()) -- the Ring/EEG capture is time-window based, not
// activity-based, and is triggered once at the start of the maths phase
// (triggerEeg/triggerRing below) so it runs continuously underneath BOTH
// activities without a second trigger.
const MATH_DURATION_SEC = 40;
const STROOP_DURATION_SEC = 40;
const STUCK_WARNING_SEC = 90;
const POLL_INTERVAL_MS = 2000;
const TICK_MS = 100;
const IN_PROGRESS = ['capturing', 'saving'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Maths quiz: escalating difficulty ────────────────────────────────
// Level rises with an unbroken correct streak (resets on any wrong/timed-
// out answer), each tier both toughening the arithmetic AND shortening the
// per-question clock -- the two together are what create real, felt time
// pressure instead of just a background 40s countdown nobody notices
// question to question.
const MATH_LEVELS = [
  { ops: ['+', '-'], maxA: 40, maxB: 30, timeSec: 8 },
  { ops: ['+', '-', '×'], maxA: 70, maxB: 12, timeSec: 6 },
  { ops: ['+', '-', '×', '÷'], maxA: 90, maxB: 12, timeSec: 5 },
  { ops: ['two-step'], maxA: 25, maxB: 12, timeSec: 4 },
];
const LEVEL_UP_STREAK = 3;

function applyOp(a, op, b) {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '×') return a * b;
  return a;
}

function generateMathProblem(levelIdx) {
  const level = MATH_LEVELS[levelIdx];
  if (level.ops[0] === 'two-step') {
    const stepOps = ['+', '-', '×'];
    const op1 = stepOps[randomInt(0, 2)];
    const op2 = stepOps[randomInt(0, 2)];
    let a = randomInt(5, level.maxA);
    let b = randomInt(2, level.maxB);
    let c = randomInt(2, level.maxB);
    let mid = applyOp(a, op1, b);
    if (mid < 0) { const t = a; a = b; b = t; mid = applyOp(a, op1, b); }
    let answer = applyOp(mid, op2, c);
    if (answer < 0) { c = randomInt(2, Math.max(2, mid)); answer = applyOp(mid, op2, c); }
    return { display: `${a} ${op1} ${b} ${op2} ${c}`, answer };
  }
  const op = level.ops[randomInt(0, level.ops.length - 1)];
  if (op === '+') {
    const a = randomInt(10, level.maxA);
    const b = randomInt(10, level.maxA);
    return { display: `${a} + ${b}`, answer: a + b };
  }
  if (op === '-') {
    const a = randomInt(15, level.maxA);
    const b = randomInt(5, a - 1);
    return { display: `${a} - ${b}`, answer: a - b };
  }
  if (op === '×') {
    const a = randomInt(3, level.maxB);
    const b = randomInt(3, level.maxB);
    return { display: `${a} × ${b}`, answer: a * b };
  }
  const divisor = randomInt(2, 12);
  const quotient = randomInt(2, level.maxB);
  return { display: `${divisor * quotient} ÷ ${divisor}`, answer: quotient };
}

// ── Stroop colour-word test ──────────────────────────────────────────
// Deliberately NOT the common 4-colour, mostly-congruent version: 6
// visually close colours, 85% incongruent trials (word says one colour,
// ink is another), a shrinking per-trial clock, and shuffled answer-swatch
// order every trial so the response can't become spatial-memory autopilot.
// Answering by INK colour against a conflicting word is the classic
// Stroop conflict that reliably drives arousal, not just workload -- worth
// pairing with the maths phase per the same WESAD reasoning above.
const STROOP_COLORS = [
  { name: 'Red', hex: '#E53935' },
  { name: 'Blue', hex: '#1E88E5' },
  { name: 'Green', hex: '#43A047' },
  { name: 'Yellow', hex: '#FDD835' },
  { name: 'Purple', hex: '#8E24AA' },
  { name: 'Orange', hex: '#FB8C00' },
];
const STROOP_INCONGRUENT_PROB = 0.85;
const STROOP_TRIAL_SEC_BASE = 3.0;
const STROOP_TRIAL_SEC_MIN = 1.2;
const STROOP_TRIAL_SEC_STEP = 0.15;

function generateStroopTrial() {
  const inkColor = STROOP_COLORS[randomInt(0, STROOP_COLORS.length - 1)];
  const others = STROOP_COLORS.filter((c) => c.name !== inkColor.name);
  const labelColor = Math.random() < STROOP_INCONGRUENT_PROB
    ? others[randomInt(0, others.length - 1)]
    : inkColor;
  return { inkColor, labelColor, options: shuffle(STROOP_COLORS) };
}

export default function EegThresholdTaskScreen({ navigation }) {
  const { theme: t, COLORS } = useTheme();
  const { user, token, completeOnboarding } = useAuth();
  const userId = user?.userId;

  const [sessionId, setSessionId] = useState(null);
  const [phase, setPhase] = useState('intro'); // intro | quiz | stroop | review
  const [nowFine, setNowFine] = useState(Date.now());

  // Maths phase state
  const [mathDeadline, setMathDeadline] = useState(null);
  const [mathProblem, setMathProblem] = useState(null);
  const [mathQuestionDeadline, setMathQuestionDeadline] = useState(null);
  const [mathAnswerText, setMathAnswerText] = useState('');
  const [mathScore, setMathScore] = useState({ correct: 0, total: 0 });
  const [mathStreak, setMathStreak] = useState(0);
  const [mathFeedback, setMathFeedback] = useState(null); // { correct, correctAnswer, timeout }
  const mathFeedbackHandledRef = useRef(false);

  // Stroop phase state
  const [stroopDeadline, setStroopDeadline] = useState(null);
  const [stroopTrial, setStroopTrial] = useState(null);
  const [stroopTrialDeadline, setStroopTrialDeadline] = useState(null);
  const [stroopScore, setStroopScore] = useState({ correct: 0, total: 0 });
  const [stroopStreak, setStroopStreak] = useState(0);
  const [stroopFeedback, setStroopFeedback] = useState(null); // { correct, correctName, timeout }
  const stroopFeedbackHandledRef = useRef(false);

  const [eegResult, setEegResult] = useState(null);
  const [eegTriggeredAt, setEegTriggeredAt] = useState(null);
  const [ringResult, setRingResult] = useState(null);
  const [ringTriggeredAt, setRingTriggeredAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const tickRef = useRef(null);
  const fineTickRef = useRef(null);
  const eegPollRef = useRef(null);
  const ringPollRef = useRef(null);

  const finish = useCallback(() => {
    completeOnboarding();
    navigation.replace('Physiological');
  }, [completeOnboarding, navigation]);

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

    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    eegClient.post('/calibrate/threshold/start', { session_id: sessionId }, { headers }).catch(() => {});
  }, [userId, sessionId, token]);

  const triggerRing = useCallback(() => {
    setRingResult(null);
    setRingTriggeredAt(Date.now());
    physiologicalApi.post('/calibrate/threshold/start', {}).catch(() => {});
  }, []);

  // ── Maths phase ──────────────────────────────────────────────────
  const mathLevelIdx = Math.min(MATH_LEVELS.length - 1, Math.floor(mathStreak / LEVEL_UP_STREAK));

  const nextMathProblem = useCallback((levelIdx) => {
    const now2 = Date.now();
    setMathProblem(generateMathProblem(levelIdx));
    setMathQuestionDeadline(now2 + MATH_LEVELS[levelIdx].timeSec * 1000);
    setMathAnswerText('');
    setMathFeedback(null);
    mathFeedbackHandledRef.current = false;
  }, []);

  const startTask = useCallback(() => {
    if (!userId) return;
    triggerEeg();
    triggerRing();
    setMathScore({ correct: 0, total: 0 });
    setMathStreak(0);
    setMathDeadline(Date.now() + MATH_DURATION_SEC * 1000);
    nextMathProblem(0);
    setPhase('quiz');
  }, [userId, triggerEeg, triggerRing, nextMathProblem]);

  const submitMathAnswer = useCallback(() => {
    if (!mathProblem || mathFeedback || mathFeedbackHandledRef.current) return;
    if (mathAnswerText.trim() === '') return;
    mathFeedbackHandledRef.current = true;
    const isCorrect = Number(mathAnswerText.trim()) === mathProblem.answer;
    setMathScore((s) => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    setMathStreak((s) => (isCorrect ? s + 1 : 0));
    setMathFeedback({ correct: isCorrect, correctAnswer: mathProblem.answer, timeout: false });
  }, [mathProblem, mathAnswerText, mathFeedback]);

  const mathTimeout = useCallback(() => {
    if (!mathProblem || mathFeedbackHandledRef.current) return;
    mathFeedbackHandledRef.current = true;
    setMathScore((s) => ({ correct: s.correct, total: s.total + 1 }));
    setMathStreak(0);
    setMathFeedback({ correct: false, correctAnswer: mathProblem.answer, timeout: true });
  }, [mathProblem]);

  // ── Stroop phase ─────────────────────────────────────────────────
  const nextStroopTrial = useCallback((streak) => {
    const trialSec = Math.max(STROOP_TRIAL_SEC_MIN, STROOP_TRIAL_SEC_BASE - streak * STROOP_TRIAL_SEC_STEP);
    setStroopTrial(generateStroopTrial());
    setStroopTrialDeadline(Date.now() + trialSec * 1000);
    setStroopFeedback(null);
    stroopFeedbackHandledRef.current = false;
  }, []);

  const startStroop = useCallback(() => {
    setStroopScore({ correct: 0, total: 0 });
    setStroopStreak(0);
    setStroopDeadline(Date.now() + STROOP_DURATION_SEC * 1000);
    nextStroopTrial(0);
    setPhase('stroop');
  }, [nextStroopTrial]);

  const submitStroopAnswer = useCallback((colorName) => {
    if (!stroopTrial || stroopFeedback || stroopFeedbackHandledRef.current) return;
    stroopFeedbackHandledRef.current = true;
    const isCorrect = colorName === stroopTrial.inkColor.name;
    setStroopScore((s) => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    setStroopStreak((s) => (isCorrect ? s + 1 : 0));
    setStroopFeedback({ correct: isCorrect, correctName: stroopTrial.inkColor.name, timeout: false });
  }, [stroopTrial, stroopFeedback]);

  const stroopTimeout = useCallback(() => {
    if (!stroopTrial || stroopFeedbackHandledRef.current) return;
    stroopFeedbackHandledRef.current = true;
    setStroopScore((s) => ({ correct: s.correct, total: s.total + 1 }));
    setStroopStreak(0);
    setStroopFeedback({ correct: false, correctName: stroopTrial.inkColor.name, timeout: true });
  }, [stroopTrial]);

  // Single 100ms clock drives both phases' overall + per-item countdowns --
  // a plain deadline-timestamp comparison rather than five separate
  // setInterval(…, 1000) counters, so "time's up" fires consistently even
  // if a render is briefly delayed.
  useEffect(() => {
    if (phase !== 'quiz' && phase !== 'stroop') return undefined;
    fineTickRef.current = setInterval(() => setNowFine(Date.now()), TICK_MS);
    return () => clearInterval(fineTickRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'quiz' || !mathDeadline) return;
    if (nowFine >= mathDeadline) {
      Keyboard.dismiss();
      startStroop();
      return;
    }
    if (mathQuestionDeadline && nowFine >= mathQuestionDeadline && !mathFeedbackHandledRef.current) {
      mathTimeout();
    }
  }, [phase, nowFine, mathDeadline, mathQuestionDeadline, mathTimeout, startStroop]);

  useEffect(() => {
    if (phase !== 'quiz' || !mathFeedback) return undefined;
    const id = setTimeout(() => nextMathProblem(mathLevelIdx), 700);
    return () => clearTimeout(id);
  }, [phase, mathFeedback, mathLevelIdx, nextMathProblem]);

  useEffect(() => {
    if (phase !== 'stroop' || !stroopDeadline) return;
    if (nowFine >= stroopDeadline) {
      setPhase('review');
      return;
    }
    if (stroopTrialDeadline && nowFine >= stroopTrialDeadline && !stroopFeedbackHandledRef.current) {
      stroopTimeout();
    }
  }, [phase, nowFine, stroopDeadline, stroopTrialDeadline, stroopTimeout]);

  useEffect(() => {
    if (phase !== 'stroop' || !stroopFeedback) return undefined;
    const id = setTimeout(() => nextStroopTrial(stroopStreak), 500);
    return () => clearTimeout(id);
  }, [phase, stroopFeedback, stroopStreak, nextStroopTrial]);

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

  const mathSecondsLeft = mathDeadline ? Math.max(0, Math.ceil((mathDeadline - nowFine) / 1000)) : MATH_DURATION_SEC;
  const mathQuestionFrac = mathQuestionDeadline && mathProblem
    ? Math.max(0, Math.min(1, (mathQuestionDeadline - nowFine) / (MATH_LEVELS[mathLevelIdx].timeSec * 1000)))
    : 1;
  const stroopSecondsLeft = stroopDeadline ? Math.max(0, Math.ceil((stroopDeadline - nowFine) / 1000)) : STROOP_DURATION_SEC;

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
              Two short back-to-back rounds -- a speed maths quiz that gets harder the better you do,
              then a color-word (Stroop) test -- deliberately induce real cognitive load and time
              pressure so we can measure how YOUR signal moves between rest and a genuine high-load
              state, for both your Ring and EEG, instead of relying on a population average.
            </Text>
            <Button label="Start Task" onPress={startTask} disabled={!userId} variant="primary" style={{ marginTop: 16 }} />
            <TouchableOpacity onPress={finish} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={[styles.skipText, { color: t.textMuted }]}>Skip for now →</Text>
            </TouchableOpacity>
          </Card>
        )}

        {phase === 'quiz' && mathProblem && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={[styles.timer, { color: COLORS.brand }]}>{mathSecondsLeft}s</Text>
              <Text style={[styles.scoreText, { color: t.textMuted }]}>
                Level {mathLevelIdx + 1} · {mathScore.correct}/{mathScore.total} correct
              </Text>
            </View>

            <View style={[styles.questionBarTrack, { backgroundColor: t.border }]}>
              <View style={[styles.questionBarFill, {
                width: `${mathQuestionFrac * 100}%`,
                backgroundColor: mathQuestionFrac < 0.3 ? COLORS.stress : COLORS.brand,
              }]}
              />
            </View>

            {mathFeedback ? (
              <View style={styles.feedbackWrap}>
                <Text style={[styles.feedbackText, { color: mathFeedback.correct ? COLORS.normal : COLORS.stress }]}>
                  {mathFeedback.correct ? '✓ Correct!' : mathFeedback.timeout ? '⏱ Too slow!' : '✗ Wrong'}
                </Text>
                {!mathFeedback.correct && (
                  <Text style={[styles.feedbackSub, { color: t.textMuted }]}>Answer was {mathFeedback.correctAnswer}</Text>
                )}
              </View>
            ) : (
              <>
                <Text style={[styles.problem, { color: t.text }]}>{mathProblem.display} = ?</Text>
                <TextInput
                  style={[styles.input, { color: t.text, borderColor: t.border }]}
                  value={mathAnswerText}
                  onChangeText={setMathAnswerText}
                  keyboardType="number-pad"
                  autoFocus
                  onSubmitEditing={submitMathAnswer}
                  placeholder="Your answer"
                  placeholderTextColor={t.textMuted}
                />
                <Button label="Submit" onPress={submitMathAnswer} variant="primary" style={{ marginTop: 12 }} />
              </>
            )}
          </Card>
        )}

        {phase === 'stroop' && stroopTrial && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={[styles.timer, { color: COLORS.brand }]}>{stroopSecondsLeft}s</Text>
              <Text style={[styles.scoreText, { color: t.textMuted }]}>
                Streak {stroopStreak} · {stroopScore.correct}/{stroopScore.total} correct
              </Text>
            </View>
            <Text style={[styles.stroopInstruction, { color: t.textMuted }]}>
              Tap the COLOR the word is printed in -- not what it says.
            </Text>

            {stroopFeedback ? (
              <View style={styles.feedbackWrap}>
                <Text style={[styles.feedbackText, { color: stroopFeedback.correct ? COLORS.normal : COLORS.stress }]}>
                  {stroopFeedback.correct ? '✓ Correct!' : stroopFeedback.timeout ? '⏱ Too slow!' : '✗ Wrong'}
                </Text>
                {!stroopFeedback.correct && (
                  <Text style={[styles.feedbackSub, { color: t.textMuted }]}>It was {stroopFeedback.correctName}</Text>
                )}
              </View>
            ) : (
              <Text style={[styles.stroopWord, { color: stroopTrial.inkColor.hex }]}>
                {stroopTrial.labelColor.name.toUpperCase()}
              </Text>
            )}

            <View style={styles.stroopGrid}>
              {stroopTrial.options.map((c) => (
                <TouchableOpacity
                  key={c.name}
                  disabled={!!stroopFeedback}
                  onPress={() => submitStroopAnswer(c.name)}
                  style={[styles.stroopSwatch, { backgroundColor: c.hex, opacity: stroopFeedback ? 0.5 : 1 }]}
                />
              ))}
            </View>
          </Card>
        )}

        {phase === 'review' && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Icon name={NAMES.eeg} size={22} color={COLORS.brand} />
              <Text style={[styles.title, { color: t.text }]}>Threshold Results</Text>
            </View>
            <Text style={[styles.body, { color: t.textMuted }]}>
              Maths: {mathScore.correct}/{mathScore.total} correct. Stroop: {stroopScore.correct}/{stroopScore.total} correct.
              Each device reports independently below -- one taking longer doesn't hold up the other.
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
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
  questionBarTrack: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  questionBarFill: { height: '100%', borderRadius: 3 },
  feedbackWrap: { alignItems: 'center', justifyContent: 'center', minHeight: 140 },
  feedbackText: { fontSize: 26, fontWeight: '900' },
  feedbackSub: { fontSize: 13, marginTop: 6, fontWeight: '600' },
  stroopInstruction: { fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  stroopWord: { fontSize: 34, fontWeight: '900', textAlign: 'center', marginVertical: 20 },
  stroopGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 8 },
  stroopSwatch: { width: 64, height: 64, borderRadius: 14 },
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
