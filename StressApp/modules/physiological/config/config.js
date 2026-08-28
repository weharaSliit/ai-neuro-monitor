// ============================================================
// config.js
// Central configuration for StressApp
//
// WESAD simulation mode removed — the real ring (ESP32 -> EMQX Cloud ->
// mqtt_bridge.py -> Flask) is the only deployment target. Backend
// endpoints simplified to /predict and /calibrate (previously
// /predict/ring, /calibrate/ring) since there's no longer a simulation
// counterpart to disambiguate from.
//
// API_BASE now points at the Render-hosted Flask service instead of a
// local machine IP -- fixes the recurring "app can't reach backend"
// breakage every time the dev machine's network/IP changed (WiFi vs
// Ethernet, hotspot switches, etc.), since this URL is permanent
// regardless of which network anyone is on.
// ============================================================

export const API_BASE     = 'https://mindpulse-physiological.onrender.com';
export const DEVICE_ID    = 'wearable01';

export const STRESS_COLORS = {
    0: '#22c55e',
    1: '#ef4444',
};

export const STRESS_LABELS = {
    0: 'Normal',
    1: 'Stress',
};

export const STRESS_EMOJI = {
    0: '😌',
    1: '😨',
};

export const TREND_LABELS = {
    stable:        'Stable',
    toward_stress: 'Trending toward stress',
};

// Same ROC/Youden's-J-derived cutoff as backend/common/config.py's
// STRESS_DECISION_THRESHOLD (0.7141), expressed on the 0-100 scale trend
// charts already plot on. One shared constant, not a value each user's
// data produces -- this line is the same for every account, not a
// personalized number, since the physiological pipeline calibrates per-
// user HRV/GSR baselines (mean/std), not a personalized decision boundary.
export const STRESS_DECISION_THRESHOLD_PERCENT = 71.41;

// ── GSR calibration storage key ───────────────────────────
// Grove GSR needs a calibration value recorded at setup.
// Stored in AsyncStorage under this key per user.
// Value is the ADC reading when electrodes not worn
// and potentiometer adjusted to minimum output.
export const GSR_CALIBRATION_KEY = 'gsr_calibration_value';
