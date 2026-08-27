import React, { useContext } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';

export const MemberTelemetryCard = ({
  stressState,
  stressProbability,
  isCalibrated = true,
  hasLivePacket: propHasLive
}) => {
  const { theme } = useContext(ThemeContext);
  const appContext = useContext(AppContext);

  const isLive = typeof propHasLive === 'boolean' ? propHasLive : (appContext?.hasLivePacket ?? false);
  const probVal = typeof stressProbability === 'number' ? stressProbability : appContext?.stressProbability;

  const getLabelColor = (label, prob) => {
    if (!isCalibrated || !isLive) return theme.warning;
    const l = (label || '').toLowerCase();
    if (l === 'stress' || l === 'high_stress' || l === 'high' || l === 'acute' || (typeof prob === 'number' && prob >= 0.60)) return theme.danger;
    return theme.success;
  };

  const probPct = (isCalibrated && isLive && typeof probVal === 'number') ? (probVal * 100).toFixed(0) + '%' : '--';
  const displayLabel = (isCalibrated && isLive) ? (stressState || 'NORMAL').toUpperCase() : (!isCalibrated ? 'CALIBRATING' : 'AWAITING STREAM');

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
      <Text style={[styles.title, { color: theme.accent }]}>⚡ Multimodal Fusion Engine Stream (2 System Inputs)</Text>

      <View style={styles.grid}>
        {/* Multimodal Fused Stress Label */}
        <View style={[styles.memberBox, { backgroundColor: theme.bgPrimary }]}>
          <View style={styles.boxHeader}>
            <Text style={styles.boxIcon}>🏷️</Text>
            <Text style={[styles.boxTitle, { color: theme.textPrimary }]}>Input 1: Fused Label</Text>
          </View>
          <Text style={[styles.boxVal, { color: theme.textPrimary }]}>{displayLabel}</Text>
          <View style={[styles.miniBadge, { backgroundColor: getLabelColor(stressState, probVal) }]}>
            <Text style={styles.miniBadgeTxt}>{(isCalibrated && isLive) ? 'FUSED LABEL' : (!isCalibrated ? 'CALIBRATING' : 'AWAITING STREAM')}</Text>
          </View>
        </View>

        {/* Multimodal Stress Probability */}
        <View style={[styles.memberBox, { backgroundColor: theme.bgPrimary }]}>
          <View style={styles.boxHeader}>
            <Text style={styles.boxIcon}>📊</Text>
            <Text style={[styles.boxTitle, { color: theme.textPrimary }]}>Input 2: Probability</Text>
          </View>
          <Text style={[styles.boxVal, { color: theme.accent }]}>{probPct}</Text>
          <View style={[styles.miniBadge, { backgroundColor: getLabelColor(stressState, probVal) }]}>
            <Text style={styles.miniBadgeTxt}>{(isCalibrated && isLive) ? 'P(STRESS)' : 'AWAITING DATA'}</Text>
          </View>
        </View>

        {/* Member 4 Closed Loop System */}
        <View style={[styles.memberBoxFull, { backgroundColor: theme.bgPrimary }]}>
          <View style={styles.boxHeader}>
            <Text style={styles.boxIcon}>🧠</Text>
            <Text style={[styles.boxTitle, { color: theme.textPrimary }]}>Member 4: Calm AI Closed-Loop Engine</Text>
          </View>
          <Text style={[styles.boxValSub, { color: theme.textSecondary }]}>
            {(isCalibrated && isLive && typeof probVal === 'number')
              ? `Dynamically quantizes (Label=${stressState}, P=${probVal.toFixed(2)}) into Context Clusters & updates Thompson Bandit`
              : !isCalibrated
              ? 'Waiting for baseline calibration to complete before initializing Context Clusters & Thompson Bandit'
              : 'Awaiting live multimodal fusion stream from sensors to initialize Context Clusters & Thompson Bandit'}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    marginVertical: 8,
    borderWidth: 1
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  memberBox: {
    width: '48%',
    padding: 10,
    borderRadius: 12,
    alignItems: 'center'
  },
  memberBoxFull: {
    width: '100%',
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4
  },
  boxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  boxIcon: {
    fontSize: 14,
    marginRight: 4
  },
  boxTitle: {
    fontSize: 11,
    fontWeight: '700'
  },
  boxVal: {
    fontSize: 14,
    fontWeight: '900',
    marginVertical: 4
  },
  boxValSub: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2
  },
  miniBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 2
  },
  miniBadgeTxt: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5
  }
});
