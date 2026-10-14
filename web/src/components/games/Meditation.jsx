import { useEffect, useMemo, useRef, useState } from 'react';
import { rand, useTransients } from './shared';

// Focus Box (4-4-4-4), Deep Belly Calm (4s in / 6s out) and Body Sweep: the
// app's MindfulMeditationEngine. Soft rewards only, nothing is ever "wrong".

const XP_PER_LEVEL = 300;
const CYCLE_GOAL = 5;
const LEVEL_TITLES = ['Seedling', 'Drifting Cloud', 'Calm Lake', 'Moonlit Mind', 'Still Mountain'];

const REGIONS = [
  { id: 'head_jaw', name: 'Head & Mind', nerve: 'Mind Unwind', cue: 'Unclench your jaw and soften your forehead.', benefit: 'Clears mental fog and eases racing thoughts.', icon: '🧠', color: '#7DD3FC', y: 28 },
  { id: 'shoulders_neck', name: 'Shoulders & Neck', nerve: 'Tension Release', cue: 'Let your shoulders drop away from your ears.', benefit: 'Melts physical weight and tightness.', icon: '💆', color: '#C4B5FD', y: 62 },
  { id: 'chest_heart', name: 'Heart Center', nerve: 'Heart Harmony', cue: 'Breathe warmth gently into your chest.', benefit: 'Soothes a busy heart and anxious feelings.', icon: '🫀', color: '#F9A8D4', y: 96 },
  { id: 'abdomen_core', name: 'Solar Core', nerve: 'Belly Calm', cue: 'Send soft, slow waves of breath into your belly.', benefit: 'Invites deep, whole-body relaxation.', icon: '☀️', color: '#FCD34D', y: 132 },
  { id: 'feet_grounding', name: 'Grounded Roots', nerve: 'Rooted Peace', cue: 'Feel your feet heavy and anchored.', benefit: 'Draws restless energy down into the earth.', icon: '👣', color: '#6EE7B7', y: 185 },
];

const BOX_PHASES = [
  { title: 'Inhale', cue: 'Breathe in slowly, like drawing in starlight.', color: '#7DD3FC' },
  { title: 'Hold', cue: 'Rest in the stillness. Nothing to do.', color: '#A5B4FC' },
  { title: 'Exhale', cue: 'Let the breath leave, and let stress drift off with it.', color: '#6EE7B7' },
  { title: 'Rest', cue: 'Pause softly before the next cycle.', color: '#F9A8D4' },
];
const BOX_SCALE = [1.3, 1.33, 0.85, 1.0];

const GRADIENT = {
  box: 'linear-gradient(180deg, #0B1026, #17204A 55%, #2A2F6B)',
  belly: 'linear-gradient(180deg, #073B4C, #0E6E8C 55%, #58B8C8)',
  bodyscan: 'linear-gradient(180deg, #1F1235, #3B2A66 55%, #6A4FA3)',
};

function Bubble({ size = 34, pos, onPop }) {
  const [visible, setVisible] = useState(true);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!visible) return null;
  return (
    <button type="button" className="rg-bubble" style={{ ...pos, width: size, height: size }}
      onClick={() => {
        if (onPop) onPop();
        setVisible(false);
        timer.current = setTimeout(() => setVisible(true), 3500);
      }}>
      <i />
    </button>
  );
}

export default function Meditation({ mode, paused, onTally, onEvent }) {
  const [cycles, setCycles] = useState(0);
  const [xp, setXp] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [secs, setSecs] = useState(4);
  const [streak, setStreak] = useState(0);
  const [hint, setHint] = useState('');
  const [region, setRegion] = useState(0);
  const [softened, setSoftened] = useState([]);
  const [popups, addPopup] = useTransients(1600);

  const level = Math.floor(xp / XP_PER_LEVEL);
  const reward = (text, pts = 0) => {
    if (pts > 0) setXp((t) => t + pts);
    addPopup({ text, x: rand(14, 50), y: rand(6, 14) });
  };

  // ── Focus Box: 4s per side, a light travels the perimeter ──
  useEffect(() => {
    if (mode !== 'box' || paused) return undefined;
    let p = 0; let s = 4;
    setPhaseIdx(0); setSecs(4);
    const iv = setInterval(() => {
      s -= 1;
      if (s <= 0) {
        p = (p + 1) % 4;
        setPhaseIdx(p);
        s = 4;
        if (p === 0) {
          setCycles((c) => c + 1);
          reward('Full cycle  +100', 100);
          if (onTally) onTally();
          if (onEvent) onEvent('box_cycle');
        }
      }
      setSecs(s);
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paused]);

  // ── Deep Belly: 4s in, 6s long out ──
  useEffect(() => {
    if (mode !== 'belly' || paused) return undefined;
    let inhale = true; let s = 4;
    setPhaseIdx(0); setSecs(4);
    const iv = setInterval(() => {
      s -= 1;
      if (s <= 0) {
        inhale = !inhale;
        s = inhale ? 4 : 6;
        setPhaseIdx(inhale ? 0 : 2);
        if (inhale) {
          setCycles((c) => c + 1);
          reward('Tide rolled in  +100', 100);
          if (onTally) onTally();
        }
      }
      setSecs(s);
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paused]);

  // ── Body Sweep: a new zone every 6 s ──
  useEffect(() => {
    if (mode !== 'bodyscan' || paused) return undefined;
    let idx = 0;
    const iv = setInterval(() => {
      idx = (idx + 1) % REGIONS.length;
      setRegion(idx);
      if (idx === 0) {
        setCycles((c) => c + 1);
        setSoftened([]);
        reward('Body journey done  +100', 100);
        if (onTally) onTally();
      }
    }, 6000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paused]);

  const boxTap = (node) => {
    if (node === 'CENTER' || node === phaseIdx) {
      reward('In flow  +25', 25);
      setStreak((s) => s + 1);
      setHint('');
    } else {
      setHint('Follow the glowing star. No rush.');
    }
  };

  const soften = () => {
    const r = REGIONS[region];
    if (softened.includes(r.id)) { reward('Already soft and warm', 0); return; }
    setSoftened((z) => [...z, r.id]);
    reward(`${r.name} softened  +50`, 50);
  };

  const motes = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    id: i, left: rand(2, 96), top: rand(10, 90), size: rand(3, 7), delay: rand(0, 4), dur: rand(6, 11),
  })), []);

  const bp = BOX_PHASES[phaseIdx] || BOX_PHASES[0];
  const cur = REGIONS[region];
  const accent = mode === 'box' ? bp.color : mode === 'belly' ? '#7DD3FC' : cur.color;
  const goalDone = cycles >= CYCLE_GOAL;

  const header = (chip) => (
    <div className="rg-med-head">
      <div className="between">
        <div>
          <small>LEVEL {level + 1}</small>
          <b>{LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)]}</b>
        </div>
        <div className="rg-med-goal">
          <span>
            {Array.from({ length: CYCLE_GOAL }).map((_, i) => (
              <i key={i} style={i < cycles ? { background: accent, borderColor: accent } : undefined} />
            ))}
          </span>
          <small>{goalDone ? 'Calm goal reached' : `${cycles}/${CYCLE_GOAL} calm cycles`}</small>
        </div>
      </div>
      <div className="rg-xp"><span style={{ width: `${Math.max((xp % XP_PER_LEVEL) / XP_PER_LEVEL * 100, 3)}%`, background: accent }} /></div>
      <div className="rg-chips"><span>{xp} calm points</span>{chip}</div>
    </div>
  );

  return (
    <div className="rg-stage rg-med" style={{ background: GRADIENT[mode] }}>
      {motes.map((m) => (
        <span key={m.id} className="rg-mote" style={{
          left: `${m.left}%`, top: `${m.top}%`, width: m.size, height: m.size,
          animationDuration: `${m.dur}s`, animationDelay: `${m.delay}s`,
        }} />
      ))}
      {popups.map((p) => (
        <span key={p.id} className="rg-xp-popup" style={{ left: `${p.x}%`, top: `${p.y}%`, borderColor: accent }}>{p.text}</span>
      ))}

      <div className="rg-med-body">
        {mode === 'box' && (
          <>
            {header(<span>In-flow streak {streak}</span>)}
            <div className="rg-box-arena">
              <div className="rg-box-frame" style={{ borderColor: `${bp.color}66` }}>
                {[['Inhale', 0, 'tl'], ['Hold', 1, 'tr'], ['Exhale', 2, 'br'], ['Rest', 3, 'bl']].map(([label, n, pos]) => (
                  <button key={n} type="button" className={`rg-corner ${pos} ${phaseIdx === n ? 'on' : ''}`}
                    style={phaseIdx === n ? { background: `${bp.color}33`, borderColor: bp.color } : undefined}
                    onClick={() => boxTap(n)}>
                    <i style={phaseIdx === n ? { background: bp.color } : undefined} />
                    <span>{label}</span>
                  </button>
                ))}
                {!paused && <span className="rg-orb" style={{ background: bp.color, boxShadow: `0 0 16px ${bp.color}` }} />}
                <button type="button" className="rg-core" onClick={() => boxTap('CENTER')}
                  style={{ borderColor: bp.color, transform: `scale(${BOX_SCALE[phaseIdx]})` }}>
                  <b>{secs}</b>
                  <small style={{ color: bp.color }}>{bp.title}</small>
                </button>
              </div>
            </div>
            <div className="rg-banner">
              <h4 style={{ color: bp.color }}>{bp.title}</h4>
              <p>{bp.cue}</p>
              <small>{hint || 'Tap the glowing star to collect calm points.'}</small>
            </div>
          </>
        )}

        {mode === 'belly' && (
          <>
            {header(<span>Belly breathing</span>)}
            <div className="rg-ocean">
              <div className="rg-wave" style={{
                height: phaseIdx === 0 ? '90%' : '20%',
                transitionDuration: phaseIdx === 0 ? '4s' : '6s',
              }}>
                <span className="rg-crest" />
              </div>
              <Bubble pos={{ top: 30, right: 36 }} onPop={() => reward('Bubble popped  +15', 15)} />
              <Bubble size={26} pos={{ top: 70, left: 28 }} onPop={() => reward('Bubble popped  +15', 15)} />
              <Bubble size={20} pos={{ bottom: 38, right: 46 }} onPop={() => reward('Bubble popped  +15', 15)} />
              <div className="rg-wave-orb" style={{
                transform: `scale(${phaseIdx === 0 ? 1.3 : 0.85})`, transitionDuration: phaseIdx === 0 ? '4s' : '6s',
              }}>
                <b>{secs}</b>
                <small>{phaseIdx === 0 ? 'Breathe in' : 'Long slow out'}</small>
              </div>
            </div>
            <div className="rg-banner">
              <h4 style={{ color: '#7DD3FC' }}>{phaseIdx === 0 ? 'Fill your belly (4s)' : 'Release like a receding tide (6s)'}</h4>
              <p>{phaseIdx === 0
                ? 'Let your belly rise outward like a peaceful swell.'
                : 'Let the air flow out smooth and long. The longer exhale tells your body it is safe.'}</p>
              <small>Pop the drifting bubbles whenever you like.</small>
            </div>
          </>
        )}

        {mode === 'bodyscan' && (
          <>
            {header(<span>{softened.length}/{REGIONS.length} zones softened</span>)}
            <div className="rg-scan">
              <div className="rg-silhouette">
                <b style={{ color: cur.color }}>BODY MAP</b>
                <svg width="120" height="210" viewBox="0 0 120 210">
                  <g stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" fill="none">
                    <circle cx="60" cy="28" r="14" />
                    <line x1="60" y1="42" x2="60" y2="52" /><line x1="32" y1="58" x2="88" y2="58" />
                    <line x1="60" y1="52" x2="60" y2="135" /><line x1="32" y1="58" x2="22" y2="115" />
                    <line x1="88" y1="58" x2="98" y2="115" /><line x1="60" y1="135" x2="42" y2="195" />
                    <line x1="60" y1="135" x2="78" y2="195" />
                  </g>
                  {REGIONS.map((r, i) => {
                    const active = i === region; const soft = softened.includes(r.id);
                    return (
                      <g key={r.id}>
                        {(active || soft) && (
                          <ellipse cx="60" cy={r.y} rx={active ? 26 : 16} ry={active ? 20 : 12} fill={r.color} opacity={active ? 0.28 : 0.16} />
                        )}
                        <circle cx="60" cy={r.y} r={active ? 8 : 5} fill={soft || active ? r.color : 'rgba(255,255,255,0.35)'}
                          stroke="#fff" strokeWidth={active ? 2 : 1} />
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="rg-scan-right">
                <div className="rg-zone" style={{ borderColor: `${cur.color}99` }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span style={{ fontSize: 26 }}>{cur.icon}</span>
                    <div>
                      <b>{cur.name}</b>
                      <small style={{ color: cur.color }}>{cur.nerve}</small>
                    </div>
                  </div>
                  <p>{cur.cue}</p>
                  <em>{cur.benefit}</em>
                  <button type="button" onClick={soften}
                    style={{ background: softened.includes(cur.id) ? `${cur.color}33` : cur.color, color: softened.includes(cur.id) ? '#fff' : '#1F1235' }}>
                    {softened.includes(cur.id) ? 'Softened' : 'Tap to soften this zone'}
                  </button>
                </div>
                <div className="rg-zone-pills">
                  {REGIONS.map((r, i) => (
                    <button key={r.id} type="button" onClick={() => setRegion(i)}
                      style={i === region ? { background: `${r.color}55`, borderColor: r.color }
                        : softened.includes(r.id) ? { borderColor: r.color } : undefined}>
                      {softened.includes(r.id) ? '✓' : r.icon} {r.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {paused && <div className="rg-paused-pill">Paused. Breathe naturally.</div>}
    </div>
  );
}
