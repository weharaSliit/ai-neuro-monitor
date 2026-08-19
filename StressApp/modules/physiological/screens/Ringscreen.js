// ============================================================
// RingScreen.js
// Device connection screen for the MindPulse IoT ring.
//
// Architecture note: the ring talks WiFi -> Mosquitto ->
// mqtt_bridge.py -> Flask directly, NOT Bluetooth to the phone —
// so this screen polls the backend's /devices/<id>/status (kept
// warm by mqtt_bridge.py's heartbeat) rather than scanning for a
// BLE device. Live charts + label/trend display are still pending
// (separate mobile work) — this covers connection status only.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet
} from 'react-native';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import { API_BASE, DEVICE_ID } from '../config/config';

const POLL_INTERVAL_MS = 5000;

export default function RingScreen() {
  const { COLORS, theme, isDark } = useTheme();

  const [status,   setStatus]   = useState('offline');
  const [lastSeen, setLastSeen] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
        setStatus(res.data?.status || 'offline');
        setLastSeen(res.data?.last_seen || null);
      } catch {
        setStatus('offline');
      }
    };
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, []);

  const t = theme;
  const connected = status === 'online';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: 20, paddingTop: 60 }}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <Text style={[styles.title, { color: t.text }]}>
        💍 MindPulse Ring
      </Text>
      <Text style={[styles.subtitle, { color: t.textSecondary }]}>
        Live IoT Stress Detection
      </Text>

      {/* ── Connection status ──────────────────────────── */}
      <View style={[styles.card, {
        backgroundColor: t.card,
        borderColor: connected ? COLORS.normal : COLORS.stress,
        borderWidth: 1.5
      }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>
          Device Status
        </Text>
        <Text style={[styles.modeText, {
          color: connected ? COLORS.normal : COLORS.stress
        }]}>
          {connected ? '🟢 Connected' : '⚪ Offline'}
        </Text>
        <Text style={[styles.cardHint, { color: t.textSecondary }]}>
          {connected
            ? `Streaming from ${DEVICE_ID}`
            : `Waiting for ${DEVICE_ID} — power the board and check mqtt_bridge.py`}
        </Text>
        {lastSeen && (
          <Text style={[styles.cardHint, { color: t.textSecondary, marginTop: 4 }]}>
            Last seen: {new Date(lastSeen).toLocaleTimeString()}
          </Text>
        )}
      </View>

      {/* ── What ring sends ────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: t.card }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>
          Live Data Flow
        </Text>

        {[
          { label: 'MAX30102',  detail: 'IBI array → HRV features',        color: COLORS.hrv   },
          { label: 'Grove GSR', detail: 'ADC array → EDA features',        color: COLORS.gsr   },
          { label: 'MPU-6050',  detail: 'ACC array → motion gate',         color: COLORS.acc   },
          { label: 'XGBoost',   detail: 'features → Normal/Stress + trend', color: COLORS.brand },
        ].map((item, i) => (
          <View key={i} style={styles.flowRow}>
            <View style={[styles.flowDot, { backgroundColor: item.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.flowLabel, { color: t.text }]}>
                {item.label}
              </Text>
              <Text style={[styles.flowDetail, { color: t.textSecondary }]}>
                {item.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24, fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13, marginBottom: 24,
  },
  card: {
    borderRadius: 16, padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 15, fontWeight: '700',
    marginBottom: 12,
  },
  cardHint: {
    fontSize: 11, marginTop: 6,
  },
  modeText: {
    fontSize: 18, fontWeight: '800',
  },
  flowRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#ffffff11',
  },
  flowDot: {
    width: 8, height: 8, borderRadius: 4,
    marginRight: 12,
  },
  flowLabel: {
    fontSize: 13, fontWeight: '600',
  },
  flowDetail: {
    fontSize: 11, marginTop: 2,
  },
});
