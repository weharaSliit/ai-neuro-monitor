// Helpers for the wearable 01 (ring) view. Each mirrors a source of truth in
// backend/physiological -- named next to it -- and is used only to DISPLAY
// what the backend already stored or the ring already sent.
import { GSR_CAL, RAW_DECISION_THRESHOLD, STRESS_DECISION_THRESHOLD } from './config';

// extract_features.py adc_to_conductance(): Grove GSR formula on a 10-bit
// scale (ESP32 ADC is 12-bit, so both values are divided by 4).
export function adcToMicroS(adc, cal = GSR_CAL) {
  if (adc == null || !Number.isFinite(adc)) return null;
  const a = adc / 4; const c = cal / 4;
  let den = c - a;
  if (Math.abs(den) < 1) den = 1;
  let r = ((1024 + 2 * a) * 10000) / den;
  if (r <= 0) r = 1e6;
  return 1e6 / r;
}

// predictor.py EDA_FEATURES: normalised as value / baseline mean (ratio);
// every other feature as (value - mean) / std (z-score).
export const EDA_FEATURES = new Set([
  'SCL_mean', 'SCL_std', 'SCL_slope', 'EDA_mean', 'EDA_std', 'EDA_range', 'EDA_slope',
  'SCR_count', 'SCR_amp_mean', 'SCR_width_mean', 'EDA_q10', 'EDA_q25', 'EDA_q75', 'EDA_q90',
  'deriv1_mean', 'deriv1_std', 'deriv2_mean', 'wavelet_approx_mean', 'wavelet_approx_energy',
  'wavelet_d1_energy', 'wavelet_d2_energy', 'wavelet_d3_energy',
]);

export const FEATURE_GROUPS = [
  { name: 'Heart rate variability (PPG)', test: (k) => ['AVNN', 'MeanHR', 'SDHR', 'SD1', 'pNN20', 'RMSSD', 'SDNN'].includes(k) },
  { name: 'Skin conductance (GSR)', test: (k) => EDA_FEATURES.has(k) },
  { name: 'Movement (accelerometer)', test: (k) => k.startsWith('ACC') },
];

export const FEATURE_HINTS = {
  AVNN: 'Mean interval between beats (ms)', MeanHR: 'Mean heart rate (bpm)', SDHR: 'Heart-rate spread (bpm)',
  SD1: 'Short-term beat-to-beat variability (ms)', pNN20: 'Share of successive beats differing by > 20 ms',
  SCL_mean: 'Tonic skin conductance level (µS)', SCL_slope: 'Drift of the tonic level',
  EDA_mean: 'Mean conductance (µS)', EDA_std: 'Conductance spread', EDA_range: 'Max − min conductance',
  SCR_count: 'Skin-conductance responses per window', SCR_amp_mean: 'Mean response amplitude',
  SCR_width_mean: 'Mean response width (s)', ACC_mean: 'Mean movement magnitude (g)', ACC_std: 'Movement variability (g)',
};

// app.py /predict: personal threshold if the onboarding task produced one,
// else the population threshold for the baseline-normalised model, else
// (no baseline yet) the raw-feature model's.
export function effectiveThreshold(thresholds, baseline) {
  const personal = thresholds?.personal_stress_threshold;
  if (personal != null) return { value: personal, source: 'personal' };
  if (baseline) return { value: STRESS_DECISION_THRESHOLD, source: 'population' };
  return { value: RAW_DECISION_THRESHOLD, source: 'raw model (no baseline)' };
}

// Normalised value the model actually saw for one feature (predictor.py
// normalize_features), plus how it compares with the person's baseline.
export function normalised(key, value, base) {
  if (value == null || !base || base.mean == null) return { kind: null, v: null };
  if (EDA_FEATURES.has(key)) {
    return Math.abs(base.mean) > 0.001
      ? { kind: 'ratio', v: value / base.mean }
      : { kind: 'diff', v: value - base.mean };
  }
  return { kind: 'z', v: base.std ? (value - base.mean) / base.std : null };
}

// Firebase push keys sort chronologically.
export function pushList(node) {
  if (!node || typeof node !== 'object') return [];
  return Object.keys(node).sort().map((k) => ({ ...node[k], _key: k }));
}

// predictions/ and prediction_quality/ are written by the same /predict
// call, so a window's quality row has the same window_idx and a timestamp
// within a moment of it (window_idx alone repeats after a bridge restart).
export function joinQuality(preds, quals) {
  return preds.map((p) => {
    const t = Date.parse(p.timestamp);
    let best = null; let bd = Infinity;
    for (const q of quals) {
      if (q.window_idx !== p.window_idx) continue;
      const d = Math.abs(Date.parse(q.timestamp) - t);
      if (d < bd) { bd = d; best = q; }
    }
    return { ...p, quality: bd < 30000 ? best : null, t: Number.isFinite(t) ? t : null };
  });
}

// devices/wearable01.last_seen is written with a naive datetime.now(), i.e.
// the bridge host's local clock (UTC on Render, local on a laptop). Read it
// both ways and keep whichever is closest to "now" without being ahead.
export function parseNaive(iso, now = Date.now()) {
  if (!iso) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) return Date.parse(iso);
  const utc = Date.parse(`${iso}Z`); const local = Date.parse(iso);
  const cands = [utc, local].filter((t) => Number.isFinite(t) && t <= now + 60000);
  return cands.length ? Math.max(...cands) : (Number.isFinite(utc) ? utc : null);
}
