import { useEffect, useState } from 'react';
import { ref, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { useFirebaseValue } from '../hooks/useLive';
import { Card, CardHead, Badge } from './ui';
import { COLORS } from '../lib/levels';

// Live stimulator (backend/simulation/live_stimulator.py, run on a laptop):
// simulated headband + ring data for the user who is logged in with the
// devices, through the real pipeline -- same controls as psy_web. It never
// changes the user. While it runs, everything on this site is SIMULATED.
const PROFILES = {
  typical: 'Typical', eeg_strong_ring_weak: 'EEG strong, ring weak', eeg_weak_ring_strong: 'EEG weak, ring strong',
  ring_missing: 'Ring missing', inverted: 'Inverted EEG', noisy: 'Real-world noise', drowsy: 'Drowsy rest', drift: 'Electrode drift',
};
const PHASE = { settle: 'Calibration · settle', rest: 'Calibration · rest', task: 'Calibration · HIGH-LOAD TASK', recovery: 'Calibration · recovery',
  calm: 'Calm', ramp: 'Load rising', demand: 'HIGH LOAD', plateau: 'Moderate load' };
const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s)) % 60).padStart(2, '0')}`;

export function useStimulatorStatus() {
  const st = useFirebaseValue('stimulator/status');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(id); }, []);
  const online = Boolean(st?.online && st?.ts && now / 1000 - st.ts < 20);
  return { st, online, running: online && Boolean(st?.running), now };
}

export function StimulatorBanner() {
  const { st, running } = useStimulatorStatus();
  if (!running) return null;
  const phase = st.phase || (st.stage || '').replace('live: ', '');
  const hi = st.demand >= 0.5;
  return (
    <div className={`banner ${hi ? 'stress' : 'warning'}`} style={{ marginBottom: 20 }}>
      <b>SIMULATED DATA</b>&nbsp;· live stimulator for {st.uid} · {PROFILES[st.profile] || st.profile} ·&nbsp;
      <b>{PHASE[phase] || phase}</b>{st.phase_left != null ? ` · ${mmss(st.phase_left)} left` : ''}
      {hi && <>&nbsp;· <b>high-load task in progress</b></>}
    </div>
  );
}

export default function StimulatorCard({ loggedIn }) {
  const { st, online, running } = useStimulatorStatus();
  const [profile, setProfile] = useState('typical');
  const [recalibrate, setRecalibrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const send = async (command) => {
    setBusy(true);
    try {
      await set(ref(db, 'stimulator/control'), { command, nonce: Date.now(), profile, recalibrate, scenario: 'ramp', kind: null });
    } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHead title="Live stimulator" sub="Simulated headband and ring data through the real system (for demonstration)"
        right={<Badge color={!online ? COLORS.textMuted : running ? COLORS.normal : COLORS.warning} dot>
          {!online ? 'program not running' : running ? 'running' : 'ready'}</Badge>} />
      {!online ? (
        <p className="caption">Run <code>venv/bin/python backend/simulation/live_stimulator.py</code> on the laptop, then start it here.</p>
      ) : running ? (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="caption">For <b>{st.uid}</b> · {PROFILES[st.profile] || st.profile} · {PHASE[st.phase] || st.stage}</span>
          <button className="btn ghost sm" disabled={busy} onClick={() => send('stop')}>Stop (back to the real devices)</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Profile">
            {Object.entries(PROFILES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label className="caption"><input type="checkbox" checked={recalibrate} onChange={(e) => setRecalibrate(e.target.checked)} /> recalibrate first</label>
          <button className="btn sm" disabled={busy || !loggedIn} onClick={() => send('start')}>Start</button>
          {!loggedIn && <span className="caption">Log in with the devices on StressApp first.</span>}
        </div>
      )}
    </Card>
  );
}
