// User condition from mind (EEG) x body (HRV/GSR), each judged against its
// OWN calibrated limit (2 of the last 3 readings above it), and the rule that
// decisions start only after calibration -- port of psy_web/src/lib/simDemo.js.
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
