import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Keyboard, Vibration } from 'react-native';
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

// Four back-to-back timed activities now (serial subtraction -> maths quiz
// -> dual n-back -> Stroop), ~6 minutes total -- was 2 activities at 80s
// total, which measured task-phase prob_stress landing around 0.4 against
// a population decision threshold of ~0.71. Root cause (see backend/
// physiological/calibration_capture.py's N_TASK_WIN comment): a short task
// mostly just captures physiological ramp-up (HRV/GSR response lags the
// stressor by tens of seconds), not a sustained elevated state, AND the
// backend was only ever scoring its FIRST captured window regardless of
// how long the frontend ran for. Both fixed together: this task is now
// long enough to build a real sustained response, and N_TASK_WIN/
// N_THRESHOLD_TASK_BLOCKS were raised so the backend actually captures
// (and averages across) the whole thing instead of just the first minute.
const SERIAL_SUB_DURATION_SEC = 150;
const MATH_DURATION_SEC = 90;
const NBACK_DURATION_SEC = 60;
const STROOP_DURATION_SEC = 60;
// Comfortably above the ~360s this task now takes end-to-end (backend
// capture ceilings are far higher still -- 12min Ring, 7.5min EEG, see
// calibration_capture.py/eeg_calibration_capture.py) but still tight
// enough to flag a genuinely stuck capture during the review screen.
const STUCK_WARNING_SEC = 400;
const POLL_INTERVAL_MS = 2000;
const TICK_MS = 100;
const IN_PROGRESS = ['capturing', 'saving'];
const TASK_PHASES = ['serialSub', 'quiz', 'nback', 'stroop'];

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

// ── Serial subtraction (Trier Social Stress Test style) ──────────────
// Count backwards from a random 3-4 digit number by SERIAL_SUB_STEP,
// restarting from the ORIGINAL number on any mistake -- the restart (not
// just "next question") is the deliberate part: losing all progress on a
// single slip is what reliably produces real frustration/threat response
// in the TSST literature, well beyond plain arithmetic difficulty. Escalating
// urgency (screen pulse + vibration) in the final URGENCY_FRAC of the
// phase adds a second, more autonomic (GSR/HRV-facing) pressure on top of
// the purely cognitive load the other three activities create.
const SERIAL_SUB_STEP = 13;
const SERIAL_SUB_START_MIN = 800;
const SERIAL_SUB_START_MAX = 1200;
const SERIAL_URGENCY_FRAC = 0.2;
const SERIAL_VIBRATE_INTERVAL_MS = 4000;

// ── Maths quiz: escalating difficulty ────────────────────────────────
// Level rises with an unbroken correct streak (resets on any wrong/timed-
// out answer), each tier both toughening the arithmetic AND shortening the
// per-question clock. Level 5 (three-step) was added on top of the
// original 4 tiers per an explicit "make the sums long and complicated"
// request -- a determined user reaching it is deep into a long correct
// streak already, so the extra length compounds real, sustained pressure
// rather than just being hard in isolation.
const MATH_LEVELS = [
  { ops: ['+', '-'], maxA: 40, maxB: 30, timeSec: 8 },
  { ops: ['+', '-', '×'], maxA: 70, maxB: 12, timeSec: 6 },
  { ops: ['+', '-', '×', '÷'], maxA: 90, maxB: 12, timeSec: 5 },
  { ops: ['two-step'], maxA: 25, maxB: 12, timeSec: 4 },
  { ops: ['three-step'], maxA: 30, maxB: 15, timeSec: 5 },
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
  if (level.ops[0] === 'two-step' || level.ops[0] === 'three-step') {
    const stepOps = ['+', '-', '×'];
    const nSteps = level.ops[0] === 'three-step' ? 3 : 2;
    let a = randomInt(5, level.maxA);
    let parts = [a];
    let ops = [];
    let acc = a;
    for (let i = 0; i < nSteps; i += 1) {
      const op = stepOps[randomInt(0, 2)];
      let b = randomInt(2, level.maxB);
      let next = applyOp(acc, op, b);
      if (next < 0) { b = randomInt(2, Math.max(2, acc)); next = applyOp(acc, op, b); }
      ops.push(op);
      parts.push(b);
      acc = next;
    }
    const display = parts.reduce((str, val, i) => (i === 0 ? `${val}` : `${str} ${ops[i - 1]} ${val}`), '');
    return { display, answer: acc };
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

// ── Dual n-back ───────────────────────────────────────────────────────
// Classic working-memory stressor: a letter appears every NBACK_STIM_
// INTERVAL_SEC, tap MATCH if it's the same letter shown N steps back.
// N=1 for the first NBACK_EASY_SEC as an onramp, then N=2 for the rest --
// N=2 is the standard difficulty used in the dual n-back research
// literature. NBACK_MATCH_PROB biases stimulus generation so true matches
// actually occur often enough to be worth watching for, not so rare the
// task degenerates into "always tap nothing."
const NBACK_STIMULI = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
const NBACK_STIM_INTERVAL_SEC = 2.2;
const NBACK_EASY_SEC = 20;
const NBACK_N_EASY = 1;
const NBACK_N_HARD = 2;
const NBACK_MATCH_PROB = 0.35;
const NBACK_OUTCOME_KEY = { hit: 'hits', miss: 'misses', falseAlarm: 'falseAlarms', correctRejection: 'correctRejections' };

// ── Stroop colour-word test ──────────────────────────────────────────
// Deliberately NOT the common 4-colour, mostly-congruent version: 6
// visually close colours, 85% incongruent trials (word says one colour,
// ink is another), a shrinking per-trial clock, and shuffled answer-swatch
// order every trial so the response can't become spatial-memory autopilot.
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
  const [phase, setPhase] = useState('intro'); // intro | serialSub | quiz | nback | stroop | review
  const [nowFine, setNowFine] = useState(Date.now());

  // Serial subtraction phase state
  const [serialDeadline, setSerialDeadline] = useState(null);
  const [serialStart, setSerialStart] = useState(0);
  const [serialCurrent, setSerialCurrent] = useState(0);
  const [serialAnswerText, setSerialAnswerText] = useState('');
  const [serialStreak, setSerialStreak] = useState(0);
  const [serialBestStreak, setSerialBestStreak] = useState(0);
  const [serialRestarts, setSerialRestarts] = useState(0);
  const [serialFeedback, setSerialFeedback] = useState(null); // { correct }
  const serialFeedbackHandledRef = useRef(false);

  // Maths phase state
  const [mathDeadline, setMathDeadline] = useState(null);
  const [mathProblem, setMathProblem] = useState(null);
  const [mathQuestionDeadline, setMathQuestionDeadline] = useState(null);
  const [mathAnswerText, setMathAnswerText] = useState('');
  const [mathScore, setMathScore] = useState({ correct: 0, total: 0 });
  const [mathStreak, setMathStreak] = useState(0);
  const [mathFeedback, setMathFeedback] = useState(null); // { correct, correctAnswer, timeout }
  const mathFeedbackHandledRef = useRef(false);

  // Dual n-back phase state
  const [nbackDeadline, setNbackDeadline] = useState(null);
  const [nbackCurrent, setNbackCurrent] = useState(null);
  const [nbackStimDeadline, setNbackStimDeadline] = useState(null);
  const [nbackScore, setNbackScore] = useState({ hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 });
  const [nbackLastOutcome, setNbackLastOutcome] = useState(null);
  const nbackHistoryRef = useRef([]);
  const nbackPhaseStartRef = useRef(0);
  const nbackIsMatchRef = useRef(false);
  const nbackResolvedRef = useRef(true);

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
    // { screen: 'Fusion' } explicit, not just 'Physiological' -- Fusion is
    // PhysiologicalNavigator's initialRouteName, but that only applies on
    // that nested navigator's FIRST mount (same gotcha App.js's own
    // Stack.Navigator key={phase} comment documents), not reliably when
    // returning to an already-mounted one. This is the last step of
    // baseline -> personal-threshold calibration (both Ring + EEG), so
    // landing on Fusion specifically -- not wherever that inner stack
    // last was -- is the point.
    navigation.replace('Physiological', { screen: 'Fusion' });
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

  const startMathPhase = useCallback(() => {
    setMathScore({ correct: 0, total: 0 });
    setMathStreak(0);
    setMathDeadline(Date.now() + MATH_DURATION_SEC * 1000);
    nextMathProblem(0);
    setPhase('quiz');
  }, [nextMathProblem]);

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

  // ── Serial subtraction phase ────────────────────────────────────────
  const startSerialSub = useCallback(() => {
    if (!userId) return;
    triggerEeg();
    triggerRing();
    const start = randomInt(SERIAL_SUB_START_MIN, SERIAL_SUB_START_MAX);
    setSerialStart(start);
    setSerialCurrent(start);
    setSerialAnswerText('');
    setSerialStreak(0);
    setSerialBestStreak(0);
    setSerialRestarts(0);
    setSerialFeedback(null);
    serialFeedbackHandledRef.current = false;
    setSerialDeadline(Date.now() + SERIAL_SUB_DURATION_SEC * 1000);
    setPhase('serialSub');
  }, [userId, triggerEeg, triggerRing]);

  const submitSerial = useCallback(() => {
    if (serialFeedback || serialFeedbackHandledRef.current) return;
    if (serialAnswerText.trim() === '') return;
    serialFeedbackHandledRef.current = true;
    const expected = serialCurrent - SERIAL_SUB_STEP;
    const isCorrect = Number(serialAnswerText.trim()) === expected;
    if (isCorrect) {
      setSerialStreak((s) => {
        const next = s + 1;
        setSerialBestStreak((b) => Math.max(b, next));
        return next;
      });
      setSerialCurrent(expected);
    } else {
      setSerialRestarts((r) => r + 1);
      setSerialStreak(0);
      setSerialCurrent(serialStart);
    }
    setSerialFeedback({ correct: isCorrect });
  }, [serialAnswerText, serialCurrent, serialStart, serialFeedback]);

  useEffect(() => {
    if (phase !== 'serialSub' || !serialFeedback) return undefined;
    const id = setTimeout(() => {
      setSerialFeedback(null);
      setSerialAnswerText('');
      serialFeedbackHandledRef.current = false;
    }, serialFeedback.correct ? 300 : 900);
    return () => clearTimeout(id);
  }, [phase, serialFeedback]);

  // ── Dual n-back phase ────────────────────────────────────────────────
  const advanceNbackStimulus = useCallback(() => {
    const level = (Date.now() - nbackPhaseStartRef.current) < NBACK_EASY_SEC * 1000 ? NBACK_N_EASY : NBACK_N_HARD;
    const history = nbackHistoryRef.current;
    const targetIdx = history.length - level;
    let stim;
    if (targetIdx >= 0 && Math.random() < NBACK_MATCH_PROB) {
      stim = history[targetIdx];
    } else {
      stim = NBACK_STIMULI[randomInt(0, NBACK_STIMULI.length - 1)];
    }
    nbackIsMatchRef.current = targetIdx >= 0 && stim === history[targetIdx];
    nbackHistoryRef.current = [...history, stim];
    nbackResolvedRef.current = false;
    setNbackCurrent(stim);
    setNbackStimDeadline(Date.now() + NBACK_STIM_INTERVAL_SEC * 1000);
  }, []);

  const startNBack = useCallback(() => {
    nbackHistoryRef.current = [];
    nbackPhaseStartRef.current = Date.now();
    setNbackScore({ hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 });
    setNbackLastOutcome(null);
    setNbackDeadline(Date.now() + NBACK_DURATION_SEC * 1000);
    advanceNbackStimulus();
    setPhase('nback');
  }, [advanceNbackStimulus]);

  const resolveNbackTrial = useCallback((tapped) => {
    if (nbackResolvedRef.current) return;
    nbackResolvedRef.current = true;
    const isMatch = nbackIsMatchRef.current;
    const outcome = isMatch && tapped ? 'hit'
      : isMatch && !tapped ? 'miss'
        : !isMatch && tapped ? 'falseAlarm'
          : 'correctRejection';
    const key = NBACK_OUTCOME_KEY[outcome];
    setNbackScore((s) => ({ ...s, [key]: s[key] + 1 }));
    setNbackLastOutcome(outcome);
    advanceNbackStimulus();
  }, [advanceNbackStimulus]);

  const tapNbackMatch = useCallback(() => {
    resolveNbackTrial(true);
  }, [resolveNbackTrial]);

  const nbackLevel = phase === 'nback' && (nowFine - nbackPhaseStartRef.current) < NBACK_EASY_SEC * 1000
    ? NBACK_N_EASY : NBACK_N_HARD;

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

  // Single 100ms clock drives every phase's overall + per-item countdowns --
  // a plain deadline-timestamp comparison rather than a separate
  // setInterval(…, 1000) per phase, so "time's up" fires consistently even
  // if a render is briefly delayed.
  useEffect(() => {
    if (!TASK_PHASES.includes(phase)) return undefined;
    fineTickRef.current = setInterval(() => setNowFine(Date.now()), TICK_MS);
    return () => clearInterval(fineTickRef.current);
  }, [phase]);

  const serialSecondsLeft = serialDeadline ? Math.max(0, Math.ceil((serialDeadline - nowFine) / 1000)) : SERIAL_SUB_DURATION_SEC;
  const serialUrgent = phase === 'serialSub' && serialSecondsLeft <= SERIAL_SUB_DURATION_SEC * SERIAL_URGENCY_FRAC;
  const serialPulseOn = serialUrgent && Math.floor(nowFine / 500) % 2 === 0;

  useEffect(() => {
    if (phase !== 'serialSub' || !serialDeadline) return;
    if (nowFine >= serialDeadline) {
      Keyboard.dismiss();
      startMathPhase();
    }
  }, [phase, nowFine, serialDeadline, startMathPhase]);

  useEffect(() => {
    if (!serialUrgent) return undefined;
    Vibration.vibrate(200);
    const id = setInterval(() => Vibration.vibrate(200), SERIAL_VIBRATE_INTERVAL_MS);
    return () => { clearInterval(id); Vibration.cancel(); };
  }, [serialUrgent]);

  useEffect(() => {
    if (phase !== 'quiz' || !mathDeadline) return;
    if (nowFine >= mathDeadline) {
      Keyboard.dismiss();
      startNBack();
      return;
    }
    if (mathQuestionDeadline && nowFine >= mathQuestionDeadline && !mathFeedbackHandledRef.current) {
      mathTimeout();
    }
  }, [phase, nowFine, mathDeadline, mathQuestionDeadline, mathTimeout, startNBack]);

  useEffect(() => {
    if (phase !== 'quiz' || !mathFeedback) return undefined;
    const id = setTimeout(() => nextMathProblem(mathLevelIdx), 700);
    return () => clearTimeout(id);
  }, [phase, mathFeedback, mathLevelIdx, nextMathProblem]);

  useEffect(() => {
    if (phase !== 'nback' || !nbackDeadline) return;
    if (nowFine >= nbackDeadline) {
      startStroop();
      return;
    }
    if (nbackStimDeadline && nowFine >= nbackStimDeadline && !nbackResolvedRef.current) {
      resolveNbackTrial(false);
    }
  }, [phase, nowFine, nbackDeadline, nbackStimDeadline, resolveNbackTrial, startStroop]);

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
  const nbackSecondsLeft = nbackDeadline ? Math.max(0, Math.ceil((nbackDeadline - nowFine) / 1000)) : NBACK_DURATION_SEC;
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
              About 6 minutes, four rounds back to back -- serial subtraction (count down by 13,
              any mistake restarts you), a speed maths quiz that gets harder the better you do, a
              dual n-back memory task, then a color-word (Stroop) test. Deliberately sustained,
              real pressure -- a short task barely registers before your body's response even
              catches up, so this measures how YOUR signal moves between rest and a genuine
              high-load state, for both your Ring and EEG, instead of relying on a population
              average.
            </Text>
            <Button label="Start Task" onPress={startSerialSub} disabled={!userId} variant="primary" style={{ marginTop: 16 }} />
            <TouchableOpacity onPress={finish} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={[styles.skipText, { color: t.textMuted }]}>Skip for now →</Text>
            </TouchableOpacity>
          </Card>
        )}

        {phase === 'serialSub' && (
          <Card elevated style={[styles.card, serialPulseOn && { borderColor: COLORS.stress, borderWidth: 2 }]}>
            {serialPulseOn && <View style={[styles.urgentOverlay, { backgroundColor: COLORS.stress }]} pointerEvents="none" />}
            <View style={styles.headerRow}>
              <Text style={[styles.timer, { color: serialUrgent ? COLORS.stress : COLORS.brand }]}>{serialSecondsLeft}s</Text>
              <Text style={[styles.scoreText, { color: t.textMuted }]}>
                Best streak {serialBestStreak} · {serialRestarts} restart{serialRestarts === 1 ? '' : 's'}
              </Text>
            </View>
            <Text style={[styles.stroopInstruction, { color: t.textMuted }]}>
              Count down by {SERIAL_SUB_STEP}. Any mistake restarts you from {serialStart}.
            </Text>

            {serialFeedback ? (
              <View style={styles.feedbackWrap}>
                <Text style={[styles.feedbackText, { color: serialFeedback.correct ? COLORS.normal : COLORS.stress }]}>
                  {serialFeedback.correct ? '✓ Correct!' : `✗ Wrong — restarting from ${serialStart}`}
                </Text>
              </View>
            ) : (
              <>
                <Text style={[styles.problem, { color: t.text }]}>{serialCurrent} − {SERIAL_SUB_STEP} = ?</Text>
                <TextInput
                  style={[styles.input, { color: t.text, borderColor: t.border }]}
                  value={serialAnswerText}
                  onChangeText={setSerialAnswerText}
                  keyboardType="number-pad"
                  autoFocus
                  onSubmitEditing={submitSerial}
                  placeholder="Your answer"
                  placeholderTextColor={t.textMuted}
                />
                <Button label="Submit" onPress={submitSerial} variant="primary" style={{ marginTop: 12 }} />
              </>
            )}
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

        {phase === 'nback' && nbackCurrent && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={[styles.timer, { color: COLORS.brand }]}>{nbackSecondsLeft}s</Text>
              <Text style={[styles.scoreText, { color: t.textMuted }]}>
                N={nbackLevel} · {nbackScore.hits} hits · {nbackScore.falseAlarms} false alarms
              </Text>
            </View>
            <Text style={[styles.stroopInstruction, { color: t.textMuted }]}>
              Tap MATCH if this letter is the same as {nbackLevel} step{nbackLevel === 1 ? '' : 's'} back.
            </Text>
            <Text style={[
              styles.nbackLetter,
              { color: t.text, borderColor: nbackLastOutcome === 'hit' || nbackLastOutcome === 'correctRejection' ? COLORS.normal : nbackLastOutcome ? COLORS.stress : 'transparent' },
            ]}>
              {nbackCurrent}
            </Text>
            <Button label="MATCH!" onPress={tapNbackMatch} variant="primary" style={{ marginTop: 8 }} />
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
              Serial subtraction: best streak {serialBestStreak}, {serialRestarts} restart{serialRestarts === 1 ? '' : 's'}.
              Maths: {mathScore.correct}/{mathScore.total} correct. N-back: {nbackScore.hits} hits, {nbackScore.falseAlarms} false alarms.
              Stroop: {stroopScore.correct}/{stroopScore.total} correct.
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
  feedbackText: { fontSize: 26, fontWeight: '900', textAlign: 'center' },
  feedbackSub: { fontSize: 13, marginTop: 6, fontWeight: '600' },
  stroopInstruction: { fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  stroopWord: { fontSize: 34, fontWeight: '900', textAlign: 'center', marginVertical: 20 },
  stroopGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 8 },
  stroopSwatch: { width: 64, height: 64, borderRadius: 14 },
  nbackLetter: {
    fontSize: 56, fontWeight: '900', textAlign: 'center', marginVertical: 20,
    borderWidth: 3, borderRadius: 20, paddingVertical: 10,
  },
  urgentOverlay: { ...StyleSheet.absoluteFillObject, opacity: 0.08, borderRadius: 24 },
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
