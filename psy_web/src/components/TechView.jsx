import {
  ApiPanel, BlockLog, CalibrationPanel, FeaturesPanel, PipelineStrip, RawPanel, SessionPicker,
  SourcesBar, TaskStatePanel,
} from './panels';
import ValidationPanel from './ValidationPanel';

// The researcher view: raw signal, every feature, model internals.
export default function TechView({ raw, health, picker, sessionData, profile, now, onBack, openFusion, openPhysio, openCalibration, openStimulator }) {
  return (
    <div className="page">
      <header className="top">
        <div>
          <div className="view-links">
            <button type="button" className="back-link" onClick={onBack}>← Back to simple view</button>
            <button type="button" className="back-link" onClick={openPhysio}>Wearable 01 HRV + GSR monitor →</button>
            <button type="button" className="back-link" onClick={openFusion}>Fusion engine monitor →</button>
            <button type="button" className="back-link" onClick={openCalibration}>Calibration, scores &amp; alerts →</button>
            {openStimulator && <button type="button" className="back-link" onClick={openStimulator}>Live stimulator →</button>}
          </div>
          <p className="eyebrow">MindPulse · psychological component · technical view</p>
          <h1>Wearable 02 EEG monitor</h1>
          <p className="muted">
            Live T7–T8 EEG from wearable 02, through calibration, feature extraction and the task-state model.
            Read-only, except the Recalibrate button in the Calibration card.
          </p>
        </div>
        <SessionPicker picker={picker} />
      </header>

      <SourcesBar raw={raw} health={health} picker={picker} sessionData={sessionData} now={now} />
      <PipelineStrip raw={raw} health={health} sessionData={sessionData} picker={picker} now={now} />

      <div className="grid-2">
        <RawPanel raw={raw} now={now} />
        <TaskStatePanel sessionData={sessionData} profile={profile} now={now} />
      </div>
      <ValidationPanel raw={raw} sessionData={sessionData} now={now} />
      <CalibrationPanel sessionData={sessionData} profile={profile} raw={raw} now={now} picker={picker} />
      <p className="caption">
        EEG, HRV/GSR and fused calibration graphs, each component&apos;s scores and labels, rising alerts and feature graphs are on the{' '}
        <button type="button" className="link" onClick={openCalibration}>Calibration, scores &amp; alerts dashboard</button>.
      </p>
      <FeaturesPanel sessionData={sessionData} profile={profile} />
      <BlockLog sessionData={sessionData} />
      <ApiPanel health={health} picker={picker} now={now} />

      <footer className="muted foot">
        task_state_score measures cognitive load, not validated stress (see backend/psychological/app.py).
        To estimate stress, fuse it with the HRV/GSR score (see the{' '}
        <button type="button" className="link" onClick={openFusion}>fusion engine monitor</button>).
      </footer>
    </div>
  );
}
