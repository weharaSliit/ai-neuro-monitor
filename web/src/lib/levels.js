// Mirrors StressApp/modules/shared/levels.js exactly -- the website and
// the app must call the same reading "Calm"/"Rising"/"High".
export const COLORS = {
  brand: '#6E68B2', brandDark: '#4F4994', brandSoft: '#EFEFFB',
  normal: '#5E935A', normalLight: '#7CB878', normalDark: '#416E3D', normalSoft: '#E7F5E5',
  warning: '#E8A238', warningDark: '#BA7A1C', warningSoft: '#FEF5E7',
  stress: '#E56B4E', stressDark: '#BD472C', stressSoft: '#FDECE8',
  hrv: '#5E935A', gsr: '#6E68B2', acc: '#E56B4E', eeg: '#E8A238',
  text: '#231F20', textSub: '#544E50', textMuted: '#989294',
  border: '#EAE5DA', borderSoft: '#F2EEE4', card: '#FFFFFF', bg: '#F8F6F0', pill: '#F0ECE4',
};

export const DEFAULT_RING_THRESHOLD = 0.6447;
export const DEFAULT_EEG_THRESHOLD = 0.7933;
const BAND = 0.12;

export function levelOf(p, threshold) {
  if (p == null || Number.isNaN(p)) return null;
  const t = threshold ?? DEFAULT_RING_THRESHOLD;
  if (p >= t) return 'high';
  if (p >= t - BAND) return 'moderate';
  return 'low';
}

export const LEVEL_COLOR = { low: COLORS.normal, moderate: COLORS.warning, high: COLORS.stress };
export const MIND_WORDS = { low: 'Relaxed', moderate: 'Focused', high: 'Overloaded' };
export const BODY_WORDS = { low: 'Calm', moderate: 'Active', high: 'Tense' };
export const OVERALL_WORDS = { low: 'Low', moderate: 'Moderate', high: 'High' };

export const SLIDER_MODERATE_AT = 0.5;
export const SLIDER_LIMIT_AT = 0.67;

export function sliderPosition(p, threshold) {
  if (p == null || Number.isNaN(p)) return null;
  const t = Math.min(0.99, Math.max(0.02, threshold ?? DEFAULT_RING_THRESHOLD));
  const lo = Math.max(0.01, t - BAND);
  let pos;
  if (p <= lo) pos = (p / lo) * SLIDER_MODERATE_AT;
  else if (p <= t) pos = SLIDER_MODERATE_AT + ((p - lo) / (t - lo)) * (SLIDER_LIMIT_AT - SLIDER_MODERATE_AT);
  else pos = SLIDER_LIMIT_AT + ((p - t) / (1 - t)) * (1 - SLIDER_LIMIT_AT);
  return Math.max(0, Math.min(1, pos));
}

export function timeAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function sortedWindowKeys(obj) {
  if (!obj) return [];
  return Object.keys(obj).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
}

// fusion_en/{user}/{session}/{key}: key = floor(epoch_sec / bucket)
// (backend/common/fusion.py::fusion_window_key). The bucket was 60s and is
// now 25s (FUSION_WINDOW_BUCKET_SEC), and older sessions still hold 60s
// keys -- the two eras can't overlap: a 60s key passes 5e7 only in ~2065,
// a 25s key is above it for any date after 2009.
const FUSION_KEY_25S_FROM = 5e7;
export function fusionKeyToMs(key) {
  const k = Number(key);
  if (!Number.isFinite(k)) return null;
  return k * (k >= FUSION_KEY_25S_FROM ? 25000 : 60000);
}
