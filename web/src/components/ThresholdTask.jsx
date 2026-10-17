import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, eegApi } from '../lib/api';
import { ref, set, update } from 'firebase/database';
import { COLORS } from '../lib/levels';
import { db } from '../lib/firebase';
import StroopStressor from './StroopStressor';

// Web port of StressApp/modules/eeg/screens/EegThresholdTaskScreen.js --
// identical activities, timings and difficulty, and the same
// /calibrate/threshold/start + /status calls on both backends, so a
// limit set here is exactly the same as one set in the app.
// 8 min in all (backend: 19 EEG blocks, 8 ring windows). The Stroop
// stressor gets 3 min (a 70 s Stroop is too short to build sustained
// load); the other rounds were shortened to keep the total at 480 s.
const SERIAL_SUB_DURATION_SEC = 120;
const MATH_DURATION_SEC = 90;
const PUZZLE_DURATION_SEC = 45;
const SORTER_DURATION_SEC = 45;
const STROOP_DURATION_SEC = 180;
// Protocol phase 4: 3 min recovery rest after the 8 min task (both backends
// record it: EEG 7 x 25 s blocks, ring 3 x 60 s windows -- status 'recovery').
const RECOVERY_DURATION_SEC = 180;
const STUCK_WARNING_SEC = 480 + RECOVERY_DURATION_SEC + 60;
const POLL_INTERVAL_MS = 2000;
const TICK_MS = 100;
const IN_PROGRESS = ['capturing', 'saving', 'recovery'];
const TASK_PHASES = ['serialSub', 'quiz', 'puzzle', 'sorter', 'stroop', 'recovery'];

const SERIAL_SUB_STEP = 13;
const SERIAL_URGENCY_FRAC = 0.2;

const MATH_LEVELS = [
  { types: ['add', 'sub'], maxA: 40, maxB: 30, timeSec: 8 },
  { types: ['add', 'sub', 'mul'], maxA: 60, maxB: 12, timeSec: 7 },
  { types: ['add', 'sub', 'mul', 'div', 'missing'], maxA: 70, maxB: 12, timeSec: 6 },
  { types: ['mul', 'div', 'two-step', 'percent', 'missing', 'square'], maxA: 90, maxB: 12, timeSec: 5 },
  { types: ['two-step', 'three-step', 'percent', 'square', 'root', 'missing'], maxA: 30, maxB: 14, timeSec: 4 },
  { types: ['three-step', 'percent', 'square', 'root', 'missing', 'div'], maxA: 35, maxB: 16, timeSec: 3.5 },
];
const LEVEL_UP_STREAK = 3;

const PUZZLE_GRID_SIZE = 9;
const PUZZLE_START_LEN = 3;
const PUZZLE_MAX_LEN = 8;
const PUZZLE_FLASH_MS_START = 500;
const PUZZLE_FLASH_MS_MIN = 200;
const PUZZLE_FLASH_MS_DECAY = 20;
const PUZZLE_GAP_MS = 250;
const PUZZLE_TILE_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#FB8C00', '#00897B', '#D81B60', '#3949AB'];

const SORTER_TRACK_HEIGHT = 170;
const SORTER_DROP_MS_START = 3200;
const SORTER_DROP_MS_MIN = 1100;
const SORTER_DROP_SPEEDUP = 0.9;
const SORTER_DROP_SETBACK = 1.4;
const SORTER_BUZZ_PATTERN = [0, 120, 60, 120];


const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = randomInt(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Vibration works on Android browsers; silently ignored elsewhere.
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };

function applyOp(a, op, b) { return op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : a; }

function generateMathProblem(levelIdx) {
  const level = MATH_LEVELS[levelIdx];
  const type = level.types[randomInt(0, level.types.length - 1)];
  if (type === 'add') { const a = randomInt(10, level.maxA); const b = randomInt(10, level.maxA); return { display: `${a} + ${b}`, answer: a + b }; }
  if (type === 'sub') { const a = randomInt(15, level.maxA); const b = randomInt(5, a - 1); return { display: `${a} - ${b}`, answer: a - b }; }
  if (type === 'mul') { const a = randomInt(3, level.maxB); const b = randomInt(3, level.maxB); return { display: `${a} × ${b}`, answer: a * b }; }
  if (type === 'div') { const d = randomInt(2, 12); const q = randomInt(2, level.maxB); return { display: `${d * q} ÷ ${d}`, answer: q }; }
  if (type === 'missing') {
    const op = Math.random() < 0.5 ? '+' : '-';
    const a = randomInt(10, level.maxA); const b = randomInt(5, level.maxB); const c = applyOp(a, op, b);
    return Math.random() < 0.5 ? { display: `? ${op} ${b} = ${c}`, answer: a } : { display: `${a} ${op} ? = ${c}`, answer: b };
  }
  if (type === 'percent') {
    const p = [10, 20, 25, 50, 75][randomInt(0, 4)]; const base = randomInt(1, 20) * 20;
    return { display: `${p}% of ${base}`, answer: (base * p) / 100 };
  }
  if (type === 'square') { const n = randomInt(4, 20); return { display: `${n}²`, answer: n * n }; }
  if (type === 'root') { const n = randomInt(4, 20); return { display: `√${n * n}`, answer: n }; }
  if (type === 'two-step' || type === 'three-step') {
    const stepOps = ['+', '-', '×']; const nSteps = type === 'three-step' ? 3 : 2;
    const a = randomInt(5, level.maxA); const parts = [a]; const ops = []; let acc = a;
    for (let i = 0; i < nSteps; i += 1) {
      const op = stepOps[randomInt(0, 2)]; let b = randomInt(2, level.maxB); let next = applyOp(acc, op, b);
      if (next < 0) { b = randomInt(2, Math.max(2, acc)); next = applyOp(acc, op, b); }
      ops.push(op); parts.push(b); acc = next;
    }
    return { display: parts.reduce((s, v, i) => (i === 0 ? `${v}` : `${s} ${ops[i - 1]} ${v}`), ''), answer: acc };
  }
  return { display: '1 + 1', answer: 2 };
}


function Header({ secondsLeft, urgent, right }) {
  return (
    <div className="between" style={{ marginBottom: 10 }}>
      <span style={{ fontSize: 30, fontWeight: 900, color: urgent ? COLORS.stress : COLORS.brand }}>{secondsLeft}s</span>
      <span className="caption">{right}</span>
    </div>
  );
}

function Feedback({ ok, text, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 0' }}>
      <div style={{ fontSize: 24, fontWeight: 900, color: ok ? COLORS.normal : COLORS.stress }}>{text}</div>
      {sub && <div className="body" style={{ marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function AnswerBox({ value, onChange, onSubmit }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <div className="field">
        <input autoFocus inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))}
          placeholder="Your answer" style={{ fontSize: 22, textAlign: 'center', fontWeight: 800 }} />
      </div>
      <button className="btn" style={{ width: '100%' }}>Submit (Enter)</button>
    </form>
  );
}

export default function ThresholdTask({ userId, eegSessionId, alreadyPersonalized, ringCal, eegCal, onFinish, disabled }) {
  const [phase, setPhase] = useState('intro');
  const [nowFine, setNowFine] = useState(Date.now());

  const [serialDeadline, setSerialDeadline] = useState(null);
  const [serialStart, setSerialStart] = useState(0);
  const [serialCurrent, setSerialCurrent] = useState(0);
  const [serialAnswer, setSerialAnswer] = useState('');
  const [serialBest, setSerialBest] = useState(0);
  const [serialStreak, setSerialStreak] = useState(0);
  const [serialRestarts, setSerialRestarts] = useState(0);
  const [serialFeedback, setSerialFeedback] = useState(null);

  const [mathDeadline, setMathDeadline] = useState(null);
  const [mathProblem, setMathProblem] = useState(null);
  const [mathQDeadline, setMathQDeadline] = useState(null);
  const [mathAnswer, setMathAnswer] = useState('');
  const [mathScore, setMathScore] = useState({ correct: 0, total: 0 });
  const [mathStreak, setMathStreak] = useState(0);
  const [mathFeedback, setMathFeedback] = useState(null);
  const mathHandled = useRef(false);

  const [puzzleDeadline, setPuzzleDeadline] = useState(null);
  const [puzzleLen, setPuzzleLen] = useState(PUZZLE_START_LEN);
  const [puzzleFlashMs, setPuzzleFlashMs] = useState(PUZZLE_FLASH_MS_START);
  const [puzzleSub, setPuzzleSub] = useState('idle');
  const [puzzleShowing, setPuzzleShowing] = useState(null);
  const [puzzleInputIdx, setPuzzleInputIdx] = useState(0);
  const [puzzleScore, setPuzzleScore] = useState({ correct: 0, misses: 0 });
  const [puzzleFeedback, setPuzzleFeedback] = useState(null);
  const puzzleSeq = useRef([]);
  const puzzleGen = useRef(0);

  const [sorterDeadline, setSorterDeadline] = useState(null);
  const [sorterDropMs, setSorterDropMs] = useState(SORTER_DROP_MS_START);
  const [sorterValue, setSorterValue] = useState(null);
  const [sorterItemDeadline, setSorterItemDeadline] = useState(null);
  const [sorterScore, setSorterScore] = useState({ correct: 0, misses: 0 });
  const [sorterFeedback, setSorterFeedback] = useState(null);
  const sorterResolved = useRef(true);

  const [recoveryDeadline, setRecoveryDeadline] = useState(null);
  const [colourSafe, setColourSafe] = useState(false);   // purple instead of green
  const [stroopLog, setStroopLog] = useState(null);      // { settings, trials, summary }
  const [stressRating, setStressRating] = useState(null);
  const [ratingSaved, setRatingSaved] = useState(false);
  const taskStartedAt = useRef(null);

  const [eegResult, setEegResult] = useState(null);
  const [eegTriggeredAt, setEegTriggeredAt] = useState(null);
  const [ringResult, setRingResult] = useState(null);
  const [ringTriggeredAt, setRingTriggeredAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  // EEG polling only starts once the server has ACCEPTED this run. The
  // EEG service keeps calibrated sessions in memory, so after a Render
  // restart the start call 400s ("not calibrated") -- polling anyway read
  // the status route's 'idle' (or a previous run's result) and told the
  // user their rest/task readings "weren't different enough".
  const [eegStarted, setEegStarted] = useState(false);
  const eegAttempt = useRef(0);
  const triggerEeg = useCallback(() => {
    if (!eegSessionId) return;
    const attempt = ++eegAttempt.current;
    setEegResult(null); setEegStarted(false); setEegTriggeredAt(Date.now());
    eegApi.post('/calibrate/threshold/start', { session_id: eegSessionId })
      .then(() => { if (attempt === eegAttempt.current) setEegStarted(true); })
      .catch((e) => {
        if (attempt !== eegAttempt.current) return;
        const code = e?.response?.status;
        if (code === 409) { setEegStarted(true); return; } // already running -- follow that run
        setEegResult({
          status: 'error',
          error: code === 400
            ? 'The headband isn’t calibrated on the server any more (it may have restarted). Redo the calm-breathing step, then try again.'
            : (e?.response?.data?.error || 'Couldn’t start the headband measurement — check your connection and try again.'),
        });
      });
  }, [eegSessionId]);
  const triggerRing = useCallback(() => {
    setRingResult(null); setRingTriggeredAt(Date.now());
    api.post('/calibrate/threshold/start', {}).catch(() => {});
  }, []);

  // ── Maths ──
  const mathLevelIdx = Math.min(MATH_LEVELS.length - 1, Math.floor(mathStreak / LEVEL_UP_STREAK));
  const nextMath = useCallback((lvl) => {
    setMathProblem(generateMathProblem(lvl));
    setMathQDeadline(Date.now() + MATH_LEVELS[lvl].timeSec * 1000);
    setMathAnswer(''); setMathFeedback(null); mathHandled.current = false;
  }, []);
  const startMath = useCallback(() => {
    setMathScore({ correct: 0, total: 0 }); setMathStreak(0);
    setMathDeadline(Date.now() + MATH_DURATION_SEC * 1000);
    nextMath(0); setPhase('quiz');
  }, [nextMath]);
  const submitMath = () => {
    if (!mathProblem || mathFeedback || mathHandled.current || mathAnswer.trim() === '') return;
    mathHandled.current = true;
    const ok = Number(mathAnswer.trim()) === mathProblem.answer;
    setMathScore((s) => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1 }));
    setMathStreak((s) => (ok ? s + 1 : 0));
    setMathFeedback({ correct: ok, correctAnswer: mathProblem.answer });
  };

  // ── Serial subtraction ──
  const startSerial = () => {
    triggerEeg(); triggerRing();
    taskStartedAt.current = Date.now();
    const start = randomInt(800, 1200);
    setSerialStart(start); setSerialCurrent(start); setSerialAnswer('');
    setSerialStreak(0); setSerialBest(0); setSerialRestarts(0); setSerialFeedback(null);
    setSerialDeadline(Date.now() + SERIAL_SUB_DURATION_SEC * 1000);
    setPhase('serialSub');
  };
  const submitSerial = () => {
    if (serialFeedback || serialAnswer.trim() === '') return;
    const expected = serialCurrent - SERIAL_SUB_STEP;
    const ok = Number(serialAnswer.trim()) === expected;
    if (ok) {
      const next = serialStreak + 1;
      setSerialStreak(next); setSerialBest((b) => Math.max(b, next)); setSerialCurrent(expected);
    } else {
      setSerialRestarts((r) => r + 1); setSerialStreak(0); setSerialCurrent(serialStart);
    }
    setSerialFeedback({ correct: ok });
  };
  useEffect(() => {
    if (phase !== 'serialSub' || !serialFeedback) return undefined;
    const id = setTimeout(() => { setSerialFeedback(null); setSerialAnswer(''); }, serialFeedback.correct ? 300 : 900);
    return () => clearTimeout(id);
  }, [phase, serialFeedback]);

  // ── Puzzle ──
  const showSequence = useCallback((seq, flashMs) => {
    puzzleGen.current += 1;
    const gen = puzzleGen.current;
    let i = 0;
    const step = () => {
      if (gen !== puzzleGen.current) return;
      if (i >= seq.length) { setPuzzleShowing(null); setPuzzleSub('input'); return; }
      setPuzzleShowing(seq[i]);
      setTimeout(() => {
        if (gen !== puzzleGen.current) return;
        setPuzzleShowing(null); i += 1; setTimeout(step, PUZZLE_GAP_MS);
      }, flashMs);
    };
    step();
  }, []);
  const startRound = useCallback((len, flashMs) => {
    const seq = shuffle(Array.from({ length: PUZZLE_GRID_SIZE }, (_, i) => i)).slice(0, len);
    puzzleSeq.current = seq; setPuzzleInputIdx(0); setPuzzleFeedback(null); setPuzzleSub('showing');
    showSequence(seq, flashMs);
  }, [showSequence]);
  const startPuzzle = useCallback(() => {
    setPuzzleLen(PUZZLE_START_LEN); setPuzzleFlashMs(PUZZLE_FLASH_MS_START);
    setPuzzleScore({ correct: 0, misses: 0 });
    setPuzzleDeadline(Date.now() + PUZZLE_DURATION_SEC * 1000);
    setPhase('puzzle'); startRound(PUZZLE_START_LEN, PUZZLE_FLASH_MS_START);
  }, [startRound]);
  const tapTile = (idx) => {
    if (puzzleSub !== 'input' || puzzleFeedback) return;
    const seq = puzzleSeq.current;
    if (idx === seq[puzzleInputIdx]) {
      const n = puzzleInputIdx + 1;
      if (n >= seq.length) {
        setPuzzleScore((s) => ({ ...s, correct: s.correct + 1 }));
        setPuzzleLen((l) => Math.min(PUZZLE_MAX_LEN, l + 1));
        setPuzzleFlashMs((f) => Math.max(PUZZLE_FLASH_MS_MIN, f - PUZZLE_FLASH_MS_DECAY));
        setPuzzleFeedback({ correct: true });
      } else setPuzzleInputIdx(n);
    } else {
      setPuzzleScore((s) => ({ ...s, misses: s.misses + 1 }));
      setPuzzleFeedback({ correct: false });
    }
  };
  useEffect(() => {
    if (phase !== 'puzzle' || !puzzleFeedback) return undefined;
    const id = setTimeout(() => startRound(puzzleLen, puzzleFlashMs), puzzleFeedback.correct ? 500 : 900);
    return () => clearTimeout(id);
  }, [phase, puzzleFeedback, puzzleLen, puzzleFlashMs, startRound]);

  // ── Sorter ──
  const spawnItem = useCallback((dropMs) => {
    sorterResolved.current = false;
    setSorterValue(randomInt(10, 99)); setSorterItemDeadline(Date.now() + dropMs); setSorterFeedback(null);
  }, []);
  const startSorter = useCallback(() => {
    setSorterDropMs(SORTER_DROP_MS_START); setSorterScore({ correct: 0, misses: 0 });
    setSorterDeadline(Date.now() + SORTER_DURATION_SEC * 1000);
    setPhase('sorter'); spawnItem(SORTER_DROP_MS_START);
  }, [spawnItem]);
  const sortTap = (bin) => {
    if (sorterResolved.current || sorterValue == null) return;
    sorterResolved.current = true;
    const ok = (bin === 'even') === (sorterValue % 2 === 0);
    if (ok) {
      setSorterScore((s) => ({ ...s, correct: s.correct + 1 }));
      setSorterDropMs((d) => Math.max(SORTER_DROP_MS_MIN, d * SORTER_DROP_SPEEDUP));
    } else {
      buzz(SORTER_BUZZ_PATTERN);
      setSorterScore((s) => ({ ...s, misses: s.misses + 1 }));
      setSorterDropMs((d) => Math.min(SORTER_DROP_MS_START, d * SORTER_DROP_SETBACK));
    }
    setSorterFeedback({ correct: ok });
  };
  useEffect(() => {
    if (phase !== 'sorter' || !sorterFeedback) return undefined;
    const id = setTimeout(() => spawnItem(sorterDropMs), sorterFeedback.correct ? 250 : 500);
    return () => clearTimeout(id);
  }, [phase, sorterFeedback, sorterDropMs, spawnItem]);

  // ── Stroop stressor (StroopStressor.jsx) ──
  const startStroop = useCallback(() => setPhase('stroop'), []);
  // Trial log + summary, stored for engagement checks and for aligning trials
  // with EEG blocks / ring windows by timestamp.
  const taskPath = userId && eegSessionId ? `calibration_tasks/${userId}/${eegSessionId}` : null;
  const finishStroop = useCallback((log) => {
    setStroopLog(log);
    setRecoveryDeadline(Date.now() + RECOVERY_DURATION_SEC * 1000);
    setPhase('recovery');
    if (taskPath) {
      set(ref(db, taskPath), {
        started_at: taskStartedAt.current, stroop_finished_at: Date.now(), source: 'web',
        durations_sec: { serial: SERIAL_SUB_DURATION_SEC, maths: MATH_DURATION_SEC, puzzle: PUZZLE_DURATION_SEC,
          sorter: SORTER_DURATION_SEC, stroop: STROOP_DURATION_SEC, recovery: RECOVERY_DURATION_SEC },
        stroop: log,
      }).catch(() => { /* best effort: the thresholds don't depend on it */ });
    }
  }, [taskPath]);
  const saveRating = (r) => {
    setStressRating(r);
    if (taskPath) update(ref(db, taskPath), { manipulation_check: { stress_rating_1_9: r, at: Date.now() } })
      .then(() => setRatingSaved(true)).catch(() => {});
  };

  // ── One fine clock drives every phase's deadlines ──
  useEffect(() => {
    if (!TASK_PHASES.includes(phase)) return undefined;
    const id = setInterval(() => setNowFine(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === 'serialSub' && serialDeadline && nowFine >= serialDeadline) startMath();
    if (phase === 'quiz' && mathDeadline) {
      if (nowFine >= mathDeadline) { startPuzzle(); return; }
      if (mathQDeadline && nowFine >= mathQDeadline && !mathHandled.current && mathProblem) {
        mathHandled.current = true;
        setMathScore((s) => ({ correct: s.correct, total: s.total + 1 }));
        setMathStreak(0);
        setMathFeedback({ correct: false, correctAnswer: mathProblem.answer, timeout: true });
      }
    }
    if (phase === 'puzzle' && puzzleDeadline && nowFine >= puzzleDeadline) { puzzleGen.current += 1; startSorter(); }
    if (phase === 'recovery' && recoveryDeadline && nowFine >= recoveryDeadline) { setPhase('review'); return; }
    if (phase === 'sorter' && sorterDeadline) {
      if (nowFine >= sorterDeadline) { startStroop(); return; }
      if (sorterItemDeadline && nowFine >= sorterItemDeadline && !sorterResolved.current) {
        sorterResolved.current = true;
        buzz(SORTER_BUZZ_PATTERN);
        setSorterScore((s) => ({ ...s, misses: s.misses + 1 }));
        setSorterDropMs((d) => Math.min(SORTER_DROP_MS_START, d * SORTER_DROP_SETBACK));
        setSorterFeedback({ correct: false });
      }
    }
  }, [phase, nowFine, serialDeadline, mathDeadline, mathQDeadline, mathProblem, puzzleDeadline, sorterDeadline,
    sorterItemDeadline, startMath, startPuzzle, startSorter, startStroop, recoveryDeadline]);

  useEffect(() => {
    if (phase !== 'quiz' || !mathFeedback) return undefined;
    const id = setTimeout(() => nextMath(mathLevelIdx), 700);
    return () => clearTimeout(id);
  }, [phase, mathFeedback, mathLevelIdx, nextMath]);

  // ── Backend result polling (each side independent) ──
  const pollSide = (triggeredAt, result, setResult, client) => {
    if (!triggeredAt || result != null) return undefined;
    const poll = async () => {
      try {
        const res = await client.get('/calibrate/threshold/status');
        if (res.data?.status && !IN_PROGRESS.includes(res.data.status)) setResult(res.data);
      } catch { /* next tick retries */ }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  };
  useEffect(() => {
    if (!eegStarted || eegResult != null) return undefined;
    const poll = async () => {
      try {
        const res = await eegApi.get('/calibrate/threshold/status');
        const d = res.data;
        // 'idle' = the server has no run for this user (never a real result);
        // a different session_id is a stale run from another session.
        if (!d?.status || d.status === 'idle' || IN_PROGRESS.includes(d.status)) return;
        if (d.session_id && d.session_id !== eegSessionId) return;
        setEegResult(d);
      } catch { /* next tick retries */ }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [eegStarted, eegResult, eegSessionId]);
  useEffect(() => pollSide(ringTriggeredAt, ringResult, setRingResult, api), [ringTriggeredAt, ringResult]);
  useEffect(() => {
    if (!((eegTriggeredAt && !eegResult) || (ringTriggeredAt && !ringResult))) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [eegTriggeredAt, eegResult, ringTriggeredAt, ringResult]);

  const sideStatus = (result, triggeredAt, key, retry) => {
    if (!triggeredAt) return { detail: 'Not run this time (device not connected).', color: COLORS.textMuted };
    if (!result) {
      return (now - triggeredAt) / 1000 >= STUCK_WARNING_SEC
        ? { detail: 'Taking longer than expected — check the device is still connected.', color: COLORS.warning, retry }
        : { detail: 'Working…', color: COLORS.textMuted };
    }
    if (result.status === 'ok') return { detail: `Personalised at ${Math.round((result[key] || 0) * 100)}%.`, color: COLORS.normal };
    if (result.status === 'error') return { detail: result.error || 'Failed — standard limit stays in place.', color: COLORS.warning, retry };
    return { detail: 'Rest and task readings weren’t different enough — using the standard limit.', color: COLORS.normal };
  };
  const eegStatus = useMemo(() => sideStatus(eegResult, eegTriggeredAt, 'personal_high_load_p', triggerEeg),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eegResult, eegTriggeredAt, now, triggerEeg]);
  const ringStatus = useMemo(() => sideStatus(ringResult, ringTriggeredAt, 'personal_stress_threshold', triggerRing),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ringResult, ringTriggeredAt, now, triggerRing]);

  const left = (deadline, total) => (deadline ? Math.max(0, Math.ceil((deadline - nowFine) / 1000)) : total);
  const serialLeft = left(serialDeadline, SERIAL_SUB_DURATION_SEC);
  const serialUrgent = phase === 'serialSub' && serialLeft <= SERIAL_SUB_DURATION_SEC * SERIAL_URGENCY_FRAC;
  const mathFrac = mathQDeadline && mathProblem
    ? Math.max(0, Math.min(1, (mathQDeadline - nowFine) / (MATH_LEVELS[mathLevelIdx].timeSec * 1000))) : 1;
  const sorterFall = sorterItemDeadline ? Math.max(0, Math.min(1, 1 - (sorterItemDeadline - nowFine) / sorterDropMs)) : 0;

  useEffect(() => {
    if (!serialUrgent) return undefined;
    buzz(200);
    const id = setInterval(() => buzz(200), 4000);
    return () => clearInterval(id);
  }, [serialUrgent]);

  const pulse = serialUrgent && Math.floor(nowFine / 500) % 2 === 0;
  const boxStyle = { border: `2px solid ${pulse ? COLORS.stress : 'transparent'}`, background: pulse ? COLORS.stressSoft : undefined, transition: 'background .15s' };

  // ── Render ──
  if (phase === 'intro') {
    return (
      <div>
        {alreadyPersonalized ? (
          <>
            <p className="body">
              Your limits are already set — Mind {eegCal?.personal_high_load_p != null
                ? <>at <b>{Math.round(eegCal.personal_high_load_p * 100)}%</b></>
                : <>on the <b>standard limit</b> (your test didn’t show a clear rest/task difference)</>},
              Body at <b>{Math.round(ringCal.personal_stress_threshold * 100)}%</b>. Keep them, or redo the ~11-minute test.
            </p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn" onClick={onFinish}>Keep current & continue</button>
              <button className="btn ghost" onClick={startSerial} disabled={disabled}>Redo the test</button>
            </div>
          </>
        ) : (
          <>
            <p className="body">
              About 11 minutes: 8 minutes of five quick rounds back to back (counting down by 13, a speed maths quiz,
              a memory puzzle, an even/odd sorter and a 3-minute colour-word test), then 3 minutes of quiet rest. The rounds are
              meant to feel stressful — that’s how we learn where <b>your</b> stress starts, instead of using an
              average for everyone. Keep your ring and headband on, rest the phone or keyboard on a table, and answer
              by tapping or typing — don’t say answers out loud.
            </p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn" onClick={startSerial} disabled={disabled}>Start the test</button>
              <button className="btn ghost" onClick={onFinish}>Skip for now</button>
            </div>
          </>
        )}
        <label className="caption" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <input type="checkbox" checked={colourSafe} onChange={(e) => setColourSafe(e.target.checked)} />
          I find red and green hard to tell apart (the colour test will use purple instead of green)
        </label>
      </div>
    );
  }

  if (phase === 'serialSub') {
    return (
      <div className="card flat" style={boxStyle}>
        <Header secondsLeft={serialLeft} urgent={serialUrgent} right={`Round 1 of 5 · best streak ${serialBest} · ${serialRestarts} restarts`} />
        <p className="body">Count down by {SERIAL_SUB_STEP}. Any mistake restarts you from {serialStart}.</p>
        {serialFeedback ? (
          <Feedback ok={serialFeedback.correct} text={serialFeedback.correct ? '✓ Correct!' : `✗ Wrong — back to ${serialStart}`} />
        ) : (
          <>
            <div style={{ fontSize: 38, fontWeight: 900, textAlign: 'center', margin: '18px 0' }}>{serialCurrent} − {SERIAL_SUB_STEP} = ?</div>
            <AnswerBox value={serialAnswer} onChange={setSerialAnswer} onSubmit={submitSerial} />
          </>
        )}
      </div>
    );
  }

  if (phase === 'quiz' && mathProblem) {
    return (
      <div className="card flat">
        <Header secondsLeft={left(mathDeadline, MATH_DURATION_SEC)} right={`Round 2 of 5 · level ${mathLevelIdx + 1} · ${mathScore.correct}/${mathScore.total} correct`} />
        <div style={{ height: 6, borderRadius: 3, background: COLORS.borderSoft, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${mathFrac * 100}%`, background: mathFrac < 0.3 ? COLORS.stress : COLORS.brand }} />
        </div>
        {mathFeedback ? (
          <Feedback ok={mathFeedback.correct} text={mathFeedback.correct ? '✓ Correct!' : mathFeedback.timeout ? '⏱ Too slow!' : '✗ Wrong'}
            sub={!mathFeedback.correct ? `Answer was ${mathFeedback.correctAnswer}` : null} />
        ) : (
          <>
            <div style={{ fontSize: 38, fontWeight: 900, textAlign: 'center', margin: '18px 0' }}>{mathProblem.display} = ?</div>
            <AnswerBox value={mathAnswer} onChange={setMathAnswer} onSubmit={submitMath} />
          </>
        )}
      </div>
    );
  }

  if (phase === 'puzzle') {
    return (
      <div className="card flat">
        <Header secondsLeft={left(puzzleDeadline, PUZZLE_DURATION_SEC)} right={`Round 3 of 5 · length ${puzzleLen} · ${puzzleScore.correct} solved · ${puzzleScore.misses} missed`} />
        <p className="body">{puzzleSub === 'showing' ? 'Watch the sequence…' : `Your turn — tap them in order (${puzzleInputIdx}/${puzzleSeq.current.length})`}</p>
        {puzzleFeedback ? (
          <Feedback ok={puzzleFeedback.correct} text={puzzleFeedback.correct ? '✓ Solved!' : '✗ Wrong order'} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, maxWidth: 300, margin: '16px auto' }}>
            {Array.from({ length: PUZZLE_GRID_SIZE }, (_, i) => (
              <button key={i} disabled={puzzleSub !== 'input'} onClick={() => tapTile(i)} style={{
                aspectRatio: '1', border: 0, borderRadius: 16, background: PUZZLE_TILE_COLORS[i],
                opacity: puzzleShowing === i ? 1 : puzzleSub === 'showing' ? 0.25 : 0.85,
                transform: `scale(${puzzleShowing === i ? 1.08 : 1})`, transition: 'transform .1s, opacity .1s',
              }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (phase === 'sorter' && sorterValue != null) {
    return (
      <div className="card flat">
        <Header secondsLeft={left(sorterDeadline, SORTER_DURATION_SEC)} right={`Round 4 of 5 · ${sorterScore.correct} sorted · ${sorterScore.misses} missed`} />
        <p className="body">Tap EVEN or ODD before the number hits the bottom. Keys: <b>E</b> / <b>O</b>.</p>
        {sorterFeedback ? (
          <div style={{ height: SORTER_TRACK_HEIGHT }}><Feedback ok={sorterFeedback.correct} text={sorterFeedback.correct ? '✓ Sorted!' : '✗ Missed!'} /></div>
        ) : (
          <div style={{ position: 'relative', height: SORTER_TRACK_HEIGHT, background: '#FAF8F3', borderRadius: 14, margin: '12px 0' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', top: sorterFall * (SORTER_TRACK_HEIGHT - 44), fontSize: 34, fontWeight: 900 }}>
              {sorterValue}
            </div>
          </div>
        )}
        <div className="grid grid-2" style={{ gap: 12 }}>
          <button className="btn" disabled={!!sorterFeedback} onClick={() => sortTap('even')} style={{ padding: 18, fontSize: 18 }}>EVEN</button>
          <button className="btn" disabled={!!sorterFeedback} onClick={() => sortTap('odd')} style={{ padding: 18, fontSize: 18, background: COLORS.stress }}>ODD</button>
        </div>
        <KeyListener onKey={(k) => { if (k === 'e') sortTap('even'); if (k === 'o') sortTap('odd'); }} />
      </div>
    );
  }

  if (phase === 'stroop') {
    return <StroopStressor durationSec={STROOP_DURATION_SEC} colourSafe={colourSafe} roundLabel="Round 5 of 5" onDone={finishStroop} />;
  }

  if (phase === 'recovery') {
    const secs = left(recoveryDeadline, RECOVERY_DURATION_SEC);
    return (
      <div className="card flat" style={{ textAlign: 'center' }}>
        <Header secondsLeft={secs} right="Last step · recovery rest" />
        <div style={{ fontSize: 44, margin: '18px 0 6px' }}>🧘</div>
        <p style={{ fontWeight: 800, margin: 0 }}>Well done — the task is over. Now just rest.</p>
        <p className="body" style={{ marginTop: 6 }}>
          Sit still, eyes open, breathe normally and look at one spot for {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}.
          This shows how quickly you settle after stress. Keep both devices on.
        </p>
        <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setPhase('review')}>Skip the rest</button>
      </div>
    );
  }

  if (phase === 'review') {
    const rows = [['Body (ring)', ringStatus], ['Mind (headband)', eegStatus]];
    return (
      <div>
        <p className="body">
          Counting: best streak {serialBest}, {serialRestarts} restarts · Maths {mathScore.correct}/{mathScore.total} ·
          Puzzle {puzzleScore.correct} solved · Sorter {sorterScore.correct} sorted ·
          Stroop {stroopLog ? `${Math.round((stroopLog.summary.accuracy ?? 0) * 100)}% of ${stroopLog.summary.n_trials}` : '—'}.
        </p>
        {stroopLog && (
          <p className="caption" style={{ color: stroopLog.summary.engagement === 'engaged' ? COLORS.textMuted : COLORS.warning }}>
            Stroop engagement check: {stroopLog.summary.engagement} (aim 50–85% correct; final response window
            {' '}{(stroopLog.summary.final_window_ms / 1000).toFixed(1)} s).
          </p>
        )}
        <div className="card flat" style={{ margin: '10px 0' }}>
          <b>How stressful did the tasks feel?</b>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => (
              <button key={r} type="button" className={`btn sm ${stressRating === r ? '' : 'ghost'}`} onClick={() => saveRating(r)}>{r}</button>
            ))}
          </div>
          <div className="between caption" style={{ marginTop: 4 }}><span>1 = not at all</span><span>9 = extremely</span></div>
          {stressRating != null && <p className="caption">{ratingSaved ? 'Thanks — saved.' : 'Thanks.'}</p>}
        </div>
        {rows.map(([label, s]) => (
          <div key={label} className="between" style={{ padding: '12px 0', borderBottom: `1px solid ${COLORS.borderSoft}` }}>
            <b>{label}</b>
            <span className="row">
              <span style={{ color: s.color, fontWeight: 700, fontSize: 13 }}>{s.detail}</span>
              {s.retry && <button className="btn ghost sm" onClick={s.retry}>Retry</button>}
            </span>
          </div>
        ))}
        <button className="btn" style={{ marginTop: 18 }} onClick={onFinish}>Go to my dashboard</button>
      </div>
    );
  }
  return null;
}

function KeyListener({ onKey }) {
  useEffect(() => {
    const h = (e) => onKey(e.key.toLowerCase());
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onKey]);
  return null;
}
