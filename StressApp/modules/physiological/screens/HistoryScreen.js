import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import {
  API_BASE, USER_ID, STRESS_COLORS
} from '../config/config';

export default function HistoryScreen() {
  const [history,  setHistory]  = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { loadHistory(); }, []);

  useFocusEffect(
    useCallback(() => { loadHistory(); }, [])
  );

  const loadHistory = async () => {
    setLoading(true);
    try {
      const [h, b] = await Promise.all([
        axios.get(`${API_BASE}/history/${USER_ID}`),
        axios.get(`${API_BASE}/baseline/${USER_ID}`),
      ]);
      setHistory(h.data);
      setBaseline(b.data);
    } catch (e) {
      console.log('History load error:', e.message);
    }
    setLoading(false);
  };

  const sessions = history?.sessions
    ? Object.entries(history.sessions)
    : [];
  const pss4 = history?.pss4
    ? Object.entries(history.pss4)
    : [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container}>
        <Text style={styles.title}>Session History</Text>

        {loading && (
          <Text style={styles.loadingText}>Loading...</Text>
        )}

        {/* Baseline Summary */}
        {baseline?.exists && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Current Personal Baseline
            </Text>
            <Text style={styles.cardSubtitle}>
              EMA updated after each session (α=0.2)
            </Text>
            <View style={styles.row}>
              <BaselineItem
                label="AVNN"
                value={
                  baseline.baseline?.AVNN?.mean?.toFixed(1) + ' ms'
                }
              />
              <BaselineItem
                label="Heart Rate"
                value={
                  baseline.baseline?.MeanHR?.mean?.toFixed(1) + ' bpm'
                }
              />
              <BaselineItem
                label="GSR"
                value={
                  baseline.baseline?.SCL_mean?.mean?.toFixed(2) + ' μS'
                }
              />
            </View>
            <Text style={styles.emaNote}>
              Novelty N3 + N4 — Personal baseline with
              continual EMA adaptation
            </Text>
          </View>
        )}

        {/* PSS-4 History */}
        {pss4.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              PSS-4 Score History
            </Text>
            {pss4.slice(-5).reverse().map(([sid, data]) => {
              const score = data.score || 0;
              const color =
                score <= 6  ? '#22c55e'
              : score <= 12 ? '#f59e0b'
              : '#ef4444';
              return (
                <View key={sid} style={styles.pssRow}>
                  <View style={[
                    styles.pssScore,
                    {
                      backgroundColor: color + '22',
                      borderColor:     color
                    }
                  ]}>
                    <Text style={[
                      styles.pssScoreText, { color }
                    ]}>{score}</Text>
                  </View>
                  <View style={styles.pssInfo}>
                    <Text style={styles.pssLevel}>
                      {score <= 6  ? 'Normal'
                     : score <= 12 ? 'Pre-stress'
                     : 'Stress'}
                    </Text>
                    <Text style={styles.pssDate}>
                      {data.timestamp
                        ? new Date(data.timestamp)
                            .toLocaleDateString()
                        : 'Recent'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Sessions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Recent Sessions ({sessions.length})
          </Text>

          {sessions.length === 0 && !loading && (
            <Text style={styles.emptyText}>
              No sessions yet. Run a simulation to start.
            </Text>
          )}

          {sessions.slice(-8).reverse().map(([sid, data]) => (
            <View key={sid} style={styles.sessionRow}>
              <View style={styles.sessionIcon}>
                <Text style={{ fontSize: 20 }}>🧠</Text>
              </View>
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionTime}>
                  {data.start_time
                    ? new Date(data.start_time)
                        .toLocaleString()
                    : 'Recent session'}
                </Text>
                <Text style={styles.sessionWindows}>
                  {data.window_count || 0} windows recorded
                </Text>
                {data.pss4_score != null && (
                  <Text style={styles.sessionPss}>
                    PSS-4: {data.pss4_score}/16
                    {' — '}{data.stress_label}
                  </Text>
                )}
              </View>
              <View style={[
                styles.sessionDot,
                {
                  backgroundColor:
                    data.stress_label === 'Normal'     ? '#22c55e'
                  : data.stress_label === 'Pre-stress' ? '#f59e0b'
                  : data.stress_label === 'Stress'     ? '#ef4444'
                  : '#334155'
                }
              ]} />
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={loadHistory}
        >
          <Text style={styles.refreshBtnText}>Refresh</Text>
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function BaselineItem({ label, value }) {
  return (
    <View style={styles.baselineItem}>
      <Text style={styles.baselineValue}>{value}</Text>
      <Text style={styles.baselineLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: '#0f172a' },
  container:      { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  title:          { fontSize: 24, fontWeight: 'bold', color: '#f1f5f9', marginTop: 20, marginBottom: 16 },
  loadingText:    { color: '#64748b', textAlign: 'center', padding: 20 },
  card:           { backgroundColor: '#1e293b', borderRadius: 16, padding: 20, marginBottom: 16 },
  cardTitle:      { fontSize: 16, fontWeight: '700', color: '#f1f5f9', marginBottom: 6 },
  cardSubtitle:   { fontSize: 11, color: '#6366f1', marginBottom: 14, fontStyle: 'italic' },
  row:            { flexDirection: 'row', gap: 10 },
  baselineItem:   { flex: 1, backgroundColor: '#0f172a', borderRadius: 10, padding: 12, alignItems: 'center' },
  baselineValue:  { color: '#6366f1', fontWeight: 'bold', fontSize: 15 },
  baselineLabel:  { color: '#64748b', fontSize: 11, marginTop: 4 },
  emaNote:        { color: '#475569', fontSize: 12, marginTop: 12, fontStyle: 'italic' },
  pssRow:         { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  pssScore:       { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pssScoreText:   { fontWeight: 'bold', fontSize: 18 },
  pssInfo:        { marginLeft: 14 },
  pssLevel:       { color: '#f1f5f9', fontWeight: '600', fontSize: 15 },
  pssDate:        { color: '#64748b', fontSize: 12, marginTop: 2 },
  sessionRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  sessionIcon:    { width: 44, height: 44, backgroundColor: '#0f172a', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sessionInfo:    { marginLeft: 14, flex: 1 },
  sessionTime:    { color: '#f1f5f9', fontSize: 13, fontWeight: '500' },
  sessionWindows: { color: '#64748b', fontSize: 12, marginTop: 2 },
  sessionPss:     { color: '#6366f1', fontSize: 12, marginTop: 2 },
  sessionDot:     { width: 10, height: 10, borderRadius: 5 },
  emptyText:      { color: '#475569', fontSize: 14, fontStyle: 'italic' },
  refreshBtn:     { backgroundColor: '#1e293b', padding: 14, borderRadius: 12, alignItems: 'center', margin: 8 },
  refreshBtnText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
});