import { useRef, useState } from 'react';
import bgImage from '../../assets/zen_garden_bg.png';
import { rand, relPoint, uid, useBreathPhases, useTransients } from './shared';

// "Calm Meadow": 4-7-8 breathing with a blooming lotus. Catch the falling
// dew, buds, seeds and wisps; tap anywhere to plant flowers. Same rules as the
// app's FlowerMeadowGame (score, combo, cycles, calm goal).

const TIMING = { inhale: 4000, hold: 7000, exhale: 8000, rest: 2000 };
const ORDER = ['inhale', 'hold', 'exhale', 'rest'];
const PHASE_COLOR = { inhale: '#818CF8', hold: '#60A5FA', exhale: '#34D399', rest: '#A78BFA' };
const PHASE_TINT = {
  inhale: 'rgba(99, 102, 241, 0.52)', hold: 'rgba(59, 130, 246, 0.48)',
  exhale: 'rgba(16, 185, 129, 0.48)', rest: 'rgba(139, 92, 246, 0.52)',
};
const PHASE_TEXT = {
  inhale: ['Inhale Deeply', 'Expand with the blooming lotus'],
  hold: ['Hold Breath', 'Feel calm energy center inside'],
  exhale: ['Slow Exhale', 'Release tension & bloom garden'],
  rest: ['Rest & Relax', 'Prepare for next calm wave'],
};
const XP_PER_LEVEL = 500;
const GOAL_CYCLES = 4;
const LEVEL_TITLES = ['Seedling', 'Sprout', 'Budding', 'Blossom', 'Lotus Master'];
const KINDS = ['drop', 'bud', 'seed', 'wisp', 'blossom'];
const META = {
  drop: { label: 'DEW CATCH', color: '#38BDF8', burst: ['#BAE6FD', '#FFFFFF'], aura: '56,189,248' },
  bud: { label: 'LOTUS BUD', color: '#F472B6', burst: ['#F9A8D4', '#FDE68A'], aura: '244,114,182' },
  seed: { label: 'WISH SEED', color: '#E2E8F0', burst: ['#FFFFFF', '#E0E7FF'], aura: '226,232,240' },
  wisp: { label: 'FAIRY WISP', color: '#67E8F9', burst: ['#A5F3FC', '#FDE68A'], aura: '103,232,249' },
  blossom: { label: 'BLOSSOM', color: '#FBCFE8', burst: ['#FBCFE8', '#FFFFFF'], aura: '251,207,232' },
};
const FLOWER_STYLES = [
  { kind: 'daisy', c1: '#FFFFFF', c2: '#FBBF24' }, { kind: 'bloom', c1: '#F472B6', c2: '#FDE68A' },
  { kind: 'bloom', c1: '#A78BFA', c2: '#FDE68A' }, { kind: 'tulip', c1: '#FB7185', c2: '#FECDD3' },
  { kind: 'daisy', c1: '#FBBF24', c2: '#92400E' }, { kind: 'tulip', c1: '#60A5FA', c2: '#DBEAFE' },
  { kind: 'bloom', c1: '#FB923C', c2: '#FEF3C7' },
];

const petal = (cx, baseY, len, w) =>
  `M${cx} ${baseY} C${cx - w} ${baseY - len * 0.35} ${cx - w} ${baseY - len * 0.75} ${cx} ${baseY - len} `
  + `C${cx + w} ${baseY - len * 0.75} ${cx + w} ${baseY - len * 0.35} ${cx} ${baseY} Z`;

function Lotus({ open }) {
  const layer = (n, offset, len, w, c1, c2, id, scale) => (
    <svg className="rg-lotus-layer" viewBox="0 0 200 200" style={{ transform: `scale(${scale})` }}>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      {Array.from({ length: n }).map((_, i) => (
        <path key={i} d={petal(100, 104, len, w)} fill={`url(#${id})`} stroke="rgba(255,255,255,0.35)"
          transform={`rotate(${offset + (360 / n) * i} 100 100)`} />
      ))}
    </svg>
  );
  return (
    <div className="rg-lotus">
      {layer(8, 22.5, 96, 28, '#9D174D', '#F472B6', 'mlb', open ? 1.08 : 0.8)}
      {layer(8, 0, 80, 24, '#DB2777', '#F9A8D4', 'mlm', open ? 1.05 : 0.7)}
      {layer(5, 36, 62, 20, '#F472B6', '#FDF2F8', 'mlf', open ? 1 : 0.55)}
      <svg className="rg-lotus-layer" viewBox="0 0 200 200" style={{ transform: `scale(${open ? 1 : 0.55})` }}>
        <defs>
          <radialGradient id="mlc"><stop offset="0" stopColor="#FEF08A" /><stop offset="1" stopColor="#F59E0B" /></radialGradient>
        </defs>
        <circle cx="100" cy="100" r="15" fill="url(#mlc)" />
        {Array.from({ length: 8 }).map((_, i) => (
          <circle key={i} cx={100 + Math.cos((i / 8) * Math.PI * 2) * 25} cy={100 + Math.sin((i / 8) * Math.PI * 2) * 25} r="3" fill="#FDE68A" />
        ))}
      </svg>
    </div>
  );
}

function FlowerArt({ kind, c1, c2 }) {
  return (
    <svg width="44" height="64" viewBox="0 0 44 64">
      <path d="M22 62 C22 50 21 44 22 28" stroke="#16A34A" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M22 52 C12 52 8 46 8 40 C16 40 22 44 22 52 Z" fill="#22C55E" />
      <path d="M22 47 C32 47 36 41 36 35 C28 35 22 39 22 47 Z" fill="#16A34A" />
      {kind === 'daisy' && Array.from({ length: 10 }).map((_, i) => (
        <path key={i} d={petal(22, 20, 17, 3.6)} fill={c1} stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" transform={`rotate(${i * 36} 22 20)`} />
      ))}
      {kind === 'bloom' && Array.from({ length: 6 }).map((_, i) => (
        <path key={i} d={petal(22, 20, 16, 7.5)} fill={c1} stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" transform={`rotate(${i * 60} 22 20)`} />
      ))}
      {kind === 'tulip' && (
        <>
          <path d="M11 8 C11 26 33 26 33 8 L28 15 L22 4 L16 15 Z" fill={c1} />
          <path d="M16 15 L22 4 L28 15 C26 22 18 22 16 15 Z" fill={c2} opacity="0.55" />
        </>
      )}
      {kind !== 'tulip' && <circle cx="22" cy="20" r="4.2" fill={c2} />}
    </svg>
  );
}

function CreatureArt({ kind }) {
  const m = META[kind];
  return (
    <span className="rg-creature-body">
      <span className="rg-aura" style={{ background: `radial-gradient(circle, rgba(${m.aura},0.55), rgba(${m.aura},0) 70%)` }} />
      <svg width="56" height="56" viewBox="0 0 56 56" className={`rg-creature rg-${kind}`}>
        {kind === 'drop' && (
          <>
            <defs><linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E0F2FE" /><stop offset="1" stopColor="#38BDF8" /></linearGradient></defs>
            <path d="M28 6 C28 6 10 28 10 38 A18 18 0 0 0 46 38 C46 28 28 6 28 6 Z" fill="url(#dg)" stroke="#fff" strokeOpacity="0.7" />
            <ellipse cx="21" cy="34" rx="3" ry="6" fill="#fff" opacity="0.7" transform="rotate(20 21 34)" />
          </>
        )}
        {kind === 'bud' && (
          <>
            {[-26, 0, 26].map((a) => (
              <path key={a} d={petal(28, 46, 30, 8)} fill="#F472B6" stroke="#fff" strokeOpacity="0.5" transform={`rotate(${a} 28 46)`} />
            ))}
            <path d={petal(28, 46, 24, 6)} fill="#FBCFE8" />
            <circle cx="28" cy="46" r="3" fill="#FDE68A" />
          </>
        )}
        {kind === 'seed' && (
          <>
            <path d="M28 50 L28 26" stroke="#CBD5E1" strokeWidth="1.5" />
            {Array.from({ length: 9 }).map((_, i) => {
              const a = (-80 + i * 20) * (Math.PI / 180);
              return <line key={i} x1="28" y1="26" x2={28 + Math.sin(a) * 20} y2={26 - Math.cos(a) * 18} stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />;
            })}
            <circle cx="28" cy="50" r="2.4" fill="#92400E" />
          </>
        )}
        {kind === 'wisp' && (
          <>
            <defs><radialGradient id="wg"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#22D3EE" /></radialGradient></defs>
            <circle cx="28" cy="28" r="10" fill="url(#wg)" />
            <g className="rg-orbit">
              <circle cx="28" cy="10" r="2.2" fill="#FDE68A" /><circle cx="46" cy="30" r="1.8" fill="#A5F3FC" /><circle cx="14" cy="40" r="1.8" fill="#fff" />
            </g>
          </>
        )}
        {kind === 'blossom' && (
          <>
            {Array.from({ length: 5 }).map((_, i) => (
              <path key={i} d={petal(28, 28, 20, 8)} fill="#FBCFE8" stroke="#F472B6" strokeOpacity="0.5" transform={`rotate(${i * 72} 28 28)`} />
            ))}
            <circle cx="28" cy="28" r="4" fill="#F472B6" />
          </>
        )}
      </svg>
    </span>
  );
}

const STARS = Array.from({ length: 24 }, () => ({
  x: rand(2, 96), y: rand(2, 38), size: rand(5, 11), dur: rand(1.2, 3.2), delay: rand(0, 2.5),
  gold: Math.random() > 0.7,
}));
const FIREFLIES = Array.from({ length: 9 }, () => ({
  x: rand(5, 92), y: rand(30, 72), dur: rand(4, 8), flicker: rand(0.9, 2.2), size: rand(6, 10),
}));
const PETALS = Array.from({ length: 7 }, (_, i) => ({
  x: rand(2, 96), dur: rand(16, 26), delay: i * 1.3, size: rand(10, 16),
  color: ['#F9A8D4', '#FBCFE8', '#F472B6', '#FDE68A'][i % 4],
}));

export default function FlowerMeadow({ paused, onTally, onEvent }) {
  const stage = useRef(null);
  const [cycles, setCycles] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [flowers, setFlowers] = useState([]);
  const [creatures, setCreatures] = useState(() => ['drop', 'bud', 'seed', 'wisp', 'blossom', 'drop'].map((kind, i) => ({
    id: uid(), kind, x: rand(6, 84), n: 0, scale: rand(0.95, 1.15), delay: i * 2.8, dur: rand(14, 18),
  })));
  const [effects, addEffect] = useTransients(1500);

  const plant = (atX) => {
    const style = FLOWER_STYLES[Math.floor(Math.random() * FLOWER_STYLES.length)];
    setFlowers((prev) => [...prev.slice(-12), {
      id: uid(), style, x: atX != null ? atX : rand(6, 88), y: rand(66, 80), scale: rand(0.9, 1.3),
    }]);
    if (onEvent) onEvent('flower');
  };

  const { phase, left } = useBreathPhases(TIMING, ORDER, {
    paused,
    onEnter: (next) => {
      if (next === 'rest') {
        setCycles((c) => c + 1);
        plant();
        if (onTally) onTally();
      }
    },
  });

  const open = phase === 'inhale' || phase === 'hold';
  const color = PHASE_COLOR[phase];
  const level = Math.floor(score / XP_PER_LEVEL) + 1;
  const goalDone = cycles % GOAL_CYCLES;

  const popEffect = (x, y, text, col, burst) => addEffect({ x, y, text, col, burst });

  const onStageTap = (e) => {
    if (paused) return;
    const p = relPoint(e, stage.current);
    setScore((s) => s + 50);
    setCombo((c) => c + 1);
    popEffect(p.x, p.y, '+50 STARDUST', '#F59E0B');
    plant((p.x / stage.current.clientWidth) * 100 - 3);
  };

  const respawn = (id, wait) => setCreatures((list) => list.map((c) => (c.id === id ? {
    ...c, n: c.n + 1, x: rand(6, 84), delay: wait, dur: rand(14, 18),
  } : c)));

  const catchCreature = (e, c) => {
    e.stopPropagation();
    if (paused) return;
    const m = META[c.kind];
    const box = e.currentTarget.getBoundingClientRect();
    const sb = stage.current.getBoundingClientRect();
    const x = box.left - sb.left + box.width / 2;
    const y = box.top - sb.top + box.height / 2;
    setScore((s) => s + 100);
    popEffect(x - 30, y - 20, `${m.label} +100`, m.color, m.burst);
    plant((x / sb.width) * 100 - 3);
    respawn(c.id, rand(1, 2.5));
  };

  return (
    <div className="rg-stage rg-meadow" ref={stage} onPointerDown={onStageTap}
      style={{ backgroundImage: `url(${bgImage})`, '--phase': color }}>
      <div className="rg-shade" />
      {ORDER.map((p) => (
        <div key={p} className="rg-tint" style={{ background: PHASE_TINT[p], opacity: p === phase ? 1 : 0 }} />
      ))}

      {STARS.map((s, i) => (
        <span key={i} className="rg-star" style={{
          left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size,
          background: s.gold ? '#FDE68A' : '#fff', animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s`,
        }} />
      ))}
      {FIREFLIES.map((f, i) => (
        <span key={i} className="rg-firefly" style={{
          left: `${f.x}%`, top: `${f.y}%`, width: f.size, height: f.size,
          animationDuration: `${f.dur}s, ${f.flicker}s`,
        }} />
      ))}
      {PETALS.map((p, i) => (
        <span key={i} className="rg-fallpetal" style={{
          left: `${p.x}%`, width: p.size, height: p.size * 1.4, background: p.color,
          animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`,
        }} />
      ))}

      <div className="rg-hud">
        <div className="rg-hud-row">
          <div className="rg-level">
            <span className="rg-level-badge">{level}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)]}</b>
              <div className="rg-xp"><span style={{ width: `${((score % XP_PER_LEVEL) / XP_PER_LEVEL) * 100}%` }} /></div>
              <small>{score % XP_PER_LEVEL} / {XP_PER_LEVEL} Zen XP</small>
            </div>
          </div>
          <div className="rg-pills">
            <span className="rg-pill">✦ {score}</span>
            <span className="rg-pill">🔥 x{combo}</span>
          </div>
        </div>
        <div className="rg-goal">
          <small>Calm goal</small>
          <span className="rg-goal-dots">
            {Array.from({ length: GOAL_CYCLES }).map((_, i) => (
              <i key={i} className={i < goalDone ? 'on' : ''}>{i < goalDone ? '★' : ''}</i>
            ))}
          </span>
          <small>{goalDone}/{GOAL_CYCLES}</small>
        </div>
      </div>

      {creatures.map((c) => (
        <button key={`${c.id}-${c.n}`} type="button" className="rg-fall" aria-label={META[c.kind].label}
          onPointerDown={(e) => catchCreature(e, c)}
          onAnimationEnd={() => respawn(c.id, rand(1.5, 3.5))}
          style={{
            left: `${c.x}%`, '--s': c.scale, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s`,
            animationPlayState: paused ? 'paused' : 'running',
          }}>
          <CreatureArt kind={c.kind} />
        </button>
      ))}

      {flowers.map((f) => (
        <span key={f.id} className="rg-garden-flower" style={{ left: `${f.x}%`, top: `${f.y}%`, '--s': f.scale }}>
          <FlowerArt {...f.style} />
        </span>
      ))}

      <div className="rg-bloom" style={{ '--c': color }}>
        <div className="rg-mandala" />
        <div className="rg-halo rg-halo-outer" style={{ transform: `scale(${open ? 1.4 * 1.45 : 0.7 * 1.45})`, transitionDuration: `${phase === 'inhale' ? 4 : phase === 'exhale' ? 8 : 0.4}s` }} />
        <div className="rg-halo rg-halo-mid" style={{ transform: `scale(${open ? 1.4 * 1.2 : 0.7 * 1.2})`, transitionDuration: `${phase === 'inhale' ? 4 : phase === 'exhale' ? 8 : 0.4}s` }} />
        <div className={`rg-bloom-core ${phase === 'hold' ? 'pulse' : ''}`}
          style={{ transform: `scale(${open ? 1.4 : 0.7})`, transitionDuration: `${phase === 'inhale' ? 4 : phase === 'exhale' ? 8 : 0.4}s` }}>
          <Lotus open={open} />
        </div>
        <span className="rg-count" style={{ borderColor: color, color }}>{left}s</span>
      </div>

      <div className="rg-guide">
        <h3 key={phase} style={{ color }}>{PHASE_TEXT[phase][0]}</h3>
        <p>{PHASE_TEXT[phase][1]}</p>
        <div className="rg-tracker">
          {ORDER.map((p) => <i key={p} className={p === phase ? 'on' : ''} style={p === phase ? { background: PHASE_COLOR[p] } : undefined} />)}
        </div>
        <span className="rg-cycles">✿ {cycles} {cycles === 1 ? 'Cycle' : 'Cycles'}</span>
      </div>

      {effects.map((fx) => (
        <span key={fx.id} className="rg-fx" style={{ left: fx.x, top: fx.y, color: fx.col }}>
          {fx.burst && fx.burst.map((c, i) => <i key={i} style={{ background: c, '--a': `${i * 160}deg` }} />)}
          {fx.text}
        </span>
      ))}

      <div className="rg-hint">
        <b>Catch the falling dew, buds, seeds & wisps. Tap anywhere to bloom flowers.</b>
        <span>{flowers.length} flowers bloomed in your sanctuary</span>
      </div>
    </div>
  );
}
