import { useEffect, useState } from 'react';
import { api, eegApi } from '../lib/api';
import { COLORS } from '../lib/levels';
import BlockChart, { runningAverage } from './BlockChart';

// Live graphs while calibrating and during the personal-limit test.
//   phase 'baseline' -> /calibrate/status           (ring: 60 s windows, EEG: 25 s blocks)
//   phase 'task'     -> /calibrate/threshold/status (same blocks, now under load)
// Ring windows give heart variability (SD1) and skin conductance; the EEG
// gives a per-block score. Each graph shows every block and its running
// average, so you can watch the baseline and the limit take shape.
const POLL_MS = 2000;
const ACTIVE = ['settling', 'capturing', 'saving'];

function useStatus(client, path, enabled) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await client.get(path);
        if (!cancelled) setState(res.data);
      } catch { /* the next poll retries */ }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [client, path, enabled]);
  return state;
}

export default function LiveCalibrationGraphs({ phase, ringOnline, eegOnline }) {
  const path = phase === 'task' ? '/calibrate/threshold/status' : '/calibrate/status';
  const ring = useStatus(api, path, ringOnline);
  const eeg = useStatus(eegApi, path, eegOnline);

  const ringBlocks = ring?.blocks || [];
  const ringValid = (key) => ringBlocks.map((b) => (b && b.valid && b[key] != null ? b[key] : null));
  const eegScores = (eeg?.scores || []).map((v) => (v == null ? null : v * 100));
  const eegRest = (phase === 'task' ? (eeg?.resting_scores || []) : []).map((v) => v * 100);

  return (
    <div className="live-graphs" style={{ marginTop: 16 }}>
      <BlockChart title="Heart variability" unit=" ms" values={ringValid('hrv')} color={COLORS.hrv} fmt={(v) => v.toFixed(1)} />
      <BlockChart title="Skin response" unit=" µS" values={ringValid('gsr')} color={COLORS.gsr} fmt={(v) => v.toFixed(2)} />
      <BlockChart
        title="Brain activity"
        unit="%"
        values={eegScores}
        rest={eegRest}
        color={COLORS.eeg}
        fmt={(v) => v.toFixed(0)}
        refValue={eegRest.length ? runningAverage(eegRest).slice(-1)[0] : undefined}
        refLabel="Rest"
      />
    </div>
  );
}
