// Config for the live fusion screen. Reuses the physiological module's
// binary label/color/emoji vocabulary (fused_label is 0/1 same as that
// module's stress label) rather than duplicating it.
export {
    STRESS_COLORS,
    STRESS_LABELS,
    STRESS_EMOJI,
} from '../../physiological/config/config.js';

// NOT reusing physiological/config.js's TREND_LABELS here -- that map is
// keyed 'stable'/'toward_stress', but the fusion loop's stress_trend field
// (backend: fushion engin/fusion_live_session.py, reusing
// backend/psychological/realtime/firebase_sync.py::_trend_direction) only
// ever emits 'increasing'/'decreasing'/'stable'. A correctly-keyed map,
// not a superset/rename of the existing one.
export const FUSION_TREND_LABELS = {
    increasing: 'Trending toward stress',
    decreasing: 'Improving',
    stable:     'Stable',
};
