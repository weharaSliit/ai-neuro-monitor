import { useEffect, useRef, useState } from 'react';
import { relPoint, useTransients } from './shared';

// Warmth Flow, Color Match and Color Clash: the app's CognitiveDeStressGame.
// A quiet breathing ring (4s in, 6s out) sits above every activity.

const TECH = {
  warmth: { name: 'Warmth Flow', subtitle: 'Hold the glow and let warmth spread', emoji: '🔥', color: '#F59E0B' },
  colormatch: { name: 'Color Match', subtitle: 'Settle each tile into place, no rush', emoji: '🧩', color: '#A78BFA' },
  stroop: { name: 'Color Clash', subtitle: 'Pop worry bubbles by the color of their ink', emoji: '🎯', color: '#38BDF8' },
};

function BreathPacer({ color, paused }) {
  const [phase, setPhase] = useState('in');
  useEffect(() => {
    if (paused) return undefined;
    let t; let alive = true;
    const run = (p) => {
      if (!alive) return;
      setPhase(p);
      t = setTimeout(() => run(p === 'in' ? 'out' : 'in'), p === 'in' ? 4000 : 6000);
    };
    run('in');
    return () => { alive = false; clearTimeout(t); };
  }, [paused]);
  const grow = phase === 'in';
  return (
    <div className="rg-pacer">
      <span className="rg-pacer-ring">
        <i style={{ background: color, transform: `scale(${grow ? 1 : 0.7})`, transitionDuration: grow ? '4s' : '6s' }} />
        <i className="core" style={{ borderColor: color, transform: `scale(${grow ? 1 : 0.7})`, transitionDuration: grow ? '4s' : '6s' }} />
      </span>
      <small>{grow ? 'Breathe in slowly' : 'Let it out, longer'}</small>
    </div>
  );
}

/* ── Warmth Flow: press and hold the ember ── */
const STAGES = [
  { id: 'hands_arms', name: 'Hands & Arms', emoji: '🤲', cue: 'My hands and arms feel heavy and pleasantly warm.', color: '#FB7185' },
  { id: 'solar_plexus', name: 'Solar Plexus', emoji: '☀️', cue: 'My abdomen feels radiating soothing warmth.', color: '#FBBF24' },
  { id: 'cardiac_pulse', name: 'Cardiac Pulse', emoji: '🫀', cue: 'My heartbeat is calm, steady, and warm.', color: '#34D399' },
  { id: 'forehead_cool', name: 'Forehead Cool', emoji: '❄️', cue: 'My forehead feels comfortably cool and calm.', color: '#22D3EE' },
];
const HOLD_MS = 3500;

function Warmth({ onTally, ripple }) {
  const [zone, setZone] = useState(0);
  const [done, setDone] = useState([]);
  const [holding, setHolding] = useState(false);
  const timer = useRef(null);
  const stage = STAGES[zone];

  useEffect(() => () => clearTimeout(timer.current), []);

  const press = (e) => {
    setHolding(true);
    const evt = { clientX: e.clientX, clientY: e.clientY };
    timer.current = setTimeout(() => {
      setHolding(false);
      setDone((d) => (d.includes(zone) ? d : [...d, zone]));
      if (onTally) onTally();
      const next = (zone + 1) % STAGES.length;
      ripple(evt, stage.color, next === 0 ? 'Whole body warm' : 'Warmth carried on');
      setZone(next);
      if (next === 0) setDone([]);
    }, HOLD_MS);
  };
  const release = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <div className="rg-activity">
      <div className="rg-path">
        {STAGES.map((s, i) => (
          <span key={s.id} className="rg-path-item">
            <i style={{
              borderColor: s.color,
              background: done.includes(i) ? s.color : i === zone ? `${s.color}33` : 'transparent',
              transform: i === zone ? 'scale(1.15)' : 'none',
            }}>{s.emoji}</i>
            {i < STAGES.length - 1 && <u style={{ background: done.includes(i) ? s.color : 'rgba(148,163,184,0.35)' }} />}
          </span>
        ))}
      </div>

      <div className="rg-ember-stage">
        <span className="rg-ember-halo" style={{
          background: stage.color, opacity: holding ? 0.55 : 0.18, transform: `scale(${holding ? 1.7 : 1})`,
        }} />
        <button type="button" className={`rg-ember ${holding ? 'holding' : ''}`}
          style={{ background: `linear-gradient(160deg, ${stage.color}, ${stage.color}99)` }}
          onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
          onContextMenu={(e) => e.preventDefault()}>
          <span style={{ fontSize: 44 }}>{stage.emoji}</span>
          <small>{holding ? 'Keep holding' : 'Press and hold'}</small>
        </button>
      </div>

      <div className="rg-hold-track">
        <i key={`${zone}-${holding}`} style={{
          background: stage.color, width: holding ? '100%' : '0%',
          transition: holding ? `width ${HOLD_MS}ms linear` : 'width 1.2s ease-out',
        }} />
      </div>

      <div className="rg-cue" style={{ borderColor: `${stage.color}66` }}>
        <b style={{ color: stage.color }}>{stage.name}</b>
        <p>{stage.cue}</p>
        <small>Repeat the phrase quietly while you hold.</small>
      </div>
    </div>
  );
}

/* ── Color Match: nine tiles ── */
const PALETTE = ['#FDA4AF', '#FCD34D', '#86EFAC', '#7DD3FC', '#C4B5FD'];
const pick = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

function ColorMatch({ onTally, ripple }) {
  const make = () => Array.from({ length: 9 }, pick);
  const [blueprint, setBlueprint] = useState(make);
  const [grid, setGrid] = useState(make);
  const [matches, setMatches] = useState(0);
  const [combos, setCombos] = useState(0);
  const [fading, setFading] = useState(false);

  const press = (i, e) => {
    const next = [...grid];
    next[i] = PALETTE[(PALETTE.indexOf(next[i]) + 1) % PALETTE.length];
    setGrid(next);
    const m = next.filter((c, k) => c === blueprint[k]).length;
    setMatches(m);
    if (next[i] === blueprint[i]) ripple(e, next[i], 'Settled');
    if (m === 9) {
      setCombos((c) => c + 1);
      if (onTally) onTally();
      ripple(e, '#C4B5FD', 'Harmony');
      setTimeout(() => {
        setFading(true);
        setTimeout(() => {
          setBlueprint(make()); setGrid(make()); setMatches(0); setFading(false);
        }, 500);
      }, 700);
    }
  };

  return (
    <div className="rg-activity">
      <div className="rg-target">
        <small>Match this pattern</small>
        <span>{blueprint.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
      </div>
      <div className="rg-board" style={{ opacity: fading ? 0 : 1 }}>
        {grid.map((c, i) => (
          <button key={i} type="button" className={`rg-tile ${c === blueprint[i] ? 'on' : ''}`}
            style={{ background: c, '--glow': c }} onClick={(e) => press(i, e)} aria-label="tile">
            <span />
          </button>
        ))}
      </div>
      <div className="rg-beads">
        {Array.from({ length: 9 }).map((_, i) => <i key={i} className={i < matches ? 'on' : ''} />)}
      </div>
      <p className="rg-soft">
        {matches} of 9 settled{combos > 0 ? `  ·  ${combos} ${combos === 1 ? 'harmony' : 'harmonies'}` : ''}
      </p>
    </div>
  );
}

/* ── Color Clash: pop the bubble by the ink colour ── */
const ITEMS = [
  { word: 'RED', color: 'BLUE', code: '#3B82F6' },
  { word: 'GREEN', color: 'RED', code: '#EF4444' },
  { word: 'YELLOW', color: 'GREEN', code: '#10B981' },
  { word: 'BLUE', color: 'YELLOW', code: '#F59E0B' },
  { word: 'PURPLE', color: 'RED', code: '#EF4444' },
];
const BUTTONS = [
  { name: 'RED', code: '#EF4444' }, { name: 'BLUE', code: '#3B82F6' },
  { name: 'GREEN', code: '#10B981' }, { name: 'YELLOW', code: '#F59E0B' },
];

function Clash({ onTally, ripple }) {
  const [idx, setIdx] = useState(0);
  const [streak, setStreak] = useState(0);
  const [hint, setHint] = useState('');
  const [state, setState] = useState('idle'); // idle | pop | shake
  const item = ITEMS[idx];

  const press = (name, e) => {
    if (state === 'pop') return;
    if (name === item.color) {
      setStreak((s) => s + 1);
      setHint('');
      if (onTally) onTally();
      ripple(e, item.code, 'Popped');
      setState('pop');
      setTimeout(() => { setIdx((i) => (i + 1) % ITEMS.length); setState('idle'); }, 240);
    } else {
      setStreak(0);
      setHint('Look at the ink color, not the letters.');
      setState('shake');
      setTimeout(() => setState('idle'), 300);
    }
  };

  return (
    <div className="rg-activity">
      <div className="rg-bubble-sky">
        <span className={`rg-stroop-bubble ${state}`} style={{ borderColor: `${item.code}88` }}>
          <i />
          <b style={{ color: item.code }}>{item.word}</b>
        </span>
      </div>
      <p className="rg-hintline" style={{ color: hint ? '#38BDF8' : undefined }}>{hint || 'Which color is the word written in?'}</p>
      <div className="rg-orbs">
        {BUTTONS.map((b) => (
          <button key={b.name} type="button" onClick={(e) => press(b.name, e)}
            style={{ background: `linear-gradient(160deg, ${b.code}, ${b.code}CC)`, boxShadow: `0 6px 18px ${b.code}55` }}>
            {b.name}
          </button>
        ))}
      </div>
      <p className="rg-soft">{streak > 0 ? `${streak} in a row` : 'Take your time'}</p>
    </div>
  );
}

export default function Cognitive({ mode, paused, onTally }) {
  const root = useRef(null);
  const tech = TECH[mode] || TECH.colormatch;
  const [rips, addRip] = useTransients(1600);

  const ripple = (e, color, text) => {
    const p = e && root.current ? relPoint(e, root.current) : { x: 160, y: 200 };
    addRip({ x: p.x, y: p.y, color, text });
  };

  return (
    <div className="rg-stage rg-cog" ref={root}>
      <span className="rg-drift a" style={{ background: tech.color }} />
      <span className="rg-drift b" />
      <span className="rg-drift c" />
      <div className="rg-cog-scroll">
        <div className="rg-cog-head">
          <span style={{ fontSize: 36 }}>{tech.emoji}</span>
          <h3>{tech.name}</h3>
          <p>{tech.subtitle}</p>
        </div>
        <BreathPacer color={tech.color} paused={paused} />
        {mode === 'warmth' && <Warmth onTally={onTally} ripple={ripple} />}
        {mode === 'colormatch' && <ColorMatch onTally={onTally} ripple={ripple} />}
        {mode === 'stroop' && <Clash onTally={onTally} ripple={ripple} />}
      </div>
      {rips.map((r) => (
        <span key={r.id} className="rg-soft-ripple" style={{ left: r.x, top: r.y, color: r.color }}>
          <i style={{ borderColor: r.color }} />
          {r.text && <b>{r.text}</b>}
        </span>
      ))}
    </div>
  );
}
