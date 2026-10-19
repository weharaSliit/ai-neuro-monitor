import { useEffect, useMemo, useRef, useState } from 'react';

const PAD = { top: 12, right: 14, bottom: 26, left: 52 };

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(lo, hi, n = 4) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

// Line chart over {x, y} points (y null = gap, e.g. a skipped block).
// Dense series are min/max-decimated per pixel column so 2,500 raw
// samples still draw as one cheap path without hiding spikes.
export function LineChart({
  points, height = 180, yDomain, refLines = [], xFormat = (v) => v, yFormat = (v) => v,
  tooltip, emptyText = 'No data yet', ariaLabel, dots = false, markX = [],
}) {
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const geo = useMemo(() => {
    const valid = points.filter((p) => p.y != null && Number.isFinite(p.y));
    if (points.length < 2 || !valid.length) return null;
    const x0 = points[0].x; const x1 = points[points.length - 1].x;
    let lo; let hi;
    if (yDomain) [lo, hi] = yDomain;
    else {
      lo = Math.min(...valid.map((p) => p.y), ...refLines.map((r) => r.y));
      hi = Math.max(...valid.map((p) => p.y), ...refLines.map((r) => r.y));
      if (hi === lo) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    }
    const sx = (x) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * innerW;
    const sy = (y) => PAD.top + (1 - (Math.min(hi, Math.max(lo, y)) - lo) / (hi - lo)) * innerH;

    let d = '';
    if (points.length > innerW * 2) {
      // Decimate: one min/max pair per pixel column.
      const cols = new Map();
      for (const p of valid) {
        const c = Math.round(sx(p.x));
        const e = cols.get(c);
        if (!e) cols.set(c, [p.y, p.y]);
        else { e[0] = Math.min(e[0], p.y); e[1] = Math.max(e[1], p.y); }
      }
      [...cols.entries()].sort((a, b) => a[0] - b[0]).forEach(([c, [mn, mx]], i) => {
        d += `${i ? 'L' : 'M'}${c},${sy(mn).toFixed(1)}L${c},${sy(mx).toFixed(1)}`;
      });
    } else {
      let pen = false;
      for (const p of points) {
        if (p.y == null || !Number.isFinite(p.y)) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
        pen = true;
      }
    }
    return { x0, x1, lo, hi, sx, sy, d, valid };
  }, [points, yDomain, refLines, innerW, innerH]);

  if (!geo) {
    return <div ref={wrapRef} className="chart-empty" style={{ height }}>{emptyText}</div>;
  }

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const xv = geo.x0 + ((px - PAD.left) / innerW) * (geo.x1 - geo.x0);
    let best = null; let bd = Infinity;
    // Binary search on the (sorted) x for dense series.
    let lo = 0; let hi = points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].x < xv) lo = mid; else hi = mid; }
    for (const i of [lo, hi]) {
      const dd = Math.abs(points[i].x - xv);
      if (dd < bd) { bd = dd; best = points[i]; }
    }
    setHover(best);
  };

  const xTicks = niceTicks(geo.x0, geo.x1, Math.max(2, Math.floor(innerW / 110)));
  const yTicks = niceTicks(geo.lo, geo.hi, 4);
  const hx = hover ? geo.sx(hover.x) : null;
  const hy = hover && hover.y != null ? geo.sy(hover.y) : null;

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={geo.sy(t)} y2={geo.sy(t)} />
            <text className="tick" x={PAD.left - 6} y={geo.sy(t)} dy="0.32em" textAnchor="end">{yFormat(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} className="tick" x={geo.sx(t)} y={height - 8} textAnchor="middle">{xFormat(t)}</text>
        ))}
        <line className="axis" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} />
        {markX.map((m) => (
          <g key={`m${m.x}`}>
            <line className="mark-x" x1={geo.sx(m.x)} x2={geo.sx(m.x)} y1={PAD.top} y2={PAD.top + innerH} />
            {m.label && <text className="tick" x={geo.sx(m.x) + 4} y={PAD.top + 10}>{m.label}</text>}
          </g>
        ))}
        {refLines.map((r) => (
          <g key={`r${r.label}`}>
            <line className="ref" x1={PAD.left} x2={width - PAD.right} y1={geo.sy(r.y)} y2={geo.sy(r.y)} />
            <text className="ref-label" x={width - PAD.right - 4} y={geo.sy(r.y) - 5} textAnchor="end">{r.label}</text>
          </g>
        ))}
        <path className="series" d={geo.d} />
        {dots && geo.valid.map((p) => (
          <circle key={p.x} className="dot" cx={geo.sx(p.x)} cy={geo.sy(p.y)} r={4} />
        ))}
        {hover && (
          <g pointerEvents="none">
            <line className="crosshair" x1={hx} x2={hx} y1={PAD.top} y2={PAD.top + innerH} />
            {hy != null && <circle className="dot hover" cx={hx} cy={hy} r={5} />}
          </g>
        )}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(Math.max(hx + 12, 0), width - 190), top: 8 }}>
          {tooltip ? tooltip(hover) : <><b>{hover.y == null ? '—' : yFormat(hover.y)}</b><span>{xFormat(hover.x)}</span></>}
        </div>
      )}
    </div>
  );
}

// Horizontal bars for one measure across categories (single colour --
// identity comes from the row label, not hue).
export function BarList({ rows, format = (v) => v, max }) {
  const [hover, setHover] = useState(null);
  const m = max ?? Math.max(...rows.map((r) => r.value ?? 0), 1e-9);
  return (
    <div className="barlist" role="list">
      {rows.map((r) => (
        <div key={r.label} className={`bar-row${hover === r.label ? ' is-hover' : ''}`} role="listitem"
          onMouseEnter={() => setHover(r.label)} onMouseLeave={() => setHover(null)}
          title={r.hint ? `${r.label}: ${format(r.value)} — ${r.hint}` : undefined}>
          <span className="bar-label">{r.label}<small>{r.sub}</small></span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${r.value == null ? 0 : Math.max(1.5, (r.value / m) * 100)}%` }} />
          </span>
          <span className="bar-value">{r.value == null ? '—' : format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Semicircle gauge for the 0..1 task-state score with the threshold tick.
export function ScoreGauge({ value, threshold, level, label = 'task_state_score' }) {
  const R = 70; const cx = 90; const cy = 84;
  const pt = (v) => {
    const a = Math.PI * (1 - Math.min(1, Math.max(0, v)));
    return [cx + R * Math.cos(a), cy - R * Math.sin(a)];
  };
  const arc = (v) => {
    const [x, y] = pt(v);
    return `M${cx - R},${cy} A${R},${R} 0 0 1 ${x.toFixed(2)},${y.toFixed(2)}`;
  };
  const [tx, ty] = pt(threshold ?? 0);
  const [tx2, ty2] = [cx + (tx - cx) * 1.18, cy + (ty - cy) * 1.18];
  return (
    <svg viewBox="0 0 180 100" className="gauge" role="img"
      aria-label={value == null ? 'No score' : `${label} ${fmtScore(value)}`}>
      <path d={arc(1)} className="gauge-track" />
      {value != null && <path d={arc(value)} className={`gauge-fill lvl-${level || 'none'}`} />}
      {threshold != null && <line x1={tx} y1={ty} x2={tx2} y2={ty2} className="gauge-tick" />}
      <text x={cx} y={cy - 12} textAnchor="middle" className="gauge-value">{fmtScore(value)}</text>
      <text x={cx} y={cy + 6} textAnchor="middle" className="gauge-sub">{label}</text>
    </svg>
  );
}

// Several series on one shared y-axis (never two scales). Each series:
// {key, label, color, dash?, width?}; points: [{x, [key]: value|null}].
// `bands` shade x-ranges (e.g. experiment conditions) with a label on top;
// `hidden` toggles series from the legend. `hbands` shade y-ranges
// ({y0, y1, label, color}); `markers` draw glyphs at points
// ({x, y, glyph, color, title}) -- e.g. warnings, alerts, rejected blocks.
export function MultiLineChart({
  points, series, height = 220, yDomain, xDomain, bands = [], refLines = [],
  xFormat = (v) => v, yFormat = (v) => v, ariaLabel, emptyText = 'No data yet', legend = true,
  xTicks: xTicksProp, hbands = [], markers = [], onZoom, onPan,
}) {
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  // onZoom(x0, x1): drag across the plot to zoom into those x values; double-click resets (onZoom(null)).
  const [drag, setDrag] = useState(null);
  // onPan(dtMs): drag sideways to move through time (instead of drawing a zoom box); double-click = back to the newest.
  const panX = useRef(null);
  const [hidden, setHidden] = useState(() => new Set());
  // a reference line's label sits in a right gutter, never on top of the lines
  const padR = refLines.length ? 58 : PAD.right;
  const innerW = width - PAD.left - padR;
  const innerH = height - PAD.top - PAD.bottom;
  const shown = series.filter((s) => !hidden.has(s.key));

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const vals = [];
    for (const p of points) for (const s of shown) if (p[s.key] != null && Number.isFinite(p[s.key])) vals.push(p[s.key]);
    if (!vals.length && !yDomain) return null;
    const [x0, x1] = xDomain || [points[0].x, points[points.length - 1].x];
    let lo; let hi;
    if (yDomain) [lo, hi] = yDomain;
    else {
      lo = Math.min(...vals, ...refLines.map((r) => r.y)); hi = Math.max(...vals, ...refLines.map((r) => r.y));
      if (hi === lo) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    }
    const sx = (x) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * innerW;
    const sy = (y) => PAD.top + (1 - (Math.min(hi, Math.max(lo, y)) - lo) / (hi - lo)) * innerH;
    const paths = shown.map((s) => {
      let d = ''; let pen = false;
      for (const p of points) {
        const v = p[s.key];
        // series.connect: a point that simply has no key for this series (a
        // reading from another series at that time) is skipped, not a gap;
        // an explicit null still breaks the line.
        if (s.connect && v === undefined) continue;
        if (v == null || !Number.isFinite(v) || p.x < x0 || p.x > x1) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(v).toFixed(1)}`; pen = true;
      }
      return { ...s, d };
    });
    return { x0, x1, lo, hi, sx, sy, paths };
  }, [points, shown, yDomain, xDomain, refLines, innerW, innerH]);

  const toggle = (k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const legendEl = legend && series.length > 1 && (
    <div className="mlegend" role="group" aria-label="Series">
      {series.map((s) => (
        <button key={s.key} type="button" className={hidden.has(s.key) ? 'off' : ''} onClick={() => toggle(s.key)}
          aria-pressed={!hidden.has(s.key)} title={hidden.has(s.key) ? 'Show' : 'Hide'}>
          <i style={{ background: s.dash ? 'transparent' : s.color, borderColor: s.color }} className={s.dash ? 'dashed' : ''} />{s.label}
        </button>
      ))}
    </div>
  );

  if (!geo) {
    return <div ref={wrapRef}>{legendEl}<div className="chart-empty" style={{ height }}>{emptyText}</div></div>;
  }

  const xAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left - PAD.left) / innerW));
    return geo.x0 + f * (geo.x1 - geo.x0);
  };
  const onMove = (e) => {
    if (panX.current != null && onPan) {
      const dx = e.clientX - panX.current; panX.current = e.clientX;
      if (dx) onPan((-dx / innerW) * (geo.x1 - geo.x0));
      return;
    }
    const xv = xAt(e);
    let best = null; let bd = Infinity;
    for (const p of points) { const d = Math.abs(p.x - xv); if (d < bd) { bd = d; best = p; } }
    setHover(best);
    if (drag) setDrag({ ...drag, b: xv });
  };
  const onDown = onPan ? (e) => { panX.current = e.clientX; setHover(null); } : onZoom ? (e) => { const xv = xAt(e); setDrag({ a: xv, b: xv }); } : undefined;
  const onUp = onPan ? () => { panX.current = null; } : onZoom ? () => {
    if (drag && Math.abs(drag.b - drag.a) > (geo.x1 - geo.x0) * 0.01) onZoom(Math.min(drag.a, drag.b), Math.max(drag.a, drag.b));
    setDrag(null);
  } : undefined;
  const xTicks = xTicksProp || niceTicks(geo.x0, geo.x1, Math.max(2, Math.floor(innerW / 110)));
  const yTicks = niceTicks(geo.lo, geo.hi, 4);
  const hx = hover ? geo.sx(hover.x) : null;
  const band = hover && bands.find((b) => hover.x >= b.x0 && hover.x <= b.x1);

  return (
    <div ref={wrapRef} className="chart-wrap">
      {legendEl}
      <div style={{ position: 'relative' }}>
        <svg width={width} height={height} role="img" aria-label={ariaLabel}
          onMouseMove={onMove} onMouseLeave={() => { setHover(null); setDrag(null); panX.current = null; }}
          onMouseDown={onDown} onMouseUp={onUp} onDoubleClick={onPan ? () => onPan(null) : onZoom ? () => onZoom(null) : undefined}
          style={onPan ? { cursor: 'grab', userSelect: 'none' } : onZoom ? { cursor: 'crosshair', userSelect: 'none' } : undefined}>
          {drag && (
            <rect x={geo.sx(Math.min(drag.a, drag.b))} y={PAD.top} width={Math.abs(geo.sx(drag.b) - geo.sx(drag.a))} height={innerH}
              fill="var(--series)" fillOpacity={0.15} stroke="var(--series)" strokeOpacity={0.5} />
          )}
          {bands.map((b, i) => {
            const a = geo.sx(Math.max(b.x0, geo.x0)); const z = geo.sx(Math.min(b.x1, geo.x1));
            if (z <= a) return null;
            return (
              <g key={`b${i}`}>
                <rect x={a} y={PAD.top} width={z - a} height={innerH} className={`cband cband-${b.kind || 'n'}`} />
                {/* label only when it fits inside the band, so neighbouring labels never run into each other */}
                {b.label && z - a > Math.max(40, String(b.label).length * 7.2 + 10) && <text x={b.center ? (a + z) / 2 : a + 4} y={PAD.top + 14} textAnchor={b.center ? 'middle' : undefined} className="cband-label">{b.label}</text>}
              </g>
            );
          })}
          {hbands.map((h, i) => {
            const top = geo.sy(Math.max(h.y0, h.y1)); const bot = geo.sy(Math.min(h.y0, h.y1));
            if (bot - top <= 0) return null;
            return (
              <g key={`h${i}`}>
                <rect x={PAD.left} y={top} width={innerW} height={bot - top} fill={h.color || 'var(--warning)'} fillOpacity={h.opacity ?? 0.12} />
                {h.label && <text x={PAD.left + 4} y={bot - 4} className="cband-label">{h.label}</text>}
              </g>
            );
          })}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line className="grid" x1={PAD.left} x2={width - padR} y1={geo.sy(t)} y2={geo.sy(t)} />
              <text className="tick" x={PAD.left - 6} y={geo.sy(t)} dy="0.32em" textAnchor="end">{yFormat(t)}</text>
            </g>
          ))}
          {xTicks.filter((t) => t >= geo.x0 && t <= geo.x1).map((t) => (
            <text key={`x${t}`} className="tick" x={geo.sx(t)} y={height - 8} textAnchor="middle">{xFormat(t)}</text>
          ))}
          <line className="axis" x1={PAD.left} x2={width - padR} y1={PAD.top + innerH} y2={PAD.top + innerH} />
          {refLines.map((r) => (
            <g key={`r${r.label}`}>
              <line className="ref" x1={PAD.left} x2={width - padR} y1={geo.sy(r.y)} y2={geo.sy(r.y)} />
              <text className="ref-label" x={width - padR + 6} y={geo.sy(r.y)} dy="0.34em">{r.label}</text>
            </g>
          ))}
          {geo.paths.map((p) => (
            <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={p.width || 2}
              strokeDasharray={p.dash ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {/* series.dots: a marker on every point (sparse series, e.g. calibration blocks) */}
          {shown.filter((s) => s.dots).map((s) => points.map((p) => (p[s.key] != null && Number.isFinite(p[s.key])
            && p.x >= geo.x0 && p.x <= geo.x1 ? (
              <circle key={`${s.key}-${p.x}`} cx={geo.sx(p.x)} cy={geo.sy(p[s.key])} r={points.length > 120 ? 3 : 4} fill={s.color}
                stroke="var(--surface)" strokeWidth={1.5} />
            ) : null)))}
          {markers.filter((m) => m.x >= geo.x0 && m.x <= geo.x1 && m.y != null).map((m, i) => (
            <text key={`m${i}`} x={geo.sx(m.x)} y={geo.sy(m.y)} dy="0.35em" textAnchor="middle" className="chart-marker"
              fill={m.color || 'var(--ink)'}><title>{m.title}</title>{m.glyph}</text>
          ))}
          {hover && (
            <g pointerEvents="none">
              <line className="crosshair" x1={hx} x2={hx} y1={PAD.top} y2={PAD.top + innerH} />
              {shown.map((s) => (hover[s.key] != null && Number.isFinite(hover[s.key]) ? (
                <circle key={s.key} cx={hx} cy={geo.sy(hover[s.key])} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ) : null))}
            </g>
          )}
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: Math.min(Math.max(hx + 12, 0), width - 200), top: 8 }}>
            <b>{xFormat(hover.x)}</b>
            {band && <span>{band.label}</span>}
            {shown.map((s) => (
              <span key={s.key} className="tip-row">
                <i style={{ background: s.color }} />{s.label}<em>{hover[s.key] == null ? '—' : yFormat(hover[s.key])}</em>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── score scales ─────────────────────────────────────────────────────
// wearable02 scores can sit around 0.001 (far below SAM40's range), which
// draws as a flat line on a 0..1 axis. Charts of a score offer these scales.

// Score text that stays readable when tiny: 0.000521 -> "5.2e-4".
export function fmtScore(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && a < 0.01) return v.toExponential(1);
  return v.toFixed(a < 0.1 ? 3 : 2);
}

// log10 for plotting; values <= 0 are floored so they still draw.
export const log10Safe = (v) => (v == null || !Number.isFinite(v) ? null : Math.log10(Math.max(v, 1e-9)));

// 'log' when every score is small (where a 0..1 axis shows a flat line).
export const autoScoreScale = (values) => {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  return v.length && Math.max(...v) < 0.05 ? 'log' : 'full';
};

export function ScaleSwitch({ value, onChange, options }) {
  return (
    <div className="seg" role="group" aria-label="Chart scale">
      {options.map(([k, label, hint]) => (
        <button key={k} type="button" className={value === k ? 'on' : ''} title={hint}
          aria-pressed={value === k} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}
