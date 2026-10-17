import { useMemo } from 'react';
import { useFirebaseValue } from './useLive';
import { blockAligned, calibrationPhases, eegLimitInfo, num, persistent, pickEeg, ringAligned, ringLimitInfo, sig } from '../lib/limits';
import { decisionGate, fusedQuadrant } from '../lib/condition';

// The user's condition right now: mind (EEG) and body (HRV/GSR), each judged
// against its OWN calibrated baseline and limit (the same records and rules
// psy_web uses), combined into Relaxed / High mental load / Physical arousal /
// Stress. No decision until the latest calibration is done.
export default function useCondition(userId, sessionId, eegBlocks, ringWindows) {
  const base = userId && sessionId ? `psychological/${userId}/${sessionId}` : null;
  const calibration = useFirebaseValue(base ? `${base}/calibration_result` : null);
  const threshold = useFirebaseValue(base ? `${base}/threshold_result` : null);
  const ringThresholds = useFirebaseValue(userId ? `physiological/personal_thresholds/${userId}` : null);
  const ringBaseline = useFirebaseValue(userId ? `physiological/baselines/${userId}` : null);
  const eegRecal = useFirebaseValue(sessionId ? `eeg_recalibration/${sessionId}` : null);
  const ringRecal = useFirebaseValue(userId ? `ring_recalibration/${userId}` : null);

  return useMemo(() => {
    const { cal, thr } = pickEeg({ calibration, threshold }, { items: [] }, sessionId);
    const eegInfo = eegLimitInfo(cal, thr);
    const ring = { thresholds: ringThresholds || null, baseline: ringBaseline || null };
    const ringInfo = ringLimitInfo(ring);
    const phases = calibrationPhases(cal, thr, eegInfo, ring, ringInfo);
    const ringPresent = Boolean(ringBaseline) || (ringWindows || []).length > 0;
    const gate = decisionGate({
      cal, thr, ringThresholds, ringPresent,
      recalActive: ['requested', 'capturing', 'saving'].includes(eegRecal?.status) || ['capturing', 'saving'].includes(ringRecal?.status),
    });
    const after = (t) => !gate.paused && (!gate.startMs || t >= gate.startMs);

    // Mind: each block on the 0-1 scale (own limit = 0.50), after calibration only.
    const mindRows = (eegBlocks || []).filter((b) => b.timestamp_end && after(b.timestamp_end * 1000))
      .map((b) => ({ t: b.timestamp_end * 1000, v: b.skipped ? null : blockAligned(b, eegInfo) }));
    const bodyRows = (ringWindows || []).filter((w) => w.prob_stress != null && after(new Date(w.timestamp).getTime()))
      .map((w) => ({ t: new Date(w.timestamp).getTime(), v: ringAligned(w.prob_stress, ringInfo.limit) }));
    const lastV = (rows) => [...rows].reverse().find((r) => r.v != null)?.v ?? null;
    const mindHigh = eegInfo && mindRows.length ? persistent(mindRows.map((r) => (r.v == null ? null : r.v >= 0.5))) : null;
    const bodyHigh = ringBaseline && bodyRows.length ? persistent(bodyRows.map((r) => r.v >= 0.5)) : null;
    const condition = gate.paused ? null : fusedQuadrant(mindHigh, bodyHigh);

    const mindBaseFused = eegInfo ? sig(Math.max(-3, Math.min(3, (eegInfo.level - eegInfo.limitL) / eegInfo.sd))) : null;
    return {
      gate, condition, eegInfo, ringInfo, phases,
      mind: { value: lastV(mindRows), high: mindHigh, rows: mindRows,
        baseline: eegInfo ? sig(eegInfo.level) : null, limit: eegInfo ? sig(eegInfo.rawLimitL) : null, baselineFused: mindBaseFused,
        personal: Boolean(eegInfo?.responsive), method: eegInfo?.method || null },
      body: { value: lastV(bodyRows), high: bodyHigh, rows: bodyRows,
        baseline: ringInfo.base, limit: ringInfo.limit, baselineFused: ringInfo.base == null ? null : ringAligned(ringInfo.base, ringInfo.limit),
        personal: Boolean(ringInfo.personal), hasBaseline: Boolean(ringBaseline) },
      recal: { eeg: eegRecal || null, ring: ringRecal || null },
      num,
    };
  }, [calibration, threshold, ringThresholds, ringBaseline, eegRecal, ringRecal, sessionId, eegBlocks, ringWindows]);
}
