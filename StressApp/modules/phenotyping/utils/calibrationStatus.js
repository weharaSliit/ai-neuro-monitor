// Port of the standalone phenotyping app's userStorage.js calibration-status
// logic (getCalibrationStatus/markCalibrated) -- identity itself no longer
// lives here (StressApp's AuthContext/login is now the single source of
// truth for who's using the app, see the "Bring Phenotyping Into StressApp"
// plan), so this only tracks the two local fields that logic actually needs:
// when this device first started collecting for this user, and whether the
// backend has ever confirmed a real calibration.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'phenotyping_calib_';

async function readState(userId) {
    try {
        const raw = await AsyncStorage.getItem(KEY_PREFIX + userId);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

async function writeState(userId, state) {
    await AsyncStorage.setItem(KEY_PREFIX + userId, JSON.stringify(state));
}

// Ensures a created_at timestamp exists for this user (first call ever
// creates it), then returns the day-number/phase status exactly like the
// original getCalibrationStatus().
export async function getCalibrationStatus(userId) {
    let state = await readState(userId);
    if (!state) {
        state = { created_at: new Date().toISOString(), is_calibrated: false };
        await writeState(userId, state);
    }

    const created = new Date(state.created_at);
    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - created.getTime());
    const daysElapsed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const dayNumber = Math.min(daysElapsed + 1, 99);
    const isCalibrated = !!state.is_calibrated;

    if (isCalibrated) {
        return {
            dayNumber, displayDays: `Day ${dayNumber}+`, phase: 'active',
            progressPct: 100, title: 'Pre-stress predictions active', isCalibrated: true,
        };
    }

    if (dayNumber <= 7) {
        return {
            dayNumber, displayDays: `Day ${dayNumber} of 7`, phase: 'calibration',
            progressPct: Math.round((dayNumber / 7) * 100),
            title: dayNumber <= 3 ? 'Learning your rhythm' : dayNumber <= 5 ? 'Building your fingerprint' : 'Calibrating baseline',
            isCalibrated: false,
        };
    }

    return {
        dayNumber, displayDays: `Day ${dayNumber} — awaiting enough data`, phase: 'calibration',
        progressPct: 100, title: 'Waiting for enough usage to calibrate', isCalibrated: false,
    };
}

// Call after a successful POST /behavior/calibrate response.
export async function markCalibrated(userId) {
    const state = (await readState(userId)) || { created_at: new Date().toISOString() };
    const updated = { ...state, is_calibrated: true, calibrated_at: new Date().toISOString() };
    await writeState(userId, updated);
    return updated;
}

// Throttles the dashboard's auto-calibrate POST to once per calendar day
// per user -- same behavior as the original's localStorage throttle key.
export async function shouldAttemptCalibrateToday(userId) {
    const throttleKey = `phenotyping_calib_attempt_${userId}`;
    const today = new Date().toISOString().slice(0, 10);
    const last = await AsyncStorage.getItem(throttleKey);
    if (last === today) return false;
    await AsyncStorage.setItem(throttleKey, today);
    return true;
}
