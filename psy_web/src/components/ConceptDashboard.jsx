import { useMemo, useState } from 'react';
import { MultiLineChart, fmtScore, log10Safe } from './charts';
import { Card, SessionPicker, Status } from './panels';
import { useFirebaseValue, useSessionData } from '../hooks/useData';
import { usePhysioData } from '../hooks/usePhysio';
import { useFusionData, useFusionPicker } from '../hooks/useFusion';
import useEegCalibrations from '../hooks/useEegCalibrations';
import { STIM_PROFILES, mmss, useStimulator } from '../hooks/useStimulator';
import { calibratedLimits, eegStatusText, sig } from '../lib/limits';
import { STATE_TEXT } from '../lib/earlyWarning';
import {
  EW_SETS, QUADRANTS, buildSeries, decisionGate, eventLog, fusedQuadrant, gateSeries, periodsFrom, phaseBands,
} from '../lib/simDemo';
import { sendStimulatorCommand } from '../lib/firebase';

// Concept dashboard (#concept): the minimum to prove the concept.
//   1 header (SIMULATED, profile, seed, phase + countdown, devices)  2+3 ground
//   truth and the system's response on ONE time axis  4 Mind / Body / Fused
//   state cards  5 the fused state (4 quadrants)  6 calibration  7 quality.
// Decisions (alerts, early warning, fused state) start only once calibration
// is done; everything uses the calibrated values stored by the real pipeline.
const C = { mind: 'var(--c1)', body: 'var(--c2)', fused: 'var(--c7)', truth: 'var(--c4)' };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const clockS = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const PHASE = { settle: 'Calibration · settle', rest: 'Calibration · rest baseline', task: 'Calibration · HIGH-LOAD TASK',
  recovery: 'Calibration · recovery', calm: 'Calm', ramp: 'Load rising', demand: 'HIGH LOAD', plateau: 'Moderate load',
  relaxed: 'Relaxed', mental: 'HIGH MENTAL LOAD (body calm)', arousal: 'PHYSICAL AROUSAL (mind calm)', stress: 'STRESS (mind + body)' };
const CLS = { normal: 'ok', early_warning: 'warn', high: 'high', recovering: 'rec', limited: 'lim', calibrating: 'lim' };

// cal: { baseline, threshold } on the model's own scale, { baseFused } on the fusion scale
// (threshold = 0.50 there by construction), plus source / time.
function Card4({ title, color, row, note, cal }) {
  const st = row?.state || 'calibrating';
  return (
    <div className={`sd-card sd-${CLS[st] || 'ok'}`} style={{ borderTopColor: color }}>
      <span className="sd-card-title">{title}</span>
      <span className="sd-card-value">{row?.value == null ? '—' : row.value.toFixed(2)}</span>
      <span className="sd-card-note">{note}</span>
      <div className="cd-cal">
        <div><span>Calibrated baseline</span><b>{cal?.baseline == null ? '—' : fmtScore(cal.baseline)}</b>
          <em>{cal?.baseFused == null ? '' : `${cal.baseFused.toFixed(2)} on the 0–1 scale`}</em></div>
        <div><span>High-load threshold</span><b>{cal?.threshold == null ? '—' : fmtScore(cal.threshold)}</b>
          <em>{cal?.threshold == null ? '' : '0.50 on the 0–1 scale'}</em></div>
      </div>
      {cal?.source && <span className="sd-card-note">{cal.source}</span>}
      <span className="sd-state">{st === 'early_warning' ? '▲ ' : st === 'high' ? '▼ ' : ''}{STATE_TEXT[st] || st}</span>
      {row?.reason && st !== 'normal' && <span className="sd-card-note">{row.reason}</span>}
    </div>
  );
}

function Quadrant({ q, mind, body }) {
  // dot position: x = mind value, y = body value (fusion scale, 0.5 = each one's own limit)
  const x = mind == null ? null : Math.max(0.02, Math.min(0.98, mind));
  const y = body == null ? null : Math.max(0.02, Math.min(0.98, body));
  return (
    <div className="cq">
      <div className="cq-grid">
        {['arousal', 'stress', 'relaxed', 'mental'].map((k) => (
          <div key={k} className={`cq-cell cq-${k} ${q?.key === k ? 'on' : ''}`}>
            <b>{QUADRANTS[k].label}</b><span>{QUADRANTS[k].message || '—'}</span>
          </div>
        ))}
        {x != null && <i className="cq-dot" style={{ left: `${x * 100}%`, top: `${(1 - (y ?? 0.25)) * 100}%` }} title="current mind / body" />}
      </div>
      <div className="cq-axes"><span>Mind (EEG) → above its limit</span><span>Body (HRV/GSR) ↑ above its limit</span></div>
    </div>
  );
}

export default function ConceptDashboard({ now, onBack, openFull }) {
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
  const [profile, setProfile] = useState('responsive');
  const [scenario, setScenario] = useState('four_state');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(null);           // [x0, x1] ms, or null = whole session

  // The calibrated baseline / threshold in use (lib/limits calibratedLimits): every dashboard uses the same.
  const limits = calibratedLimits({ eeg, history, sid, ring });
  const { cal, thr, eegInfo, ringInfo, phases, fusedCal: fc } = limits;
  const recalActive = ['requested', 'capturing', 'saving'].includes(recalReq?.status) || ['capturing', 'saving'].includes(ringReq?.status);
  const ringPresent = ring.windows.length > 0 || Boolean(ringBase);
  const gate = decisionGate({ cal, thr, ringThresholds: ring.thresholds, ringPresent, recalActive });

  // Simulated session: mind and body get the same priority in the fused value (lib/simDemo buildSeries).
  const simSession = (stim.running && st?.sid === sid) || stim.timeline.length > 0;
  const series = useMemo(() => gateSeries(buildSeries({
    blocks: eeg.blocks, eegInfo, ringWindows: ring.windows, ringInfo, fusionWindows: fusion.windows,
    fusedCal: fc, ringBaseAt: ringBase ? Date.parse(ringBase) : null, params: EW_SETS.design.params, nowMs: now, equalWeights: simSession,
  }), gate), [eeg.blocks, ring.windows, fusion.windows, eegInfo?.limitL, eegInfo?.status, ringInfo.limit, ringBase, gate.startMs, gate.paused, simSession, Math.floor(now / 30000)]); // recomputed every 30 s or on new data
  const periods = useMemo(() => periodsFrom(stim.timeline, stim.running ? now : null), [stim.timeline, stim.running, Math.floor(now / 10000)]);
  const events = useMemo(() => eventLog({ series, periods, eegThrAt: gate.eegAt, ringThrAt: gate.ringAt }), [series, periods, gate.eegAt, gate.ringAt]);

  const last = (rows) => [...rows].reverse().find((r) => r.value != null) || null;
  const m = last(series.mind); const b = last(series.body); const f = last(series.fused);
  const deciding = !gate.paused && m && m.state !== 'calibrating';
  const q = deciding ? fusedQuadrant(m ? m.high : null, b && b.state !== 'calibrating' ? b.high : null) : null;
  const mindLed = deciding && f?.mindLed;

  // 2 + 3: one shared time axis
  const xs = [...series.mind, ...series.body, ...series.fused].map((r) => r.t).concat(stim.timeline.map((p) => p.t));
  const fullDomain = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : null;
  // Zoom: drag across any time chart, or a quick range; all time charts share it.
  const xDomain = zoom && fullDomain ? [Math.max(zoom[0], fullDomain[0]), Math.min(zoom[1], fullDomain[1])] : fullDomain;
  const onZoom = (a, b) => setZoom(a == null ? null : [a, b]);
  const lastMin = (min) => fullDomain && setZoom([Math.max(fullDomain[0], fullDomain[1] - min * 60000), fullDomain[1]]);
  // Task scores: each model's own output against its own calibrated limit.
  const mindScorePts = eeg.blocks.filter((bl) => bl.timestamp_end).map((bl) => {
    const raw = bl.raw_task_state_score ?? bl.task_state_score;
    return { x: bl.timestamp_end * 1000, ms: bl.skipped || raw == null ? null : log10Safe(raw) };
  });
  const bodyScorePts = ring.windows.filter((w) => w.t && w.prob_stress != null).map((w) => ({ x: w.t, bs: w.prob_stress }));
  const mindLimitRaw = eegInfo ? sig(eegInfo.rawLimitL) : null;
  const mindBaseRaw = eegInfo ? sig(eegInfo.level) : null;
  const bands = [...phaseBands(periods), ...(gate.startMs && xDomain && gate.startMs > xDomain[0] ? [{ x0: xDomain[0], x1: gate.startMs, label: 'calibrating: no decisions', kind: 'n' }] : [])];
  const truthPts = stim.timeline.map((p) => ({ x: p.t, d: p.demand, bd: p.body_demand ?? null, br: p.brain, he: p.heart, sk: p.skin }));
  const sysPts = [...series.mind.map((r) => ({ x: r.t, mind: r.value ?? null })), ...series.body.map((r) => ({ x: r.t, body: r.value })),
    ...series.fused.map((r) => ({ x: r.t, fused: r.value }))].sort((a, c) => a.x - c.x);
  const markers = [
    ...['mind', 'fused'].flatMap((k) => series[k].filter((r, i, a) => r.state === 'early_warning' && a[i - 1]?.state !== 'early_warning')
      .map((r) => ({ x: r.t, y: Math.min(0.97, (r.value ?? 0.5) + 0.07), glyph: '▲', color: 'var(--warning)', title: `${k} early warning ${clockS(r.t)}` }))),
    ...['mind', 'body', 'fused'].flatMap((k) => series[k].filter((r, i, a) => r.high && !a[i - 1]?.high)
      .map((r) => ({ x: r.t, y: Math.min(0.99, (r.value ?? 0.5) + 0.07), glyph: '▼', color: 'var(--critical)', title: `${k} HIGH ${clockS(r.t)}` }))),
    ...series.mind.filter((r) => r.rejected).map((r) => ({ x: r.t, y: 0.03, glyph: '✕', color: 'var(--muted)', title: `rejected: ${r.rejectReason}` })),
  ];
  const fusedBand = fc ? [fc.baseline + 0.5 * Math.max(0.05, fc.spread), 0.5] : null;

  const send = async (cmd, extra = {}) => { setBusy(true); try { await sendStimulatorCommand(cmd, { profile, scenario, recalibrate: true, ...extra }); } finally { setBusy(false); } };
  const simHere = stim.running && st?.sid === sid;
  const curPhase = st?.phase || (st?.stage || '').replace('live: ', '');
  const recent = series.mind.slice(-10);
  const lastEeg = eeg.blocks[eeg.blocks.length - 1];

  return (
    <div className="page">
      <header className="top">
        <div>
          <div className="view-links">
            <button type="button" className="back-link" onClick={onBack}>← Wearable 02 EEG monitor</button>
            {openFull && <button type="button" className="back-link" onClick={openFull}>Full demo dashboard →</button>}
          </div>
          <p className="eyebrow">MindPulse · technical view · proof of concept</p>
          <h1>Concept dashboard</h1>
        </div>
        <SessionPicker picker={picker} />
      </header>

      {/* 1. Header + controls */}
      <div className={`sd-head ${simHere ? '' : 'idle'}`}>
        <span className="stim-badge">SIMULATED – software-in-the-loop</span>
        {simHere ? (
          <>
            <span><b>{st.profile}</b> · seed {st.seed ?? '—'} · SAM40 subject {st.eeg_subject ?? '—'} · {st.uid}</span>
            <span className={`sd-phase ${stim.demandOn ? 'hi' : ''}`}>{curPhase === 'recovery' && !st.calibrating ? 'Recovery' : PHASE[curPhase] || curPhase}{st.phase_left != null ? ` · ${mmss(st.phase_left)} left` : ''}</span>
            <span className="sd-dev">headband {st.mqtt?.eeg ? '✔' : '✕'} · ring {st.mqtt?.ring ? '✔' : '✕'} · {clockS(st.ts * 1000)}</span>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => send('stop')}>Stop</button>
          </>
        ) : (
          <>
            <span className="muted">{!stim.online ? 'Stimulator program not running (venv/bin/python backend/simulation/live_stimulator.py).' : 'Not simulating: real device data, no ground truth.'}</span>
            <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Profile">
              {Object.entries(STIM_PROFILES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario">
              <option value="four_state">All four states (relaxed, mental load, physical arousal, stress)</option>
              <option value="ramp">Gradual ramp (early warning)</option><option value="steps">Calm / high-load steps</option></select>
            <button type="button" className="btn" disabled={busy || !stim.online || !picker.liveUser || stim.running} onClick={() => send('start')}>Start (calibrates first)</button>
          </>
        )}
      </div>
      {gate.paused || !deciding ? (
        <p className="sd-gate">⏳ <b>Calibrating.</b> Alerts, early warnings and the fused state start once the EEG {ringPresent ? 'and ring ' : ''}calibration is done
          {recalActive && recalReq?.phase ? ` (now: ${recalReq.phase}${recalReq.blocks_needed ? ` ${recalReq.blocks_captured ?? 0}/${recalReq.blocks_needed}` : ''})` : ''}.</p>
      ) : <p className="sd-gate ok">✓ Calibrated {gate.startMs ? clock(gate.startMs) : ''}. Decisions use this user&apos;s own baseline and limits.</p>}

      {/* 4 + 5. Cards + fused state */}
      <div className="cd-top">
        <div className="cd-cards">
          <Card4 title="MIND (EEG)" color={C.mind} row={m} note="cognitive load · value on the 0–1 scale"
            cal={limits.mind ? { ...limits.mind, source: `${limits.mind.source}${gate.eegAt ? ` · ${clock(gate.eegAt)}` : ''}` } : null} />
          <Card4 title="BODY (HRV + GSR)" color={C.body} row={b ? { ...b, reason: b.reason } : (ringBase === null ? { state: 'limited', reason: 'no ring baseline yet' } : null)}
            note="autonomic arousal · value on the 0–1 scale"
            cal={{ ...(limits.body || {}), source: `${limits.body?.source ?? 'population limit (no personal one)'}${ringBase ? ` · ${clock(Date.parse(ringBase))}` : ''}` }} />
          <Card4 title="FUSED" color={C.fused} row={f} note={f ? `${f.basedOn} · weights ${Math.round((f.wEeg ?? 0) * 100)}/${Math.round((f.wRing ?? 0) * 100)}${f.equalWeights ? ` (equal, simulation; engine ${Math.round((f.wEegEngine ?? 0) * 100)}/${Math.round((f.wRingEngine ?? 0) * 100)} → ${f.engineValue?.toFixed(2) ?? '—'})` : ''}` : 'mind + body'}
            cal={limits.fused} />
        </div>
        <Card title="Fused state" subtitle={q ? `${q.label}${q.partial ? ` (${q.partial})` : ''}` : 'after calibration'}
          right={mindLed ? <Status kind="warning">mind-led: mind rising, body still calm</Status> : null}>
          <Quadrant q={q} mind={deciding ? f?.mind ?? m?.value : null} body={deciding ? f?.body ?? b?.value : null} />
          {q?.message && <p className="cq-msg">“{q.message}”</p>}
        </Card>
      </div>

      {/* zoom controls: one time range for every chart below */}
      <div className="cd-zoom">
        <span className="muted">Time range</span>
        {[5, 15, 30].map((mn) => <button key={mn} type="button" className="btn ghost" onClick={() => lastMin(mn)} disabled={!fullDomain}>Last {mn} min</button>)}
        <button type="button" className="btn ghost" onClick={() => setZoom(null)} disabled={!zoom}>All</button>
        <span className="caption">{zoom && xDomain ? `Zoomed: ${clockS(xDomain[0])} – ${clockS(xDomain[1])} · ` : ''}Drag across a chart to zoom into those times; double-click to reset.</span>
      </div>

      {/* 2 + 3. Ground truth and system response, same time axis */}
      <Card title="Ground truth → system response" subtitle="Top: what the simulated person was doing · bottom: what the real pipeline decided (fusion scale, own limit 0.50)">
        {!xDomain ? <div className="chart-empty" style={{ height: 200 }}>No data for this session yet.</div> : (
          <>
            <MultiLineChart points={truthPts} height={150} yDomain={[0, 1]} xDomain={xDomain} xFormat={zoom ? clockS : clock} onZoom={onZoom} yFormat={(v) => `${Math.round(v * 100)}%`}
              bands={bands} ariaLabel="Simulated demand and latent responses"
              series={[{ key: 'd', label: 'Mental demand', color: C.truth, width: 2.5, connect: true },
                { key: 'bd', label: 'Physical arousal', color: 'var(--c5)', width: 2.5, connect: true },
                { key: 'br', label: 'brain', color: C.mind, width: 1.2, dash: true, connect: true },
                { key: 'he', label: 'heart', color: C.body, width: 1.2, dash: true, connect: true },
                { key: 'sk', label: 'skin', color: 'var(--c3)', width: 1.2, dash: true, connect: true }]} />
            <MultiLineChart points={sysPts} height={260} yDomain={[0, 1]} xDomain={xDomain} xFormat={zoom ? clockS : clock} onZoom={onZoom} yFormat={(v) => v.toFixed(2)}
              bands={bands} markers={markers} ariaLabel="Mind, body and fused over time"
              hbands={fusedBand ? [{ y0: fusedBand[0], y1: fusedBand[1], label: 'early-warning band', opacity: 0.09 }] : []}
              refLines={[{ y: 0.5, label: 'limit 0.50' }]}
              series={[{ key: 'mind', label: 'Mind', color: C.mind, width: 2, connect: true },
                { key: 'body', label: 'Body', color: C.body, width: 2, connect: true },
                { key: 'fused', label: 'Fused', color: C.fused, width: 3, connect: true }]} />
          </>
        )}
        <p className="caption">▲ early warning · ▼ HIGH (2 of last 3 above the limit) · ✕ rejected EEG block · grey band: calibrating, no decisions.</p>
      </Card>

      {/* Task scores: the models' own outputs and their calibrated limits */}
      <Card title="Mind and body task scores" subtitle="Each model's own score against this user's calibrated limit (mind on a log scale: the headband's scores are often tiny)">
        {!xDomain ? <div className="chart-empty" style={{ height: 160 }}>No scores for this session yet.</div> : (
          <>
            <h3>Mind (EEG): task-state score</h3>
            <MultiLineChart points={mindScorePts} height={200} xDomain={xDomain} xFormat={zoom ? clockS : clock} onZoom={onZoom}
              yFormat={(v) => fmtScore(10 ** v)} bands={bands} legend={false} ariaLabel="EEG task-state score over time"
              refLines={[...(mindLimitRaw != null ? [{ y: log10Safe(mindLimitRaw), label: `limit ${fmtScore(mindLimitRaw)}` }] : []),
                ...(mindBaseRaw != null ? [{ y: log10Safe(mindBaseRaw), label: `baseline ${fmtScore(mindBaseRaw)}` }] : [])]}
              series={[{ key: 'ms', label: 'EEG score', color: C.mind, width: 2, dots: true }]} />
            <h3>Body (HRV + GSR): stress probability</h3>
            {bodyScorePts.length ? (
              <MultiLineChart points={bodyScorePts} height={180} yDomain={[0, 1]} xDomain={xDomain} xFormat={zoom ? clockS : clock} onZoom={onZoom}
                yFormat={(v) => v.toFixed(2)} bands={bands} legend={false} ariaLabel="Ring stress probability over time"
                refLines={[{ y: ringInfo.limit, label: `limit ${ringInfo.limit?.toFixed(2)}` }, ...(ringInfo.base != null ? [{ y: ringInfo.base, label: `baseline ${ringInfo.base.toFixed(2)}` }] : [])]}
                series={[{ key: 'bs', label: 'ring stress probability', color: C.body, width: 2, dots: true }]} />
            ) : <div className="chart-empty" style={{ height: 120 }}>{ringBase === null ? 'No ring baseline for this user yet, so the ring service skips every window.' : 'No ring windows yet.'}</div>}
            <p className="caption">Gaps in the mind line are blocks the quality gate rejected. The fusion-scale view above puts both on one axis (each limit at 0.50).</p>
          </>
        )}
      </Card>

      <div className="grid-2">
        {/* 6. Calibration */}
        <Card title="Calibration" subtitle="This user's personal baseline and limit"
          right={<Status kind={eegInfo?.status === 'ok' ? 'good' : eegInfo?.status ? 'warning' : 'idle'}>{eegStatusText(eegInfo) || 'not calibrated'}</Status>}>
          {phases.mind ? (
            <MultiLineChart legend={false} height={170} yDomain={[0, 1]} xFormat={(v) => `#${Math.round(v)}`} yFormat={(v) => v.toFixed(2)} ariaLabel="EEG calibration blocks"
              points={[...phases.mind.rest.map((v, i) => ({ x: i + 1, r: sig(Math.max(-3, Math.min(3, v))) })),
                ...phases.mind.task.map((v, i) => ({ x: phases.mind.rest.length + i + 1, t: sig(Math.max(-3, Math.min(3, v))) })),
                ...phases.mind.recovery.map((v, i) => ({ x: phases.mind.rest.length + phases.mind.task.length + i + 1, c: sig(Math.max(-3, Math.min(3, v))) }))]}
              refLines={[{ y: 0.5, label: 'limit' }, ...(phases.mind.levels.rest != null ? [{ y: phases.mind.levels.rest, label: 'baseline' }] : [])]}
              series={[{ key: 'r', label: 'rest', color: C.mind, dots: true, width: 0.01 }, { key: 't', label: 'task', color: 'var(--critical)', dots: true, width: 0.01 },
                { key: 'c', label: 'recovery', color: 'var(--c3)', dots: true, width: 0.01 }]} />
          ) : <div className="chart-empty" style={{ height: 120 }}>No EEG calibration yet.</div>}
          <dl className="sd-dl">
            <div><dt>EEG separation</dt><dd>{eegInfo?.sepSd == null ? '—' : `${eegInfo.sepSd.toFixed(2)} spreads`} · {eegInfo?.dir < 0 ? 'falls under load' : 'rises under load'}</dd></div>
            <div><dt>EEG recovery</dt><dd>{eegInfo?.reversalSd == null ? '—' : `${eegInfo.reversalSd.toFixed(2)} spreads back`}</dd></div>
            <div><dt>Ring baseline / limit</dt><dd>{ringInfo.base?.toFixed(3) ?? '—'} / {ringInfo.limit?.toFixed(3) ?? '—'} ({ringInfo.personal ? 'personal' : 'population'})</dd></div>
            <div><dt>Ring calibrated</dt><dd>{ringBase ? `${Math.round((now - Date.parse(ringBase)) / 60000)} min ago` : 'no baseline'}</dd></div>
          </dl>
        </Card>

        {/* 7. Quality + events */}
        <Card title="Quality & events" subtitle="Quality gates on the live EEG, and what happened when">
          <p className="sd-blocks" title="Last 10 EEG blocks">{recent.map((r) => <i key={r.t} className={r.rejected ? 'rej' : 'acc'} title={`${clockS(r.t)} ${r.rejected ? r.rejectReason : 'accepted'}`}>{r.rejected ? '✕' : '✔'}</i>)}</p>
          <p className="caption">RMS {lastEeg?.eeg_std_uv_unclamped != null ? `${Number(lastEeg.eeg_std_uv_unclamped).toFixed(1)} µV` : '—'} ·
            rejected {series.mind.filter((r) => r.rejected).length} of {series.mind.length} blocks</p>
          <ol className="sd-log short">
            {events.slice(-10).map((e, i) => <li key={`${e.t}-${i}`} className={`ev-${e.kind}`} title={e.title}><time>{clockS(e.t)}</time>{e.text}</li>)}
          </ol>
        </Card>
      </div>
    </div>
  );
}
