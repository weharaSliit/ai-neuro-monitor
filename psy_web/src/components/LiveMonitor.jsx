import { useEffect, useRef, useState } from 'react';
import { MultiLineChart } from './charts';
import { Card, Status } from './panels';
import TechNav from './TechNav';
import { useFusionPicker } from '../hooks/useFusion';
import { mmss } from '../hooks/useStimulator';
import useMonitorSeries from '../hooks/useMonitorSeries';
import { STATE_TEXT, theilSen } from '../lib/earlyWarning';
import { QUADRANTS, fusedQuadrant } from '../lib/simDemo';

// Live monitor (#concept): the concept on one page, for the real devices and
// the live stimulator alike. Mind (EEG cognitive load) and body (HRV/GSR
// autonomic arousal) are each judged against the user's OWN calibrated limit
// (0.50 on the shared scale); the fused value combines them. Each moves through
//   normal -> early warning (trending towards its limit) -> high (2 of the last
//   3 above it) -> recovering (back below, settling) -> normal,
// and mind x body gives the user's state. Simulated sessions add the ground
// truth (what the virtual person was doing) and a scorecard against it.
export const C = { mind: 'var(--c1)', body: 'var(--c2)', fused: 'var(--c7)', truth: 'var(--c4)' };
const CLS = { normal: 'ok', early_warning: 'warn', high: 'high', recovering: 'rec', limited: 'lim', calibrating: 'lim' };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const clockS = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const PHASE = {
  settle: 'Calibration · settle', rest: 'Calibration · resting baseline', task: 'Calibration · high-load task', recovery: 'Recovery',
  calm: 'Calm', ramp: 'Load rising', demand: 'High load', plateau: 'Moderate load',
  relaxed: 'Relaxed', mental: 'High mental load (body calm)', arousal: 'Physical arousal (mind calm)', stress: 'Stress (mind + body)',
};

// Direction of the last few readings: rising / falling / steady.
function trendOf(rows) {
  const r = rows.filter((x) => x.value != null).slice(-6);
  if (r.length < 3) return null;
  const s = theilSen(r.map((_, i) => i), r.map((x) => x.value));
  return s > 0.012 ? 'rising' : s < -0.012 ? 'falling' : 'steady';
}

// The early-warning label of a component: what its detector says now.
const EW_LABEL = {
  early_warning: ['ew-warn', '▲ EARLY WARNING', 'trending up towards its limit'],
  high: ['ew-high', '▼ HIGH', 'above its limit (2 of the last 3)'],
  recovering: ['ew-rec', '↘ RECOVERING', 'back below its limit, settling'],
  normal: ['ew-ok', '✓ NO WARNING', 'calm, below its limit'],
  limited: ['ew-off', 'EARLY WARNING OFF', 'only "high" is reported until recalibrated'],
  calibrating: ['ew-off', 'CALIBRATING', 'no warnings yet'],
};

export function StateCard({ title, color, row, rows, note }) {
  const st = row?.state || 'calibrating';
  const trend = st === 'calibrating' ? null : trendOf(rows);
  const [cls, label] = EW_LABEL[st] || EW_LABEL.calibrating;
  return (
    <div className={`sd-card sd-${CLS[st] || 'ok'}`} style={{ borderTopColor: color }}>
      <span className="sd-card-title">{title}</span>
      <div className="lm-value">
        <span className="sd-card-value">{row?.value == null ? '—' : row.value.toFixed(2)}</span>
        {trend && <span className={`lm-trend ${trend}`}>{trend === 'rising' ? '↗ rising' : trend === 'falling' ? '↘ falling' : '→ steady'}</span>}
      </div>
      <div className={`lm-ew ${cls}`}><b>{label}</b></div>
      {note && <span className="sd-card-note">{note}</span>}
    </div>
  );
}

function Quadrant({ q, mind, body }) {
  const x = mind == null ? null : Math.max(0.03, Math.min(0.97, mind));
  const y = body == null ? null : Math.max(0.03, Math.min(0.97, body));
  return (
    <div className="cq">
      <div className="cq-grid">
        {['arousal', 'stress', 'relaxed', 'mental'].map((k) => (
          <div key={k} className={`cq-cell cq-${k} ${q?.key === k ? 'on' : ''}`}>
            <b>{QUADRANTS[k].label}</b>
          </div>
        ))}
        {x != null && <i className="cq-dot" style={{ left: `${x * 100}%`, top: `${(1 - (y ?? 0.25)) * 100}%` }} title="mind / body now" />}
      </div>
      <div className="cq-axes"><span>Mind →</span><span>Body ↑</span></div>
    </div>
  );
}

// One lane per component, coloured by state over time.
// Same left gutter (52 px) and right padding (14 px) as the chart above (charts.jsx PAD), and its
// real pixel width, so every lane lines up with the x axis instead of being scaled separately.
const CHART_LEFT = 52; const CHART_RIGHT = 58;
export function StateLanes({ series, xDomain }) {
  const box = useRef(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    if (!box.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const lh = 26;
  const span = (xDomain[1] - xDomain[0]) || 1;
  const sx = (t) => CHART_LEFT + ((t - xDomain[0]) / span) * (W - CHART_LEFT - CHART_RIGHT);
  const lanes = [['mind', 'Mind'], ['body', 'Body'], ['fused', 'Fused']];
  return (
    <div ref={box}>
    <svg width={W} height={lanes.length * lh + 6} className="lm-lanes" role="img" aria-label="State over time per component">
      {lanes.map(([k, label], i) => {
        const rows = series[k].filter((r) => r.t >= xDomain[0] && r.t <= xDomain[1]);
        return (
          <g key={k}>
            <text x={CHART_LEFT - 8} y={i * lh + 17} textAnchor="end" className="tick">{label}</text>
            {rows.map((r, j) => {
              const t1 = Math.min(rows[j + 1]?.t ?? r.t + 25000, r.t + 60000);
              return <rect key={r.t} x={sx(r.t)} y={i * lh + 4} width={Math.max(2, sx(Math.min(t1, xDomain[1])) - sx(r.t))} height={lh - 8} rx="2"
                className={`lane-${r.state}`}><title>{`${label} ${clockS(r.t)}: ${STATE_TEXT[r.state] || r.state}${r.value != null ? ` (${r.value.toFixed(2)})` : ''}`}</title></rect>;
            })}
          </g>
        );
      })}
    </svg>
    </div>
  );
}

// Mind, body and fused on the shared 0-1 scale (0.50 = each one's own limit), with the
// early-warning zone, ▲ warning / ▼ high markers and a state lane per component.
export function StressChart({ series, gate, fusedCal, params, xDomain, xFormat, onPan, height = 300 }) {
  // overlapping calibration windows merged into one band, labelled once (only when wide enough to read)
  const merged = [];
  if (xDomain) {
    for (const [a, c] of gate.blank.map(([a0, c0]) => [Math.max(a0, xDomain[0]), Math.min(c0, xDomain[1])]).filter(([a0, c0]) => c0 > a0).sort((p, q) => p[0] - q[0])) {
      const top = merged[merged.length - 1];
      if (top && a <= top[1]) top[1] = Math.max(top[1], c); else merged.push([a, c]);
    }
  }
  const span = xDomain ? (xDomain[1] - xDomain[0]) || 1 : 1;
  const bands = merged.map(([a, c]) => ({ x0: a, x1: c, label: (c - a) / span > 0.08 ? 'calibrating' : '', kind: 'n' }));
  const pts = [...series.mind.map((r) => ({ x: r.t, mind: r.value ?? null })), ...series.body.map((r) => ({ x: r.t, body: r.value })),
    ...series.fused.map((r) => ({ x: r.t, fused: r.value }))].sort((a, c) => a.x - c.x);
  const markers = [
    ...['mind', 'body', 'fused'].flatMap((k) => series[k].filter((r, i, a) => r.state === 'early_warning' && a[i - 1]?.state !== 'early_warning')
      .map((r) => ({ x: r.t, y: Math.min(0.96, (r.value ?? 0.5) + 0.07), glyph: '▲', color: 'var(--warning)', title: `${k} early warning ${clockS(r.t)}` }))),
    ...['mind', 'body', 'fused'].flatMap((k) => series[k].filter((r, i, a) => r.high && !a[i - 1]?.high)
      .map((r) => ({ x: r.t, y: Math.min(0.99, (r.value ?? 0.5) + 0.07), glyph: '▼', color: 'var(--critical)', title: `${k} high ${clockS(r.t)}` }))),
  ];
  const ewBand = fusedCal ? [fusedCal.baseline + params.bufferSpreads * Math.max(0.05, fusedCal.spread), 0.5] : null;
  if (!xDomain) return <div className="chart-empty" style={{ height: height - 40 }}>No readings for this session yet.</div>;
  return (
    <>
      <MultiLineChart points={pts} height={height} yDomain={[0, 1]} xDomain={xDomain} xFormat={xFormat} onPan={onPan} yFormat={(v) => v.toFixed(2)}
        bands={bands} markers={markers} ariaLabel="Mind, body and fused over time"
        hbands={ewBand ? [{ y0: ewBand[0], y1: ewBand[1], color: 'var(--warning)', opacity: 0.12 }] : []}
        refLines={[{ y: 0.5, label: 'limit' }, ...(fusedCal ? [{ y: fusedCal.baseline, label: 'calm' }] : [])]}
        series={[{ key: 'mind', label: 'Mind', color: C.mind, width: 2, connect: true, dots: true },
          { key: 'body', label: 'Body', color: C.body, width: 2, connect: true, dots: true },
          { key: 'fused', label: 'Fused', color: C.fused, width: 3, connect: true, dots: true }]} />
      <StateLanes series={series} xDomain={xDomain} />
      <p className="caption lm-legend">
        <i className="lane-normal" /> normal <i className="lane-early_warning" /> early warning
        <i className="lane-high" /> high <i className="lane-recovering" /> recovering
        <i className="lane-calibrating" /> calibrating · <span className="lm-zonekey" /> early-warning zone
      </p>
    </>
  );
}

export default function LiveMonitor({ now, go }) {
  const picker = useFusionPicker();
  const uid = picker.userId; const sid = picker.sessionId;
  const mon = useMonitorSeries(uid, sid, now);
  const { stim, st, eeg, ring, recalReq, ringBase, fusedCal, params, gate, series, simulated, simHere } = mon;
  const [zoom, setZoom] = useState(null);
  const { mind: m, body: b, fused: f } = mon.now;
  const deciding = !gate.paused && !gate.recalibrating && (m || b) && [m, b].some((r) => r && r.state !== 'calibrating');
  const q = deciding ? fusedQuadrant(m && m.state !== 'calibrating' ? m.high : null, b && b.state !== 'calibrating' ? b.high : null) : null;

  // one time axis for every chart; drag to zoom, double-click to reset
  const xs = [...series.mind, ...series.body, ...series.fused].map((r) => r.t).concat(stim.timeline.map((p) => p.t));
  const full = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : null;
  const xDomain = zoom && full ? [Math.max(zoom[0], full[0]), Math.min(zoom[1], full[1])] : full;
  // Move through time: dt in ms (drag the chart or the arrows); null = back to everything.
  const pan = (dt) => {
    if (!full) return;
    if (dt == null) { setZoom(null); return; }
    const cur = xDomain || full; const span = cur[1] - cur[0];
    let a = cur[0] + dt; let c = cur[1] + dt;
    if (a < full[0]) { a = full[0]; c = a + span; }
    if (c > full[1]) { c = full[1]; a = c - span; }
    setZoom(a <= full[0] + 1 && c >= full[1] - 1 ? null : [a, c]);
  };
  const stepBy = (dir) => full && zoom && pan(dir * (zoom[1] - zoom[0]) / 2);
  const lastMin = (min) => full && setZoom([Math.max(full[0], full[1] - min * 60000), full[1]]);
  const fmtX = zoom ? clockS : clock;

  const curPhase = st?.phase || (st?.stage || '').replace('live: ', '');
  const lastEeg = eeg.blocks[eeg.blocks.length - 1];
  const lastRing = ring.windows[ring.windows.length - 1];
  const fresh = (ms) => ms != null && now - ms < 90000;

  return (
    <div className="page lm-page">
      <TechNav page="concept" go={go} picker={picker} title="Live monitor"
        subtitle="Mind, body and overall, each against the user's own limit." />

      {/* source: real devices or the live stimulator */}
      <div className={`sd-head lm-source ${simulated ? 'sim' : 'real'}`}>
        {simulated ? <span className="stim-badge">SIMULATED</span> : <span className="real-badge">REAL DEVICES</span>}
        {simHere ? (
          <span><b>{PHASE[curPhase] || curPhase.replace(/_/g, ' ')}</b>{st.phase_left != null ? ` · ${mmss(st.phase_left)} left` : ''}
            <span className="muted"> · {st.profile} · {st.scenario?.replace(/_/g, ' ')}</span></span>
        ) : simulated ? <span className="muted">Simulated session (the stimulator is not streaming to it right now).</span>
          : <span className="muted">Headband and ring readings, no ground truth.</span>}
        <span className="sd-dev">
          <i className={fresh(lastEeg?.timestamp_end * 1000) ? 'dot on' : 'dot'} /> headband {lastEeg?.timestamp_end ? clockS(lastEeg.timestamp_end * 1000) : '—'}
          {' · '}<i className={fresh(lastRing?.t) ? 'dot on' : 'dot'} /> ring {lastRing?.t ? clockS(lastRing.t) : '—'}
        </span>
      </div>

      {gate.paused ? <p className="sd-gate">⏳ <b>Not calibrated yet.</b> Decisions start once the calibration is done (Calibration tab).</p>
        : gate.recalibrating ? <p className="sd-gate">⏳ <b>Recalibrating as asked</b>{recalReq?.phase ? ` (${recalReq.phase}${recalReq.blocks_needed ? ` ${recalReq.blocks_captured ?? 0}/${recalReq.blocks_needed}` : ''})` : ''}. Earlier readings keep their states; new decisions resume when it finishes.</p>
          : <p className="sd-gate ok">✓ Calibrated{gate.startMs ? ` ${clock(gate.startMs)}` : ''}. Every decision uses this user&apos;s own baseline and limit until they recalibrate.</p>}

      {/* now: three components + the user's state */}
      <div className="cd-top">
        <div className="cd-cards">
          <StateCard title="MIND · EEG" color={C.mind} row={m} rows={series.mind} />
          <StateCard title="BODY · HRV + GSR" color={C.body} row={b} rows={series.body}
            note={!b && ringBase === null ? 'no ring baseline yet' : null} />
          <StateCard title="FUSED · mind + body" color={C.fused} row={f} rows={series.fused} />
        </div>
        <Card title="User's state" subtitle={q ? `${q.label}${q.partial ? ` (${q.partial})` : ''}` : 'after calibration'}
          right={deciding && f?.mindLed ? <Status kind="warning">mind-led: body still calm</Status> : null}>
          <Quadrant q={q} mind={deciding ? m?.value : null} body={deciding ? b?.value : null} />
        </Card>
      </div>

      {/* the timeline */}
      <Card title="Stress timeline"
        right={(
          <div className="cd-zoom">
            <button type="button" className="btn ghost" onClick={() => stepBy(-1)} disabled={!zoom} aria-label="Earlier">◀</button>
            <button type="button" className="btn ghost" onClick={() => stepBy(1)} disabled={!zoom || (full && zoom[1] >= full[1] - 1)} aria-label="Later">▶</button>
            {[10, 30, 60].map((mn) => <button key={mn} type="button" className="btn ghost" onClick={() => lastMin(mn)} disabled={!full}>{mn} min</button>)}
            <button type="button" className="btn ghost" onClick={() => setZoom(null)} disabled={!zoom}>All</button>
          </div>
        )}>
        <StressChart series={series} gate={gate} fusedCal={fusedCal} params={params} xDomain={xDomain} xFormat={fmtX} onPan={pan} />
      </Card>
    </div>
  );
}
