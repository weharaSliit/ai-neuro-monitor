import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated, Alert
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { useAppState } from './AppState';
import { API_BASE, getSimulationUserId } from '../config/config';

export default function EMAScreen() {
  const {
    lastEmaResult, lastSessionId, selectedSubject
  } = useAppState();

  const [emaData, setEmaData] = useState(lastEmaResult);
  const [loading, setLoading] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];
  const insets   = useSafeAreaInsets();

  // Derive user ID from selected subject
  const simUserId = getSimulationUserId(selectedSubject);

  const normalizeHistoryEntry = (entry, sessionId) => {
    if (!entry) return null;
    if (entry.comparison) return entry;

    const changes     = entry.changes || {};
    const keyFeatures = ['AVNN', 'MeanHR', 'SCL_mean', 'SCR_count', 'SD1'];
    const comparison  = keyFeatures
      .filter(f => changes[f])
      .map(f => ({
        feature: f,
        old:     changes[f].old,
        new:     changes[f].new,
        delta:   changes[f].delta,
        formula: `α × session + (1-α) × previous = new`,
      }));

    return {
      success:        true,
      user_id:        simUserId,
      session_id:     sessionId,
      alpha:          entry.alpha,
      n_windows:      entry.n_windows ?? null,
      comparison,
      interpretation: ['Loaded latest EMA update from history.'],
      updated:        true,
      timestamp:      entry.timestamp,
    };
  };

  const loadLatestFromHistory = async () => {
    try {
      const res     = await axios.get(
        `${API_BASE}/ema/history/${simUserId}`
      );
      const history = res.data?.ema_history || {};
      const entries = Object.entries(history)
        .map(([sid, entry]) => ({ sid, entry }))
        .filter(x => x.entry);

      if (entries.length === 0) return null;

      entries.sort((a, b) => {
        const at = a.entry.timestamp || '';
        const bt = b.entry.timestamp || '';
        return at.localeCompare(bt);
      });

      const latest = entries[entries.length - 1];
      return normalizeHistoryEntry(latest.entry, latest.sid);
    } catch (e) {
      return null;
    }
  };

  useEffect(() => {
    if (lastEmaResult) {
      setEmaData(lastEmaResult);
      Animated.timing(fadeAnim, {
        toValue: 1, duration: 800, useNativeDriver: true
      }).start();
    }
  }, [lastEmaResult]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (emaData) return;
      const fromHistory = await loadLatestFromHistory();
      if (!mounted) return;
      if (fromHistory) {
        setEmaData(fromHistory);
        Animated.timing(fadeAnim, {
          toValue: 1, duration: 600, useNativeDriver: true
        }).start();
      }
    })();
    return () => { mounted = false; };
  }, [simUserId]);

  const manualRefresh = async () => {
    const sessionToUse = lastSessionId || emaData?.session_id;

    if (!sessionToUse) {
      Alert.alert(
        'No Session Found',
        'Run a simulation first, then return here to refresh.'
      );
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/ema/update`, {
        user_id:    simUserId,
        session_id: sessionToUse,
      });
      setEmaData(res.data);
      Animated.timing(fadeAnim, {
        toValue: 1, duration: 600, useNativeDriver: true
      }).start();
    } catch (e) {
      const errMsg = e?.response?.data?.error || e.message;
      Alert.alert(
        'EMA Update Failed',
        errMsg || 'Could not recompute EMA. Try again.'
      );
    }
    setLoading(false);
  };

  if (!emaData) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>🔄</Text>
          <Text style={styles.emptyTitle}>No EMA Update Yet</Text>
          <Text style={styles.emptyText}>
            Run a simulation first. The EMA continual learning
            update will appear here automatically.
          </Text>
          <Text style={styles.emptyUserId}>
            Watching: {simUserId}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const windowsText = emaData.n_windows ?? '—';

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.ScrollView
        style={[styles.container, { opacity: fadeAnim }]}
        contentContainerStyle={{
          paddingBottom: 16 + insets.bottom + 60
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>EMA Baseline Update</Text>
          <Text style={styles.subtitle}>
            Novel Contribution N4 — Continual Learning
          </Text>
          <View style={styles.userBadge}>
            <Text style={styles.userBadgeText}>
              User: {simUserId}
            </Text>
          </View>
        </View>

        <View style={styles.formulaCard}>
          <Text style={styles.formulaTitle}>EMA Formula</Text>
          <Text style={styles.formula}>
            new = α × session + (1-α) × previous
          </Text>
          <Text style={styles.formula}>
            new = {emaData.alpha} × session
            + {(1 - emaData.alpha).toFixed(1)} × previous
          </Text>
          <Text style={styles.formulaNote}>
            α = {emaData.alpha} → each session contributes{' '}
            {emaData.alpha * 100}%, history contributes{' '}
            {(1 - emaData.alpha) * 100}%.
            Adapts gradually without sudden jumps.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Baseline Changes — {windowsText} windows
          </Text>
          {emaData.comparison?.map((item, i) => (
            <FeatureRow key={i} item={item} />
          ))}
        </View>

        <View style={styles.interpretCard}>
          <Text style={styles.interpretTitle}>What This Means</Text>
          {emaData.interpretation?.map((msg, i) => (
            <Text key={i} style={styles.interpretText}>
              • {msg}
            </Text>
          ))}
          <Text style={styles.interpretNote}>
            The model has adapted to this user's updated
            physiological baseline. Next session predictions
            will use the new values above.
          </Text>
        </View>

        <View style={styles.researchCard}>
          <Text style={styles.researchTitle}>
            Research Significance
          </Text>
          <Text style={styles.researchText}>
            This EMA update addresses a key gap identified across
            all 15 reviewed papers — no existing system adapts its
            baseline after deployment. Static models degrade over
            time as user physiology changes. This continual learning
            layer ensures the model remains accurate across weeks
            and months of use.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={manualRefresh}
        >
          <Text style={styles.refreshBtnText}>
            {loading ? 'Updating...' : 'Recompute EMA'}
          </Text>
        </TouchableOpacity>

      </Animated.ScrollView>
    </SafeAreaView>
  );
}

function FeatureRow({ item }) {
  const delta = item.delta;
  const arrow = delta > 0.001 ? '↑' : delta < -0.001 ? '↓' : '→';
  const color =
    delta > 0.001  ? '#ef4444'
  : delta < -0.001 ? '#22c55e'
  : '#64748b';

  const units = {
    AVNN: 'ms', MeanHR: 'bpm', SCL_mean: 'μS',
    SCR_count: '/min', SD1: 'ms'
  };
  const unit = units[item.feature] || '';

  return (
    <View style={styles.featureRow}>
      <View style={styles.featureLeft}>
        <Text style={styles.featureName}>{item.feature}</Text>
        <Text style={styles.featureFormula}>{item.formula}</Text>
      </View>
      <View style={styles.featureRight}>
        <Text style={styles.featureOld}>{item.old}{unit}</Text>
        <Text style={[styles.featureArrow, { color }]}>
          {arrow}
        </Text>
        <Text style={[styles.featureNew, { color }]}>
          {item.new}{unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: '#0f172a' },
  container:      { flex: 1, backgroundColor: '#0f172a' },
  emptyContainer: { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyEmoji:     { fontSize: 64, marginBottom: 20 },
  emptyTitle:     { color: '#f1f5f9', fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  emptyText:      { color: '#64748b', fontSize: 15, textAlign: 'center', lineHeight: 24 },
  emptyUserId:    { color: '#6366f1', fontSize: 13, marginTop: 16, fontStyle: 'italic' },
  header:         { padding: 24, paddingTop: 30 },
  title:          { fontSize: 24, fontWeight: 'bold', color: '#f1f5f9' },
  subtitle:       { fontSize: 13, color: '#6366f1', marginTop: 4 },
  userBadge:      { backgroundColor: '#1e1b4b', borderRadius: 8, padding: 8, marginTop: 10, borderWidth: 1, borderColor: '#6366f1', alignSelf: 'flex-start' },
  userBadgeText:  { color: '#a5b4fc', fontSize: 12, fontWeight: '600' },
  formulaCard:    { margin: 16, padding: 20, backgroundColor: '#1e1b4b', borderRadius: 16, borderWidth: 1, borderColor: '#6366f1' },
  formulaTitle:   { color: '#a5b4fc', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  formula:        { color: '#f1f5f9', fontFamily: 'monospace', fontSize: 14, marginBottom: 6 },
  formulaNote:    { color: '#64748b', fontSize: 12, marginTop: 8, lineHeight: 18 },
  card:           { margin: 16, marginTop: 0, padding: 20, backgroundColor: '#1e293b', borderRadius: 16 },
  cardTitle:      { color: '#f1f5f9', fontWeight: '700', fontSize: 15, marginBottom: 16 },
  featureRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  featureLeft:    { flex: 1 },
  featureName:    { color: '#f1f5f9', fontWeight: '600', fontSize: 14 },
  featureFormula: { color: '#475569', fontSize: 10, marginTop: 3, fontFamily: 'monospace' },
  featureRight:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureOld:     { color: '#64748b', fontSize: 13 },
  featureArrow:   { fontSize: 16, fontWeight: 'bold' },
  featureNew:     { fontSize: 14, fontWeight: 'bold' },
  interpretCard:  { margin: 16, marginTop: 0, padding: 20, backgroundColor: '#0c1a2e', borderRadius: 16, borderWidth: 1, borderColor: '#0891b2' },
  interpretTitle: { color: '#38bdf8', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  interpretText:  { color: '#94a3b8', fontSize: 13, marginBottom: 6, lineHeight: 20 },
  interpretNote:  { color: '#475569', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  researchCard:   { margin: 16, marginTop: 0, padding: 20, backgroundColor: '#1e293b', borderRadius: 16 },
  researchTitle:  { color: '#f1f5f9', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  researchText:   { color: '#64748b', fontSize: 13, lineHeight: 20 },
  refreshBtn:     { margin: 16, padding: 16, backgroundColor: '#1e293b', borderRadius: 12, alignItems: 'center' },
  refreshBtnText: { color: '#6366f1', fontSize: 15, fontWeight: '600' },
});