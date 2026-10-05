import React, { useRef, useEffect, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

export const RewardChestModal = ({
  visible,
  onClose,
  rewards = [
    { id: 'elixir', icon: '🧪', count: 2, label: 'Serenity Elixir' },
    { id: 'gem', icon: '🪷', count: 2, label: 'Lotus Gems' }
  ]
}) => {
  const { theme } = useContext(ThemeContext);
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 60,
        useNativeDriver: true,
      }).start();
    } else {
      scaleAnim.setValue(0.8);
    }
  }, [visible]);

  if (!visible) return null;

  const isDark = theme?.isDark ?? true;
  const primaryAccent = '#3B82F6';

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.modalCard,
            {
              backgroundColor: theme?.bgSecondary || '#1E293B',
              borderColor: theme?.border || '#334155',
              transform: [{ scale: scaleAnim }],
            }
          ]}
        >
          <Text style={styles.chestIcon}>🎁</Text>
          <Text style={[styles.title, { color: theme?.textPrimary || '#F8FAFC' }]}>
            Quest Reward Unlocked!
          </Text>
          <Text style={[styles.sub, { color: theme?.textMuted || '#94A3B8' }]}>
            You have earned rewards for completing your task.
          </Text>

          <View style={styles.rewardsRow}>
            {rewards.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.rewardCard,
                  {
                    backgroundColor: theme?.bgPrimary || '#0F172A',
                    borderColor: theme?.border || '#334155',
                  }
                ]}
              >
                <Text style={styles.rewardIcon}>{item.icon}</Text>
                <Text style={[styles.rewardCount, { color: primaryAccent }]}>+{item.count}</Text>
                <Text style={[styles.rewardLabel, { color: theme?.textMuted || '#94A3B8' }]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.claimBtn, { backgroundColor: primaryAccent }]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.claimBtnTxt}>Claim Rewards</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 15, 30, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
  },
  chestIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  sub: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  rewardsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
    width: '100%',
    justifyContent: 'center',
  },
  rewardCard: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  rewardIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  rewardCount: {
    fontSize: 15,
    fontWeight: '800',
  },
  rewardLabel: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  claimBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  claimBtnTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});

export default RewardChestModal;
