// ============================================================
// CalibrationScreen.js
// Reachable from ProfileScreen's "Calibration & Baseline" card -- the ONE
// place a returning user can recalibrate after onboarding. Used to only
// recalibrate the Ring (physiological) baseline via its own hand-rolled
// capture stepper, with no way to touch EEG's baseline/threshold at all
// from here. Now reuses the SAME CalibrateBreathingCard onboarding already
// uses (AccountSetupScreen.js/FusionSessionScreen.js), UNCHANGED, so a
// recalibration here behaves identically and covers BOTH Ring + EEG
// baselines together -- its own breathing animation/capture-trigger/polling
// logic is not touched here, just reused as a prop-driven component, plus a
// link into the same ThresholdCalibration (EegThresholdTaskScreen.js)
// onboarding already uses for the personal high-load/stress threshold task.
// Both backends already persist whatever gets calibrated here per-user
// (backend/physiological/firebase_service.py's baselines/{user_id} +
// personal_thresholds/{user_id}; backend/psychological/firebase_service.py's
// {user_id}/calibration_profile) and reuse it on every future session/
// prediction until this screen is used again -- see save_baseline()/
// load_baseline(), save_personal_stress_threshold()/
// load_personal_stress_threshold(), and load_user_calibration_profile()'s
// own "skip-ahead" docstring.
// ============================================================
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import CalibrateBreathingCard from '../../shared/CalibrateBreathingCard';
import { useCalibrationSummary } from '../../shared/CalibrationGate';
import { useTheme } from '../config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { db } from '../../../firebase';

function StatusLine({ label, status, personalizedText, COLORS }) {
  if (!status?.ok) return null;
  if (!status.exists) {
    return (
      <Text style={[styles.statusLine, { color: COLORS.warningDark }]}>
        {label}: no baseline calibrated yet
      </Text>
    );
  }
  const ageText = `${Math.floor(status.age_days ?? 0)} days old`;
  if (status.is_stale_hard) {
    return (
      <Text style={[styles.statusLine, { color: COLORS.warningDark }]}>
        {label}: ⚠ needs renewing ({ageText})
      </Text>
    );
  }
  return (
    <Text style={[styles.statusLine, { color: status.is_stale_soft ? COLORS.warningDark : COLORS.normalDark }]}>
      {label}: ✓ active ({ageText}){personalizedText ? ` — ${personalizedText}` : ''}
    </Text>
  );
}

export default function CalibrationScreen({ navigation }) {
  const { theme, COLORS } = useTheme();
  const { user, token } = useAuth();
  const userId = user?.userId;
  // Same hook AccountSetupScreen/FusionSessionScreen/CalibrateBreathingCard
  // already use -- ring from physiological's GET /baseline/{userId},
  // eeg from psychological's GET /calibration/status. refresh() re-fetches
  // both, called once CalibrateBreathingCard reports a completed capture.
  const { ring, eeg, refresh } = useCalibrationSummary(userId, token);

  const text = theme.text;
  const muted = theme.textMuted;

  const ringThresholdText = ring?.personal_stress_threshold != null
    ? `stress threshold personalized at ${Math.round(ring.personal_stress_threshold * 100)}%`
    : null;
  const eegThresholdText = eeg?.personal_high_load_p != null
    ? `high-load threshold personalized at ${Math.round(eeg.personal_high_load_p * 100)}%`
    : null;

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: text }]}>Baseline Calibration</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            Establishes your personal resting baseline for both the Ring and EEG headband --
            comparing your own relaxed state against your own readings, not a population average.
            Whatever gets calibrated here stays in effect for every future session until you
            recalibrate again.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: text, marginBottom: 8 }]}>Current Status</Text>
          <StatusLine label="Ring" status={ring} personalizedText={ringThresholdText} COLORS={COLORS} />
          <StatusLine label="EEG" status={eeg} personalizedText={eegThresholdText} COLORS={COLORS} />
        </View>

        {/* CalibrateBreathingCard, unmodified -- same component, same
            breathing animation/capture-and-poll mechanism as onboarding
            (AccountSetupScreen.js) and the Fusion dashboard
            (FusionSessionScreen.js). Not rebuilt here. */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: text, marginBottom: 4 }]}>Recalibrate Baseline</Text>
          <CalibrateBreathingCard userId={userId} token={token} eegDb={db} onComplete={refresh} />
        </View>

        <TouchableOpacity
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => navigation.navigate('ThresholdCalibration')}
          activeOpacity={0.85}
        >
          <Text style={[styles.cardTitle, { color: text }]}>Recalibrate Personal Threshold</Text>
          <Text style={[styles.cardSub, { color: muted, marginTop: 6 }]}>
            Run the short mental-load task again to refresh your high-load (EEG) and stress (Ring)
            thresholds against your current physiology.
          </Text>
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container:    { padding: 20, paddingTop: 16 },
  header:       { marginBottom: 16 },
  title:        { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  subtitle:     { fontSize: 13, marginTop: 4, lineHeight: 19 },
  card:         { padding: 20, borderRadius: 22, borderWidth: 1, marginBottom: 16 },
  cardTitle:    { fontSize: 16, fontWeight: '800' },
  cardSub:      { fontSize: 12, lineHeight: 18 },
  statusLine:   { fontSize: 13, fontWeight: '700', lineHeight: 19 },
});
