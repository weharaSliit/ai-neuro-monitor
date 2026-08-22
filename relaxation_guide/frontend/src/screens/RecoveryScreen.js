import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { AchievementModal } from '../components/AchievementModal';

export const RecoveryScreen = () => {
  const {
    lastValidationResult,
    preInterventionLabel,
    postInterventionLabel,
    setCurrentScreen
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);

  const reward = lastValidationResult ? lastValidationResult.reward : 1.0;
  const recoveryPct = lastValidationResult ? lastValidationResult.recovery_percentage : 100.0;
  const transition = lastValidationResult ? lastValidationResult.transition : 'Complete Recovery';
  const alpha = lastValidationResult ? lastValidationResult.alpha_updated : 2.0;
  const beta = lastValidationResult ? lastValidationResult.beta_updated : 1.0;
  const isNormal = lastValidationResult ? lastValidationResult.is_normal_reached : (postInterventionLabel === 'normal');

  const [showCelebration, setShowCelebration] = useState(isNormal);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Recovery Analytics" />

      <AchievementModal
        visible={showCelebration}
        onClose={() => setShowCelebration(false)}
        xpEarned={lastValidationResult?.xp_earned || 100}
        badges={lastValidationResult?.unlocked_badges || []}
      />

      <View style={styles.body}>
        <View style={[styles.badgeBox, { backgroundColor: isNormal ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)', borderColor: isNormal ? theme.success : theme.warning }]}>
          <Text style={styles.badgeIcon}>{isNormal ? '🎉' : '🔄'}</Text>
          <Text style={[styles.badgeTitle, { color: isNormal ? theme.success : theme.warning }]}>
            {recoveryPct.toFixed(0)}% Recovery Achieved
          </Text>
          <Text style={[styles.transitionTxt, { color: theme.textSecondary }]}>{transition}</Text>
        </View>

        <View style={[styles.detailsCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <Text style={[styles.cardHeader, { color: theme.accent }]}>Reward & Closed-Loop Feedback</Text>
          
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Pre-Intervention Label:</Text>
            <Text style={styles.rowValDanger}>{preInterventionLabel.toUpperCase()}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Post-Intervention Label:</Text>
            <Text style={styles.rowValSuccess}>{postInterventionLabel.toUpperCase()}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Validator Reward Signal:</Text>
            <Text style={styles.rowValReward}>+{reward.toFixed(1)}</Text>
          </View>

          <View style={[styles.row, { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8, marginTop: 4 }]}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Bandit Alpha (Success Parameter):</Text>
            <Text style={[styles.rowVal, { color: theme.textPrimary }]}>{alpha.toFixed(2)}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Bandit Beta (Failure Parameter):</Text>
            <Text style={[styles.rowVal, { color: theme.textPrimary }]}>{beta.toFixed(2)}</Text>
          </View>
        </View>

        {!isNormal && (
          <View style={[styles.closedLoopGuide, { backgroundColor: theme.bgSecondary, borderColor: theme.warning }]}>
            <Text style={styles.guideTitle}>⚡ Closed-Loop Monitor Guidance:</Text>
            <Text style={[styles.guideText, { color: theme.textSecondary }]}>
              You transitioned to Pre-Stress! Engage with 1 quick Soundscape session to reach 100% Normal state.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: theme.accent }]}
          onPress={() => setCurrentScreen('Dashboard')}
        >
          <Text style={[styles.doneBtnTxt, { color: theme.accentText }]}>Return to Dashboard →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  body: {
    padding: 24,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  badgeBox: {
    padding: 16,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 16,
    width: '100%'
  },
  badgeIcon: {
    fontSize: 36
  },
  badgeTitle: {
    fontSize: 20,
    fontWeight: '900',
    marginTop: 4
  },
  transitionTxt: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2
  },
  detailsCard: {
    padding: 16,
    borderRadius: 16,
    width: '100%',
    borderWidth: 1,
    marginBottom: 16
  },
  cardHeader: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 3
  },
  rowLabel: {
    fontSize: 12
  },
  rowVal: {
    fontWeight: '700',
    fontSize: 12
  },
  rowValDanger: {
    color: '#EF4444',
    fontWeight: '800',
    fontSize: 12
  },
  rowValSuccess: {
    color: '#10B981',
    fontWeight: '800',
    fontSize: 12
  },
  rowValReward: {
    color: '#F59E0B',
    fontWeight: '800',
    fontSize: 13
  },
  closedLoopGuide: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    width: '100%',
    marginBottom: 16
  },
  guideTitle: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2
  },
  guideText: {
    fontSize: 11,
    lineHeight: 15
  },
  doneBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center'
  },
  doneBtnTxt: {
    fontWeight: '800',
    fontSize: 15
  }
});
