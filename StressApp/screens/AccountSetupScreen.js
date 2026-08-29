// ============================================================
// AccountSetupScreen.js
//
// Shown exactly once, right after registration (App.js routes here when
// user.isNewUser is true -- see AuthContext.js's register()/
// completeOnboarding()). Three things, in order: (1) device connectivity
// status for Ring + EEG, (2) the same Calibrate — Calm Breathing flow
// already used on Fusion (CalibrateBreathingCard) -- reused as-is, not
// rebuilt, so baseline calibration behaves identically wherever it's
// shown, (3) on baseline success, navigates into ThresholdCalibration
// (EegThresholdTaskScreen.js) for the personal high-load/stress threshold
// task -- that screen (not this one) is what actually calls
// completeOnboarding(). Skippable at any point ("if not can skip as
// well") -- finishing or skipping either step just marks onboarding done
// and continues into the app; there's no dead end here.
// ============================================================

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Card from '../modules/shared/Card';
import Icon, { NAMES } from '../modules/shared/Icon';
import StatusDot from '../modules/shared/StatusDot';
import CalibrateBreathingCard from '../modules/shared/CalibrateBreathingCard';
import { useDeviceStatus } from '../modules/shared/CalibrationGate';
import { COLORS } from '../modules/physiological/config/theme';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';

export default function AccountSetupScreen({ navigation }) {
  const { user, token, completeOnboarding } = useAuth();
  const userId = user?.userId;

  // Real connectivity + live-data-flow check (Ring: recent MQTT heartbeat;
  // EEG: recent live_raw push) -- see CalibrationGate.js::useDeviceStatus()
  // for why the EEG side used to read "connected" for any logged-in user
  // regardless of whether a headset was even nearby.
  const { ringOnline: ringConnected, eegOnline: eegConnected } = useDeviceStatus(userId, db);

  // "Skip for now" (below) still goes straight to the dashboard --
  // skipping baseline calibration makes the threshold task meaningless
  // too (it needs a resting baseline to compare against), so there's
  // nothing useful to navigate into. Only a completed baseline
  // (CalibrateBreathingCard's onComplete) proceeds to ThresholdCalibration.
  const finish = () => {
    completeOnboarding();
    navigation.replace('Physiological');
  };

  const proceedToThreshold = () => navigation.navigate('ThresholdCalibration');

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: COLORS.light.text }]}>Welcome, {user?.name || userId}</Text>
        <Text style={[styles.subtitle, { color: COLORS.light.textMuted }]}>
          Let's check your devices, then set your personal baseline.
        </Text>

        <Card elevated style={styles.deviceCard}>
          <Text style={[styles.cardTitle, { color: COLORS.light.text }]}>Device Status</Text>
          <View style={styles.deviceRow}>
            <View style={styles.deviceRowLeft}>
              <Icon name={NAMES.my} size={18} color={COLORS.brand} />
              <Text style={[styles.deviceLabel, { color: COLORS.light.text }]}>Smart Ring</Text>
            </View>
            <View style={styles.deviceStatusPill}>
              <StatusDot color={ringConnected ? COLORS.normal : COLORS.light.border} active={ringConnected} size={8} />
              <Text style={[styles.deviceStatusText, { color: ringConnected ? COLORS.normalDark : COLORS.light.textMuted }]}>
                {ringConnected ? 'Connected' : 'Not connected'}
              </Text>
            </View>
          </View>
          <View style={styles.deviceRow}>
            <View style={styles.deviceRowLeft}>
              <Icon name={NAMES.eeg} size={18} color={COLORS.warning} />
              <Text style={[styles.deviceLabel, { color: COLORS.light.text }]}>EEG Headband</Text>
            </View>
            <View style={styles.deviceStatusPill}>
              <StatusDot color={eegConnected ? COLORS.normal : COLORS.light.border} active={eegConnected} size={8} />
              <Text style={[styles.deviceStatusText, { color: eegConnected ? COLORS.normalDark : COLORS.light.textMuted }]}>
                {eegConnected ? 'Connected' : 'Not connected'}
              </Text>
            </View>
          </View>
          {!ringConnected && !eegConnected && (
            <Text style={[styles.deviceHint, { color: COLORS.light.textMuted }]}>
              Turn on and wear at least one device to calibrate — you can still skip this for now.
            </Text>
          )}
        </Card>

        <Card style={styles.calibrateCard} accentColor={COLORS.brand}>
          <Text style={[styles.cardTitle, { color: COLORS.light.text }]}>Calibrate — Calm Breathing</Text>
          <CalibrateBreathingCard
            userId={userId}
            token={token}
            eegDb={db}
            onComplete={proceedToThreshold}
          />
        </Card>

        <TouchableOpacity onPress={finish} activeOpacity={0.7} style={styles.skipRow}>
          <Text style={[styles.skipText, { color: COLORS.light.textMuted }]}>Skip for now →</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 18,
  },
  deviceCard: {
    padding: 18,
    borderRadius: 22,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  deviceRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deviceLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  deviceStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  deviceHint: {
    fontSize: 11,
    marginTop: 8,
    lineHeight: 15,
  },
  calibrateCard: {
    padding: 18,
    borderRadius: 24,
    marginBottom: 8,
  },
  skipRow: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
