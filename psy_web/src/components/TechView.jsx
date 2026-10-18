import { useState } from 'react';
import { Card, PipelineStrip, RawPanel, SourcesBar, Status } from './panels';
import TechNav from './TechNav';
import RingRawPanel from './RingRawPanel';
import ValidationPanel from './ValidationPanel';
import FeatureGraphs from './FeatureGraphs';
import useRingStream from '../hooks/useRingStream';
import { usePhysioData } from '../hooks/usePhysio';
import { reasonShort } from '../lib/simDemo';

// Devices (#tech): are both wearables streaming and is the signal usable? The
// same for the real headband / ring and the live stimulator (it publishes on
// the same MQTT topics). Decisions are on the Live monitor.
const clockS = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function QualityCard({ blocks, windows, part }) {
  const lastB = blocks.slice(-12);
  const lastW = windows.slice(-8);
  const nRej = blocks.filter((b) => b.skipped).length;
  return (
    <Card title="Signal quality">
      {part !== 'ring' && <>
      <h3>EEG blocks (last {lastB.length}, 25 s each)</h3>
      {!lastB.length ? <p className="muted">No EEG blocks in this session yet.</p> : (
        <p className="sd-blocks q-row">{lastB.map((b) => (
          <i key={b.window ?? b.timestamp_end} className={b.skipped ? 'rej' : 'acc'}
            title={`${b.timestamp_end ? clockS(b.timestamp_end * 1000) : ''} ${b.skipped ? `rejected: ${b.eeg_quality_reason || ''}` : `accepted · quality ${Math.round(b.eeg_quality_score ?? 0)}/100`}`}>
            {b.skipped ? '✕' : '✔'}</i>))}</p>
      )}
      <p className="caption">Rejected {nRej} of {blocks.length} blocks in this session
        {lastB.some((b) => b.skipped) ? ` · latest reason: ${reasonShort(lastB.filter((b) => b.skipped).pop().eeg_quality_reason)}` : ''}
        {lastB.length ? ` · RMS ${Number(lastB[lastB.length - 1].eeg_std_uv_unclamped ?? NaN).toFixed(1)} µV` : ''}</p>
      </>}
      {part !== 'eeg' && <>
      <h3>Ring windows (last {lastW.length}, 60 s each)</h3>
      {!lastW.length ? <p className="muted">No ring windows yet (no ring baseline, or the ring is off).</p> : (
        <table className="phase-table">
          <thead><tr><th>Time</th><th>Signal quality</th><th>Heart rate</th><th>Skin conductance</th></tr></thead>
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

export default function TechView({ raw, health, picker, sessionData, limits, now, go }) {
  const ring = useRingStream();
  const physio = usePhysioData(picker.userId, picker.sessionId);
  const [tab, setTab] = useState('eeg');
  return (
    <div className="page">
      <TechNav page="tech" go={go} picker={picker} title="Devices" />
      <SourcesBar raw={raw} health={health} picker={picker} sessionData={sessionData} now={now} />
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
      <details className="dev-adv">
        <summary>Advanced</summary>
        <PipelineStrip raw={raw} health={health} sessionData={sessionData} picker={picker} now={now} limits={limits} />
        <ValidationPanel raw={raw} sessionData={sessionData} now={now} />
        <FeatureGraphs blocks={sessionData.blocks} windows={physio.windows} ringBaseline={physio.baseline} />
      </details>
    </div>
  );
}
