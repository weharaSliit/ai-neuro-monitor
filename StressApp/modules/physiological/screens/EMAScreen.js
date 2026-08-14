import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated, Alert
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import { useAppState } from './AppState';
import { API_BASE, REAL_USER_ID } from '../config/config';

function AnimatedCounter({ value, color }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }).start();
  }, [value]);
  return (
    <Animated.Text style={[{ color, fontSize: 22, fontWeight: '900', transform: [{ scale: anim }] }]}>
      {value}
    </Animated.Text>
  );
}

export default function EMAScreen() {
  const { isDark, theme }                  = useTheme();
  const { lastEmaResult, lastSessionId }   = useAppState();
  const [emaData, setEmaData]  = useState(lastEmaResult);
  const [loading, setLoading]  = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const insets   = useSafeAreaInsets();

  const userId = REAL_USER_ID;

  const bg     = isDark ? '#060d1a' : '#f0f9ff';
  const card   = isDark ? '#0f1f35' : '#ffffff';
  const border = isDark ? '#1e3a5f' : '#e2e8f0';
  const text   = theme.text;
  const muted  = theme.textMuted;

  const normalizeHistoryEntry = (entry, sessionId) => {
    if (!entry) return null;
    if (entry.comparison) return entry;
    const changes = entry.changes || {};
    const keyFeatures = ['AVNN','MeanHR','SCL_mean','SCR_count','SD1'];
    const comparison = keyFeatures.filter(f => changes[f]).map(f => ({
      feature: f, old: changes[f].old, new: changes[f].new,
      delta: changes[f].delta, formula: `α × session + (1-α) × previous = new`,
    }));
    return { success: true, user_id: userId, session_id: sessionId,
      alpha: entry.alpha, n_windows: entry.n_windows ?? null,
      comparison, interpretation: ['Loaded from EMA history.'], updated: true,
      timestamp: entry.timestamp };
  };

  const loadLatestFromHistory = async () => {
    try {
      const res     = await axios.get(`${API_BASE}/ema/history/${userId}`);
      const history = res.data?.ema_history || {};
      const entries = Object.entries(history).map(([sid, entry]) => ({ sid, entry })).filter(x => x.entry);
      if (entries.length === 0) return null;
      entries.sort((a, b) => (a.entry.timestamp || '').localeCompare(b.entry.timestamp || ''));
      const latest = entries[entries.length - 1];
      return normalizeHistoryEntry(latest.entry, latest.sid);
    } catch { return null; }
  };

  useEffect(() => {
    if (lastEmaResult) {
      setEmaData(lastEmaResult);
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
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
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
      }
    })();
    return () => { mounted = false; };
  }, [userId]);

  const manualRefresh = async () => {
    const sessionToUse = lastSessionId || emaData?.session_id;
    if (!sessionToUse) { Alert.alert('No Session', 'Run a simulation first.'); return; }
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/ema/update`, { user_id: userId, session_id: sessionToUse });
      setEmaData(res.data);
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    } catch (e) {
      Alert.alert('EMA Update Failed', e?.response?.data?.error || e.message);
    }
    setLoading(false);
  };

  if (!emaData) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconRing, { borderColor: '#6366f140' }]}>
            <Text style={styles.emptyEmoji}>🔄</Text>
          </View>
          <Text style={[styles.emptyTitle, { color: text }]}>No EMA Update Yet</Text>
          <Text style={[styles.emptyText, { color: muted }]}>
            Run a simulation first. The EMA continual learning update appears here automatically after each session.
          </Text>
          <View style={[styles.emptyBadge, { backgroundColor: '#6366f115', borderColor: '#6366f140' }]}>
            <Text style={styles.emptyBadgeText}>Watching: {userId}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <Animated.ScrollView
        style={[styles.container, { opacity: fadeAnim }]}
        contentContainerStyle={{ paddingBottom: 16 + insets.bottom + 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: text }]}>EMA Baseline Update</Text>
            <Text style={[styles.subtitle, { color: '#6366f1' }]}>Novel Contribution N4 — Continual Learning</Text>
          </View>
          <View style={[styles.userBadge, { backgroundColor: '#6366f115', borderColor: '#6366f140' }]}>
            <Text style={styles.userBadgeText}>{userId}</Text>
          </View>
        </View>

        {/* Formula card */}
        <View style={[styles.formulaCard, { backgroundColor: isDark ? '#0c1529' : '#eff6ff', borderColor: '#6366f140' }]}>
          <View style={styles.formulaHeader}>
            <Text style={[styles.formulaTitle, { color: '#818cf8' }]}>EMA Formula</Text>
            <View style={[styles.alphaBadge, { backgroundColor: '#6366f120' }]}>
              <Text style={styles.alphaText}>α = {emaData.alpha}</Text>
            </View>
          </View>

          <View style={[styles.formulaBox, { backgroundColor: isDark ? '#162033' : '#ffffff', borderColor: border }]}>
            <Text style={[styles.formulaEq, { color: '#818cf8' }]}>
              new = α × session + (1-α) × previous
            </Text>
            <Text style={[styles.formulaEq, { color: text }]}>
              new = {emaData.alpha} × session + {(1 - emaData.alpha).toFixed(1)} × previous
            </Text>
          </View>

          <View style={styles.alphaExplainRow}>
            <View style={[styles.alphaChip, { backgroundColor: '#6366f120', borderColor: '#6366f140' }]}>
              <Text style={styles.alphaChipPct}>{emaData.alpha * 100}%</Text>
              <Text style={styles.alphaChipLabel}>This session</Text>
            </View>
            <Text style={[styles.plusSign, { color: muted }]}>+</Text>
            <View style={[styles.alphaChip, { backgroundColor: '#10b98120', borderColor: '#10b98140' }]}>
              <Text style={[styles.alphaChipPct, { color: '#10b981' }]}>{(1 - emaData.alpha) * 100}%</Text>
              <Text style={styles.alphaChipLabel}>History</Text>
            </View>
            <Text style={[styles.plusSign, { color: muted }]}>=</Text>
            <View style={[styles.alphaChip, { backgroundColor: '#06b6d420', borderColor: '#06b6d440' }]}>
              <Text style={[styles.alphaChipPct, { color: '#06b6d4' }]}>New</Text>
              <Text style={styles.alphaChipLabel}>Baseline</Text>
            </View>
          </View>

          <Text style={[styles.formulaNote, { color: muted }]}>
            Adapts gradually over 10–15 sessions. Stable life = stable baseline.
          </Text>
        </View>

        {/* Windows used */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: text }]}>
            Baseline Changes — {emaData.n_windows ?? '—'} windows
          </Text>
          {emaData.n_normal_used !== undefined && (
            <View style={styles.windowsBreakdown}>
              <WindowChip value={emaData.n_normal_used} label="Normal used" color="#10b981" dark={isDark} />
              <WindowChip
                value={emaData.n_windows !== undefined ? emaData.n_windows - emaData.n_normal_used : undefined}
                label="Stress excluded" color="#ef4444" dark={isDark}
              />
            </View>
          )}
          {emaData.comparison?.map((item, i) => (
            <FeatureRow key={i} item={item} dark={isDark} muted={muted} text={text} border={border} />
          ))}
        </View>

        {/* Interpretation */}
        <View style={[styles.interpretCard, { backgroundColor: isDark ? '#0c1a2e' : '#eff6ff', borderColor: '#0891b240' }]}>
          <Text style={[styles.interpretTitle, { color: '#38bdf8' }]}>What This Means</Text>
          {emaData.interpretation?.map((msg, i) => (
            <View key={i} style={styles.interpretRow}>
              <Text style={styles.interpretDot}>•</Text>
              <Text style={[styles.interpretText, { color: muted }]}>{msg}</Text>
            </View>
          ))}
          <Text style={[styles.interpretNote, { color: isDark ? '#334155' : '#94a3b8' }]}>
            Next session predictions will use these updated baseline values.
          </Text>
        </View>

        {/* Research significance */}
        <View style={[styles.researchCard, { backgroundColor: card, borderColor: '#6366f130' }]}>
          <Text style={[styles.researchTitle, { color: text }]}>Research Significance</Text>
          <Text style={[styles.researchText, { color: muted }]}>
            This EMA update addresses a gap across all 15 reviewed papers — no existing system adapts its baseline after deployment. Static models degrade as user physiology changes. This continual learning layer ensures accuracy across weeks and months.
          </Text>
          <View style={styles.papersBadge}>
            <Text style={styles.papersBadgeText}>Identified in all 15 papers as unsolved gap</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.refreshBtn, { backgroundColor: card, borderColor: border }]}
          onPress={manualRefresh}
        >
          <Text style={[styles.refreshBtnText, { color: '#6366f1' }]}>
            {loading ? '⏳ Updating...' : '🔄 Recompute EMA'}
          </Text>
        </TouchableOpacity>

      </Animated.ScrollView>
    </SafeAreaView>
  );
}

function WindowChip({ value, label, color, dark }) {
  return (
    <View style={[styles.windowChip, { backgroundColor: color + '15', borderColor: color + '40' }]}>
      <Text style={[styles.windowChipValue, { color }]}>{value}</Text>
      <Text style={[styles.windowChipLabel, { color: dark ? '#64748b' : '#94a3b8' }]}>{label}</Text>
    </View>
  );
}

function FeatureRow({ item, dark, muted, text, border }) {
  const delta   = item.delta;
  const arrow   = delta > 0.001 ? '↑' : delta < -0.001 ? '↓' : '→';
  const color   = delta > 0.001 ? '#ef4444' : delta < -0.001 ? '#10b981' : '#64748b';
  const units   = { AVNN:'ms', MeanHR:'bpm', SCL_mean:'μS', SCR_count:'/min', SD1:'ms' };
  const unit    = units[item.feature] || '';
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: 1, tension: 100, friction: 6, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={[styles.featureRow, { borderBottomColor: border, transform: [{ scale: scaleAnim }] }]}>
      <View style={styles.featureLeft}>
        <Text style={[styles.featureName, { color: text }]}>{item.feature}</Text>
        <Text style={[styles.featureFormula, { color: dark ? '#334155' : '#94a3b8' }]}>
          {item.formula}
        </Text>
      </View>
      <View style={styles.featureRight}>
        <Text style={[styles.featureOld, { color: muted }]}>{item.old}{unit}</Text>
        <View style={[styles.featureArrowBox, { backgroundColor: color + '20' }]}>
          <Text style={[styles.featureArrow, { color }]}>{arrow}</Text>
        </View>
        <Text style={[styles.featureNew, { color }]}>{item.new}{unit}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  container:         { flex: 1 },
  emptyContainer:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIconRing:     { width: 100, height: 100, borderRadius: 50, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyEmoji:        { fontSize: 48 },
  emptyTitle:        { fontSize: 22, fontWeight: '900', marginBottom: 12, textAlign: 'center' },
  emptyText:         { fontSize: 14, textAlign: 'center', lineHeight: 24, marginBottom: 20 },
  emptyBadge:        { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1 },
  emptyBadgeText:    { color: '#818cf8', fontSize: 13, fontWeight: '700' },
  header:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, paddingBottom: 12 },
  title:             { fontSize: 22, fontWeight: '900' },
  subtitle:          { fontSize: 12, marginTop: 3, fontWeight: '600' },
  userBadge:         { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  userBadgeText:     { color: '#818cf8', fontSize: 11, fontWeight: '700' },
  formulaCard:       { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  formulaHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  formulaTitle:      { fontSize: 14, fontWeight: '800' },
  alphaBadge:        { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  alphaText:         { color: '#818cf8', fontSize: 12, fontWeight: '800' },
  formulaBox:        { borderRadius: 12, padding: 14, borderWidth: 1, marginBottom: 14, gap: 6 },
  formulaEq:         { fontSize: 13, fontFamily: 'monospace' },
  alphaExplainRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  alphaChip:         { flex: 1, alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1 },
  alphaChipPct:      { color: '#6366f1', fontSize: 16, fontWeight: '900' },
  alphaChipLabel:    { color: '#64748b', fontSize: 10, marginTop: 2 },
  plusSign:          { fontSize: 16, fontWeight: '700' },
  formulaNote:       { fontSize: 12, lineHeight: 18 },
  card:              { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  cardTitle:         { fontSize: 15, fontWeight: '800', marginBottom: 12 },
  windowsBreakdown:  { flexDirection: 'row', gap: 8, marginBottom: 14 },
  windowChip:        { flex: 1, alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1 },
  windowChipValue:   { fontSize: 18, fontWeight: '900' },
  windowChipLabel:   { fontSize: 9, marginTop: 3, textAlign: 'center' },
  featureRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  featureLeft:       { flex: 1 },
  featureName:       { fontSize: 14, fontWeight: '800' },
  featureFormula:    { fontSize: 10, marginTop: 3, fontFamily: 'monospace' },
  featureRight:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureOld:        { fontSize: 13 },
  featureArrowBox:   { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  featureArrow:      { fontSize: 16, fontWeight: '900' },
  featureNew:        { fontSize: 14, fontWeight: '900' },
  interpretCard:     { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  interpretTitle:    { fontSize: 14, fontWeight: '800', marginBottom: 12 },
  interpretRow:      { flexDirection: 'row', gap: 8, marginBottom: 8 },
  interpretDot:      { color: '#38bdf8', fontSize: 16 },
  interpretText:     { fontSize: 13, lineHeight: 20, flex: 1 },
  interpretNote:     { fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  researchCard:      { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  researchTitle:     { fontSize: 15, fontWeight: '800', marginBottom: 10 },
  researchText:      { fontSize: 13, lineHeight: 20 },
  papersBadge:       { backgroundColor: '#6366f115', borderRadius: 8, padding: 8, marginTop: 12 },
  papersBadgeText:   { color: '#818cf8', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  refreshBtn:        { marginHorizontal: 20, marginBottom: 14, padding: 16, borderRadius: 14, alignItems: 'center', borderWidth: 1 },
  refreshBtnText:    { fontSize: 15, fontWeight: '700' },
});