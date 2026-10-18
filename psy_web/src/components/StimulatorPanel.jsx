import { useEffect, useState } from 'react';
import { Card, Status } from './panels';
import { MultiLineChart } from './charts';
import { useFirebaseValue } from '../hooks/useData';
import { STIM_PROFILES, mmss, useStimulator } from '../hooks/useStimulator';
import { sendStimulatorCommand, shallowKeys } from '../lib/firebase';
import { isTestAccount } from '../lib/testAccounts';

// Live stimulator (backend/simulation/live_stimulator.py, run on a laptop):
// simulated headband + ring data for the user who is ALREADY logged in with
// the devices -- it never logs anyone in or changes the user. Only while it
// is started do its data replace the real devices' readings; they then go
// through the real bridges, APIs and fusion engine, so every dashboard shows
// them exactly as it shows real readings. Optionally it recalibrates that
// user first (rest -> task -> recovery), then loops calm / demand.
const COMMAND = 'venv/bin/python backend/simulation/live_stimulator.py';
const STEPS = [
  ['settle', 'Settle', '2 min'], ['rest', 'Rest baseline', '4 min'], ['task', 'HIGH-LOAD TASK', '8 min'],
  ['recovery', 'Recovery', '3 min'], ['calm', 'Live: calm', '4 min'], ['demand', 'Live: HIGH-LOAD', '4 min'],
];
const FRESH_SEC = 60;
// Live scenarios (backend/simulation/simkit/session.py SCENARIOS).
export const SCENARIOS = {
  four_state: 'All four states: relaxed → mental load → physical arousal → stress (with recoveries)',
  ramp: 'Gradual ramp + moderate plateau (early warning)',
  steps: 'Calm / high-load steps',
};
const PHASE_LABEL = { calm: 'Calm', demand: 'High load', ramp: 'Load rising', plateau: 'Moderate load', relaxed: 'Relaxed',
  mental: 'High mental load (body calm)', arousal: 'Physical arousal (mind calm)', stress: 'Stress (mind + body)', recovery: 'Recovery' };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Check({ ok, warn, title, children }) {
  return (
    <li className={`stim-check ${ok ? 'ok' : warn ? 'warn' : 'todo'}`}>
      <span className="stim-check-mark">{ok ? '✓' : warn ? '!' : '○'}</span>
      <div><b>{title}</b><div className="caption">{children}</div></div>
    </li>
  );
}

// Users to simulate for: every account with EEG or fusion data.
function useKnownUsers() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(['psychological', 'fusion_en', 'physiological/baselines'].map((p) => shallowKeys(p).catch(() => [])))
      .then((lists) => { if (!cancelled) setUsers([...new Set(lists.flat())].filter((u) => !u.startsWith('current_')).sort()); });
    return () => { cancelled = true; };
  }, []);
  return users;
}

export default function StimulatorPanel({ now }) {
  const loggedIn = useFirebaseValue('fusion_en_sessions/current_user_id') || null;
  const knownUsers = useKnownUsers();
  const [userPick, setUserPick] = useState('');        // '' = the logged-in user
  const [newUser, setNewUser] = useState('');
  const target = userPick === '__new__' ? newUser.trim() : userPick || loggedIn;
  const takeover = Boolean(target) && target !== loggedIn;
  const loggedSession = useFirebaseValue('fusion_en_sessions/current_session_id') || null;
  const stim = useStimulator(now, loggedSession);
  const st = stim.status;
  const headband = useFirebaseValue('eeg_devices/wearable02');
  const ringDev = useFirebaseValue('physiological/devices/wearable01');
  // The deployed ring bridge only predicts for a user WITH a ring baseline; without
  // one every window is skipped and fusion runs on the mind alone.
  const ringUser = stim.running ? st?.uid : target;
  const ringBase = useFirebaseValue(ringUser ? `physiological/baselines/${ringUser}/updated_at` : null);
  const ringReq = useFirebaseValue(ringUser ? `ring_recalibration/${ringUser}` : null);
  const ringReqStuck = ringReq?.status === 'requested' && ringReq.requested_at && now / 1000 - ringReq.requested_at > 60;
  const [profile, setProfile] = useState('responsive');
  const [scenario, setScenario] = useState('four_state');
  const [recalibrate, setRecalibrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Device heartbeats: the headband stores epoch seconds, the ring an ISO time (UTC).
  const seenAgo = (v) => {
    const t = typeof v === 'number' ? v * 1000 : v ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : NaN;
    return Number.isFinite(t) ? (now - t) / 1000 : null;
  };
  const hbAgo = seenAgo(headband?.last_seen); const ringAgo = seenAgo(ringDev?.last_seen);
  const hbOn = hbAgo != null && hbAgo < FRESH_SEC; const ringOn = ringAgo != null && ringAgo < FRESH_SEC;
  const realOn = !stim.running && (hbOn || ringOn);
  const testUser = isTestAccount(target);
  const canStart = stim.online && !stim.running && Boolean(target) && /^[A-Za-z0-9_.-]{2,40}$/.test(target) && testUser;

  const send = async (cmd, extra = {}) => {
    setBusy(true); setError(null);
    try { await sendStimulatorCommand(cmd, { profile, recalibrate, scenario, userId: takeover ? target : null, ...extra }); } catch (e) { setError(e?.message || String(e)); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(COMMAND); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  const phase = st?.phase || (st?.stage || '').replace('live: ', '');
  const at = STEPS.findIndex(([k]) => k === phase);
  // calibration: the protocol steps; live: the scenario's current phase
  const steps = st?.calibrating ? STEPS.slice(0, 4)
    : [[phase, `Live: ${PHASE_LABEL[phase] || String(phase || '').replace(/_/g, ' ')}`, st?.phase_left != null ? `${mmss(st.phase_left)} left` : '']];
  const tl = stim.timeline.slice(-360).map((p) => ({ x: p.t, d: p.demand, bd: p.body_demand ?? null, b: p.brain, h: p.heart, s: p.skin }));

  return (
    <Card title="Live stimulator" subtitle="Simulated EEG and HRV/GSR for the logged-in user, through the real pipeline. Off = the real devices' readings are used"
      right={<Status kind={!stim.online ? 'idle' : stim.running ? 'good' : 'warning'}>
        {!stim.online ? 'program not running' : stim.running ? `running · ${st.profile}` : 'ready to start'}</Status>}>
      <div id="stimulator" />
      {!stim.running && (
        <>
          <h3>How to start</h3>
          <ol className="stim-checks">
            <Check ok={stim.online} title="1. Run the stimulator program on your laptop">
              In the repository folder: <code>{COMMAND}</code>{' '}
              <button type="button" className="link" onClick={copy}>{copied ? 'copied' : 'copy'}</button>
              {stim.online ? ' · connected.' : ' · waiting for it (turns green a few seconds after it starts).'}
            </Check>
            <Check ok={Boolean(target) && testUser} warn={Boolean(target) && !testUser} title="2. Choose a TEST account to simulate (sim_… or mp_…)">
              <div className="recal-bar" style={{ marginTop: 6 }}>
                <label className="muted">User{' '}
                  <select value={userPick} onChange={(e) => setUserPick(e.target.value)}>
                    <option value="">{loggedIn ? `Logged-in user (${loggedIn})` : 'Logged-in user (nobody logged in)'}</option>
                    {knownUsers.filter((u) => u !== loggedIn).map((u) => <option key={u} value={u}>{u}{isTestAccount(u) ? '' : ' (real account)'}</option>)}
                    <option value="__new__">New user…</option>
                  </select>
                </label>
                {userPick === '__new__' && <input type="text" value={newUser} placeholder="user id, e.g. sim_demo1" aria-label="New user id"
                  onChange={(e) => setNewUser(e.target.value)} />}
              </div>
              {!target ? 'Nobody is logged in: choose a test user (or log in on StressApp with one).'
                : !testUser ? <><b>{target}</b> is a real account. The simulation won&apos;t run for it: it would replace that person&apos;s calibration and add simulated readings to their history. Choose a test account (sim_… or mp_…).</>
                : takeover ? <><b>{target}</b>: the stimulator logs in as this user with a new session while it runs
                  {loggedIn ? <>, and gives the devices back to <b>{loggedIn}</b> when you press Stop</> : ''}. Any real headband/ring data go to {target} meanwhile.</>
                  : <>Logged in: <b>{loggedIn}</b>{loggedSession ? ` · ${loggedSession.replace('session_', '')}` : ''}. The simulated data go to this user; the login isn&apos;t changed.</>}
            </Check>
            <Check ok={!realOn} warn={realOn} title="3. Switch the real headband and ring off">
              {realOn ? `Still sending: ${[hbOn && 'headband', ringOn && 'ring'].filter(Boolean).join(' and ')}. Both use the same channels, so real and simulated data would mix.`
                : 'No real device data in the last minute.'}
            </Check>
            <Check ok={Boolean(ringBase)} warn={ringBase === null && Boolean(target)} title="Ring (HRV/GSR) baseline for this user">
              {!target ? 'Shown once a user is chosen.' : ringBase ? `Has one (${new Date(ringBase).toLocaleString()}): body readings and fusion will work.`
                : <>None yet, so the ring service skips every body reading and fusion uses the mind only. Keep &quot;recalibrate this user first&quot;
                  ticked (needs the ring API on Render redeployed), or calibrate the ring in StressApp while the stimulator runs in a calm period.</>}
            </Check>
            <Check ok={false} title="4. Choose a profile and press Start">
              <div className="recal-bar" style={{ marginTop: 6 }}>
                <label className="muted">Profile{' '}
                  <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                    {Object.entries(STIM_PROFILES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <label className="muted">Scenario{' '}
                  <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                    {Object.entries(SCENARIOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <label className="muted"><input type="checkbox" checked={recalibrate} onChange={(e) => setRecalibrate(e.target.checked)} /> recalibrate this user first</label>
                <button type="button" className="btn" onClick={() => send('start')} disabled={busy || !canStart}
                  title={canStart ? undefined : 'Complete steps 1 and 2 first (a test account: sim_… or mp_…; letters, digits, _ . -)'}>{busy ? 'Sending…' : 'Start'}</button>
              </div>
              {recalibrate ? 'Their baseline and high-load thresholds are recalibrated with the simulated data (about 17 min), then the live scenario starts.'
                : 'Their current thresholds are kept; the live scenario starts at once.'}
            </Check>
          </ol>
        </>
      )}

      {st?.last_message && !['started', 'stopped'].includes(st.last_message) && <p className="caption warn-text">▲ {st.last_message}</p>}
      {stim.running && st?.warnings && Object.values(st.warnings).map((w) => <p key={w} className="caption warn-text">▲ {w}</p>)}
      {stim.running && loggedIn && ringBase === null && (ringReq?.status === 'capturing' && ['settle', 'rest'].includes(ringReq.phase)
        // the stimulator is calibrating the ring now: the baseline is saved when its rest windows finish
        ? <p className="caption">Body (HRV/GSR): the ring baseline for {loggedIn} is being calibrated ({ringReq.phase}
          {ringReq.phase === 'rest' && ringReq.blocks_needed ? ` ${ringReq.blocks_captured ?? 0}/${ringReq.blocks_needed} windows` : ''}); body readings start once it is saved.</p>
        : <p className="caption warn-text">▲ Body (HRV/GSR): {loggedIn} has no ring baseline, so the ring service skips every body reading and fusion
          uses the mind only.{ringReqStuck ? ' The ring recalibration request hasn\'t been picked up: the ring API on Render needs the latest code.' : ''}</p>
      )}
      {error && <p className="caption warn-text">▲ Couldn&apos;t send: {error}</p>}

      {stim.running && (
        <div className="stim-live">
          <div className="between">
            <p>Simulating for <b>{st.uid}</b> · {st.sid} · {SCENARIOS[st.scenario] || st.scenario} · running {mmss(now / 1000 - (st.started_at || now / 1000))}</p>
            <button type="button" className="btn" onClick={() => send('stop')} disabled={busy}>Stop (back to the real devices)</button>
          </div>
          <ol className="stim-steps">
            {steps.map(([k, label, dur]) => {
              const i = STEPS.findIndex(([x]) => x === k);
              const cls = [k === phase && 'cur', (k === 'task' || k === 'demand') && 'hi', st.calibrating && i < at && 'done'].filter(Boolean).join(' ');
              return (
                <li key={k} className={cls}>
                  <b>{label}</b><span>{k === phase ? `now · ${mmss(now / 1000 - (st.stage_since || now / 1000))}` : dur}</span>
                </li>
              );
            })}
          </ol>
          {stim.demandOn && (
            <div className="stim-task"><strong>{st.calibrating ? 'HIGH-LOAD TASK IN PROGRESS' : 'HIGH-LOAD PERIOD IN PROGRESS'}</strong>
              <span>Simulated demand ON. Watch mind, body and fused rise above 0.50 below.</span></div>
          )}
          <div className="stim-vals">
            <div><span>Demand</span><b>{stim.demandOn ? 'ON' : 'off'}</b></div>
            <div><span>Brain response</span><b>{Math.round((st.eeg_load ?? 0) * 100)}%</b></div>
            <div><span>Heart response</span><b>{Math.round((st.hr_load ?? 0) * 100)}%</b></div>
            <div><span>Skin response</span><b>{Math.round((st.eda_load ?? 0) * 100)}%</b></div>
            {st.hr_bpm != null && <div><span>Heart rate</span><b>{Math.round(st.hr_bpm)} bpm</b></div>}
            {st.scl_us != null && <div><span>Skin conductance</span><b>{st.scl_us.toFixed(2)} µS</b></div>}
            <div><span>Data sent</span><b>{Math.round((st.eeg_samples || 0) / 250)} s EEG · {st.ring_packets || 0} ring</b></div>
          </div>
          {tl.length > 1 && (
            <>
              <h3>Simulated person over time</h3>
              <MultiLineChart points={tl} height={170} yDomain={[0, 1]} xFormat={clock} yFormat={(v) => `${Math.round(v * 100)}%`}
                bands={stim.bands} ariaLabel="Simulated demand and body responses"
                series={[{ key: 'd', label: 'Mental demand', color: 'var(--c4)', width: 2.5, dash: true },
                  { key: 'bd', label: 'Physical arousal', color: 'var(--c5)', width: 2.5, dash: true },
                  { key: 'b', label: 'Brain', color: 'var(--c1)', width: 2 },
                  { key: 'h', label: 'Heart', color: 'var(--c2)', width: 2 },
                  { key: 's', label: 'Skin', color: 'var(--c3)', width: 2 }]} />
            </>
          )}
          <p className="caption">These are the simulated person&apos;s inputs. The model outputs they produce are in the cards and graphs below
            and on the Live monitor, computed by the real system exactly as for the devices.
            Signals: real SAM40 EEG + measured headband and ring characteristics (SIMULATED).</p>
        </div>
      )}
    </Card>
  );
}
