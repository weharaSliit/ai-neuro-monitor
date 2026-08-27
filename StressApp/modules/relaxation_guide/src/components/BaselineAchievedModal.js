import React, { useContext } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

export const BaselineAchievedModal = () => {
  const { baselineAchievedModal, setBaselineAchievedModal, setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  if (!baselineAchievedModal.visible) {
    return null;
  }

  const handleDismiss = () => {
    setBaselineAchievedModal({ visible: false, prob: '0.0', baseline: '0.0' });
  };

  const handleViewSummary = () => {
    setBaselineAchievedModal({ visible: false, prob: '0.0', baseline: '0.0' });
    setCurrentScreen('Recovery');
  };

  return (
    <Modal transparent animationType="fade" visible={baselineAchievedModal.visible} onRequestClose={handleDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.success }]}>

          {/* Icon header */}
          <View style={[styles.iconWrap, { backgroundColor: theme.success + '20' }]}>
            <Text style={styles.icon}>🎯🎉</Text>
          </View>

          {/* Title & Body */}
          <Text style={[styles.title, { color: theme.textPrimary }]}>Baseline Achieved!</Text>
          <Text style={[styles.subTitle, { color: theme.success }]}>Normal Equilibrium Restored</Text>

          <View style={[styles.infoBox, { backgroundColor: theme.bgPrimary }]}>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: theme.textMuted }]}>Live Fused Probability:</Text>
              <Text style={[styles.infoVal, { color: theme.success }]}>{baselineAchievedModal.prob}%</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: theme.textMuted }]}>Personal Target Baseline:</Text>
              <Text style={[styles.infoVal, { color: theme.accent }]}>{baselineAchievedModal.baseline}%</Text>
            </View>
          </View>

          <Text style={[styles.desc, { color: theme.textSecondary }]}>
            Real-time bio-feedback verified! Your live stress probability has returned to your personal baseline equilibrium.
          </Text>

          {/* Action Buttons */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.success }]}
              onPress={handleViewSummary}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryBtnTxt}>📊 Recovery Summary</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: theme.border }]}
              onPress={handleDismiss}
              activeOpacity={0.8}
            >
              <Text style={[styles.secondaryBtnTxt, { color: theme.textMuted }]}>Dismiss</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 20,
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  icon: {
    fontSize: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  subTitle: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 0.5,
  },
  infoBox: {
    width: '100%',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  infoVal: {
    fontSize: 13,
    fontWeight: '900',
  },
  desc: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 18,
  },
  btnRow: {
    width: '100%',
    gap: 8,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryBtnTxt: {
    fontSize: 12,
    fontWeight: '700',
  },
});
