import { useEffect, useRef, useState } from 'react';
import { COLORS } from '../lib/levels';
import { MATH_LEVELS, generateMathProblem } from './ThresholdTask';

// Adaptive mental arithmetic for the calibration task (same problems and levels as
// the Calibrate page's limit test, ThresholdTask): a timer per question, 3 right in
// a row -> harder and faster, a miss -> easier. Respond by typing, not speaking.
const LEVEL_UP = 3;

export default function MentalArithmetic({ durationSec, onDone }) {
  const [endAt] = useState(() => Date.now() + durationSec * 1000);
  const [level, setLevel] = useState(0);
  const [q, setQ] = useState(() => ({ ...generateMathProblem(0), at: Date.now() }));
  const [answer, setAnswer] = useState('');
  const [flash, setFlash] = useState(null);           // 'ok' | 'miss' | 'slow'
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [now, setNow] = useState(Date.now());
  const streak = useRef(0);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(id); }, []);

  const next = (ok, how) => {
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }));
    streak.current = ok ? streak.current + 1 : 0;
    const lvl = ok && streak.current >= LEVEL_UP ? Math.min(MATH_LEVELS.length - 1, level + 1) : !ok ? Math.max(0, level - 1) : level;
    if (ok && streak.current >= LEVEL_UP) streak.current = 0;
    setLevel(lvl); setFlash(how); setAnswer('');
    setTimeout(() => { setFlash(null); setQ({ ...generateMathProblem(lvl), at: Date.now() }); }, 450);
  };

  const qLeft = MATH_LEVELS[level].timeSec * 1000 - (now - q.at);
  useEffect(() => { if (!flash && qLeft <= 0 && now < endAt) next(false, 'slow'); }, [qLeft <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const secsLeft = Math.max(0, Math.ceil((endAt - now) / 1000));
  const doneRef = useRef(onDone); doneRef.current = onDone;
  useEffect(() => { if (secsLeft === 0) { const id = setTimeout(() => doneRef.current?.(), 1500); return () => clearTimeout(id); } return undefined; }, [secsLeft === 0]);
  if (secsLeft === 0) {
    return <p className="body" style={{ textAlign: 'center', padding: 20 }}>Round done · {score.right} of {score.total} right. Keep going with the Stroop round.</p>;
  }
  const frac = Math.max(0, qLeft / (MATH_LEVELS[level].timeSec * 1000));
  return (
    <div className={`math-task ${flash || ''}`}>
      <div className="between" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 900, color: secsLeft <= 15 ? COLORS.stress : COLORS.brand }}>{secsLeft}s</span>
        <span className="caption">Level {level + 1} · {score.right}/{score.total} right</span>
      </div>
      <div className="math-bar"><i style={{ width: `${frac * 100}%`, background: frac < 0.3 ? COLORS.stress : COLORS.brand }} /></div>
      <div className="math-q">{flash === 'ok' ? '✓' : flash ? (flash === 'slow' ? 'Too slow!' : '✗ Wrong') : `${q.display} = ?`}</div>
      <form onSubmit={(e) => { e.preventDefault(); if (!flash && answer !== '') next(Number(answer) === q.answer, Number(answer) === q.answer ? 'ok' : 'miss'); }}>
        <div className="field">
          <input autoFocus inputMode="numeric" value={answer} disabled={Boolean(flash)}
            onChange={(e) => setAnswer(e.target.value.replace(/[^\d.-]/g, ''))}
            placeholder="Your answer" style={{ fontSize: 22, textAlign: 'center', fontWeight: 800 }} />
        </div>
        <button className="btn" style={{ width: '100%' }} disabled={Boolean(flash)}>Submit (Enter)</button>
      </form>
    </div>
  );
}
