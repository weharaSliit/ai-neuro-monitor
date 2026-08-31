import React, { useContext } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

export const BaselineNotReachedModal = () => {
  const {
    baselineNotReachedModal,
    setBaselineNotReachedModal,
    setCurrentRecommendation,
    setSelectedSubOption,
    setCurrentScreen
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  if (!baselineNotReachedModal?.visible) {
    return null;
  }

  const alt = baselineNotReachedModal.alternativeRecommendation;
  const probPercent = Math.round((baselineNotReachedModal.prob_stress || 0.6) * 100);

  const handleDismiss = () => {
    setBaselineNotReachedModal({ visible: false, alternativeRecommendation: null, prob_stress: 0.5 });
  };

  const handleStartAlternative = () => {
    if (alt) {
      setCurrentRecommendation(alt);
      if (alt.selected_sub_option) {
        setSelectedSubOption(alt.selected_sub_option);
      }
    }
    setBaselineNotReachedModal({ visible: false, alternativeRecommendation: null, prob_stress: 0.5 });
    setCurrentScreen('GamePlayer');
  };

  const handleViewAnalytics = () => {
    setBaselineNotReachedModal({ visible: false, alternativeRecommendation: null, prob_stress: 0.5 });
    setCurrentScreen('Recovery');
  };

  return (
    <Modal transparent animationType="fade" visible={baselineNotReachedModal.visible} onRequestClose={handleDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.warning }]}>

          {/* Icon header */}
          <View style={[styles.iconWrap, { backgroundColor: theme.warning + '20' }]}>
            <Text style={styles.icon}>⚡⚠️</Text>
          </View>

          {/* Title & Badge */}
          <Text style={[styles.title, { color: theme.textPrimary }]}>Baseline Not Reached Yet</Text>
          <View style={[styles.badge, { backgroundColor: theme.warning + '25', borderColor: theme.warning }]}>
            <Text style={[styles.badgeText, { color: theme.warning }]}>
              Current Stress Level: {probPercent}%
            </Text>
          </View>

          {/* Explanation */}
          <Text style={[styles.desc, { color: theme.textSecondary }]}>
            Your physiological signals indicate your body has not returned to baseline. Smart AI adapted and selected a new technique for you:
          </Text>

          {/* Alternative Technique Card */}
          {alt && (
            <View style={[styles.altCard, { backgroundColor: theme.bgPrimary, borderColor: theme.border }]}>
              <View style={styles.altHeader}>
                <Text style={styles.altIcon}>🧘🌸</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.altTitle, { color: theme.accent }]}>{alt.title}</Text>
                  <Text style={[styles.altSub, { color: theme.textMuted }]}>
                    {alt.selected_sub_option?.title || 'Smart Choice'}
                  </Text>
                </View>
              </View>
              {alt.reason ? (
                <Text style={[styles.altReason, { color: theme.textSecondary }]}>{alt.reason}</Text>
              ) : null}
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.btnCol}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.warning }]}
              onPress={handleStartAlternative}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnTxt}>
                ⚡ Start {alt?.title || 'Alternative Technique'} →
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: theme.border }]}
              onPress={handleViewAnalytics}
              activeOpacity={0.85}
            >
              <Text style={[styles.secondaryBtnTxt, { color: theme.textMuted }]}>View Recovery Analytics</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 350,
    borderRadius: 24,
    borderWidth: 1.5,
    padding: 22,
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  icon: {
    fontSize: 30,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  desc: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 14,
  },
  altCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 18,
  },
  altHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  altIcon: {
    fontSize: 22,
  },
  altTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  altSub: {
    fontSize: 11,
    fontWeight: '600',
  },
  altReason: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  btnCol: {
    width: '100%',
    gap: 10,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnTxt: {
    color: '#0F172A',
    fontWeight: '900',
    fontSize: 13,
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  secondaryBtnTxt: {
    fontWeight: '700',
    fontSize: 12,
  },
});
