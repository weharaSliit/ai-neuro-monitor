import { useMemo } from 'react';
import { Badge, Card, CardHead } from './ui';
import EwChart from './EwChart';
import { COLORS } from '../lib/levels';
import { QUADRANTS, fusedQuadrant, gateSeries } from '../lib/condition';
import { EW_LABEL, EW_PARAMS, bodyCalibration, buildSeries, fusedCalibration, trendOf } from '../lib/ewSeries';

// "Early warning": the same set as psy_web's Live monitor, for the person's own
// readings. Mind (EEG), body (HRV + GSR) and the fused value are each judged
// against the person's OWN calibrated limit (0.50 on the shared scale) and move
//   normal -> early warning -> high -> recovering -> normal;
// mind x body gives the state. Readings recorded before the first calibration or
// during an asked-for recalibration get no decision.

// Ring window times: ISO with an offset, or a naive time written by the ring
// service's host (UTC on Render, local on a laptop) -- keep the reading that is
// closest to "now" without being ahead of it (same rule as psy_web lib/ring parseNaive).
function ringMs(iso, now) {
  if (!iso) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) return Date.parse(iso);
  const utc = Date.parse(`${iso}Z`); const local = Date.parse(iso);
  const c = [utc, local].filter((t) => Number.isFinite(t) && t <= now + 60000);
  return c.length ? Math.max(...c) : (Number.isFinite(utc) ? utc : null);
}

const COLOR = { mind: COLORS.eeg, body: COLORS.hrv, fused: COLORS.brand };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const last = (rows) => [...rows].reverse().find((r) => r.value != null) || null;

// "12 min ago" / "3 h ago" for a reading that is not live any more.
const ago = (ms, now) => {
  const m = Math.round((now - ms) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function StateCard({ title, color, row, rows, old }) {
  const st = row?.state || 'calibrating';
  const trend = st === 'calibrating' || old ? null : trendOf(rows);
  const [cls, label] = EW_LABEL[st] || EW_LABEL.calibrating;
  return (
    <div className="ew-card" style={{ borderTopColor: color }}>
      <span className="ew-card-title">{title}</span>
      <div className="ew-value">
        <b>{row?.value == null ? '—' : row.value.toFixed(2)}</b>
        {old ? <span className="ew-trend">{old}</span>
          : trend && <span className={`ew-trend ${trend}`}>{trend === 'rising' ? '↗ rising' : trend === 'falling' ? '↘ falling' : '→ steady'}</span>}
      </div>
      <div className={`ew-state ${cls}`}><b>{cls === 'ok' ? '✓ ' : cls === 'warn' ? '▲ ' : cls === 'high' ? '▼ ' : cls === 'rec' ? '↘ ' : ''}{label}</b></div>
    </div>
  );
}

function Quadrant({ q, mind, body }) {
  const x = mind == null ? null : Math.max(0.04, Math.min(0.96, mind));
  const y = body == null ? null : Math.max(0.04, Math.min(0.96, body));
  return (
    <div className="ew-quad">
      <div className="ew-quad-grid">
        {['arousal', 'stress', 'relaxed', 'mental'].map((k) => (
          <div key={k} className={`ew-cell ${k} ${q?.key === k ? 'on' : ''}`}><b>{QUADRANTS[k].label}</b></div>
        ))}
        {x != null && <i className="ew-dot" style={{ left: `${x * 100}%`, top: `${(1 - (y ?? 0.25)) * 100}%` }} title="Mind and body now" />}
      </div>
      <div className="ew-quad-axes"><span>Mind →</span><span>Body ↑</span></div>
    </div>
  );
}

export function useEwSeries({ cond, eegBlocks, ringWindows, fusionRows, now }) {
  const { eegInfo, ringInfo, phases, gate } = cond;

  const { series, fusedCal } = useMemo(() => {
    const fusedCal = fusedCalibration(phases);
    const bodyCal = bodyCalibration(phases);
    const rw = (ringWindows || []).map((w) => ({ ...w, t: ringMs(w.timestamp, now) })).filter((w) => w.t);
    const fw = (fusionRows || []).map((r) => ({ ...r.w, key: r.key }));
    const built = buildSeries({
      blocks: eegBlocks || [], eegInfo, ringWindows: rw, ringInfo, fusionWindows: fw, fusedCal, bodyCal,
      ringBaseAt: cond.ringBaselineAt, params: EW_PARAMS, nowMs: now,
    });
    return { series: gateSeries(built, gate), fusedCal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eegBlocks, ringWindows, fusionRows, eegInfo, ringInfo, phases, gate, cond.ringBaselineAt, Math.floor(now / 10000)]);

  // The newest reading of each line; when it is older than 3 minutes the card says how long ago it was.
  const m = last(series.mind); const b = last(series.body); const f = last(series.fused);
  const oldTag = (r) => (r && now - r.t > 3 * 60000 ? ago(r.t, now) : null);
  const calibrating = gate.paused || gate.recalibrating;
  const deciding = !calibrating && (m || b) && [m, b].some((r) => r && r.state !== 'calibrating');
  const q = deciding ? fusedQuadrant(m && m.state !== 'calibrating' ? m.high : null, b && b.state !== 'calibrating' ? b.high : null) : null;

  // One time axis for the chart and the lanes.
  const xs = [...series.mind, ...series.body, ...series.fused].map((r) => r.t);
  const full = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : null;
  const pts = useMemo(() => [
    ...series.mind.map((r) => ({ x: r.t, mind: r.value ?? null, mind_s: r.state })),
    ...series.body.map((r) => ({ x: r.t, body: r.value, body_s: r.state })),
    ...series.fused.map((r) => ({ x: r.t, fused: r.value, fused_s: r.state })),
  ].sort((a, c) => a.x - c.x), [series]);
  const markers = useMemo(() => ['mind', 'body', 'fused'].flatMap((k) => [
    ...series[k].filter((r, i, a) => r.state === 'early_warning' && a[i - 1]?.state !== 'early_warning')
      .map((r) => ({ x: r.t, y: Math.min(0.95, (r.value ?? 0.5) + 0.07), glyph: '▲', color: COLORS.warningDark, title: `${k} early warning ${clock(r.t)}` })),
    ...series[k].filter((r, i, a) => r.high && !a[i - 1]?.high)
      .map((r) => ({ x: r.t, y: Math.min(0.98, (r.value ?? 0.5) + 0.07), glyph: '▼', color: COLORS.stress, title: `${k} high ${clock(r.t)}` })),
  ]), [series]);
  const zone = fusedCal ? [Math.min(0.5, fusedCal.baseline + EW_PARAMS.bufferSpreads * Math.max(0.05, fusedCal.spread)), 0.5] : null;

  return { series, fusedCal, m, b, f, oldTag, q, deciding, full, pts, markers, zone, gate };
}

export function StressStatistics({ ew, children }) {
  const { series, m, b, f, oldTag, q, deciding, gate } = ew;
  return (
    <Card>
      <CardHead
        title="Stress statistics"
        right={gate.paused ? <Badge color={COLORS.textMuted}>Not calibrated yet</Badge>
          : gate.recalibrating ? <Badge color={COLORS.warning} dot>Recalibrating</Badge>
            : <Badge color={COLORS.normal} dot>Calibrated{gate.startMs ? ` ${clock(gate.startMs)}` : ''}</Badge>}
      />
      <div className="ew-top stacked">
        <div className="ew-cards">
          <StateCard title="Mind" color={COLOR.mind} row={m} rows={series.mind} old={oldTag(m)} />
          <StateCard title="Body" color={COLOR.body} row={b} rows={series.body} old={oldTag(b)} />
          <StateCard title="Overall" color={COLOR.fused} row={f} rows={series.fused} old={oldTag(f)} />
        </div>
        <div className="ew-state-box">
          <div className="ew-state-head">
            <b>Your state</b>
            <span>{q ? q.label : '—'}</span>
          </div>
          <Quadrant q={q} mind={deciding ? m?.value : null} body={deciding ? b?.value : null} />
        </div>
      </div>
      {children}
    </Card>
  );
}

export function StressTimeline({ ew }) {
  const { series, full, pts, markers, zone, gate } = ew;
  return (
      <Card>
      <CardHead title="Stress timeline" />
      {!full ? <p className="body" style={{ padding: '36px 0', textAlign: 'center' }}>No readings for this session yet.</p> : (
        <EwChart
          points={pts} domain={full}
          hbands={zone ? [{ y0: zone[0], y1: zone[1] }] : []}
          bands={(gate.blank || []).filter(([a, c]) => c > full[0] && a < full[1]).map(([a, c]) => ({ x0: a, x1: c }))}
          refLines={[{ y: 0.5, label: 'Limit' }]} markers={markers} ariaLabel="Mind, body and overall over time"
          series={[{ key: 'mind', label: 'Mind', color: COLOR.mind, width: 2.2 }, { key: 'body', label: 'Body', color: COLOR.body, width: 2.2 },
            { key: 'fused', label: 'Overall', color: COLOR.fused, width: 3.2 }]}
          lanes={[{ key: 'mind', label: 'Mind', rows: series.mind }, { key: 'body', label: 'Body', rows: series.body }, { key: 'fused', label: 'Overall', rows: series.fused }]}
        />
      )}
    </Card>
  );
}
