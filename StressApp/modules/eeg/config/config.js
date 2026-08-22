// Config for the live EEG (wearable02, T7/T8) screen. task_state_label is
// 0/1 same binary vocabulary as the physiological module's stress label
// (see backend/psychological/realtime/firebase_sync.py::make_eeg_output_record
// -- task_state_label = int(p >= TASK_STATE_LABEL_THRESHOLD)), so reused
// rather than duplicated.
export {
    STRESS_COLORS,
    STRESS_LABELS,
    STRESS_EMOJI,
} from '../../physiological/config/config.js';

// task_state_trend only ever emits 'increasing'/'decreasing'/'stable'
// (backend: firebase_sync.py::_trend_direction) -- same three-way
// vocabulary as fusion's stress_trend, kept as its own map here (not a
// shared import) since EEG's copy reads "task load", not "stress".
export const EEG_TREND_LABELS = {
    increasing: 'Rising cognitive load',
    decreasing: 'Easing',
    stable:     'Stable',
};

// task_state_label here means P(cognitively demanding task | EEG), NOT a
// validated subjective-stress probability -- see
// phscycological/results/CURRENT_SYSTEM.md Section 1. This screen must
// never call it "stress" in its own copy, even though it reuses
// STRESS_LABELS' 0/1 Normal/Stress strings for the color/emoji vocabulary.
export const TASK_STATE_LABELS = {
    0: 'Low cognitive load',
    1: 'High cognitive load',
};
