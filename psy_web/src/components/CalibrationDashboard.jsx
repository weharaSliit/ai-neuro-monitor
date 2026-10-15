import { useMemo, useState } from 'react';
import { MultiLineChart } from './charts';
import { Card, SessionPicker, Status, ago } from './panels';
import { useFirebaseValue, useSessionData, useSessionPicker } from '../hooks/useData';
import { usePhysioData } from '../hooks/usePhysio';
import { useFusionData } from '../hooks/useFusion';
import useEegCalibrations from '../hooks/useEegCalibrations';
import RecalibratePanel from './RecalibratePanel';
import { keyToMs } from '../lib/fusion';
import { fmt } from '../lib/model';
import {
  TASK_SKIP_RING, dShow, eegAligned, eegD, eegLimitInfo, lgt, mean, median, num, persistent, pickEeg, plausible, ringAligned, ringLimitInfo, sig,
} from '../lib/limits';

const C = { eeg: 'var(--c1)', hrv: 'var(--c2)', fused: 'var(--c7)', mean: 'var(--ink)', task: 'var(--c4)', rec: 'var(--c3)' };
const clock = (ms) => (ms == null ? '—' : new Date(ms).toLocaleTimeString());
// ── Scales ──────────────────────────────────────────────────────────
// EEG is shown on the FUSION scale only (fusion_engin.py): its distance from
// the person's own rest in log-odds spreads, z = (logit p - rest) / 0.55,
// mapped to sigmoid(z - 0.84). Rest sits at 0.30, the high-load limit at
// 0.50, whatever the headband's raw score range (often ~1e-4).
// ── Calibration graph: rest / task / recovery points + running means ──
// `show` maps the underlying values (EEG: z) to the plotted scale; running
// means are taken on the underlying scale first, so the mean line ends at
// the settled value (EEG rest: exactly 0.30) instead of a skewed average.
// Every calibration phase for mind, body and fused. EEG and body are put on
// the fusion scale (own limit = 0.50); fused = their equal-weight average,
// windows matched by position within each phase (the two calibrations don't
// share timestamps). With one input the fused value is that input, as in the
// fusion engine when the other has weight 0.
function calibrationPhases(cal, thr, eegInfo, ring, ringInfo) {
  const P = (a) => (a || []).map(num);
  const out = {};
  if (eegInfo) {
    const d = (arr) => P(arr).map((p) => eegD(p, eegInfo)).filter((v) => v != null);
    const at = (L) => (L == null ? null : dShow((L - eegInfo.limitL) / eegInfo.sd));
    const recP = P(thr?.recovery_scores).filter(plausible);
    const rest = d(thr?.rest_scores || cal?.rest_scores); const task = d(thr?.task_scores); const recovery = d(thr?.recovery_scores);
    out.mind = { rest, task, recovery, skip: eegInfo.skipped || 0, show: dShow, limit: 0.5,
      // recovery level = mean score, as the backend judges recovery
      levels: { rest: at(eegInfo.level), task: at(eegInfo.taskL), recovery: recP.length ? at(lgt(mean(recP))) : null } };
  }
  const t = ring.thresholds;
  const rr = P(t?.resting_scores).filter((v) => v != null); const rt = P(t?.task_scores).filter((v) => v != null);
  const rc = P(t?.task_result?.recovery_scores).filter((v) => v != null);
  if (rr.length) {
    const skip = rt.length ? Math.min(TASK_SKIP_RING, Math.floor(rt.length / 2)) : 0;
    out.bodyRaw = { rest: rr, task: rt, recovery: rc, skip, limit: ringInfo.limit,
      levels: { rest: ringInfo.base, task: ringInfo.taskLevel, recovery: rc.length ? mean(rc) : null } };
    const al = (v) => ringAligned(v, ringInfo.limit);
    out.body = { rest: rr.map(al), task: rt.map(al), recovery: rc.map(al), skip, limit: 0.5,
      levels: { rest: al(ringInfo.base), task: ringInfo.taskLevel == null ? null : al(ringInfo.taskLevel), recovery: rc.length ? al(mean(rc)) : null } };
  }
  const m = out.mind && { rest: out.mind.rest.map(dShow), task: out.mind.task.map(dShow), recovery: out.mind.recovery.map(dShow) };
  const b = out.body;
  if (m || b) {
    const pair = (x = [], y = []) => {
      const n = Math.max(x.length, y.length);
      return Array.from({ length: n }, (_, i) => mean([x.length ? x[Math.floor((i * x.length) / n)] : null,
        y.length ? y[Math.floor((i * y.length) / n)] : null].filter((v) => v != null)));
    };
    const rest = pair(m?.rest, b?.rest); const task = pair(m?.task, b?.task); const recovery = pair(m?.recovery, b?.recovery);
    const frac = Math.max(m?.task.length ? out.mind.skip / m.task.length : 0, b?.task.length ? b.skip / b.task.length : 0);
    const skip = Math.min(Math.round(task.length * frac), Math.floor(task.length / 2));
    out.fused = { rest, task, recovery, skip, limit: 0.5, inputs: m && b ? 'mind + body' : m ? 'mind only' : 'body only',
      levels: { rest: rest.length ? median(rest) : null, task: task.length > skip ? mean(task.slice(skip)) : null,
        recovery: recovery.length ? mean(recovery) : null } };
  }
  return out;
}

// All three trends on one chart; x = position within each phase, so the
// different block/window counts line up phase by phase.
function TrendCard({ phases }) {
  const comps = [['mind', 'Mind (EEG)', C.eeg], ['body', 'Body (HRV + GSR)', C.hrv], ['fused', 'Fused', C.fused]]
    .filter(([k]) => phases[k]);
  const pts = [];
  comps.forEach(([k]) => {
    const p = phases[k]; const show = p.show || ((v) => v);
    [p.rest, p.task, p.recovery].forEach((arr, ph) => arr.forEach((_, i) => {
      const win = arr.slice(Math.max(0, i - 2), i + 1);
      pts.push({ x: ph + (i + 0.5) / arr.length, [k]: show(mean(win)) });
    }));
  });
  pts.sort((a, b) => a.x - b.x);
  const row = (k) => phases[k]?.levels;
  const f2 = (v) => (v == null ? '—' : v.toFixed(2));
  return (
    <Card title="Calibration trend: rest → task → recovery" subtitle="All three on the fusion scale: baseline below, each component's own limit at 0.50">
      {!comps.length ? <div className="chart-empty" style={{ height: 200 }}>No calibration yet. Recalibrate below.</div> : (
        <MultiLineChart points={pts} height={260} yDomain={[0, 1]} xDomain={[0, 3]} xFormat={() => ''} yFormat={(v) => v.toFixed(2)}
          bands={[{ x0: 0, x1: 1, label: 'Rest', kind: 'a' }, { x0: 1, x1: 2, label: 'Task', kind: 'b' }, { x0: 2, x1: 3, label: 'Recovery', kind: 'a' }]}
          refLines={[{ y: 0.5, label: 'limit' }]} ariaLabel="Calibration trend for mind, body and fused"
          series={comps.map(([k, l, c]) => ({ key: k, label: l, color: c, width: k === 'fused' ? 3 : 2, dash: k === 'fused', connect: true }))} />
      )}
      {comps.length > 0 && (
        <table className="phase-table">
          <thead><tr><th /><th>Baseline</th><th>Sustained task</th><th>Recovery</th><th>Rose in task</th><th>Dropped after</th></tr></thead>
          <tbody>
            {comps.map(([k, l]) => {
              const L = row(k); const up = L.task != null && L.task > L.rest && L.task >= 0.5;
              const dn = L.recovery != null && L.task != null && L.recovery < L.task && L.recovery < 0.5;
              return (
                <tr key={k}>
                  <th>{l}{k === 'fused' ? <small> · {phases.fused.inputs}</small> : null}</th>
                  <td>{f2(L.rest)}</td><td>{f2(L.task)}</td><td>{f2(L.recovery)}</td>
                  <td className={L.task == null ? 'muted' : up ? 'ok' : 'bad'}>{L.task == null ? '—' : up ? 'yes' : 'no'}</td>
                  <td className={L.recovery == null ? 'muted' : dn ? 'ok' : 'bad'}>{L.recovery == null ? '—' : dn ? 'yes' : 'no'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Top cards: score, label and rising alert per component ─────────
function NowCard({ title, value, valueNote, label, high, alert, color }) {
  return (
    <div className={`now-card${alert ? ' has-alert' : ''}`} style={{ borderTopColor: color }}>
      <span className="now-title">{title}</span>
      <span className="now-value">{value}</span>
      <span className="now-note">{valueNote}</span>
      <span className={`level-pill lvl-${high == null ? 'none' : high ? 'high' : 'low'}`}>{label}</span>
      {alert && <p className="now-alert">▲ {alert}</p>}
    </div>
  );
}

function NowCards({ eeg, ring, fusion, eegInfo, ringInfo }) {
  const scored = eeg.blocks.filter((b) => b.task_state_score != null);
  const lastE = scored[scored.length - 1];
  const lastR = ring.windows[ring.windows.length - 1];
  const fw = fusion.windows.filter((w) => w.fused_probability != null);
  const lastF = fw[fw.length - 1];
  const eA = lastE ? eegAligned(lastE.task_state_score, eegInfo) : null;
  const mindHigh = persistent(scored.map((b) => { const a = eegAligned(b.task_state_score, eegInfo); return a == null ? null : a >= 0.5; }));
  const bodyHigh = persistent(ring.windows.map((w) => (w.prob_stress == null ? null : w.prob_stress >= ringInfo.limit)));
  const fusedHigh = lastF?.fused_high_persistent ?? persistent(fw.map((w) => w.fused_probability >= 0.5));
  const eegAlert = lastE?.fatigue_warning ? 'Fatigue: high load for over 25 min'
    : lastE?.micro_break_recommended ? 'Take a micro-break: high load for 8 min'
      : (lastE?.high_load_alert || mindHigh) ? 'High mental load (2 of the last 3 blocks)' : null;
  // Which inputs this fused value rests on; with one input it IS that input.
  const hasMind = lastF?.prob_eeg != null && num(lastF?.eeg_weight) > 0;
  const hasBody = lastF?.prob_hrv_gsr != null && num(lastF?.hrv_gsr_weight) > 0;
  const fusedNote = !lastF ? 'limit 0.50' : `limit 0.50 · ${hasMind && hasBody ? 'mind + body' : hasMind ? 'mind only (body not reporting)' : hasBody ? 'body only (mind not reporting)' : 'no input'}`
    + (eegInfo?.src === 'computed' && hasMind ? ' · live EEG limit differs until redeploy' : '');
  const fusedAlert = lastF?.stress_alert_message
    || (fusedHigh ? 'High stress (2 of the last 3 windows)' : lastF?.stress_phase === 'trending_towards_stress' ? 'Stress is rising towards the limit' : null);
  return (
    <div className="now-grid">
      <NowCard title="Mind (EEG) · task state" color={C.eeg} value={eA == null ? '—' : eA.toFixed(2)} valueNote="fusion scale · limit 0.50"
        high={mindHigh} label={mindHigh == null ? 'No score' : mindHigh ? 'High task load' : 'Low task load'} alert={eegAlert} />
      <NowCard title="Body (HRV + GSR) · stress" color={C.hrv} value={lastR?.prob_stress == null ? '—' : lastR.prob_stress.toFixed(2)}
        valueNote={`limit ${fmt(ringInfo.limit, 2)}`}
        high={bodyHigh} label={bodyHigh == null ? 'No window' : bodyHigh ? 'Stressed' : 'Normal'}
        alert={bodyHigh ? 'Body stress (2 of the last 3 windows)' : lastR?.trending_toward_stress ? 'Body signals trending toward stress' : null} />
      <NowCard title="Fused · stress" color={C.fused} value={lastF ? lastF.fused_probability.toFixed(2) : '—'} valueNote={fusedNote}
        high={fusedHigh} label={fusedHigh == null ? 'No window' : fusedHigh ? 'High stress' : 'Normal'} alert={fusedAlert} />
    </div>
  );
}

const when = (sec, now) => (sec ? ago(sec * 1000, now) : '—');

// ── The 6 calibration graphs: one line over time + the settled value(s) ──
// Line = each block/window in order (rest, then task, then recovery, shaded);
// horizontal lines = the settled values chosen: the baseline (median of rest)
// and, on the threshold graphs, the high-load threshold.
function SimpleCalGraph({ rest = [], task = [], recovery = [], baseline, threshold, color, label, empty, f = (v) => v.toFixed(2) }) {
  const vals = [...rest, ...task, ...recovery];
  if (!vals.length) return <div className="chart-empty" style={{ height: 200 }}>{empty}</div>;
  const nR = rest.length; const nT = task.length;
  const bands = [];
  if (nT || recovery.length) {
    bands.push({ x0: 0.5, x1: nR + 0.5, label: 'Rest', kind: 'a' });
    if (nT) bands.push({ x0: nR + 0.5, x1: nR + nT + 0.5, label: 'Task', kind: 'b' });
    if (recovery.length) bands.push({ x0: nR + nT + 0.5, x1: vals.length + 0.5, label: 'Recovery', kind: 'a' });
  }
  const refLines = [
    ...(baseline != null ? [{ y: baseline, label: `baseline ${f(baseline)}` }] : []),
    ...(threshold != null ? [{ y: threshold, label: `threshold ${f(threshold)}` }] : []),
  ];
  const top = Math.max(1, ...vals);
  return (
    <MultiLineChart points={vals.map((v, i) => ({ x: i + 1, v }))} height={220} yDomain={[0, top > 1 ? top : 1]}
      xDomain={[0.5, vals.length + 0.5]} xFormat={(v) => `#${Math.round(v)}`} yFormat={(v) => v.toFixed(2)}
      bands={bands} refLines={refLines} legend={false} ariaLabel={label}
      series={[{ key: 'v', label: 'Score', color, width: 2, dots: true }]} />
  );
}

// The settled values under each graph, nothing else.
function Settled({ items }) {
  return (
    <div className="settled">
      {items.filter(Boolean).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
    </div>
  );
}
const f2 = (v) => (v == null ? '—' : v.toFixed(2));

// EEG on the fusion scale (own threshold = 0.50); body on its own probability scale.
function EegBaselineCard({ cal, info, ph, now }) {
  const rest = (ph?.rest || []).map(dShow);
  return (
    <Card title="EEG resting baseline" subtitle="Settled value = median of the rest blocks"
      right={<Status kind={info ? 'good' : 'idle'}>{info ? `calibrated ${when(cal.updated_at, now)}` : 'not calibrated'}</Status>}>
      <SimpleCalGraph rest={rest} baseline={ph?.levels.rest} color={C.eeg} label="EEG rest blocks"
        empty={cal ? 'This calibration has no per-block rest scores. Recalibrate.' : 'No EEG calibration yet. Recalibrate below.'} />
      {ph && <Settled items={[['Baseline', f2(ph.levels.rest)], ['Rest blocks', rest.length]]} />}
    </Card>
  );
}

function EegThresholdCard({ info, ph }) {
  const ran = Boolean(ph?.task.length);
  return (
    <Card title="EEG high-load threshold" subtitle="Settled value = midpoint of the baseline and the sustained task"
      right={<Status kind={!ran ? 'idle' : info?.responsive ? 'good' : 'warning'}>
        {!ran ? 'task not run yet' : info?.responsive ? 'responsive' : 'not responsive'}</Status>}>
      <SimpleCalGraph rest={(ph?.rest || []).map(dShow)} task={(ph?.task || []).map(dShow)} recovery={(ph?.recovery || []).map(dShow)}
        baseline={ph?.levels.rest} threshold={ph ? 0.5 : null} color={C.eeg} label="EEG rest, task and recovery"
        empty="No EEG calibration yet. Recalibrate below." />
      {ph && <Settled items={[['Baseline', f2(ph.levels.rest)], ['Sustained task', f2(ph.levels.task)],
        ['Threshold', `0.50${info?.responsive ? '' : ' (provisional)'}`]]} />}
    </Card>
  );
}

function HrvBaselineCard({ ring, ph, now }) {
  const setAt = ring.thresholds?.resting_scores_updated_at ? Date.parse(ring.thresholds.resting_scores_updated_at) / 1000 : null;
  return (
    <Card title="HRV/GSR resting baseline" subtitle="Settled value = median of the resting windows"
      right={<Status kind={ph ? 'good' : 'idle'}>{ph ? `calibrated ${when(setAt, now)}` : 'no baseline'}</Status>}>
      <SimpleCalGraph rest={ph?.rest} baseline={ph?.levels.rest} color={C.hrv} label="HRV/GSR resting windows"
        empty="No ring calibration for this user." f={(v) => v.toFixed(3)} />
      {ph && <Settled items={[['Baseline', fmt(ph.levels.rest, 3)], ['Rest windows', ph.rest.length]]} />}
    </Card>
  );
}

function HrvThresholdCard({ info, ph }) {
  return (
    <Card title="HRV/GSR high-load threshold" subtitle="Settled value = midpoint of the baseline and the sustained task"
      right={<Status kind={!info.ran ? 'idle' : info.personal ? 'good' : 'warning'}>
        {!info.ran ? 'task not run yet' : info.personal ? 'responsive' : 'not separated'}</Status>}>
      <SimpleCalGraph rest={ph?.rest} task={ph?.task} recovery={ph?.recovery} baseline={ph?.levels.rest} threshold={ph?.limit}
        color={C.hrv} label="HRV/GSR rest, task and recovery" empty="No ring calibration for this user." f={(v) => v.toFixed(3)} />
      {ph && <Settled items={[['Baseline', fmt(ph.levels.rest, 3)], ['Sustained task', fmt(ph.levels.task, 3)],
        ['Threshold', `${fmt(ph.limit, 3)}${info.personal ? '' : ' (population)'}`]]} />}
    </Card>
  );
}

function FusedBaselineCard({ ph }) {
  return (
    <Card title="Fused resting baseline" subtitle="Settled value = median of the fused rest values"
      right={<Status kind={ph?.rest.length ? 'good' : 'idle'}>{ph?.rest.length ? ph.inputs : 'not calibrated'}</Status>}>
      <SimpleCalGraph rest={ph?.rest} baseline={ph?.levels.rest} color={C.fused} label="Fused rest values"
        empty="No mind or body calibration yet. Recalibrate below." />
      {ph?.rest.length > 0 && <Settled items={[['Baseline', f2(ph.levels.rest)], ['Rest values', ph.rest.length]]} />}
    </Card>
  );
}

function FusedThresholdCard({ ph }) {
  const ran = Boolean(ph?.task.length);
  return (
    <Card title="Fused high-load threshold" subtitle="Mind and body each at their own threshold, so the fused threshold is 0.50"
      right={<Status kind={!ran ? 'idle' : ph.levels.task >= 0.5 ? 'good' : 'warning'}>
        {!ran ? 'task not run yet' : ph.levels.task >= 0.5 ? 'task crossed it' : 'task stayed below'}</Status>}>
      <SimpleCalGraph rest={ph?.rest} task={ph?.task} recovery={ph?.recovery} baseline={ph?.levels.rest} threshold={ph ? 0.5 : null}
        color={C.fused} label="Fused rest, task and recovery" empty="No mind or body calibration yet. Recalibrate below." />
      {ph && <Settled items={[['Baseline', f2(ph.levels.rest)], ['Sustained task', f2(ph.levels.task)], ['Threshold', '0.50']]} />}
    </Card>
  );
}

// ── Scores and labels over the session (all on the fusion scale) ───
function LabelStrip({ items, x0, x1, label }) {
  const span = x1 - x0 || 1;
  return (
    <div className="label-strip">
      <span className="label-strip-name">{label}</span>
      <div className="label-strip-track">
        {items.map((it, i) => {
          const next = items[i + 1]?.t ?? Math.min(x1, it.t + 25000);
          return <i key={`${it.t}-${i}`} title={it.title} className={it.on == null ? 'na' : it.on ? 'on' : 'off'}
            style={{ left: `${((it.t - x0) / span) * 100}%`, width: `${Math.max(0.4, ((next - it.t) / span) * 100)}%` }} />;
        })}
      </div>
    </div>
  );
}

function ScoresCard({ eeg, ring, fusion, eegInfo, ringInfo, xDomain }) {
  const pts = [
    ...eeg.blocks.filter((b) => b.timestamp_end).map((b) => ({ x: b.timestamp_end * 1000, e: eegAligned(b.task_state_score, eegInfo) })),
    ...ring.windows.filter((w) => w.t).map((w) => ({ x: w.t, h: ringAligned(w.prob_stress, ringInfo.limit) })),
    ...fusion.windows.map((w) => ({ x: keyToMs(w.key), f: w.fused_probability ?? null })),
  ].sort((a, b) => a.x - b.x);
  const strip = (arr) => arr.map((p) => ({ t: p.x, on: p.v == null ? null : p.v >= 0.5, title: `${clock(p.x)}: ${p.v == null ? '—' : p.v.toFixed(2)}` }));
  return (
    <Card title="Task / stress label and score" subtitle="All three on the fusion scale: each component's own limit is 0.50">
      {!xDomain ? <div className="chart-empty" style={{ height: 220 }}>No data for this session yet.</div> : (
        <>
          <MultiLineChart points={pts} height={300} yDomain={[0, 1]} xDomain={xDomain} xFormat={clock} yFormat={(v) => v.toFixed(2)}
            refLines={[{ y: 0.5, label: 'limit 0.50' }]} ariaLabel="Mind, body and fused scores over the session"
            series={[{ key: 'e', label: 'Mind (EEG)', color: C.eeg, width: 2, connect: true },
              { key: 'h', label: 'Body (HRV + GSR)', color: C.hrv, width: 2, connect: true },
              { key: 'f', label: 'Fused', color: C.fused, width: 3, connect: true }]} />
          <p className="caption">Above 0.50 = above that component&apos;s own limit. Breaks in a line are blocks the quality gate rejected.</p>
          <div className="label-strips">
            <LabelStrip label="Mind: high load" x0={xDomain[0]} x1={xDomain[1]} items={strip(pts.filter((p) => 'e' in p).map((p) => ({ x: p.x, v: p.e })))} />
            <LabelStrip label="Body: stressed" x0={xDomain[0]} x1={xDomain[1]} items={strip(pts.filter((p) => 'h' in p).map((p) => ({ x: p.x, v: p.h })))} />
            <LabelStrip label="Fused: high stress" x0={xDomain[0]} x1={xDomain[1]} items={strip(pts.filter((p) => 'f' in p).map((p) => ({ x: p.x, v: p.f })))} />
          </div>
        </>
      )}
    </Card>
  );
}

// ── Rising alerts timeline ────────────────────────────────────────
function AlertsCard({ eeg, ring, fusion, xDomain }) {
  const lanes = [
    { name: 'Mind · high load', color: C.eeg, ev: eeg.blocks.filter((b) => b.high_load_alert).map((b) => b.timestamp_end * 1000) },
    { name: 'Mind · micro-break', color: C.eeg, ev: eeg.blocks.filter((b) => b.micro_break_recommended).map((b) => b.timestamp_end * 1000) },
    { name: 'Body · trending to stress', color: C.hrv, ev: ring.windows.filter((w) => w.trending_toward_stress && w.t).map((w) => w.t) },
    { name: 'Fused · trending to stress', color: C.fused, ev: fusion.windows.filter((w) => w.stress_phase === 'trending_towards_stress').map((w) => keyToMs(w.key)) },
    { name: 'Fused · rising stress', color: C.fused, ev: fusion.windows.filter((w) => w.stress_phase === 'increasing_stress_alert').map((w) => keyToMs(w.key)) },
  ];
  const W = 1000; const lh = 26; const left = 220;
  const sx = (t) => left + ((t - xDomain[0]) / ((xDomain[1] - xDomain[0]) || 1)) * (W - left - 10);
  return (
    <Card title="Rising alerts">
      {!xDomain ? <div className="chart-empty" style={{ height: 120 }}>No data for this session yet.</div> : (
        <svg viewBox={`0 0 ${W} ${lanes.length * lh + 22}`} width="100%" role="img" aria-label="Rising alerts over the session">
          {lanes.map((l, i) => (
            <g key={l.name}>
              <text x={0} y={i * lh + 17} className="tick">{l.name} ({l.ev.length})</text>
              <line x1={left} x2={W - 10} y1={i * lh + 13} y2={i * lh + 13} className="grid" />
              {l.ev.map((t) => <rect key={t} x={sx(t) - 3} y={i * lh + 5} width={6} height={16} rx={2} fill={l.color}><title>{`${l.name} · ${clock(t)}`}</title></rect>)}
            </g>
          ))}
          {[0, 0.5, 1].map((f) => { const t = xDomain[0] + f * (xDomain[1] - xDomain[0]); return <text key={f} x={sx(t)} y={lanes.length * lh + 16} textAnchor="middle" className="tick">{clock(t)}</text>; })}
        </svg>
      )}
    </Card>
  );
}

// ── Extracted features ────────────────────────────────────────────
function FeatureGraph({ title, rows, color, baseline, xDomain }) {
  const keys = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.f || {})))].sort(), [rows]);
  const [pick, setPick] = useState(null);
  const k = keys.includes(pick) ? pick : keys[0];
  const b = baseline?.[k]?.mean;
  return (
    <div>
      <div className="chart-head">
        <h3 className="section-title">{title}</h3>
        <select value={k || ''} onChange={(e) => setPick(e.target.value)} aria-label={`${title} feature`}>
          {keys.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      {!keys.length ? <div className="chart-empty" style={{ height: 190 }}>No features yet.</div> : (
        <MultiLineChart points={rows.map((r) => ({ x: r.t, v: r.f?.[k] ?? null }))} height={190} xDomain={xDomain} xFormat={clock}
          yFormat={(v) => fmt(v, 3)} legend={false} ariaLabel={`${k} over time`}
          refLines={b != null ? [{ y: b, label: 'baseline' }] : []} series={[{ key: 'v', label: k, color, dots: true }]} />
      )}
    </div>
  );
}

export default function CalibrationDashboard({ now, onBack }) {
  const picker = useSessionPicker();
  const uid = picker.userId; const sid = picker.sessionId;
  const eeg = useSessionData(uid, sid);
  const ring = usePhysioData(uid, sid);
  const fusion = useFusionData(uid, sid);
  const history = useEegCalibrations(uid, `${sid}|${eeg.calibration?.updated_at ?? ''}`);
  const device = useFirebaseValue('eeg_devices/wearable02');
  const streaming = device?.last_seen != null && now / 1000 - device.last_seen < 60;

  const { cal, thr } = pickEeg(eeg, history, sid);
  const eegInfo = eegLimitInfo(cal, thr);
  const ringInfo = ringLimitInfo(ring);
  const phases = calibrationPhases(cal, thr, eegInfo, ring, ringInfo);
  const xDomain = useMemo(() => {
    const ts = [...eeg.blocks.map((b) => (b.timestamp_end ? b.timestamp_end * 1000 : null)), ...ring.windows.map((w) => w.t),
      ...fusion.windows.map((w) => keyToMs(w.key))].filter((t) => t != null && Number.isFinite(t));
    return ts.length >= 2 ? [Math.min(...ts), Math.max(...ts)] : null;
  }, [eeg.blocks, ring.windows, fusion.windows]);

  return (
    <div className="page">
      <header className="top">
        <div>
          <button type="button" className="back-link" onClick={onBack}>← Wearable 02 EEG monitor</button>
          <h1>Calibration, scores &amp; alerts</h1>
        </div>
        <SessionPicker picker={picker} />
      </header>

      <NowCards eeg={eeg} ring={ring} fusion={fusion} eegInfo={eegInfo} ringInfo={ringInfo} />

      <TrendCard phases={phases} />
      <div className="grid-2">
        <EegBaselineCard cal={cal} info={eegInfo} ph={phases.mind} now={now} />
        <EegThresholdCard info={eegInfo} ph={phases.mind} />
        <HrvBaselineCard ring={ring} ph={phases.bodyRaw} now={now} />
        <HrvThresholdCard info={ringInfo} ph={phases.bodyRaw} />
        <FusedBaselineCard ph={phases.fused} />
        <FusedThresholdCard ph={phases.fused} />
      </div>
      <ScoresCard eeg={eeg} ring={ring} fusion={fusion} eegInfo={eegInfo} ringInfo={ringInfo} xDomain={xDomain} />
      <AlertsCard eeg={eeg} ring={ring} fusion={fusion} xDomain={xDomain} />
      <Card title="Extracted features">
        <div className="grid-2">
          <FeatureGraph title="EEG" color={C.eeg} xDomain={xDomain}
            rows={eeg.blocks.filter((b) => b.timestamp_end && b.features_eeg?.bipolar).map((b) => ({ t: b.timestamp_end * 1000, f: b.features_eeg.bipolar }))} />
          <FeatureGraph title="HRV / GSR" color={C.hrv} xDomain={xDomain} baseline={ring.baseline}
            rows={ring.windows.filter((w) => w.t && w.features).map((w) => ({ t: w.t, f: w.features }))} />
        </div>
      </Card>
      <RecalibratePanel picker={picker} now={now} streaming={streaming} />
    </div>
  );
}
