// ============================================================
// CalibrationGate.js
//
// Combined Ring + EEG calibration-freshness check, per-plan (see
// C:\Users\weha1\.claude\plans\zany-humming-scone.md, section 1):
//   - Neither modality ever calibrated (or both now hard-stale, >30 days)
//     -> blocking prompt, reachable at any time, not skippable.
//   - At least one modality fresh or only soft-stale (<=30 days) -> not
//     blocking; a dismissible per-session banner nudges renewal if either
//     side is past the 7-day soft mark.
//   - A service being unreachable (Render cold start, offline) is treated
//     as "unknown", never as "not calibrated" -- so a network hiccup alone
//     can never lock a user out. Only a definite response (calibrated:false
//     or is_stale_hard:true) counts toward blocking.
//
// Ring's own manual calibration flow already exists
// (modules/physiological/screens/CalibrationScreen.js, POST
// /calibrate/start + poll /calibrate/status). EEG has no equivalent manual
// screen -- its calibration is server-driven by mqtt_bridge.py the moment
// a live EEG session starts (see backend/psychological/app.py's /calibrate,
// called from the bridge, not from EegSessionScreen.js directly) -- so the
// EEG action here is "open the EEG tab", not a calibration button of its
// own.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import ScreenBackground from './ScreenBackground';
import Card from './Card';
import Button from './Button';
import Icon, { NAMES } from './Icon';
import { useTheme } from '../physiological/config/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import physiologicalApi from '../physiological/api/client';

// EEG's Flask API has no existing frontend client (EegSessionScreen.js only
// ever reads Firebase directly) -- same Render-hosted, cold-start-tolerant
// pattern already used for relaxation_guide/physiological (see
// modules/relaxation_guide/src/api/apiService.js), just for this one route.
const EEG_API_BASE = 'https://mindpulse-eeg.onrender.com';
const eegClient = axios.create({ baseURL: EEG_API_BASE, timeout: 45000 });

async function fetchSide(fn) {
  try {
    const data = await fn();
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, exists: false, is_stale_soft: false, is_stale_hard: false, age_days: null };
  }
}

// Shared by CalibrationGate (blocking decision) and CalibrationBanner's
// renewal nudge (non-blocking, shown on the Overview/Fusion landing tab) --
// one fetch, two consumers, so the two never disagree about what "stale"
// means.
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

// Small dismissible nudge shown on the Overview (Fusion) landing tab --
// never blocking, per-session dismissal only (re-appears next app open,
// since this isn't meant to be permanently silenceable the way a real
// "don't ask again" would be).
export function CalibrationBanner({ userId, token }) {
  const { theme, COLORS } = useTheme();
  const { softStaleRing, softStaleEeg } = useCalibrationSummary(userId, token);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || (!softStaleRing && !softStaleEeg)) return null;

  const which = softStaleRing && softStaleEeg ? 'Ring and EEG calibration are'
    : softStaleRing ? 'Ring calibration is'
    : 'EEG calibration is';

  return (
    <View style={[bannerStyles.wrap, { backgroundColor: COLORS.warning + '1a', borderColor: COLORS.warning + '55' }]}>
      <Text style={[bannerStyles.text, { color: theme.text }]}>
        {which} over a week old — renew when convenient.
      </Text>
      <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={10}>
        <Text style={[bannerStyles.dismiss, { color: COLORS.warning }]}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12,
  },
  text: { flex: 1, fontSize: 12, fontWeight: '600', marginRight: 10 },
  dismiss: { fontSize: 12, fontWeight: '800' },
});

// The blocking full-screen prompt itself -- registered as a Stack.Screen in
// App.js and chosen as initialRouteName when useCalibrationSummary(...)
// .blocking is true (see App.js's RootNavigator).
export default function CalibrationGate({ navigation }) {
  const { theme, COLORS } = useTheme();
  const { user, token } = useAuth();
  const userId = user?.userId;
  const { loading, ring, eeg, blocking, refresh } = useCalibrationSummary(userId, token);

  // Re-check whenever this screen regains focus (e.g. returning from
  // CalibrationScreen after finishing a Ring calibration, or from the EEG
  // tab after a session auto-calibrated) -- once no longer blocking, move
  // on to the app automatically rather than making the user tap a button.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  useEffect(() => {
    if (!loading && !blocking) {
      navigation.replace('Physiological');
    }
  }, [loading, blocking, navigation]);

  if (loading || !blocking) {
    return (
      <ScreenBackground>
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.brand} />
        </View>
      </ScreenBackground>
    );
  }

  const everCalibrated = (ring?.ok && ring.exists) || (eeg?.ok && eeg.exists);

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Text style={[styles.title, { color: theme.text }]}>
          {everCalibrated ? 'Time to Renew Calibration' : 'Let\u2019s Calibrate First'}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          {everCalibrated
            ? 'Your last calibration is over a month old, so predictions may drift from your real baseline. Renew with either Ring or EEG to continue.'
            : 'Before your first session, we need a personal resting baseline from either your Ring or your EEG headset — whichever you have on hand.'}
        </Text>

        <Card elevated>
          <View style={styles.cardHeaderRow}>
            <Icon name={NAMES.my} size={18} color={COLORS.brand} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>Ring</Text>
          </View>
          <Text style={[styles.cardSub, { color: theme.textMuted }]}>
            {ring?.ok && ring.exists
              ? `Last calibrated ${Math.floor(ring.age_days)} days ago.`
              : 'No baseline on file yet.'}
          </Text>
          <Button label="Calibrate Ring →" onPress={() => navigation.navigate('Calibration')} variant="primary" />
        </Card>

        <Card elevated>
          <View style={styles.cardHeaderRow}>
            <Icon name={NAMES.eeg} size={18} color={COLORS.warning} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>EEG</Text>
          </View>
          <Text style={[styles.cardSub, { color: theme.textMuted }]}>
            {eeg?.ok && eeg.exists
              ? `Last calibrated ${Math.floor(eeg.age_days)} days ago.`
              : 'Calibrates automatically once an EEG session starts.'}
          </Text>
          <Button label="Open EEG →" onPress={() => navigation.navigate('EegSummary')} variant="secondary" />
        </Card>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 24 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  cardSub: { fontSize: 12, marginTop: 6, marginBottom: 14, lineHeight: 18 },
});
