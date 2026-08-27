// Config for the phenotyping (keystroke/app-usage) screens. Reuses the
// physiological module's Render-hosted-URL pattern -- see that module's
// config.js for why a fixed URL (not a local IP) matters.
//
// This is the SAME backend the native KeystrokeCollectorService posts to
// (see android/app/.../phenotyping/KeystrokeCollectorService.java's
// FLASK_BASE_URL) -- keep both in sync manually if this ever changes.
import { COLORS } from '../../physiological/config/theme';

export const API_BASE = 'https://ai-neuro-monitor-8wsv.onrender.com';

// Was hardcoded to the old sage palette's exact hex values -- now reads the
// live shared COLORS so it stays correct across any future palette change
// instead of silently drifting out of sync (as it had after this redesign's
// new "Calm Mist" palette landed).
export const STRESS_LEVEL_COLORS = {
    normal:   COLORS.normal,
    elevated: COLORS.warning,
    high:     COLORS.stress,
};

export const MOOD_EMOJI = {
    Normal:       { emoji: '😊', label: 'Feeling good' },
    Low:          { emoji: '😌', label: 'Slight tension' },
    Moderate:     { emoji: '😟', label: 'Moderate stress' },
    High:         { emoji: '😰', label: 'High stress' },
    Calibrating:  { emoji: '📊', label: 'Building baseline' },
};

export function gaugeColor(score, isCalibrating) {
    if (isCalibrating) return COLORS.brand;
    if (score < 0.3) return STRESS_LEVEL_COLORS.normal;
    if (score < 0.6) return STRESS_LEVEL_COLORS.elevated;
    return STRESS_LEVEL_COLORS.high;
}
