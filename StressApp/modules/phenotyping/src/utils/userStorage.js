import { db } from '../firebase';
import { ref, set } from 'firebase/database';
import { Preferences } from '@capacitor/preferences';

const USER_STORAGE_KEY = 'phenocare_user_profile';

/**
 * Generates a cryptographically random UUID.
 * This is the REAL unique device identifier stored in Firebase.
 * It has nothing to do with the user's display name.
 * Collision probability is astronomically low (1 in 2^122).
 */
function generateDeviceUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        // Modern browsers: crypto.randomUUID() — truly random, no collisions
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Returns stored user profile from localStorage.
 * If no profile exists (new user / first install), returns null.
 */
export function getUserProfile() {
    try {
        const stored = localStorage.getItem(USER_STORAGE_KEY);
        if (stored) return JSON.parse(stored);
    } catch (e) {
        console.error('[UserStorage] Error reading profile:', e);
    }
    return null;
}

/**
 * Returns stored profile or a safe default for UI rendering.
 * Never generates a new ID here — use saveUserProfile() for that.
 */
export function getUserProfileOrDefault() {
    return getUserProfile() || {
        name: 'Participant',
        userId: null,
        created_at: null,
        is_calibrated: false,
        survey_answers: {},
        study_id: 'PHN-2024-08'
    };
}

/**
 * Checks if the user has completed onboarding (has a saved profile with a real userId).
 */
export function isUserRegistered() {
    const profile = getUserProfile();
    return !!(profile && profile.userId && profile.name && profile.name !== 'Participant');
}

/**
 * REGISTRATION: Called once during BaselineSurvey completion.
 *
 * How unique IDs work:
 * - userId = crypto.randomUUID() — truly unique per device registration.
 * - display_name = what the user typed (e.g., "aaa", "bbb", "Chathurika").
 * - Two users can type the SAME name — they will still have DIFFERENT UUIDs.
 * - Firebase path: phenotyping/users/{uuid} — no collision possible.
 *
 * @param {Object} profileData - { name, created_at, is_calibrated, survey_answers }
 */
export async function saveUserProfile(profileData) {
    try {
        const existing = getUserProfile();

        // If already registered, keep the SAME userId — never regenerate on re-save
        const userId = existing?.userId || generateDeviceUUID();

        const profile = {
            name: profileData.name || existing?.name || 'Participant',
            userId,
            display_name: profileData.name || 'Participant',  // what user typed
            created_at: existing?.created_at || profileData.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_calibrated: profileData.is_calibrated ?? existing?.is_calibrated ?? false,
            survey_answers: profileData.survey_answers || existing?.survey_answers || {},
            study_id: 'PHN-2024-08'
        };

        // 1. Persist to localStorage (survives browser restarts)
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));

        // 1b. Persist to Capacitor Preferences (accessible by Android native code)
        try {
            await Preferences.set({ key: 'user_id', value: userId });
        } catch (err) {
            console.warn('[UserStorage] Could not save to Capacitor preferences:', err);
        }

        // 2. Sync to Firebase: each user has their own isolated path by UUID
        //    e.g., phenotyping/users/3f2504e0-4f89-11d3-9a0c-0305e82c3301
        const userRef = ref(db, `phenotyping/users/${userId}`);
        await set(userRef, {
            display_name: profile.display_name,
            user_id: userId,
            created_at: profile.created_at,
            is_calibrated: profile.is_calibrated,
            survey_answers: profile.survey_answers,
            study_id: profile.study_id
        });

        console.log(`[UserStorage] Registered: "${profile.display_name}" → UUID: ${userId}`);
        return profile;
    } catch (e) {
        console.error('[UserStorage] Error saving profile:', e);
        throw e;
    }
}

/**
 * @deprecated Use getUserProfile().userId directly.
 * Kept for backward compatibility with any code still calling generateUserId().
 */
export function generateUserId(name) {
    // This should never be called for new registrations.
    // New users always get a UUID from saveUserProfile().
    console.warn('[UserStorage] generateUserId() is deprecated. Use saveUserProfile() instead.');
    return generateDeviceUUID();
}

/**
 * Calculates current calibration day and status.
 * Returns: { dayNumber, phase, progressPct, isCalibrated, title, displayDays }
 */
export function getCalibrationStatus(userProfile = null) {
    const profile = userProfile || getUserProfileOrDefault();
    const created = profile.created_at ? new Date(profile.created_at) : new Date();
    const now = new Date();

    const diffMs = Math.max(0, now.getTime() - created.getTime());
    const daysElapsed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const dayNumber = Math.min(daysElapsed + 1, 99);

    const isCalibrated = profile.is_calibrated || dayNumber >= 8;

    if (!isCalibrated && dayNumber <= 7) {
        return {
            dayNumber,
            displayDays: `Day ${dayNumber} of 7`,
            phase: 'calibration',
            progressPct: Math.round((dayNumber / 7) * 100),
            title: dayNumber <= 3 ? 'Learning your rhythm' : dayNumber <= 5 ? 'Building your fingerprint' : 'Calibrating baseline',
            isCalibrated: false
        };
    }

    return {
        dayNumber,
        displayDays: `Day ${dayNumber}+`,
        phase: 'active',
        progressPct: 100,
        title: 'Pre-stress predictions active',
        isCalibrated: true
    };
}
