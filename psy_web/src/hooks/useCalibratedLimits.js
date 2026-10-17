import { useMemo } from 'react';
import { useFirebaseValue } from './useData';
import useEegCalibrations from './useEegCalibrations';
import { calibratedLimits } from '../lib/limits';

// The calibrated baseline and high-load threshold for mind, body and fused
// (lib/limits calibratedLimits), for pages that don't load the whole session.
// Subscribes only to the small calibration records, never to blocks or windows.
export default function useCalibratedLimits(uid, sid) {
  const base = uid && sid ? `psychological/${uid}/${sid}` : null;
  const calibration = useFirebaseValue(base ? `${base}/calibration_result` : null);
  const threshold = useFirebaseValue(base ? `${base}/threshold_result` : null);
  const thresholds = useFirebaseValue(uid ? `physiological/personal_thresholds/${uid}` : null);
  const baseline = useFirebaseValue(uid ? `physiological/baselines/${uid}` : null);
  const history = useEegCalibrations(uid, `${sid}|${calibration?.updated_at ?? ''}|${threshold?.updated_at ?? ''}`);
  return useMemo(() => calibratedLimits({
    eeg: { calibration: calibration || null, threshold: threshold || null }, history, sid,
    ring: { thresholds: thresholds || null, baseline: baseline || null },
  }), [calibration, threshold, thresholds, baseline, history, sid]);
}
