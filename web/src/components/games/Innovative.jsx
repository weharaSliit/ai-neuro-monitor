import { useEffect, useRef, useState } from 'react';
import { EvidenceChip, relPoint, uid } from './shared';

// Somatic PMR ("Origami Knot"), Cosmic Trace (bilateral saccadic tracking)
// and Bio GSR Pool (cooling pool). Same mechanics as the app's
// InnovativeTechniquesGame.

/* ═══ Somatic PMR: press and hold to tense, let go to release ═══ */
const PARTS = ['fists', 'shoulders', 'jaw', 'toes'];
const R = 104;
const C = 2 * Math.PI * R;

export function PMR({ paused, onTally }) {
  const [phase, setPhase] = useState('idle'); // idle | hold | release
  const [progress, setProgress] = useState(0);
  const [rounds, setRounds] = useState(0);
  const timer = useRef(null);
  const resetT = useRef(null);
  const prog = useRef(0);
  const phaseRef = useRef('idle');
  const setPh = (p) => { phaseRef.current = p; setPhase(p); };

  useEffect(() => () => { clearInterval(timer.current); clearTimeout(resetT.current); }, []);
  useEffect(() => { if (paused) { clearInterval(timer.current); } }, [paused]);

  const release = () => {
    clearInterval(timer.current);
    setPh('release');
    setProgress(100);
    if (onTally) onTally();
    resetT.current = setTimeout(() => {
      prog.current = 0;
      setProgress(0);
      setRounds((r) => r + 1);
      setPh('idle');
    }, 4500);
  };

  const startHold = () => {
    if (phaseRef.current === 'release') return;
    setPh('hold');
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      prog.current = Math.min(100, prog.current + 2);
      setProgress(prog.current);
      if (prog.current >= 100) release();
    }, 100);
  };

  const endHold = () => {
    if (phaseRef.current !== 'hold') return;
    clearInterval(timer.current);
    if (prog.current >= 35) release();
    else { prog.current = 0; setProgress(0); setPh('idle'); }
  };

  const tint = phase === 'release' ? '#7FE5D0' : phase === 'hold' ? '#FF6B8B' : '#C4B5FD';
  const part = PARTS[rounds % PARTS.length];
  const k = phase === 'release' ? -1 : progress / 100; // 1 tight, 0 rest, -1 bloom
  const headline = phase === 'hold' ? `Squeeze your ${part}` : phase === 'release' ? 'Let go. Feel the warmth.' : 'Press and hold the knot';
  const sub = phase === 'hold' ? `${progress}% tension` : phase === 'release' ? 'Notice the difference' : `Round ${rounds + 1}: tighten your ${part} as you press`;

  return (
    <div className="rg-stage rg-inno" style={{ background: 'linear-gradient(180deg, #1B1030, #3A1740 55%, #5B2250)' }}>
      <EvidenceChip title="WESAD · muscle release" accent="#FF6B8B"
        text="Brief isometric tension followed by sudden release relaxes the muscle and is linked to lower trapezius EMG and falling skin conductance (SCL)." />
      <div className="rg-pmr-wrap">
        <button type="button" className="rg-pmr-stage"
          onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold}
          onContextMenu={(e) => e.preventDefault()}>
          <svg width="240" height="240" className="rg-pmr-ring">
            <circle cx="120" cy="120" r={R} stroke="rgba(255,255,255,0.12)" strokeWidth="4" fill="none" />
            <circle cx="120" cy="120" r={R} stroke={tint} strokeWidth="4" fill="none" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - progress / 100)} transform="rotate(-90 120 120)" />
          </svg>
          <span className={`rg-pmr-fold ${phase === 'hold' ? 'shake' : ''}`}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const rot = k >= 0 ? i * 12 + (i * 5 - i * 12) * k : i * 12 + (i * 30 + 15 - i * 12) * -k;
              const scale = k >= 0 ? 0.78 + i * 0.04 + ((0.5 + i * 0.025) - (0.78 + i * 0.04)) * k
                : 0.78 + i * 0.04 + ((1 + i * 0.07) - (0.78 + i * 0.04)) * -k;
              return (
                <i key={i} style={{
                  borderColor: tint, background: `${tint}1F`, opacity: k >= 0 ? 0.55 + 0.35 * k : 0.55 + 0.23 * k,
                  transform: `rotate(${rot}deg) scale(${scale})`,
                }} />
              );
            })}
          </span>
          {phase === 'release' && Array.from({ length: 12 }).map((_, i) => (
            <span key={i} className="rg-spark" style={{ '--a': `${(i / 12) * 360}deg` }} />
          ))}
        </button>
      </div>
      <h3 className="rg-pmr-head">{headline}</h3>
      <p className="rg-pmr-sub">{sub}</p>
      <div className="rg-pmr-pips">
        {PARTS.map((p, i) => <i key={p} style={{ background: i < rounds % (PARTS.length + 1) ? '#7FE5D0' : 'rgba(255,255,255,0.2)' }} />)}
      </div>
    </div>
  );
}

/* ═══ Cosmic Trace: follow the firefly across the night lake ═══ */
const PACES = [{ id: 'slow', label: 'Slow', ms: 3200 }, { id: 'steady', label: 'Steady', ms: 2400 }, { id: 'brisk', label: 'Brisk', ms: 1800 }];
const TRAIL = 5;

export function EMDR({ paused, onTally }) {
  const [pace, setPace] = useState(PACES[1]);
  const [sweeps, setSweeps] = useState(0);
  const [edges, setEdges] = useState([]);

  useEffect(() => {
    if (paused) return undefined;
    let side = 'right';
    const t = setInterval(() => {
      const s = side;
      const id = uid();
      setEdges((e) => [...e.slice(-3), { id, side: s }]);
      setTimeout(() => setEdges((e) => e.filter((x) => x.id !== id)), 1600);
      if (s === 'left') {
        setSweeps((c) => c + 1);
        if (onTally) onTally();
      }
      side = s === 'right' ? 'left' : 'right';
    }, pace.ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pace, paused]);

  return (
    <div className="rg-stage rg-inno" style={{ background: 'linear-gradient(180deg, #031629, #06304F 55%, #0B4F78)' }}>
      <EvidenceChip title="WESAD · bilateral tracking" accent="#38BDF8"
        text="Smooth horizontal pursuit engages the superior colliculus and locus coeruleus, damping amygdala threat response and stabilizing ECG R-R intervals." />
      <div className="rg-eye">
        <svg width="120" height="56" viewBox="0 0 120 56">
          <path d="M4 28 Q60 -10 116 28 Q60 66 4 28 Z" stroke="rgba(224,247,255,0.8)" strokeWidth="2" fill="rgba(3,22,41,0.5)" />
        </svg>
        <span className="rg-iris" style={{ animationDuration: `${pace.ms * 2}ms`, animationPlayState: paused ? 'paused' : 'running' }}>
          <i /><u />
        </span>
      </div>
      <div className="rg-lake">
        <span className="rg-lake-body" />
        <span className="rg-lake-line" />
        {edges.map((e) => <span key={e.id} className={`rg-edge ${e.side}`}><i /></span>)}
        {[...Array(TRAIL).keys()].reverse().map((j) => (
          <span key={`${pace.id}-${j}`} className="rg-firefly-track" style={{
            animationDuration: `${pace.ms * 2}ms`, animationDelay: `${j * 75}ms`,
            animationPlayState: paused ? 'paused' : 'running',
            opacity: j === 0 ? 1 : 0.62 - j * 0.11, '--sc': 1 - j * 0.14,
          }}>
            <i className={j === 0 ? 'strong' : ''} />
          </span>
        ))}
      </div>
      <p className="rg-emdr-text">Follow the light with your eyes only. Keep your head still and your jaw soft.</p>
      <p className="rg-emdr-count">{sweeps} full sweeps</p>
      <div className="rg-paces">
        {PACES.map((p) => (
          <button key={p.id} type="button" className={pace.id === p.id ? 'on' : ''} onClick={() => setPace(p)}>{p.label}</button>
        ))}
      </div>
    </div>
  );
}

/* ═══ Bio GSR Pool: glide a finger over the water to cool it ═══ */
const DROP = 'M28 4 C28 4 6 32 6 50 A22 22 0 0 0 50 50 C50 32 28 4 28 4 Z';

export function BioGSR({ paused, onTally }) {
  const pool = useRef(null);
  const [cool, setCool] = useState(60);
  const [ripples, setRipples] = useState([]);
  const coolRef = useRef(cool);
  coolRef.current = cool;
  const last = useRef(0);
  const down = useRef(false);

  const addRipple = (x, y) => {
    const id = uid();
    setRipples((r) => [...r.slice(-9), { id, x, y }]);
    setTimeout(() => setRipples((r) => r.filter((i) => i.id !== id)), 1900);
  };

  useEffect(() => {
    if (paused) return undefined;
    const heat = setInterval(() => setCool((c) => Math.max(20, c - 1)), 1600);
    const breathe = setInterval(() => {
      if (coolRef.current > 60 && pool.current) {
        addRipple(40 + Math.random() * (pool.current.clientWidth - 80), 40 + Math.random() * 180);
      }
    }, 2800);
    return () => { clearInterval(heat); clearInterval(breathe); };
  }, [paused]);

  const touch = (e, first) => {
    const now = Date.now();
    if (!first && now - last.current < 110) return;
    last.current = now;
    const p = relPoint(e, pool.current);
    addRipple(p.x, p.y);
    setCool((c) => Math.min(100, c + (first ? 2 : 1)));
    if (first && onTally) onTally();
  };

  const bg = cool > 70 ? 'linear-gradient(180deg, #083344, #0E7490 55%, #67E8F9)'
    : cool > 40 ? 'linear-gradient(180deg, #1E1B4B, #4C1D95 55%, #8B5CF6)'
      : 'linear-gradient(180deg, #3A0D0D, #9A2F1B 55%, #F59E0B)';
  const rippleColor = cool > 70 ? '#9AF0FF' : '#FFD7A8';
  const msg = cool > 85 ? 'The pool is still. Stay with it.' : cool > 55 ? 'Keep gliding slowly.' : 'Your skin signal is running warm. Touch the water.';
  const yFill = 76 - (cool / 100) * 72;

  return (
    <div className="rg-stage rg-inno" style={{ background: '#0B1220' }}>
      <EvidenceChip title="WESAD · EDA biofeedback" accent="#67E8F9"
        text="Seeing your arousal fall in real time trains you to calm sudomotor activity, reducing phasic SCR bursts measured in micro-Siemens." />
      <div className="rg-pool" ref={pool} style={{ background: bg, touchAction: 'none' }}
        onPointerDown={(e) => { down.current = true; touch(e, true); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* n/a */ } }}
        onPointerMove={(e) => { if (down.current) touch(e, false); }}
        onPointerUp={() => { down.current = false; }} onPointerCancel={() => { down.current = false; }}>
        {cool < 60 && <span className="rg-heat" style={{ opacity: Math.min(0.75, (60 - cool) / 40 + 0.2) }} />}
        {ripples.map((r) => (
          <span key={r.id} className="rg-pool-ripple" style={{ left: r.x - 35, top: r.y - 35, borderColor: rippleColor }} />
        ))}
        <div className="rg-pool-center">
          <b>Glide a finger across the water</b>
          <span>{msg}</span>
        </div>
      </div>
      <div className="rg-gauge">
        <svg width="56" height="76" viewBox="0 0 56 76">
          <defs><clipPath id="dropClip"><path d={DROP} /></clipPath></defs>
          <rect x="0" y={yFill} width="56" height="76" fill={cool > 70 ? '#67E8F9' : cool > 40 ? '#A78BFA' : '#FBBF24'} clipPath="url(#dropClip)" />
          <path d={DROP} stroke="rgba(255,255,255,0.8)" strokeWidth="2" fill="none" />
        </svg>
        <div>
          <b>{cool}%</b>
          <small>calm in the skin signal</small>
        </div>
      </div>
    </div>
  );
}
