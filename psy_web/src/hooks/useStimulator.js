import { useMemo } from 'react';
import { useFirebaseValue } from './useData';

// Live stimulator state (backend/simulation/live_stimulator.py writes only
// under stimulator/): its status, and the demand timeline of one session so
// charts can shade when the simulated person was under load. The data
// themselves reach the dashboards through the real pipeline, like a device's.
const ONLINE_SEC = 20;

export function useStimulator(now, sessionId) {
  const status = useFirebaseValue('stimulator/status');
  const timelineRaw = useFirebaseValue(sessionId ? `stimulator/timeline/${sessionId}` : null);
  return useMemo(() => {
    const online = Boolean(status?.online && status?.ts && now / 1000 - status.ts < ONLINE_SEC);
    const running = online && Boolean(status?.running);
    const timeline = timelineRaw && typeof timelineRaw === 'object'
      ? Object.entries(timelineRaw).map(([t, v]) => ({ t: Number(t) * 1000, ...v })).sort((a, b) => a.t - b.t)
      : [];
    return {
      status: status || null, online, running,
      forSession: running && (!sessionId || status.sid === sessionId),
      demandOn: running && (status.demand >= 0.5 || status.body_demand >= 0.5),
      timeline,
      bands: demandBands(timeline, running ? now : null),
    };
  }, [status, timelineRaw, now, sessionId]);
}

// Periods with simulated mental demand or physical arousal on -> chart bands
// (x in ms), labelled by kind. An open period runs to `openEnd` (now, while running).
const bandKind = (p) => {
  const m = p.demand >= 0.5; const b = (p.body_demand ?? p.demand) >= 0.5;
  if (!m && !b) return null;
  if (p.calibration) return 'Simulated task';
  if (p.body_demand == null) return 'Simulated demand';
  return m && b ? 'Simulated stress' : m ? 'Simulated mental load' : 'Simulated physical arousal';
};
export function demandBands(timeline, openEnd) {
  const out = [];
  let start = null; let label = null;
  for (const p of timeline) {
    const k = bandKind(p);
    if (k !== label && start != null) { out.push({ x0: start, x1: p.t, label, kind: 'stim' }); start = null; }
    if (k && start == null) { start = p.t; }
    label = k;
  }
  if (start != null) {
    const end = openEnd ?? timeline[timeline.length - 1].t;
    out.push({ x0: start, x1: end, label, kind: 'stim' });
  }
  return out;
}

export const STIM_PROFILES = {
  responsive: 'Responsive (demo): EEG calibration passes, WESAD-sized body response',
  typical: 'Typical: realistic EEG and ring responses',
  eeg_strong_ring_weak: 'EEG strong, ring weak',
  eeg_weak_ring_strong: 'EEG weak, ring strong',
  ring_missing: 'Ring missing (mind only)',
  inverted: 'Inverted EEG: score falls under demand',
  noisy: 'Real-world noise: artifacts and dropouts',
  drowsy: 'Drowsy during rest',
  drift: 'Drifting electrode contact',
};

export const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
