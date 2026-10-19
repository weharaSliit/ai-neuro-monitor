import { useState } from 'react';
import { Card, PipelineStrip, RawPanel, SourcesBar, Status } from './panels';
import TechNav from './TechNav';
import RingRawPanel from './RingRawPanel';
import ValidationPanel from './ValidationPanel';
import FeatureGraphs from './FeatureGraphs';
import useRingStream from '../hooks/useRingStream';
import { usePhysioData } from '../hooks/usePhysio';
import { reasonShort } from '../lib/simDemo';
import useMonitorSeries from '../hooks/useMonitorSeries';
import { C, StateCard, StressChart } from './LiveMonitor';

// Devices (#tech): evidence that both wearables stream, that the signal is usable,
// and what the system decides from it (the Live monitor's cards and stress graph).
// Real devices and the live stimulator alike.
const clockS = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function QualityCard({ blocks, windows, part }) {
  const lastB = blocks.slice(-12);
  const lastW = windows.slice(-8);
  const nRej = blocks.filter((b) => b.skipped).length;
  return (
    <Card title="Signal quality">
      {part !== 'ring' && <>
      <h3>EEG blocks (last {lastB.length})</h3>
      {!lastB.length ? <p className="muted">No EEG blocks yet.</p> : (
        <p className="sd-blocks q-row">{lastB.map((b) => (
          <i key={b.window ?? b.timestamp_end} className={b.skipped ? 'rej' : 'acc'}
            title={`${b.timestamp_end ? clockS(b.timestamp_end * 1000) : ''} ${b.skipped ? `rejected: ${b.eeg_quality_reason || ''}` : `accepted · quality ${Math.round(b.eeg_quality_score ?? 0)}/100`}`}>
            {b.skipped ? '✕' : '✔'}</i>))}</p>
      )}
      <p className="caption">{nRej} of {blocks.length} rejected
        {lastB.some((b) => b.skipped) ? ` · ${reasonShort(lastB.filter((b) => b.skipped).pop().eeg_quality_reason)}` : ''}
        {lastB.length ? ` · RMS ${Number(lastB[lastB.length - 1].eeg_std_uv_unclamped ?? NaN).toFixed(1)} µV` : ''}</p>
      </>}
      {part !== 'eeg' && <>
      <h3>Ring windows (last {lastW.length})</h3>
      {!lastW.length ? <p className="muted">No ring windows yet.</p> : (
        <table className="phase-table">
          <thead><tr><th>Time</th><th>Quality</th><th>HR</th><th>SCL</th></tr></thead>
          <tbody>{lastW.map((w) => (
            <tr key={w.t}>
              <td>{w.t ? clockS(w.t) : '—'}</td>
              <td>{(() => { const q = w.quality?.signal_quality ?? w.signal_quality; return q == null ? '—'
                : <Status kind={q >= 0.6 ? 'good' : 'warning'}>{`${Math.round(q * 100)}%`}</Status>; })()}</td>
              <td>{w.features?.MeanHR != null ? `${Math.round(w.features.MeanHR)} bpm` : '—'}</td>
              <td>{w.features?.SCL_mean != null ? `${w.features.SCL_mean.toFixed(2)} µS` : '—'}</td>
            </tr>))}</tbody>
        </table>
      )}
      </>}
    </Card>
  );
}

// What the system decides from these devices: the early-warning card per component
// and the stress score (last 30 min), same as the Live monitor.
function DecisionEvidence({ uid, sid, now }) {
  const mon = useMonitorSeries(uid, sid, now);
  const { series, gate, fusedCal, params } = mon;
  const ts = [...series.mind, ...series.body, ...series.fused].map((r) => r.t);
  const end = ts.length ? Math.max(...ts) : null;
  const xDomain = ts.length > 1 ? [Math.max(Math.min(...ts), end - 30 * 60000), end] : null;
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <div className="cd-cards">
        <StateCard title="MIND · EEG" color={C.mind} row={mon.now.mind} rows={series.mind} />
        <StateCard title="BODY · HRV + GSR" color={C.body} row={mon.now.body} rows={series.body} />
        <StateCard title="FUSED · mind + body" color={C.fused} row={mon.now.fused} rows={series.fused} />
      </div>
      <Card title="Stress score" subtitle="last 30 min · 0.50 = own limit">
        <StressChart series={series} gate={gate} fusedCal={fusedCal} params={params} xDomain={xDomain} xFormat={clock} height={240} />
      </Card>
    </>
  );
}

export default function TechView({ raw, health, picker, sessionData, limits, now, go }) {
  const ring = useRingStream();
  const physio = usePhysioData(picker.userId, picker.sessionId);
  const [tab, setTab] = useState('eeg');
  return (
    <div className="page">
      <TechNav page="tech" go={go} picker={picker} title="Devices" />
      <SourcesBar raw={raw} health={health} picker={picker} sessionData={sessionData} now={now} />
      <DecisionEvidence uid={picker.userId} sid={picker.sessionId} now={now} />
      <div className="dev-tabs" role="tablist">
        {[['eeg', 'Headband'], ['ring', 'Ring']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'eeg' ? (
        <div className="grid-2">
          <RawPanel raw={raw} now={now} />
          <QualityCard part="eeg" blocks={sessionData.blocks} windows={physio.windows} />
        </div>
      ) : (
        <>
          <RingRawPanel ring={ring} now={now} />
          <QualityCard part="ring" blocks={sessionData.blocks} windows={physio.windows} />
        </>
      )}
      <FeatureGraphs blocks={sessionData.blocks} windows={physio.windows} ringBaseline={physio.baseline} />
      <details className="dev-adv">
        <summary>Advanced</summary>
        <PipelineStrip raw={raw} health={health} sessionData={sessionData} picker={picker} now={now} limits={limits} />
        <ValidationPanel raw={raw} sessionData={sessionData} now={now} />
      </details>
    </div>
  );
}
