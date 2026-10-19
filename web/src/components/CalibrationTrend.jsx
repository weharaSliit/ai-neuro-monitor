import { Card, CardHead } from './ui';
import { COLORS } from '../lib/levels';
import { mean } from '../lib/limits';

// Calibration trend: rest -> task -> recovery for mind, body and overall on the
// shared scale (each one's own limit = 0.50). x = position inside each phase;
// lines are a 3-point running mean. Same chart as psy_web's Calibration page.
const LINES = [['mind', 'Mind', COLORS.eeg], ['body', 'Body', COLORS.hrv], ['fused', 'Overall', COLORS.brand]];
const W = 720; const H = 300; const P = { l: 40, r: 52, t: 30, b: 14 };
const iw = W - P.l - P.r; const ih = H - P.t - P.b;
const X = (x) => P.l + (x / 3) * iw;
const Y = (v) => P.t + (1 - Math.max(0, Math.min(1, v))) * ih;
const f2 = (v) => (v == null ? '—' : v.toFixed(2));

function dragScroll(e) {
  const el = e.currentTarget; const x0 = e.clientX; const s0 = el.scrollLeft;
  const move = (m) => { el.scrollLeft = s0 - (m.clientX - x0); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); el.style.cursor = ''; };
  el.style.cursor = 'grabbing';
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

export default function CalibrationTrend({ phases }) {
  const comps = LINES.filter(([k]) => phases?.[k]);
  const series = comps.map(([k, label, color]) => {
    const p = phases[k]; const show = p.show || ((v) => v);
    const pts = [];
    [p.rest, p.task, p.recovery].forEach((arr, ph) => (arr || []).forEach((_, i) => {
      pts.push([ph + (i + 0.5) / arr.length, show(mean(arr.slice(Math.max(0, i - 2), i + 1)))]);
    }));
    return { k, label, color, pts };
  });
  return (
    <Card style={{ marginTop: 16 }}>
      <CardHead title="Calibration trend" />
      {!series.some((s) => s.pts.length) ? <p className="body" style={{ padding: '28px 0', textAlign: 'center' }}>Readings appear here as the steps run.</p> : (
        <>
          <div onPointerDown={dragScroll} style={{ overflowX: 'auto', cursor: 'grab', userSelect: 'none', touchAction: 'pan-x' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 900, height: 'auto', display: 'block' }} role="img" aria-label="Calibration trend for mind, body and overall">
            {['Rest', 'Task', 'Recovery'].map((l, i) => (
              <g key={l}>
                <rect x={X(i)} y={P.t} width={iw / 3} height={ih} fill={i === 1 ? 'rgba(229,107,78,.09)' : 'rgba(110,104,178,.05)'} />
                <text x={X(i + 0.5)} y={P.t - 11} textAnchor="middle" fontSize="12" fontWeight="700" fill={COLORS.textMuted}>{l.toUpperCase()}</text>
              </g>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke={v === 0.5 ? COLORS.stress : 'rgba(120,120,140,.18)'} strokeDasharray={v === 0.5 ? '5 4' : undefined} />
                <text x={P.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill={COLORS.textMuted}>{v.toFixed(2)}</text>
              </g>
            ))}
            <text x={W - P.r + 6} y={Y(0.5) + 4} fontSize="11" fontWeight="700" fill={COLORS.stress}>Limit</text>
            {series.map((s) => (
              <g key={s.k}>
                <polyline fill="none" stroke={s.color} strokeWidth={s.k === 'fused' ? 3 : 2.2} strokeLinejoin="round" strokeLinecap="round"
                  points={s.pts.map(([x, v]) => `${X(x)},${Y(v)}`).join(' ')} />
                {s.pts.map(([x, v], i) => <circle key={i} cx={X(x)} cy={Y(v)} r="3.2" fill={s.color} />)}
              </g>
            ))}
          </svg>
          </div>
          <div className="ew-legend" style={{ marginTop: 6 }}>
            {series.map((s) => <span key={s.k} style={{ marginRight: 14 }}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: s.color, marginRight: 5 }} />{s.label}</span>)}
          </div>
          <table className="phase-table" style={{ width: '100%', marginTop: 10, fontSize: 13 }}>
            <thead><tr><th /><th>Rest</th><th>Task</th><th>Recovery</th></tr></thead>
            <tbody>
              {series.map((s) => { const L = phases[s.k].levels || {}; return (
                <tr key={s.k}><th style={{ textAlign: 'left', color: s.color }}>{s.label}</th><td>{f2(L.rest)}</td><td>{f2(L.task)}</td><td>{f2(L.recovery)}</td></tr>
              ); })}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}
