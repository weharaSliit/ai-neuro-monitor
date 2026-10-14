import { useEffect, useRef, useState } from 'react';
import Face from './Face';
import { MOODS, MOOD_ORDER, clockShort } from '../../lib/friendly';

function useWidth(initial = 320) {
  const ref = useRef(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Groups consecutive blocks into at most `n` buckets (averaging the scored
// ones) so the chart stays readable however long the session is.
export function bucketize(blocks, n, threshold, moodOf) {
  if (!blocks.length) return [];
  const size = Math.ceil(blocks.length / n);
  const out = [];
  for (let i = 0; i < blocks.length; i += size) {
    const g = blocks.slice(i, i + size);
    const scored = g.filter((b) => b.task_state_score != null);
    const p = scored.length ? scored.reduce((a, b) => a + b.task_state_score, 0) / scored.length : null;
    const end = g[g.length - 1].timestamp_end;
    out.push({ p, end, n: g.length, nScored: scored.length, mood: moodOf(p, threshold) });
  }
  return out;
}

export function MoodLegend() {
  return (
    <div className="legend">
      {MOOD_ORDER.map((k) => (
        <span key={k}><i style={{ background: MOODS[k].color }} />{MOODS[k].short}</span>
      ))}
    </div>
  );
}

// Striped rounded bars on a full-height grey track, as in the mockup.
export function LoadBars({ buckets, height = 200 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const padL = 30; const padB = 24; const padT = 8;
  const innerH = height - padB - padT;
  const slot = (width - padL) / Math.max(1, buckets.length);
  const barW = Math.min(22, slot * 0.55);
  const y = (v) => padT + innerH * (1 - v / 100);

  return (
    <div ref={ref} className="fchart">
      <svg width={width} height={height} role="img" aria-label="Mind load per period">
        <defs>
          {MOOD_ORDER.map((k) => (
            <pattern key={k} id={`stripe-${k}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill={MOODS[k].color} />
              <rect width="2.4" height="7" fill="rgba(255,255,255,0.45)" />
            </pattern>
          ))}
        </defs>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={padL} x2={width} y1={y(t)} y2={y(t)} className="fgrid" />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="ftick">{t}</text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = padL + slot * (i + 0.5);
          const v = b.p == null ? null : b.p * 100;
          const showLabel = buckets.length <= 8 || i % Math.ceil(buckets.length / 7) === 0 || i === buckets.length - 1;
          return (
            <g key={b.end} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={cx - slot / 2} y={padT} width={slot} height={innerH} fill="transparent" />
              <rect x={cx - barW / 2} y={padT} width={barW} height={innerH} rx={barW / 2} className="ftrack" />
              {v != null && (
                <rect x={cx - barW / 2} y={y(Math.max(v, 4))} width={barW} height={innerH - (y(Math.max(v, 4)) - padT)}
                  rx={barW / 2} fill={`url(#stripe-${b.mood.key})`} opacity={hover == null || hover === i ? 1 : 0.55} />
              )}
              {showLabel && <text x={cx} y={height - 6} textAnchor="middle" className="ftick">{clockShort(b.end)}</text>}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="ftip" style={{ left: Math.min(width - 170, Math.max(0, padL + slot * (hover + 0.5) - 80)), top: 0 }}>
          <b>{buckets[hover].p == null ? 'No clear reading' : `${Math.round(buckets[hover].p * 100)} / 100 · ${buckets[hover].mood.word}`}</b>
          <span>up to {clockShort(buckets[hover].end)}</span>
          {buckets[hover].nScored < buckets[hover].n && <span>{buckets[hover].n - buckets[hover].nScored} reading(s) skipped: weak signal</span>}
        </div>
      )}
    </div>
  );
}

// Smooth curve with a face sitting on each point; latest column highlighted.
export function FaceLine({ buckets, height = 220 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pts = buckets.filter((b) => b.p != null);
  if (pts.length < 2) {
    return <div ref={ref} className="fempty" style={{ height }}>The chart appears after a couple of clear readings.</div>;
  }
  const padX = 26; const padT = 26; const padB = 30;
  const innerH = height - padT - padB;
  const step = (width - padX * 2) / (pts.length - 1);
  const xy = pts.map((b, i) => [padX + i * step, padT + innerH * (1 - b.p)]);
  // Catmull-Rom -> cubic Bézier for a soft curve.
  let d = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 0; i < xy.length - 1; i += 1) {
    const p0 = xy[i - 1] || xy[i]; const p1 = xy[i]; const p2 = xy[i + 1]; const p3 = xy[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  const last = xy.length - 1;
  const faceSize = Math.min(30, Math.max(22, step * 0.7));

  return (
    <div ref={ref} className="fchart">
      <svg width={width} height={height} role="img" aria-label="Mood over time">
        <defs>
          <linearGradient id="hl" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--hl)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--hl)" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <rect x={xy[last][0] - 16} y={padT - 18} width={32} height={innerH + 18} rx={10} fill="url(#hl)" />
        <path d={d} fill="none" stroke="var(--curve)" strokeWidth="2.5" strokeLinecap="round" />
        {xy.map(([x, yy], i) => (
          <g key={pts[i].end} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
            <circle cx={x} cy={yy} r={faceSize / 2 + 6} fill="transparent" />
            <g transform={`translate(${x - faceSize / 2},${yy - faceSize / 2})`}>
              <Face mood={pts[i].mood.key} size={faceSize} ring />
            </g>
            {(pts.length <= 8 || i % Math.ceil(pts.length / 7) === 0 || i === last) && (
              <text x={x} y={height - 8} textAnchor="middle" className={`ftick${i === last ? ' strong' : ''}`}>
                {i === last ? 'Now' : clockShort(pts[i].end)}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover != null && (
        <div className="ftip" style={{ left: Math.min(width - 170, Math.max(0, xy[hover][0] - 80)), top: 0 }}>
          <b>{pts[hover].mood.word}</b>
          <span>Mind load {Math.round(pts[hover].p * 100)} / 100</span>
          <span>{clockShort(pts[hover].end)}</span>
        </div>
      )}
    </div>
  );
}

// Calm live wave, no axes: a "your headband is alive" signal.
export function LiveWave({ samples, height = 110 }) {
  const [ref, width] = useWidth();
  const recent = samples.slice(-1250); // last 5 s at 250 SPS
  if (recent.length < 10) return <div ref={ref} className="fempty" style={{ height }}>Waiting for your headband…</div>;
  const mean = recent.reduce((a, s) => a + s.uv, 0) / recent.length;
  const vals = recent.map((s) => s.uv - mean);
  const sorted = [...vals].map(Math.abs).sort((a, b) => a - b);
  const amp = Math.max(1, sorted[Math.floor(sorted.length * 0.98)]);
  const cols = new Map();
  vals.forEach((v, i) => {
    const c = Math.round((i / (vals.length - 1)) * (width - 2)) + 1;
    const e = cols.get(c);
    if (!e) cols.set(c, [v, v]); else { e[0] = Math.min(e[0], v); e[1] = Math.max(e[1], v); }
  });
  const yy = (v) => height / 2 - (Math.max(-amp, Math.min(amp, v)) / amp) * (height / 2 - 6);
  let d = '';
  [...cols.entries()].forEach(([c, [mn, mx]], i) => { d += `${i ? 'L' : 'M'}${c},${yy(mn).toFixed(1)}L${c},${yy(mx).toFixed(1)}`; });
  return (
    <div ref={ref} className="fchart">
      <svg width={width} height={height} role="img" aria-label="Live brainwave">
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="fgrid" />
        <path d={d} fill="none" stroke="var(--wave)" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
