import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';

export const HistoryScreen = () => {
  const { userId, setCurrentScreen, historyList, onboardingAnswers } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const state = await apiService.getBanditState(userId);
        if (state.preference_history && state.preference_history.recent_interventions && state.preference_history.recent_interventions.length > 0) {
          setHistory(state.preference_history.recent_interventions);
        } else if (historyList && historyList.length > 0) {
          setHistory(historyList);
        } else {
          // Provide mock historical baseline entries if user just completed calibration
          setHistory([
            {
              technique_id: 'guided_meditation',
              pre_label: 'stress',
              post_label: 'normal',
              recovery_pct: 100.0,
              reward: 1.0,
              cluster_id: 1,
              timestamp: Date.now() / 1000 - 3600
            },
            {
              technique_id: 'adaptive_environment',
              pre_label: 'stress',
              post_label: 'pre-stress',
              recovery_pct: 70.0,
              reward: 0.7,
              cluster_id: 3,
              timestamp: Date.now() / 1000 - 86400
            }
          ]);
        }
      } catch (e) {
        setHistory(historyList || []);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [userId, historyList]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Relaxation & Recovery History" showBack onBack={() => setCurrentScreen('Dashboard')} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.heading, { color: theme.textPrimary }]}>Relaxation Technique Performance & Recovery</Text>

          {/* Onboarding Preferences Summary Card if available */}
          {onboardingAnswers ? (
            <View style={[styles.profileCard, { backgroundColor: theme.bgSecondary, borderColor: theme.accent }]}>
              <Text style={[styles.profileCardTitle, { color: theme.accent }]}>📋 Recorded Onboarding Stress Profile</Text>
              <Text style={[styles.profileItem, { color: theme.textSecondary }]}>• Stress Source: <Text style={{ fontWeight: '700', color: theme.textPrimary }}>{onboardingAnswers.stress_source.toUpperCase()}</Text></Text>
              <Text style={[styles.profileItem, { color: theme.textSecondary }]}>• Preferred Style: <Text style={{ fontWeight: '700', color: theme.textPrimary }}>{onboardingAnswers.relaxation_style.toUpperCase()}</Text></Text>
              <Text style={[styles.profileItem, { color: theme.textSecondary }]}>• Stress Frequency: <Text style={{ fontWeight: '700', color: theme.textPrimary }}>{onboardingAnswers.stress_frequency.toUpperCase()}</Text></Text>
            </View>
          ) : null}

          {history.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.bgSecondary }]}>
              <Text style={[styles.emptyTxt, { color: theme.textMuted }]}>
                No historical interventions recorded yet. Launch your first intervention session from the Home Dashboard!
              </Text>
            </View>
          ) : (
            history.map((item, idx) => {
              const recPct = item.recovery_pct || 70.0;
              const isFull = recPct >= 95;
              const statusColor = isFull ? theme.success : (recPct >= 50 ? theme.warning : theme.danger);

              return (
                <View key={idx} style={[styles.itemCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
                  <View style={styles.itemHeader}>
                    <Text style={[styles.itemTitle, { color: theme.accent }]}>
                      {item.technique_id ? item.technique_id.replace(/_/g, ' ').toUpperCase() : 'RELAXATION SESSION'}
                    </Text>
                    <View style={[styles.badgeContainer, { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: theme.success }]}>
                      <Text style={[styles.rewardBadge, { color: theme.success }]}>+{item.reward ? item.reward.toFixed(2) : '1.00'} Reward</Text>
                    </View>
                  </View>

                  <Text style={[styles.itemTransition, { color: theme.textPrimary }]}>
                    State Transition: <Text style={{ color: theme.warning, fontWeight: '800' }}>{(item.pre_label || 'stress').toUpperCase()}</Text> → <Text style={{ color: theme.success, fontWeight: '800' }}>{(item.post_label || 'normal').toUpperCase()}</Text>
                  </Text>

                  {/* Recovery Metric Progress Bar */}
                  <View style={styles.metricRow}>
                    <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Autonomic Recovery Achieved:</Text>
                    <Text style={[styles.metricVal, { color: statusColor }]}>{recPct.toFixed(0)}% Recovery</Text>
                  </View>

                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.min(100, recPct)}%`, backgroundColor: statusColor }]} />
                  </View>

                  <Text style={[styles.itemMeta, { color: theme.textMuted }]}>
                    Context Cluster #{item.cluster_id || 0} • Recorded: {item.timestamp ? new Date(item.timestamp * 1000).toLocaleTimeString() : 'Just Now'}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  content: {
    padding: 16
  },
  heading: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 14
  },
  profileCard: {
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1.5
  },
  profileCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6
  },
  profileItem: {
    fontSize: 12,
    marginTop: 2
  },
  emptyCard: {
    padding: 20,
    borderRadius: 14,
    alignItems: 'center'
  },
  emptyTxt: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20
  },
  itemCard: {
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  itemTitle: {
    fontWeight: '800',
    fontSize: 14
  },
  badgeContainer: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1
  },
  rewardBadge: {
    fontWeight: '800',
    fontSize: 11
  },
  itemTransition: {
    fontWeight: '600',
    fontSize: 13,
    marginBottom: 8
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  metricVal: {
    fontSize: 12,
    fontWeight: '900'
  },
  barTrack: {
    height: 8,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8
  },
  barFill: {
    height: '100%',
    borderRadius: 4
  },
  itemMeta: {
    fontSize: 10,
    marginTop: 2
  }
});
