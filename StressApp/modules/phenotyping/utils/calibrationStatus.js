// Port of the standalone phenotyping app's userStorage.js calibration-status
// logic (getCalibrationStatus/markCalibrated) -- identity itself no longer
// lives here. Keyed by this device's own randomly-generated Digital
// Phenotyping tracking id (see utils/deviceIdentity.js), not the shared
// account login id -- so this only tracks the two local fields that logic
// actually needs: when this device first started collecting, and whether
// the backend has ever confirmed a real calibration for it.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'phenotyping_calib_';

async function readState(deviceId) {
    try {
        const raw = await AsyncStorage.getItem(KEY_PREFIX + deviceId);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

async function writeState(deviceId, state) {
    await AsyncStorage.setItem(KEY_PREFIX + deviceId, JSON.stringify(state));
}

// Pure day-number/phase calculation, shared by getCalibrationStatus() below
// (this device's own AsyncStorage-cached state, offline-tolerant) and by
// admin/cross-user screens that already have the real Firebase profile
// ({ created_at, is_calibrated }) for a DIFFERENT device and must not read
// this device's local AsyncStorage for it -- that would just fabricate a
// fresh "Day 1, not calibrated" state for every user the admin looks at,
// since this key was never written on the admin's own phone.
export function computeCalibrationStatus({ created_at, is_calibrated }) {
    const created = created_at ? new Date(created_at) : new Date();
    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - created.getTime());
    const daysElapsed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const dayNumber = Math.min(daysElapsed + 1, 99);
    const isCalibrated = !!is_calibrated;

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

// Ensures a created_at timestamp exists for this device (first call ever
// creates it), then returns the day-number/phase status exactly like the
// original getCalibrationStatus().
export async function getCalibrationStatus(deviceId) {
    let state = await readState(deviceId);
    if (!state) {
        state = { created_at: new Date().toISOString(), is_calibrated: false };
        await writeState(deviceId, state);
    }
    return computeCalibrationStatus(state);
}

// Call after a successful POST /behavior/calibrate response.
export async function markCalibrated(deviceId) {
    const state = (await readState(deviceId)) || { created_at: new Date().toISOString() };
    const updated = { ...state, is_calibrated: true, calibrated_at: new Date().toISOString() };
    await writeState(deviceId, updated);
    return updated;
}

// Throttles the dashboard's auto-calibrate POST to once per calendar day
// per device -- same behavior as the original's localStorage throttle key.
export async function shouldAttemptCalibrateToday(deviceId) {
    const throttleKey = `phenotyping_calib_attempt_${deviceId}`;
    const today = new Date().toISOString().slice(0, 10);
    const last = await AsyncStorage.getItem(throttleKey);
    if (last === today) return false;
    await AsyncStorage.setItem(throttleKey, today);
    return true;
}
