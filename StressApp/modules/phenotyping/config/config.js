// Config for the phenotyping (keystroke/app-usage) screens. Reuses the
// physiological module's Render-hosted-URL pattern -- see that module's
// config.js for why a fixed URL (not a local IP) matters.
//
// This is the SAME backend the native KeystrokeCollectorService posts to
// (see android/app/.../phenotyping/KeystrokeCollectorService.java's
// FLASK_BASE_URL) -- keep both in sync manually if this ever changes.
export const API_BASE = 'https://ai-neuro-monitor-8wsv.onrender.com';

export const STRESS_LEVEL_COLORS = {
    normal:   '#7FB596',
    elevated: '#E0A458',
    high:     '#D97A76',
};

export const MOOD_EMOJI = {
    Normal:       { emoji: '😊', label: 'Feeling good' },
    Low:          { emoji: '😌', label: 'Slight tension' },
    Moderate:     { emoji: '😟', label: 'Moderate stress' },
    High:         { emoji: '😰', label: 'High stress' },
    Calibrating:  { emoji: '📊', label: 'Building baseline' },
};

export function gaugeColor(score, isCalibrating) {
    if (isCalibrating) return '#7A9B8E';
    if (score < 0.3) return STRESS_LEVEL_COLORS.normal;
    if (score < 0.6) return STRESS_LEVEL_COLORS.elevated;
    return STRESS_LEVEL_COLORS.high;
}
