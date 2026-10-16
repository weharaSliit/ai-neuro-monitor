import { MultiLineChart } from './charts';
import { Card, Status } from './panels';
import { useFirebaseValue } from '../hooks/useData';
import { N_CALIBRATION_BLOCKS } from '../lib/config';
import {
  K_ALERT, MIN_RECOVERY_REVERSAL_SD, SIGMA_LOGIT, TASK_SKIP_EEG, lgt, mean, median, num, plausible, ringLimitInfo, sdOf, sig,
} from '../lib/limits';

// Live calibration for both devices, each block/window as it is captured,
// with the baseline and threshold recomputed after every one so you can
// watch them settle.
//
// EEG (eeg_recalibration/{sid}/live, scored by /calibrate/preview): baseline
// = median of rest, threshold = rest + 0.84 spread until the sustained task
// (after the first 5 task blocks) exists, then the midpoint of baseline and
// task. Log scale: this headband's scores are often 1e-9..1e-3.
//
// HRV/GSR (ring_recalibration/{uid}/live, from ring_recalibration.py): 60 s
// windows, prob_stress 0..1. Baseline = median of rest, threshold = midpoint
// of baseline and the sustained task (after 2 ramp-up windows) when they are
// separated, else the population limit -- ringLimitInfo(), the dashboard's rule.
const LN10 = Math.log(10);
const C = { eeg: 'var(--c1)', ring: 'var(--c2)', base: 'var(--ink)', thr: 'var(--c4)' };
const PHASES = [['rest', 'Rest'], ['task', 'Task'], ['recovery', 'Recovery']];
const PHASE_LABEL = { settle: 'settling', rest: 'resting baseline', task: 'high-load task', recovery: 'recovery rest' };
const RING = { rest: 4, recovery: 3, task: 8 };   // backend/common/config.py N_BASELINE_WIN, N_RECOVERY_WIN; N_TASK_WIN

const isActive = (r) => r?.status === 'requested' || r?.status === 'capturing' || r?.status === 'saving';
const statusText = (r, unit) => (isActive(r)
  ? `${PHASE_LABEL[r.phase] || 'starting'}${r.blocks_needed && r.phase !== 'settle' ? ` · ${unit} ${r.blocks_captured ?? 0} of ${r.blocks_needed}` : ''}`
  : r?.status === 'done' ? 'last run' : r?.status === 'failed' ? `failed: ${r.error || ''}` : 'not running');

function phaseBands(phases) {
  const bands = [];
  PHASES.forEach(([k, l], j) => {
    const idx = phases.map((p, i) => (p === k ? i + 1 : null)).filter((v) => v != null);
    if (idx.length) bands.push({ x0: idx[0] - 0.5, x1: idx[idx.length - 1] + 0.5, label: l, kind: j === 1 ? 'b' : 'a' });
  });
  return bands;
}

function Settled({ items }) {
  return (
    <div className="settled">
      {items.filter(Boolean).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
    </div>
  );
}

// ── EEG ─────────────────────────────────────────────────────────────
// Same direction-aware ABA rule as the final calibration (lib/limits.js
// eegLimitInfo): the task may move the score either way; once recovery
// blocks arrive they must come back towards rest by 0.5 spread.
function eegSettled(rest, task, recovery) {
  if (!rest.length) return { base: null, thr: null };
  const base = median(rest);
  const sd = rest.length < 5 ? SIGMA_LOGIT : Math.max(SIGMA_LOGIT, sdOf(rest));
  const k = Math.min(TASK_SKIP_EEG, Math.floor(task.length / 2));
  const sus = task.length > TASK_SKIP_EEG ? task.slice(k) : [];
  const taskL = sus.length ? mean(sus) : null;
  const dir = taskL == null || taskL >= base ? 1 : -1;
  const separated = taskL != null && Math.abs(taskL - base) >= sd;
  const reversal = taskL != null && recovery.length ? (dir * (taskL - median(recovery))) / sd : null;
  const responsive = separated && (reversal == null || reversal >= MIN_RECOVERY_REVERSAL_SD);
  return { base, sd, taskL, dir, reversal, responsive,
    status: responsive ? 'ok' : separated ? 'drift_suspected' : taskL != null ? 'not_separated' : null,
    thr: responsive ? (base + taskL) / 2 : base + K_ALERT * sd };
}

function EegLive({ req }) {
  const raw = req?.live ? (Array.isArray(req.live) ? req.live : Object.entries(req.live)
    .sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v)) : [];
  const live = raw.filter(Boolean);

  const rest = []; const task = []; const recovery = []; const pts = []; const history = [];
  let excluded = 0;
  live.forEach((b, i) => {
    const p = num(b.score); const ok = plausible(p); const L = ok ? lgt(p) : null;
    if (!ok) excluded += 1;
    if (ok && b.phase === 'rest') rest.push(L);
    if (ok && b.phase === 'task') task.push(L);
    if (ok && b.phase === 'recovery') recovery.push(L);
    const s = eegSettled(rest, task, recovery); history.push(s);
    pts.push({ x: i + 1, score: L == null ? null : L / LN10,
      base: s.base == null ? undefined : s.base / LN10, thr: s.thr == null ? undefined : s.thr / LN10 });
  });
  const now = history[history.length - 1] || {};
  // Settled = the baseline moved less than a quarter spread over the last 3 rest blocks.
  const restHist = history.filter((_, i) => live[i]?.phase === 'rest' && plausible(num(live[i].score))).slice(-4);
  const drift = restHist.length >= 4 ? Math.abs(restHist[3].base - restHist[0].base) / (now.sd || SIGMA_LOGIT) : null;
  // whole run on the x-axis from the start: rest + task + recovery
  const planned = N_CALIBRATION_BLOCKS + (num(req?.task_blocks_needed) || 0) + (num(req?.recovery_blocks_needed) || 0);

  return (
    <div className="live-cal">
      <div className="live-cal-head"><h3>EEG headband</h3><span className="muted">{statusText(req, 'block')}</span></div>
      {!live.length ? (
        <div className="chart-empty" style={{ height: 180 }}>
          {isActive(req) && req?.phase === 'settle' ? 'Settling: the first block appears when the resting baseline starts.'
            : 'Start a recalibration below to watch it live.'}
        </div>
      ) : (
        <MultiLineChart points={pts} height={230} xDomain={[0.5, Math.max(live.length, planned) + 0.5]}
          xFormat={(v) => `#${Math.round(v)}`} yFormat={(v) => `1e${Math.round(v)}`} bands={phaseBands(live.map((b) => b.phase))}
          ariaLabel="Live EEG calibration"
          series={[
            { key: 'score', label: 'Block score (25 s)', color: C.eeg, width: 1.5, dots: true },
            { key: 'base', label: 'Baseline so far', color: C.base, width: 2.5, connect: true },
            { key: 'thr', label: 'Threshold so far', color: C.thr, width: 2.5, dash: true, connect: true },
          ]} />
      )}
      {now.base != null && (
        <Settled items={[
          ['Baseline now', sig(now.base).toExponential(1)],
          ['Threshold now', sig(now.thr).toExponential(1)],
          ['Threshold from', now.responsive ? `midpoint${now.dir < 0 ? ' · falls under load' : ''}` : 'rest + 0.84 spread'],
          now.status ? ['Task response', now.status === 'ok' ? (now.reversal == null ? 'responsive (recovery check pending)' : 'responsive · recovered')
            : now.status === 'drift_suspected' ? 'drift suspected' : 'not separated yet'] : null,
          ['Baseline', drift == null ? 'settling…' : drift < 0.25 ? 'settled' : 'still moving'],
          excluded > 0 ? ['Unusable blocks', excluded] : null,
        ]} />
      )}
    </div>
  );
}

// ── HRV / GSR ───────────────────────────────────────────────────────
function RingLive({ req }) {
  const L = req?.live || {};
  const arr = (a) => (Array.isArray(a) ? a : a ? Object.values(a) : []).map(num);
  // Rest scores are provisional (re-scored against the windows so far) and
  // replaced each window; only the latest set is shown.
  const rest = arr(L.rest); const task = arr(L.task); const recovery = arr(L.recovery);
  const phases = [...rest.map(() => 'rest'), ...task.map(() => 'task'), ...recovery.map(() => 'recovery')];
  const vals = [...rest, ...task, ...recovery];
  const pts = []; let info = null;
  vals.forEach((v, i) => {
    const r = rest.slice(0, Math.min(i + 1, rest.length)).filter((x) => x != null);
    const t = i >= rest.length ? task.slice(0, Math.min(i + 1 - rest.length, task.length)).filter((x) => x != null) : [];
    const rc = i >= rest.length + task.length ? recovery.slice(0, i + 1 - rest.length - task.length).filter((x) => x != null) : [];
    info = r.length ? ringLimitInfo({ thresholds: { resting_scores: r, task_scores: t, task_result: { recovery_scores: rc } }, baseline: {} }) : null;
    pts.push({ x: i + 1, score: v, base: info?.base ?? undefined, thr: info?.limit ?? undefined });
  });
  const planned = RING.rest + (num(req?.task_windows) || RING.task) + RING.recovery;
  const restDrift = rest.length >= 3 ? Math.abs(median(rest) - median(rest.slice(0, -1))) : null;

  return (
    <div className="live-cal">
      <div className="live-cal-head"><h3>HRV/GSR ring</h3><span className="muted">{statusText(req, 'window')}</span></div>
      {!vals.length ? (
        <div className="chart-empty" style={{ height: 180 }}>
          {isActive(req) && req?.phase === 'settle' ? 'Settling: the first window appears 1 minute into the resting baseline.'
            : 'Start a recalibration below (with "HRV/GSR ring" ticked) to watch it live.'}
        </div>
      ) : (
        <MultiLineChart points={pts} height={230} yDomain={[0, 1]} xDomain={[0.5, Math.max(vals.length, planned) + 0.5]}
          xFormat={(v) => `#${Math.round(v)}`} yFormat={(v) => v.toFixed(2)} bands={phaseBands(phases)} ariaLabel="Live HRV/GSR calibration"
          series={[
            { key: 'score', label: 'Window score (60 s)', color: C.ring, width: 1.5, dots: true },
            { key: 'base', label: 'Baseline so far', color: C.base, width: 2.5, connect: true },
            { key: 'thr', label: 'Threshold so far', color: C.thr, width: 2.5, dash: true, connect: true },
          ]} />
      )}
      {info && (
        <Settled items={[
          ['Baseline now', info.base == null ? '—' : info.base.toFixed(3)],
          ['Threshold now', info.limit.toFixed(3)],
          ['Threshold from', info.personal ? 'midpoint' : 'population limit'],
          ['Baseline', restDrift == null ? 'settling…' : restDrift < 0.05 ? 'settled' : 'still moving'],
        ]} />
      )}
    </div>
  );
}

export default function LiveCalibrationCard({ sid, uid }) {
  const eeg = useFirebaseValue(sid ? `eeg_recalibration/${sid}` : null);
  const ring = useFirebaseValue(uid ? `ring_recalibration/${uid}` : null);
  const running = isActive(eeg) || isActive(ring);
  return (
    <Card title="Live calibration" subtitle="Each block or window as it is captured, with the baseline and threshold recomputed after every one"
      right={<Status kind={running ? 'good' : 'idle'}>{running ? 'calibrating' : 'not running'}</Status>}>
      <div className="grid-2">
        <EegLive req={eeg} />
        <RingLive req={ring} />
      </div>
    </Card>
  );
}
