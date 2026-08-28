// ============================================================
// AccountSetupScreen.js
//
// Shown exactly once, right after registration (App.js routes here when
// user.isNewUser is true -- see AuthContext.js's register()/
// completeOnboarding()). Two things, same order requested: (1) device
// connectivity status for Ring + EEG, (2) the same Calibrate — Calm
// Breathing flow already used on Fusion (CalibrateBreathingCard) --
// reused as-is, not rebuilt, so calibration behaves identically wherever
// it's shown. Skippable at any point ("if not can skip as well") --
// finishing or skipping both just mark onboarding done and continue into
// the app; there's no dead end here.
// ============================================================

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import axios from 'axios';
import { ref, onValue, off } from 'firebase/database';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Card from '../modules/shared/Card';
import Icon, { NAMES } from '../modules/shared/Icon';
import StatusDot from '../modules/shared/StatusDot';
import CalibrateBreathingCard from '../modules/shared/CalibrateBreathingCard';
import { COLORS } from '../modules/physiological/config/theme';
import { API_BASE, DEVICE_ID } from '../modules/physiological/config/config';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';

const DEVICE_POLL_MS = 8000;

export default function AccountSetupScreen({ navigation }) {
  const { user, token, completeOnboarding } = useAuth();
  const userId = user?.userId;

  const [ringConnected, setRingConnected] = useState(false);
  const [eegConnected, setEegConnected] = useState(false);

  useEffect(() => {
    let ringTimer;
    const pollRing = async () => {
      try {
        const res = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
        setRingConnected((res.data?.status || 'offline') === 'online');
      } catch {
        setRingConnected(false);
      }
    };
    pollRing();
    ringTimer = setInterval(pollRing, DEVICE_POLL_MS);

    const eegPointerRef = ref(db, 'psychological/current_session_id');
    const eegHandler = onValue(eegPointerRef, (snap) => setEegConnected(!!snap.val()));

    return () => {
      clearInterval(ringTimer);
      off(eegPointerRef, 'value', eegHandler);
    };
  }, []);

  const finish = () => {
    completeOnboarding();
    navigation.replace('Physiological');
  };

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
            ringOnline={ringConnected}
            eegDb={db}
            onComplete={finish}
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
