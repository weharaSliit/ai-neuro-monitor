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

// ── Decisions (same rule as psy_web/src/lib/simDemo.js decisionGate) ──
// A calibration is used until the user asks to recalibrate. Readings are
// 'calibrating' only before the first calibration and while an asked-for
// recalibration runs (its request until it finishes); readings already judged
// keep their states. eegRecal / ringRecal: eeg_recalibration/{sid},
// ring_recalibration/{uid}. An unfinished record counts only while it is still
// being updated (10 min) and never longer than RECAL_MAX_MIN, so one left
// behind (a stimulator stopped mid-run, a crashed capture) can't block decisions.
const RECAL_MAX_MIN = 60;
export function decisionGate({ cal, thr, ringThresholds, ringPresent, eegRecal, ringRecal, nowMs = Date.now() }) {
  const t = (v) => (v == null ? null : typeof v === 'number' ? v * 1000 : Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`));
  const eegAt = t(thr?.updated_at) ?? t(cal?.updated_at);
  const ringAt = ringPresent ? (t(ringThresholds?.task_updated_at) ?? t(ringThresholds?.threshold_updated_at) ?? t(ringThresholds?.resting_scores_updated_at)) : null;
  const startMs = Math.max(eegAt ?? 0, ringAt ?? 0) || null;
  const fresh = (rec) => (t(rec?.updated_at) ?? t(rec?.requested_at) ?? 0) >= nowMs - 10 * 60000
    && (t(rec?.requested_at) ?? 0) >= nowMs - RECAL_MAX_MIN * 60000;
  const eegActive = ['requested', 'capturing', 'saving'].includes(eegRecal?.status) && fresh(eegRecal);
  const ringActive = ['capturing', 'saving'].includes(ringRecal?.status) && fresh(ringRecal);
  const blank = [];
  const window = (rec, active, doneAt) => {
    const from = t(rec?.requested_at);
    if (from != null) blank.push([from, active ? Infinity : Math.min(from + RECAL_MAX_MIN * 60000, Math.max(t(rec.updated_at) ?? from, doneAt ?? from))]);
    else if (doneAt != null) blank.push([-Infinity, doneAt]);          // the session's first calibration
  };
  window(eegRecal, eegActive, eegAt);
  if (ringPresent) window(ringRecal, ringActive, ringAt);
  return { startMs, paused: startMs == null, recalibrating: eegActive || ringActive, blank, eegAt, ringAt };
}

// A reading's time is usable for a decision (not before calibration, not during an asked-for recalibration).
export const decided = (gate, ts) => !gate.paused && !(gate.blank || []).some(([a, b]) => ts >= a && ts <= b);

// Apply the gate to a built series: rows recorded while calibrating -> 'calibrating'.
export function gateSeries(series, gate) {
  const g = (rows) => rows.map((r) => (decided(gate, r.t) ? r
    : { ...r, high: false, state: 'calibrating', reason: gate.paused ? 'decisions start after calibration' : 'recorded during calibration' }));
  return { ...series, mind: g(series.mind), body: g(series.body), fused: g(series.fused) };
}
