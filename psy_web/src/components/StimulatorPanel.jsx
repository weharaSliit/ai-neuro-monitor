import { useState } from 'react';
import { Card, Status } from './panels';
import { MultiLineChart } from './charts';
import { useFirebaseValue } from '../hooks/useData';
import { STIM_PROFILES, mmss, useStimulator } from '../hooks/useStimulator';
import { sendStimulatorCommand } from '../lib/firebase';

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
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Check({ ok, warn, title, children }) {
  return (
    <li className={`stim-check ${ok ? 'ok' : warn ? 'warn' : 'todo'}`}>
      <span className="stim-check-mark">{ok ? '✓' : warn ? '!' : '○'}</span>
      <div><b>{title}</b><div className="caption">{children}</div></div>
    </li>
  );
}

export default function StimulatorPanel({ now }) {
  const loggedIn = useFirebaseValue('fusion_en_sessions/current_user_id') || null;
  const loggedSession = useFirebaseValue('fusion_en_sessions/current_session_id') || null;
  const stim = useStimulator(now, loggedSession);
  const st = stim.status;
  const headband = useFirebaseValue('eeg_devices/wearable02');
  const ringDev = useFirebaseValue('physiological/devices/wearable01');
  // The deployed ring bridge only predicts for a user WITH a ring baseline; without
  // one every window is skipped and fusion runs on the mind alone.
  const ringBase = useFirebaseValue(loggedIn ? `physiological/baselines/${loggedIn}/updated_at` : null);
  const ringReq = useFirebaseValue(loggedIn ? `ring_recalibration/${loggedIn}` : null);
  const ringReqStuck = ringReq?.status === 'requested' && ringReq.requested_at && now / 1000 - ringReq.requested_at > 60;
  const [profile, setProfile] = useState('responsive');
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
  const canStart = stim.online && !stim.running && Boolean(loggedIn);

  const send = async (cmd) => {
    setBusy(true); setError(null);
    try { await sendStimulatorCommand(cmd, { profile, recalibrate }); } catch (e) { setError(e?.message || String(e)); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(COMMAND); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  const phase = st?.phase || (st?.stage || '').replace('live: ', '');
  const at = STEPS.findIndex(([k]) => k === phase);
  const steps = st?.calibrating ? STEPS : STEPS.filter(([k]) => k === 'calm' || k === 'demand');
  const tl = stim.timeline.slice(-360).map((p) => ({ x: p.t, d: p.demand, b: p.brain, h: p.heart, s: p.skin }));

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
            <Check ok={Boolean(loggedIn)} title="2. Log in on StressApp with the devices">
              {loggedIn ? <>Logged in: <b>{loggedIn}</b>{loggedSession ? ` · ${loggedSession.replace('session_', '')}` : ''}. The simulated data go to this user; the user isn&apos;t changed.</>
                : 'Nobody is logged in with the devices yet. The stimulator only streams for the logged-in user.'}
            </Check>
            <Check ok={!realOn} warn={realOn} title="3. Switch the real headband and ring off">
              {realOn ? `Still sending: ${[hbOn && 'headband', ringOn && 'ring'].filter(Boolean).join(' and ')}. Both use the same channels, so real and simulated data would mix.`
                : 'No real device data in the last minute.'}
            </Check>
            <Check ok={Boolean(ringBase)} warn={ringBase === null && Boolean(loggedIn)} title="Ring (HRV/GSR) baseline for this user">
              {!loggedIn ? 'Shown once a user is logged in.' : ringBase ? `Has one (${new Date(ringBase).toLocaleString()}): body readings and fusion will work.`
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
                <label className="muted"><input type="checkbox" checked={recalibrate} onChange={(e) => setRecalibrate(e.target.checked)} /> recalibrate this user first</label>
                <button type="button" className="btn" onClick={() => send('start')} disabled={busy || !canStart}
                  title={canStart ? undefined : 'Complete steps 1 and 2 first'}>{busy ? 'Sending…' : 'Start'}</button>
              </div>
              {recalibrate ? 'Their baseline and high-load thresholds are recalibrated with the simulated data (about 17 min), then the live scenario starts.'
                : 'Their current thresholds are kept; the live scenario starts at once.'}
            </Check>
          </ol>
        </>
      )}

      {st?.last_message && !['started', 'stopped'].includes(st.last_message) && <p className="caption warn-text">▲ {st.last_message}</p>}
      {stim.running && st?.warnings && Object.values(st.warnings).map((w) => <p key={w} className="caption warn-text">▲ {w}</p>)}
      {stim.running && loggedIn && ringBase === null && (
        <p className="caption warn-text">▲ Body (HRV/GSR): {loggedIn} has no ring baseline, so the ring service skips every body reading and fusion
          uses the mind only.{ringReqStuck ? ' The ring recalibration request hasn\'t been picked up: the ring API on Render needs the latest code.' : ''}</p>
      )}
      {error && <p className="caption warn-text">▲ Couldn&apos;t send: {error}</p>}

      {stim.running && (
        <div className="stim-live">
          <div className="between">
            <p>Simulating for <b>{st.uid}</b> · {st.sid} · running {mmss(now / 1000 - (st.started_at || now / 1000))}</p>
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
                series={[{ key: 'd', label: 'Demand', color: 'var(--c4)', width: 2.5, dash: true },
                  { key: 'b', label: 'Brain', color: 'var(--c1)', width: 2 },
                  { key: 'h', label: 'Heart', color: 'var(--c2)', width: 2 },
                  { key: 's', label: 'Skin', color: 'var(--c3)', width: 2 }]} />
            </>
          )}
          <p className="caption">These are the simulated person&apos;s inputs. The model outputs they produce are in the cards and graphs below
            and on the EEG, ring and fusion pages, computed by the real system exactly as for the devices.
            Signals: real SAM40 EEG + measured headband and ring characteristics (SIMULATED).</p>
        </div>
      )}
    </Card>
  );
}
