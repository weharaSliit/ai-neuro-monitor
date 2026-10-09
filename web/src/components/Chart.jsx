import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import useElementWidth from '../hooks/useElementWidth';
import { COLORS } from '../lib/levels';

// One chart for the whole site. `rows` = [{ date: Date, values: [n|null, ...] }],
// `series` = [{ name, color }] (same order as values).
//  - `limit` (single series): line coloured green/amber/red around the
//    person's own limit (same 12-point moderate band as levels.js) plus a
//    dashed limit line. zones={false} draws just the reference line.
//  - Every point gets at least MIN_GAP px: when there are more points than
//    fit, the plot scrolls sideways (opening on the newest readings) while
//    the y-axis stays pinned on the left -- nothing is squashed or cut off.
//  - x is index-based so time between sessions doesn't leave huge empty
//    gaps; a dashed separator marks where one session ends.
//  - Sized to its container (ResizeObserver) at every screen width.
const AXIS_W = 40;
const PAD = { l: 10, r: 16, t: 14, b: 28 };
const MIN_GAP = 18; // px per point -- wide enough to read each reading; charts scroll when they don't fit
const GAP_MS = 15 * 60 * 1000;
const BAND = 12;

function fmtTime(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDay(d) { return d.toLocaleDateString([], { day: 'numeric', month: 'short' }); }

function niceDomain(rows, fixed, extra) {
  if (fixed) return fixed;
  let lo = Infinity; let hi = -Infinity;
  rows.forEach((r) => r.values.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  if (extra != null) { lo = Math.min(lo, extra); hi = Math.max(hi, extra); }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi === lo) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

function fmtNum(v) {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function Chart({
  rows, series, height = 220, limit = null, domain = null, suffix = '',
  limitLabel = 'Your limit', empty = 'No readings yet', area = true, zones = true, limitColor = COLORS.stress,
  // Waveforms / dense signals pass a smaller minGap (px per point).
  minGap = MIN_GAP,
}) {
  const [box, width] = useElementWidth();
  const scrollRef = useRef(null);
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  // Mouse drag-to-pan (touch already scrolls natively).
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const onMouseDown = (e) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth || e.button !== 0) return;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
  };
  const onMouseMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 4) { d.moved = true; setDragging(true); setHover(null); }
    if (d.moved) scrollRef.current.scrollLeft = d.left - dx;
  };
  const endDrag = () => { drag.current = null; setDragging(false); };

  const geo = useMemo(() => {
    const n = rows.length;
    const viewW = Math.max(60, width - AXIS_W);
    const contentW = Math.max(viewW, PAD.l + PAD.r + Math.max(0, n - 1) * minGap);
    const hasDates = n > 0 && rows.every((r) => r.date instanceof Date && !Number.isNaN(r.date.getTime()));
    const plotW = contentW - PAD.l - PAD.r;
    const plotH = Math.max(10, height - PAD.t - PAD.b);
    const [lo, hi] = niceDomain(rows, domain, limit);
    const x = (i) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => PAD.t + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * plotH;

    // Session breaks: only gaps far larger than this series' normal
    // spacing (so weekly/daily series still draw one continuous line).
    const diffs = [];
    if (hasDates) for (let i = 1; i < n; i += 1) diffs.push(rows[i].date - rows[i - 1].date);
    const sortedDiffs = [...diffs].sort((a, b) => a - b);
    const typical = sortedDiffs.length ? sortedDiffs[Math.floor(sortedDiffs.length / 2)] : 0;
    const gapLimit = Math.max(GAP_MS, typical * 6);
    const breaks = new Set();
    if (hasDates) for (let i = 1; i < n; i += 1) if (rows[i].date - rows[i - 1].date > gapLimit) breaks.add(i);
    const spanMs = hasDates && n > 1 ? rows[n - 1].date - rows[0].date : 0;

    const paths = series.map((_, si) => {
      let d = ''; let areaD = ''; let open = false; let segStart = 0; let lastX = 0;
      const close = () => { if (open) areaD += ` L ${lastX.toFixed(1)} ${(PAD.t + plotH).toFixed(1)} L ${segStart.toFixed(1)} ${(PAD.t + plotH).toFixed(1)} Z`; };
      rows.forEach((r, i) => {
        const v = r.values[si];
        if (v == null || breaks.has(i)) { close(); open = false; if (v == null) return; }
        const px = x(i); const py = y(v);
        const seg = ` ${open ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`;
        d += seg; areaD += seg;
        if (!open) segStart = px;
        open = true; lastX = px;
      });
      close();
      return { d, areaD };
    });

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
    const multiDay = hasDates && n > 1 && fmtDay(rows[0].date) !== fmtDay(rows[n - 1].date);
    const fmtX = (d) => (spanMs > 2 * 86400000 ? fmtDay(d) : multiDay ? `${fmtDay(d)} ${fmtTime(d)}` : fmtTime(d));
    const labelW = spanMs > 2 * 86400000 ? 60 : multiDay ? 100 : 56;
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / labelW))));
    const xLabels = [];
    if (hasDates) for (let i = 0; i < n; i += step) xLabels.push(i);
    if (hasDates && n > 1 && xLabels[xLabels.length - 1] !== n - 1) {
      if (n - 1 - xLabels[xLabels.length - 1] < step / 2) xLabels.pop();
      xLabels.push(n - 1);
    }
    return { n, viewW, contentW, plotW, plotH, lo, hi, x, y, breaks, paths, ticks, xLabels, fmtX, scrollable: contentW > viewW + 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, series.length, width, height, domain?.[0], domain?.[1], limit, minGap]);

  // Open on (and follow) the newest readings.
  const prevN = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && geo.scrollable && geo.n > prevN.current) el.scrollLeft = el.scrollWidth;
    prevN.current = geo.n;
  }, [geo.n, geo.scrollable, geo.contentW]);

  const hasData = rows.some((r) => r.values.some((v) => v != null));
  if (!hasData) {
    return <div ref={box} className="chart-empty" style={{ height }}>{empty}</div>;
  }

  const { n, contentW, plotW, plotH, lo, hi, x, y, breaks, paths, ticks, xLabels, fmtX } = geo;
  const zoned = zones && limit != null && series.length === 1;
  const fracOf = (v) => Math.min(1, Math.max(0, (hi - v) / (hi - lo)));
  const fLimit = zoned ? fracOf(limit) : 0;
  const fBand = zoned ? fracOf(limit - BAND) : 0;
  const levelColor = (v) => (!zoned ? series[0].color
    : v >= limit ? COLORS.stress : v >= limit - BAND ? COLORS.warning : COLORS.normal);

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round(((px - PAD.l) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hv = hover != null ? rows[hover] : null;
  const hvFirst = hv ? hv.values.find((v) => v != null) : null;
  // Limit label sits at the right edge of whatever is currently visible
  // (content end -- the chart opens scrolled to the newest readings).
  const labelX = contentW - PAD.r;

  return (
    <div ref={box} className="chart">
      <div className="chart-row">
        {/* Pinned y-axis */}
        <svg className="chart-axis" width={AXIS_W} height={height}>
          {ticks.map((t, i) => (
            <text key={i} x={AXIS_W - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fontWeight={700} fill={COLORS.textMuted}>
              {fmtNum(t)}
            </text>
          ))}
        </svg>

        <div className={`chart-scroll ${geo.scrollable ? 'can-drag' : ''} ${dragging ? 'dragging' : ''}`} ref={scrollRef}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={endDrag} onMouseLeave={endDrag}>
          <div style={{ position: 'relative', width: contentW }}>
            <svg width={contentW} height={height}
              onPointerMove={(e) => { if (!drag.current?.moved) pick(e); }} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
              <defs>
                {zoned && (
                  <linearGradient id={`z${gid}`} gradientUnits="userSpaceOnUse" x1="0" y1={PAD.t} x2="0" y2={PAD.t + plotH}>
                    <stop offset={0} stopColor={COLORS.stress} />
                    <stop offset={fLimit} stopColor={COLORS.stress} />
                    <stop offset={fLimit} stopColor={COLORS.warning} />
                    <stop offset={fBand} stopColor={COLORS.warning} />
                    <stop offset={fBand} stopColor={COLORS.normal} />
                    <stop offset={1} stopColor={COLORS.normal} />
                  </linearGradient>
                )}
                {series.map((s, si) => (
                  <linearGradient key={si} id={`a${gid}${si}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={zoned ? COLORS.brand : s.color} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={zoned ? COLORS.brand : s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>

              {ticks.map((t, i) => (
                <line key={i} x1={0} x2={contentW} y1={y(t)} y2={y(t)} stroke={COLORS.borderSoft} strokeWidth={1} />
              ))}

              {[...breaks].map((i) => {
                const bx = (x(i) + x(i - 1)) / 2;
                return <line key={i} x1={bx} x2={bx} y1={PAD.t} y2={PAD.t + plotH} stroke={COLORS.border} strokeDasharray="3 4" />;
              })}

              {limit != null && (
                <g>
                  <line x1={0} x2={contentW} y1={y(limit)} y2={y(limit)} stroke={zoned ? COLORS.stress : limitColor} strokeOpacity={0.6} strokeDasharray="5 5" />
                  <text x={labelX} y={y(limit) - 6} textAnchor="end" fontSize={10} fontWeight={800} fill={zoned ? COLORS.stressDark : limitColor}>
                    {limitLabel} · {Math.round(limit)}{suffix}
                  </text>
                </g>
              )}

              {paths.map((p, si) => (
                <g key={si}>
                  {area && series.length === 1 && <path d={p.areaD} fill={`url(#a${gid}${si})`} />}
                  <path d={p.d} fill="none" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round"
                    stroke={zoned ? `url(#z${gid})` : series[si].color} />
                </g>
              ))}

              {/* Every point is visible -- spacing guarantees room for a dot. */}
              {minGap >= 8 && series.map((s, si) => rows.map((r, i) => (r.values[si] == null ? null : (
                <circle key={`${si}-${i}`} cx={x(i)} cy={y(r.values[si])} r={2.5} fill="#fff"
                  stroke={zoned ? levelColor(r.values[si]) : s.color} strokeWidth={1.6} />
              ))))}

              {xLabels.map((i, k) => {
                const anchor = k === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
                const lx = anchor === 'start' ? Math.max(2, x(i) - 4) : anchor === 'end' ? Math.min(contentW - 2, x(i) + 4) : x(i);
                return (
                  <text key={i} x={lx} y={height - 8} textAnchor={anchor} fontSize={10} fontWeight={700} fill={COLORS.textMuted}>
                    {fmtX(rows[i].date)}
                  </text>
                );
              })}

              {hv && (
                <g pointerEvents="none">
                  <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} stroke={COLORS.text} strokeOpacity={0.18} />
                  {series.map((s, si) => (hv.values[si] == null ? null : (
                    <circle key={si} cx={x(hover)} cy={y(hv.values[si])} r={5} fill={zoned ? levelColor(hv.values[si]) : s.color} stroke="#fff" strokeWidth={2} />
                  )))}
                </g>
              )}
            </svg>

            {hv && hvFirst != null && (
              <div className="tip" style={{
                left: Math.min(contentW - 80, Math.max(80, x(hover))),
                top: Math.max(56, y(hvFirst)),
              }}>
                {series.map((s, si) => (hv.values[si] == null ? null : (
                  <div key={si}>
                    {series.length > 1 && <span style={{ color: s.color }}>● </span>}
                    {series.length > 1 ? `${s.name}: ` : ''}{fmtNum(hv.values[si])}{suffix}
                  </div>
                )))}
                {hv.date instanceof Date ? <small>{fmtDay(hv.date)} · {fmtTime(hv.date)}</small> : <small>sample {hover + 1} of {n}</small>}
              </div>
            )}
          </div>
        </div>
      </div>

      {(series.length > 1 || geo.scrollable) && (
        <div className="legend">
          {series.length > 1 && series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
          {geo.scrollable && <span className="muted" style={{ marginLeft: 'auto' }}>← drag or scroll for earlier readings</span>}
        </div>
      )}
    </div>
  );
}

export default memo(Chart);

// Convenience for the common single-series case.
export function toRows(points) {
  return points.map((p) => ({ date: p.date, values: [p.value] }));
}
