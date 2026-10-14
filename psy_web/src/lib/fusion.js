// Mirror of the live fusion rule in "fushion engin/fusion_engin.py"
// (compute_realtime_multimodal_fusion, aligned scale), used only to SHOW how
// each stored fused value was built. The numbers on screen come from
// Firebase; this recomputation is a cross-check, never a replacement.

export const MODALITIES = [
  { key: 'eeg', label: 'Mind (EEG)', color: 'var(--c1)', qualityMax: 100 },
  { key: 'hrv_gsr', label: 'Body (HRV + GSR)', color: 'var(--c2)', qualityMax: 1 },
];

export const EXTREME_PROB_EPS = 1e-6;   // fusion_engin.py EXTREME_PROB_EPS
export const SATURATED_WEIGHT = 0.5;    // FUSION_SATURATED_WEIGHT default
export const ALIGNED_Z_CAP = 3;         // ALIGNED_Z_CAP

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

// fusion_en keys are floor(epoch / grid): 25 s grid now, 60 s in older
// sessions (same rule as web/src/lib/levels.js fusionKeyToMs).
export function keyToMs(key) {
  const k = Number(key);
  if (!Number.isFinite(k)) return null;
  return k * 25 > 1.5e9 ? k * 25000 : k * 60000;
}

export function windowMs(w) {
  const t = w?.timestamp ? Date.parse(w.timestamp) : NaN;
  return Number.isFinite(t) ? t : keyToMs(w?.key);
}

// Per-modality inputs and the weight arithmetic, aligned scale.
export function breakdown(w) {
  const rows = {};
  for (const m of MODALITIES) {
    const p = num(w[`prob_${m.key}`]);
    const thr = num(w[`threshold_${m.key}`]);
    const sc = num(w[`threshold_scale_${m.key}`]);
    const q = num(w[`signal_quality_${m.key}`]);
    const acc = num(w[`model_acc_${m.key}`]);
    if (p == null) { rows[m.key] = { present: false }; continue; }
    const saturated = p < EXTREME_PROB_EPS || p > 1 - EXTREME_PROB_EPS;
    const pc = saturated ? Math.min(Math.max(p, EXTREME_PROB_EPS), 1 - EXTREME_PROB_EPS) : p;
    const canAlign = thr != null && sc != null && sc > 0;
    const distRaw = canAlign ? (pc - thr) / sc : null;
    const dist = distRaw == null ? null : Math.max(-ALIGNED_Z_CAP, Math.min(ALIGNED_Z_CAP, distRaw));
    const aligned = dist == null ? null : sigmoid(dist);
    const conf = aligned == null ? null : Math.max(aligned, 1 - aligned);
    const qNorm = q == null ? 0 : clamp01(q / m.qualityMax);
    const satFactor = saturated ? SATURATED_WEIGHT : 1;
    const rawWeight = conf == null ? 0 : qNorm * satFactor * conf * clamp01(acc ?? 0);
    rows[m.key] = {
      present: true, p, thr, sc, q, qNorm, acc, saturated, satFactor,
      distRaw, dist, capped: distRaw != null && Math.abs(distRaw) > ALIGNED_Z_CAP,
      aligned, conf, rawWeight,
    };
  }
  const total = MODALITIES.reduce((s, m) => s + (rows[m.key].rawWeight || 0), 0);
  let fused = null;
  if (total > 1e-9) {
    fused = 0;
    for (const m of MODALITIES) {
      const r = rows[m.key];
      r.weight = (r.rawWeight || 0) / total;
      if (r.present && r.aligned != null) fused += r.aligned * r.weight;
    }
  }
  return { rows, total, fused };
}

// Snapshot of one session's fusion windows, oldest first.
export function toWindows(node) {
  if (!node || typeof node !== 'object') return [];
  return Object.keys(node)
    .filter((k) => /^\d+$/.test(k) && node[k] && typeof node[k] === 'object')
    .map((k) => ({ ...node[k], key: Number(k) }))
    .sort((a, b) => a.key - b.key);
}

export const PHASE_TEXT = {
  stable: 'Stable',
  trending_towards_stress: 'Trending towards stress',
  increasing_stress_alert: 'Rising stress alert',
};

export const EEG_BASIS_TEXT = {
  calibrated: 'Calibrated (full weight)',
  uncalibrated: 'Uncalibrated (half weight)',
  not_responsive: 'Not responsive (quarter weight)',
  provisional: 'Provisional (weak-signal block)',
};
