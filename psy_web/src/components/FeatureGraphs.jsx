import { useMemo, useState } from 'react';
import { MultiLineChart } from './charts';
import { Card } from './panels';
import { fmt } from '../lib/model';

// Extracted features over the session: the 29 bipolar EEG features of every
// 25 s block (what the EEG model scores) and the HRV/GSR features of every
// ring window (against the user's ring baseline). Pick a feature per chart.
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function FeatureGraph({ title, rows, color, baseline, xDomain }) {
  const keys = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.f || {})))].sort(), [rows]);
  const [pick, setPick] = useState(null);
  const k = keys.includes(pick) ? pick : keys[0];
  const b = baseline?.[k]?.mean;
  return (
    <div>
      <div className="chart-head">
        <h3 className="section-title">{title}</h3>
        <select value={k || ''} onChange={(e) => setPick(e.target.value)} aria-label={`${title} feature`}>
          {keys.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      {!keys.length ? <div className="chart-empty" style={{ height: 190 }}>No features yet.</div> : (
        <MultiLineChart points={rows.map((r) => ({ x: r.t, v: r.f?.[k] ?? null }))} height={190} xDomain={xDomain} xFormat={clock}
          yFormat={(v) => fmt(v, 3)} legend={false} ariaLabel={`${k} over time`}
          refLines={b != null ? [{ y: b, label: 'baseline' }] : []} series={[{ key: 'v', label: k, color, dots: true }]} />
      )}
    </div>
  );
}

export default function FeatureGraphs({ blocks, windows, ringBaseline }) {
  const eegRows = blocks.filter((b) => b.timestamp_end && b.features_eeg?.bipolar && !b.skipped)
    .map((b) => ({ t: b.timestamp_end * 1000, f: b.features_eeg.bipolar }));
  const ringRows = windows.filter((w) => w.t && w.features).map((w) => ({ t: w.t, f: w.features }));
  const ts = [...eegRows, ...ringRows].map((r) => r.t);
  const xDomain = ts.length > 1 ? [Math.min(...ts), Math.max(...ts)] : null;
  return (
    <Card title="Extracted features" subtitle="EEG per 25 s block · HRV/GSR per window">
      <div className="grid-2">
        <FeatureGraph title="EEG (T7–T8 bipolar)" color="var(--c1)" xDomain={xDomain} rows={eegRows} />
        <FeatureGraph title="HRV / GSR" color="var(--c2)" xDomain={xDomain} baseline={ringBaseline} rows={ringRows} />
      </div>
    </Card>
  );
}
