import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Animated, Easing } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';

const FILTERS = ['All', 'Stress', 'Pre-Stress', 'Normal'];

/* Animated bar for history items */
const AnimatedBar = ({ pct, color, delay }) => {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setTimeout(() => {
      Animated.timing(widthAnim, { toValue: Math.min(100, pct) / 100, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, delay);
  }, []);

  return (
    <View style={bStyles.track}>
      <Animated.View style={[bStyles.fill, {
        backgroundColor: color,
        width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
      }]} />
    </View>
  );
};

const bStyles = StyleSheet.create({
  track: { height: 8, backgroundColor: 'rgba(148,163,184,0.18)', borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});

/* Staggered session card */
const SessionCard = ({ item, idx, theme }) => {
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardSlide   = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(cardOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(cardSlide, { toValue: 0, tension: 60, friction: 9, useNativeDriver: true }),
      ]).start();
    }, idx * 100);
  }, []);

  const recPct = item.recovery_pct ?? 70.0;
  const statusColor = recPct >= 95 ? theme.success : recPct >= 50 ? theme.warning : theme.danger;
  const rewardPositive = (item.reward ?? 0) > 0;
  const techName = item.technique_id?.replace(/_/g, ' ')?.toUpperCase() ?? 'RELAXATION SESSION';

  return (
    <Animated.View style={[styles.itemCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border, opacity: cardOpacity, transform: [{ translateY: cardSlide }] }]}>
      <View style={styles.itemHeader}>
        <View style={[styles.itemIconWrap, { backgroundColor: statusColor + '18' }]}>
          <Text style={styles.itemIcon}>{recPct >= 95 ? '✅' : recPct >= 50 ? '🔄' : '⚠️'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemTitle, { color: theme.accent }]}>{techName}</Text>
          <Text style={[styles.itemMeta, { color: theme.textMuted }]}>
            Cluster #{item.cluster_id ?? 0}  ·  {item.timestamp ? new Date(item.timestamp * 1000).toLocaleTimeString() : 'Just Now'}
          </Text>
        </View>
        <View style={[styles.rewardChip, { backgroundColor: rewardPositive ? theme.success + '18' : theme.danger + '18', borderColor: rewardPositive ? theme.success : theme.danger }]}>
          <Text style={[styles.rewardTxt, { color: rewardPositive ? theme.success : theme.danger }]}>
            {rewardPositive ? '+' : ''}{(item.reward ?? 0).toFixed(2)}
          </Text>
        </View>
      </View>

      <Text style={[styles.transitionTxt, { color: theme.textPrimary }]}>
        <Text style={{ color: theme.warning, fontWeight: '800' }}>{(item.pre_label ?? 'stress').toUpperCase()}</Text>
        {'  →  '}
        <Text style={{ color: theme.success, fontWeight: '800' }}>{(item.post_label ?? 'normal').toUpperCase()}</Text>
      </Text>

      <View style={styles.barRow}>
        <Text style={[styles.barLabel, { color: theme.textMuted }]}>Recovery: {recPct.toFixed(0)}%</Text>
        <Text style={[styles.barPct, { color: statusColor }]}>{recPct >= 95 ? 'Full ✓' : 'Partial'}</Text>
      </View>
      <AnimatedBar pct={recPct} color={statusColor} delay={idx * 100 + 300} />
    </Animated.View>
  );
};

export const HistoryScreen = () => {
  const { userId, historyList, onboardingAnswers, setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('All');
  const [streak, setStreak] = useState(0);

  // Header entrance
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide   = useRef(new Animated.Value(-15)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(headerSlide, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const state = await apiService.getBanditState(userId);
        const items = state?.preference_history?.recent_interventions;
        if (items?.length > 0) {
          setHistory(items);
        } else if (historyList?.length > 0) {
          setHistory(historyList);
        } else {
          setHistory([
            { technique_id: 'guided_meditation', pre_label: 'stress', post_label: 'normal', recovery_pct: 100.0, reward: 1.0, cluster_id: 1, timestamp: Date.now() / 1000 - 3600 },
            { technique_id: 'adaptive_environment', pre_label: 'stress', post_label: 'pre-stress', recovery_pct: 70.0, reward: 0.7, cluster_id: 3, timestamp: Date.now() / 1000 - 86400 },
            { technique_id: 'breathing_garden', pre_label: 'pre-stress', post_label: 'normal', recovery_pct: 90.0, reward: 0.6, cluster_id: 2, timestamp: Date.now() / 1000 - 172800 },
          ]);
          setStreak(3);
        }
      } catch (e) {
        setHistory(historyList || []);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [userId, historyList]);

  const filteredHistory = history.filter(item => {
    if (activeFilter === 'All') return true;
    return item.pre_label?.toLowerCase() === activeFilter.toLowerCase();
  });

  const totalSessions = history.length;
  const fullRecoveries = history.filter(h => (h.recovery_pct ?? 70) >= 95).length;

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Recovery History" showBack onBack={() => setCurrentScreen('Dashboard')} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[styles.loadingTxt, { color: theme.textMuted }]}>Loading session history...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Stats header */}
          <Animated.View style={[styles.statsRow, { opacity: headerOpacity, transform: [{ translateY: headerSlide }] }]}>
            <View style={[styles.statCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <Text style={styles.statIcon}>🔥</Text>
              <Text style={[styles.statVal, { color: theme.accent }]}>{streak > 0 ? streak : totalSessions}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>{streak > 0 ? 'Day Streak' : 'Sessions'}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <Text style={styles.statIcon}>✅</Text>
              <Text style={[styles.statVal, { color: theme.success }]}>{fullRecoveries}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>Full Recoveries</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <Text style={styles.statIcon}>📈</Text>
              <Text style={[styles.statVal, { color: theme.warning }]}>{totalSessions > 0 ? ((fullRecoveries / totalSessions) * 100).toFixed(0) : 0}%</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>Success Rate</Text>
            </View>
          </Animated.View>

          {/* Onboarding profile card */}
          {onboardingAnswers && (
            <View style={[styles.profileCard, { backgroundColor: theme.bgSecondary, borderColor: theme.accent }]}>
              <Text style={[styles.profileTitle, { color: theme.accent }]}>📋 Onboarding Stress Profile</Text>
              <View style={styles.profileGrid}>
                {[
                  { label: 'Stress Source', val: onboardingAnswers.stress_source },
                  { label: 'Relaxation Style', val: onboardingAnswers.relaxation_style },
                  { label: 'Frequency', val: onboardingAnswers.stress_frequency },
                ].map((p, i) => (
                  <View key={i} style={[styles.profileItem, { backgroundColor: theme.bgPrimary, borderColor: theme.border }]}>
                    <Text style={[styles.profileItemLabel, { color: theme.textMuted }]}>{p.label}</Text>
                    <Text style={[styles.profileItemVal, { color: theme.textPrimary }]}>{p.val?.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Filter tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, { backgroundColor: activeFilter === f ? theme.accent : theme.bgSecondary, borderColor: activeFilter === f ? theme.accent : theme.border }]}
                onPress={() => setActiveFilter(f)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterTxt, { color: activeFilter === f ? theme.accentText : theme.textMuted }]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Session cards */}
          <Text style={[styles.sectionHeading, { color: theme.textPrimary }]}>
            {filteredHistory.length} Session{filteredHistory.length !== 1 ? 's' : ''}
          </Text>

          {filteredHistory.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <Text style={styles.emptyIcon}>🌿</Text>
              <Text style={[styles.emptyTxt, { color: theme.textMuted }]}>
                No sessions recorded yet.{'\n'}Launch your first intervention from the Dashboard!
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: theme.accent }]}
                onPress={() => setCurrentScreen('Dashboard')}
              >
                <Text style={[styles.emptyBtnTxt, { color: theme.accentText }]}>Go to Dashboard</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredHistory.map((item, idx) => (
              <SessionCard key={idx} item={item} idx={idx} theme={theme} />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  loadingTxt: { fontSize: 13, fontWeight: '600' },
  content: { padding: 16, gap: 14, paddingBottom: 40 },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, padding: 12, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', gap: 4,
  },
  statIcon: { fontSize: 22 },
  statVal: { fontSize: 22, fontWeight: '900' },
  statLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', textAlign: 'center' },

  profileCard: { padding: 14, borderRadius: 18, borderWidth: 1.5 },
  profileTitle: { fontSize: 13, fontWeight: '800', marginBottom: 10 },
  profileGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  profileItem: {
    flex: 1, minWidth: '28%', padding: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center',
  },
  profileItemLabel: { fontSize: 10, fontWeight: '600', marginBottom: 2 },
  profileItemVal: { fontSize: 11, fontWeight: '800', textAlign: 'center' },

  filterRow: { maxHeight: 44 },
  filterChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
  },
  filterTxt: { fontSize: 13, fontWeight: '700' },

  sectionHeading: { fontSize: 15, fontWeight: '800', marginBottom: -6 },

  itemCard: { padding: 14, borderRadius: 18, borderWidth: 1, gap: 8 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemIconWrap: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  itemIcon: { fontSize: 20 },
  itemTitle: { fontSize: 13, fontWeight: '800', flex: 1 },
  itemMeta: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  rewardChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1,
  },
  rewardTxt: { fontSize: 12, fontWeight: '800' },
  transitionTxt: { fontSize: 13, fontWeight: '600' },
  barRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { fontSize: 11, fontWeight: '600' },
  barPct: { fontSize: 11, fontWeight: '800' },

  emptyCard: { padding: 24, borderRadius: 20, borderWidth: 1, alignItems: 'center', gap: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTxt: { textAlign: 'center', fontSize: 13, lineHeight: 20 },
  emptyBtn: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 14 },
  emptyBtnTxt: { fontWeight: '800', fontSize: 13 },
});
