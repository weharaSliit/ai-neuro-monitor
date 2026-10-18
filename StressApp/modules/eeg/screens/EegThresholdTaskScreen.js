import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Keyboard, Vibration } from 'react-native';
import { ref, onValue, off, set, update } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Button from '../../shared/Button';
import CalibrationTrendCard from '../../shared/CalibrationTrendCard';
import Icon, { NAMES } from '../../shared/Icon';
import { eegClient } from '../../shared/eegApiClient';
import physiologicalApi from '../../physiological/api/client';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useCalibrationSummary } from '../../shared/CalibrationGate';
import StroopStressor from '../components/StroopStressor';

// Five back-to-back timed activities (serial subtraction -> maths quiz ->
// sequence-recall puzzle -> ticking-clock sorter -> Stroop), 8 minutes
// total. Extended from an earlier 2-activity/80s version because
// task-phase prob_stress was landing around 0.4 against a population
// decision threshold of ~0.71 -- a short task mostly just captures
// physiological ramp-up, not a sustained elevated state (see backend/
// physiological/calibration_capture.py's N_TASK_WIN comment). The maths
// quiz and Stroop test were then further hardened -- unpredictable
// question TYPES (not just escalating difficulty within one fixed
// pattern) and a randomized per-trial task-switch on Stroop --
// specifically so neither task can be learned/predicted and answered on
// autopilot, which would undercut the sustained-effort point of
// extending the duration in the first place. The n-back memory task was
// replaced with a visuospatial sequence-recall puzzle (Corsi
// block-tapping style) for the same reason in a more engaging,
// puzzle-like form. The ticking-clock sorter was added as a fifth
// activity to bring total duration to 8 minutes, deliberately built
// around abrupt, punitive negative feedback (a harsh buzz + a real
// speed setback on a miss, not just "try again") rather than pure
// cognitive load, on top of the escalating-speed pressure itself.
// 8 min in all (backend: 19 EEG blocks, 8 ring windows). The Stroop
// stressor gets 3 min (components/StroopStressor.js); the other rounds were
// shortened to keep the total at 480 s. Same as web/ThresholdTask.jsx.
const SERIAL_SUB_DURATION_SEC = 120;
const MATH_DURATION_SEC = 90;
const PUZZLE_DURATION_SEC = 45;
const SORTER_DURATION_SEC = 45;
const STROOP_DURATION_SEC = 180;
// Comfortably above the ~480s this task now takes end-to-end (backend
// capture ceilings are far higher still, see calibration_capture.py/
// eeg_calibration_capture.py) but still tight enough to flag a genuinely
// stuck capture during the review screen.
// Protocol phase 4: 3 min recovery rest after the 8 min task (both backends
// record it: EEG 7 x 25 s blocks, ring 3 x 60 s windows -- status 'recovery').
const RECOVERY_DURATION_SEC = 180;
const STUCK_WARNING_SEC = 480 + RECOVERY_DURATION_SEC + 60;
const POLL_INTERVAL_MS = 2000;
const TICK_MS = 100;
const IN_PROGRESS = ['capturing', 'saving', 'recovery'];
const TASK_PHASES = ['serialSub', 'quiz', 'puzzle', 'sorter', 'stroop', 'recovery'];

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
// in the TSST literature. Escalating urgency (screen pulse + vibration)
// in the final URGENCY_FRAC of the phase adds a second, more autonomic
// (GSR/HRV-facing) pressure on top of the purely cognitive load the other
// three activities create.
const SERIAL_SUB_STEP = 13;
const SERIAL_SUB_START_MIN = 800;
const SERIAL_SUB_START_MAX = 1200;
const SERIAL_URGENCY_FRAC = 0.2;
const SERIAL_VIBRATE_INTERVAL_MS = 4000;

// ── Maths quiz: unpredictable question types, not just escalating ────
// difficulty ─────────────────────────────────────────────────────────
// Level (unlocked by an unbroken correct streak, reset on any wrong/
// timed-out answer) controls WHICH question types are in play and the
// per-question clock -- but which of those types shows up next is
// picked at random every single question, not in a fixed/learnable
// order. Nine distinct question kinds total (plain arithmetic, missing-
// operand equations, percentages, squares/roots, and multi-step chains)
// so a long correct streak keeps genuinely varying, not just "the same
// kind of sum but bigger numbers."
const MATH_LEVELS = [
  { types: ['add', 'sub'], maxA: 40, maxB: 30, timeSec: 8 },
  { types: ['add', 'sub', 'mul'], maxA: 60, maxB: 12, timeSec: 7 },
  { types: ['add', 'sub', 'mul', 'div', 'missing'], maxA: 70, maxB: 12, timeSec: 6 },
  { types: ['mul', 'div', 'two-step', 'percent', 'missing', 'square'], maxA: 90, maxB: 12, timeSec: 5 },
  { types: ['two-step', 'three-step', 'percent', 'square', 'root', 'missing'], maxA: 30, maxB: 14, timeSec: 4 },
  { types: ['three-step', 'percent', 'square', 'root', 'missing', 'div'], maxA: 35, maxB: 16, timeSec: 3.5 },
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
  const type = level.types[randomInt(0, level.types.length - 1)];

  if (type === 'add') {
    const a = randomInt(10, level.maxA);
    const b = randomInt(10, level.maxA);
    return { display: `${a} + ${b}`, answer: a + b };
  }
  if (type === 'sub') {
    const a = randomInt(15, level.maxA);
    const b = randomInt(5, a - 1);
    return { display: `${a} - ${b}`, answer: a - b };
  }
  if (type === 'mul') {
    const a = randomInt(3, level.maxB);
    const b = randomInt(3, level.maxB);
    return { display: `${a} × ${b}`, answer: a * b };
  }
  if (type === 'div') {
    const divisor = randomInt(2, 12);
    const quotient = randomInt(2, level.maxB);
    return { display: `${divisor * quotient} ÷ ${divisor}`, answer: quotient };
  }
  if (type === 'missing') {
    // Solve for a hidden operand -- randomly the first or second one, so
    // "? + b = c" and "a + ? = c" are both in play, not just one shape.
    const op = Math.random() < 0.5 ? '+' : '-';
    const a = randomInt(10, level.maxA);
    const b = randomInt(5, level.maxB);
    const c = applyOp(a, op, b);
    if (Math.random() < 0.5) {
      return { display: `? ${op} ${b} = ${c}`, answer: a };
    }
    return { display: `${a} ${op} ? = ${c}`, answer: b };
  }
  if (type === 'percent') {
    const percentOptions = [10, 20, 25, 50, 75];
    const percent = percentOptions[randomInt(0, percentOptions.length - 1)];
    const base = randomInt(1, 20) * 20; // multiple of 20 -- keeps every option above an integer result
    return { display: `${percent}% of ${base}`, answer: (base * percent) / 100 };
  }
  if (type === 'square') {
    const n = randomInt(4, 20);
    return { display: `${n}²`, answer: n * n };
  }
  if (type === 'root') {
    const n = randomInt(4, 20);
    return { display: `√${n * n}`, answer: n };
  }
  if (type === 'two-step' || type === 'three-step') {
    const stepOps = ['+', '-', '×'];
    const nSteps = type === 'three-step' ? 3 : 2;
    let a = randomInt(5, level.maxA);
    const parts = [a];
    const ops = [];
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
  return { display: '1 + 1', answer: 2 };
}

// ── Sequence-recall puzzle (Corsi block-tapping style) ───────────────
// Replaces a plain dual n-back: a random sequence of grid tiles lights
// up one at a time, then the user must tap them back in the same order.
// Any wrong tap fails the round (negative feedback, same length tried
// again); a fully correct round grows the sequence by one tile AND
// shrinks how long each tile stays lit (the flash duration), so both
// working-memory load (longer sequence) and perceptual pressure (less
// time to actually register each flash) escalate together the same
// escalating-and-unpredictable spirit as the other activities, in a
// genuinely puzzle-like (not just "watch a letter") form.
const PUZZLE_GRID_SIZE = 9; // 3x3
const PUZZLE_START_LEN = 3;
const PUZZLE_MAX_LEN = 8;
const PUZZLE_FLASH_MS_START = 500;
const PUZZLE_FLASH_MS_MIN = 200;
const PUZZLE_FLASH_MS_DECAY = 20; // per successful round
const PUZZLE_GAP_MS = 250;
const PUZZLE_TILE_COLORS = [
  '#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA',
  '#FB8C00', '#00897B', '#D81B60', '#3949AB',
];

// ── Ticking-clock sorter ─────────────────────────────────────────────
// A two-digit number falls down the play area; tap EVEN or ODD before it
// reaches the bottom. Correct -> the next item falls 10% faster.
// Wrong OR untapped-in-time -> a harsh double-buzz (vibration) and the
// fall speed is set back (not fully reset, but a real, felt penalty),
// deliberately blunter/more punitive feedback than the other activities'
// "wrong, try again" -- the abrupt buzzer-and-setback is the point, not
// just more cognitive load.
const SORTER_TRACK_HEIGHT = 170;
const SORTER_DROP_MS_START = 3200;
const SORTER_DROP_MS_MIN = 1100;
const SORTER_DROP_SPEEDUP = 0.9; // multiply on a correct sort
const SORTER_DROP_SETBACK = 1.4; // multiply on a miss
const SORTER_BUZZ_PATTERN = [0, 120, 60, 120];

// ── Stroop colour-word stressor ──────────────────────────────────────
// See components/StroopStressor.js: 4 colours, 78% incongruent, ink-colour
// rule, fixation cross, MIST-style adaptive response window (2.0 s start,
// 0.8-2.5 s), countdown bar, red flash + buzz on errors, running score.

// Seconds of get-ready countdown before the test starts by itself (route param autoStart,
// set right after the calm baseline so the calibration runs on without another tap).
const AUTO_START_SEC = 10;

export default function EegThresholdTaskScreen({ navigation, route }) {
  const { theme: t, COLORS } = useTheme();
  const { user, token, completeOnboarding } = useAuth();
  const userId = user?.userId;

  // Both sides already carry a personal threshold whenever a returning
  // user's stored profile got picked up by /calibrate's or Ring's own
  // skip-ahead logic (see backend/psychological/app.py's /calibrate route
  // docstring) -- this screen used to send EVERY onboarding pass through
  // the full ~8 minute task regardless, discarding that already-personal
  // value and forcing a redo nobody asked for. Checked once up front so
  // the intro can offer "keep current" instead.
  const { loading: calibLoading, ring: ringCalib, eeg: eegCalib } = useCalibrationSummary(userId, token);
  const alreadyPersonalized = !calibLoading
    && eegCalib?.personal_high_load_p != null && ringCalib?.personal_stress_threshold != null;

  const [sessionId, setSessionId] = useState(null);
  const [autoOn, setAutoOn] = useState(Boolean(route?.params?.autoStart));
  const [autoLeft, setAutoLeft] = useState(AUTO_START_SEC);
  const [phase, setPhase] = useState('intro'); // intro | serialSub | quiz | puzzle | stroop | review
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

  // Sequence-recall puzzle phase state
  const [puzzleDeadline, setPuzzleDeadline] = useState(null);
  const [puzzleLen, setPuzzleLen] = useState(PUZZLE_START_LEN);
  const [puzzleFlashMs, setPuzzleFlashMs] = useState(PUZZLE_FLASH_MS_START);
  const [puzzleSubPhase, setPuzzleSubPhase] = useState('idle'); // idle | showing | input
  const [puzzleShowingIndex, setPuzzleShowingIndex] = useState(null);
  const [puzzleInputIndex, setPuzzleInputIndex] = useState(0);
  const [puzzleScore, setPuzzleScore] = useState({ correct: 0, misses: 0 });
  const [puzzleFeedback, setPuzzleFeedback] = useState(null); // { correct }
  const puzzleSeqRef = useRef([]);
  const puzzleGenRef = useRef(0);

  // Ticking-clock sorter phase state
  const [sorterDeadline, setSorterDeadline] = useState(null);
  const [sorterDropMs, setSorterDropMs] = useState(SORTER_DROP_MS_START);
  const [sorterItemValue, setSorterItemValue] = useState(null);
  const [sorterItemDeadline, setSorterItemDeadline] = useState(null);
  const [sorterScore, setSorterScore] = useState({ correct: 0, misses: 0 });
  const [sorterFeedback, setSorterFeedback] = useState(null); // { correct }
  const sorterResolvedRef = useRef(true);

  // Stroop phase state
  const [recoveryDeadline, setRecoveryDeadline] = useState(null);
  const [colourSafe, setColourSafe] = useState(false);   // purple instead of green
  const [stroopLog, setStroopLog] = useState(null);      // { settings, trials, summary }
  const [stressRating, setStressRating] = useState(null);
  const taskStartedAt = useRef(null);

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
    taskStartedAt.current = Date.now();
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

  // Get-ready countdown, then the first round opens by itself (autoStart route param).
  useEffect(() => {
    if (phase !== 'intro' || !autoOn || alreadyPersonalized || calibLoading || !userId) return undefined;
    if (autoLeft <= 0) { startSerialSub(); return undefined; }
    const id = setTimeout(() => setAutoLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, autoOn, autoLeft, alreadyPersonalized, calibLoading, userId, startSerialSub]);

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

  // ── Sequence-recall puzzle phase ────────────────────────────────────
  const showPuzzleSequence = useCallback((seq, flashMs) => {
    puzzleGenRef.current += 1;
    const gen = puzzleGenRef.current;
    let i = 0;
    const step = () => {
      if (gen !== puzzleGenRef.current) return; // superseded by a new round/phase change
      if (i >= seq.length) {
        setPuzzleShowingIndex(null);
        setPuzzleSubPhase('input');
        return;
      }
      setPuzzleShowingIndex(seq[i]);
      setTimeout(() => {
        if (gen !== puzzleGenRef.current) return;
        setPuzzleShowingIndex(null);
        i += 1;
        setTimeout(step, PUZZLE_GAP_MS);
      }, flashMs);
    };
    step();
  }, []);

  const startPuzzleRound = useCallback((len, flashMs) => {
    const seq = shuffle(Array.from({ length: PUZZLE_GRID_SIZE }, (_, i) => i)).slice(0, len);
    puzzleSeqRef.current = seq;
    setPuzzleInputIndex(0);
    setPuzzleFeedback(null);
    setPuzzleSubPhase('showing');
    showPuzzleSequence(seq, flashMs);
  }, [showPuzzleSequence]);

  const startPuzzle = useCallback(() => {
    setPuzzleLen(PUZZLE_START_LEN);
    setPuzzleFlashMs(PUZZLE_FLASH_MS_START);
    setPuzzleScore({ correct: 0, misses: 0 });
    setPuzzleDeadline(Date.now() + PUZZLE_DURATION_SEC * 1000);
    setPhase('puzzle');
    startPuzzleRound(PUZZLE_START_LEN, PUZZLE_FLASH_MS_START);
  }, [startPuzzleRound]);

  const tapPuzzleTile = useCallback((idx) => {
    if (puzzleSubPhase !== 'input' || puzzleFeedback) return;
    const seq = puzzleSeqRef.current;
    const expected = seq[puzzleInputIndex];
    if (idx === expected) {
      const nextIdx = puzzleInputIndex + 1;
      if (nextIdx >= seq.length) {
        setPuzzleScore((s) => ({ ...s, correct: s.correct + 1 }));
        setPuzzleLen((l) => Math.min(PUZZLE_MAX_LEN, l + 1));
        setPuzzleFlashMs((f) => Math.max(PUZZLE_FLASH_MS_MIN, f - PUZZLE_FLASH_MS_DECAY));
        setPuzzleFeedback({ correct: true });
      } else {
        setPuzzleInputIndex(nextIdx);
      }
    } else {
      setPuzzleScore((s) => ({ ...s, misses: s.misses + 1 }));
      setPuzzleFeedback({ correct: false });
    }
  }, [puzzleSubPhase, puzzleFeedback, puzzleInputIndex]);

  useEffect(() => {
    if (phase !== 'puzzle' || !puzzleFeedback) return undefined;
    const id = setTimeout(() => {
      startPuzzleRound(puzzleLen, puzzleFlashMs);
    }, puzzleFeedback.correct ? 500 : 900);
    return () => clearTimeout(id);
  }, [phase, puzzleFeedback, puzzleLen, puzzleFlashMs, startPuzzleRound]);

  // ── Ticking-clock sorter phase ──────────────────────────────────────
  const spawnSorterItem = useCallback((dropMs) => {
    sorterResolvedRef.current = false;
    setSorterItemValue(randomInt(10, 99));
    setSorterItemDeadline(Date.now() + dropMs);
    setSorterFeedback(null);
  }, []);

  const startSorter = useCallback(() => {
    setSorterDropMs(SORTER_DROP_MS_START);
    setSorterScore({ correct: 0, misses: 0 });
    setSorterDeadline(Date.now() + SORTER_DURATION_SEC * 1000);
    setPhase('sorter');
    spawnSorterItem(SORTER_DROP_MS_START);
  }, [spawnSorterItem]);

  const resolveSorterTap = useCallback((bin) => {
    if (sorterResolvedRef.current || sorterItemValue == null) return;
    sorterResolvedRef.current = true;
    const isEven = sorterItemValue % 2 === 0;
    const isCorrect = (bin === 'even') === isEven;
    if (isCorrect) {
      setSorterScore((s) => ({ ...s, correct: s.correct + 1 }));
      setSorterDropMs((d) => Math.max(SORTER_DROP_MS_MIN, d * SORTER_DROP_SPEEDUP));
    } else {
      Vibration.vibrate(SORTER_BUZZ_PATTERN);
      setSorterScore((s) => ({ ...s, misses: s.misses + 1 }));
      setSorterDropMs((d) => Math.min(SORTER_DROP_MS_START, d * SORTER_DROP_SETBACK));
    }
    setSorterFeedback({ correct: isCorrect });
  }, [sorterItemValue]);

  useEffect(() => {
    if (phase !== 'sorter' || !sorterFeedback) return undefined;
    const id = setTimeout(() => spawnSorterItem(sorterDropMs), sorterFeedback.correct ? 250 : 500);
    return () => clearTimeout(id);
  }, [phase, sorterFeedback, sorterDropMs, spawnSorterItem]);

  // ── Stroop phase ─────────────────────────────────────────────────
  const startStroop = useCallback(() => setPhase('stroop'), []);
  // Trial log + summary: engagement check, and alignment of trials with EEG
  // blocks / ring windows by timestamp (calibration_tasks/{uid}/{session}).
  const taskPath = userId && sessionId ? `calibration_tasks/${userId}/${sessionId}` : null;
  const finishStroop = useCallback((log) => {
    setStroopLog(log);
    setRecoveryDeadline(Date.now() + RECOVERY_DURATION_SEC * 1000);
    setPhase('recovery');
    if (taskPath) {
      set(ref(db, taskPath), {
        started_at: taskStartedAt.current, stroop_finished_at: Date.now(), source: 'app',
        durations_sec: { serial: SERIAL_SUB_DURATION_SEC, maths: MATH_DURATION_SEC, puzzle: PUZZLE_DURATION_SEC,
          sorter: SORTER_DURATION_SEC, stroop: STROOP_DURATION_SEC, recovery: RECOVERY_DURATION_SEC },
        stroop: log,
      }).catch(() => {});
    }
  }, [taskPath]);
  const saveRating = (r) => {
    setStressRating(r);
    if (taskPath) update(ref(db, taskPath), { manipulation_check: { stress_rating_1_9: r, at: Date.now() } }).catch(() => {});
  };

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
      startPuzzle();
      return;
    }
    if (mathQuestionDeadline && nowFine >= mathQuestionDeadline && !mathFeedbackHandledRef.current) {
      mathTimeout();
    }
  }, [phase, nowFine, mathDeadline, mathQuestionDeadline, mathTimeout, startPuzzle]);

  useEffect(() => {
    if (phase !== 'quiz' || !mathFeedback) return undefined;
    const id = setTimeout(() => nextMathProblem(mathLevelIdx), 700);
    return () => clearTimeout(id);
  }, [phase, mathFeedback, mathLevelIdx, nextMathProblem]);

  useEffect(() => {
    if (phase !== 'puzzle' || !puzzleDeadline) return;
    if (nowFine >= puzzleDeadline) {
      puzzleGenRef.current += 1; // invalidate any in-flight playback timeouts
      startSorter();
    }
  }, [phase, nowFine, puzzleDeadline, startSorter]);

  useEffect(() => {
    if (phase !== 'sorter' || !sorterDeadline) return;
    if (nowFine >= sorterDeadline) {
      startStroop();
      return;
    }
    if (sorterItemDeadline && nowFine >= sorterItemDeadline && !sorterResolvedRef.current) {
      // Item reached the bottom unsorted -- same miss handling as a wrong
      // tap (buzz + speed setback), just triggered by the clock instead
      // of a tap.
      sorterResolvedRef.current = true;
      Vibration.vibrate(SORTER_BUZZ_PATTERN);
      setSorterScore((s) => ({ ...s, misses: s.misses + 1 }));
      setSorterDropMs((d) => Math.min(SORTER_DROP_MS_START, d * SORTER_DROP_SETBACK));
      setSorterFeedback({ correct: false });
    }
  }, [phase, nowFine, sorterDeadline, sorterItemDeadline, startStroop]);


  useEffect(() => {
    if (phase === 'recovery' && recoveryDeadline && nowFine >= recoveryDeadline) setPhase('review');
  }, [phase, nowFine, recoveryDeadline]);


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
  const puzzleSecondsLeft = puzzleDeadline ? Math.max(0, Math.ceil((puzzleDeadline - nowFine) / 1000)) : PUZZLE_DURATION_SEC;
  const sorterSecondsLeft = sorterDeadline ? Math.max(0, Math.ceil((sorterDeadline - nowFine) / 1000)) : SORTER_DURATION_SEC;
  const sorterFallFrac = sorterItemDeadline
    ? Math.max(0, Math.min(1, 1 - (sorterItemDeadline - nowFine) / sorterDropMs))
    : 0;

  return (
    <ScreenBackground>
      <View style={styles.container}>
        {phase === 'intro' && alreadyPersonalized && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Icon name={NAMES.eeg} size={22} color={COLORS.brand} />
              <Text style={[styles.title, { color: t.text }]}>Threshold Already Personalized</Text>
            </View>
            <Text style={[styles.body, { color: t.textMuted }]}>
              Your high-load (EEG) and stress (Ring) thresholds are already personalized -- EEG at
              {' '}{Math.round(eegCalib.personal_high_load_p * 100)}%, Ring at{' '}
              {Math.round(ringCalib.personal_stress_threshold * 100)}%. You can keep these, or redo
              the ~11 minute task to refresh them against your current physiology.
            </Text>
            <Button label="Keep Current & Continue" onPress={finish} variant="primary" style={{ marginTop: 16 }} />
            <TouchableOpacity onPress={startSerialSub} disabled={!userId} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={[styles.skipText, { color: t.textMuted }]}>Redo anyway →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('CalibrationTrend')} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={[styles.skipText, { color: COLORS.brand }]}>View calibration trend →</Text>
            </TouchableOpacity>
          </Card>
        )}

        {phase === 'intro' && !alreadyPersonalized && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Icon name={NAMES.eeg} size={22} color={COLORS.brand} />
              <Text style={[styles.title, { color: t.text }]}>Personalize Your Threshold</Text>
            </View>
            <Text style={[styles.body, { color: t.textMuted }]}>
              About 11 minutes: 8 minutes of five rounds back to back, then 3 minutes of quiet rest. Rest the phone on a table and tap your answers -- don't say them out loud. Rounds: serial subtraction (count down by 13,
              any mistake restarts you), a speed maths quiz with unpredictable question types that
              gets harder the better you do, a sequence-recall puzzle, a ticking-clock sorter that
              punishes any miss with a buzz and a real speed setback, then a 3-minute color-word (Stroop)
              test: tap the ink colour, not the word, against a clock that speeds up as you get better. Deliberately sustained, real
              pressure -- a short task barely registers before your body's response even catches up
              -- so this measures how YOUR signal moves between rest and a genuine high-load state,
              for both your Ring and EEG, instead of relying on a population average.
            </Text>
            <TouchableOpacity onPress={() => setColourSafe((v) => !v)} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={[styles.skipText, { color: t.textMuted }]}>
                {colourSafe ? '☑' : '☐'} I find red and green hard to tell apart (use purple instead of green)
              </Text>
            </TouchableOpacity>
            {autoOn && !calibLoading && (
              <Text style={[styles.body, { color: t.text, fontWeight: '700', marginTop: 12 }]}>
                The test starts by itself in {autoLeft}s. Put your devices on and rest the phone on a table.
              </Text>
            )}
            <Button label={autoOn ? 'Start now' : 'Start Task'} onPress={startSerialSub} disabled={!userId || calibLoading} variant="primary" style={{ marginTop: 16 }} />
            {autoOn && (
              <TouchableOpacity onPress={() => setAutoOn(false)} activeOpacity={0.7} style={styles.skipRow}>
                <Text style={[styles.skipText, { color: t.textMuted }]}>Not yet</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={finish} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={[styles.skipText, { color: t.textMuted }]}>Skip for now →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('CalibrationTrend')} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={[styles.skipText, { color: COLORS.brand }]}>View calibration trend →</Text>
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

        {phase === 'puzzle' && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={[styles.timer, { color: COLORS.brand }]}>{puzzleSecondsLeft}s</Text>
              <Text style={[styles.scoreText, { color: t.textMuted }]}>
                Length {puzzleLen} · {puzzleScore.correct} solved · {puzzleScore.misses} missed
              </Text>
            </View>
            <Text style={[styles.stroopInstruction, { color: t.textMuted }]}>
              {puzzleSubPhase === 'showing'
                ? 'Watch the sequence…'
                : `Your turn — tap them in order (${puzzleInputIndex}/${puzzleSeqRef.current.length})`}
            </Text>

            {puzzleFeedback ? (
              <View style={styles.feedbackWrap}>
                <Text style={[styles.feedbackText, { color: puzzleFeedback.correct ? COLORS.normal : COLORS.stress }]}>
                  {puzzleFeedback.correct ? '✓ Solved!' : '✗ Wrong order'}
                </Text>
              </View>
            ) : (
              <View style={styles.puzzleGrid}>
                {Array.from({ length: PUZZLE_GRID_SIZE }, (_, i) => i).map((i) => (
                  <TouchableOpacity
                    key={i}
                    disabled={puzzleSubPhase !== 'input'}
                    onPress={() => tapPuzzleTile(i)}
                    style={[
                      styles.puzzleTile,
                      {
                        backgroundColor: PUZZLE_TILE_COLORS[i],
                        opacity: puzzleShowingIndex === i ? 1 : puzzleSubPhase === 'showing' ? 0.25 : 0.85,
                        transform: [{ scale: puzzleShowingIndex === i ? 1.08 : 1 }],
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </Card>
        )}

        {phase === 'sorter' && sorterItemValue != null && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={[styles.timer, { color: COLORS.brand }]}>{sorterSecondsLeft}s</Text>
              <Text style={[styles.scoreText, { color: t.textMuted }]}>
                {sorterScore.correct} sorted · {sorterScore.misses} missed
              </Text>
            </View>
            <Text style={[styles.stroopInstruction, { color: t.textMuted }]}>
              Tap EVEN or ODD before it hits the bottom.
            </Text>

            {sorterFeedback ? (
              <View style={styles.feedbackWrap}>
                <Text style={[styles.feedbackText, { color: sorterFeedback.correct ? COLORS.normal : COLORS.stress }]}>
                  {sorterFeedback.correct ? '✓ Sorted!' : '✗ Missed!'}
                </Text>
              </View>
            ) : (
              <View style={styles.sorterTrack}>
                <Text style={[styles.sorterItem, { color: t.text, top: sorterFallFrac * (SORTER_TRACK_HEIGHT - 44) }]}>
                  {sorterItemValue}
                </Text>
              </View>
            )}

            <View style={styles.sorterBinRow}>
              <TouchableOpacity
                disabled={!!sorterFeedback}
                onPress={() => resolveSorterTap('even')}
                style={[styles.sorterBin, { backgroundColor: COLORS.brand, opacity: sorterFeedback ? 0.5 : 1 }]}
              >
                <Text style={styles.sorterBinText}>EVEN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!!sorterFeedback}
                onPress={() => resolveSorterTap('odd')}
                style={[styles.sorterBin, { backgroundColor: COLORS.stress, opacity: sorterFeedback ? 0.5 : 1 }]}
              >
                <Text style={styles.sorterBinText}>ODD</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {phase === 'stroop' && (
          <StroopStressor durationSec={STROOP_DURATION_SEC} colourSafe={colourSafe} roundLabel="Round 5 of 5"
            onDone={finishStroop} theme={t} COLORS={COLORS} />
        )}

        {phase === 'recovery' && (() => {
          const secs = recoveryDeadline ? Math.max(0, Math.ceil((recoveryDeadline - nowFine) / 1000)) : RECOVERY_DURATION_SEC;
          return (
            <Card elevated style={styles.card}>
              <View style={styles.headerRow}>
                <Icon name={NAMES.eeg} size={22} color={COLORS.brand} />
                <Text style={[styles.title, { color: t.text }]}>Recovery Rest · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</Text>
              </View>
              <Text style={[styles.body, { color: t.textMuted }]}>
                Well done -- the task is over. Now just rest: sit still, eyes open, breathe normally and look at one spot.
                This shows how quickly you settle after stress. Keep both devices on.
              </Text>
              <Button label="Skip the Rest" onPress={() => setPhase('review')} variant="secondary" style={{ marginTop: 16 }} />
            </Card>
          );
        })()}

        {phase === 'review' && (
          <Card elevated style={styles.card}>
            <View style={styles.headerRow}>
              <Icon name={NAMES.eeg} size={22} color={COLORS.brand} />
              <Text style={[styles.title, { color: t.text }]}>Threshold Results</Text>
            </View>
            <Text style={[styles.body, { color: t.textMuted }]}>
              Serial subtraction: best streak {serialBestStreak}, {serialRestarts} restart{serialRestarts === 1 ? '' : 's'}.
              Maths: {mathScore.correct}/{mathScore.total} correct. Puzzle: {puzzleScore.correct} solved, {puzzleScore.misses} missed.
              Sorter: {sorterScore.correct} sorted, {sorterScore.misses} missed.
              Stroop: {stroopLog ? `${Math.round((stroopLog.summary.accuracy ?? 0) * 100)}% of ${stroopLog.summary.n_trials}` : '—'}
              {stroopLog ? ` (engagement: ${stroopLog.summary.engagement}; aim 50–85%)` : ''}.
              Each device reports independently below -- one taking longer doesn't hold up the other.
            </Text>

            <Text style={[styles.resultLabel, { color: t.text, marginTop: 12 }]}>How stressful did the tasks feel?</Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => (
                <TouchableOpacity key={r} onPress={() => saveRating(r)} activeOpacity={0.7}
                  style={[styles.ratingBtn, { borderColor: COLORS.brand, backgroundColor: stressRating === r ? COLORS.brand : 'transparent' }]}>
                  <Text style={{ color: stressRating === r ? '#FFFFFF' : COLORS.brand, fontWeight: '800' }}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.skipText, { color: t.textMuted }]}>1 = not at all · 9 = extremely{stressRating != null ? ' · thanks!' : ''}</Text>

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

        {phase !== 'intro' && (
          <CalibrationTrendCard userId={userId} sessionId={sessionId} />
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
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  ratingBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  puzzleGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    width: 3 * 68 + 2 * 10, alignSelf: 'center', gap: 10, marginVertical: 12,
  },
  puzzleTile: { width: 68, height: 68, borderRadius: 14 },
  sorterTrack: { height: SORTER_TRACK_HEIGHT, marginVertical: 8 },
  sorterItem: { position: 'absolute', alignSelf: 'center', fontSize: 34, fontWeight: '900' },
  sorterBinRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  sorterBin: { flex: 1, paddingVertical: 18, borderRadius: 16, alignItems: 'center' },
  sorterBinText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
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
