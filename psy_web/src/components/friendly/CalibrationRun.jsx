import { useEffect, useState } from 'react';
import { ref, update } from 'firebase/database';
import { db, requestRecalibration, requestRingRecalibration } from '../../lib/firebase';
import { useFirebaseValue } from '../../hooks/useData';
import { CALIBRATION_SETTLE_SEC, N_CALIBRATION_BLOCKS, N_RECOVERY_BLOCKS, N_TASK_BLOCKS, BLOCK_SEC } from '../../lib/config';
import TaskActivities from './TaskActivities';
import { isTestAccount } from '../../lib/testAccounts';

// The full calibration on the main page: the same 17-minute protocol as the app
// and the website, for the headband (EEG) and the ring (HRV + GSR) side by side,
// each with its own progress. When either device reaches the task phase, the
// activities open by themselves.
//
//   1  settle        2 min   not recorded
//   2  rest          4 min   personal baseline (eyes open, breathe normally)
//   3  task          8 min   five quick rounds -> personal high-load limit
//   4  recovery      3 min   does the score come back down?
//
// Requests go to eeg_recalibration/{session} (EEG bridge) and
// ring_recalibration/{user} (ring API poller), exactly like the technical
// page's Recalibrate panel; both report their progress back to the same nodes.

const RING_WINDOW_SEC = 60;
const RING_REST = 4;
const RING_TASK = 8;
const RING_RECOVERY = 3;
const STALE_SEC = 120;
const ORDER = ['settle', 'rest', 'task', 'recovery', 'done'];
const ACTIVE = ['requested', 'capturing', 'saving'];

const pct = (v) => (v == null ? '—' : v > 0 && v < 0.01 ? '<1%' : `${Math.round(v * 100)}%`);

// One device's four steps from its request record.
function deviceView(req, now, cfg) {
  const status = req?.status;
  const stale = status === 'requested' && req?.requested_at && now / 1000 - req.requested_at > STALE_SEC;
  const active = ACTIVE.includes(status) && !stale;
  const finished = status === 'done';
  const at = finished ? ORDER.length : active ? Math.max(0, ORDER.indexOf(req?.phase)) : -1;
  const settleLeft = req?.settle_until ? Math.max(0, Math.round(req.settle_until - now / 1000)) : CALIBRATION_SETTLE_SEC;
  const steps = cfg.steps.map((s, i) => {
    const state = finished || at > i ? 'done' : at === i ? 'current' : 'todo';
    const needed = s.key === 'task' ? cfg.task(req) : s.needed;
    const got = state === 'done' ? needed : state === 'current' ? (req?.blocks_captured ?? 0) : 0;
    const detail = s.key === 'settle'
      ? (state === 'done' ? 'done' : state === 'current' ? (req?.status === 'requested' ? 'waiting to start' : `${settleLeft}s left, not recorded`) : '2 min')
      : (state === 'todo' ? `${s.minutes} min` : `${got} of ${needed} ${cfg.unit}`);
    return { ...s, state, detail };
  });
  const total = steps.reduce((t, s) => t + s.seconds(cfg, req), 0);
  const doneSec = steps.reduce((t, s) => {
    const full = s.seconds(cfg, req);
    if (s.state === 'done') return t + full;
    if (s.state !== 'current') return t;
    if (s.key === 'settle') return t + Math.max(0, CALIBRATION_SETTLE_SEC - settleLeft);
    return t + Math.min(full, (req?.blocks_captured ?? 0) * cfg.unitSec);
  }, 0);
  const progress = finished ? 100 : active ? Math.min(99, Math.round((doneSec / total) * 100)) : 0;
  let headline = 'Ready';
  let tone = 'idle';
  if (!status) headline = 'Ready';
  else if (stale) { headline = cfg.staleText; tone = 'bad'; }
  else if (status === 'failed' || status === 'error') { headline = `Didn't finish: ${req.error || req.message || 'unknown error'}`; tone = 'bad'; }
  else if (status === 'superseded') { headline = 'Cancelled: a new session started'; }
  else if (status === 'requested') { headline = 'Requested, waiting to start'; tone = 'warn'; }
  else if (status === 'saving') { headline = 'Working out your result…'; tone = 'warn'; }
  else if (finished) { headline = 'Finished'; tone = 'good'; }
  else { headline = 'Calibrating'; tone = 'warn'; }
  return { status, active, finished, stale, steps, progress, headline, tone, phase: req?.phase, reason: req?.last_reason };
}

const EEG_CFG = {
  unit: 'blocks', unitSec: BLOCK_SEC,
  staleText: 'Not picked up: is the headband bridge running and deployed?',
  task: (r) => r?.task_blocks_needed ?? r?.task_blocks ?? N_TASK_BLOCKS,
  steps: [
    { key: 'settle', label: 'Settle', minutes: 2, seconds: () => CALIBRATION_SETTLE_SEC },
    { key: 'rest', label: 'Rest: your calm baseline', minutes: 4, needed: N_CALIBRATION_BLOCKS, seconds: (c) => N_CALIBRATION_BLOCKS * c.unitSec },
    { key: 'task', label: 'Task: your stress limit', minutes: 8, seconds: (c, r) => c.task(r) * c.unitSec },
    { key: 'recovery', label: 'Recovery rest', minutes: 3, needed: N_RECOVERY_BLOCKS, seconds: (c) => N_RECOVERY_BLOCKS * c.unitSec },
  ],
};
const RING_CFG = {
  unit: 'windows', unitSec: RING_WINDOW_SEC,
  staleText: 'Not picked up: is the ring service deployed?',
  task: (r) => r?.task_windows ?? RING_TASK,
  steps: [
    { key: 'settle', label: 'Settle', minutes: 2, seconds: () => CALIBRATION_SETTLE_SEC },
    { key: 'rest', label: 'Rest: your calm baseline', minutes: 4, needed: RING_REST, seconds: (c) => RING_REST * c.unitSec },
    { key: 'task', label: 'Task: your stress limit', minutes: 8, seconds: (c, r) => c.task(r) * c.unitSec },
    { key: 'recovery', label: 'Recovery rest', minutes: 3, needed: RING_RECOVERY, seconds: (c) => RING_RECOVERY * c.unitSec },
  ],
};

function DeviceCard({ icon, title, sub, view, enabled, children }) {
  return (
    <section className={`fcard devcard ${enabled ? '' : 'off'}`}>
      <div className="dev-head">
        <span className="dev-icon" aria-hidden="true">{icon}</span>
        <div><h2 className="serif">{title}</h2><p className="muted-s">{sub}</p></div>
        <span className={`dev-state ${view.tone}`}>{enabled ? view.headline : 'Not included'}</span>
      </div>
      <div className="dev-bar" aria-label={`${title} ${view.progress}% done`}><i style={{ width: `${view.progress}%` }} /></div>
      <ol className="dev-steps">
        {view.steps.map((s) => (
          <li key={s.key} className={s.state}>
            <span className="dot" aria-hidden="true">{s.state === 'done' ? '✓' : ''}</span>
            <div><b>{s.label}</b><span>{s.detail}</span></div>
          </li>
        ))}
      </ol>
      {view.reason && view.active && <p className="callout">{view.reason}</p>}
      {children}
    </section>
  );
}

// Reads the two request records and hands them to the view.
export default function CalibrationRun(props) {
  const { picker } = props;
  const req = useFirebaseValue(picker?.sessionId ? `eeg_recalibration/${picker.sessionId}` : null);
  const ringReq = useFirebaseValue(picker?.userId ? `ring_recalibration/${picker.userId}` : null);
  const stim = useFirebaseValue('stimulator/status');
  return <CalibrationView {...props} req={req} ringReq={ringReq} simUser={stim?.uid || null} simSession={stim?.sid || null} />;
}

export function CalibrationView({ picker, now, limits, profile, req, ringReq, simUser, simSession }) {
  const sid = picker?.sessionId;
  const uid = picker?.userId;
  const live = Boolean(sid && sid === picker.liveSession);
  const testAccount = isTestAccount(uid);
  const [withEeg, setWithEeg] = useState(true);
  const [withRing, setWithRing] = useState(true);
  const [colourSafe, setColourSafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [hideTask, setHideTask] = useState(false);

  const eeg = deviceView(req, now, EEG_CFG);
  const ring = deviceView(ringReq, now, RING_CFG);
  const running = eeg.active || ring.active;
  const taskNow = (eeg.active && eeg.status === 'capturing' && eeg.phase === 'task')
    || (ring.active && ring.status === 'capturing' && ring.phase === 'task');
  useEffect(() => { if (!taskNow) setHideTask(false); }, [taskNow]);

  const saveStroop = (log) => {
    if (sid) update(ref(db, `eeg_recalibration/${sid}`), { stroop: log }).catch(() => {});
  };

  const start = async () => {
    if (!withEeg && !withRing) return;
    const what = [withEeg && 'headband', withRing && 'ring'].filter(Boolean).join(' and ');
    if (!window.confirm(
      `Calibrate the ${what} for ${uid}? It takes about 17 minutes:\n\n`
      + '1. Settle, 2 min (not recorded).\n2. Rest, 4 min: eyes open, breathe normally.\n'
      + '3. Task, 8 min: five quick rounds on this page. They open by themselves.\n4. Recovery rest, 3 min.\n\n'
      + 'Keep the devices on the whole time. The current baseline and personal limit are replaced.',
    )) return;
    setBusy(true); setError(null);
    try {
      await Promise.all([
        withEeg ? requestRecalibration(sid, uid, { includeThreshold: true, taskBlocks: N_TASK_BLOCKS }) : null,
        withRing ? requestRingRecalibration(uid, { includeThreshold: true, taskWindows: RING_TASK }) : null,
      ]);
    } catch (e) { setError(e?.message || String(e)); }
    setBusy(false);
  };

  const m = limits?.mind;
  const b = limits?.body;
  const rr = ringReq?.result;
  const startDisabled = busy || running || !uid || !testAccount || (!withEeg && !withRing) || (withEeg && !live);
  const note = !uid ? 'Pick a person first (Profile).'
    : !testAccount ? `${uid} is a real account. Calibrating from this page is limited to test accounts (ids starting sim_ or mp_), so a real person's calibration can't be replaced by mistake. Real users calibrate in the app or on the website.`
    : withEeg && !live ? 'The headband can only be calibrated for the live session: turn on "Show whoever is wearing the headband now" in Profile.'
      : 'Replaces this person’s baseline and personal limit with the ones measured now.';

  return (
    <>
      <section className="fcard calstart">
        <div className="calstart-row">
          <div>
            <h2 className="serif">Full calibration · about 17 minutes</h2>
            <p className="muted-s">Settle 2 min · Rest 4 min · Task 8 min · Recovery 3 min</p>
          </div>
          <button type="button" className="pill" onClick={start} disabled={startDisabled}>
            {busy ? 'Sending…' : running ? 'Calibrating…' : 'Start calibration'}
          </button>
        </div>
        <div className="calopts">
          <label><input type="checkbox" checked={withEeg} onChange={(e) => setWithEeg(e.target.checked)} disabled={running} /> Headband (EEG)</label>
          <label><input type="checkbox" checked={withRing} onChange={(e) => setWithRing(e.target.checked)} disabled={running} /> Ring (HRV + GSR)</label>
          <label><input type="checkbox" checked={colourSafe} onChange={(e) => setColourSafe(e.target.checked)} /> Red and green are hard to tell apart (colour test uses purple)</label>
        </div>
        <p className="muted-s">{note}</p>
        {uid && !testAccount && simUser && isTestAccount(simUser) && (
          <button type="button" className="pill" onClick={() => picker.choose({ userId: simUser, sessionId: simSession })}>
            Switch to the simulation user ({simUser})
          </button>
        )}
        {error && <p className="callout">Couldn’t send the request: {error}</p>}
        {taskNow && hideTask && (
          <p className="callout">The task is running. <button type="button" className="linkbtn" onClick={() => setHideTask(false)}>Open the activities</button></p>
        )}
      </section>

      <div className="caldevices">
        <DeviceCard icon="🧠" title="Headband (EEG)" sub="Your mind" view={eeg} enabled={withEeg || eeg.active || eeg.finished}>
          {eeg.finished && m && (
            <p className="devresult">
              Calm level <b>{pct(m.baseline)}</b> · limit <b>{pct(m.threshold)}</b> ·{' '}
              {m.personal ? 'your own limit' : 'standard limit'}{m.statusText ? ` (${m.statusText})` : ''}
            </p>
          )}
          {eeg.finished && req?.task_skipped && <p className="callout">Task skipped: {req.task_skipped}. The standard limit stays.</p>}
        </DeviceCard>
        <DeviceCard icon="💍" title="Ring (HRV + GSR)" sub="Your body" view={ring} enabled={withRing || ring.active || ring.finished}>
          {ring.finished && (rr || b) && (
            <p className="devresult">
              {rr?.personal_stress_threshold != null
                ? <>Calm level <b>{pct(rr.baseline)}</b> · task <b>{pct(rr.task_level)}</b> · your limit <b>{pct(rr.personal_stress_threshold)}</b></>
                : rr?.status === 'drift_suspected'
                  ? <>It rose but didn’t come back down in recovery, so the standard limit ({pct(b?.threshold ?? 0.6447)}) stays.</>
                  : <>Rest and task weren’t different enough, so the standard limit ({pct(b?.threshold ?? 0.6447)}) stays.</>}
            </p>
          )}
        </DeviceCard>
      </div>

      {!running && (m || b) && (
        <section className="fcard">
          <h2 className="serif">Current calibration</h2>
          <div className="settings">
            <div className="setting tone-blue">
              <small>Mind: calm level → limit</small>
              <b>{m ? `${pct(m.baseline)} → ${pct(m.threshold)}` : '—'}</b>
              <span>{m ? (m.personal ? 'Your own limit' : 'Standard limit') : 'Not calibrated yet'}</span>
            </div>
            <div className="setting tone-green">
              <small>Body: calm level → limit</small>
              <b>{b ? `${pct(b.baseline)} → ${pct(b.threshold)}` : '—'}</b>
              <span>{b ? (b.personal ? 'Your own limit' : 'Standard limit (no personal one)') : 'Not calibrated yet'}</span>
            </div>
            <div className="setting tone-peach">
              <small>Headband last calibrated</small>
              <b>{profile?.calibrated_at ? new Date(profile.calibrated_at * 1000).toLocaleDateString() : '—'}</b>
              <span>Mind limit follows this session’s calibration</span>
            </div>
          </div>
        </section>
      )}

      {taskNow && !hideTask && (
        <div className="overlay task" role="dialog" aria-modal="true" aria-label="High-load task">
          <div className="task-card">
            <div className="task-top">
              <div>
                <p className="muted-s">Step 3 of 4 · high-load task</p>
                <h2 className="serif">Five quick rounds</h2>
                <p className="muted-s">Answer by tapping or typing, not out loud. Keep the devices on and your head still.</p>
              </div>
              <button type="button" className="close" onClick={() => setHideTask(true)} aria-label="Hide the activities">×</button>
            </div>
            <TaskActivities colourSafe={colourSafe} onStroop={saveStroop} />
          </div>
        </div>
      )}
    </>
  );
}
