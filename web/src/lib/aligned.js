// Mind / Body values on the shared "aligned" scale, where each model's own
// limit sits at 0.5. Same rule as the fusion engine
// ("fushion engin/fusion_engin.py", aligned scale) and as psy_web's fusion
// view: sigmoid((p - limit) / spread), the distance capped at +-3 spreads.
//
// Windows fused live carry the value already (eeg_aligned, hrv_gsr_aligned).
// Older or partly written windows may not, so it is recomputed from the
// stored probability, limit and spread; a window without those gives null
// and simply leaves a gap in the line.

const Z_CAP = 3;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

function recompute(p, thr, scale) {
  p = num(p); thr = num(thr); scale = num(scale);
  if (p == null || thr == null || scale == null || scale <= 0) return null;
  const d = Math.max(-Z_CAP, Math.min(Z_CAP, (p - thr) / scale));
  return sigmoid(d);
}

// mod: 'eeg' (Mind) or 'hrv' (Body). Returns 0..1 or null.
export function alignedOf(w, mod) {
  if (mod === 'eeg') {
    return num(w.eeg_aligned) ?? recompute(w.prob_eeg, w.threshold_eeg, w.threshold_scale_eeg);
  }
  return num(w.hrv_gsr_aligned) ?? recompute(w.prob_hrv_gsr, w.threshold_hrv_gsr, w.threshold_scale_hrv_gsr);
}

// Fused value on the same scale (only when the window was fused on it).
export function fusedAligned(w) {
  return w.fused_scale === 'aligned' ? num(w.fused_probability) : null;
}
