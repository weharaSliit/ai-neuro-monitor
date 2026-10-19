import { useMemo } from 'react';
import { useFirebaseValue, useSessionData } from './useData';
import { usePhysioData } from './usePhysio';
import { useFusionData } from './useFusion';
import useEegCalibrations from './useEegCalibrations';
import { useStimulator } from './useStimulator';
import { calibratedLimits } from '../lib/limits';
import { EW_SETS, buildSeries, decisionGate, gateSeries, periodsFrom } from '../lib/simDemo';

// Mind, body and fused for one user + session, each against the user's own
// calibrated limit, with the early-warning state of every reading -- shared by
// the Live monitor and the Devices page so both show the same decisions.
// Only the newest ring windows are subscribed to (a window every ~20 s: 180 = the
// last hour), and the derived series refresh every few seconds.
const RING_LAST = { last: 180 };
export const REFRESH_MS = 5000;

export default function useMonitorSeries(uid, sid, now) {
  const stim = useStimulator(now, sid);
  const st = stim.status;
  const eeg = useSessionData(uid, sid);
  const ring = usePhysioData(uid, sid, RING_LAST);
  const fusion = useFusionData(uid, sid);
  const history = useEegCalibrations(uid, `${sid}|${eeg.calibration?.updated_at ?? ''}|${eeg.threshold?.updated_at ?? ''}`);
  const recalReq = useFirebaseValue(sid ? `eeg_recalibration/${sid}` : null);
  const ringReq = useFirebaseValue(uid ? `ring_recalibration/${uid}` : null);
  const ringBase = useFirebaseValue(uid ? `physiological/baselines/${uid}/updated_at` : null);

  const limits = calibratedLimits({ eeg, history, sid, ring });
  const { cal, thr, eegInfo, ringInfo, fusedCal, bodyCal } = limits;
  const ringPresent = ring.windows.length > 0 || Boolean(ringBase);
  const gate0 = decisionGate({ cal, thr, ringThresholds: ring.thresholds, ringPresent, eegRecal: recalReq, ringRecal: ringReq, nowMs: now });
  // Simulated session: the stimulator runs it, or did (it has a ground-truth timeline).
  const simHere = stim.running && st?.sid === sid;
  const simulated = simHere || stim.timeline.length > 0;
  const params = EW_SETS.design.params;
  const periods = useMemo(() => periodsFrom(stim.timeline, simHere ? now : null), [stim.timeline, simHere, Math.floor(now / REFRESH_MS)]);
  // readings taken during the stimulator's own calibration phases are calibration data too
  const calWin = periods.filter((p) => p.calibration).map((p) => [p.start, p.end]);
  const gate = useMemo(() => ({ ...gate0, blank: [...gate0.blank, ...calWin] }), [JSON.stringify(gate0), JSON.stringify(calWin)]);

  const series = useMemo(() => gateSeries(buildSeries({
    blocks: eeg.blocks, eegInfo, ringWindows: ring.windows, ringInfo, fusionWindows: fusion.windows,
    fusedCal, bodyCal, ringBaseAt: ringBase ? Date.parse(ringBase) : null, params, nowMs: now, equalWeights: simulated,
  }), gate), [eeg.blocks, ring.windows, fusion.windows, eegInfo?.limitL, eegInfo?.status, ringInfo.limit, fusedCal?.baseline, bodyCal?.baseline,
    ringBase, gate.startMs, gate.paused, JSON.stringify(gate.blank), simulated, Math.floor(now / REFRESH_MS)]);

  const last = (rows) => [...rows].reverse().find((r) => r.value != null) || null;
  return {
    stim, st, eeg, ring, recalReq, ringBase, limits, fusedCal, params, gate, series, simulated, simHere,
    now: { mind: last(series.mind), body: last(series.body), fused: last(series.fused) },
  };
}
