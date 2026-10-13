import { COLORS } from '../lib/levels';
import useElementWidth from '../hooks/useElementWidth';

// One graph for the live calibration view: one point per captured block, a
// dashed running average through them, and optional earlier "rest" blocks in
// grey. Few points (3 to 14), so every block gets a labelled position.
const H = 170;
const PAD = { l: 42, r: 14, t: 16, b: 30 };

export function runningAverage(values) {
  let sum = 0; let n = 0;
  return values.map((v) => {
    if (v == null) return n ? sum / n : null;
    sum += v; n += 1;
    return sum / n;
  });
}

function BlockSvg({ width, values, rest, color, fmt, refValue, refLabel }) {
  const all = [...rest, ...values].filter((v) => v != null);
  const avg = runningAverage(values);
  const nTotal = rest.length + values.length;
  if (all.length === 0) {
    return (
      <svg width={width} height={H}>
        <text x={width / 2} y={H / 2} textAnchor="middle" fontSize="12" fill={COLORS.textMuted}>—</text>
      </svg>
    );
  }
  let lo = Math.min(...all, refValue ?? Infinity); let hi = Math.max(...all, refValue ?? -Infinity);
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.18; lo -= pad; hi += pad;
  const plotW = width - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (nTotal <= 1 ? plotW / 2 : (i / (nTotal - 1)) * plotW);
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
  const ticks = [0, 0.5, 1].map((f) => lo + f * (hi - lo));

  const line = (vals, offset) => {
    let d = ''; let open = false;
    vals.forEach((v, i) => {
      if (v == null) { open = false; return; }
      d += `${open ? 'L' : 'M'} ${x(i + offset).toFixed(1)} ${y(v).toFixed(1)} `;
      open = true;
    });
    return d;
  };

  return (
    <svg width={width} height={H} style={{ display: 'block' }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke={COLORS.borderSoft} />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fontWeight="700" fill={COLORS.textMuted}>{fmt(t)}</text>
        </g>
      ))}
      {refValue != null && (
        <g>
          <line x1={PAD.l} x2={width - PAD.r} y1={y(refValue)} y2={y(refValue)} stroke={COLORS.textMuted} strokeDasharray="4 4" strokeOpacity="0.7" />
          <text x={width - PAD.r} y={y(refValue) - 5} textAnchor="end" fontSize="10" fontWeight="800" fill={COLORS.textSub}>{refLabel} {fmt(refValue)}</text>
        </g>
      )}
      {/* earlier resting blocks, grey */}
      <path d={line(rest, 0)} fill="none" stroke={COLORS.border} strokeWidth="2" />
      {rest.map((v, i) => (v == null ? null : <circle key={`r${i}`} cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke={COLORS.textMuted} strokeWidth="1.8" />))}
      {/* this phase's blocks */}
      <path d={line(values, rest.length)} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" />
      <path d={line(avg, rest.length)} fill="none" stroke={color} strokeWidth="2" strokeDasharray="6 5" strokeOpacity="0.55" />
      {values.map((v, i) => (v == null ? null : (
        <circle key={`v${i}`} cx={x(i + rest.length)} cy={y(v)} r="5" fill={color} stroke="#fff" strokeWidth="2">
          <title>{`Block ${i + 1}: ${fmt(v)}`}</title>
        </circle>
      )))}
      {Array.from({ length: nTotal }).map((_, i) => (
        <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill={COLORS.textMuted}>
          {i < rest.length ? `R${i + 1}` : i - rest.length + 1}
        </text>
      ))}
    </svg>
  );
}

export default function BlockChart({ title, unit = '', values, rest = [], color, fmt = (v) => v.toFixed(2), refValue, refLabel }) {
  const [box, width] = useElementWidth();
  const last = [...values].reverse().find((v) => v != null);
  return (
    <div className="card flat" style={{ padding: 14 }}>
      <div className="between" style={{ marginBottom: 4 }}>
        <b style={{ fontSize: 14 }}>{title}</b>
        <b style={{ fontSize: 18, color }}>{last != null ? `${fmt(last)}${unit}` : '—'}</b>
      </div>
      <div ref={box} style={{ width: '100%', minWidth: 0 }}>
        <BlockSvg width={Math.max(160, width)} values={values} rest={rest} color={color} fmt={fmt} refValue={refValue} refLabel={refLabel} />
      </div>
    </div>
  );
}
