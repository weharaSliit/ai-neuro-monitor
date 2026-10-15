import { MultiLineChart } from './charts';
import { Card, Status } from './panels';
import { useFirebaseValue } from '../hooks/useData';
import { N_CALIBRATION_BLOCKS } from '../lib/config';
import { K_ALERT, SIGMA_LOGIT, TASK_SKIP_EEG, lgt, mean, median, num, plausible, sdOf, sig } from '../lib/limits';

// Live EEG calibration: each block as the bridge captures it
// (eeg_recalibration/{sid}/live, scored by /calibrate/preview), with the
// baseline and threshold recomputed after every block so you can watch them
// settle. Same rules as the final calibration: baseline = median of rest,
// threshold = rest + 0.84 spread until the sustained task (after the first
// 5 task blocks) exists, then the midpoint of baseline and task.
// Plotted on a log scale: this headband's scores are often 1e-9..1e-3.
const LN10 = Math.log(10);
const C = { rest: 'var(--c1)', base: 'var(--ink)', thr: 'var(--c4)' };
const PHASES = [['rest', 'Rest'], ['task', 'Task'], ['recovery', 'Recovery']];

function settledValues(rest, task) {
  if (!rest.length) return { base: null, thr: null };
  const base = median(rest);
  const sd = rest.length < 5 ? SIGMA_LOGIT : Math.max(SIGMA_LOGIT, sdOf(rest));
  const k = Math.min(TASK_SKIP_EEG, Math.floor(task.length / 2));
  const sus = task.length > TASK_SKIP_EEG ? task.slice(k) : [];
  const taskL = sus.length ? mean(sus) : null;
  const responsive = taskL != null && taskL - base >= sd;
  return { base, sd, taskL, thr: responsive ? (base + taskL) / 2 : base + K_ALERT * sd, responsive };
}

export default function LiveCalibrationCard({ sid }) {
  const req = useFirebaseValue(sid ? `eeg_recalibration/${sid}` : null);
  const raw = req?.live ? (Array.isArray(req.live) ? req.live : Object.entries(req.live)
    .sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v)) : [];
  const live = raw.filter(Boolean);
  const active = req?.status === 'capturing' || req?.status === 'saving';

  const rest = []; const task = []; const pts = []; const history = [];
  let excluded = 0;
  live.forEach((b, i) => {
    const p = num(b.score); const ok = plausible(p); const L = ok ? lgt(p) : null;
    if (!ok) excluded += 1;
    if (ok && b.phase === 'rest') rest.push(L);
    if (ok && b.phase === 'task') task.push(L);
    const s = settledValues(rest, task); history.push(s);
    pts.push({ x: i + 1, score: L == null ? null : L / LN10,
      base: s.base == null ? undefined : s.base / LN10, thr: s.thr == null ? undefined : s.thr / LN10 });
  });
  const now = history[history.length - 1] || {};
  // Settled = the baseline moved less than a quarter spread over the last 3 rest blocks.
  const restHist = history.filter((_, i) => live[i]?.phase === 'rest' && plausible(num(live[i].score))).slice(-4);
  const drift = restHist.length >= 4 ? Math.abs(restHist[3].base - restHist[0].base) / (now.sd || SIGMA_LOGIT) : null;

  const bands = [];
  PHASES.forEach(([k, l], j) => {
    const idx = live.map((b, i) => (b.phase === k ? i + 1 : null)).filter((v) => v != null);
    if (idx.length) bands.push({ x0: idx[0] - 0.5, x1: idx[idx.length - 1] + 0.5, label: l, kind: j === 1 ? 'b' : 'a' });
  });
  const phaseLabel = { settle: 'settling', rest: 'resting baseline', task: 'high-load task', recovery: 'recovery rest' }[req?.phase];
  // whole run on the x-axis from the start: rest + task + recovery
  const planned = N_CALIBRATION_BLOCKS + (num(req?.task_blocks_needed) || 0) + (num(req?.recovery_blocks_needed) || 0);
  const count = req?.blocks_needed ? ` · block ${req.blocks_captured ?? 0} of ${req.blocks_needed}` : '';

  return (
    <Card title="Live EEG calibration" subtitle="Each block as it is captured, with the baseline and threshold recomputed after every block"
      right={<Status kind={active ? 'good' : 'idle'}>{active ? `${phaseLabel || 'capturing'}${count}` : req?.status === 'done' ? 'last run' : 'not running'}</Status>}>
      {!live.length ? (
        <div className="chart-empty" style={{ height: 200 }}>
          {active && req?.phase === 'settle' ? 'Settling: the first block appears when the resting baseline starts.'
            : 'Start a recalibration below to watch it live.'}
        </div>
      ) : (
        <MultiLineChart points={pts} height={240} xDomain={[0.5, Math.max(live.length, planned) + 0.5]}
          xFormat={(v) => `#${Math.round(v)}`} yFormat={(v) => `1e${Math.round(v)}`} bands={bands} ariaLabel="Live EEG calibration"
          series={[
            { key: 'score', label: 'Block score', color: C.rest, width: 1.5, dots: true },
            { key: 'base', label: 'Baseline so far', color: C.base, width: 2.5, connect: true },
            { key: 'thr', label: 'Threshold so far', color: C.thr, width: 2.5, dash: true, connect: true },
          ]} />
      )}
      {now.base != null && (
        <div className="settled">
          <div><span>Baseline now</span><b>{sig(now.base).toExponential(1)}</b></div>
          <div><span>Threshold now</span><b>{sig(now.thr).toExponential(1)}</b></div>
          <div><span>Threshold from</span><b>{now.taskL != null ? (now.responsive ? 'midpoint' : 'rest + 0.84 spread') : 'rest + 0.84 spread'}</b></div>
          <div><span>Baseline</span><b>{drift == null ? 'settling…' : drift < 0.25 ? 'settled' : 'still moving'}</b></div>
          {excluded > 0 && <div><span>Unusable blocks</span><b>{excluded}</b></div>}
        </div>
      )}
    </Card>
  );
}
