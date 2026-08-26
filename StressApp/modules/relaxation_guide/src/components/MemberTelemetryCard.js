import React, { useContext } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

export const MemberTelemetryCard = ({
  stressState,
  stressProbability = 0.15
}) => {
  const { theme } = useContext(ThemeContext);

  const getLabelColor = (label, prob = 0.15) => {
    const l = (label || '').toLowerCase();
    if (l === 'stress' || l === 'high_stress' || l === 'high' || l === 'acute' || prob >= 0.60) return theme.danger;
    if (l === 'pre-stress' || l === 'pre_stress' || l === 'medium' || l === 'moderate' || prob >= 0.35) return theme.warning;
    return theme.success;
  };

  const probPct = (stressProbability * 100).toFixed(0);

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
          <Text style={[styles.boxVal, { color: theme.textPrimary }]}>{stressState.toUpperCase()}</Text>
          <View style={[styles.miniBadge, { backgroundColor: getLabelColor(stressState) }]}>
            <Text style={styles.miniBadgeTxt}>FUSED LABEL</Text>
          </View>
        </View>

        {/* Multimodal Stress Probability */}
        <View style={[styles.memberBox, { backgroundColor: theme.bgPrimary }]}>
          <View style={styles.boxHeader}>
            <Text style={styles.boxIcon}>📊</Text>
            <Text style={[styles.boxTitle, { color: theme.textPrimary }]}>Input 2: Probability</Text>
          </View>
          <Text style={[styles.boxVal, { color: theme.accent }]}>{probPct}% Confidence</Text>
          <View style={[styles.miniBadge, { backgroundColor: getLabelColor(stressState) }]}>
            <Text style={styles.miniBadgeTxt}>P(STRESS)</Text>
          </View>
        </View>

        {/* Member 4 Closed Loop System */}
        <View style={[styles.memberBoxFull, { backgroundColor: theme.bgPrimary }]}>
          <View style={styles.boxHeader}>
            <Text style={styles.boxIcon}>🧠</Text>
            <Text style={[styles.boxTitle, { color: theme.textPrimary }]}>Member 4: Calm AI Closed-Loop Engine</Text>
          </View>
          <Text style={[styles.boxValSub, { color: theme.textSecondary }]}>
            Dynamically quantizes (Label={stressState}, P={stressProbability.toFixed(2)}) into Context Clusters & updates Thompson Bandit
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
    fontWeight: '800',
    marginVertical: 2
  },
  boxValSub: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2
  },
  miniBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginTop: 4
  },
  miniBadgeTxt: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900'
  }
});
