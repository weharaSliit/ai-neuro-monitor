import { useEffect, useRef, useState } from 'react';
import { Card, Status, ago } from './panels';
import { useFirebaseValue } from '../hooks/useData';
import { ref, update } from 'firebase/database';
import { db, requestRecalibration } from '../lib/firebase';
import StroopStressor from './StroopStressor';
import { fmt } from '../lib/model';

import { CALIBRATION_SETTLE_SEC, N_CALIBRATION_BLOCKS, N_RECOVERY_BLOCKS } from '../lib/config';

const BLOCK_SEC = 25;
const REST_BLOCKS = N_CALIBRATION_BLOCKS;   // mqtt_bridge.py: 10 rest blocks after a 2 min settle
const TASK_OPTIONS = [
  [19, 'Standard: 19 blocks (~8 min)', 'Same length as the app\'s onboarding task'],
  [8, 'Short: 8 blocks (~3.5 min)', 'Quicker, less stable threshold'],
];
const STALE_SEC = 120;            // "requested" this long = the bridge isn't picking it up

// Mental-arithmetic task shown during the task phase (the same kind of load
// as the app's onboarding task): 2-digit sums and differences, answered fast.
function ArithmeticTask() {
  const make = () => {
    const a = 12 + Math.floor(Math.random() * 78); const b = 7 + Math.floor(Math.random() * 60);
    return Math.random() < 0.5 ? { q: `${a} + ${b}`, ans: a + b } : { q: `${a + b} − ${b}`, ans: a };
  };
  const [p, setP] = useState(make);
  const [val, setVal] = useState('');
  const [score, setScore] = useState({ right: 0, wrong: 0 });
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, [p]);
  const submit = (e) => {
    e.preventDefault();
    if (val.trim() === '') return;
    setScore((s) => (Number(val) === p.ans ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 }));
    setVal(''); setP(make());
  };
  return (
    <form className="arith" onSubmit={submit}>
      <span className="arith-q">{p.q} =</span>
      <input ref={input} inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9-]/g, ''))}
        aria-label="Answer" />
      <button type="submit" className="btn">Next</button>
      <span className="muted">{score.right} right · {score.wrong} wrong. Keep going as fast as you can until this phase ends.</span>
    </form>
  );
}

// Recalibrates BOTH EEG thresholds from the live headband stream: the
// bridge records rest blocks (resting threshold / personal baseline, via
// /calibrate) and then task blocks (high-load threshold check, via
// /calibrate/threshold) -- the same methods as session start and the app's
// onboarding task. Requests go to eeg_recalibration/{session}.
export default function RecalibratePanel({ picker, now, streaming }) {
  const sid = picker?.sessionId;
  const live = sid && sid === picker.liveSession;
  const req = useFirebaseValue(sid ? `eeg_recalibration/${sid}` : null);
  const [taskBlocks, setTaskBlocks] = useState(19);
  const [taskKind, setTaskKind] = useState('stroop');      // stroop (recommended) | arithmetic
  const [colourSafe, setColourSafe] = useState(false);
  const [stroopDone, setStroopDone] = useState(null);
  // The Stroop's trial log goes next to the request, for engagement checks
  // and for aligning trials with EEG blocks by timestamp.
  const saveStroop = (log) => {
    setStroopDone(log.summary);
    if (sid) update(ref(db, `eeg_recalibration/${sid}`), { stroop: log }).catch(() => {});
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const status = req?.status;
  const phase = req?.phase;
  const active = status === 'requested' || status === 'capturing' || status === 'saving';
  const stale = status === 'requested' && req.requested_at && now / 1000 - req.requested_at > STALE_SEC;

  const start = async () => {
    const total = CALIBRATION_SETTLE_SEC + (REST_BLOCKS + taskBlocks + N_RECOVERY_BLOCKS) * BLOCK_SEC;
    if (!window.confirm(
      `Recalibrate both EEG thresholds for session ${sid}?\n\n`
      + `1. Settle: ${CALIBRATION_SETTLE_SEC / 60} min (not recorded).\n`
      + `2. Resting baseline: ${REST_BLOCKS} blocks (~${Math.round(REST_BLOCKS * BLOCK_SEC / 60)} min). Eyes open, breathe normally.\n`
      + `3. High-load task: ${taskBlocks} blocks (~${Math.round(taskBlocks * BLOCK_SEC / 60)} min) of mental arithmetic on this page.\n`
      + `4. Recovery rest: ${N_RECOVERY_BLOCKS} blocks (~${Math.round(N_RECOVERY_BLOCKS * BLOCK_SEC / 60)} min).\n\n`
      + `About ${Math.round(total / 60)} minutes in all. The current baseline is replaced.`,
    )) return;
    setBusy(true); setError(null); setStroopDone(null);
    try { await requestRecalibration(sid, picker.userId, { includeThreshold: true, taskBlocks }); } catch (e) { setError(e?.message || String(e)); }
    setBusy(false);
  };

  // Progress across all four phases, in seconds.
  const nTask = req?.task_blocks_needed ?? req?.task_blocks ?? taskBlocks;
  const nRec = req?.recovery_blocks_needed ?? (req?.include_threshold === false ? 0 : N_RECOVERY_BLOCKS);
  const order = ['settle', 'rest', 'task', 'recovery', 'done'];
  const at = order.indexOf(phase);
  const settleDone = at > 0 ? CALIBRATION_SETTLE_SEC
    : req?.settle_until ? Math.max(0, CALIBRATION_SETTLE_SEC - Math.max(0, req.settle_until - now / 1000)) : 0;
  const blocksDone = (name, n) => (at > order.indexOf(name) ? n : phase === name ? (req?.blocks_captured ?? 0) : 0);
  const doneSec = settleDone + (blocksDone('rest', REST_BLOCKS) + blocksDone('task', nTask) + blocksDone('recovery', nRec)) * BLOCK_SEC;
  const totalSec = CALIBRATION_SETTLE_SEC + (REST_BLOCKS + (req?.include_threshold === false ? 0 : nTask) + nRec) * BLOCK_SEC;
  const pct = phase === 'done' ? 100 : Math.min(99, Math.round((doneSec / totalSec) * 100));
  const settleLeft = req?.settle_until ? Math.max(0, Math.round(req.settle_until - now / 1000)) : CALIBRATION_SETTLE_SEC;

  // A bridge older than the 4-phase protocol ignores include_threshold and
  // reports a rest-only run without a 'phase' field.
  const oldBridge = status === 'done' && req?.include_threshold && !req?.phase;
  let headline; let kind = 'idle';
  if (!status) { headline = 'Ready'; }
  else if (stale) { headline = 'Not picked up: is mqtt_bridge.py running and redeployed?'; kind = 'critical'; }
  else if (status === 'requested') { headline = 'Requested: waiting for the bridge (checks every 10 s)'; kind = 'warning'; }
  else if (status === 'capturing' && phase === 'settle') { headline = `1 of 4 · settling: ${settleLeft}s left (not recorded)`; kind = 'warning'; }
  else if (status === 'capturing' && phase === 'task') { headline = `3 of 4 · high-load task: block ${req.blocks_captured ?? 0} of ${req.blocks_needed}`; kind = 'warning'; }
  else if (status === 'capturing' && phase === 'recovery') { headline = `4 of 4 · recovery rest: block ${req.blocks_captured ?? 0} of ${req.blocks_needed}`; kind = 'warning'; }
  else if (status === 'capturing') { headline = `2 of 4 · resting baseline: block ${req.blocks_captured ?? 0} of ${req.blocks_needed ?? REST_BLOCKS}`; kind = 'warning'; }
  else if (status === 'saving') { headline = phase === 'recovery' || phase === 'task' ? 'Computing the high-load threshold…' : 'Computing the baseline…'; kind = 'warning'; }
  else if (status === 'done') { headline = oldBridge ? 'Finished rest only: the bridge on the server is an old version' : 'Recalibration finished'; kind = oldBridge ? 'critical' : req.threshold?.status === 'ok' || (!req.threshold && !req.task_skipped) ? 'good' : 'warning'; }
  else if (status === 'superseded') { headline = 'Cancelled: the app started a new session'; }
  else { headline = status; }

  return (
    <Card title="Recalibrate both EEG thresholds" subtitle="From the live headband stream: 2 min settle → 4 min rest (personal baseline) → 8 min task (high-load threshold) → 3 min recovery"
      right={<Status kind={kind}>{headline}</Status>}>
      <div className="recal-bar">
        <button type="button" className="btn" onClick={start} disabled={!live || busy || (active && !stale)}
          title={!live ? 'Only the live session the bridge is serving can be recalibrated' : undefined}>
          {busy ? 'Sending…' : active && !stale ? 'Recalibrating…' : 'Recalibrate'}
        </button>
        <label className="muted">
          Task{' '}
          <select value={taskKind} onChange={(e) => setTaskKind(e.target.value)} disabled={active && !stale}>
            <option value="stroop">Stroop colour test (recommended)</option>
            <option value="arithmetic">Mental arithmetic</option>
          </select>
        </label>
        {taskKind === 'stroop' && (
          <label className="muted">
            <input type="checkbox" checked={colourSafe} onChange={(e) => setColourSafe(e.target.checked)} /> purple instead of green
          </label>
        )}
        <label className="muted">
          Length{' '}
          <select value={taskBlocks} onChange={(e) => setTaskBlocks(Number(e.target.value))} disabled={active && !stale}>
            {TASK_OPTIONS.map(([n, label, hint]) => <option key={n} value={n} title={hint}>{label}</option>)}
          </select>
        </label>
        <div className="recal-status">
          {!sid ? <span className="muted">Pick a session first.</span>
            : !live ? <span className="muted">Not the live session: turn on &quot;Follow live session&quot; to recalibrate.</span>
              : !streaming ? <span className="caption warn-text">▲ No live EEG reached the bridge in the last minute; recalibration starts once it streams.</span>
                : <span className="muted">Replaces this session&apos;s baseline and high-load threshold using the data arriving now.</span>}
          {error && <span className="caption warn-text">▲ Couldn&apos;t send the request: {error}</span>}
        </div>
      </div>

      {active && !stale && (
        <>
          <div className="recal-progress" aria-label={`Recalibration ${pct}% complete`}><i style={{ width: `${pct}%` }} /></div>
          {phase === 'task' ? (
            <div className="recal-step">
              {taskKind === 'stroop' ? (
                stroopDone ? (
                  <span>Colour test done: {Math.round((stroopDone.accuracy ?? 0) * 100)}% of {stroopDone.n_trials} ({stroopDone.engagement}). Waiting for the last task blocks…</span>
                ) : (
                  <>
                    <strong>Step 3: high-load task.</strong>
                    <StroopStressor durationSec={Math.max(30, ((req?.blocks_needed ?? nTask) - (req?.blocks_captured ?? 0)) * BLOCK_SEC)}
                      colourSafe={colourSafe} roundLabel="Stroop" onDone={saveStroop} />
                  </>
                )
              ) : (
                <>
                  <strong>Step 3: high-load task.</strong> Solve these as fast as you can, without stopping, until this step ends. Keep your head still.
                  <ArithmeticTask />
                </>
              )}
            </div>
          ) : phase === 'recovery' ? (
            <div className="recal-step">
              <strong>Step 4: recovery rest.</strong> The task is over. Sit still, eyes open, breathe normally and look at one spot.
              This shows how quickly the score settles after load.
            </div>
          ) : phase === 'settle' || status === 'requested' ? (
            <div className="recal-step">
              <strong>Step 1: settling ({settleLeft}s).</strong> Get comfortable with the headband on. Nothing is recorded yet.
            </div>
          ) : status === 'capturing' ? (
            <div className="recal-step">
              <strong>Step 2: resting baseline.</strong> Sit still, eyes open, breathe normally, look at one spot and relax. Don&apos;t talk or move your jaw.
            </div>
          ) : null}
          {req?.last_reason && <p className="caption warn-text">▲ {req.last_reason}</p>}
        </>
      )}

      {oldBridge && (
        <p className="caption warn-text">
          ▲ Only the resting baseline was recalibrated: the EEG bridge on the server doesn&apos;t have the settle / task / recovery
          phases yet, so the high-load task was skipped. Redeploy the EEG bridge and API on Render, then recalibrate again.
        </p>
      )}
      {status === 'done' && (
        <div className="recal-result">
          <div>
            <h3>Resting threshold (personal baseline)</h3>
            <p>μ_rest <b>{fmt(req.mu_rest, 4)}</b> from {req.usable_blocks ?? '—'} rest block(s){req.baseline_degraded ? ' (degraded)' : ''}
              {req.amplitude_gain ? ` · amplitude gain ${fmt(req.amplitude_gain, 1)}×` : ''}</p>
          </div>
          <div>
            <h3>High-load threshold</h3>
            {req.threshold ? (
              <p>Limit <b>{fmt(req.threshold.personal_high_load_p ?? req.personal_high_load_p, 4)}</b> ·
                task z {req.threshold.task_response_z == null ? '—' : req.threshold.task_response_z.toFixed(2)} (needs ≥ 0.5) ·{' '}
                {req.threshold.responsive ? 'responsive' : 'not responsive: re-seat the electrodes and repeat'}</p>
            ) : req.task_skipped ? (
              <p className="warn-text">Task skipped: {req.task_skipped}. Limit stays μ_rest + 0.84σ = {fmt(req.personal_high_load_p, 4)}.</p>
            ) : req.threshold_error ? (
              <p className="warn-text">Task failed: {req.threshold_error}. Limit stays μ_rest + 0.84σ = {fmt(req.personal_high_load_p, 4)}.</p>
            ) : <p>Limit μ_rest + 0.84σ = <b>{fmt(req.personal_high_load_p, 4)}</b> (no task in this run).</p>}
          </div>
          {req.recovery && req.recovery.n_recovery_blocks > 0 && (
            <div>
              <h3>Recovery rest</h3>
              <p>Mean score {fmt(req.recovery.recovery_mean, 3)} · z {req.recovery.recovery_z == null ? '—' : req.recovery.recovery_z.toFixed(2)} ·{' '}
                {req.recovery.recovered ? 'back below the high-load limit' : 'still above the high-load limit'}</p>
            </div>
          )}
          <p className="caption">Finished {req.updated_at ? ago(req.updated_at * 1000, now) : ''}. The graphs below update with the new calibration.</p>
        </div>
      )}
    </Card>
  );
}
