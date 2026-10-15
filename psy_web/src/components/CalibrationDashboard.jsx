import { useMemo, useState } from 'react';
import { MultiLineChart, fmtScore } from './charts';
import { Card, KV, SessionPicker, Stat, Status, ago } from './panels';
import { useFirebaseValue, useSessionData, useSessionPicker } from '../hooks/useData';
import { usePhysioData } from '../hooks/usePhysio';
import { useFusionData } from '../hooks/useFusion';
import useEegCalibrations from '../hooks/useEegCalibrations';
import RecalibratePanel from './RecalibratePanel';
import { keyToMs } from '../lib/fusion';
import { fmt, previewGain, previewScore } from '../lib/model';
import { effectiveThreshold } from '../lib/ring';
import { PERSONAL_THRESHOLD_MIN_SEPARATION, POPULATION_HIGH_LOAD_P, STRESS_DECISION_THRESHOLD } from '../lib/config';

// Personal Scale constants (backend/psychological/sam40/decision.py).
const SIGMA = 0.161;            // probability-scale Personal Scale (older calibrations)
const SIGMA_LOGIT = 0.55;       // log-odds Personal Scale (default since the near-zero-score fix)
const lgt = (p) => { const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9); return Math.log(q / (1 - q)); };
const sig = (x) => 1 / (1 + Math.exp(-x));
// Personal limit k spreads above rest, on the calibration's own scale.
function limitAt(cal, k) {
  if (!cal) return null;
  const mu = num(cal.mu_rest) ?? num(cal.resting_calibrated_p);
  if (cal.personal_scale === 'logit') {
    const lvl = num(cal.mu_rest_logit) ?? (mu == null ? null : lgt(mu));
    return lvl == null ? null : sig(lvl + k * (num(cal.sigma) || SIGMA_LOGIT));
  }
  return mu == null ? null : Math.min(1, mu + k * (num(cal.sigma) || SIGMA));
}
const scaleText = (cal) => (cal?.personal_scale === 'logit' ? 'log-odds, σ 0.55' : 'probability, σ 0.161');
const K_ALERT = 0.84;
const MIN_TASK_Z = 0.5;
const FUSION_BASELINE_N = 3;            // fusion_live_session.py BASELINE_N

const C = { eeg: 'var(--c1)', hrv: 'var(--c2)', fused: 'var(--c7)', mean: 'var(--ink)', task: 'var(--c4)' };
const clockMs = (ms) => (ms == null ? '—' : new Date(ms).toLocaleTimeString());
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// Calibration points: rest blocks then task blocks, with the running mean of
// each phase so the chart shows the estimate settling block by block.
function calibPoints(rest = [], task = [], recovery = []) {
  const pts = []; let sum = 0;
  rest.forEach((v, i) => { sum += v; pts.push({ x: i + 1, rest: v, restMean: sum / (i + 1) }); });
  sum = 0;
  task.forEach((v, i) => { sum += v; pts.push({ x: rest.length + i + 1, task: v, taskMean: sum / (i + 1) }); });
  sum = 0;
  recovery.forEach((v, i) => { sum += v; pts.push({ x: rest.length + task.length + i + 1, rec: v, recMean: sum / (i + 1) }); });
  return pts;
}
function phaseBands(nRest, nTask, nRec = 0) {
  const b = [];
  if (nRest) b.push({ x0: 0.5, x1: nRest + 0.5, label: 'Rest', kind: 'a' });
  if (nTask) b.push({ x0: nRest + 0.5, x1: nRest + nTask + 0.5, label: 'Task', kind: 'b' });
  if (nRec) b.push({ x0: nRest + nTask + 0.5, x1: nRest + nTask + nRec + 0.5, label: 'Recovery', kind: 'a' });
  return b;
}
const Empty = ({ children, height = 220 }) => <div className="chart-empty" style={{ height }}>{children}</div>;

function CalibGraph({ rest = [], task = [], recovery = [], refLines = [], height = 230, color, ariaLabel, yFormat = (v) => v.toFixed(2) }) {
  const raw = calibPoints(rest, task, recovery);
  const vals = [...rest, ...task, ...recovery, ...refLines.map((r) => r.y)].filter((v) => v != null && v > 0);
  // Scores near 0 (wearable02) are invisible on a linear axis: plot log10.
  const useLog = vals.length > 0 && Math.max(...vals) < 0.05;
  const tf = (v) => (v == null ? null : useLog ? Math.log10(Math.max(v, 1e-12)) : v);
  const pts = raw.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === 'x' ? v : tf(v)])));
  const tv = vals.map(tf); const lo = Math.min(...tv); const hi = Math.max(...tv);
  const pad = useLog ? 0.3 : Math.max(0.02, (hi - lo) * 0.15);
  return (
    <MultiLineChart points={pts} height={height} ariaLabel={ariaLabel}
      yDomain={useLog ? [lo - pad, hi + pad] : [Math.max(0, lo - pad), Math.min(1, hi + pad)]} xDomain={[0.5, pts.length + 0.5]}
      xTicks={pts.map((p) => p.x)} xFormat={(v) => `#${v}`} yFormat={useLog ? (v) => fmtScore(10 ** v) : yFormat}
      bands={phaseBands(rest.length, task.length, recovery.length)} refLines={refLines.map((r) => ({ ...r, y: tf(r.y) }))}
      series={[
        { key: 'rest', label: 'Rest block score', color, width: 1, dots: true },
        { key: 'restMean', label: 'Running rest mean', color: C.mean, width: 2.5 },
        ...(task.length ? [
          { key: 'task', label: 'Task block score', color: C.task, width: 1, dots: true },
          { key: 'taskMean', label: 'Running task mean', color: C.task, dash: true, width: 2.5 },
        ] : []),
        ...(recovery.length ? [
          { key: 'rec', label: 'Recovery block score', color: C.hrv, width: 1, dots: true },
          { key: 'recMean', label: 'Running recovery mean', color: C.hrv, dash: true, width: 2.5 },
        ] : []),
      ]} />
  );
}

// ── 1 + 2. EEG ─────────────────────────────────────────────────────
// Both EEG graphs are per USER: the selected session's calibration when it
// has one, else the user's latest calibration from another session. The
// "across calibrations" chart shows how the value moved between sessions.
// Resting level of a calibration: mu_rest, or the older resting_calibrated_p
// when it is a plausible probability (saturated ~1e-61 values are not).
const PLAUSIBLE = 1e-6;
const muOf = (c) => {
  const v = num(c?.mu_rest) ?? num(c?.resting_calibrated_p);
  return v != null && v >= PLAUSIBLE && v <= 1 - PLAUSIBLE ? v : null;
};
const isCal = (c) => c && (c.status === 'ok' || c.status === 'degraded') && muOf(c) != null;
const sessionLabel = (sid) => (sid ? sid.replace('session_', '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2}).*/, '$3/$2 $4:$5') : '—');

function pickEeg(eeg, sid, history) {
  const cals = history.items.filter((i) => isCal(i.cal));
  const thrs = history.items.filter((i) => i.thr && (i.thr.status === 'ok' || i.thr.status === 'not_separated'));
  const cal = isCal(eeg.calibration) ? { sid, cal: eeg.calibration } : cals[cals.length - 1] || null;
  const thr = eeg.threshold ? { sid, thr: eeg.threshold } : thrs[thrs.length - 1] || null;
  // Newest calibration ATTEMPT (any outcome): this session's, else the user's last.
  const attempts = history.items.filter((i) => i.cal);
  const latest = eeg.calibration ? { sid, cal: eeg.calibration } : attempts[attempts.length - 1] || null;
  return { cal, thr, cals, thrs, latest, nAttempts: attempts.length };
}

// Explains a newest calibration that ran but gave no usable resting level.
function UnusableNote({ latest, src }) {
  const c = latest?.cal;
  if (!c || isCal(c) || (src && src.sid === latest.sid)) return null;
  const why = c.status === 'failed' ? 'no rest block passed the quality gate'
    : c.n_implausible_rest_blocks ? `all ${c.n_implausible_rest_blocks} rest score(s) were implausible (≈0: the model saturating on this signal)`
      : num(c.resting_calibrated_p) != null ? `its resting score ${fmt(num(c.resting_calibrated_p), 2)} is implausible (≈0: the model saturating)` : 'no resting level was stored';
  return (
    <p className="caption warn-text">
      ▲ Latest calibration (session {sessionLabel(latest.sid)}, {c.status}) gave no usable resting level: {why}.
      {src ? ` Showing the latest usable one, from session ${sessionLabel(src.sid)}.` : ' This user has no usable personal baseline yet; the population limit applies.'}
    </p>
  );
}

function SourceNote({ src, sid }) {
  if (!src) return null;
  return src.sid === sid
    ? <p className="caption">From this session&apos;s calibration.</p>
    : <p className="caption warn-text">▲ This session isn&apos;t calibrated yet: showing the user&apos;s latest calibration, from session {sessionLabel(src.sid)}. Each session recalibrates its own baseline when it starts.</p>;
}

// One point per calibrated session (oldest first), with the value in use.
function AcrossCalibrations({ items, valueOf, inUse, label, sid, color }) {
  const pts = items.map((i, n) => ({ x: n + 1, v: valueOf(i), sid: i.sid })).filter((p) => p.v != null);
  if (!pts.length) return null;
  if (pts.length < 2) {
    return <p className="caption">Only one calibration with a usable value so far ({sessionLabel(pts[0].sid)}: {fmt(pts[0].v, 3)}). The across-calibrations graph appears after the next one.</p>;
  }
  const xs = pts.map((p) => p.x);
  return (
    <>
      <h3 className="section-title">{label} across this user&apos;s calibrations</h3>
      <MultiLineChart points={pts} height={170} legend={false} ariaLabel={`${label} per calibration`}
        xDomain={[Math.min(...xs) - 0.5, Math.max(...xs) + 0.5]} xTicks={xs}
        xFormat={(v) => sessionLabel(pts.find((p) => p.x === v)?.sid)} yFormat={(v) => fmt(v, 3)}
        refLines={inUse != null ? [{ y: inUse, label: `in use ${fmt(inUse, 3)}` }] : []}
        series={[{ key: 'v', label, color, dots: true, width: 1.5 }]} />
      <p className="caption">
        {pts.length} calibration(s). {pts.some((p) => p.sid === sid) ? 'The selected session is included.' : ''} Spread between sessions = how much the
        resting level changes from day to day (electrode placement, contact, state).
      </p>
    </>
  );
}

function EegBaselineCard({ eeg, sid, history }) {
  const { cal: src, cals, latest, nAttempts } = pickEeg(eeg, sid, history);
  const c = src?.cal;
  const rest = (c?.rest_scores || []).map(num).filter((v) => v != null);
  const mu = muOf(c);
  const limit = num(c?.personal_high_load_p) ?? limitAt(c, K_ALERT);
  const reports = c?.block_reports || [];
  return (
    <Card title="1. EEG resting threshold (personal baseline)" subtitle="Rest blocks → the user's own resting level μ_rest; every later score is measured from it"
      right={<Status kind={!c ? 'idle' : c.status === 'ok' ? 'good' : 'warning'}>
        {!c ? (history.loading ? 'loading…' : nAttempts ? 'no usable baseline' : 'never calibrated') : `μ_rest ${fmt(mu, 3)}${src.sid === sid ? '' : ' (earlier session)'}`}
      </Status>}>
      <UnusableNote latest={latest} src={src} />
      <SourceNote src={src} sid={sid} />
      {rest.length ? (
        <CalibGraph rest={rest} refLines={[
          { y: mu, label: `settled μ_rest ${fmt(mu, 3)}` },
          ...(limit != null ? [{ y: limit, label: `high-load limit ${fmt(limit, 3)}` }] : []),
        ]} color={C.eeg} ariaLabel="EEG rest block scores and running mean" />
      ) : c ? (
        <p className="caption">Per-block rest scores weren&apos;t stored for this calibration (before the update); recalibrate to see each block settle.</p>
      ) : (
        <Empty height={140}>{history.loading ? 'Loading this user\'s calibrations…' : 'This user has no EEG calibration yet. It runs automatically when a session starts with the headband streaming.'}</Empty>
      )}
      <AcrossCalibrations items={cals} valueOf={(i) => muOf(i.cal)} inUse={mu} label="μ_rest" sid={sid} color={C.eeg} />
      <KV rows={[
        ['Personal baseline μ_rest', fmt(mu, 4)],
        ['Rest blocks used', c ? `${c.n_blocks ?? '—'} of ${reports.length || '—'} captured` : '—', 'Block 1 is the settling window; untrusted blocks are not used'],
        ['Calibrations for this user', nAttempts ? `${cals.length} usable of ${nAttempts}` : '—'],
        ['Amplitude gain', c?.amplitude_gain == null ? '—' : `${fmt(c.amplitude_gain, 2)}× (rest SD ${fmt(c.rest_std_uv, 2)} µV)`],
        ['Degraded', c ? (c.baseline_degraded ? 'Yes' : 'No') : '—'],
        ['Calibrated', c?.updated_at ? new Date(c.updated_at * 1000).toLocaleString() : '—'],
      ]} />
    </Card>
  );
}

function EegThresholdCard({ eeg, sid, history }) {
  const { cal: csrc, thr: tsrc, cals, latest } = pickEeg(eeg, sid, history);
  const t = tsrc?.thr;
  const mu = num(t?.resting_mean) ?? muOf(csrc?.cal);
  const rest = (t?.rest_scores || (tsrc && csrc && tsrc.sid === csrc.sid ? csrc.cal.rest_scores : null) || []).map(num).filter((v) => v != null);
  const task = (t?.task_scores || []).map(num).filter((v) => v != null);
  const recovery = (t?.recovery_scores || []).map(num).filter((v) => v != null);
  const taskMean = num(t?.task_mean);
  const personalLimit = num(t?.personal_high_load_p) ?? num(csrc?.cal?.personal_high_load_p) ?? limitAt(csrc?.cal, K_ALERT);
  const neededTask = limitAt(t?.personal_scale ? { ...csrc?.cal, personal_scale: t.personal_scale } : csrc?.cal, MIN_TASK_Z);
  const population = personalLimit == null;
  const limit = population ? POPULATION_HIGH_LOAD_P : personalLimit;     // backend falls back to the population limit
  const zTask = num(t?.task_response_z);
  return (
    <Card title="2. EEG high-load threshold (calibrated for the user)" subtitle="0.84σ above own rest, checked by the onboarding task: the task must sit ≥ 0.5σ above rest"
      right={<Status kind={limit == null ? 'idle' : t?.status === 'ok' ? 'good' : t ? 'warning' : 'good'}>
        {population ? `population limit ${fmt(limit, 3)}` : `limit ${fmt(limit, 3)}${t ? (t.status === 'ok' ? ' · responsive' : ` · ${t.status}`) : ''}`}
      </Status>}>
      <UnusableNote latest={latest} src={csrc} />
      <SourceNote src={tsrc || csrc} sid={sid} />
      {task.length ? (
        <CalibGraph rest={rest} task={task} recovery={recovery} color={C.eeg} ariaLabel="EEG rest, task and recovery calibration scores" refLines={[
          ...(mu != null ? [{ y: mu, label: `rest ${fmt(mu, 3)}` }] : []),
          ...(taskMean != null ? [{ y: taskMean, label: `task ${fmt(taskMean, 3)}` }] : []),
          ...(limit != null ? [{ y: limit, label: `chosen limit ${fmt(limit, 3)}` }] : []),
          ...(neededTask != null ? [{ y: neededTask, label: 'needed task mean' }] : []),
        ]} />
      ) : (
        <p className="caption">
          {t ? 'Per-block task scores weren\'t stored for this run (before the update); rerun the onboarding task to see them.'
            : 'The onboarding task hasn\'t been run for this user, so the limit is μ_rest + 0.84σ without a responsiveness check.'}
        </p>
      )}
      <AcrossCalibrations items={cals} valueOf={(i) => num(i.cal.personal_high_load_p) ?? limitAt(i.cal, K_ALERT)}
        inUse={limit} label="High-load limit" sid={sid} color={C.task} />
      <KV rows={[
        ['High-load limit in use', `${fmt(limit, 4)} (${population ? 'population: no personal baseline' : 'personal'})`],
        ['Scale', csrc?.cal ? `0.84σ above rest · ${scaleText(csrc.cal)}` : '— (needs a usable μ_rest)', 'log-odds: limit = sigmoid(mean rest log-odds + 0.84 × 0.55)'],
        ['Rest mean / task mean', `${fmt(mu, 4)} / ${fmt(taskMean, 4)}`],
        ['Task response z', zTask == null ? '—' : `${zTask >= 0 ? '+' : ''}${zTask.toFixed(2)} (needs ≥ ${MIN_TASK_Z})`, '(task mean − rest mean) / σ'],
        ['Responsive', t?.responsive == null ? '— (task not run)' : t.responsive ? 'Yes' : 'No: EEG gets little fusion weight'],
        ['Recovery rest', t?.recovery_mean == null ? '— (not recorded)' : `mean ${fmt(t.recovery_mean, 3)}, z ${t.recovery_z == null ? '—' : t.recovery_z.toFixed(2)} · ${t.recovered ? 'back below the limit' : 'still above the limit'}`],
      ]} />
    </Card>
  );
}

// ── 3 + 4. HRV / GSR ───────────────────────────────────────────────
function HrvBaselineCard({ ring, now }) {
  const t = ring.thresholds;
  const rest = (t?.resting_scores || []).map(num).filter((v) => v != null);
  const restMean = mean(rest);
  const b = ring.baseline;
  const updated = b?.updated_at ? Date.parse(b.updated_at) : null;
  const thr = effectiveThreshold(t, b);
  return (
    <Card title="3. HRV/GSR baseline calibration" subtitle="Resting windows → personal feature baseline and resting stress level (per user)"
      right={<Status kind={b ? 'good' : 'idle'}>{b ? `set ${ago(updated, now)}` : 'no baseline'}</Status>}>
      {rest.length ? (
        <CalibGraph rest={rest} color={C.hrv} ariaLabel="HRV/GSR resting window scores" refLines={[
          { y: restMean, label: `settled rest ${fmt(restMean, 3)}` },
          { y: thr.value, label: `limit in use ${fmt(thr.value, 3)}` },
        ]} />
      ) : <Empty>No resting scores stored for this user.</Empty>}
      <KV rows={[
        ['Resting windows', rest.length || '—'],
        ['Settled resting prob_stress', fmt(restMean, 4)],
        ['Baseline features', b ? Object.keys(b).filter((k) => b[k]?.mean != null).length : '—'],
        ['Limit in use', `${fmt(thr.value, 4)} (${thr.source})`],
      ]} />
    </Card>
  );
}

function HrvThresholdCard({ ring }) {
  const t = ring.thresholds;
  const rest = (t?.resting_scores || []).map(num).filter((v) => v != null);
  const task = (t?.task_scores || []).map(num).filter((v) => v != null);
  const recovery = (t?.task_result?.recovery_scores || []).map(num).filter((v) => v != null);
  const restMean = mean(rest);
  const taskMean = num(t?.task_result?.task_mean) ?? mean(task);
  const personal = num(t?.personal_stress_threshold);
  const status = t?.task_result?.status || (personal != null ? 'ok' : null);
  return (
    <Card title="4. HRV/GSR high-load threshold calibration" subtitle="Onboarding task vs rest → midpoint threshold, if they separate by ≥ 0.10"
      right={<Status kind={!status ? 'idle' : status === 'ok' ? 'good' : 'warning'}>{status || 'task not run'}</Status>}>
      {task.length ? (
        <CalibGraph rest={rest} task={task} recovery={recovery} color={C.hrv} ariaLabel="HRV/GSR rest, task and recovery calibration scores" refLines={[
          ...(restMean != null ? [{ y: restMean, label: `rest ${fmt(restMean, 3)}` }] : []),
          ...(taskMean != null ? [{ y: taskMean, label: `task ${fmt(taskMean, 3)}` }] : []),
          ...(personal != null ? [{ y: personal, label: `chosen threshold ${fmt(personal, 3)}` }] : []),
          ...(restMean != null ? [{ y: restMean + PERSONAL_THRESHOLD_MIN_SEPARATION, label: 'needed task mean' }] : []),
        ]} />
      ) : rest.length && personal != null ? (
        <CalibGraph rest={rest} color={C.hrv} ariaLabel="HRV/GSR rest scores and chosen threshold" refLines={[
          { y: restMean, label: `rest ${fmt(restMean, 3)}` },
          { y: personal, label: `chosen threshold ${fmt(personal, 3)}` },
        ]} />
      ) : <Empty>The ring&apos;s onboarding task hasn&apos;t run for this user. The population threshold {STRESS_DECISION_THRESHOLD} applies.</Empty>}
      <KV rows={[
        ['Rest mean / task mean', `${fmt(restMean, 4)} / ${fmt(taskMean, 4)}`],
        ['Separation (needs ≥ 0.10)', restMean != null && taskMean != null ? fmt(taskMean - restMean, 3) : '—'],
        ['Chosen threshold (midpoint)', personal != null ? fmt(personal, 4) : `none → population ${STRESS_DECISION_THRESHOLD}`],
        ['Task windows', task.length || t?.task_result?.n_task_windows || '—'],
        ['Recovery rest', t?.task_result?.recovery_mean == null ? '— (not recorded)' : `mean ${fmt(t.task_result.recovery_mean, 3)} · ${t.task_result.recovered ? 'back below the threshold' : 'still above the threshold'}`],
      ]} />
      {!task.length && personal != null && (
        <p className="caption">Task windows weren&apos;t stored for this run (older calibration); rerun the ring&apos;s onboarding task to see them.</p>
      )}
    </Card>
  );
}

// ── 5 + 6. Fused ───────────────────────────────────────────────────
function FusedBaselineCard({ fusion }) {
  const fw = fusion.windows.filter((w) => w.fused_probability != null);
  const pts = []; let sum = 0;
  fw.forEach((w, i) => {
    if (i < FUSION_BASELINE_N) sum += w.fused_probability;
    pts.push({ x: i + 1, fused: w.fused_probability, running: i < FUSION_BASELINE_N ? sum / (i + 1) : null });
  });
  const base = num(fusion.baseline);
  const shown = pts.slice(0, Math.max(12, FUSION_BASELINE_N));
  return (
    <Card title="5. Fused baseline calibration" subtitle={`First ${FUSION_BASELINE_N} fused windows of the session → session baseline (used for trend and phase)`}
      right={<Status kind={base != null ? 'good' : 'idle'}>{base != null ? `baseline ${fmt(base, 3)}` : `needs ${FUSION_BASELINE_N} windows`}</Status>}>
      {shown.length ? (
        <MultiLineChart points={shown} height={230} yDomain={[0, 1]} xDomain={[0.5, shown.length + 0.5]}
          xTicks={shown.map((p) => p.x)} xFormat={(v) => `#${v}`} yFormat={(v) => v.toFixed(2)}
          ariaLabel="Fused windows and baseline" bands={[{ x0: 0.5, x1: Math.min(FUSION_BASELINE_N, shown.length) + 0.5, label: 'Baseline windows', kind: 'a' }]}
          refLines={[...(base != null ? [{ y: base, label: `settled baseline ${fmt(base, 3)}` }] : []), { y: 0.5, label: 'fused limit 0.5' }]}
          series={[
            { key: 'fused', label: 'Fused value per window', color: C.fused, width: 1.5, dots: true },
            { key: 'running', label: 'Running baseline mean', color: C.mean, width: 2.5 },
          ]} />
      ) : <Empty>No fused windows for this session yet.</Empty>}
      <p className="caption">Shows the first {shown.length} windows. Later windows are compared with this baseline for &quot;trending towards stress&quot;.</p>
    </Card>
  );
}

function FusedThresholdCard({ fusion }) {
  const pts = fusion.windows.filter((w) => w.fused_probability != null).map((w, i) => ({
    x: i + 1, raw: num(w.fused_threshold_raw), teeg: num(w.threshold_eeg), thrv: num(w.threshold_hrv_gsr), weeg: num(w.eeg_weight),
  }));
  const raws = pts.map((p) => p.raw).filter((v) => v != null);
  const settled = median(raws);
  return (
    <Card title="6. Fused high-load threshold" subtitle="Each model's own limit, combined with the fusion weights"
      right={<Status kind={raws.length ? 'good' : 'idle'}>{raws.length ? `settled ${fmt(settled, 3)}` : 'no windows'}</Status>}>
      {raws.length ? (
        <MultiLineChart points={pts} height={230} yDomain={[0, 1]} xFormat={(v) => `#${Math.round(v)}`} yFormat={(v) => v.toFixed(2)}
          ariaLabel="Fused threshold per window" refLines={[{ y: settled, label: `settled ${fmt(settled, 3)}` }]}
          series={[
            { key: 'raw', label: 'Combined limit (raw scale)', color: C.fused, width: 2.5 },
            { key: 'teeg', label: 'EEG limit', color: C.eeg, dash: true, width: 1.5 },
            { key: 'thrv', label: 'HRV/GSR limit', color: C.hrv, dash: true, width: 1.5 },
          ]} />
      ) : <Empty>No fused windows for this session yet.</Empty>}
      <p className="caption">
        On the aligned scale used for the decision, each model&apos;s limit maps to 0.5, so the fused limit is always 0.5. The raw-scale line is the
        same limit expressed in model probability: the weighted mix of the EEG and HRV/GSR limits; it moves with the weights and settles once
        both inputs report steadily. Settled value = median over the session.
      </p>
    </Card>
  );
}

// ── 7. Scores and labels ───────────────────────────────────────────
function LabelStrip({ items, x0, x1, label }) {
  // items: [{t, on (bool|null), title}]
  const span = x1 - x0 || 1;
  return (
    <div className="label-strip" aria-label={label}>
      <span className="label-strip-name">{label}</span>
      <div className="label-strip-track">
        {items.map((it, i) => {
          const next = items[i + 1]?.t ?? Math.min(x1, it.t + 25000);
          const left = ((it.t - x0) / span) * 100; const w = Math.max(0.4, ((next - it.t) / span) * 100);
          return <i key={`${it.t}-${i}`} title={it.title} className={it.on == null ? 'na' : it.on ? 'on' : 'off'} style={{ left: `${left}%`, width: `${w}%` }} />;
        })}
      </div>
    </div>
  );
}

function ScoresCard({ eeg, ring, fusion, xDomain }) {
  const pg = useMemo(() => previewGain(eeg), [eeg]);
  const eegLimit = num(eeg.calibration?.personal_high_load_p) ?? num(eeg.blocks[eeg.blocks.length - 1]?.effective_high_load_p);
  const ringThr = effectiveThreshold(ring.thresholds, ring.baseline).value;
  const eegPts = eeg.blocks.filter((b) => b.timestamp_end).map((b) => {
    const pv = pg ? previewScore(b, pg.gain) : null;
    return { x: b.timestamp_end * 1000, score: pv ?? b.task_state_score ?? null, preview: pv != null };
  });
  const nPreview = eegPts.filter((p) => p.preview).length;
  const hrvPts = ring.windows.filter((w) => w.t).map((w) => ({ x: w.t, p: w.prob_stress ?? null, label: w.prediction }));
  const fPts = fusion.windows.map((w) => ({ x: keyToMs(w.key), f: w.fused_probability ?? null, label: w.fused_label }));
  const strip = (pts, val, lim) => pts.map((p) => ({ t: p.x, on: p[val] == null ? null : p[val] >= lim, title: `${clockMs(p.x)}: ${p[val] == null ? 'no score' : fmtScore(p[val])}` }));
  const common = { height: 170, xDomain, xFormat: clockMs, yFormat: (v) => v.toFixed(2), yDomain: [0, 1], legend: false };
  return (
    <Card title="7. Task / stress label and score" subtitle="Each component on its own 0–1 score with its own limit; strips show the label per block/window">
      {!xDomain ? <Empty>No data for this session yet.</Empty> : (
        <>
          <h3>Mind (EEG) task-state score{eeg.calibration?.amplitude_gain > 1 ? ` · amplitude gain ${fmt(eeg.calibration.amplitude_gain, 1)}×` : ''}</h3>
          <MultiLineChart {...common} points={eegPts} ariaLabel="EEG score over time"
            refLines={eegLimit != null ? [{ y: eegLimit, label: `limit ${fmt(eegLimit, 3)}` }] : []}
            series={[{ key: 'score', label: 'EEG score', color: C.eeg, dots: true }]} />
          {nPreview > 0 && <p className="caption">{nPreview} block(s) scored before this session had an amplitude gain are shown re-scored at {fmt(pg.gain, 1)}× (preview).</p>}
          <h3 className="section-title">Body (HRV + GSR) stress probability</h3>
          <MultiLineChart {...common} points={hrvPts} ariaLabel="HRV/GSR prob_stress over time"
            refLines={[{ y: ringThr, label: `threshold ${fmt(ringThr, 3)}` }]}
            series={[{ key: 'p', label: 'prob_stress', color: C.hrv, dots: true }]} />
          <h3 className="section-title">Fused stress (aligned scale)</h3>
          <MultiLineChart {...common} points={fPts} ariaLabel="Fused value over time"
            refLines={[{ y: 0.5, label: 'limit 0.5' }]}
            series={[{ key: 'f', label: 'fused', color: C.fused, dots: true }]} />
          <div className="label-strips">
            <LabelStrip label="EEG: high task state" items={strip(eegPts, 'score', eegLimit ?? 1)} x0={xDomain[0]} x1={xDomain[1]} />
            <LabelStrip label="HRV/GSR: Stress" items={hrvPts.map((p) => ({ t: p.x, on: p.label == null ? null : p.label === 1, title: `${clockMs(p.x)}: ${fmtScore(p.p)}` }))} x0={xDomain[0]} x1={xDomain[1]} />
            <LabelStrip label="Fused: high stress" items={fPts.map((p) => ({ t: p.x, on: p.label == null ? null : p.label === 1, title: `${clockMs(p.x)}: ${fmtScore(p.f)}` }))} x0={xDomain[0]} x1={xDomain[1]} />
            <p className="caption"><i className="lg on" /> label high · <i className="lg off" /> label low · <i className="lg na" /> no score (rejected / not reporting)</p>
          </div>
        </>
      )}
    </Card>
  );
}

// ── 6b. Rising alerts ─────────────────────────────────────────────
function AlertsCard({ eeg, ring, fusion, xDomain }) {
  const lanes = [
    { name: 'EEG · high-load alert', color: C.eeg, ev: eeg.blocks.filter((b) => b.high_load_alert).map((b) => b.timestamp_end * 1000), rule: '3 consecutive blocks ≥ limit' },
    { name: 'EEG · micro-break', color: C.eeg, ev: eeg.blocks.filter((b) => b.micro_break_recommended).map((b) => b.timestamp_end * 1000), rule: 'high for 20 blocks' },
    { name: 'EEG · fatigue', color: C.eeg, ev: eeg.blocks.filter((b) => b.fatigue_warning).map((b) => b.timestamp_end * 1000), rule: 'high for 60 blocks' },
    { name: 'HRV/GSR · trending toward stress', color: C.hrv, ev: ring.windows.filter((w) => w.trending_toward_stress && w.t).map((w) => w.t), rule: 'features rising over recent windows' },
    { name: 'HRV/GSR · Stress label', color: C.hrv, ev: ring.windows.filter((w) => w.prediction === 1 && w.t).map((w) => w.t), rule: 'prob_stress > threshold' },
    { name: 'Fused · trending towards stress', color: C.fused, ev: fusion.windows.filter((w) => w.stress_phase === 'trending_towards_stress').map((w) => keyToMs(w.key)), rule: 'rising, between baseline and limit' },
    { name: 'Fused · rising stress alert', color: C.fused, ev: fusion.windows.filter((w) => w.stress_phase === 'increasing_stress_alert').map((w) => keyToMs(w.key)), rule: 'rising and ≥ limit' },
  ];
  const W = 1000; const laneH = 26; const left = 230;
  const sx = (t) => left + ((t - xDomain[0]) / ((xDomain[1] - xDomain[0]) || 1)) * (W - left - 10);
  return (
    <Card title="8. Rising alerts from each component" subtitle="Each marker is a block/window where that alert was on">
      {!xDomain ? <Empty height={120}>No data for this session yet.</Empty> : (
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} ${lanes.length * laneH + 24}`} width="100%" role="img" aria-label="Alert timeline">
            {lanes.map((l, i) => (
              <g key={l.name}>
                <text x={0} y={i * laneH + 17} className="tick">{l.name} ({l.ev.length})</text>
                <line x1={left} x2={W - 10} y1={i * laneH + 13} y2={i * laneH + 13} className="grid" />
                {l.ev.map((t) => (
                  <rect key={t} x={sx(t) - 3} y={i * laneH + 5} width={6} height={16} rx={2} fill={l.color}>
                    <title>{`${l.name} at ${clockMs(t)} (${l.rule})`}</title>
                  </rect>
                ))}
              </g>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const t = xDomain[0] + f * (xDomain[1] - xDomain[0]);
              return <text key={f} x={sx(t)} y={lanes.length * laneH + 18} textAnchor="middle" className="tick">{clockMs(t)}</text>;
            })}
          </svg>
          <p className="caption">
            Rules: EEG alerts are persistence-gated (sam40/decision.py); HRV/GSR &quot;trending&quot; comes from feature direction (predictor.py);
            fused phases compare each window with the session baseline (fusion_live_session.py).
          </p>
        </div>
      )}
    </Card>
  );
}

// ── Feature dropdown graphs ───────────────────────────────────────
function FeatureGraph({ title, rows, color, baseline, xDomain }) {
  const keys = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.f || {})))].sort(), [rows]);
  const [pick, setPick] = useState(null);
  const k = keys.includes(pick) ? pick : keys[0];
  const pts = rows.map((r) => ({ x: r.t, v: r.f?.[k] ?? null }));
  const b = baseline?.[k]?.mean;
  return (
    <div>
      <div className="chart-head">
        <h3 className="section-title">{title}</h3>
        <select value={k || ''} onChange={(e) => setPick(e.target.value)} aria-label={`${title} feature`}>
          {keys.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      {!keys.length ? <Empty height={200}>No features stored for this session.</Empty> : (
        <MultiLineChart points={pts} height={200} xDomain={xDomain} xFormat={clockMs} yFormat={(v) => fmt(v, 3)} legend={false}
          ariaLabel={`${k} over time`} refLines={b != null ? [{ y: b, label: `baseline ${fmt(b, 3)}` }] : []}
          series={[{ key: 'v', label: k, color, dots: true }]} />
      )}
    </div>
  );
}

function FeaturesCard({ eeg, ring, xDomain }) {
  const eegRows = eeg.blocks.filter((b) => b.timestamp_end && b.features_eeg?.bipolar).map((b) => ({ t: b.timestamp_end * 1000, f: b.features_eeg.bipolar }));
  const hrvRows = ring.windows.filter((w) => w.t && w.features).map((w) => ({ t: w.t, f: w.features }));
  return (
    <Card title="9. Extracted features" subtitle="Pick a feature for each component">
      <div className="grid-2">
        <FeatureGraph title="EEG (T7−T8)" rows={eegRows} color={C.eeg} xDomain={xDomain} />
        <FeatureGraph title="HRV / GSR (ring)" rows={hrvRows} color={C.hrv} baseline={ring.baseline} xDomain={xDomain} />
      </div>
      <p className="caption">
        EEG features are what the model saw: blocks scored with an amplitude gain have powers and amplitudes at that gain. HRV/GSR lines show the
        user&apos;s baseline mean where one exists.
      </p>
    </Card>
  );
}

// The 9 calibration / score / alert / feature cards for one user + session.
// Used by the Calibration & alerts dashboard and inside the EEG technical
// view (TechView), so both always show the same graphs. `eeg` and `profile`
// come from the caller (both pages already subscribe to them); HRV/GSR and
// fusion data are subscribed here for the same uid/sid.
export function CalibrationSections({ uid, sid, eeg, profile, now }) {
  const ring = usePhysioData(uid, sid);
  const fusion = useFusionData(uid, sid);
  const history = useEegCalibrations(uid, `${sid}|${eeg.calibration?.updated_at ?? ''}|${eeg.threshold?.updated_at ?? ''}`);

  // One shared time axis for every time-based chart.
  const xDomain = useMemo(() => {
    const ts = [
      ...eeg.blocks.map((b) => (b.timestamp_end ? b.timestamp_end * 1000 : null)),
      ...ring.windows.map((w) => w.t),
      ...fusion.windows.map((w) => keyToMs(w.key)),
    ].filter((t) => t != null && Number.isFinite(t));
    return ts.length >= 2 ? [Math.min(...ts), Math.max(...ts)] : null;
  }, [eeg.blocks, ring.windows, fusion.windows]);

  const latestEeg = [...eeg.blocks].reverse().find((b) => b.task_state_score != null);
  const latestHrv = ring.windows[ring.windows.length - 1];
  const latestF = [...fusion.windows].reverse().find((w) => w.fused_probability != null);

  return (
    <>
      <div className="stats">
        <Stat label="EEG score now" value={fmtScore(latestEeg?.task_state_score)} sub={latestEeg ? `limit ${fmt(latestEeg.effective_high_load_p, 3)}` : 'no block'} />
        <Stat label="EEG amplitude gain" value={eeg.calibration?.amplitude_gain ? `${fmt(eeg.calibration.amplitude_gain, 1)}×` : '—'} sub="from rest calibration" />
        <Stat label="HRV/GSR now" value={fmtScore(latestHrv?.prob_stress)} sub={latestHrv?.label || 'no window'} />
        <Stat label="Fused now" value={fmtScore(latestF?.fused_probability)} sub={latestF ? (latestF.fused_label === 1 ? 'High stress' : 'Normal') : 'no window'} />
        <Stat label="Session" value={sid ? sid.replace('session_', '') : '—'} sub={uid || 'no user'} />
      </div>

      <div className="grid-2">
        <EegBaselineCard eeg={eeg} sid={sid} history={history} />
        <EegThresholdCard eeg={eeg} sid={sid} history={history} />
        <HrvBaselineCard ring={ring} now={now} />
        <HrvThresholdCard ring={ring} />
        <FusedBaselineCard fusion={fusion} />
        <FusedThresholdCard fusion={fusion} />
      </div>
      <ScoresCard eeg={eeg} ring={ring} fusion={fusion} xDomain={xDomain} />
      <AlertsCard eeg={eeg} ring={ring} fusion={fusion} xDomain={xDomain} />
      <FeaturesCard eeg={eeg} ring={ring} xDomain={xDomain} />
    </>
  );
}

export default function CalibrationDashboard({ now, onBack }) {
  const picker = useSessionPicker();
  const uid = picker.userId; const sid = picker.sessionId;
  const eeg = useSessionData(uid, sid);
  const profile = useFirebaseValue(uid ? `user_profiles/${uid}/eeg` : null) || null;
  // Bridge heartbeat (written every 5 s while headband samples arrive).
  const device = useFirebaseValue('eeg_devices/wearable02');
  const streaming = device?.last_seen != null && now / 1000 - device.last_seen < 60;

  return (
    <div className="page">
      <header className="top">
        <div>
          <button type="button" className="back-link" onClick={onBack}>← Wearable 02 EEG monitor</button>
          <p className="eyebrow">MindPulse · all components · technical view</p>
          <h1>Calibration, scores &amp; alerts</h1>
          <p className="muted">
            How each component (EEG, HRV/GSR, fused) set its baseline and high-load threshold, then its scores, labels and alerts over the
            session. Read-only.
          </p>
        </div>
        <SessionPicker picker={picker} />
      </header>
      <RecalibratePanel picker={picker} now={now} streaming={streaming} />
      <CalibrationSections uid={uid} sid={sid} eeg={eeg} profile={profile} now={now} />
    </div>
  );
}
