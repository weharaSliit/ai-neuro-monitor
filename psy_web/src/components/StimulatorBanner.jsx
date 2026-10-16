import { useFirebaseValue } from '../hooks/useData';
import { STIM_PROFILES, mmss, useStimulator } from '../hooks/useStimulator';

// Shown at the top of every technical page while the live stimulator runs:
// the data on the page then come from the simulated person (through the real
// pipeline), not the real devices. When the simulated demand is ON -- the
// calibration's high-load task or a live demand period -- it says so in large.
const PHASE_TEXT = {
  settle: 'Calibration 1/4 · settling (not recorded)',
  rest: 'Calibration 2/4 · resting baseline',
  task: 'Calibration 3/4 · HIGH-LOAD TASK',
  recovery: 'Calibration 4/4 · recovery rest',
  calm: 'Live · calm',
  demand: 'Live · DEMAND PERIOD',
};
const LIVE_SEC = { calm: null, demand: 240 };   // live_stimulator.py LIVE_SCENARIO demand length

export default function StimulatorBanner({ now, openControls }) {
  const stim = useStimulator(now);
  const st = stim.status;
  const recal = useFirebaseValue(stim.running && st?.sid ? `eeg_recalibration/${st.sid}` : null);
  const ringBase = useFirebaseValue(stim.running && st?.uid ? `physiological/baselines/${st.uid}/updated_at` : null);
  if (!stim.running) return null;
  const inStage = st.stage_since ? now / 1000 - st.stage_since : 0;
  const phase = st.phase || (st.stage || '').replace('live: ', '');
  const task = stim.demandOn;
  const blocks = recal?.phase === phase && recal?.blocks_needed ? ` · block ${recal.blocks_captured ?? 0} of ${recal.blocks_needed}` : '';
  const left = !st.calibrating && LIVE_SEC[phase] ? ` · ${mmss(LIVE_SEC[phase] - inStage)} left` : '';
  return (
    <div className={`stim-banner${task ? ' is-task' : ''}`} role="status" aria-live="polite">
      <div className="stim-banner-row">
        <span className="stim-badge">SIMULATED DATA</span>
        <span>Virtual person streaming for <b>{st.uid}</b> · {STIM_PROFILES[st.profile] || st.profile}</span>
        <span className="stim-banner-phase">{PHASE_TEXT[phase] || phase}{blocks}</span>
        {openControls && <button type="button" className="link" onClick={openControls}>Stimulator controls</button>}
      </div>
      {task && (
        <div className="stim-task">
          <strong>{st.calibrating ? 'HIGH-LOAD TASK IN PROGRESS' : 'HIGH-LOAD PERIOD IN PROGRESS'}</strong>
          <span>Simulated cognitive demand is ON for {mmss(inStage)}{left}. Mind, body and fused scores should rise above their limits
            (brain responds in ~20 s, heart ~30 s, skin over a few minutes).</span>
        </div>
      )}
      {ringBase === null && (
        <div className="stim-banner-row stim-banner-warn">▲ Body (HRV/GSR) readings are skipped: {st.uid} has no ring baseline yet, so fusion uses the mind only.
          {openControls && <button type="button" className="link" onClick={openControls}>Why?</button>}</div>
      )}
      <div className="stim-banner-vals">
        <span>Demand <b>{task ? 'ON' : 'off'}</b></span>
        <span>Brain response <b>{Math.round((st.eeg_load ?? 0) * 100)}%</b></span>
        <span>Heart response <b>{Math.round((st.hr_load ?? 0) * 100)}%</b></span>
        <span>Skin response <b>{Math.round((st.eda_load ?? 0) * 100)}%</b></span>
        {st.hr_bpm != null && <span>Heart rate <b>{Math.round(st.hr_bpm)} bpm</b></span>}
        {st.scl_us != null && <span>Skin conductance <b>{st.scl_us.toFixed(2)} µS</b></span>}
        <span>Running <b>{mmss(now / 1000 - (st.started_at || now / 1000))}</b></span>
      </div>
    </div>
  );
}
