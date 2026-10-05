// ============================================================
// deviceIdentity.js -- resolves the Digital Phenotyping user id
//
// CHANGED (Solution 1): The phenotyping id is now the REAL login
// userId (username, e.g. "alex_zen") shared by all three modalities
// (Physiological Ring, EEG, Digital Phenotyping).
//
// Previously this file generated a random per-device "phn_..." id
// to handle the case where the same account is used on multiple
// devices.  That caused a worse problem: phenotyping data was
// keyed under a random id that didn't match Physiological / EEG
// data (both keyed by userId), so the fusion engine could never
// correlate the three streams.
//
// The real userId comes from AuthContext.js, which writes it into
// native SharedPreferences (PhenotypingIdentity.setUserId) on
// every login / session restore.  We read it back via AsyncStorage
// cache so that:
//  1. PhenotypingScreen can subscribe to Firebase paths like
//     phenotyping/users/{userId} instead of phenotyping/users/{phn_...}
//  2. KeystrokeCollectorService (AccessibilityService) uses the
//     same key (it already reads SharedPreferences directly).
//  3. The backend /behavior/calibrate endpoint receives the real
//     userId, enabling cross-modal analysis.
//
// If the user is not logged in yet, getAuthUserId() returns null
// and callers (PhenotypingScreen, PhenotypingOnboardingScreen)
// gate their Firebase subscriptions on userId != null, so
// nothing is written under a null or anonymous path.
// ============================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { NativeModules, Platform } from 'react-native';

// Key we use to cache the userId locally so we don't need a round-trip to
// native on every re-render (AsyncStorage is the JS-side persistent store;
// native SharedPreferences is the write-side source of truth).
const AUTH_USER_ID_CACHE_KEY = '@phenotyping/authUserId';

const { PhenotypingIdentity } = NativeModules;

let cachedId = null;

/**
 * Returns the current auth user id for phenotyping, or null if the user
 * is not logged in yet.  Reads from:
 *   1. In-memory cache (instant after first successful resolution)
 *   2. AsyncStorage cache (survives JS bundle restarts within the same session)
 *   3. null (user not logged in, AuthContext has not called setUserId yet)
 *
 * AuthContext.js is the sole WRITER; this function is read-only.
 */
export async function getAuthUserId() {
    if (cachedId) return cachedId;
    try {
        const stored = await AsyncStorage.getItem(AUTH_USER_ID_CACHE_KEY);
        if (stored) {
            cachedId = stored;
            return cachedId;
        }
    } catch { }
    return null;
}

/**
 * Called by AuthContext.js after a successful login or session restore to
 * keep our AsyncStorage cache in sync.  This makes getAuthUserId() fast
 * even before the first explicit call in the current JS session.
 */
export async function cacheAuthUserId(userId) {
    if (!userId) return;
    cachedId = userId;
    try {
        await AsyncStorage.setItem(AUTH_USER_ID_CACHE_KEY, userId);
    } catch { }
    // Also mirror into native SharedPreferences so KeystrokeCollectorService
    // picks it up even before AuthContext's own setUserId call has landed.
    if (Platform.OS === 'android' && PhenotypingIdentity?.setUserId) {
        PhenotypingIdentity.setUserId(userId);
    }
}

/**
 * Called on logout to flush the local cache so that the next open of
 * PhenotypingScreen sees userId=null and does not subscribe to wrong paths.
 */
export async function clearCachedAuthUserId() {
    cachedId = null;
    try {
        await AsyncStorage.removeItem(AUTH_USER_ID_CACHE_KEY);
    } catch { }
}

// React hook (drop-in replacement for usePhenotypingDeviceId).
// Resolves to null until the user is logged in; PhenotypingScreen gates all
// its Firebase subscriptions on deviceId != null, so null is safe and correct.
// Retries every 500ms until a userId is found (handles cold-start edge cases
// where AuthContext.js may not have finished restoring the session before the
// first render — previously the hook would stay null forever in that case).
export function usePhenotypingDeviceId() {
    const [userId, setUserId] = useState(cachedId);
    useEffect(() => {
        let cancelled = false;
        let retryTimeout;

        const resolve = async () => {
            const id = await getAuthUserId();
            if (cancelled) return;
            if (id) {
                setUserId(id);
            } else {
                // No userId yet — auth restore may still be in progress. Retry.
                retryTimeout = setTimeout(resolve, 500);
            }
        };

        resolve();
        return () => {
            cancelled = true;
            if (retryTimeout) clearTimeout(retryTimeout);
        };
    }, []);
    return userId;
}

// Legacy alias kept for any other module that imported getOrCreateDeviceId.
// Returns the real auth userId (or null) -- does NOT create a random fallback.
export async function getOrCreateDeviceId() {
    return getAuthUserId();
}
