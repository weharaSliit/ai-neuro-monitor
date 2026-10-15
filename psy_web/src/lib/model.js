import coef from './model_coefficients.json';
import { TASK_STATE_LABEL_THRESHOLD } from './config';

export const MODEL = coef;

// Same 0.12 "moderate" band as web/src/lib/levels.js, so this site and the
// main dashboard name a reading the same way.
const BAND = 0.12;
export function levelOf(p, threshold) {
  if (p == null || Number.isNaN(p) || threshold == null) return null;
  if (p >= threshold) return 'high';
  if (p >= threshold - BAND) return 'moderate';
  return 'low';
}
export const LEVEL_WORDS = { low: 'Relaxed', moderate: 'Focused', high: 'Overloaded' };

export function modelLabelText(label) {
  if (label == null) return '—';
  return label === 1
    ? `1 · high task state (≥ ${TASK_STATE_LABEL_THRESHOLD})`
    : `0 · low task state (< ${TASK_STATE_LABEL_THRESHOLD})`;
}

// Recomputes the logistic-regression decision from a block's own stored
// features: z_i = (x_i - mean_i) / scale_i, contribution_i = coef_i * z_i,
// raw_score = sigmoid(intercept + sum). The backend then subtracts the
// calibration baseline_shift to get task_state_score (pipeline.py).
export function explain(bipolar) {
  if (!bipolar) return null;
  let sum = MODEL.intercept;
  const rows = [];
  for (const f of MODEL.features) {
    const x = bipolar[f.name];
    if (x == null) return null;
    const z = (x - f.mean) / f.scale;
    const c = f.coef * z;
    sum += c;
    rows.push({ name: f.name, x, z, coef: f.coef, contribution: c });
  }
  return { rows, logit: sum, rawScore: 1 / (1 + Math.exp(-sum)) };
}

// Grouping + human descriptions for the 29 bipolar features
// (sam40/features.py::channel_features, BANDS 0.5-4/4-8/8-13/13-30/30-45 Hz).
export const FEATURE_GROUPS = [
  {
    title: 'Band power (absolute, µV²)',
    keys: ['delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power', 'total_power'],
  },
  {
    title: 'Band power (relative, fraction of total)',
    keys: ['delta_rel_power', 'theta_rel_power', 'alpha_rel_power', 'beta_rel_power', 'gamma_rel_power'],
  },
  {
    title: 'Band power (log)',
    keys: ['delta_log_power', 'theta_log_power', 'alpha_log_power', 'beta_log_power', 'gamma_log_power'],
  },
  { title: 'Band ratios', keys: ['theta_alpha_ratio', 'beta_alpha_ratio', 'theta_beta_ratio'] },
  { title: 'Spectral shape', keys: ['spectral_entropy', 'spectral_slope'] },
  { title: 'Hjorth parameters', keys: ['hjorth_activity', 'hjorth_mobility', 'hjorth_complexity'] },
  { title: 'Time domain (µV)', keys: ['mean', 'std', 'rms', 'ptp'] },
  { title: 'Complexity', keys: ['sample_entropy'] },
];

export const BANDS = [
  { key: 'delta', label: 'Delta', sub: '0.5–4 Hz' },
  { key: 'theta', label: 'Theta', sub: '4–8 Hz' },
  { key: 'alpha', label: 'Alpha', sub: '8–13 Hz' },
  { key: 'beta', label: 'Beta', sub: '13–30 Hz' },
  { key: 'gamma', label: 'Gamma', sub: '30–45 Hz' },
];

export function fmt(v, digits = 3) {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
  return v.toFixed(a >= 100 ? 1 : digits);
}

// ── Amplitude gain preview (backend pipeline.py AMPLITUDE_CALIBRATION) ──
// The backend multiplies every block of a session by one gain (training
// SD / the session's rest SD) before features are computed, when the rest
// signal is below the SAM40 range. Blocks stored before a session had a
// gain can be re-scored here at that gain from their stored features:
// powers scale by g², log powers shift by ln(g²), amplitudes scale by g,
// and every relative/shape feature is unchanged. (Exact except where the
// rescaled signal would cross the backend's ±100 µV clamp.)
const STD_FEATURE = MODEL.features.find((f) => f.name === 'std');
export const TRAIN_STD_UV = STD_FEATURE ? STD_FEATURE.mean : 6.404;
export const TRAIN_STD_LOW_UV = STD_FEATURE ? STD_FEATURE.mean - 2 * STD_FEATURE.scale : 3.66;
const MAX_AMPLITUDE_GAIN = 100;   // pipeline.py MAX_AMPLITUDE_GAIN
const MIN_REST_STD_UV = 0.05;     // pipeline.py MIN_REST_STD_UV
const SQUARED = ['delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power', 'total_power', 'hjorth_activity'];
const LOGS = ['delta_log_power', 'theta_log_power', 'alpha_log_power', 'beta_log_power', 'gamma_log_power'];
const LINEAR = ['mean', 'std', 'rms', 'ptp'];

export function rescaleBipolar(bp, g) {
  if (!bp || !(g > 0)) return null;
  const out = { ...bp };
  for (const k of SQUARED) if (out[k] != null) out[k] *= g * g;
  for (const k of LOGS) if (out[k] != null) out[k] += 2 * Math.log(g);
  for (const k of LINEAR) if (out[k] != null) out[k] *= g;
  return out;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

// Gain to preview a session's gain-1 blocks at: the session's own measured
// gain if its calibration has one, else an estimate from the median SD of
// its trusted blocks (same rule as the backend). null = no gain applies.
export function previewGain(sessionData) {
  const cal = sessionData.calibration;
  const old = sessionData.blocks.filter((b) => (b.amplitude_gain ?? 1) === 1 && !b.skipped && b.features_eeg?.bipolar?.std != null);
  if (!old.length) return null;
  if (cal?.amplitude_gain > 1) {
    return { gain: cal.amplitude_gain, source: 'calibration', restStd: cal.rest_std_uv, muRest: cal.mu_rest ?? null };
  }
  const sd = median(old.map((b) => b.features_eeg.bipolar.std));
  if (sd == null || sd >= TRAIN_STD_LOW_UV || sd < MIN_REST_STD_UV) return null;
  return { gain: Math.min(MAX_AMPLITUDE_GAIN, TRAIN_STD_UV / sd), source: 'estimate', restStd: sd, muRest: null };
}

// Score a gain-1 block would get at gain g (null if it already has a gain
// or its features weren't stored).
export function previewScore(block, g) {
  if (!g || (block.amplitude_gain ?? 1) !== 1 || block.skipped) return null;
  const ex = explain(rescaleBipolar(block.features_eeg?.bipolar, g));
  return ex ? ex.rawScore : null;
}
