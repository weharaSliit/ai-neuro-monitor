// ============================================================
// RingSummaryScreen.js
// Consumer-facing detail for the ring: connection + current Normal/Stress
// reading, baseline/calibration status with a direct "Calibrate" call to
// action, a session-distribution bar, and the live trend -- a scrollable,
// tappable, zone-colored chart (see LineChart.js's colorZones) against the
// one shared Stress threshold line: green below it, red (dashed) at/above
// it. Deliberately kept to just that one line -- no session-baseline
// reference or deviation numbers here, that level of detail moved to the
// Admin app (modules/admin/) instead, same reasoning as the raw AVNN/SCL
// feature numbers and the manual "Stop Watching" control already living
// there rather than here.
// ============================================================
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import axios from 'axios';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import LineChart from '../../shared/LineChart';
import { useTheme } from '../config/ThemeContext';
import { COLORS } from '../config/theme';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE, DEVICE_ID, STRESS_DECISION_THRESHOLD_PERCENT } from '../config/config';
import api from '../api/client';

const POLL_INTERVAL_MS = 5000;
const TREND_CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18;

function DistBar({ label, value, total, color, muted }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View style={styles.distRow}>
      <View style={[styles.distBarBg, { backgroundColor: muted + '30' }]}>
        <View style={[styles.distBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.distValue, { color }]}>{value}</Text>
      <Text style={[styles.distLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

export default function RingSummaryScreen({ navigation }) {
  const { COLORS, theme } = useTheme();
  const { user } = useAuth();
  const userId = user?.userId;

  const [status, setStatus] = useState('offline');
  const [fingerDetected, setFingerDetected] = useState(null);
  const [latest, setLatest] = useState(null);
  const [chartWindows, setChartWindows] = useState([]);
  const [recent, setRecent] = useState([]);
  const [sessionDist, setSessionDist] = useState({ normal: 0, stress: 0 });
  const [sessionCount, setSessionCount] = useState(0);
  const intervalRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const s = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
      setStatus(s.data?.status || 'offline');
      // finger_detected is written by the bridge from the live sensor
      // payload every ~5s (backend/physiological/mqtt_bridge.py's
      // on_message) -- undefined (not false) means this device has never
      // reported it, e.g. still on an older firmware build.
      setFingerDetected(
        s.data?.finger_detected === undefined ? null : !!s.data.finger_detected
      );
    } catch {
      setStatus('offline');
    }
    if (!userId) return;
    try {
      const h = await api.get(`/history/${userId}`);
      const sessionIds = Object.keys(h.data?.sessions || {});
      setSessionCount(sessionIds.length);
      const latestId = sessionIds[sessionIds.length - 1];
      if (!latestId) { setLatest(null); setChartWindows([]); setRecent([]); return; }
      const s2 = await api.get(`/history/${userId}/${latestId}`);
      const predictions = Object.values(s2.data?.predictions || {})
        .sort((a, b) => (b.window_idx ?? 0) - (a.window_idx ?? 0));
      setLatest(predictions[0] || null);
      setChartWindows(predictions.slice(0, 20));
      setRecent(predictions.slice(0, 5));
    } catch {
      // leave last-known values showing on a transient failure
    }
  }, [userId]);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [poll]);

  // Normal-vs-Stress distribution across sessions, majority-voted from each
  // session's own predictions -- same derivation Admin uses.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await api.get(`/history/${userId}`);
        const sessionIds = Object.keys(h.data?.sessions || {});
        const entries = await Promise.all(sessionIds.map(async (sid) => {
          try {
            const s = await api.get(`/history/${userId}/${sid}`);
            const preds = Object.values(s.data?.predictions || {});
            if (preds.length === 0) return null;
            const stressCount = preds.filter((p) => p.label === 'Stress').length;
            return stressCount > preds.length / 2 ? 'Stress' : 'Normal';
          } catch { return null; }
        }));
        if (cancelled) return;
        setSessionDist(entries.reduce((acc, l) => {
          if (l === 'Stress') acc.stress++;
          else if (l === 'Normal') acc.normal++;
          return acc;
        }, { normal: 0, stress: 0 }));
      } catch {
        // leave last-known distribution showing
      }
    })();
    return () => { cancelled = true; };
    // Only re-run when the session count actually changes, not on every 5s
    // poll tick -- avoids hammering /history/<userId>/<sid> for every
    // session on every single poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sessionCount]);

  const trend = useMemo(() => {
    return [...chartWindows]
      .reverse()
      .filter((w) => w.timestamp && w.prob_stress !== undefined && w.prob_stress !== null)
      .map((w) => ({ value: Math.round(w.prob_stress * 100), date: new Date(w.timestamp) }));
  }, [chartWindows]);

  const t = theme;
  const connected = status === 'online';
  const statusColor = connected ? COLORS.normal : COLORS.stress;
  const stateColor = latest?.label === 'Stress'
    ? COLORS.stress
    : latest?.trending_toward_stress ? COLORS.warning : COLORS.normal;

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Device Status Card */}
        <Card accentColor={statusColor} elevated style={styles.statusCard}>
          <View style={styles.rowBetween}>
            <View style={styles.rowGap}>
              <Icon name={NAMES.device} size={18} color={statusColor} />
              <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Hardware Status</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: connected ? COLORS.normalSoft : COLORS.stressSoft }]}>
              <StatusDot color={statusColor} active={connected} size={8} />
              <Text style={[styles.statusPillText, { color: connected ? COLORS.normalDark : COLORS.stressDark }]}>
                {connected ? 'Connected' : 'Offline'}
              </Text>
            </View>
          </View>
          <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 10 }]}>
            {connected
              ? `Streaming live biometric data packets from sensor ID: ${DEVICE_ID}`
              : `Put on the smart ring to begin continuous streaming (${DEVICE_ID})`}
          </Text>
          {/* Live finger-contact feedback -- the single biggest cause of
              "insufficient data" windows is the pulse sensor not actually
              touching skin; this surfaces that immediately instead of only
              being discoverable after the fact in server logs. */}
          {connected && fingerDetected !== null && (
            <View style={[styles.contactBanner, { backgroundColor: fingerDetected ? COLORS.normalSoft : COLORS.warningSoft }]}>
              <Icon
                name={fingerDetected ? 'check-circle-outline' : 'alert-circle-outline'}
                size={16}
                color={fingerDetected ? COLORS.normalDark : COLORS.warningDark}
              />
              <Text style={[styles.contactBannerText, { color: fingerDetected ? COLORS.normalDark : COLORS.warningDark }]}>
                {fingerDetected ? 'Good finger contact' : 'No finger detected — adjust the ring for a clean reading'}
              </Text>
            </View>
          )}
        </Card>

        {/* Live Session Trend Chart */}
        {trend.length > 1 && (
          <Card accentColor={stateColor} elevated style={styles.readingCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>Live HRV & EDA Stress Curve</Text>
            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 12 }]}>
              Continuous telemetry windows with stress decision boundary
            </Text>
            <LineChart
              points={trend}
              color={stateColor}
              width={TREND_CHART_WIDTH}
              height={145}
              maxValue={100}
              hideValues
              baselineValue={STRESS_DECISION_THRESHOLD_PERCENT}
              baselineLabel="Stress threshold"
              colorZones
            />
          </Card>
        )}

        {/* Session Distribution */}
        {(sessionDist.normal + sessionDist.stress) > 0 && (
          <Card style={styles.historyCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 6 }]}>Session Distribution</Text>
            <DistBar label="Normal" value={sessionDist.normal} total={sessionDist.normal + sessionDist.stress} color={COLORS.normal} muted={t.textMuted} />
            <DistBar label="Stress" value={sessionDist.stress} total={sessionDist.normal + sessionDist.stress} color={COLORS.stress} muted={t.textMuted} />
          </Card>
        )}

        {/* Recent Windows */}
        {recent.length > 0 && (
          <Card style={styles.historyCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 6 }]}>Recent Readings</Text>
            {recent.map((w, i) => {
              const color = w.label === 'Stress' ? COLORS.stress : COLORS.normal;
              return (
                <View key={i} style={[styles.activityRow, i === recent.length - 1 && { borderBottomWidth: 0 }, { borderBottomColor: t.border }]}>
                  <MoodBadge stressed={w.label === 'Stress'} color={color} size={36} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.activityLabel, { color: t.text }]}>
                      {w.label === 'Stress' ? 'Elevated Load' : 'Normal State'}
                    </Text>
                    <Text style={[styles.activitySub, { color: t.textMuted }]}>
                      {w.timestamp ? new Date(w.timestamp).toLocaleTimeString() : ''}
                    </Text>
                  </View>
                  <View style={[styles.windowBadge, { backgroundColor: color + '15' }]}>
                    <Text style={[styles.windowBadgeText, { color }]}>{w.label}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  headerIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.2 },
  subtitle: { fontSize: 12, marginTop: 2 },
  statusCard: { padding: 18, borderRadius: 22 },
  readingCard: { padding: 20, borderRadius: 24 },
  historyCard: { padding: 18, borderRadius: 22 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 12 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  contactBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 10, marginTop: 10 },
  contactBannerText: { fontSize: 12, fontWeight: '700', flex: 1 },
  stateLabel: { fontSize: 19, fontWeight: '900', letterSpacing: -0.2 },
  readingSub: { fontSize: 12, marginTop: 2 },
  waitingBlock: { paddingVertical: 10 },
  hint: { fontSize: 12 },
  readingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill: { height: 8, borderRadius: 4 },
  distValue: { width: 22, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel: { width: 55, fontSize: 11, fontWeight: '600' },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  activityLabel: { fontSize: 13, fontWeight: '700' },
  activitySub: { fontSize: 11, marginTop: 1 },
  windowBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  windowBadgeText: { fontSize: 11, fontWeight: '700' },
});
