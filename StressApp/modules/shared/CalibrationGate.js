import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import axios from 'axios';
import { ref, get, onValue, off, query, orderByChild, limitToLast } from 'firebase/database';
import { useTheme } from '../physiological/config/ThemeContext';
import physiologicalApi from '../physiological/api/client';
import { API_BASE, DEVICE_ID } from '../physiological/config/config';
import { eegClient } from './eegApiClient';

const DEVICE_POLL_MS = 5000;
// The backend no longer pushes a ~1s raw live_raw preview (raw EEG samples
// are never sent to Firebase at all now -- see backend/psychological/
// app.py's /predict route) -- EEG liveness is read from the latest
// per-block derived-output record instead (psychological/{userId}/
// {sessionId}/{window}, written once per BLOCK_SEC=25s block, skipped
// blocks included -- see make_eeg_output_record()). 40s, not 15s: the
// freshness window has to comfortably exceed the real ~25s write cadence
// (plus network/processing jitter) or this would flap "offline" between
// every normal block, unlike the old 1s live_raw cadence that 15s was
// originally sized against.
const EEG_LATEST_WINDOW_FRESH_SEC = 40;

async function fetchSide(fn) {
  try {
    const data = await fn();
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, exists: false, is_stale_soft: false, is_stale_hard: false, age_days: null };
  }
}

export function useCalibrationSummary(userId, token) {
  const [state, setState] = useState({ loading: true, ring: null, eeg: null });

  const refresh = useCallback(async () => {
    if (!userId) {
      setState({ loading: false, ring: null, eeg: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const [ring, eeg] = await Promise.all([
      fetchSide(async () => {
        const res = await physiologicalApi.get(`/baseline/${userId}`);
        return res.data;
      }),
      fetchSide(async () => {
        const res = await eegClient.get('/calibration/status', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        return res.data;
      }),
    ]);
    setState({ loading: false, ring, eeg });
  }, [userId, token]);

  useEffect(() => { refresh(); }, [refresh]);

  const { loading, ring, eeg } = state;
  const known = [ring, eeg].filter((s) => s && s.ok);
  const blocking = !loading && known.length > 0
    && known.every((s) => !s.exists || s.is_stale_hard);
  const softStaleRing = !loading && ring?.ok && ring.exists && ring.is_stale_soft && !ring.is_stale_hard;
  const softStaleEeg = !loading && eeg?.ok && eeg.exists && eeg.is_stale_soft && !eeg.is_stale_hard;

  return { loading, ring, eeg, blocking, softStaleRing, softStaleEeg, refresh };
}

export function useDeviceStatus(userId, db) {
  const [ringOnline, setRingOnline] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [eegLastSeen, setEegLastSeen] = useState(null); // epoch seconds, from the latest block record's timestamp_end
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
        if (!cancelled) setRingOnline((res.data?.status || 'offline') === 'online');
      } catch {
        if (!cancelled) setRingOnline(false);
      }
    };
    poll();
    const id = setInterval(poll, DEVICE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!userId || !db) return undefined;
    const pointerRef = ref(db, 'psychological/current_session_id');
    const handler = onValue(pointerRef, (snap) => setSessionId(snap.val() || null));
    return () => off(pointerRef, 'value', handler);
  }, [userId, db]);

  useEffect(() => {
    if (!userId || !sessionId || !db) {
      setEegLastSeen(null);
      return undefined;
    }
    // Latest per-block derived-output record (see EEG_LATEST_WINDOW_FRESH_SEC's
    // comment above) -- same {window: record} shape AdminEegLiveScreen.js
    // already queries this same way for its own "latest" read.
    const latestRef = query(
      ref(db, `psychological/${userId}/${sessionId}`),
      orderByChild('window'), limitToLast(1),
    );
    const handler = onValue(latestRef, (snap) => {
      const data = snap.val();
      const latest = data ? Object.values(data)[0] : null;
      setEegLastSeen(latest?.timestamp_end ?? null);
    });
    return () => off(latestRef, 'value', handler);
  }, [userId, sessionId, db]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), DEVICE_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const eegOnline = eegLastSeen != null && (now / 1000 - eegLastSeen) <= EEG_LATEST_WINDOW_FRESH_SEC;

  return { ringOnline, eegOnline, eegSessionId: sessionId };
}
export function useSignupAge(userId, db) {
  const [signupAgeDays, setSignupAgeDays] = useState(null);

  useEffect(() => {
    if (!userId || !db) return;
    let cancelled = false;
    get(ref(db, `users/${userId}/created_at`))
      .then((snap) => {
        if (cancelled) return;
        const createdAt = snap.val();
        if (createdAt) {
          setSignupAgeDays((Date.now() - new Date(createdAt).getTime()) / 86400000);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, db]);

  return signupAgeDays;
}
function describeStale(name, side) {
  const age = Math.floor(side.age_days);
  const remaining = Math.max(0, Math.ceil(30 - side.age_days));
  return `${name} calibration is ${age} day${age === 1 ? '' : 's'} old — `
    + `renew within the next ${remaining} day${remaining === 1 ? '' : 's'} for best accuracy.`;
}
export function CalibrationBanner({ userId, token, db, navigation }) {
  const { theme, COLORS } = useTheme();
  const { loading, ring, eeg, softStaleRing, softStaleEeg } = useCalibrationSummary(userId, token);
  const signupAgeDays = useSignupAge(userId, db);
  const [dismissed, setDismissed] = useState(false);

  const neverCalibrated = !loading && ring?.ok && !ring.exists && eeg?.ok && !eeg.exists;
  const newUserOverdue = neverCalibrated && signupAgeDays != null && signupAgeDays >= 7;
  // Separate from age-based staleness (softStaleRing/Hard above) -- this
  // fires even on a fresh-by-age baseline if recent live predictions have
  // drifted meaningfully from the original resting-state mean (see
  // compute_baseline_drift()'s docstring, backend/physiological/
  // firebase_service.py, for exactly what this does and doesn't prove).
  const ringDriftDetected = !loading && ring?.ok && ring.exists && ring.drift?.checked && ring.drift?.drift_detected;
  // Same idea, EEG side -- see compute_eeg_baseline_drift()'s docstring
  // (backend/psychological/firebase_service.py) for why EEG's reference
  // point is its own earliest live samples rather than a stored resting
  // mean the way Ring's is.
  const eegDriftDetected = !loading && eeg?.ok && eeg.exists && eeg.drift?.checked && eeg.drift?.drift_detected;

  if (dismissed || (!softStaleRing && !softStaleEeg && !newUserOverdue && !ringDriftDetected && !eegDriftDetected)) return null;

  return (
    <View style={[bannerStyles.wrap, { backgroundColor: COLORS.warning + '1a', borderColor: COLORS.warning + '55' }]}>
      <View style={{ flex: 1 }}>
        {newUserOverdue ? (
          <Text style={[bannerStyles.text, { color: theme.text }]}>
            It's been a week since you joined — set up your first calibration on the card below.
          </Text>
        ) : (
          <>
            {softStaleRing && (
              <Text style={[bannerStyles.text, { color: theme.text }]}>{describeStale('Ring', ring)}</Text>
            )}
            {softStaleEeg && (
              <Text style={[bannerStyles.text, { color: theme.text, marginTop: softStaleRing ? 4 : 0 }]}>
                {describeStale('EEG', eeg)}
              </Text>
            )}
            {ringDriftDetected && (
              <Text style={[bannerStyles.text, { color: theme.text, marginTop: (softStaleRing || softStaleEeg) ? 4 : 0 }]}>
                Your recent Ring readings look different from your original calibration — new calibration recommended.
              </Text>
            )}
            {eegDriftDetected && (
              <Text style={[bannerStyles.text, { color: theme.text, marginTop: (softStaleRing || softStaleEeg || ringDriftDetected) ? 4 : 0 }]}>
                Your recent EEG readings look different from your original calibration — new calibration recommended.
              </Text>
            )}
          </>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        {navigation && (
          <TouchableOpacity onPress={() => navigation.navigate('Profile')} hitSlop={10}>
            <Text style={[bannerStyles.dismiss, { color: COLORS.warning }]}>Calibrate →</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={10}>
          <Text style={[bannerStyles.dismiss, { color: COLORS.warning }]}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12,
  },
  text: { fontSize: 12, fontWeight: '600', marginRight: 10, lineHeight: 17 },
  dismiss: { fontSize: 12, fontWeight: '800', paddingTop: 1 },
});
