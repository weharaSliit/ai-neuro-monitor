import React, { useContext } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

export const AchievementModal = ({ visible, onClose, xpEarned = 100, badges = [] }) => {
  const { theme } = useContext(ThemeContext);

  if (!visible) return null;

  return (
    <Modal animationType="slide" transparent visible={visible}>
      <View style={styles.overlay}>
        <View style={[styles.modalCard, { backgroundColor: theme.bgSecondary, borderColor: theme.accent }]}>
          <Text style={styles.emojiHeader}>🎉 🥳 🏆</Text>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Normal State Achieved!</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Your autonomic nervous system has successfully recovered to baseline equilibrium.
          </Text>

          <View style={[styles.xpBox, { backgroundColor: theme.bgPrimary }]}>
            <Text style={styles.xpVal}>+{xpEarned} XP</Text>
            <Text style={[styles.xpLbl, { color: theme.textMuted }]}>Closed-Loop Reward Points Earned</Text>
          </View>

          {badges.length > 0 && (
            <View style={styles.badgeSection}>
              <Text style={[styles.badgeSecTitle, { color: theme.accent }]}>Newly Unlocked Badges:</Text>
              {badges.map((b) => (
                <View key={b.id} style={[styles.badgeRow, { backgroundColor: theme.bgPrimary }]}>
                  <Text style={styles.badgeIcon}>{b.icon}</Text>
                  <View>
                    <Text style={[styles.badgeTitle, { color: theme.textPrimary }]}>{b.title}</Text>
                    <Text style={[styles.badgeDesc, { color: theme.textMuted }]}>{b.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={[styles.claimBtn, { backgroundColor: theme.accent }]} onPress={onClose}>
            <Text style={[styles.claimTxt, { color: theme.accentText }]}>Claim Rewards & Continue →</Text>
          </TouchableOpacity>
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
    padding: 20
  },
  modalCard: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    elevation: 10
  },
  emojiHeader: {
    fontSize: 48,
    marginBottom: 8
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 6
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16
  },
  xpBox: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 16,
    width: '100%'
  },
  xpVal: {
    color: '#10B981',
    fontSize: 24,
    fontWeight: '900'
  },
  xpLbl: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2
  },
  badgeSection: {
    width: '100%',
    marginBottom: 16
  },
  badgeSecTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    marginBottom: 6
  },
  badgeIcon: {
    fontSize: 24,
    marginRight: 10
  },
  badgeTitle: {
    fontSize: 13,
    fontWeight: '700'
  },
  badgeDesc: {
    fontSize: 10
  },
  claimBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center'
  },
  claimTxt: {
    fontWeight: '800',
    fontSize: 15
  }
});
