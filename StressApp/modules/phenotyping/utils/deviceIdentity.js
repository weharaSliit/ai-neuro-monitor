// ============================================================
// deviceIdentity.js -- generates and persists a per-device tracking id
// for the Digital Phenotyping module, generated automatically the first
// time anyone opens Digital Phenotyping on a given device.
//
// StressApp's real login (context/AuthContext.js) deliberately uses the
// SAME credentials across every device a person owns -- there's no
// per-device login, and the main app can't support one. But Digital
// Phenotyping's behavioral biometrics (typing rhythm, scroll velocity,
// tilt angle) are inherently device-specific: the same person typing on
// their phone vs. their tablet produces different baselines, so keying
// phenotyping data by the shared login id would merge two distinct
// behavioral profiles into one and corrupt both the 7-day calibration
// and the OC-SVM anomaly baseline.
//
// This id is intentionally NOT derived from the login id at all -- it's
// random, created once per device/app-install (lazily, on first access
// to Digital Phenotyping), persisted locally, and reused forever after.
// Logging out, logging back in, or even logging in as a different
// account on the same device does not change it.
// ============================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { NativeModules, Platform } from 'react-native';

const DEVICE_ID_KEY = '@phenotyping/deviceId';

function randomDeviceId() {
    // Not cryptographically secure -- doesn't need to be, it only has to be
    // unique per device. Same tier of rigor as AuthContext.js's own
    // mintSessionId().
    return 'phn_xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
        Math.floor(Math.random() * 16).toString(16)
    );
}

let cachedId = null;
let pending = null;

// Resolves this device's Digital Phenotyping tracking id, creating and
// persisting one on the very first call ever made on this device. Every
// call after that (this session, or a future one) returns the same value.
export async function getOrCreateDeviceId() {
    if (cachedId) return cachedId;
    if (!pending) {
        pending = (async () => {
            let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                id = randomDeviceId();
                await AsyncStorage.setItem(DEVICE_ID_KEY, id);
            }
            cachedId = id;

            // Mirror into native SharedPreferences so KeystrokeCollectorService's
            // background AccessibilityService -- which runs independently of
            // whether any JS screen is open -- uploads windows under this same
            // id. See PhenotypingIdentityModule.setUserId() and
            // KeystrokeCollectorService.getUserId().
            const { PhenotypingIdentity } = NativeModules;
            if (Platform.OS === 'android' && PhenotypingIdentity) {
                PhenotypingIdentity.setUserId(id);
            }
            return id;
        })();
    }
    return pending;
}

// React hook wrapper -- resolves to null until the id has loaded (near-
// instant after the very first call anywhere in the app, since it's then
// cached in memory for the rest of the app's lifetime).
export function usePhenotypingDeviceId() {
    const [deviceId, setDeviceId] = useState(cachedId);
    useEffect(() => {
        let cancelled = false;
        getOrCreateDeviceId().then((id) => { if (!cancelled) setDeviceId(id); });
        return () => { cancelled = true; };
    }, []);
    return deviceId;
}
