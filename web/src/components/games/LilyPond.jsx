import { useEffect, useMemo, useRef, useState } from 'react';
import bgImage from '../../assets/zen_lotus_bg.png';
import { rand, relPoint, uid, useBreathPhases } from './shared';

// "Zen Lily Pond": 4-7-8 breathing, four rounds. Press and hold the water to
// breathe in, release to breathe out; the flow score tracks how well your
// finger follows the lotus (same rules as the app's LilyPondGame).

const TIMING = { inhale: 4000, hold: 7000, exhale: 8000, rest: 2000 };
const ORDER = ['inhale', 'hold', 'exhale', 'rest'];
const SESSION_CYCLES = 4;
const RING_DOTS = 32;
const UI = {
  inhale: { title: 'Breathe in', sub: 'Slowly through your nose and let the lotus open', color: '#A5B4FC' },
  hold: { title: 'Hold', sub: 'Stay still while the light gathers', color: '#7DD3FC' },
  exhale: { title: 'Breathe out', sub: 'Through your mouth, and send the light across the pond', color: '#6EE7B7' },
  rest: { title: 'Rest', sub: 'Let the water settle', color: '#C4B5FD' },
};
const TINT = {
  inhale: 'rgba(99, 102, 241, 0.48)', hold: 'rgba(59, 130, 246, 0.45)',
  exhale: 'rgba(16, 185, 129, 0.45)', rest: 'rgba(139, 92, 246, 0.48)',
};
const SEGMENTS = [['inhale', 4, '4s in'], ['hold', 7, '7s hold'], ['exhale', 8, '8s out']];

export default function LilyPond({ paused, onTally }) {
  const stage = useRef(null);
  const [cycles, setCycles] = useState(0);
  const [done, setDone] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [flow, setFlow] = useState(0);
  const [ripples, setRipples] = useState([]);
  const [touch, setTouch] = useState(null);
  const [progress, setProgress] = useState(0);

  const touching = useRef(false);
  const engagedRef = useRef(false);
  const sync = useRef({ good: 0, total: 0 });
  const phaseRef = useRef('inhale');

  const flies = useMemo(() => Array.from({ length: 14 }, () => {
    const a = rand(0, Math.PI * 2);
    return {
      id: uid(), size: rand(5, 9), gold: Math.random() > 0.5,
      far: [Math.cos(a) * rand(110, 170), Math.sin(a) * rand(110, 170)],
      near: [Math.cos(a) * rand(55, 90), Math.sin(a) * rand(55, 90)], tw: rand(1.2, 2.6),
    };
  }), []);

  const { phase, left, startedAt } = useBreathPhases(TIMING, ORDER, {
    paused: paused || done,
    onEnter: (next) => {
      if (next === 'rest') {
        setCycles((c) => c + 1);
        if (onTally) onTally();
      }
    },
  });
  phaseRef.current = phase;

  useEffect(() => { if (cycles >= SESSION_CYCLES) setDone(true); }, [cycles]);

  // Progress inside the phase (drives the ring and the timeline).
  useEffect(() => {
    if (paused || done) return undefined;
    const iv = setInterval(() => {
      setProgress(Math.min(1, (Date.now() - startedAt) / TIMING[phase]));
    }, 100);
    return () => clearInterval(iv);
  }, [phase, startedAt, paused, done]);

  // Flow score: finger down while breathing in/holding, finger up on exhale.
  useEffect(() => {
    const iv = setInterval(() => {
      const p = phaseRef.current;
      if (!engagedRef.current || p === 'rest') return;
      const inSync = p === 'exhale' ? !touching.current : touching.current;
      sync.current.total += 1;
      if (inSync) sync.current.good += 1;
      setFlow(Math.round((sync.current.good / sync.current.total) * 100));
    }, 250);
    return () => clearInterval(iv);
  }, []);

  const addRipple = (x, y) => {
    const id = uid();
    setRipples((r) => [...r.slice(-5), { id, x, y }]);
    setTimeout(() => setRipples((r) => r.filter((i) => i.id !== id)), 1500);
  };

  const down = (e) => {
    if (done || paused) return;
    const p = relPoint(e, stage.current);
    touching.current = true; engagedRef.current = true; setEngaged(true);
    setTouch(p); addRipple(p.x, p.y);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  };
  const move = (e) => { if (touching.current) setTouch(relPoint(e, stage.current)); };
  const up = (e) => {
    if (!touching.current) return;
    touching.current = false;
    const p = relPoint(e, stage.current);
    setTouch(null); addRipple(p.x, p.y);
  };

  const again = () => {
    sync.current = { good: 0, total: 0 };
    setFlow(0); setCycles(0); setDone(false);
  };

  const ui = UI[phase];
  const open = phase === 'inhale' || phase === 'hold';
  const ring = phase === 'inhale' ? progress : phase === 'hold' ? 1 : phase === 'exhale' ? 1 - progress : 0;
  const lit = Math.round(ring * RING_DOTS);
  const phaseIdx = ORDER.indexOf(phase);
  const dur = phase === 'inhale' ? 4 : phase === 'exhale' ? 8 : 0.4;

  return (
    <div className="rg-stage rg-lily" ref={stage}
      style={{ backgroundImage: `url(${bgImage})`, touchAction: 'none' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="rg-shade" />
      {ORDER.map((p) => <div key={p} className="rg-tint" style={{ background: TINT[p], opacity: p === phase ? 1 : 0 }} />)}

      <div className="rg-lily-anchor">
        <div className="rg-lily-swirl">
          {flies.map((f) => {
            const [x, y] = open ? f.near : f.far;
            return (
              <span key={f.id} className="rg-lily-fly" style={{
                width: f.size, height: f.size, background: f.gold ? '#FDE68A' : '#fff',
                transform: `translate(${x}px, ${y}px)`, animationDuration: `${f.tw}s`,
                transitionDuration: `${phase === 'inhale' ? 4 : phase === 'exhale' ? 8 : 1}s`,
              }} />
            );
          })}
        </div>

        <div className="rg-lily-halo" style={{
          background: ui.color, transform: `scale(${open ? 1.4 : 0.7})`,
          opacity: open ? 0.3 : 0.1, transitionDuration: `${dur}s`,
        }} />

        {Array.from({ length: RING_DOTS }).map((_, i) => {
          const a = (i / RING_DOTS) * Math.PI * 2 - Math.PI / 2;
          return (
            <span key={i} className={`rg-ring-dot ${i < lit ? 'on' : ''}`} style={{
              transform: `translate(${Math.cos(a) * 122}px, ${Math.sin(a) * 122}px)`,
              background: i < lit ? ui.color : 'rgba(255,255,255,0.28)',
            }} />
          );
        })}
        {phase === 'hold' && (
          <span className="rg-comet" style={{ animationDuration: `${TIMING.hold / 1000}s` }}><i /></span>
        )}

        <div className="rg-petals" style={{ '--bloom': open ? 1.4 : 0.7, '--dur': `${dur}s` }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={`o${i}`} className="rg-petal" style={{ '--r': `${i * 45}deg`, '--w': '40px', '--h': '84px', '--from': 16, '--to': 46, background: 'rgba(249,168,212,0.8)' }} />
          ))}
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={`m${i}`} className="rg-petal" style={{ '--r': `${i * 45 + 22.5}deg`, '--w': '34px', '--h': '70px', '--from': 10, '--to': 32, background: 'rgba(251,207,232,0.9)' }} />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={`i${i}`} className="rg-petal" style={{ '--r': `${i * 60 + 10}deg`, '--w': '26px', '--h': '50px', '--from': 4, '--to': 16, background: 'rgba(255,241,246,0.95)' }} />
          ))}
        </div>

        <div className="rg-lily-core" style={{ borderColor: ui.color }}>
          <b>{phase === 'rest' ? '•' : left}</b>
        </div>
      </div>

      {ripples.map((r) => <span key={r.id} className="rg-water-ripple" style={{ left: r.x - 50, top: r.y - 50 }} />)}
      {touch && <span className="rg-touch-orb" style={{ left: touch.x - 35, top: touch.y - 35, borderColor: ui.color }} />}

      <div className="rg-lily-top">
        <span className="rg-pips">
          {Array.from({ length: SESSION_CYCLES }).map((_, i) => <i key={i} className={i < cycles ? 'on' : ''} />)}
        </span>
        {engaged && <b>Flow {flow}%</b>}
      </div>

      {!done && <div className="rg-lily-hint">Press & hold the water to breathe in • Release to breathe out</div>}

      <div className="rg-lily-panel">
        <h3 style={{ color: ui.color }}>{ui.title}</h3>
        <p>{ui.sub}</p>
        <div className="rg-timeline">
          {SEGMENTS.map(([key, flex, label], i) => {
            const isDone = i < phaseIdx;
            const active = i === phaseIdx;
            return (
              <div key={key} style={{ flex }}>
                <span className="rg-track">
                  <i style={{ width: isDone ? '100%' : active ? `${progress * 100}%` : 0, background: isDone ? UI[key].color : ui.color }} />
                </span>
                <small className={active ? 'on' : ''}>{label}</small>
              </div>
            );
          })}
        </div>
      </div>

      {done && (
        <div className="rg-done">
          <div className="rg-done-card">
            <div style={{ fontSize: 44 }}>🪷</div>
            <h3>Session complete</h3>
            <p>{SESSION_CYCLES} rounds of 4-7-8 breathing. Notice how your shoulders and jaw feel.</p>
            {engaged && <b>Flow {flow}%</b>}
            <button type="button" className="btn" onPointerDown={(e) => e.stopPropagation()} onClick={again}>Breathe again</button>
          </div>
        </div>
      )}
    </div>
  );
}
