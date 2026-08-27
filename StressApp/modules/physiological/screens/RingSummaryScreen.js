// ============================================================
// RingSummaryScreen.js
// Consumer-facing detail for the ring: connection + reading confidence,
// baseline/calibration status with a direct "Calibrate" call to action,
// a Normal/Stress session-distribution bar, and the live trend. No raw
// AVNN/SCL feature numbers or a manual "Stop Watching" control -- that
// level of detail lives in the Admin app (modules/admin/).
// ============================================================
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Button from '../../shared/Button';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import LineChart from '../../shared/LineChart';
import { useTheme } from '../config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE, DEVICE_ID } from '../config/config';
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
  const [latest, setLatest] = useState(null);
  const [chartWindows, setChartWindows] = useState([]);
  const [recent, setRecent] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [sessionDist, setSessionDist] = useState({ normal: 0, stress: 0 });
  const [sessionCount, setSessionCount] = useState(0);
  const intervalRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const s = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
      setStatus(s.data?.status || 'offline');
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

  const loadBaseline = useCallback(async () => {
    if (!userId) return;
    try {
      const b = await api.get(`/baseline/${userId}`);
      setBaseline(b.data);
    } catch {
      setBaseline(null);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { loadBaseline(); }, [loadBaseline]));

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
  const stateColor = latest?.label === 'Stress' ? COLORS.stress : COLORS.normal;
  const confidence = latest ? Math.round(Math.max(latest.prob_normal ?? 0, latest.prob_stress ?? 0) * 100) : null;

  const needsCalibration = !baseline?.exists || baseline?.is_stale_hard;
  const calibrationNudge = !baseline?.exists
    ? 'No personal baseline yet — calibrate for accurate readings.'
    : baseline?.is_stale_hard
      ? "It's been over a month — recalibrate for the best accuracy."
      : baseline?.is_stale_soft
        ? 'Getting a little stale — recalibrating keeps it sharp.'
        : 'Your baseline is set and up to date.';

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Icon name={NAMES.my} size={26} color={COLORS.brand} />
          <View style={{ marginLeft: 10 }}>
            <Text style={[styles.title, { color: t.text }]}>My Ring</Text>
            <Text style={[styles.subtitle, { color: t.textMuted }]}>Connection, readings & baseline</Text>
          </View>
        </View>

        <Card accentColor={statusColor} elevated>
          <View style={styles.rowBetween}>
            <View style={styles.rowGap}>
              <Icon name={NAMES.device} size={18} color={statusColor} />
              <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Device Status</Text>
            </View>
            <StatusDot color={statusColor} active={connected} size={10} />
          </View>
          <Text style={[styles.statusValue, { color: statusColor }]}>
            {connected ? 'Connected' : 'Not Connected'}
          </Text>
          <Text style={[styles.cardSub, { color: t.textMuted }]}>
            {connected ? `Streaming from ${DEVICE_ID}` : `Put the ring on to start streaming from ${DEVICE_ID}`}
          </Text>
        </Card>

        <Card accentColor={stateColor} elevated>
          <Text style={[styles.cardTitle, { color: t.text }]}>Current Reading</Text>
          {!latest ? (
            <Text style={[styles.stateLabel, { color: t.textMuted, fontSize: 15 }]}>Waiting for a reading…</Text>
          ) : (
            <View style={styles.readingRow}>
              <MoodBadge stressed={latest.label === 'Stress'} color={stateColor} size={52} />
              <View style={{ marginLeft: 12 }}>
                <Text style={[styles.stateLabel, { color: stateColor }]}>{latest.label}</Text>
                <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 2 }]}>
                  {confidence !== null ? `${confidence}% confidence` : ''}
                </Text>
              </View>
            </View>
          )}
          {trend.length > 1 && (
            <View style={{ marginTop: 16 }}>
              <Text style={[styles.hint, { color: t.textMuted, marginBottom: 8 }]}>Trend (most recent windows)</Text>
              <LineChart points={trend} color={stateColor} width={TREND_CHART_WIDTH} height={140} maxValue={100} suffix="%" />
            </View>
          )}
        </Card>

        <Card accentColor={needsCalibration ? COLORS.warning : COLORS.normal}>
          <View style={styles.rowBetween}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Personal Baseline</Text>
            <Icon name={NAMES.calibration} size={18} color={needsCalibration ? COLORS.warning : COLORS.normal} />
          </View>
          <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 6, marginBottom: 14 }]}>
            {calibrationNudge}
          </Text>
          <Button
            label={baseline?.exists ? 'Recalibrate for better accuracy →' : 'Calibrate now →'}
            variant={needsCalibration ? 'primary' : 'outline'}
            onPress={() => navigation.navigate('Calibration')}
          />
        </Card>

        {(sessionDist.normal + sessionDist.stress) > 0 && (
          <Card>
            <Text style={[styles.cardTitle, { color: t.text }]}>Session History</Text>
            <DistBar label="Normal" value={sessionDist.normal} total={sessionDist.normal + sessionDist.stress} color={COLORS.normal} muted={t.textMuted} />
            <DistBar label="Stress" value={sessionDist.stress} total={sessionDist.normal + sessionDist.stress} color={COLORS.stress} muted={t.textMuted} />
          </Card>
        )}

        {recent.length > 0 && (
          <Card>
            <Text style={[styles.cardTitle, { color: t.text }]}>Recent Activity</Text>
            {recent.map((w, i) => {
              const color = w.label === 'Stress' ? COLORS.stress : COLORS.normal;
              return (
                <View key={i} style={[styles.activityRow, i === recent.length - 1 && { borderBottomWidth: 0 }, { borderBottomColor: t.border }]}>
                  <MoodBadge stressed={w.label === 'Stress'} color={color} size={32} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.activityLabel, { color: t.text }]}>{w.label}</Text>
                    <Text style={[styles.activitySub, { color: t.textMuted }]}>
                      {w.timestamp ? new Date(w.timestamp).toLocaleTimeString() : ''}
                    </Text>
                  </View>
                  <Text style={[styles.activityConf, { color }]}>
                    {Math.round(Math.max(w.prob_normal ?? 0, w.prob_stress ?? 0) * 100)}%
                  </Text>
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
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '900' },
  subtitle: { fontSize: 12, marginTop: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 12 },
  statusValue: { fontSize: 18, fontWeight: '900', marginTop: 8 },
  stateLabel: { fontSize: 20, fontWeight: '900' },
  hint: { fontSize: 11 },
  readingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill: { height: 8, borderRadius: 4 },
  distValue: { width: 22, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel: { width: 55, fontSize: 11 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  activityLabel: { fontSize: 13, fontWeight: '700' },
  activitySub: { fontSize: 11, marginTop: 1 },
  activityConf: { fontSize: 13, fontWeight: '800' },
});
