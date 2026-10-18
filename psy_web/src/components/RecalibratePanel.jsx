import { useEffect, useRef, useState } from 'react';
import { Card, Status, ago } from './panels';
import { useFirebaseValue } from '../hooks/useData';
import { ref, update } from 'firebase/database';
import { db, requestRecalibration, requestRingRecalibration } from '../lib/firebase';
import StroopStressor from './StroopStressor';
import { isTestAccount } from '../lib/testAccounts';
import { fmt } from '../lib/model';
import { eegD, eegLimitInfo, eegStatusText, mean, num, plausible, sig } from '../lib/limits';

import { CALIBRATION_SETTLE_SEC, N_CALIBRATION_BLOCKS, N_RECOVERY_BLOCKS } from '../lib/config';

// Ring (HRV/GSR) protocol: 60 s windows -- backend/common/config.py N_BASELINE_WIN / N_RECOVERY_WIN.
const RING_WINDOW_SEC = 60;
const RING_REST_WINDOWS = 4;
const RING_RECOVERY_WINDOWS = 3;
// Same task length as the headband's, in whole ring windows (19 blocks -> 8, 8 blocks -> 3).
const ringTaskWindows = (eegBlocks) => Math.max(3, Math.round((eegBlocks * 25) / RING_WINDOW_SEC));

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
  // Result in the current method (median baseline, own spread, midpoint
  // limit), from the backend's values when it has them, else worked out here
  // from the stored scores -- same helpers as the dashboard cards.
  // The request only carries summaries; the block scores are in the session's results.
  const uid = req?.user_id || picker?.userId;
  const base = uid && sid ? `psychological/${uid}/${sid}` : null;
  const calStored = useFirebaseValue(base ? `${base}/calibration_result` : null);
  const thrStored = useFirebaseValue(base ? `${base}/threshold_result` : null);
  // Only trust stored results written by this run (not an earlier calibration).
  // Stored results belong to this run only if written during it: a later
  // calibration (e.g. the web app's own, run afterwards) overwrites them,
  // and must not be shown as this recalibration's result.
  const doneAt = req?.status === 'done' ? num(req.updated_at) : null;
  const fresh = (r) => r && (!req?.requested_at || !r.updated_at
    || (r.updated_at >= req.requested_at - 5 && (doneAt == null || r.updated_at <= doneAt + 120)));
  // This run's own per-block scores (eeg_recalibration/{sid}/live), the
  // fallback when the stored results are from another run.
  const liveList = req?.live ? (Array.isArray(req.live) ? req.live : Object.values(req.live)).filter(Boolean) : [];
  const livePhase = (ph) => liveList.filter((b) => b.phase === ph).map((b) => num(b.score));
  const liveThr = liveList.length ? { task_scores: livePhase('task'), recovery_scores: livePhase('recovery'), rest_scores: livePhase('rest') } : null;
  const overwritten = Boolean(req?.status === 'done' && thrStored?.updated_at && !fresh(thrStored));
  const thr = fresh(thrStored) ? thrStored : liveThr || req?.threshold || null;
  const cal = fresh(calStored) ? calStored : { ...req, rest_scores: liveThr?.rest_scores };
  const restScores = thr?.rest_scores || cal?.rest_scores || [];
  const info = req ? eegLimitInfo({ ...cal, rest_scores: restScores }, thr) : null;
  const restN = restScores.map(num).filter(plausible).length || req?.usable_blocks || 0;
  const recScores = (thr?.recovery_scores || req?.recovery?.recovery_scores || []).map(num).filter(plausible);
  const recMean = mean(recScores);
  const recovery = info && recMean != null ? { mean: recMean, dist: eegD(recMean, info) } : null;
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
  const [withEeg, setWithEeg] = useState(true);
  const [withRing, setWithRing] = useState(true);
  const ringReq = useFirebaseValue(picker?.userId ? `ring_recalibration/${picker.userId}` : null);
  const ringActive = ['requested', 'capturing', 'saving'].includes(ringReq?.status);
  const ringStale = ringReq?.status === 'requested' && ringReq.requested_at && now / 1000 - ringReq.requested_at > STALE_SEC;

  const status = req?.status;
  const eegActive = status === 'requested' || status === 'capturing' || status === 'saving';
  const stale = status === 'requested' && req.requested_at && now / 1000 - req.requested_at > STALE_SEC;
  const active = (eegActive && !stale) || (ringActive && !ringStale);
  // The step shown to the user follows the headband when it's running, else the ring.
  const phase = eegActive && !stale ? req?.phase : ringActive ? ringReq?.phase : req?.phase;

  const start = async () => {
    const total = CALIBRATION_SETTLE_SEC + (REST_BLOCKS + taskBlocks + N_RECOVERY_BLOCKS) * BLOCK_SEC;
    const what = [withEeg && 'EEG headband', withRing && 'HRV/GSR ring'].filter(Boolean).join(' and ');
    if (!what) return;
    if (!window.confirm(
      `Recalibrate the baseline and high-load threshold of the ${what}${withEeg ? ` (session ${sid})` : ''}?\n\n`
      + `1. Settle: ${CALIBRATION_SETTLE_SEC / 60} min (not recorded).\n`
      + `2. Resting baseline: ${REST_BLOCKS} blocks (~${Math.round(REST_BLOCKS * BLOCK_SEC / 60)} min). Eyes open, breathe normally.\n`
      + `3. High-load task: ${taskBlocks} blocks (~${Math.round(taskBlocks * BLOCK_SEC / 60)} min) of mental arithmetic on this page.\n`
      + `4. Recovery rest: ${N_RECOVERY_BLOCKS} blocks (~${Math.round(N_RECOVERY_BLOCKS * BLOCK_SEC / 60)} min).\n\n`
      + `About ${Math.round(total / 60)} minutes in all. The current baseline is replaced.`
      + (withRing ? `\n\nThe ring uses 1-minute windows: ${RING_REST_WINDOWS} rest, ${ringTaskWindows(taskBlocks)} task, ${RING_RECOVERY_WINDOWS} recovery.` : ''),
    )) return;
    setBusy(true); setError(null); setStroopDone(null);
    try {
      await Promise.all([
        withEeg ? requestRecalibration(sid, picker.userId, { includeThreshold: true, taskBlocks }) : null,
        withRing ? requestRingRecalibration(picker.userId, { includeThreshold: true, taskWindows: ringTaskWindows(taskBlocks) }) : null,
      ]);
    } catch (e) { setError(e?.message || String(e)); }
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
  const ringOrder = ['settle', 'rest', 'task', 'recovery', 'done'];
  const ringAt = ringOrder.indexOf(ringReq?.phase);
  const ringTask = ringReq?.task_windows ?? ringTaskWindows(taskBlocks);
  const ringWin = (name, n) => (ringAt > ringOrder.indexOf(name) ? n : ringReq?.phase === name ? (ringReq?.blocks_captured ?? 0) : 0);
  const ringSettle = ringAt > 0 ? CALIBRATION_SETTLE_SEC
    : ringReq?.settle_until ? Math.max(0, CALIBRATION_SETTLE_SEC - Math.max(0, ringReq.settle_until - now / 1000)) : 0;
  const ringPct = ringReq?.phase === 'done' ? 100 : Math.min(99, Math.round(((ringSettle
    + (ringWin('rest', RING_REST_WINDOWS) + ringWin('task', ringTask) + ringWin('recovery', RING_RECOVERY_WINDOWS)) * RING_WINDOW_SEC)
    / (CALIBRATION_SETTLE_SEC + (RING_REST_WINDOWS + ringTask + RING_RECOVERY_WINDOWS) * RING_WINDOW_SEC)) * 100));
  const pct = eegActive && !stale ? (phase === 'done' ? 100 : Math.min(99, Math.round((doneSec / totalSec) * 100))) : ringPct;
  const settleUntil = eegActive && !stale ? req?.settle_until : ringReq?.settle_until;
  const settleLeft = settleUntil ? Math.max(0, Math.round(settleUntil - now / 1000)) : CALIBRATION_SETTLE_SEC;
  // Task time left: the longer of the two devices still in their task.
  const eegTaskLeft = req?.phase === 'task' && eegActive ? ((req?.blocks_needed ?? nTask) - (req?.blocks_captured ?? 0)) * BLOCK_SEC : 0;
  const ringTaskLeft = ringReq?.phase === 'task' && ringActive ? ((ringReq?.blocks_needed ?? ringTask) - (ringReq?.blocks_captured ?? 0)) * RING_WINDOW_SEC : 0;
  const taskNow = req?.phase === 'task' && eegActive ? 'task' : ringReq?.phase === 'task' && ringActive ? 'task' : null;

  const ringHeadline = !ringReq?.status ? null
    : ringStale ? 'not picked up: is the ring API redeployed?'
      : ringReq.status === 'requested' ? 'requested: waiting for the ring API (checks every 5 s)'
        : ringReq.status === 'failed' ? `failed: ${ringReq.error || 'unknown error'}`
          : ringReq.status === 'saving' ? 'computing…'
            : ringReq.status === 'done' ? 'finished'
              : ringReq.phase === 'settle' ? `settling (${ringReq.settle_until ? Math.max(0, Math.round(ringReq.settle_until - now / 1000)) : '—'}s left)`
                : `${ringReq.phase === 'rest' ? 'resting baseline' : ringReq.phase === 'task' ? 'high-load task' : 'recovery rest'}: window ${ringReq.blocks_captured ?? 0} of ${ringReq.blocks_needed ?? '—'}`;

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
    <Card title="Recalibrate baseline and high-load threshold" subtitle="From the live headband and ring streams: 2 min settle → 4 min rest (personal baseline) → 8 min task (high-load threshold) → 3 min recovery"
      right={<Status kind={eegActive || !ringActive ? kind : "warning"}>{eegActive || !ringActive ? headline : `Ring · ${ringHeadline}`}</Status>}>
      <div className="recal-bar">
        <button type="button" className="btn" onClick={start}
          disabled={busy || active || (!withEeg && !withRing) || (withEeg && !live) || !picker?.userId || !isTestAccount(picker?.userId)}
          title={!isTestAccount(picker?.userId) ? 'Limited to test accounts (sim_ / mp_)' : withEeg && !live ? 'Only the live session the bridge is serving can be recalibrated' : undefined}>
          {busy ? 'Sending…' : active ? 'Recalibrating…' : 'Recalibrate'}
        </button>
        <label className="muted">
          <input type="checkbox" checked={withEeg} onChange={(e) => setWithEeg(e.target.checked)} disabled={active} /> EEG headband
        </label>
        <label className="muted">
          <input type="checkbox" checked={withRing} onChange={(e) => setWithRing(e.target.checked)} disabled={active} /> HRV/GSR ring
        </label>
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
          {picker?.userId && !isTestAccount(picker.userId) ? <span className="caption warn-text">▲ {picker.userId} is a real account: recalibrating from here is limited to test accounts (sim_ / mp_).</span>
            : !sid ? <span className="muted">Pick a session first.</span>
            : !live ? <span className="muted">Not the live session: turn on &quot;Follow live session&quot; to recalibrate.</span>
              : !streaming ? <span className="caption warn-text">▲ No live EEG reached the bridge in the last minute; recalibration starts once it streams.</span>
                : <span className="muted">Replaces this session&apos;s baseline and high-load threshold using the data arriving now.</span>}
          {ringHeadline && <span className={ringReq.status === 'failed' || ringStale ? 'caption warn-text' : 'muted'}>HRV/GSR ring: {ringHeadline}</span>}
          {error && <span className="caption warn-text">▲ Couldn&apos;t send the request: {error}</span>}
        </div>
      </div>

      {active && (
        <>
          <div className="recal-progress" aria-label={`Recalibration ${pct}% complete`}><i style={{ width: `${pct}%` }} /></div>
          {taskNow ? (
            <div className="recal-step">
              {taskKind === 'stroop' ? (
                stroopDone ? (
                  <span>Colour test done: {Math.round((stroopDone.accuracy ?? 0) * 100)}% of {stroopDone.n_trials} ({stroopDone.engagement}). Waiting for the last task blocks…</span>
                ) : (
                  <>
                    <strong>Step 3: high-load task.</strong>
                    <StroopStressor durationSec={Math.max(30, eegTaskLeft, ringTaskLeft)}
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
          ) : phase === 'settle' || status === 'requested' || ringReq?.status === 'requested' ? (
            <div className="recal-step">
              <strong>Step 1: settling ({settleLeft}s).</strong> Get comfortable with the headband on. Nothing is recorded yet.
            </div>
          ) : status === 'capturing' || ringReq?.status === 'capturing' ? (
            <div className="recal-step">
              <strong>Step 2: resting baseline.</strong> Sit still, eyes open, breathe normally, look at one spot and relax. Don&apos;t talk or move your jaw.
            </div>
          ) : null}
          {req?.last_reason && <p className="caption warn-text">▲ {req.last_reason}</p>}
          {ringReq?.last_reason && ringActive && <p className="caption warn-text">▲ Ring: {ringReq.last_reason}</p>}
        </>
      )}

      {oldBridge && (
        <p className="caption warn-text">
          ▲ Only the resting baseline was recalibrated: the EEG bridge on the server doesn&apos;t have the settle / task / recovery
          phases yet, so the high-load task was skipped. Redeploy the EEG bridge and API on Render, then recalibrate again.
        </p>
      )}
      {status === 'done' && info && (
        <div className="recal-result">
          <div>
            <h3>Resting threshold (personal baseline)</h3>
            <p>Baseline <b>{fmt(sig(info.level), 4)}</b> (median of {restN} rest block{restN === 1 ? '' : 's'}) · spread {info.sd.toFixed(2)} log-odds
              {req.baseline_degraded ? ' (degraded)' : ''}{req.amplitude_gain ? ` · amplitude gain ${fmt(req.amplitude_gain, 1)}×` : ''}</p>
          </div>
          <div>
            <h3>High-load threshold</h3>
            {info.rawTaskL != null ? (
              <p>Limit <b>{fmt(sig(info.rawLimitL), 4)}</b> ({info.method}) · sustained task {fmt(sig(info.rawTaskL), 4)} ·
                change vs rest {info.sepSd == null ? '—' : `${info.sepSd > 0 ? '+' : ''}${info.sepSd.toFixed(2)}`} spreads (needs ≥ 1 either way)
                {info.reversalSd != null ? ` · recovery back ${info.reversalSd.toFixed(2)} (needs ≥ 0.5)` : ' · no recovery check'} ·{' '}
                <b>{eegStatusText(info)}</b>
                {info.status === 'drift_suspected' ? '. The change didn\'t reverse after the task, so it looks like slow drift. Let the headband settle longer and repeat.'
                  : info.status === 'not_separated' ? '. The task didn\'t change the signal. Re-seat the electrodes and repeat.' : ''}</p>
            ) : req.task_skipped ? (
              <p className="warn-text">Task skipped: {req.task_skipped}. Limit stays rest + 0.84 spread = {fmt(sig(info.rawLimitL), 4)}.</p>
            ) : req.threshold_error ? (
              <p className="warn-text">Task failed: {req.threshold_error}. Limit stays rest + 0.84 spread = {fmt(sig(info.rawLimitL), 4)}.</p>
            ) : <p>Limit rest + 0.84 spread = <b>{fmt(sig(info.rawLimitL), 4)}</b> (no task in this run).</p>}
          </div>
          {recovery && (
            <div>
              <h3>Recovery rest</h3>
              <p>Mean score {fmt(recovery.mean, 3)} · {recovery.dist.toFixed(2)} spreads {recovery.dist < 0 ? 'below' : 'above'} the limit ·{' '}
                {recovery.dist < 0 ? 'back below the high-load limit' : 'still above the high-load limit'}</p>
            </div>
          )}
          {overwritten && (
            <p className="caption warn-text">▲ A later calibration (e.g. from the app) has since replaced this session&apos;s stored
              thresholds. This result is from this recalibration&apos;s own live blocks; the graphs above show the later one.</p>
          )}
          {info.src === 'computed' && (
            <p className="caption warn-text">▲ Worked out here from the stored scores with the midpoint method. The server still runs the old
              method until it is redeployed, so live alerts use its older limit until then.</p>
          )}
          <p className="caption">Finished {req.updated_at ? ago(req.updated_at * 1000, now) : ''}. The graphs below update with the new calibration.</p>
        </div>
      )}
      {ringReq?.status === 'done' && (
        <div className="recal-result">
          <div>
            <h3>HRV/GSR ring</h3>
            {ringReq.result?.status ? (
              <p>Baseline <b>{fmt(ringReq.result.baseline, 3)}</b> · sustained task {fmt(ringReq.result.task_level, 3)} ·{' '}
                {ringReq.result.personal_stress_threshold != null
                  ? <>limit <b>{fmt(ringReq.result.personal_stress_threshold, 3)}</b> (midpoint) · responsive</>
                  : ringReq.result.status === 'drift_suspected'
                    ? <>drift suspected: it rose but didn&apos;t come back down in recovery, so the population limit 0.645 stays</>
                    : <>not separated (needs {fmt(ringReq.result.needed_separation, 3)}): the population limit 0.645 stays</>}
                {ringReq.result.recovered != null ? ` · recovery ${ringReq.result.recovered ? 'back below the limit' : 'still above the limit'}` : ''}</p>
            ) : <p>Resting baseline saved ({ringReq.result?.rest_windows ?? '—'} windows); the task wasn&apos;t run.</p>}
          </div>
          <p className="caption">Finished {ringReq.updated_at ? ago(ringReq.updated_at * 1000, now) : ''}.</p>
        </div>
      )}
    </Card>
  );
}
