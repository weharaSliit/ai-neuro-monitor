// ============================================================
// config.js
// Central configuration for StressApp
//
// WESAD simulation mode removed — the real ring (ESP32 -> WiFi ->
// Mosquitto -> mqtt_bridge.py -> Flask) is the only deployment
// target. Backend endpoints simplified to /predict and /calibrate
// (previously /predict/ring, /calibrate/ring) since there's no
// longer a simulation counterpart to disambiguate from.
// ============================================================

export const API_BASE     = 'http://10.180.48.56:5050';
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

// ── GSR calibration storage key ───────────────────────────
// Grove GSR needs a calibration value recorded at setup.
// Stored in AsyncStorage under this key per user.
// Value is the ADC reading when electrodes not worn
// and potentiometer adjusted to minimum output.
export const GSR_CALIBRATION_KEY = 'gsr_calibration_value';
