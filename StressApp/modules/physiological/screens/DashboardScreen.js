import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import {
  API_BASE,
  USER_ID,
  USER_NAME,
  STRESS_COLORS,
  STRESS_LABELS,
  STRESS_EMOJI
} from '../config/config';

export default function DashboardScreen({ navigation }) {
  const [status, setStatus] = useState('connected');
  const [baseline, setBaseline] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [pulseAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    loadData();
    startPulse();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  };

  const loadData = async () => {
    try {
      const [baselineRes, historyRes] = await Promise.all([
        axios.get(`${API_BASE}/baseline/${USER_ID}`),
        axios.get(`${API_BASE}/history/${USER_ID}`),
      ]);
      setBaseline(baselineRes.data);
      setSessions(historyRes.data);
    } catch (e) {
      setStatus('error');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome, {USER_NAME} 👋</Text>
        <Text style={styles.subtitle}>Stress Detection System</Text>
      </View>

      {/* Status Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>System Status</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: status === 'connected' ? '#22c55e' : '#ef4444' }]} />
          <Text style={styles.statusText}>
            {status === 'connected' ? 'Backend Connected' : 'Connection Error'}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: baseline?.exists ? '#22c55e' : '#f59e0b' }]} />
          <Text style={styles.statusText}>
            {baseline?.exists ? 'Personal Baseline Active' : 'No Baseline — Run Calibration'}
          </Text>
        </View>
      </View>

      {/* Baseline Card */}
      {baseline?.exists && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your Personal Baseline</Text>
          <View style={styles.metricsGrid}>
            <MetricBox
              label="Avg HRV (AVNN)"
              value={baseline.baseline?.AVNN?.mean?.toFixed(1) + ' ms'}
            />
            <MetricBox
              label="Mean HR"
              value={baseline.baseline?.MeanHR?.mean?.toFixed(1) + ' bpm'}
            />
            <MetricBox
              label="GSR Level"
              value={baseline.baseline?.SCL_mean?.mean?.toFixed(2) + ' μS'}
            />
            <MetricBox
              label="SCR Count"
              value={baseline.baseline?.SCR_count?.mean?.toFixed(1) + '/min'}
            />
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quick Actions</Text>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#6366f1' }]}
          onPress={() => navigation.navigate('Simulation')}
        >
          <Text style={styles.actionBtnText}>▶️  Start Simulation</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#0891b2' }]}
          onPress={() => navigation.navigate('Calibration')}
        >
          <Text style={styles.actionBtnText}>⚙️  Run Calibration</Text>
        </TouchableOpacity>
      </View>

      {/* About */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>About This System</Text>
        <Text style={styles.aboutText}>
          3-class perceived stress detection using HRV + GSR signals.
          Model: XGBoost trained on WESAD dataset (15 subjects).
          Novel pre-stress detection via sliding window trend analysis.
        </Text>
      </View>

      <View style={{ height: 30 }} />
    </ScrollView>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 24, paddingTop: 40 },
  greeting: { fontSize: 26, fontWeight: 'bold', color: '#f1f5f9' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  card: {
    margin: 16, marginTop: 0, padding: 20,
    backgroundColor: '#1e293b', borderRadius: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#f1f5f9', marginBottom: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  statusText: { color: '#94a3b8', fontSize: 14 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricBox: {
    backgroundColor: '#0f172a', borderRadius: 12,
    padding: 14, width: '47%', alignItems: 'center',
  },
  metricValue: { fontSize: 18, fontWeight: 'bold', color: '#6366f1' },
  metricLabel: { fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'center' },
  actionBtn: {
    padding: 16, borderRadius: 12,
    alignItems: 'center', marginBottom: 10,
  },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  aboutText: { color: '#64748b', fontSize: 13, lineHeight: 20 },
});