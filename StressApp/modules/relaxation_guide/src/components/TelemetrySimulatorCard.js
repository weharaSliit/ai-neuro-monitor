import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

export const TelemetrySimulatorCard = ({
  currentMode,
  onModeChange,
  isOverride,
  isAlert,
  message
}) => {
  const { theme } = useContext(ThemeContext);

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
      <Text style={[styles.title, { color: theme.accent }]}>Multimodal Data Fusion Engine</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        "Live" reads real fused_stress_label & stress_probability from Firebase. Other modes override with synthetic test data.
      </Text>

      {/* Simulator Mode Selector Buttons */}
      <Text style={[styles.modeHeader, { color: theme.textSecondary }]}>Test Trigger Mode:</Text>
      <View style={styles.btnGrid}>
        <TouchableOpacity
          style={[styles.modeBtn, currentMode === 'normal' && { backgroundColor: theme.success }]}
          onPress={() => onModeChange('normal')}
        >
          <Text style={styles.modeBtnText}>Live (Real Fusion Data)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeBtn, currentMode === 'stress' && { backgroundColor: theme.danger }]}
          onPress={() => onModeChange('stress')}
        >
          <Text style={styles.modeBtnText}>Stress (P=0.88)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeBtn, currentMode === 'safety_override_test' && { backgroundColor: '#7C3AED' }]}
          onPress={() => onModeChange('safety_override_test')}
        >
          <Text style={styles.modeBtnText}>Safety Override (P=0.82)</Text>
        </TouchableOpacity>
      </View>

      {/* Live Status Message & Overrides */}
      {isOverride && (
        <View style={styles.overrideBanner}>
          <Text style={styles.overrideTxt}>
            🚨 SAFETY OVERRIDE ACTIVE: Multimodal stress probability exceeds 0.75! Forcing Stress State for immediate intervention.
          </Text>
        </View>
      )}

      {isAlert && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertTxt}>⚠️ SYSTEM ALERT: Telemetry signal loss {'>'} 10 seconds!</Text>
        </View>
      )}

      {message ? <Text style={[styles.msgText, { color: theme.textMuted }]}>{message}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginVertical: 10,
    borderWidth: 1
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2
  },
  subtitle: {
    fontSize: 11,
    marginBottom: 10
  },
  modeHeader: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6
  },
  btnGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8
  },
  modeBtn: {
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    flex: 1,
    minWidth: '45%',
    alignItems: 'center'
  },
  modeBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11
  },
  overrideBanner: {
    backgroundColor: '#450A0A',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
    marginVertical: 4
  },
  overrideTxt: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700'
  },
  alertBanner: {
    backgroundColor: '#451A03',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F59E0B',
    marginVertical: 4
  },
  alertTxt: {
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '700'
  },
  msgText: {
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 4
  }
});
