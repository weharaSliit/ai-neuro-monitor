// Simulation demo dashboard logic: per-component states (incl. the early
// warning), ground-truth periods from the live stimulator, the live
// scorecard vs that ground truth and the event log. Pure functions over
// what the real pipeline stored (EEG blocks, ring windows, fusion windows)
// plus the stimulator's own timeline -- nothing here is simulated.
import { EarlyWarning, EW_DEFAULT, mindLed } from './earlyWarning';
import { blockAligned, eegL, num, persistent, ringAligned } from './limits';
import { keyToMs } from './fusion';

// Parameter sets: the design defaults (pre-registered) and the set chosen on
// held-out simulation seeds (backend/simulation/output/simkit/ew_tuning.json).
export const EW_SETS = {
  design: { label: 'Design defaults', params: EW_DEFAULT },
  tuned: { label: 'Tuned on held-out seeds', params: { ...EW_DEFAULT, n: 6, k: 3, bufferSpreads: 0.0, riseSpreads: 0.25, alpha: 0.5 } },
};
export const GRACE_MS = 120000;     // calm after a non-calm period: physiological recovery, not a false alarm
export const ONSET_MS = 120000;     // first 2 min of demand: onset, not counted as a miss
export const LEAD_HORIZON_MS = 300000;
const HIGH_PHASES = new Set(['demand', 'task', 'mental', 'stress']);   // mental load expected
const LOAD_PHASES = new Set(['demand', 'ramp', 'task', 'mental', 'stress']);

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

// Ground truth: consecutive timeline points with the same phase -> periods.
export function periodsFrom(timeline, nowMs) {
  const out = [];
  for (const p of timeline) {
    const last = out[out.length - 1];
    if (last && last.phase === p.phase && last.calibration === Boolean(p.calibration)) { last.end = p.t; continue; }
    if (last) last.end = p.t;
    out.push({ phase: p.phase, calibration: Boolean(p.calibration), start: p.t, end: p.t });
  }
  if (out.length && nowMs) out[out.length - 1].end = Math.max(out[out.length - 1].end, nowMs);
  return out;
}

export function phaseBands(periods) {
  const LABEL = { task: 'TASK', demand: 'HIGH LOAD', ramp: 'Rising load', plateau: 'Moderate load', rest: 'Rest', recovery: 'Recovery', settle: 'Settle',
    mental: 'HIGH MENTAL LOAD', arousal: 'PHYSICAL AROUSAL', stress: 'STRESS' };
  return periods.filter((p) => p.phase !== 'calm' && p.phase !== 'relaxed').map((p) => ({
    x0: p.start, x1: p.end, label: LABEL[p.phase] || p.phase,
    kind: HIGH_PHASES.has(p.phase) ? 'stim' : p.phase === 'ramp' || p.phase === 'plateau' ? 'b' : 'a',
  }));
}

// equalWeights (simulation views while the stimulator runs): the fused value is
// the plain average of mind and body, each on its own aligned scale (limit 0.50),
// so both get the same priority. The fusion engine itself is unchanged; its
// reliability-weighted value is kept as engineValue for comparison.
export function buildSeries({ blocks, eegInfo, ringWindows, ringInfo, fusionWindows, fusedCal, ringBaseAt, params, nowMs, equalWeights = false }) {
  // ── Mind (EEG): oriented log-odds for the detector, fusion scale for display ──
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
    return { t: b.timestamp_end * 1000, value: v, valid, high: Boolean(high), state: ew.state, reason: ew.reason,
      rejected: Boolean(b.skipped), rejectReason: b.skipped ? reasonShort(b.eeg_quality_reason) : null, fullReason: b.eeg_quality_reason,
      rms: num(b.eeg_std_uv_unclamped), oor: num(b.eeg_out_of_range_fraction), feats: b.features_eeg?.bipolar || null };
  });
  // ── Body (HRV/GSR): prediction vs its own limit, 2 of 3 (no trend) ──
  const bFlags = [];
  const body = ringWindows.filter((w) => w.t && w.prob_stress != null).map((w) => {
    const v = ringAligned(w.prob_stress, ringInfo.limit);
    bFlags.push(v >= 0.5);
    const high = Boolean(persistent(bFlags));
    return { t: w.t, value: v, prob: w.prob_stress, high, state: high ? 'high' : 'normal' };
  });
  // ── Fused: early warning on the fusion scale with the calibrated fused calm level ──
  const fb = fusedCal?.baseline ?? 0.25; const fs = Math.max(0.05, fusedCal?.spread ?? 0.05);
  const fDet = new EarlyWarning(fb, 0.5, fs, params);
  const fFlags = [];
  const ringAgeH = ringBaseAt ? (nowMs - ringBaseAt) / 3600000 : null;
  const fused = fusionWindows.filter((w) => w.fused_probability != null).map((w) => {
    const t = keyToMs(w.key);
    const engineValue = num(w.fused_probability);
    const mA = num(w.prob_eeg) != null && num(w.eeg_weight) > 0 ? num(w.eeg_aligned) : null;
    const bA = num(w.prob_hrv_gsr) != null && num(w.hrv_gsr_weight) > 0
      ? num(w.hrv_gsr_aligned) ?? ringAligned(num(w.prob_hrv_gsr), ringInfo.limit) : null;
    const both = [mA, bA].filter((x) => x != null);
    const equal = equalWeights && both.length > 0;
    const v = equal ? both.reduce((a, x) => a + x, 0) / both.length : engineValue;
    fFlags.push(v >= 0.5);
    // with equal weights the 2-of-3 rule runs on the equal-weight value (the engine's flag is for its own value)
    const high = Boolean(equal ? persistent(fFlags) : w.fused_high_persistent ?? persistent(fFlags));
    const mOn = w.prob_eeg != null && num(w.eeg_weight) > 0; const bOn = w.prob_hrv_gsr != null && num(w.hrv_gsr_weight) > 0;
    const basedOn = mOn && bOn ? 'mind + body' : mOn ? 'mind only (body not reporting)' : bOn ? 'body only (mind not reporting)' : 'no input';
    let reason = null;
    if (!bOn && mOn && mReason) reason = `mind only, and ${mReason}`;
    else if (bOn && ringAgeH != null && ringAgeH > 24) reason = `ring baseline is ${Math.round(ringAgeH)} h old (stale)`;
    else if (!bOn && !ringBaseAt) reason = null;            // ring absent: fused = mind, judged like the mind
    const ew = fDet.update(v, { valid: true, suppressed: reason, highAlert: high });
    const bodyNow = num(w.hrv_gsr_aligned) ?? (w.prob_hrv_gsr != null ? ringAligned(w.prob_hrv_gsr, ringInfo.limit) : null);
    const mindNow = num(w.eeg_aligned);
    const wEq = equal ? { wEeg: mA != null ? 1 / both.length : 0, wRing: bA != null ? 1 / both.length : 0 } : null;
    return { t, value: v, engineValue, equalWeights: equal, high, state: ew.state, reason: ew.reason, basedOn,
      wEeg: wEq ? wEq.wEeg : num(w.eeg_weight), wRing: wEq ? wEq.wRing : num(w.hrv_gsr_weight),
      wEegEngine: num(w.eeg_weight), wRingEngine: num(w.hrv_gsr_weight), mind: mindNow, body: bodyNow };
  });
  // Mind-led (pre-stress signature): mind warning/high while the body is still below its limit.
  for (const f of fused) {
    const m = [...mind].reverse().find((x) => x.t <= f.t + 1000);
    f.mindLed = Boolean(m && mindLed(m.state, f.body));
  }
  return { mind, body, fused, fusedBand: [fb + params.bufferSpreads * fs, 0.5], mindReason: mReason };
}

const starts = (rows, pred) => {
  const out = []; let prev = false;
  for (const r of rows) { const c = pred(r); if (c && !prev) out.push(r.t); prev = c; }
  return out;
};
const ends = (rows, pred) => {
  const out = []; let prev = false;
  for (const r of rows) { const c = pred(r); if (!c && prev) out.push(r.t); prev = c; }
  return out;
};

// Live scorecard vs the simulated ground truth (live phases only).
export function scorecard(series, periods) {
  const live = periods.filter((p) => !p.calibration);
  if (!live.length) return null;
  // Load episodes: consecutive ramp/demand periods count as one (a ramp leading into demand).
  const loadP = [];
  for (const p of live) {
    const last = loadP[loadP.length - 1];
    if (!LOAD_PHASES.has(p.phase)) continue;
    if (last && last.end >= p.start - 1000) last.end = p.end;
    else loadP.push({ start: p.start, end: p.end, step: p.phase === 'demand' });
  }
  // Scored "during high load": demand periods; the 2 min onset is skipped only after an
  // abrupt step from calm (after a ramp the load is already up).
  const demand = live.filter((p) => p.phase === 'demand').map((p) => {
    const ep = loadP.find((e) => p.start >= e.start && p.start <= e.end);
    return { ...p, skip: ep && ep.step && ep.start === p.start ? ONSET_MS : 0 };
  });
  const nonCalmEnds = live.filter((p) => p.phase !== 'calm').map((p) => p.end);
  const inCalm = (t) => live.some((p) => p.phase === 'calm' && t >= p.start && t < p.end) && !nonCalmEnds.some((e) => t >= e && t < e + GRACE_MS);
  const out = {};
  for (const key of ['mind', 'body', 'fused']) {
    const rows = series[key].filter((r) => r.value != null);
    const dem = rows.filter((r) => demand.some((p) => r.t >= p.start + p.skip && r.t < p.end));
    const highStarts = starts(rows, (r) => r.high);
    const warnStarts = starts(rows, (r) => r.state === 'early_warning');
    const ttf = loadP.map((p) => { const h = highStarts.find((t) => t >= p.start && t < p.end + GRACE_MS); return h == null ? null : h - p.start; });
    const ttc = loadP.filter((p) => p.end < (rows[rows.length - 1]?.t ?? 0)).map((p) => {
      const c = rows.find((r) => r.t >= p.end && !r.high); return c ? c.t - p.end : null;
    });
    const lead = highStarts.filter((h) => loadP.some((p) => h >= p.start && h < p.end + GRACE_MS)).map((h) => {
      const w = warnStarts.find((x) => x <= h && x >= h - LEAD_HORIZON_MS); return w == null ? null : h - w;
    });
    out[key] = {
      alertRateDemand: dem.length ? dem.filter((r) => r.high).length / dem.length : null,
      falseAlarms: highStarts.filter(inCalm).length,
      falseWarnings: warnStarts.filter(inCalm).length,
      timeToAlert: ttf, timeToClear: ttc, leadTimes: lead,
      warnings: warnStarts.length,
    };
  }
  const blocks = series.mind;
  out.rejectionRate = blocks.length ? blocks.filter((b) => b.rejected).length / blocks.length : null;
  return out;
}

export function eventLog({ series, periods, injections = [], eegThrAt, ringThrAt }) {
  const ev = [];
  const NAME = { calm: 'calm period', demand: 'HIGH-LOAD period', ramp: 'load starts rising', plateau: 'moderate-load plateau',
    task: 'calibration: HIGH-LOAD TASK', rest: 'calibration: resting baseline', recovery: 'calibration: recovery rest', settle: 'calibration: settle' };
  for (const p of periods) ev.push({ t: p.start, kind: 'truth', text: `▶ ${NAME[p.phase] || p.phase} started (simulated)` });
  for (const [key, label] of [['mind', 'Mind'], ['fused', 'Fused']]) {
    const rows = series[key];
    for (const t of starts(rows, (r) => r.state === 'early_warning')) ev.push({ t, kind: 'warn', text: `▲ ${label} early warning: rising towards high load${key === 'fused' && rows.find((r) => r.t === t)?.mindLed ? ' (mind-led)' : ''}` });
    for (const t of ends(rows, (r) => r.state === 'early_warning')) ev.push({ t, kind: 'info', text: `${label} early warning ended` });
  }
  for (const [key, label] of [['mind', 'Mind'], ['body', 'Body'], ['fused', 'Fused']]) {
    const rows = series[key].filter((r) => r.value != null);
    for (const t of starts(rows, (r) => r.high)) ev.push({ t, kind: 'high', text: `▼ ${label} HIGH (2 of last 3 above the limit)` });
    for (const t of ends(rows, (r) => r.high)) ev.push({ t, kind: 'info', text: `${label} cleared` });
  }
  for (const b of series.mind.filter((r) => r.rejected)) ev.push({ t: b.t, kind: 'reject', text: `✕ EEG block rejected: ${b.rejectReason}`, title: b.fullReason });
  for (const i of injections) ev.push({ t: i.t, kind: 'inject', text: `⚡ injected: ${i.kind === 'clench' ? 'jaw clench' : i.kind}` });
  if (eegThrAt) ev.push({ t: eegThrAt, kind: 'cal', text: '✓ EEG thresholds calibrated' });
  if (ringThrAt) ev.push({ t: ringThrAt, kind: 'cal', text: '✓ Ring thresholds calibrated' });
  return ev.sort((a, b) => a.t - b.t);
}

// Fused calm level and spread from the calibration: lives in lib/limits (shared by every dashboard).
export { fusedCalibration } from './limits';

// ── Fused state from the two components (each judged against its own limit,
// 2 of the last 3 = above). Mind = cognitive load, body = autonomic arousal.
export const QUADRANTS = {
  relaxed: { label: 'Relaxed / normal', message: '', mind: false, body: false },
  mental: { label: 'High mental load', message: "You're concentrating hard.", mind: true, body: false },
  arousal: { label: 'Physical arousal', message: 'Your body is activated (movement, caffeine, emotion?).', mind: false, body: true },
  stress: { label: 'Stress', message: 'High load and high arousal; consider a break.', mind: true, body: true },
};
export function fusedQuadrant(mindHigh, bodyHigh) {
  if (mindHigh == null && bodyHigh == null) return null;
  const m = Boolean(mindHigh); const b = Boolean(bodyHigh);
  const key = m && b ? 'stress' : m ? 'mental' : b ? 'arousal' : 'relaxed';
  return { key, ...QUADRANTS[key], partial: mindHigh == null ? 'mind not reporting' : bodyHigh == null ? 'body not reporting' : null };
}

// ── Decisions start only after calibration: before the latest calibration
// finished (EEG threshold, and the ring's if the ring is in use), or while a
// recalibration runs, every component is 'calibrating' -- no alerts, warnings
// or fused state. Returns the time decisions start (ms) and whether paused now.
export function decisionGate({ cal, thr, ringThresholds, ringPresent, recalActive }) {
  const t = (v) => (v == null ? null : typeof v === 'number' ? v * 1000 : Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`));
  const eegAt = t(thr?.updated_at) ?? t(cal?.updated_at);
  const ringAt = ringPresent ? (t(ringThresholds?.task_updated_at) ?? t(ringThresholds?.threshold_updated_at) ?? t(ringThresholds?.resting_scores_updated_at)) : null;
  const startMs = Math.max(eegAt ?? 0, ringAt ?? 0) || null;
  return { startMs, paused: Boolean(recalActive) || startMs == null, eegAt, ringAt };
}

// Apply the gate to a built series: rows before the start (or all, while paused) -> 'calibrating'.
export function gateSeries(series, gate) {
  const g = (rows) => rows.map((r) => ((gate.paused || (gate.startMs && r.t < gate.startMs))
    ? { ...r, high: false, state: 'calibrating', reason: 'decisions start after calibration' } : r));
  return { ...series, mind: g(series.mind), body: g(series.body), fused: g(series.fused) };
}
