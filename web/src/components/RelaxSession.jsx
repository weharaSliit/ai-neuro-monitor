import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Runs one Relaxation Guide technique in the browser, then asks how the
// person feels. Calls onFinish({ stars, better }) when they submit.

const INK = [
  { name: 'Red', hex: '#E56B4E' }, { name: 'Green', hex: '#5E935A' },
  { name: 'Blue', hex: '#3B82F6' }, { name: 'Yellow', hex: '#E8A238' },
];
const SWATCH = ['#E56B4E', '#5E935A', '#3B82F6', '#E8A238', '#8B5CF6', '#06B6D4'];

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;
}

/* ── Breathing pacer (used by breathing + biofeedback) ─────────────────── */
function Pacer({ pattern, seconds, onDone, liveScl }) {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startScl = useRef(liveScl);
  const [label, secs] = pattern[step % pattern.length];
  const inhale = label.toLowerCase().includes('in');
  const hold = label.toLowerCase().includes('hold');

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setTimeout(() => setStep((s) => s + 1), secs * 1000);
    return () => clearTimeout(id);
  }, [step, secs]);
  useEffect(() => { if (elapsed >= seconds) onDone(); }, [elapsed, seconds, onDone]);

  const scale = hold ? undefined : inhale ? 1.15 : 0.7;
  return (
    <div>
      <h2 className="display" style={{ marginTop: 6 }}>{label}…</h2>
      <div
        className="breath"
        style={{ transform: scale ? `scale(${scale})` : undefined, transition: `transform ${secs}s ease-in-out` }}
      >
        {secs}s
      </div>
      <p className="body">{fmt(Math.max(0, seconds - elapsed))} left · follow the circle</p>
      {liveScl != null && (
        <p className="body" style={{ marginTop: 8 }}>
          Skin response now <b>{Number(liveScl).toFixed(2)} µS</b>
          {startScl.current != null && ` (started at ${Number(startScl.current).toFixed(2)})`}
        </p>
      )}
    </div>
  );
}

/* ── Timed guided steps ────────────────────────────────────────────────── */
function Steps({ steps, onDone }) {
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(steps[0][1]);

  useEffect(() => {
    const id = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(id);
  }, [i]);
  useEffect(() => {
    if (left > 0) return;
    if (i + 1 >= steps.length) { onDone(); return; }
    setI(i + 1);
    setLeft(steps[i + 1][1]);
  }, [left, i, steps, onDone]);

  const pct = ((steps[i][1] - left) / steps[i][1]) * 100;
  return (
    <div>
      <span className="micro">Step {i + 1} of {steps.length}</span>
      <h2 className="title" style={{ margin: '14px 0 18px', fontSize: 20, lineHeight: 1.35 }}>{steps[i][0]}</h2>
      <div className="progress"><span style={{ width: `${pct}%` }} /></div>
      <p className="body" style={{ marginTop: 12 }}>{Math.max(0, left)}s</p>
      <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={() => setLeft(0)}>Next step</button>
    </div>
  );
}

/* ── Colour Clash (Stroop) ─────────────────────────────────────────────── */
function ColorClash({ rounds, onDone }) {
  const [n, setN] = useState(0);
  const [right, setRight] = useState(0);
  const round = useMemo(() => {
    const word = INK[Math.floor(Math.random() * INK.length)];
    let ink = INK[Math.floor(Math.random() * INK.length)];
    if (Math.random() < 0.8) while (ink.name === word.name) ink = INK[Math.floor(Math.random() * INK.length)];
    return { word, ink };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  const pick = (c) => {
    if (c.name === round.ink.name) setRight((r) => r + 1);
    if (n + 1 >= rounds) onDone(); else setN(n + 1);
  };
  return (
    <div>
      <span className="micro">Round {n + 1} of {rounds} · tap the colour of the INK</span>
      <div className="clash" style={{ color: round.ink.hex }}>{round.word.name.toUpperCase()}</div>
      <div className="swatch-row">
        {INK.map((c) => (
          <button key={c.name} className="btn" style={{ background: c.hex }} onClick={() => pick(c)}>{c.name}</button>
        ))}
      </div>
      <p className="body" style={{ marginTop: 12 }}>No pressure. Slow and steady is fine · {right} correct so far</p>
    </div>
  );
}

/* ── Colour Match ──────────────────────────────────────────────────────── */
function ColorMatch({ rounds, onDone }) {
  const [n, setN] = useState(0);
  const target = useMemo(() => SWATCH[Math.floor(Math.random() * SWATCH.length)], [n]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = useMemo(() => shuffled(SWATCH), [n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [miss, setMiss] = useState(false);

  const pick = (c) => {
    if (c !== target) { setMiss(true); return; }
    setMiss(false);
    if (n + 1 >= rounds) onDone(); else setN(n + 1);
  };
  return (
    <div>
      <span className="micro">Round {n + 1} of {rounds} · find the matching colour</span>
      <div className="target" style={{ background: target }} />
      <div className="swatch-grid">
        {options.map((c) => (
          <button key={c} aria-label="colour" className="swatch" style={{ background: c }} onClick={() => pick(c)} />
        ))}
      </div>
      <p className="body" style={{ marginTop: 12 }}>{miss ? 'Not that one, try again.' : 'Take your time.'}</p>
    </div>
  );
}

/* ── Eye tracer ────────────────────────────────────────────────────────── */
function Tracer({ seconds, onDone }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (elapsed >= seconds) onDone(); }, [elapsed, seconds, onDone]);
  return (
    <div>
      <span className="micro">Follow the dot with your eyes only</span>
      <div className="tracer"><span /></div>
      <p className="body">{fmt(Math.max(0, seconds - elapsed))} left · keep your head still and breathe slowly</p>
    </div>
  );
}

/* ── The session shell ─────────────────────────────────────────────────── */
export default function RelaxSession({ technique, liveScl, onClose, onFinish }) {
  const [phase, setPhase] = useState('intro'); // intro | run | rate
  const [stars, setStars] = useState(0);
  const [better, setBetter] = useState(null);
  const [busy, setBusy] = useState(false);
  const done = useCallback(() => setPhase('rate'), []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    await onFinish({ stars, better: better === true });
    setBusy(false);
  };

  let body = null;
  if (phase === 'intro') {
    body = (
      <div>
        <div className="tech-icon big" style={{ background: `${technique.color}22` }}>{technique.icon}</div>
        <h2 className="display" style={{ marginTop: 14 }}>{technique.title}</h2>
        <p className="body" style={{ margin: '10px 0 6px' }}>{technique.description}</p>
        <p className="caption">About {technique.minutes} min · find a comfortable position</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <button className="btn ghost" onClick={onClose}>Not now</button>
          <button className="btn" onClick={() => setPhase('run')}>Start</button>
        </div>
      </div>
    );
  } else if (phase === 'run') {
    const k = technique.kind;
    if (k === 'breathing' || k === 'biofeedback') {
      body = <Pacer pattern={technique.pattern} seconds={technique.seconds} onDone={done} liveScl={k === 'biofeedback' ? liveScl : null} />;
    } else if (k === 'steps') body = <Steps steps={technique.steps} onDone={done} />;
    else if (k === 'colorclash') body = <ColorClash rounds={technique.rounds} onDone={done} />;
    else if (k === 'colormatch') body = <ColorMatch rounds={technique.rounds} onDone={done} />;
    else body = <Tracer seconds={technique.seconds} onDone={done} />;
  } else {
    body = (
      <div>
        <h2 className="display">Well done</h2>
        <p className="body" style={{ margin: '8px 0 16px' }}>How do you feel now?</p>
        <div className="row" style={{ justifyContent: 'center', marginBottom: 12 }}>
          {[['Better', true], ['About the same', false]].map(([t, v]) => (
            <button key={t} className={`btn ${better === v ? '' : 'ghost'}`} onClick={() => setBetter(v)}>{t}</button>
          ))}
        </div>
        <p className="caption" style={{ marginBottom: 6 }}>Rate this exercise</p>
        <div className="stars">
          {[1, 2, 3, 4, 5].map((s) => (
            <button key={s} className={s <= stars ? 'on' : ''} aria-label={`${s} stars`} onClick={() => setStars(s)}>★</button>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
          <button className="btn ghost" onClick={onClose}>Skip</button>
          <button className="btn" disabled={busy || stars === 0 || better === null} onClick={submit}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-bg" onClick={phase === 'run' ? undefined : onClose}>
      <div className="modal session" onClick={(e) => e.stopPropagation()}>
        {body}
        {phase === 'run' && (
          <button className="btn ghost sm" style={{ marginTop: 18 }} onClick={onClose}>Stop</button>
        )}
      </div>
    </div>
  );
}
