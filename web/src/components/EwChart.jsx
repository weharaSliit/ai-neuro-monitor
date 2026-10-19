import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import useElementWidth from '../hooks/useElementWidth';
import { COLORS } from '../lib/levels';

// Stress timeline chart (the early-warning series of mind, body and overall).
// Built like the other charts on the page: the plot is wider than the card when
// there is more history than fits, so it scrolls sideways (drag it, swipe it, or
// use the arrows) while the value axis stays pinned on the left; it opens on the
// newest readings and follows them while you stay at the end. Every reading is a
// point, coloured by its early-warning state, and the three state lanes underneath
// share the same time scale.
const GUTTER = 50;          // pinned left column: value labels and lane names
const RIGHT = 16;
const PAD = { t: 20, b: 34 };
const LANE_H = 26;
const GAP_MS = 6 * 60000;   // no line across a break this long (between sessions, device off)
const MAX_DOTS = 700;

const STATE_DOT = { early_warning: COLORS.warning, high: COLORS.stress, recovering: COLORS.brand };
const LANE_FILL = {
  normal: 'rgba(94,147,90,0.40)', early_warning: COLORS.warning, high: COLORS.stress,
  recovering: 'rgba(110,104,178,0.65)', limited: '#CFC9BC', calibrating: '#DDD8CC',
};
const LANE_TEXT = { normal: 'Normal', early_warning: 'Early warning', high: 'High', recovering: 'Recovering', limited: 'Limited', calibrating: 'Calibrating' };

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const clockS = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Round clock ticks: the smallest step that keeps the labels at least ~90 px apart.
function timeTicks(x0, x1, count) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720].map((m) => m * 60000);
  const step = steps.find((s) => (x1 - x0) / s <= count) || steps[steps.length - 1];
  const out = [];
  for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) out.push(t);
  return out;
}

// points: [{ x, <key>, <key>_s }] (value and, optionally, the state of that reading).
export default function EwChart({
  points, series, lanes = [], domain, yFormat = (v) => v.toFixed(2), height = 300, bands = [], hbands = [],
  refLines = [], markers = [], ariaLabel,
}) {
  const [box, width] = useElementWidth();
  const scroller = useRef(null);
  const atEnd = useRef(true);
  const drag = useRef(null);
  const [follow, setFollow] = useState(true);      // at the newest readings (hides the "Latest" button)
  const [grabbing, setGrabbing] = useState(false);
  const [mins, setMins] = useState(30);            // minutes that fit across the visible width, or 'all'
  const [hover, setHover] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const compact = width < 520;
  const h = compact ? Math.min(height, 250) : height;
  const innerH = h - PAD.t - PAD.b;
  const visibleW = Math.max(160, width - GUTTER);              // the scrolling viewport
  const innerW = Math.max(120, visibleW - RIGHT);              // one "screen" of plot
  const [x0, x1] = domain || [0, 1];
  const span = Math.max(1, x1 - x0);
  const pxPerMs = mins === 'all' ? innerW / span : innerW / (mins * 60000);
  const plotW = Math.max(innerW, span * pxPerMs);
  const svgW = plotW + RIGHT;
  const sx = (x) => (x - x0) * pxPerMs;
  const sy = (y) => PAD.t + (1 - Math.min(1, Math.max(0, y))) * innerH;
  const shown = series.filter((s) => !hidden.has(s.key));

  // Open on, and keep following, the newest readings while the person is at the end.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atEnd.current) el.scrollLeft = el.scrollWidth;
  }, [svgW, mins, x1]);
  const onScroll = () => {
    const el = scroller.current; if (!el) return;
    const end = el.scrollWidth - el.scrollLeft - el.clientWidth < 10;
    atEnd.current = end; setFollow(end);
    setHover(null);
  };
  const toEnd = () => { const el = scroller.current; if (el) { atEnd.current = true; el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' }); } };
  const stepBy = (dir) => { const el = scroller.current; if (el) el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: 'smooth' }); };
  const setZoom = (m) => { atEnd.current = true; setMins(m); };

  const paths = useMemo(() => shown.map((s) => {
    let d = ''; let pen = false; let prevX = null;
    for (const p of points) {
      const v = p[s.key];
      if (v === undefined) continue;                     // another series' reading: skip, not a gap
      if (v == null) { pen = false; continue; }
      if (prevX != null && p.x - prevX > GAP_MS) pen = false;
      prevX = p.x;
      d += `${pen ? 'L' : 'M'}${((p.x - x0) * pxPerMs).toFixed(1)},${(PAD.t + (1 - Math.min(1, Math.max(0, v))) * innerH).toFixed(1)}`;
      pen = true;
    }
    return { ...s, d };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points, shown.length, x0, pxPerMs, innerH]);

  const dots = useMemo(() => {
    if (points.length > MAX_DOTS * Math.max(1, shown.length)) return [];
    const out = [];
    for (const s of shown) {
      for (const p of points) {
        const v = p[s.key];
        if (v == null) continue;
        out.push({ k: `${s.key}-${p.x}`, x: p.x, v, c: STATE_DOT[p[`${s.key}_s`]] || s.color, r: s.key === 'fused' ? 3.6 : 3 });
      }
    }
    return out;
  }, [points, shown]);

  const onMove = (e) => {
    if (drag.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xv = x0 + (e.clientX - rect.left) / pxPerMs;
    let best = null; let bd = Infinity;
    for (const p of points) { const d = Math.abs(p.x - xv); if (d < bd) { bd = d; best = p; } }
    setHover(best);
  };
  // Mouse drag scrolls like the other charts; touch scrolls natively.
  const onDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !scroller.current) return;
    drag.current = { x: e.clientX, left: scroller.current.scrollLeft };
    setGrabbing(true); setHover(null);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  };
  const onDrag = (e) => {
    if (!drag.current) return;
    scroller.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
  };
  const endDrag = () => { drag.current = null; setGrabbing(false); };

  const xt = timeTicks(x0, x1, Math.max(2, Math.floor(plotW / 90)));
  const yt = [0, 0.25, 0.5, 0.75, 1];
  const fmtX = span < 20 * 60000 ? clockS : clock;
  const laneH = LANE_H * lanes.length;
  const hx = hover ? sx(hover.x) : null;
  const scrollLeft = scroller.current?.scrollLeft || 0;

  return (
    <div ref={box} className="ew-chart">
      <div className="ew-bar">
        <div className="ew-legend" role="group" aria-label="Lines">
          {series.map((s) => (
            <button key={s.key} type="button" className={hidden.has(s.key) ? 'off' : ''} aria-pressed={!hidden.has(s.key)}
              onClick={() => setHidden((o) => { const n = new Set(o); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n; })}>
              <i style={{ background: s.color }} />{s.label}
            </button>
          ))}
          <span className="ew-zone"><i className="dash" />Limit</span>
          {hbands.length > 0 && <span className="ew-zone"><i />Early-warning zone</span>}
        </div>
        <div className="ew-zoom">
          <button type="button" className="btn ghost sm" onClick={() => stepBy(-1)} aria-label="Earlier">◀</button>
          <button type="button" className="btn ghost sm" onClick={() => stepBy(1)} disabled={follow} aria-label="Later">▶</button>
          {[10, 30, 60].map((m) => <button key={m} type="button" className={`btn sm ${mins === m ? '' : 'ghost'}`} onClick={() => setZoom(m)}>{m} min</button>)}
          <button type="button" className={`btn sm ${mins === 'all' ? '' : 'ghost'}`} onClick={() => setZoom('all')}>All</button>
          {!follow && <button type="button" className="btn sm" onClick={toEnd}>Latest</button>}
        </div>
      </div>

      <div className="ew-body" style={{ position: 'relative' }}>
        {/* pinned value axis + lane names */}
        <div className="ew-axis" style={{ width: GUTTER }}>
          <svg width={GUTTER} height={h} aria-hidden="true">
            {yt.map((t) => <text key={t} x={GUTTER - 8} y={sy(t)} dy="0.34em" textAnchor="end" className="ew-tick">{yFormat(t)}</text>)}
          </svg>
          {lanes.length > 0 && (
            <svg width={GUTTER} height={laneH + 6} aria-hidden="true">
              {lanes.map((ln, i) => <text key={ln.key} x={GUTTER - 8} y={i * LANE_H + 17} textAnchor="end" className="ew-tick">{ln.label}</text>)}
            </svg>
          )}
        </div>

        <div className={`ew-scroll ${grabbing ? 'grabbing' : ''}`} ref={scroller} onScroll={onScroll}
          onPointerDown={onDown} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <svg width={svgW} height={h} role="img" aria-label={ariaLabel} className="ew-svg"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {bands.map((b, i) => {
              const a = sx(Math.max(b.x0, x0)); const z = sx(Math.min(b.x1, x1));
              return z > a ? <rect key={`b${i}`} x={a} y={PAD.t} width={z - a} height={innerH} fill="#EAE5DA" fillOpacity="0.55" /> : null;
            })}
            {hbands.map((hb, i) => (
              <rect key={`h${i}`} x={0} y={sy(hb.y1)} width={plotW} height={Math.max(0, sy(hb.y0) - sy(hb.y1))} fill={COLORS.warning} fillOpacity="0.13" />
            ))}
            {yt.map((t) => <line key={t} x1={0} x2={plotW} y1={sy(t)} y2={sy(t)} stroke={COLORS.borderSoft} />)}
            {xt.map((t) => (
              <g key={t}>
                <line x1={sx(t)} x2={sx(t)} y1={PAD.t + innerH} y2={PAD.t + innerH + 4} stroke={COLORS.border} />
                <text x={sx(t)} y={h - 10} textAnchor="middle" className="ew-tick">{clock(t)}</text>
              </g>
            ))}
            <line x1={0} x2={plotW} y1={PAD.t + innerH} y2={PAD.t + innerH} stroke={COLORS.border} />
            {refLines.map((r) => (
              <line key={r.label} x1={0} x2={plotW} y1={sy(r.y)} y2={sy(r.y)} stroke={COLORS.textSub} strokeWidth="1.2" strokeDasharray="5 4" strokeOpacity="0.85" />
            ))}
            {paths.map((p) => (
              <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={p.key === 'fused' ? 2 : 1.5} strokeOpacity="0.55" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {dots.map((d) => <circle key={d.k} cx={sx(d.x)} cy={sy(d.v)} r={d.r} fill={d.c} stroke="#fff" strokeWidth="1.2" />)}
            {markers.map((m, i) => (
              <text key={i} x={sx(m.x)} y={sy(m.y)} dy="0.35em" textAnchor="middle" className="ew-marker" fill={m.color}><title>{m.title}</title>{m.glyph}</text>
            ))}
            {hover && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={PAD.t} y2={PAD.t + innerH} stroke={COLORS.textMuted} />
                {shown.map((s) => (hover[s.key] != null ? <circle key={s.key} cx={hx} cy={sy(hover[s.key])} r="5.5" fill={s.color} stroke="#fff" strokeWidth="2" /> : null))}
              </g>
            )}
          </svg>

          {lanes.length > 0 && (
            <svg width={svgW} height={laneH + 6} role="img" aria-label="State over time per line" className="ew-lanes">
              {lanes.map((ln, i) => (
                <g key={ln.key}>
                  {ln.rows.map((r, j) => {
                    const t1 = Math.min(ln.rows[j + 1]?.t ?? r.t + 25000, r.t + 60000);
                    return (
                      <rect key={r.t} x={sx(r.t)} y={i * LANE_H + 4} width={Math.max(2.5, sx(t1) - sx(r.t))} height={LANE_H - 8} rx="2"
                        fill={LANE_FILL[r.state] || LANE_FILL.limited}>
                        <title>{`${ln.label} ${clockS(r.t)}: ${LANE_TEXT[r.state] || r.state}${r.value != null ? ` (${r.value.toFixed(2)})` : ''}`}</title>
                      </rect>
                    );
                  })}
                </g>
              ))}
            </svg>
          )}
        </div>

        {hover && (
          <div className="ew-tip" style={{ left: Math.min(Math.max(GUTTER + (hx - scrollLeft) + 12, GUTTER), Math.max(GUTTER, width - 190)) }}>
            <b>{fmtX(hover.x)}</b>
            {shown.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />{s.label}
                <em>{hover[s.key] == null ? '—' : yFormat(hover[s.key])}{hover[`${s.key}_s`] && hover[`${s.key}_s`] !== 'normal' ? ` · ${LANE_TEXT[hover[`${s.key}_s`]] || ''}` : ''}</em>
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="ew-key">
        {[['normal', 'Normal'], ['early_warning', 'Early warning'], ['high', 'High'], ['recovering', 'Recovering'], ['calibrating', 'Calibrating']].map(([k, l]) => (
          <span key={k}><i style={{ background: LANE_FILL[k] }} />{l}</span>
        ))}
      </p>
    </div>
  );
}
