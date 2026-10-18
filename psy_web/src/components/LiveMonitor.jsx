import { useMemo, useState } from 'react';
import { MultiLineChart } from './charts';
import { Card, Status } from './panels';
import TechNav from './TechNav';
import { useFirebaseValue, useSessionData } from '../hooks/useData';
import { usePhysioData } from '../hooks/usePhysio';
import { useFusionData, useFusionPicker } from '../hooks/useFusion';
import useEegCalibrations from '../hooks/useEegCalibrations';
import { mmss, useStimulator } from '../hooks/useStimulator';
import { calibratedLimits } from '../lib/limits';
import { STATE_TEXT, theilSen } from '../lib/earlyWarning';
import {
  EW_SETS, QUADRANTS, buildSeries, decisionGate, eventLog, fusedQuadrant, gateSeries, periodsFrom, phaseBands, phaseCheck,
} from '../lib/simDemo';

// Live monitor (#concept): the concept on one page, for the real devices and
// the live stimulator alike. Mind (EEG cognitive load) and body (HRV/GSR
// autonomic arousal) are each judged against the user's OWN calibrated limit
// (0.50 on the shared scale); the fused value combines them. Each moves through
//   normal -> early warning (trending towards its limit) -> high (2 of the last
//   3 above it) -> recovering (back below, settling) -> normal,
// and mind x body gives the user's state. Simulated sessions add the ground
// truth (what the virtual person was doing) and a scorecard against it.
const C = { mind: 'var(--c1)', body: 'var(--c2)', fused: 'var(--c7)', truth: 'var(--c4)' };
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

function StateCard({ title, color, row, rows, note }) {
  const st = row?.state || 'calibrating';
  const trend = st === 'calibrating' ? null : trendOf(rows);
  const [cls, label, text] = EW_LABEL[st] || EW_LABEL.calibrating;
  return (
    <div className={`sd-card sd-${CLS[st] || 'ok'}`} style={{ borderTopColor: color }}>
      <span className="sd-card-title">{title}</span>
      <div className="lm-value">
        <span className="sd-card-value">{row?.value == null ? '—' : row.value.toFixed(2)}</span>
        {trend && <span className={`lm-trend ${trend}`}>{trend === 'rising' ? '↗ rising' : trend === 'falling' ? '↘ falling' : '→ steady'}</span>}
      </div>
      <div className={`lm-ew ${cls}`}><b>{label}</b><span>{text}</span></div>
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
            <b>{QUADRANTS[k].label}</b><span>{QUADRANTS[k].message || 'Mind and body below their limits.'}</span>
          </div>
        ))}
        {x != null && <i className="cq-dot" style={{ left: `${x * 100}%`, top: `${(1 - (y ?? 0.25)) * 100}%` }} title="mind / body now" />}
      </div>
      <div className="cq-axes"><span>Mind → above its limit</span><span>Body ↑ above its limit</span></div>
    </div>
  );
}

// One lane per component, coloured by state over time.
function StateLanes({ series, xDomain }) {
  const W = 1000; const lh = 20; const left = 64;
  const span = (xDomain[1] - xDomain[0]) || 1;
  const sx = (t) => left + ((t - xDomain[0]) / span) * (W - left - 4);
  const lanes = [['mind', 'Mind'], ['body', 'Body'], ['fused', 'Fused']];
  return (
    <svg viewBox={`0 0 ${W} ${lanes.length * lh + 4}`} width="100%" className="lm-lanes" role="img" aria-label="State over time per component">
      {lanes.map(([k, label], i) => {
        const rows = series[k].filter((r) => r.t >= xDomain[0] && r.t <= xDomain[1]);
        return (
          <g key={k}>
            <text x={0} y={i * lh + 14} className="tick">{label}</text>
            {rows.map((r, j) => {
              const t1 = Math.min(rows[j + 1]?.t ?? r.t + 25000, r.t + 60000);
              return <rect key={r.t} x={sx(r.t)} y={i * lh + 3} width={Math.max(1, sx(t1) - sx(r.t))} height={lh - 6}
                className={`lane-${r.state}`}><title>{`${label} ${clockS(r.t)}: ${STATE_TEXT[r.state] || r.state}${r.value != null ? ` (${r.value.toFixed(2)})` : ''}`}</title></rect>;
            })}
          </g>
        );
      })}
    </svg>
  );
}

export default function LiveMonitor({ now, go }) {
  const picker = useFusionPicker();
  const uid = picker.userId; const sid = picker.sessionId;
  const stim = useStimulator(now, sid);
  const st = stim.status;
  const eeg = useSessionData(uid, sid);
  const ring = usePhysioData(uid, sid);
  const fusion = useFusionData(uid, sid);
  const history = useEegCalibrations(uid, `${sid}|${eeg.calibration?.updated_at ?? ''}|${eeg.threshold?.updated_at ?? ''}`);
  const recalReq = useFirebaseValue(sid ? `eeg_recalibration/${sid}` : null);
  const ringReq = useFirebaseValue(uid ? `ring_recalibration/${uid}` : null);
  const ringBase = useFirebaseValue(uid ? `physiological/baselines/${uid}/updated_at` : null);
  const [zoom, setZoom] = useState(null);
  const [showTruth, setShowTruth] = useState(true);

  const limits = calibratedLimits({ eeg, history, sid, ring });
  const { cal, thr, eegInfo, ringInfo, fusedCal, bodyCal } = limits;
  const ringPresent = ring.windows.length > 0 || Boolean(ringBase);
  const gate0 = decisionGate({ cal, thr, ringThresholds: ring.thresholds, ringPresent, eegRecal: recalReq, ringRecal: ringReq, nowMs: now });
  // Simulated session: the stimulator runs it, or did (it has a ground-truth timeline).
  const simHere = stim.running && st?.sid === sid;
  const simulated = simHere || stim.timeline.length > 0;
  const params = EW_SETS.design.params;
  const periods = useMemo(() => periodsFrom(stim.timeline, simHere ? now : null), [stim.timeline, simHere, Math.floor(now / 10000)]);
  // readings taken during the stimulator's own calibration phases are calibration data too
  const calWin = periods.filter((p) => p.calibration).map((p) => [p.start, p.end]);
  const gate = useMemo(() => ({ ...gate0, blank: [...gate0.blank, ...calWin] }), [JSON.stringify(gate0), JSON.stringify(calWin)]);

  const series = useMemo(() => gateSeries(buildSeries({
    blocks: eeg.blocks, eegInfo, ringWindows: ring.windows, ringInfo, fusionWindows: fusion.windows,
    fusedCal, bodyCal, ringBaseAt: ringBase ? Date.parse(ringBase) : null, params, nowMs: now, equalWeights: simulated,
  }), gate), [eeg.blocks, ring.windows, fusion.windows, eegInfo?.limitL, eegInfo?.status, ringInfo.limit, fusedCal?.baseline, bodyCal?.baseline,
    ringBase, gate.startMs, gate.paused, JSON.stringify(gate.blank), simulated, Math.floor(now / 30000)]); // also every 30 s
  const events = useMemo(() => eventLog({ series, periods, eegThrAt: gate.eegAt, ringThrAt: gate.ringAt }), [series, periods, gate.eegAt, gate.ringAt]);
  const check = useMemo(() => (simulated ? phaseCheck(series, periods, stim.timeline) : []), [series, periods, stim.timeline, simulated]);

  const last = (rows) => [...rows].reverse().find((r) => r.value != null) || null;
  const m = last(series.mind); const b = last(series.body); const f = last(series.fused);
  const deciding = !gate.paused && !gate.recalibrating && (m || b) && [m, b].some((r) => r && r.state !== 'calibrating');
  const q = deciding ? fusedQuadrant(m && m.state !== 'calibrating' ? m.high : null, b && b.state !== 'calibrating' ? b.high : null) : null;

  // one time axis for every chart; drag to zoom, double-click to reset
  const xs = [...series.mind, ...series.body, ...series.fused].map((r) => r.t).concat(stim.timeline.map((p) => p.t));
  const full = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : null;
  const xDomain = zoom && full ? [Math.max(zoom[0], full[0]), Math.min(zoom[1], full[1])] : full;
  const onZoom = (a, c) => setZoom(a == null ? null : [a, c]);
  const lastMin = (min) => full && setZoom([Math.max(full[0], full[1] - min * 60000), full[1]]);
  const fmtX = zoom ? clockS : clock;

  const bands = [
    ...(simulated && showTruth ? phaseBands(periods) : []),
    // grey: no decisions (before the first calibration / during an asked-for recalibration); unlabelled
    // when the simulated phases already name that time
    ...(xDomain ? gate.blank.filter(([a, c]) => c > xDomain[0] && a < xDomain[1])
      .map(([a, c]) => ({ x0: Math.max(a, xDomain[0]), x1: Math.min(c, xDomain[1]), label: simulated && showTruth ? '' : 'calibrating', kind: 'n' })) : []),
  ];
  const pts = [...series.mind.map((r) => ({ x: r.t, mind: r.value ?? null })), ...series.body.map((r) => ({ x: r.t, body: r.value })),
    ...series.fused.map((r) => ({ x: r.t, fused: r.value }))].sort((a, c) => a.x - c.x);
  const truthPts = stim.timeline.map((p) => ({ x: p.t, d: p.demand, bd: p.body_demand ?? null }));
  const markers = [
    ...['mind', 'body', 'fused'].flatMap((k) => series[k].filter((r, i, a) => r.state === 'early_warning' && a[i - 1]?.state !== 'early_warning')
      .map((r) => ({ x: r.t, y: Math.min(0.96, (r.value ?? 0.5) + 0.07), glyph: '▲', color: 'var(--warning)', title: `${k} early warning ${clockS(r.t)}` }))),
    ...['mind', 'body', 'fused'].flatMap((k) => series[k].filter((r, i, a) => r.high && !a[i - 1]?.high)
      .map((r) => ({ x: r.t, y: Math.min(0.99, (r.value ?? 0.5) + 0.07), glyph: '▼', color: 'var(--critical)', title: `${k} high ${clockS(r.t)}` }))),
  ];
  const ewBand = fusedCal ? [fusedCal.baseline + params.bufferSpreads * Math.max(0.05, fusedCal.spread), 0.5] : null;
  const curPhase = st?.phase || (st?.stage || '').replace('live: ', '');
  const lastEeg = eeg.blocks[eeg.blocks.length - 1];
  const lastRing = ring.windows[ring.windows.length - 1];
  const fresh = (ms) => ms != null && now - ms < 90000;

  return (
    <div className="page">
      <TechNav page="concept" go={go} picker={picker} title="Live monitor"
        subtitle="Early warning of stress from the mind (EEG) and body (HRV + GSR), each against the user's own calibrated limit, and fused." />

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
          <StateCard title="MIND · EEG cognitive load" color={C.mind} row={m} rows={series.mind} />
          <StateCard title="BODY · HRV + GSR arousal" color={C.body} row={b} rows={series.body}
            note={!b && ringBase === null ? 'no ring baseline yet' : null} />
          <StateCard title="FUSED · mind + body" color={C.fused} row={f} rows={series.fused}
            note={f ? `weights ${Math.round((f.wEeg ?? 0) * 100)} / ${Math.round((f.wRing ?? 0) * 100)}${f.equalWeights ? ' (equal, simulation)' : ''}` : null} />
        </div>
        <Card title="User's state" subtitle={q ? `${q.label}${q.partial ? ` (${q.partial})` : ''}` : 'after calibration'}
          right={deciding && f?.mindLed ? <Status kind="warning">mind-led: body still calm</Status> : null}>
          <Quadrant q={q} mind={deciding ? m?.value : null} body={deciding ? b?.value : null} />
          {q?.message && <p className="cq-msg">“{q.message}”</p>}
        </Card>
      </div>

      {/* the timeline */}
      <Card title="Early warning timeline" subtitle="0.50 = each component's own limit · shaded band = early-warning zone above the calm level"
        right={(
          <div className="cd-zoom">
            {[10, 30, 60].map((mn) => <button key={mn} type="button" className="btn ghost" onClick={() => lastMin(mn)} disabled={!full}>{mn} min</button>)}
            <button type="button" className="btn ghost" onClick={() => setZoom(null)} disabled={!zoom}>All</button>
            {simulated && <label className="muted"><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /> ground truth</label>}
          </div>
        )}>
        {!xDomain ? <div className="chart-empty" style={{ height: 260 }}>No readings for this session yet.</div> : (
          <>
            {simulated && showTruth && (
              <MultiLineChart points={truthPts} height={110} yDomain={[0, 1]} xDomain={xDomain} xFormat={fmtX} onZoom={onZoom} yFormat={(v) => `${Math.round(v * 100)}%`}
                bands={bands} ariaLabel="Simulated mental demand and physical arousal"
                series={[{ key: 'd', label: 'Simulated mental demand', color: C.mind, width: 2, dash: true, connect: true },
                  { key: 'bd', label: 'Simulated physical arousal', color: C.body, width: 2, dash: true, connect: true }]} />
            )}
            <MultiLineChart points={pts} height={300} yDomain={[0, 1]} xDomain={xDomain} xFormat={fmtX} onZoom={onZoom} yFormat={(v) => v.toFixed(2)}
              bands={bands} markers={markers} ariaLabel="Mind, body and fused over time"
              hbands={ewBand ? [{ y0: ewBand[0], y1: ewBand[1], label: 'early-warning zone', color: 'var(--warning)', opacity: 0.1 }] : []}
              refLines={[{ y: 0.5, label: 'limit 0.50' }, ...(fusedCal ? [{ y: fusedCal.baseline, label: 'calm (fused)' }] : [])]}
              series={[{ key: 'mind', label: 'Mind', color: C.mind, width: 2, connect: true },
                { key: 'body', label: 'Body', color: C.body, width: 2, connect: true },
                { key: 'fused', label: 'Fused', color: C.fused, width: 3, connect: true }]} />
            <StateLanes series={series} xDomain={xDomain} />
            <p className="caption lm-legend">
              <i className="lane-normal" /> normal <i className="lane-early_warning" /> early warning (trending up)
              <i className="lane-high" /> high (2 of last 3 above the limit) <i className="lane-recovering" /> recovering
              <i className="lane-calibrating" /> calibrating / limited · ▲ warning ▼ high · drag to zoom, double-click to reset
            </p>
          </>
        )}
      </Card>

      <div className={check.length ? 'grid-2' : ''}>
        <Card title="Events" subtitle="Warnings, highs and recoveries (newest first)">
          {!events.length ? <p className="muted">No events yet.</p> : (
            <ol className="sd-log">
              {events.filter((e) => e.kind !== 'reject').slice(-40).reverse().map((e, i) => (
                <li key={`${e.t}-${i}`} className={`ev-${e.kind}`} title={e.title}><time>{clockS(e.t)}</time>{e.text}</li>
              ))}
            </ol>
          )}
        </Card>
        {check.length > 0 && (
          <Card title="Against the ground truth" subtitle="Simulation only: state the app showed vs the state the scenario implies, after the first 2 min of each phase">
            <table className="phase-table">
              <thead><tr><th>Phase</th><th>Time</th><th>Should show</th><th>Correct</th><th>Showed mostly</th></tr></thead>
              <tbody>
                {check.map((c) => (
                  <tr key={c.start}>
                    <th>{PHASE[c.phase] || c.phase.replace(/_/g, ' ')}</th>
                    <td>{clock(c.start)}–{clock(c.end)}</td>
                    <td>{c.expected ? QUADRANTS[c.expected].label : <span className="muted">in-between</span>}</td>
                    <td className={c.correct == null ? 'muted' : c.correct >= 0.7 ? 'ok' : c.correct >= 0.4 ? '' : 'bad'}>{pct(c.correct)}</td>
                    <td>{c.mostly ? QUADRANTS[c.mostly].label : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(() => {
              const sc = check.filter((c) => c.correct != null);
              return sc.length ? <p className="caption">Overall: {pct(sc.reduce((a, c) => a + c.correct, 0) / sc.length)} correct over {sc.length} scored phases.</p> : null;
            })()}
          </Card>
        )}
      </div>
    </div>
  );
}
