import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import CalibrateBreathingCard from '../../shared/CalibrateBreathingCard';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { db } from '../../../firebase';
import api from '../api/client';

export default function CalibrationScreen() {
  const { theme, COLORS } = useTheme();
  const { user, token } = useAuth();
  const userId = user?.userId;

  const [baseline, setBaseline] = useState(null);

  const card   = theme.card;
  const border = theme.border;
  const text   = theme.text;
  const muted  = theme.textMuted;

  const loadBaseline = async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/baseline/${userId}`);
      setBaseline(res.data);
    } catch (e) {
      console.log('Baseline load error:', e.message);
    }
  };

  useFocusEffect(useCallback(() => {
    loadBaseline();
  }, [userId]));

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: text }]}>Baseline Calibration</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            Establishes your personal resting baseline — comparing your unique physiology against your own relaxed state rather than a generic average.
          </Text>
        </View>

        {/* Current status */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: text }]}>Current Status</Text>
          {baseline?.exists ? (
            <View style={[styles.statusBanner, { backgroundColor: baseline.is_stale_soft ? COLORS.warningSoft : COLORS.normalSoft }]}>
              <Text style={[styles.statusLine, { color: baseline.is_stale_soft ? COLORS.warningDark : COLORS.normalDark }]}>
                {baseline.is_stale_hard
                  ? '⚠ Your baseline needs renewing (>30 days old)'
                  : baseline.is_stale_soft
                    ? `✓ Active — ${Math.floor(baseline.age_days ?? 0)} days old (recalibrate when convenient)`
                    : '✓ Baseline is active, accurate, and up to date'}
              </Text>
            </View>
          ) : (
            <View style={[styles.statusBanner, { backgroundColor: COLORS.warningSoft }]}>
              <Text style={[styles.statusLine, { color: COLORS.warningDark }]}>No baseline calibrated yet</Text>
            </View>
          )}
        </View>

        {/* CalibrateBreathingCard, unmodified -- same component, same
            breathing animation/capture-and-poll mechanism as onboarding
            (AccountSetupScreen.js) and the Fusion dashboard
            (FusionSessionScreen.js). Not rebuilt here. */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: text, marginBottom: 4 }]}>Recalibrate Baseline</Text>
          <CalibrateBreathingCard userId={userId} token={token} eegDb={db} onComplete={loadBaseline} />
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container:       { padding: 20, paddingTop: 16 },
  header:          { marginBottom: 16 },
  title:           { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  subtitle:        { fontSize: 13, marginTop: 4, lineHeight: 19 },
  card:            { padding: 20, borderRadius: 22, borderWidth: 1, marginBottom: 16 },
  cardTitle:       { fontSize: 16, fontWeight: '800' },
  statusBanner:    { padding: 12, borderRadius: 14, marginTop: 10 },
  statusLine:      { fontSize: 13, fontWeight: '800', lineHeight: 18 },
});
