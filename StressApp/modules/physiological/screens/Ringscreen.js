// ============================================================
// RingScreen.js
// Device connection + live activity screen for the MindPulse IoT ring.
//
// Architecture note: the ring talks WiFi -> Mosquitto ->
// mqtt_bridge.py -> Flask directly, NOT Bluetooth to the phone —
// so this screen polls the backend's /devices/<id>/status (kept
// warm by mqtt_bridge.py's heartbeat) rather than scanning for a
// BLE device, and separately polls the latest session's predictions
// to show a live-updating feed of recent windows.
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Animated, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LineChart from '../../shared/LineChart';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE, DEVICE_ID } from '../config/config';
import api from '../api/client';

const POLL_INTERVAL_MS = 5000;
// Same card-content-width math as EegSessionScreen.js/FusionSessionScreen.js
// (ScrollView padding 20/side + card padding 18/side).
const TREND_CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18;

function LivePulseDot({ color, active }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { anim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1.6, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);
  return (
    <View style={{ width: 10, height: 10 }}>
      <Animated.View style={{
        position: 'absolute', width: 10, height: 10, borderRadius: 5,
        backgroundColor: color, opacity: 0.35,
        transform: [{ scale: anim }],
      }} />
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
    </View>
  );
}

export default function RingScreen() {
  const { COLORS, theme } = useTheme();
  const { user } = useAuth();
  const userId = user?.userId;

  const [status,   setStatus]   = useState('offline');
  const [lastSeen, setLastSeen] = useState(null);
  const [recentWindows, setRecentWindows] = useState([]);
  const statusIntervalRef = useRef(null);
  const feedIntervalRef   = useRef(null);

  const pollStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
      setStatus(res.data?.status || 'offline');
      setLastSeen(res.data?.last_seen || null);
    } catch {
      setStatus('offline');
    }
  }, []);

  const pollFeed = useCallback(async () => {
    if (!userId) return;
    try {
      const h = await api.get(`/history/${userId}`);
      const sessionIds = Object.keys(h.data?.sessions || {});
      const latestId = sessionIds[sessionIds.length - 1];
      if (!latestId) { setRecentWindows([]); return; }

      const s = await api.get(`/history/${userId}/${latestId}`);
      const predictions = Object.values(s.data?.predictions || {})
        .sort((a, b) => (b.window_idx ?? 0) - (a.window_idx ?? 0));
      setRecentWindows(predictions.slice(0, 5));
    } catch {
      // leave last-known feed showing rather than clearing on a
      // transient failure
    }
  }, [userId]);

  useEffect(() => {
    pollStatus();
    pollFeed();
    statusIntervalRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
    feedIntervalRef.current   = setInterval(pollFeed, POLL_INTERVAL_MS);
    return () => {
      clearInterval(statusIntervalRef.current);
      clearInterval(feedIntervalRef.current);
    };
  }, [pollStatus, pollFeed]);

  // recentWindows is sorted NEWEST-first (see pollFeed's sort above) --
  // reversed here for a left-to-right ascending-time chart, matching
  // FusionSessionScreen.js's trendline convention. prob_stress/timestamp
  // are the same flattened field names the feed rows above already read
  // (see the "Live Activity" render below), not the nested
  // probabilities.stress shape /predict's own direct response uses.
  const stressTrend = useMemo(() => {
    return [...recentWindows]
      .reverse()
      .filter((w) => w.timestamp && w.prob_stress !== undefined && w.prob_stress !== null)
      .map((w) => ({ value: Math.round(w.prob_stress * 100), date: new Date(w.timestamp) }));
  }, [recentWindows]);

  const t = theme;
  const connected = status === 'online';
  const latestWindow = recentWindows[0];
  const trendColor = latestWindow?.label === 'Stress' ? COLORS.stress : COLORS.normal;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <Text style={[styles.title, { color: t.text }]}>
          💍 MindPulse Ring
        </Text>
        <Text style={[styles.subtitle, { color: t.textMuted }]}>
          Live IoT Stress Detection
        </Text>

        {/* ── Connection status ──────────────────────────── */}
        <View style={[styles.card, {
          backgroundColor: t.card,
          borderColor: connected ? COLORS.normal : COLORS.stress,
          borderWidth: 1.5
        }]}>
          <View style={styles.statusHeaderRow}>
            <Text style={[styles.cardTitle, { color: t.text }]}>
              Device Status
            </Text>
            <LivePulseDot color={connected ? COLORS.normal : COLORS.stress} active={connected} />
          </View>
          <Text style={[styles.modeText, {
            color: connected ? COLORS.normal : COLORS.stress
          }]}>
            {connected ? 'Connected' : 'Offline'}
          </Text>
          <Text style={[styles.cardHint, { color: t.textMuted }]}>
            {connected
              ? `Streaming from ${DEVICE_ID}`
              : `Waiting for ${DEVICE_ID} — power the board and check mqtt_bridge.py`}
          </Text>
          {lastSeen && (
            <Text style={[styles.cardHint, { color: t.textMuted, marginTop: 4 }]}>
              Last seen: {new Date(lastSeen).toLocaleTimeString()}
            </Text>
          )}
        </View>

        {/* ── Live activity feed ─────────────────────────── */}
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border, borderWidth: 1 }]}>
          <View style={styles.statusHeaderRow}>
            <Text style={[styles.cardTitle, { color: t.text }]}>Live Activity</Text>
            {recentWindows.length > 0 && <LivePulseDot color={COLORS.brand} active={connected} />}
          </View>
          {recentWindows.length === 0 ? (
            <Text style={[styles.cardHint, { color: t.textMuted }]}>
              No windows recorded yet — starts once the ring is worn and streaming.
            </Text>
          ) : (
            recentWindows.map((w, i) => {
              const color = w.label === 'Stress' ? COLORS.stress : COLORS.normal;
              const confidence = Math.max(w.prob_normal ?? 0, w.prob_stress ?? 0);
              return (
                <View key={i} style={[styles.feedRow, { borderBottomColor: t.border }]}>
                  <View style={[styles.feedDot, { backgroundColor: color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.feedLabel, { color: t.text }]}>
                      Window {w.window_idx ?? '—'} · <Text style={{ color }}>{w.label || '—'}</Text>
                    </Text>
                    <Text style={[styles.feedSub, { color: t.textMuted }]}>
                      {w.timestamp ? new Date(w.timestamp).toLocaleTimeString() : ''}
                      {' · '}{Math.round(confidence * 100)}% confidence
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ── Live stress trend (HRV/GSR) ─────────────────── */}
        {stressTrend.length > 1 && (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border, borderWidth: 1 }]}>
            <View style={styles.statusHeaderRow}>
              <Text style={[styles.cardTitle, { color: t.text }]}>Live Stress Trend</Text>
              <LivePulseDot color={trendColor} active={connected} />
            </View>
            <Text style={[styles.cardHint, { color: t.textMuted, marginTop: -6, marginBottom: 12 }]}>
              P(stress) across the most recent windows (%)
            </Text>
            <LineChart
              points={stressTrend}
              color={trendColor}
              width={TREND_CHART_WIDTH}
              height={130}
              fallback={<Text style={[styles.cardHint, { color: t.textMuted }]}>Loading chart…</Text>}
            />
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24, fontWeight: '900',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13, marginBottom: 20,
  },
  card: {
    borderRadius: 20, padding: 18,
    marginBottom: 16,
  },
  statusHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15, fontWeight: '800',
  },
  cardHint: {
    fontSize: 11, marginTop: 6,
  },
  modeText: {
    fontSize: 18, fontWeight: '800',
  },
  feedRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, gap: 10,
    borderBottomWidth: 1,
  },
  feedDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  feedLabel: {
    fontSize: 13, fontWeight: '600',
  },
  feedSub: {
    fontSize: 11, marginTop: 2,
  },
});
