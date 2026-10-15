import { useCallback, useEffect, useRef, useState } from 'react';
// psy_web copy of web/src/components/StroopStressor.jsx (theme via CSS variables).
const COLORS = { stress: 'var(--critical)', brand: 'var(--series)' };

// Stroop colour-word STRESSOR for the high-load calibration task (protocol
// phase 3). What makes it a stressor rather than a plain test: high conflict
// (mostly incongruent words), time pressure that adapts to keep the person
// just below comfortable performance (MIST-style), and visible failure (a
// countdown bar on every trial, a red flash + buzz on errors and timeouts,
// a running score). Respond by TAPPING -- never speaking, which would put
// jaw/temporal muscle activity on the T7-T8 EEG and pass for "load".
//
// Same settings as web/src/components/StroopStressor.jsx and
// StressApp/modules/eeg/components/StroopStressor.js -- keep them identical.

export const STROOP_SETTINGS = {
  incongruentShare: 0.78,      // 75-80% incongruent
  startWindowMs: 2000,
  minWindowMs: 800,
  maxWindowMs: 2500,
  speedUpAfterCorrect: 3,      // 3 correct in a row -> window x0.9
  slowDownAfterMisses: 2,      // 2 errors/timeouts in a row -> window x1.1
  step: 0.1,
  fixationMinMs: 300,
  fixationMaxMs: 500,
  errorFlashMs: 450,
  engagedAccuracy: [0.5, 0.85],  // outside this: too easy (>85%) or gave up (<50%; chance = 25%)
};

const COLOR_SETS = {
  standard: [
    { name: 'Red', hex: '#D32F2F' }, { name: 'Green', hex: '#2E7D32' },
    { name: 'Blue', hex: '#1565C0' }, { name: 'Yellow', hex: '#F9A825' },
  ],
  // Red-green colour vision deficiency: purple replaces green.
  colourSafe: [
    { name: 'Red', hex: '#D32F2F' }, { name: 'Purple', hex: '#7B1FA2' },
    { name: 'Blue', hex: '#1565C0' }, { name: 'Yellow', hex: '#F9A825' },
  ],
};

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makeTrial(colors) {
  const ink = pick(colors);
  const congruent = Math.random() >= STROOP_SETTINGS.incongruentShare;
  const word = congruent ? ink : pick(colors.filter((c) => c.name !== ink.name));
  return { word: word.name, ink: ink.name, inkHex: ink.hex, congruent };
}

// Short low buzzer through Web Audio (no audio file needed); vibration where supported.
function useBuzzer() {
  const ctx = useRef(null);
  return useCallback(() => {
    try { navigator.vibrate?.(150); } catch { /* unsupported */ }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx.current = ctx.current || new AC();
      const c = ctx.current; const o = c.createOscillator(); const g = c.createGain();
      o.type = 'square'; o.frequency.value = 160;
      g.gain.setValueAtTime(0.12, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.2);
    } catch { /* audio blocked */ }
  }, []);
}

export function summarizeStroop(trials) {
  const n = trials.length;
  const correct = trials.filter((t) => t.outcome === 'correct').length;
  const timeouts = trials.filter((t) => t.outcome === 'timeout').length;
  const rts = trials.filter((t) => t.outcome === 'correct').map((t) => t.rt_ms);
  const incon = trials.filter((t) => !t.congruent);
  const accuracy = n ? correct / n : null;
  const [lo, hi] = STROOP_SETTINGS.engagedAccuracy;
  return {
    n_trials: n,
    accuracy,
    accuracy_incongruent: incon.length ? incon.filter((t) => t.outcome === 'correct').length / incon.length : null,
    timeouts,
    mean_rt_ms: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null,
    final_window_ms: n ? trials[n - 1].window_ms : STROOP_SETTINGS.startWindowMs,
    engagement: accuracy == null ? 'no trials' : accuracy > hi ? 'too easy' : accuracy < lo ? 'possibly gave up' : 'engaged',
  };
}

export default function StroopStressor({ durationSec, colourSafe = false, roundLabel, onDone }) {
  const colors = colourSafe ? COLOR_SETS.colourSafe : COLOR_SETS.standard;
  const buttons = useRef(colors).current;            // fixed positions for the whole block
  const buzz = useBuzzer();

  const [endAt] = useState(() => Date.now() + durationSec * 1000);
  const [now, setNow] = useState(Date.now());
  const [stage, setStage] = useState('fixation');    // fixation | trial | error
  const [trial, setTrial] = useState(null);
  const [errorText, setErrorText] = useState('');
  const windowMs = useRef(STROOP_SETTINGS.startWindowMs);
  const shownAt = useRef(0);
  const streak = useRef({ correct: 0, miss: 0 });
  const trials = useRef([]);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const finished = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(id);
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone?.({ settings: { ...STROOP_SETTINGS, colours: colors.map((c) => c.name) }, trials: trials.current,
      summary: summarizeStroop(trials.current) });
  }, [onDone, colors]);

  // fixation (300-500 ms) -> trial
  useEffect(() => {
    if (stage !== 'fixation') return undefined;
    if (Date.now() >= endAt) { finish(); return undefined; }
    const id = setTimeout(() => {
      setTrial(makeTrial(colors)); shownAt.current = Date.now(); setStage('trial');
    }, rand(STROOP_SETTINGS.fixationMinMs, STROOP_SETTINGS.fixationMaxMs));
    return () => clearTimeout(id);
  }, [stage, endAt, colors, finish]);

  const record = useCallback((response) => {
    const t = Date.now(); const rt = t - shownAt.current;
    const outcome = response == null ? 'timeout' : response === trial.ink ? 'correct' : 'wrong';
    trials.current.push({
      t: shownAt.current, word: trial.word, ink: trial.ink, congruent: trial.congruent,
      response, rt_ms: response == null ? null : rt, outcome, window_ms: Math.round(windowMs.current),
    });
    setScore((s) => ({ correct: s.correct + (outcome === 'correct' ? 1 : 0), total: s.total + 1 }));
    // Adaptive window (MIST-style): keep the person just below comfortable.
    const S = STROOP_SETTINGS;
    if (outcome === 'correct') {
      streak.current = { correct: streak.current.correct + 1, miss: 0 };
      if (streak.current.correct >= S.speedUpAfterCorrect) {
        windowMs.current = Math.max(S.minWindowMs, windowMs.current * (1 - S.step)); streak.current.correct = 0;
      }
      setStage('fixation');
    } else {
      streak.current = { correct: 0, miss: streak.current.miss + 1 };
      if (streak.current.miss >= S.slowDownAfterMisses) {
        windowMs.current = Math.min(S.maxWindowMs, windowMs.current * (1 + S.step)); streak.current.miss = 0;
      }
      buzz();
      setErrorText(outcome === 'timeout' ? 'Too slow!' : 'Wrong!');
      setStage('error');
    }
  }, [trial, buzz]);

  // trial timeout
  useEffect(() => {
    if (stage !== 'trial') return undefined;
    const id = setTimeout(() => record(null), windowMs.current);
    return () => clearTimeout(id);
  }, [stage, record]);

  // red flash, then next fixation
  useEffect(() => {
    if (stage !== 'error') return undefined;
    const id = setTimeout(() => setStage('fixation'), STROOP_SETTINGS.errorFlashMs);
    return () => clearTimeout(id);
  }, [stage]);

  // keys 1-4 for the four buttons
  useEffect(() => {
    const h = (e) => { const i = Number(e.key) - 1; if (stage === 'trial' && buttons[i]) record(buttons[i].name); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [stage, buttons, record]);

  const secsLeft = Math.max(0, Math.ceil((endAt - now) / 1000));
  const frac = stage === 'trial' ? Math.max(0, 1 - (now - shownAt.current) / windowMs.current) : 0;
  const acc = score.total ? Math.round((score.correct / score.total) * 100) : null;
  const flash = stage === 'error';

  return (
    <div className="stroop" style={{ border: `2px solid ${flash ? COLORS.stress : 'transparent'}`, transition: 'border-color .1s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 30, fontWeight: 900, color: secsLeft <= 15 ? COLORS.stress : COLORS.brand }}>{secsLeft}s</span>
        <span className="muted">{roundLabel} · score {score.correct}/{score.total}{acc != null ? ` (${acc}%)` : ''}</span>
      </div>
      <p style={{ color: COLORS.brand, fontWeight: 800, textAlign: 'center', margin: '0 0 8px' }}>
        Tap the INK COLOUR. Ignore what the word says.
      </p>
      {/* per-trial countdown bar */}
      <div style={{ height: 8, borderRadius: 4, background: '#D7D7D7', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${frac * 100}%`, background: frac < 0.3 ? COLORS.stress : COLORS.brand }} />
      </div>
      <div style={{
        height: 150, margin: '12px 0', borderRadius: 14, display: 'grid', placeItems: 'center',
        background: flash ? '#F8C9C9' : '#BDBDBD', transition: 'background .1s',
      }}>
        {stage === 'trial' && trial ? (
          <span style={{ fontSize: 56, fontWeight: 900, letterSpacing: 2, color: trial.inkHex }}>{trial.word.toUpperCase()}</span>
        ) : stage === 'error' ? (
          <span style={{ fontSize: 30, fontWeight: 900, color: '#B71C1C' }}>✗ {errorText}</span>
        ) : (
          <span style={{ fontSize: 44, fontWeight: 400, color: '#424242' }}>+</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {buttons.map((c, i) => (
          <button key={c.name} type="button" disabled={stage !== 'trial'} onClick={() => record(c.name)}
            style={{ padding: '16px 0', borderRadius: 12, border: '2px solid #9E9E9E', background: '#FFFFFF',
              color: '#111111', fontWeight: 800, fontSize: 16, opacity: stage === 'trial' ? 1 : 0.6 }}>
            {c.name}<span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#777' }}>key {i + 1}</span>
          </button>
        ))}
      </div>
      <p className="caption" style={{ marginTop: 8, textAlign: 'center' }}>Keep the phone or keyboard still on the table and tap — don’t say the colours out loud.</p>
    </div>
  );
}
