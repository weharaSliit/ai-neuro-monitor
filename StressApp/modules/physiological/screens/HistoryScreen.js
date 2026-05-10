import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import { API_BASE, USER_ID } from '../config/config';

export default function HistoryScreen() {
  const { isDark, theme }              = useTheme();
  const [history,  setHistory]         = useState(null);
  const [baseline, setBaseline]        = useState(null);
  const [loading,  setLoading]         = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const bg     = isDark ? '#060d1a' : '#f0f9ff';
  const card   = isDark ? '#0f1f35' : '#ffffff';
  const border = isDark ? '#1e3a5f' : '#e2e8f0';
  const text   = theme.text;
  const muted  = theme.textMuted;

  useEffect(() => { loadHistory(); }, []);
  useFocusEffect(useCallback(() => { loadHistory(); }, []));

  const loadHistory = async () => {
    setLoading(true);
    try {
      const [h, b] = await Promise.all([
        axios.get(`${API_BASE}/history/${USER_ID}`),
        axios.get(`${API_BASE}/baseline/${USER_ID}`),
      ]);
      setHistory(h.data);
      setBaseline(b.data);
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    } catch (e) {
      console.log('History error:', e.message);
    }
    setLoading(false);
  };

  const sessions = history?.sessions ? Object.entries(history.sessions) : [];
  const pss4     = history?.pss4     ? Object.entries(history.pss4)     : [];

  const stressDist = sessions.reduce((acc, [_, s]) => {
    if (s.stress_label === 'Normal')     acc.normal++;
    if (s.stress_label === 'Pre-stress') acc.prestress++;
    if (s.stress_label === 'Stress')     acc.stress++;
    return acc;
  }, { normal: 0, prestress: 0, stress: 0 });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <Animated.ScrollView style={{ opacity: fadeAnim }} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: text }]}>Session History</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            {sessions.length} sessions · {pss4.length} PSS-4 responses
          </Text>
        </View>

        {/* Baseline card */}
        {baseline?.exists && (
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.cardTitle, { color: text }]}>Personal Baseline</Text>
              <View style={styles.noveltyRow}>
                <NTag label="N3" />
                <NTag label="N4" />
              </View>
            </View>
            <Text style={[styles.cardSub, { color: muted }]}>
              EMA updated (α=0.2) · Only Normal windows used
            </Text>

            <View style={styles.baselineGrid}>
              <BaselineCard
                icon="💓" label="AVNN" color="#06b6d4"
                value={baseline.baseline?.AVNN?.mean?.toFixed(1)} unit="ms" dark={isDark}
              />
              <BaselineCard
                icon="❤️" label="Heart Rate" color="#ef4444"
                value={baseline.baseline?.MeanHR?.mean?.toFixed(1)} unit="bpm" dark={isDark}
              />
              <BaselineCard
                icon="⚡" label="GSR (SCL)" color="#8b5cf6"
                value={baseline.baseline?.SCL_mean?.mean?.toFixed(3)} unit="μS" dark={isDark}
              />
              <BaselineCard
                icon="📈" label="SCR Count" color="#10b981"
                value={baseline.baseline?.SCR_count?.mean?.toFixed(1)} unit="/min" dark={isDark}
              />
            </View>
          </View>
        )}

        {/* Session distribution */}
        {sessions.length > 0 && (
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.cardTitle, { color: text }]}>Session Distribution</Text>
            <View style={styles.distRow}>
              <DistBar label="Normal" value={stressDist.normal} total={sessions.length} color="#10b981" dark={isDark} />
              <DistBar label="Pre-stress" value={stressDist.prestress} total={sessions.length} color="#f59e0b" dark={isDark} />
              <DistBar label="Stress" value={stressDist.stress} total={sessions.length} color="#ef4444" dark={isDark} />
            </View>
          </View>
        )}

        {/* PSS-4 history */}
        {pss4.length > 0 && (
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.cardTitle, { color: text }]}>PSS-4 Score History</Text>
            <Text style={[styles.cardSub, { color: muted }]}>Cohen et al. 1983 · Perceived Stress Scale</Text>

            {pss4.slice(-5).reverse().map(([sid, data], i) => {
              const score = data.score || 0;
              const color = score <= 6 ? '#10b981' : score <= 12 ? '#f59e0b' : '#ef4444';
              const level = score <= 6 ? 'Normal' : score <= 12 ? 'Pre-stress' : 'Stress';
              return (
                <View key={sid} style={[styles.pssRow, { borderBottomColor: border }]}>
                  <View style={[styles.pssCircle, { backgroundColor: color + '20', borderColor: color + '60' }]}>
                    <Text style={[styles.pssScore, { color }]}>{score}</Text>
                  </View>
                  <View style={styles.pssInfo}>
                    <Text style={[styles.pssLevel, { color }]}>{level}</Text>
                    <Text style={[styles.pssDate, { color: muted }]}>
                      {data.timestamp ? new Date(data.timestamp).toLocaleDateString() : 'Recent'}
                    </Text>
                  </View>
                  <View style={[styles.pssBarBg, { backgroundColor: isDark ? '#1e3a5f' : '#e2e8f0' }]}>
                    <View style={[styles.pssBarFill, { width: `${(score/16)*100}%`, backgroundColor: color }]} />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Sessions */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: text }]}>Recent Sessions ({sessions.length})</Text>

          {sessions.length === 0 && !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🧠</Text>
              <Text style={[styles.emptyText, { color: muted }]}>No sessions yet. Run a simulation to start.</Text>
            </View>
          )}

          {sessions.slice(-8).reverse().map(([sid, data], i) => {
            const dotColor =
              data.stress_label === 'Normal'     ? '#10b981' :
              data.stress_label === 'Pre-stress' ? '#f59e0b' :
              data.stress_label === 'Stress'     ? '#ef4444' : '#334155';

            return (
              <View key={sid} style={[styles.sessionRow, { borderBottomColor: border }]}>
                <View style={[styles.sessionIconCircle, { backgroundColor: dotColor + '20' }]}>
                  <Text style={{ fontSize: 18 }}>🧠</Text>
                </View>
                <View style={styles.sessionInfo}>
                  <Text style={[styles.sessionTime, { color: text }]}>
                    {data.start_time ? new Date(data.start_time).toLocaleString() : 'Recent session'}
                  </Text>
                  <Text style={[styles.sessionWindows, { color: muted }]}>
                    {data.window_count || 0} windows recorded
                  </Text>
                  {data.pss4_score != null && (
                    <View style={styles.sessionPssRow}>
                      <View style={[styles.sessionPssDot, { backgroundColor: dotColor }]} />
                      <Text style={[styles.sessionPss, { color: dotColor }]}>
                        PSS-4: {data.pss4_score}/16 · {data.stress_label}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={[styles.sessionStatusDot, { backgroundColor: dotColor }]} />
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.refreshBtn, { backgroundColor: card, borderColor: border }]}
          onPress={loadHistory}
        >
          <Text style={[styles.refreshText, { color: '#6366f1' }]}>↻  Refresh</Text>
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

function NTag({ label }) {
  return (
    <View style={[styles.nTag, { backgroundColor: '#6366f115', borderColor: '#6366f140' }]}>
      <Text style={styles.nTagText}>{label}</Text>
    </View>
  );
}

function BaselineCard({ icon, label, color, value, unit, dark }) {
  return (
    <View style={[styles.baselineCard, {
      backgroundColor: dark ? '#162033' : '#f8fafc',
      borderColor:     color + '30',
    }]}>
      <View style={[styles.baselineIconCircle, { backgroundColor: color + '20' }]}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text style={[styles.baselineValue, { color }]}>{value ?? '—'}</Text>
      <Text style={styles.baselineUnit}>{unit}</Text>
      <Text style={styles.baselineLabel}>{label}</Text>
    </View>
  );
}

function DistBar({ label, value, total, color, dark }) {
  const pct      = total > 0 ? (value / total) * 100 : 0;
  const fillAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fillAnim, { toValue: pct / 100, duration: 800, useNativeDriver: false }).start();
  }, [value]);
  const fillWidth = fillAnim.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] });
  return (
    <View style={styles.distItem}>
      <View style={[styles.distBarBg, { backgroundColor: dark ? '#1e3a5f' : '#e2e8f0' }]}>
        <Animated.View style={[styles.distBarFill, { width: fillWidth, backgroundColor: color }]} />
      </View>
      <Text style={[styles.distValue, { color }]}>{value}</Text>
      <Text style={styles.distLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  header:            { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title:             { fontSize: 24, fontWeight: '900' },
  subtitle:          { fontSize: 13, marginTop: 3 },
  card:              { marginHorizontal: 20, marginBottom: 16, padding: 18, borderRadius: 20, borderWidth: 1 },
  cardHeaderRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle:         { fontSize: 16, fontWeight: '800' },
  cardSub:           { fontSize: 12, marginBottom: 14 },
  noveltyRow:        { flexDirection: 'row', gap: 6 },
  nTag:              { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  nTagText:          { color: '#818cf8', fontSize: 10, fontWeight: '800' },
  baselineGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  baselineCard:      { width: '47%', borderRadius: 14, borderWidth: 1, padding: 14, alignItems: 'center' },
  baselineIconCircle:{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  baselineValue:     { fontSize: 20, fontWeight: '900' },
  baselineUnit:      { fontSize: 11, color: '#64748b', marginTop: 1 },
  baselineLabel:     { fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'center' },
  distRow:           { gap: 10, marginTop: 10 },
  distItem:          { flexDirection: 'row', alignItems: 'center', gap: 10 },
  distBarBg:         { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill:       { height: 8, borderRadius: 4 },
  distValue:         { width: 24, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel:         { width: 70, fontSize: 11, color: '#64748b' },
  pssRow:            { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  pssCircle:         { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pssScore:          { fontSize: 18, fontWeight: '900' },
  pssInfo:           { width: 80 },
  pssLevel:          { fontSize: 13, fontWeight: '700' },
  pssDate:           { fontSize: 11, marginTop: 2 },
  pssBarBg:          { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  pssBarFill:        { height: 6, borderRadius: 3 },
  sessionRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  sessionIconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sessionInfo:       { flex: 1 },
  sessionTime:       { fontSize: 13, fontWeight: '600' },
  sessionWindows:    { fontSize: 11, marginTop: 2 },
  sessionPssRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sessionPssDot:     { width: 6, height: 6, borderRadius: 3 },
  sessionPss:        { fontSize: 11, fontWeight: '600' },
  sessionStatusDot:  { width: 10, height: 10, borderRadius: 5 },
  emptyState:        { alignItems: 'center', padding: 20 },
  emptyEmoji:        { fontSize: 40, marginBottom: 10 },
  emptyText:         { fontSize: 14, textAlign: 'center' },
  refreshBtn:        { marginHorizontal: 20, marginBottom: 16, padding: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1 },
  refreshText:       { fontSize: 15, fontWeight: '700' },
});