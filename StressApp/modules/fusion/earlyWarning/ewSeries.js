// Early warning per component (mind, body, fused) -- port of buildSeries() and its
// helpers in psy_web/src/lib/simDemo.js (keep the two in step), built on the
// website's own limits / condition ports. Pure functions over what the real
// pipeline stored: EEG blocks, ring windows, fusion windows.
import { EarlyWarning, EW_DEFAULT, mindLed, theilSen } from './earlyWarning';
import { blockAligned, eegL, mean, median, num, persistent, ringAligned, sdOf } from './limits';
import { fusionKeyToMs } from '../../shared/levels';

export { EW_DEFAULT as EW_PARAMS, STATE_TEXT } from './earlyWarning';

export function reasonShort(r) {
  if (!r) return 'rejected';
  const s = String(r).toLowerCase();
  if (s.includes('settling')) return 'settling';
  if (s.includes('max_raw') || s.includes('hardware')) return 'out of range';
  if (s.includes('gap')) return 'dropout';
  if (s.includes('delta_power') || s.includes('drift')) return 'drift / artifact';
  if (s.includes('clip') || s.includes('out-of-range') || s.includes('beyond')) return 'clipping';
  if (s.includes('flat')) return 'flat signal';
  if (s.includes('itakura') || s.includes('spectral')) return 'artifact';
  return 'quality gate';
}

export function mindSuppression(info) {
  if (!info) return 'EEG not calibrated';
  if (info.status === 'ok') return null;
  if (info.status == null) return 'high-load task not calibrated (provisional limit)';
  return info.status === 'drift_suspected' ? 'EEG calibration: drift suspected' : 'EEG calibration not separated';
}

// Fused calm level and spread from the calibration rest blocks (calibrationPhases).
export function fusedCalibration(phases) {
  const r = phases?.fused?.rest?.filter((v) => v != null) || [];
  if (!r.length) return null;
  return { baseline: phases.fused.levels.rest ?? mean(r), spread: r.length > 1 ? sdOf(r) : 0.05 };
}
// Body calm level / spread on the fusion scale, for the body detector.
export function bodyCalibration(phases) {
  const br = (phases?.body?.rest || []).filter((v) => v != null);
  return br.length ? { baseline: phases.body.levels.rest ?? median(br), spread: br.length > 1 ? sdOf(br) : 0.05 } : null;
}

export function buildSeries({ blocks, eegInfo, ringWindows, ringInfo, fusionWindows, fusedCal, bodyCal, ringBaseAt, params, nowMs }) {
  // ── Mind (EEG) ──
  const mReason = mindSuppression(eegInfo);
  const mDet = eegInfo ? new EarlyWarning(eegInfo.level, eegInfo.limitL, eegInfo.sd, params) : null;
  const flags = [];
  const mind = blocks.filter((b) => b.timestamp_end).map((b) => {
    const valid = !b.skipped && b.task_state_score != null;
    const v = valid ? blockAligned(b, eegInfo) : null;
    flags.push(v == null ? null : v >= 0.5);
    const high = persistent(flags);
    const L = valid ? eegL(b.task_state_score, eegInfo, b.personal_direction != null) : null;
    const ew = mDet ? mDet.update(L, { valid: valid && L != null, suppressed: mReason, highAlert: Boolean(high) }) : { state: 'limited', reason: mReason };
    return { t: b.timestamp_end * 1000, value: v, valid, high: Boolean(high), state: ew.state, reason: ew.reason, rejected: Boolean(b.skipped) };
  });
  // ── Body (HRV/GSR): same detector, calm level and spread from the ring calibration ──
  const bFlags = [];
  const bDet = new EarlyWarning(bodyCal?.baseline ?? 0.1, 0.5, Math.max(0.05, bodyCal?.spread ?? 0.05), params);
  const body = ringWindows.filter((w) => w.t && w.prob_stress != null).map((w) => {
    const v = ringAligned(w.prob_stress, ringInfo.limit);
    bFlags.push(v >= 0.5);
    const high = Boolean(persistent(bFlags));
    const ew = bDet.update(v, { valid: v != null, suppressed: ringInfo.limit == null ? 'no ring limit' : null, highAlert: high });
    return { t: w.t, value: v, prob: w.prob_stress, high, state: ew.state, reason: ew.reason };
  });
  // ── Fused ──
  const fb = fusedCal?.baseline ?? 0.25; const fs = Math.max(0.05, fusedCal?.spread ?? 0.05);
  const fDet = new EarlyWarning(fb, 0.5, fs, params);
  const fFlags = [];
  const ringAgeH = ringBaseAt ? (nowMs - ringBaseAt) / 3600000 : null;
  const fused = fusionWindows.filter((w) => w.fused_probability != null).map((w) => {
    const t = fusionKeyToMs(w.key);
    const v = num(w.fused_probability);
    fFlags.push(v >= 0.5);
    const high = Boolean(w.fused_high_persistent ?? persistent(fFlags));
    const mOn = w.prob_eeg != null && num(w.eeg_weight) > 0; const bOn = w.prob_hrv_gsr != null && num(w.hrv_gsr_weight) > 0;
    let reason = null;
    if (!bOn && mOn && mReason) reason = `mind only, and ${mReason}`;
    else if (bOn && ringAgeH != null && ringAgeH > 24) reason = `ring baseline is ${Math.round(ringAgeH)} h old (stale)`;
    const ew = fDet.update(v, { valid: true, suppressed: reason, highAlert: high });
    const bodyNow = num(w.hrv_gsr_aligned) ?? (w.prob_hrv_gsr != null ? ringAligned(num(w.prob_hrv_gsr), ringInfo.limit) : null);
    return { t, value: v, high, state: ew.state, reason: ew.reason, wEeg: num(w.eeg_weight), wRing: num(w.hrv_gsr_weight), body: bodyNow };
  });
  for (const f of fused) {
    const m = [...mind].reverse().find((x) => x.t <= f.t + 1000);
    f.mindLed = Boolean(m && mindLed(m.state, f.body));
  }
  return { mind, body, fused };
}

// Direction of the last few readings: rising / falling / steady.
export function trendOf(rows) {
  const r = rows.filter((x) => x.value != null).slice(-6);
  if (r.length < 3) return null;
  const s = theilSen(r.map((_, i) => i), r.map((x) => x.value));
  return s > 0.012 ? 'rising' : s < -0.012 ? 'falling' : 'steady';
}

// What each component's detector says now.
export const EW_LABEL = {
  early_warning: ['warn', 'Early warning', 'Trending up towards your limit'],
  high: ['high', 'High', 'Above your limit (2 of the last 3)'],
  recovering: ['rec', 'Recovering', 'Back below your limit, settling'],
  normal: ['ok', 'No warning', 'Calm, below your limit'],
  limited: ['off', 'Early warning off', 'Only “high” is reported until you recalibrate'],
  calibrating: ['off', 'Calibrating', 'No warnings yet'],
  stale: ['off', 'No recent reading', 'Waiting for a new reading'],
};
