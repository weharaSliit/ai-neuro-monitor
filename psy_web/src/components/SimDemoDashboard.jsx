import { useMemo, useRef, useState } from 'react';
import { MultiLineChart } from './charts';
import { Card, SessionPicker, Status } from './panels';
import { useFirebaseValue, useSessionData } from '../hooks/useData';
import { usePhysioData } from '../hooks/usePhysio';
import { useFusionData, useFusionPicker } from '../hooks/useFusion';
import useEegCalibrations from '../hooks/useEegCalibrations';
import { STIM_PROFILES, mmss, useStimulator } from '../hooks/useStimulator';
import { calibratedLimits, eegStatusText, num, sig } from '../lib/limits';
import LimitsStrip from './LimitsStrip';
import { STATE_TEXT } from '../lib/earlyWarning';
import { EW_SETS, buildSeries, decisionGate, eventLog, gateSeries, periodsFrom, phaseBands, scorecard } from '../lib/simDemo';
import { sendStimulatorCommand } from '../lib/firebase';

// Simulation demo dashboard (#simdemo): what the simulated person is doing
// (ground truth, from the live stimulator), what the system decided (the real
// pipeline's stored outputs + the early-warning detector), and that the
// system is working properly (calibration, quality gates, live scorecard).
const C = { mind: 'var(--c1)', body: 'var(--c2)', fused: 'var(--c7)', truth: 'var(--c4)' };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const clockShort = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const secs = (ms) => (ms == null ? '—' : `${Math.round(ms / 1000)} s`);
const isoMs = (v) => (v == null ? null : typeof v === 'number' ? v * 1000 : Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`));
const STATE_CLASS = { normal: 'ok', early_warning: 'warn', high: 'high', recovering: 'rec', limited: 'lim' };
const PHASE_TEXT = { settle: 'Settle', rest: 'Rest baseline', task: 'HIGH-LOAD TASK', recovery: 'Recovery', calm: 'Calm',
  ramp: 'Load rising', demand: 'HIGH LOAD', plateau: 'Moderate-load plateau',
  relaxed: 'Relaxed', mental: 'HIGH MENTAL LOAD (body calm)', arousal: 'PHYSICAL AROUSAL (mind calm)', stress: 'STRESS (mind + body)' };

function StateCard({ title, color, value, limitText, state, reason, extra, children }) {
  return (
    <div className={`sd-card sd-${STATE_CLASS[state] || 'ok'}`} style={{ borderTopColor: color }}>
      <span className="sd-card-title">{title}</span>
      <span className="sd-card-value">{value == null ? '—' : value.toFixed(2)}</span>
      <span className="sd-card-note">{limitText}</span>
      <span className="sd-state">{state === 'early_warning' ? '▲ ' : state === 'high' ? '▼ ' : ''}{STATE_TEXT[state] || '—'}</span>
      {reason && <span className="sd-card-note">{reason}</span>}
      {extra}
      {children}
    </div>
  );
}

export default function SimDemoDashboard({ now, onBack }) {
  const picker = useFusionPicker();
  const stim = useStimulator(now, picker.sessionId);
  const st = stim.status;
  const uid = picker.userId; const sid = picker.sessionId;
  const eeg = useSessionData(uid, sid);
  const ring = usePhysioData(uid, sid);
  const fusion = useFusionData(uid, sid);
  const history = useEegCalibrations(uid, `${sid}|${eeg.calibration?.updated_at ?? ''}|${eeg.threshold?.updated_at ?? ''}`);
  const injRaw = useFirebaseValue(sid ? `stimulator/events/${sid}` : null);
  const ringBase = useFirebaseValue(uid ? `physiological/baselines/${uid}/updated_at` : null);
  const [setKey, setSetKey] = useState('design');
  const [showLatent, setShowLatent] = useState(true);
  const [profile, setProfile] = useState('responsive');
  const [scenario, setScenario] = useState('four_state');
  const [recal, setRecal] = useState(true);
  const [busy, setBusy] = useState(false);

  const limits = calibratedLimits({ eeg, history, sid, ring });
  const { cal, thr, eegInfo, ringInfo, phases, fusedCal } = limits;
  const params = EW_SETS[setKey].params;
  const ringBaseAt = isoMs(ringBase);

  const recalReq = useFirebaseValue(sid ? `eeg_recalibration/${sid}` : null);
  const gate = decisionGate({ cal, thr, ringThresholds: ring.thresholds, ringPresent: ring.windows.length > 0 || Boolean(ringBase),
    recalActive: ['requested', 'capturing', 'saving'].includes(recalReq?.status) });
  // Simulated session: mind and body get the same priority in the fused value (lib/simDemo buildSeries).
  const simSession = (stim.running && st?.sid === sid) || stim.timeline.length > 0;
  const series = useMemo(() => gateSeries(buildSeries({
    blocks: eeg.blocks, eegInfo, ringWindows: ring.windows, ringInfo, fusionWindows: fusion.windows,
    fusedCal, ringBaseAt, params, nowMs: now, equalWeights: simSession,
  // recomputed every 30 s or when the data change; decisions only after calibration
  }), gate), [eeg.blocks, ring.windows, fusion.windows, eegInfo?.limitL, eegInfo?.status, ringInfo.limit, ringBaseAt, setKey, gate.startMs, gate.paused, simSession, Math.floor(now / 30000)]);
  const periods = useMemo(() => periodsFrom(stim.timeline, stim.running ? now : null), [stim.timeline, stim.running, Math.floor(now / 10000)]);
  const injections = injRaw ? Object.entries(injRaw).map(([t, v]) => ({ t: Number(t), ...v })) : [];
  const score = useMemo(() => scorecard(series, periods), [series, periods]);
  const events = useMemo(() => eventLog({
    series, periods, injections, eegThrAt: thr?.updated_at ? thr.updated_at * 1000 : null,
    ringThrAt: isoMs(ring.thresholds?.threshold_updated_at),
  }), [series, periods, injRaw, thr?.updated_at, ring.thresholds?.threshold_updated_at]);

  // Device rates from successive stimulator status updates.
  const prev = useRef(null); const rates = useRef({ eeg: null, ring: null });
  if (st?.ts && (!prev.current || st.ts !== prev.current.ts)) {
    if (prev.current && st.ts > prev.current.ts) {
      const dt = st.ts - prev.current.ts;
      rates.current = { eeg: (st.eeg_samples - prev.current.eeg) / dt, ring: (st.ring_packets - prev.current.ring) / dt };
    }
    prev.current = { ts: st.ts, eeg: st.eeg_samples || 0, ring: st.ring_packets || 0 };
  }
  const lastEeg = eeg.blocks[eeg.blocks.length - 1];
  const lastRing = ring.windows[ring.windows.length - 1];

  const send = async (cmd, extra = {}) => {
    setBusy(true);
    try { await sendStimulatorCommand(cmd, { profile, recalibrate: recal, scenario, ...extra }); } finally { setBusy(false); }
  };

  // ── current states ──
  const lastOf = (rows) => [...rows].reverse().find((r) => r.value != null) || null;
  const m = lastOf(series.mind); const b = lastOf(series.body); const f = lastOf(series.fused);
  const curPhase = st?.phase || (st?.stage || '').replace('live: ', '');
  const left = st?.phase_left != null ? ` · ${mmss(st.phase_left)} left` : '';

  // ── main timeline ──
  const tl = stim.timeline;
  const pts = [
    ...series.mind.map((r) => ({ x: r.t, mind: r.value ?? null })),
    ...series.body.map((r) => ({ x: r.t, body: r.value })),
    ...series.fused.map((r) => ({ x: r.t, fused: r.value })),
    ...(showLatent ? tl.map((p) => ({ x: p.t, dem: p.demand, bdem: p.body_demand ?? null, brain: p.brain, heart: p.heart, skin: p.skin })) : []),
  ].sort((a, c) => a.x - c.x);
  const xs = pts.map((p) => p.x);
  const xDomain = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : null;
  const markers = [
    ...['mind', 'fused'].flatMap((k) => series[k].filter((r, i, a) => r.state === 'early_warning' && a[i - 1]?.state !== 'early_warning')
      .map((r) => ({ x: r.t, y: Math.min(0.97, (r.value ?? 0.5) + 0.06), glyph: '▲', color: 'var(--warning)', title: `${k} early warning ${clock(r.t)}` }))),
    ...['mind', 'body', 'fused'].flatMap((k) => series[k].filter((r, i, a) => r.high && !a[i - 1]?.high)
      .map((r) => ({ x: r.t, y: Math.min(0.99, (r.value ?? 0.5) + 0.06), glyph: '▼', color: 'var(--critical)', title: `${k} HIGH ${clock(r.t)}` }))),
    ...series.mind.filter((r) => r.rejected).map((r) => ({ x: r.t, y: 0.03, glyph: '✕', color: 'var(--muted)', title: `EEG block rejected: ${r.rejectReason} — ${r.fullReason || ''}` })),
    ...injections.map((i) => ({ x: i.t, y: 0.92, glyph: '⚡', color: 'var(--c5)', title: `injected: ${i.kind}` })),
  ];
  const mindBase = limits.mind?.baseFused ?? null;

  // ── quality ──
  const recent = series.mind.slice(-10);
  const nRej = series.mind.filter((r) => r.rejected).length;
  const gaps = series.mind.reduce((n, r, i, a) => n + (i && r.t - a[i - 1].t > 60000 ? 1 : 0), 0);
  const dups = series.mind.reduce((n, r, i, a) => n + (i && r.t === a[i - 1].t ? 1 : 0), 0);
  const lf = lastEeg?.features_eeg?.bipolar || {};

  const simHere = stim.running && st?.sid === sid;
  return (
    <div className="page">
      <header className="top">
        <div>
          <button type="button" className="back-link" onClick={onBack}>← Wearable 02 EEG monitor</button>
          <p className="eyebrow">MindPulse · live stimulator · demonstration</p>
          <h1>Simulation demo: early warning and fusion</h1>
          <p className="muted">Ground truth from the live stimulator, the real pipeline&apos;s decisions, and the safeguards — on one page.</p>
        </div>
        <SessionPicker picker={picker} />
      </header>

      <LimitsStrip limits={limits} />

      {/* 1. Simulation header */}
      <div className={`sd-head ${simHere ? '' : 'idle'}`}>
        <span className="stim-badge">SIMULATED – software-in-the-loop</span>
        {simHere ? (
          <>
            <span>profile <b>{st.profile}</b> · seed <b>{st.seed ?? '—'}</b> · SAM40 subject <b>{st.eeg_subject ?? '—'}</b> · <b>{st.uid}</b> · scenario <b>{st.scenario || '—'}</b></span>
            <span className={`sd-phase ${stim.demandOn ? 'hi' : ''}`}>{st.calibrating ? 'Calibration · ' : ''}{PHASE_TEXT[curPhase] || curPhase}{left}</span>
            <span className="sd-dev">Headband {st.mqtt?.eeg ? '✔' : '✕'} {rates.current.eeg ? `${Math.round(rates.current.eeg)} Hz` : ''} ·
              Ring {st.mqtt?.ring ? '✔' : '✕'} {rates.current.ring ? `${rates.current.ring.toFixed(1)} pkt/s` : ''} · last {clock(st.ts * 1000)}</span>
          </>
        ) : <span className="muted">{stim.running ? `The stimulator is running for ${st.uid} / ${st.sid}; this page shows another session.` : 'Stimulator not running for this session: everything below shows the real devices\' data, without ground truth.'}</span>}
      </div>

      {/* 8. Controls */}
      <Card title="Controls" subtitle="Start / stop the live stimulator and inject events to show the safeguards"
        right={<Status kind={!stim.online ? 'idle' : stim.running ? 'good' : 'warning'}>{!stim.online ? 'program not running' : stim.running ? 'running' : 'ready'}</Status>}>
        <div className="recal-bar">
          {!stim.running ? (
            <>
              <label className="muted">Profile <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                {Object.entries(STIM_PROFILES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="muted">Scenario <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                <option value="four_state">All four states (relaxed, mental load, physical arousal, stress)</option>
                <option value="ramp">Gradual ramp + plateau (early warning)</option><option value="steps">Calm / high-load steps</option></select></label>
              <label className="muted"><input type="checkbox" checked={recal} onChange={(e) => setRecal(e.target.checked)} /> recalibrate first</label>
              <button type="button" className="btn" disabled={busy || !stim.online || !picker.liveUser} onClick={() => send('start')}>Start</button>
              {!stim.online && <span className="caption">Run <code>venv/bin/python backend/simulation/live_stimulator.py</code> first.</span>}
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => send('stop')}>Stop</button>
              <span className="muted">Inject:</span>
              {[['dropout', 'Dropout'], ['clench', 'Jaw clench'], ['drowsy', 'Drowsiness (60 s)']].map(([k, l]) => (
                <button key={k} type="button" className="btn ghost" disabled={busy} onClick={() => send('inject', { kind: k })}>{l}</button>
              ))}
            </>
          )}
          <label className="muted">Early-warning parameters <select value={setKey} onChange={(e) => setSetKey(e.target.value)}>
            {Object.entries(EW_SETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        </div>
      </Card>

      {/* 4. Live state cards + 5. quality summary */}
      <div className="sd-cards">
        <StateCard title="MIND (EEG)" color={C.mind} value={m?.value} limitText="fusion scale · limit 0.50" state={m?.state || 'normal'}
          reason={m?.state === 'limited' ? m.reason : null} />
        <StateCard title="BODY (HRV + GSR)" color={C.body} value={b?.value} limitText={`limit 0.50 (raw ${ringInfo.limit?.toFixed(2)})`}
          state={b?.state || 'normal'} reason={!b ? (ringBase === null ? 'no ring baseline: body readings skipped' : 'no ring window yet') : 'prediction vs its limit (no trend)'} />
        <StateCard title="FUSED" color={C.fused} value={f?.value} limitText={f ? `${f.basedOn} · weights ${pct(f.wEeg)} / ${pct(f.wRing)}${f.equalWeights ? ` (equal, simulation; engine ${pct(f.wEegEngine)} / ${pct(f.wRingEngine)})` : ''}` : 'limit 0.50'}
          state={f?.state || 'normal'} reason={f?.state === 'limited' ? f.reason : null}
          extra={f?.mindLed ? <span className="sd-mindled">Mind rising while body still calm (mind-led)</span> : null} />
        <div className="sd-card sd-quality">
          <span className="sd-card-title">SIGNAL &amp; DEVICES</span>
          <span>RMS <b>{num(lastEeg?.eeg_std_uv_unclamped)?.toFixed(1) ?? '—'} µV</b> · clip <b>{pct(num(lastEeg?.eeg_out_of_range_fraction))}</b></span>
          <span>slope <b>{num(lf.spectral_slope)?.toFixed(2) ?? '—'}</b> · gamma <b>{pct(num(lf.gamma_rel_power))}</b> · entropy <b>{num(lf.sample_entropy)?.toFixed(2) ?? '—'}</b></span>
          <span className="sd-blocks" title="Last 10 EEG blocks">{recent.map((r) => (
            <i key={r.t} className={r.rejected ? 'rej' : 'acc'} title={`${clock(r.t)} ${r.rejected ? `rejected: ${r.rejectReason}` : 'accepted'}`}>{r.rejected ? '✕' : '✔'}</i>))}</span>
          <span className="caption">EEG block {lastEeg ? clock(lastEeg.timestamp_end * 1000) : '—'} · ring window {lastRing?.t ? clock(lastRing.t) : '—'}</span>
        </div>
      </div>

      {/* 2. Main timeline */}
      <Card title="Ground truth vs system response" subtitle="Shaded: the simulated scenario · lines: the real pipeline's mind, body and fused values (fusion scale, own limit 0.50)"
        right={<label className="muted"><input type="checkbox" checked={showLatent} onChange={(e) => setShowLatent(e.target.checked)} /> latent load</label>}>
        {!xDomain ? <div className="chart-empty" style={{ height: 260 }}>No data for this session yet.</div> : (
          <MultiLineChart points={pts} height={340} yDomain={[0, 1]} xDomain={xDomain} xFormat={clockShort} yFormat={(v) => v.toFixed(2)}
            bands={phaseBands(periods)} markers={markers} ariaLabel="Ground truth and system response over time"
            hbands={[{ y0: series.fusedBand[0], y1: 0.5, label: 'early-warning band (fused)', color: 'var(--warning)', opacity: 0.08 }]}
            refLines={[{ y: 0.5, label: 'limit 0.50' },
              ...(mindBase != null ? [{ y: mindBase, label: 'mind baseline' }] : []),
              ...(fusedCal ? [{ y: fusedCal.baseline, label: 'fused baseline' }] : [])]}
            series={[
              { key: 'mind', label: 'Mind (EEG)', color: C.mind, width: 2, connect: true },
              { key: 'body', label: 'Body (HRV + GSR)', color: C.body, width: 2, connect: true },
              { key: 'fused', label: 'Fused', color: C.fused, width: 3, connect: true },
              ...(showLatent ? [
                { key: 'dem', label: 'Simulated mental demand', color: C.truth, width: 1.5, dash: true, connect: true },
                { key: 'bdem', label: 'Simulated physical arousal', color: 'var(--c5)', width: 1.5, dash: true, connect: true },
                { key: 'brain', label: 'latent brain', color: C.mind, width: 1, dash: true, connect: true },
                { key: 'heart', label: 'latent heart', color: C.body, width: 1, dash: true, connect: true },
                { key: 'skin', label: 'latent skin', color: 'var(--c3)', width: 1, dash: true, connect: true }] : []),
            ]} />
        )}
        <p className="caption">▲ early warning (rising towards high load) · ▼ HIGH (2 of last 3 above the limit) · ✕ rejected EEG block (hover for the reason) · ⚡ injected event.
          Early warning: mind and fused only; the body uses its prediction vs its limit. Parameters: {EW_SETS[setKey].label}.</p>
      </Card>

      <div className="grid-2">
        {/* 3. Calibration */}
        <Card title="Calibration (personalisation)" subtitle="How this user's baseline and high-load limit were set"
          right={<Status kind={eegInfo?.status === 'ok' ? 'good' : eegInfo?.status ? 'warning' : 'idle'}>{eegStatusText(eegInfo) || 'not calibrated'}</Status>}>
          {phases.mind ? (
            <MultiLineChart points={[...phases.mind.rest.map((v, i) => ({ x: i + 1, rest: sig(Math.max(-3, Math.min(3, v))) })),
              ...phases.mind.task.map((v, i) => ({ x: phases.mind.rest.length + i + 1, task: sig(Math.max(-3, Math.min(3, v))) })),
              ...phases.mind.recovery.map((v, i) => ({ x: phases.mind.rest.length + phases.mind.task.length + i + 1, rec: sig(Math.max(-3, Math.min(3, v))) }))]}
              height={200} yDomain={[0, 1]} xFormat={(v) => `#${Math.round(v)}`} yFormat={(v) => v.toFixed(2)} legend={false} ariaLabel="EEG calibration blocks"
              refLines={[{ y: 0.5, label: 'limit' }, ...(phases.mind.levels.rest != null ? [{ y: phases.mind.levels.rest, label: 'baseline' }] : []),
                ...(phases.mind.levels.task != null ? [{ y: phases.mind.levels.task, label: 'sustained task' }] : [])]}
              series={[{ key: 'rest', label: 'Rest', color: C.mind, dots: true, width: 0.01 },
                { key: 'task', label: 'Task', color: 'var(--critical)', dots: true, width: 0.01 },
                { key: 'rec', label: 'Recovery', color: 'var(--c3)', dots: true, width: 0.01 }]} />
          ) : <div className="chart-empty" style={{ height: 160 }}>No EEG calibration for this session.</div>}
          {eegInfo && (
            <dl className="sd-dl">
              <div><dt>Baseline</dt><dd>{sig(eegInfo.level).toExponential(1)} (log-odds {eegInfo.level.toFixed(1)})</dd></div>
              <div><dt>Spread</dt><dd>{eegInfo.sd.toFixed(2)} log-odds</dd></div>
              <div><dt>Sustained task</dt><dd>{eegInfo.rawTaskL == null ? '—' : sig(eegInfo.rawTaskL).toExponential(1)}</dd></div>
              <div><dt>Limit</dt><dd>{sig(eegInfo.rawLimitL).toExponential(1)} · {eegInfo.method}</dd></div>
              <div><dt>Separation</dt><dd>{eegInfo.sepSd == null ? '—' : `${eegInfo.sepSd.toFixed(2)} spreads`}</dd></div>
              <div><dt>Recovery reversal</dt><dd>{eegInfo.reversalSd == null ? '—' : `${eegInfo.reversalSd.toFixed(2)} spreads`}</dd></div>
              <div><dt>Direction</dt><dd>{eegInfo.dir < 0 ? '−1 (score falls under load)' : '+1'}</dd></div>
            </dl>
          )}
          <h3>Ring (HRV/GSR)</h3>
          <dl className="sd-dl">
            <div><dt>Baseline / task / limit</dt><dd>{ringInfo.base?.toFixed(3) ?? '—'} / {ringInfo.taskLevel?.toFixed(3) ?? '—'} / {ringInfo.limit?.toFixed(3) ?? '—'}</dd></div>
            <div><dt>Status</dt><dd>{ringInfo.status || (ringInfo.personal ? 'ok' : ringInfo.ran ? 'not separated' : 'task not run')}</dd></div>
            <div><dt>Calibration age</dt><dd>{ringBaseAt ? `${Math.round((now - ringBaseAt) / 60000)} min` : ringBase === null ? 'no ring baseline' : '—'}</dd></div>
          </dl>
        </Card>

        {/* 6. Scorecard */}
        <Card title="Live scorecard vs simulated ground truth" subtitle="Only meaningful in simulation: the stimulator knows when load was really on"
          right={<Status kind={score ? 'good' : 'idle'}>{score ? 'vs ground truth' : 'no ground truth'}</Status>}>
          {!score ? <p className="muted">Start the stimulator (live phase) to score the system against what the simulated person was doing.</p> : (
            <table className="phase-table">
              <thead><tr><th /><th>Mind</th><th>Body</th><th>Fused</th></tr></thead>
              <tbody>
                <tr><th>Alert rate during high load</th>{['mind', 'body', 'fused'].map((k) => <td key={k}>{pct(score[k].alertRateDemand)}</td>)}</tr>
                <tr><th>False alarms in calm (after 2 min grace)</th>{['mind', 'body', 'fused'].map((k) => <td key={k}>{score[k].falseAlarms}</td>)}</tr>
                <tr><th>Time to first alert</th>{['mind', 'body', 'fused'].map((k) => <td key={k}>{score[k].timeToAlert.map(secs).join(', ') || '—'}</td>)}</tr>
                <tr><th>Time to clear after load ends</th>{['mind', 'body', 'fused'].map((k) => <td key={k}>{score[k].timeToClear.map(secs).join(', ') || '—'}</td>)}</tr>
                <tr><th>Early warnings (in calm)</th><td>{score.mind.warnings} ({score.mind.falseWarnings})</td><td>—</td><td>{score.fused.warnings} ({score.fused.falseWarnings})</td></tr>
                <tr><th>Warning lead time before HIGH</th><td>{score.mind.leadTimes.map(secs).join(', ') || '—'}</td><td>—</td><td>{score.fused.leadTimes.map(secs).join(', ') || '—'}</td></tr>
                <tr><th>EEG gate rejection rate</th><td colSpan={3}>{pct(score.rejectionRate)}</td></tr>
              </tbody>
            </table>
          )}
          <h3>Safeguards</h3>
          <dl className="sd-dl">
            <div><dt>Rejected EEG blocks</dt><dd>{nRej} of {series.mind.length} ({pct(series.mind.length ? nRej / series.mind.length : null)})</dd></div>
            <div><dt>Gaps &gt; 60 s (Wi-Fi / dropouts)</dt><dd>{gaps}</dd></div>
            <div><dt>Duplicate blocks</dt><dd>{dups}</dd></div>
            <div><dt>Injected events</dt><dd>{injections.length ? injections.map((i) => i.kind).join(', ') : 'none'}</dd></div>
            {series.mindReason && <div><dt>Mind early warning</dt><dd>limited: {series.mindReason}</dd></div>}
          </dl>
        </Card>
      </div>

      {/* 7. Event log */}
      <Card title="Event log" subtitle="Ground truth, decisions and safeguards, in time order (newest last)">
        {!events.length ? <p className="muted">No events yet.</p> : (
          <ol className="sd-log">
            {events.slice(-60).map((e, i) => (
              <li key={`${e.t}-${i}`} className={`ev-${e.kind}`} title={e.title}><time>{clock(e.t)}</time>{e.text}</li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
