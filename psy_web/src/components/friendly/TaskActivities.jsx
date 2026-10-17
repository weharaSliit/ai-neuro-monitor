import { useCallback, useEffect, useRef, useState } from 'react';
import StroopStressor from '../StroopStressor';

// The high-load task of the calibration (protocol phase 3): the same five
// rounds, timings and difficulty as the website and the app
// (web/src/components/ThresholdTask.jsx, StressApp EegThresholdTaskScreen.js),
// 8 minutes in all. Unlike those, this does not start or poll the backend: the
// bridges drive the calibration, and this only gives the person the activities
// while the task phase is running. It starts by itself when it is mounted.
//
//   1  counting down by 13 (serial subtraction)   2 min
//   2  speed maths quiz                            1.5 min
//   3  memory puzzle                               45 s
//   4  even / odd sorter                           45 s
//   5  Stroop colour-word test                     3 min

export const ROUNDS = [
  ['serial', 'Counting down', 120], ['quiz', 'Maths quiz', 90], ['puzzle', 'Memory puzzle', 45],
  ['sorter', 'Even / odd', 45], ['stroop', 'Colour test', 180],
];
export const TASK_TOTAL_SEC = ROUNDS.reduce((s, r) => s + r[2], 0);   // 480

const SERIAL_STEP = 13;
const MATH_LEVELS = [
  { types: ['add', 'sub'], maxA: 40, maxB: 30, timeSec: 8 },
  { types: ['add', 'sub', 'mul'], maxA: 60, maxB: 12, timeSec: 7 },
  { types: ['add', 'sub', 'mul', 'div', 'missing'], maxA: 70, maxB: 12, timeSec: 6 },
  { types: ['mul', 'div', 'two-step', 'percent', 'missing', 'square'], maxA: 90, maxB: 12, timeSec: 5 },
  { types: ['two-step', 'three-step', 'percent', 'square', 'root', 'missing'], maxA: 30, maxB: 14, timeSec: 4 },
  { types: ['three-step', 'percent', 'square', 'root', 'missing', 'div'], maxA: 35, maxB: 16, timeSec: 3.5 },
];
const LEVEL_UP_STREAK = 3;
const GRID = 9; const START_LEN = 3; const MAX_LEN = 8;
const FLASH_START = 500; const FLASH_MIN = 200; const FLASH_DECAY = 20; const GAP = 250;
const TILE_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#FB8C00', '#00897B', '#D81B60', '#3949AB'];
const TRACK_H = 170;
const DROP_START = 3200; const DROP_MIN = 1100; const DROP_SPEEDUP = 0.9; const DROP_SETBACK = 1.4;

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i -= 1) { const j = randomInt(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const applyOp = (a, op, b) => (op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : a);

function mathProblem(levelIdx) {
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
  if (type === 'percent') { const p = [10, 20, 25, 50, 75][randomInt(0, 4)]; const base = randomInt(1, 20) * 20; return { display: `${p}% of ${base}`, answer: (base * p) / 100 }; }
  if (type === 'square') { const n = randomInt(4, 20); return { display: `${n}²`, answer: n * n }; }
  if (type === 'root') { const n = randomInt(4, 20); return { display: `√${n * n}`, answer: n }; }
  const nSteps = type === 'three-step' ? 3 : 2;
  const a = randomInt(5, level.maxA); const parts = [a]; const ops = []; let acc = a;
  for (let i = 0; i < nSteps; i += 1) {
    const op = ['+', '-', '×'][randomInt(0, 2)]; let b = randomInt(2, level.maxB); let next = applyOp(acc, op, b);
    if (next < 0) { b = randomInt(2, Math.max(2, acc)); next = applyOp(acc, op, b); }
    ops.push(op); parts.push(b); acc = next;
  }
  return { display: parts.reduce((s, v, i) => (i === 0 ? `${v}` : `${s} ${ops[i - 1]} ${v}`), ''), answer: acc };
}

// Whole seconds left of a round; calls onDone once when it reaches 0.
function useCountdown(durationSec, onDone) {
  const [deadline] = useState(() => Date.now() + durationSec * 1000);
  const [now, setNow] = useState(Date.now());
  const done = useRef(false);
  const cb = useRef(onDone);
  cb.current = onDone;
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(id); }, []);
  useEffect(() => { if (now >= deadline && !done.current) { done.current = true; cb.current(); } }, [now, deadline]);
  return { secs: Math.max(0, Math.ceil((deadline - now) / 1000)), now };
}

function Head({ secs, urgent, right }) {
  return (
    <div className="ta-head">
      <b className={urgent ? 'urgent' : ''}>{secs}s</b>
      <span>{right}</span>
    </div>
  );
}
function Feedback({ ok, text, sub }) {
  return (
    <div className="ta-feedback">
      <b className={ok ? 'ok' : 'bad'}>{text}</b>
      {sub && <span>{sub}</span>}
    </div>
  );
}
function Answer({ value, onChange, onSubmit }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="ta-answer">
      <input autoFocus inputMode="numeric" value={value} placeholder="Your answer"
        onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))} />
      <button type="submit" className="pill wide">Submit (Enter)</button>
    </form>
  );
}

function Serial({ durationSec, onDone }) {
  const { secs } = useCountdown(durationSec, onDone);
  const [start] = useState(() => randomInt(800, 1200));
  const [cur, setCur] = useState(start);
  const [ans, setAns] = useState('');
  const [fb, setFb] = useState(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [restarts, setRestarts] = useState(0);
  const submit = () => {
    if (fb || ans.trim() === '') return;
    const expected = cur - SERIAL_STEP;
    const ok = Number(ans.trim()) === expected;
    if (ok) { setStreak(streak + 1); setBest((b) => Math.max(b, streak + 1)); setCur(expected); }
    else { setRestarts((r) => r + 1); setStreak(0); setCur(start); }
    setFb({ ok });
  };
  useEffect(() => {
    if (!fb) return undefined;
    const id = setTimeout(() => { setFb(null); setAns(''); }, fb.ok ? 300 : 900);
    return () => clearTimeout(id);
  }, [fb]);
  const urgent = secs <= durationSec * 0.2;
  return (
    <div className={`ta-round ${urgent ? 'pulse' : ''}`}>
      <Head secs={secs} urgent={urgent} right={`Round 1 of 5 · best streak ${best} · ${restarts} restarts`} />
      <p>Count down by {SERIAL_STEP}. Any mistake restarts you from {start}.</p>
      {fb ? <Feedback ok={fb.ok} text={fb.ok ? '✓ Correct!' : `✗ Wrong, back to ${start}`} /> : (
        <>
          <div className="ta-big">{cur} − {SERIAL_STEP} = ?</div>
          <Answer value={ans} onChange={setAns} onSubmit={submit} />
        </>
      )}
    </div>
  );
}

function Quiz({ durationSec, onDone }) {
  const { secs, now } = useCountdown(durationSec, onDone);
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const level = Math.min(MATH_LEVELS.length - 1, Math.floor(streak / LEVEL_UP_STREAK));
  const [q, setQ] = useState(() => ({ p: mathProblem(0), until: Date.now() + MATH_LEVELS[0].timeSec * 1000 }));
  const [ans, setAns] = useState('');
  const [fb, setFb] = useState(null);
  const handled = useRef(false);
  const next = useCallback((lvl) => {
    setQ({ p: mathProblem(lvl), until: Date.now() + MATH_LEVELS[lvl].timeSec * 1000 });
    setAns(''); setFb(null); handled.current = false;
  }, []);
  const submit = () => {
    if (fb || handled.current || ans.trim() === '') return;
    handled.current = true;
    const ok = Number(ans.trim()) === q.p.answer;
    setScore((s) => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1 }));
    setStreak((s) => (ok ? s + 1 : 0));
    setFb({ ok, answer: q.p.answer });
  };
  useEffect(() => {
    if (!fb && !handled.current && now >= q.until) {
      handled.current = true;
      setScore((s) => ({ correct: s.correct, total: s.total + 1 }));
      setStreak(0);
      setFb({ ok: false, answer: q.p.answer, timeout: true });
    }
  }, [now, q, fb]);
  useEffect(() => {
    if (!fb) return undefined;
    const id = setTimeout(() => next(level), 700);
    return () => clearTimeout(id);
  }, [fb, level, next]);
  const frac = Math.max(0, Math.min(1, (q.until - now) / (MATH_LEVELS[level].timeSec * 1000)));
  return (
    <div className="ta-round">
      <Head secs={secs} right={`Round 2 of 5 · level ${level + 1} · ${score.correct}/${score.total} correct`} />
      <div className="ta-bar"><i style={{ width: `${frac * 100}%` }} className={frac < 0.3 ? 'urgent' : ''} /></div>
      {fb ? <Feedback ok={fb.ok} text={fb.ok ? '✓ Correct!' : fb.timeout ? '⏱ Too slow!' : '✗ Wrong'} sub={!fb.ok ? `Answer was ${fb.answer}` : null} /> : (
        <>
          <div className="ta-big">{q.p.display} = ?</div>
          <Answer value={ans} onChange={setAns} onSubmit={submit} />
        </>
      )}
    </div>
  );
}

function Puzzle({ durationSec, onDone }) {
  const { secs } = useCountdown(durationSec, onDone);
  const [len, setLen] = useState(START_LEN);
  const [flash, setFlash] = useState(FLASH_START);
  const [sub, setSub] = useState('showing');
  const [showing, setShowing] = useState(null);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState({ correct: 0, misses: 0 });
  const [fb, setFb] = useState(null);
  const seq = useRef([]);
  const gen = useRef(0);
  const timers = useRef([]);
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); };
  useEffect(() => () => { gen.current += 1; timers.current.forEach(clearTimeout); }, []);

  const round = useCallback((l, f) => {
    seq.current = shuffle(Array.from({ length: GRID }, (_, i) => i)).slice(0, l);
    setIdx(0); setFb(null); setSub('showing');
    gen.current += 1;
    const g = gen.current; let i = 0;
    const step = () => {
      if (g !== gen.current) return;
      if (i >= seq.current.length) { setShowing(null); setSub('input'); return; }
      setShowing(seq.current[i]);
      later(() => { if (g !== gen.current) return; setShowing(null); i += 1; later(step, GAP); }, f);
    };
    step();
  }, []);
  useEffect(() => { round(START_LEN, FLASH_START); }, [round]);
  const tap = (i) => {
    if (sub !== 'input' || fb) return;
    if (i === seq.current[idx]) {
      const n = idx + 1;
      if (n >= seq.current.length) {
        setScore((s) => ({ ...s, correct: s.correct + 1 }));
        setLen((l) => Math.min(MAX_LEN, l + 1)); setFlash((f) => Math.max(FLASH_MIN, f - FLASH_DECAY));
        setFb({ ok: true });
      } else setIdx(n);
    } else { setScore((s) => ({ ...s, misses: s.misses + 1 })); setFb({ ok: false }); }
  };
  useEffect(() => {
    if (!fb) return undefined;
    const id = setTimeout(() => round(len, flash), fb.ok ? 500 : 900);
    return () => clearTimeout(id);
  }, [fb, len, flash, round]);
  return (
    <div className="ta-round">
      <Head secs={secs} right={`Round 3 of 5 · length ${len} · ${score.correct} solved · ${score.misses} missed`} />
      <p>{sub === 'showing' ? 'Watch the sequence…' : `Your turn: tap them in order (${idx}/${seq.current.length})`}</p>
      {fb ? <Feedback ok={fb.ok} text={fb.ok ? '✓ Solved!' : '✗ Wrong order'} /> : (
        <div className="ta-grid">
          {Array.from({ length: GRID }, (_, i) => (
            <button key={i} type="button" disabled={sub !== 'input'} onClick={() => tap(i)} aria-label={`tile ${i + 1}`}
              style={{ background: TILE_COLORS[i], opacity: showing === i ? 1 : sub === 'showing' ? 0.25 : 0.85, transform: `scale(${showing === i ? 1.08 : 1})` }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sorter({ durationSec, onDone }) {
  const { secs, now } = useCountdown(durationSec, onDone);
  const [dropMs, setDropMs] = useState(DROP_START);
  const [value, setValue] = useState(() => randomInt(10, 99));
  const [until, setUntil] = useState(() => Date.now() + DROP_START);
  const [score, setScore] = useState({ correct: 0, misses: 0 });
  const [fb, setFb] = useState(null);
  const resolved = useRef(false);
  const spawn = useCallback((ms) => {
    resolved.current = false; setValue(randomInt(10, 99)); setUntil(Date.now() + ms); setFb(null);
  }, []);
  const miss = useCallback(() => {
    resolved.current = true;
    setScore((s) => ({ ...s, misses: s.misses + 1 }));
    setDropMs((d) => Math.min(DROP_START, d * DROP_SETBACK));
    setFb({ ok: false });
  }, []);
  const tap = useCallback((bin) => {
    if (resolved.current) return;
    resolved.current = true;
    const ok = (bin === 'even') === (value % 2 === 0);
    if (ok) { setScore((s) => ({ ...s, correct: s.correct + 1 })); setDropMs((d) => Math.max(DROP_MIN, d * DROP_SPEEDUP)); }
    else { setScore((s) => ({ ...s, misses: s.misses + 1 })); setDropMs((d) => Math.min(DROP_START, d * DROP_SETBACK)); }
    setFb({ ok });
  }, [value]);
  useEffect(() => { if (!resolved.current && !fb && now >= until) miss(); }, [now, until, fb, miss]);
  useEffect(() => {
    if (!fb) return undefined;
    const id = setTimeout(() => spawn(dropMs), fb.ok ? 250 : 500);
    return () => clearTimeout(id);
  }, [fb, dropMs, spawn]);
  useEffect(() => {
    const h = (e) => { const k = e.key.toLowerCase(); if (k === 'e') tap('even'); if (k === 'o') tap('odd'); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [tap]);
  const fall = Math.max(0, Math.min(1, 1 - (until - now) / dropMs));
  return (
    <div className="ta-round">
      <Head secs={secs} right={`Round 4 of 5 · ${score.correct} sorted · ${score.misses} missed`} />
      <p>Tap EVEN or ODD before the number hits the bottom. Keys: <b>E</b> / <b>O</b>.</p>
      {fb ? <div style={{ height: TRACK_H }}><Feedback ok={fb.ok} text={fb.ok ? '✓ Sorted!' : '✗ Missed!'} /></div> : (
        <div className="ta-track" style={{ height: TRACK_H }}>
          <span style={{ top: fall * (TRACK_H - 44) }}>{value}</span>
        </div>
      )}
      <div className="ta-two">
        <button type="button" className="pill wide" disabled={!!fb} onClick={() => tap('even')}>EVEN</button>
        <button type="button" className="pill wide odd" disabled={!!fb} onClick={() => tap('odd')}>ODD</button>
      </div>
    </div>
  );
}

// onStroop(log): the Stroop trial log, to be stored next to the calibration request.
export default function TaskActivities({ colourSafe = false, onStroop }) {
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const nextStep = useCallback(() => setStep((s) => s + 1), []);
  const doneStroop = useCallback((log) => { if (onStroop) onStroop(log); setFinished(true); }, [onStroop]);
  const key = ROUNDS[step]?.[0];
  return (
    <div className="ta">
      <div className="ta-steps" aria-hidden="true">
        {ROUNDS.map(([k, label], i) => (
          <span key={k} className={i < step || finished ? 'done' : i === step ? 'now' : ''}>{i + 1}. {label}</span>
        ))}
      </div>
      {finished ? (
        <div className="ta-round">
          <Feedback ok text="Task finished" sub="Well done. Keep the devices on and wait for the next step: a few minutes of quiet rest." />
        </div>
      ) : key === 'serial' ? <Serial key="serial" durationSec={ROUNDS[0][2]} onDone={nextStep} />
        : key === 'quiz' ? <Quiz key="quiz" durationSec={ROUNDS[1][2]} onDone={nextStep} />
          : key === 'puzzle' ? <Puzzle key="puzzle" durationSec={ROUNDS[2][2]} onDone={nextStep} />
            : key === 'sorter' ? <Sorter key="sorter" durationSec={ROUNDS[3][2]} onDone={nextStep} />
              : <StroopStressor key="stroop" durationSec={ROUNDS[4][2]} colourSafe={colourSafe} roundLabel="Round 5 of 5" onDone={doneStroop} />}
    </div>
  );
}
