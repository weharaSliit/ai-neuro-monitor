// ============================================================
// CalibrationGate.js
//
// Combined Ring + EEG calibration-freshness check, shared by:
//   - CalibrateBreathingCard.js's day-bars (via useCalibrationSummary)
//   - CalibrationBanner, the dismissible non-blocking renewal nudge shown
//     on the Fusion landing tab
//
// There used to also be a blocking full-screen gate here (a forced
// "Calibrate Ring" / "Open EEG" screen shown before Fusion even loaded,
// pointing at old standalone calibration screens) -- removed, since
// calibration is now inline on Fusion itself: CalibrateBreathingCard is
// always visible there and runs the real on-demand Ring+EEG capture
// directly, so a separate forced gate before reaching Fusion just
// duplicated (and, since it went stale, contradicted) that. App.js now
// routes straight to 'Physiological' after login/session-restore.
//
// A service being unreachable (Render cold start, offline) is treated as
// "unknown", not "not calibrated" -- see useCalibrationSummary below.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ref, get } from 'firebase/database';
import { useTheme } from '../physiological/config/ThemeContext';
import physiologicalApi from '../physiological/api/client';
import { eegClient } from './eegApiClient';

async function fetchSide(fn) {
  try {
    const data = await fn();
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, exists: false, is_stale_soft: false, is_stale_hard: false, age_days: null };
  }
}

// Shared by CalibrationBanner's renewal nudge and CalibrateBreathingCard's
// day-bars (non-blocking, shown on the Overview/Fusion landing tab) -- one
// fetch, two consumers, so they never disagree about what "stale" means.
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
  // Both sides unreachable -> "unknown", never blocks by itself (see file
  // header). Otherwise: blocking only if every side we actually heard back
  // from is either never-calibrated or past the hard 30-day cutoff.
  const blocking = !loading && known.length > 0
    && known.every((s) => !s.exists || s.is_stale_hard);
  const softStaleRing = !loading && ring?.ok && ring.exists && ring.is_stale_soft && !ring.is_stale_hard;
  const softStaleEeg = !loading && eeg?.ok && eeg.exists && eeg.is_stale_soft && !eeg.is_stale_hard;

  return { loading, ring, eeg, blocking, softStaleRing, softStaleEeg, refresh };
}

// Days since account creation -- the fallback "clock" for a modality that
// has never been calibrated at all, so a brand-new user still sees a real
// filling countdown (and the same 7-day "recommended" nudge) instead of
// just a blank "no baseline on file" message. `db` is passed in by the
// caller (Fusion already has one, via its own firebase.js import) rather
// than this file importing its own -- keeps this module free of a second
// Firebase app-init path.
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

// Concrete age + days-remaining-until-the-30-day-hard-cutoff, instead of
// the old vague "over a week old" -- age_days/is_stale_soft/is_stale_hard
// all already come from the shared /baseline and /calibration/status
// responses (see useCalibrationSummary above), so this is real data, not
// an estimate.
function describeStale(name, side) {
  const age = Math.floor(side.age_days);
  const remaining = Math.max(0, Math.ceil(30 - side.age_days));
  return `${name} calibration is ${age} day${age === 1 ? '' : 's'} old — `
    + `renew within the next ${remaining} day${remaining === 1 ? '' : 's'} for best accuracy.`;
}

// Small dismissible nudge shown on the Overview (Fusion) landing tab --
// never blocking, per-session dismissal only (re-appears next app open,
// since this isn't meant to be permanently silenceable the way a real
// "don't ask again" would be). Ring and EEG are tracked and shown
// separately -- there's no single merged "your baseline" anywhere in this
// backend (each modality calibrates and stores its own baseline
// independently; the fusion engine's own session-level average is a
// different, smaller thing -- see the "Session start" line on the Ring
// chart), so this banner is honest about that rather than implying a
// combined number that doesn't exist.
export function CalibrationBanner({ userId, token, db }) {
  const { theme, COLORS } = useTheme();
  const { loading, ring, eeg, softStaleRing, softStaleEeg } = useCalibrationSummary(userId, token);
  const signupAgeDays = useSignupAge(userId, db);
  const [dismissed, setDismissed] = useState(false);

  // Neither side has ever been calibrated at all -- once a week has passed
  // since signup, nudge toward the Calibrate card already on this same
  // screen (not a separate flow) -- same skip/dismiss behavior as the
  // renewal nudges below, per "if not can skip as well."
  const neverCalibrated = !loading && ring?.ok && !ring.exists && eeg?.ok && !eeg.exists;
  const newUserOverdue = neverCalibrated && signupAgeDays != null && signupAgeDays >= 7;

  if (dismissed || (!softStaleRing && !softStaleEeg && !newUserOverdue)) return null;

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
          </>
        )}
      </View>
      <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={10}>
        <Text style={[bannerStyles.dismiss, { color: COLORS.warning }]}>Dismiss</Text>
      </TouchableOpacity>
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
