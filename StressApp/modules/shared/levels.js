import { COLORS } from '../physiological/config/theme';

// Population fallbacks, used only when a window carries no per-user
// threshold: Ring = Youden's-J cutoff (backend/common/config.py),
// EEG = DecisionThresholds.high_load_p (psychological/sam40/decision.py).
export const DEFAULT_RING_THRESHOLD = 0.6447;
export const DEFAULT_EEG_THRESHOLD = 0.7933;

// Width of the "moderate" band just below a person's own threshold --
// same order as PERSONAL_THRESHOLD_MIN_SEPARATION (0.10) and EEG's
// MAX_THRESHOLD_SHIFT (~0.11), so "moderate" means "within one
// meaningful shift of your limit".
const BAND = 0.12;

export function levelOf(p, threshold) {
  if (p == null || Number.isNaN(p)) return null;
  const t = threshold ?? DEFAULT_RING_THRESHOLD;
  if (p >= t) return 'high';
  if (p >= t - BAND) return 'moderate';
  return 'low';
}

export const LEVEL_COLOR = {
  low: COLORS.normal,
  moderate: COLORS.warning,
  high: COLORS.stress,
};

export const MIND_WORDS = { low: 'Relaxed', moderate: 'Focused', high: 'Overloaded' };
export const BODY_WORDS = { low: 'Calm', moderate: 'Active', high: 'Tense' };
export const OVERALL_WORDS = { low: 'Low', moderate: 'Moderate', high: 'High' };

// Slider position that keeps each person's own band edges at FIXED
// spots on the bar (moderate starts at 50%, their limit sits at 67%),
// so "High" always reads as the red end -- otherwise a user whose
// personal limit is 0.43 would see "High" stress drawn in the green
// half of a raw 0-100% bar.
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
