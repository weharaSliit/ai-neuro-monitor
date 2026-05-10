import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import {
  API_BASE, USER_ID, USER_NAME,
  STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI
} from '../config/config';

export default function DashboardScreen({ navigation }) {
  // FIX: start as 'checking' not 'connected'
  const [status,   setStatus]   = useState('checking');
  const [baseline, setBaseline] = useState(null);
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    setStatus('checking');
    try {
      const [baselineRes, historyRes] = await Promise.all([
        axios.get(`${API_BASE}/baseline/${USER_ID}`),
        axios.get(`${API_BASE}/history/${USER_ID}`),
      ]);
      setBaseline(baselineRes.data);
      setSessions(historyRes.data);
      setStatus('connected');
    } catch (e) {
      setStatus('error');
    }
  };

  const sessionCount = sessions?.sessions
    ? Object.keys(sessions.sessions).length
    : 0;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Welcome, {USER_NAME}
        </Text>
        <Text style={styles.subtitle}>
          Perceived Stress Detection System
        </Text>
      </View>

      {/* Status Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>System Status</Text>
        <StatusRow
          color={
            status === 'connected' ? '#22c55e'
          : status === 'checking'  ? '#f59e0b'
          : '#ef4444'
          }
          label={
            status === 'connected' ? 'Backend Connected'
          : status === 'checking'  ? 'Connecting...'
          : 'Connection Error — Check Backend'
          }
        />
        <StatusRow
          color={baseline?.exists ? '#22c55e' : '#f59e0b'}
          label={
            baseline?.exists
              ? 'Personal Baseline Active'
              : 'No Baseline — Run Calibration First'
          }
        />
        <StatusRow
          color={sessionCount > 0 ? '#22c55e' : '#64748b'}
          label={`${sessionCount} session${sessionCount !== 1 ? 's' : ''} recorded`}
        />
      </View>

      {/* Baseline Card */}
      {baseline?.exists && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Your Personal Baseline
          </Text>
          <Text style={styles.cardSubtitle}>
            Novelty N3 — Personalized normalization active
          </Text>
          <View style={styles.metricsGrid}>
            <MetricBox
              label="Avg HRV (AVNN)"
              value={
                baseline.baseline?.AVNN?.mean?.toFixed(1) + ' ms'
              }
            />
            <MetricBox
              label="Mean Heart Rate"
              value={
                baseline.baseline?.MeanHR?.mean?.toFixed(1) + ' bpm'
              }
            />
            <MetricBox
              label="GSR Level"
              value={
                baseline.baseline?.SCL_mean?.mean?.toFixed(2) + ' μS'
              }
            />
            <MetricBox
              label="SCR Count"
              value={
                baseline.baseline?.SCR_count?.mean?.toFixed(1) + '/min'
              }
            />
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quick Actions</Text>
        <ActionButton
          color="#6366f1"
          label="Start Simulation"
          onPress={() => navigation.navigate('Simulation')}
        />
        <ActionButton
          color="#0891b2"
          label="Run Calibration"
          onPress={() => navigation.navigate('Calibration')}
        />
        <ActionButton
          color="#059669"
          label="Fill PSS-4"
          onPress={() => navigation.navigate('PSS-4')}
        />
      </View>

      {/* Research Info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Research Overview</Text>
        <InfoRow label="Model" value="XGBoost — WESAD LOSO" />
        <InfoRow label="Features" value="22 (HRV + GSR + ACC)" />
        <InfoRow label="Classes" value="Normal / Pre-stress / Stress" />
        <InfoRow label="Novelty" value="Pre-stress detection (N1)" />
        <InfoRow label="F1-stress" value="0.802 (Objective 2)" />
        <InfoRow label="OrdMAE" value="0.194 (Objective 2)" />
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function StatusRow({ color, label }) {
  return (
    <View style={styles.statusRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}

function MetricBox({ label, value }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({ color, label, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: color }]}
      onPress={onPress}
    >
      <Text style={styles.actionBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0f172a' },
  header:       { padding: 24, paddingTop: 40 },
  greeting:     { fontSize: 26, fontWeight: 'bold', color: '#f1f5f9' },
  subtitle:     { fontSize: 14, color: '#64748b', marginTop: 4 },
  card:         { margin: 16, marginTop: 0, marginBottom: 16, padding: 20, backgroundColor: '#1e293b', borderRadius: 16 },
  cardTitle:    { fontSize: 16, fontWeight: '700', color: '#f1f5f9', marginBottom: 6 },
  cardSubtitle: { fontSize: 11, color: '#6366f1', marginBottom: 14, fontStyle: 'italic' },
  statusRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dot:          { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  statusText:   { color: '#94a3b8', fontSize: 14 },
  metricsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricBox:    { backgroundColor: '#0f172a', borderRadius: 12, padding: 14, width: '47%', alignItems: 'center' },
  metricValue:  { fontSize: 18, fontWeight: 'bold', color: '#6366f1' },
  metricLabel:  { fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'center' },
  actionBtn:    { padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 10 },
  actionBtnText:{ color: '#fff', fontSize: 16, fontWeight: '600' },
  infoRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  infoLabel:    { color: '#64748b', fontSize: 13 },
  infoValue:    { color: '#f1f5f9', fontSize: 13, fontWeight: '500' },
});