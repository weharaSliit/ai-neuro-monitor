// ============================================================
// AdminSessionDetailScreen.js
// Per-window prediction detail for one session of one user
// (GET /admin/history/<userId>/<sessionId>) -- the raw feature/probability
// data behind each window, for admin inspection.
// ============================================================
import { getContentWidth } from '../../shared/theme/layout';
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import LineChart from '../../shared/LineChart';
import { COLORS } from '../../physiological/config/theme';
import api from '../../physiological/api/client';

const TREND_CHART_WIDTH = Math.max(260, getContentWidth() - 80);

function parseTimestamp(ts, fallbackMinutesAgo = 0) {
  if (!ts) return new Date(Date.now() - fallbackMinutesAgo * 60000);
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts < 10000000000 ? ts * 1000 : ts);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date(Date.now() - fallbackMinutesAgo * 60000) : d;
}

export default function AdminSessionDetailScreen({ route }) {
  const { userId, sessionId } = route.params;
  const [predictions, setPredictions] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/history/${userId}/${sessionId}`);
      setPredictions(res.data?.predictions || {});
    } catch (e) {
      setPredictions({});
    }
    setLoading(false);
  }, [userId, sessionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const text  = COLORS.light.text;
  const muted = COLORS.light.textMuted;
  const windows = predictions ? Object.entries(predictions).sort((a, b) => (a[1].window_idx ?? 0) - (b[1].window_idx ?? 0)) : [];
  const trend = useMemo(() => windows
    .map(([, w]) => w)
    .filter((w) => w.prob_stress !== undefined && w.prob_stress !== null)
    .map((w, i) => ({
      value: Math.round(w.prob_stress * 100),
      date: parseTimestamp(w.timestamp || w.timestamp_end, windows.length - 1 - i),
    })), [windows]);
  const trendColor = windows.length && windows[windows.length - 1][1].label === 'Stress' ? COLORS.stress : COLORS.normal;

  return (
    <ScreenBackground edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: text }]}>Session Detail</Text>
        <Text style={[styles.subtitle, { color: muted }]}>{userId} · {sessionId}</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.brand} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }}>
          {trend.length > 1 && (
            <Card>
              <Text style={[styles.windowTitle, { color: text, marginBottom: 4 }]}>Stress Trend (this session)</Text>
              <Text style={{ color: muted, fontSize: 11, marginBottom: 12 }}>
                P(stress) across this session's windows (%)
              </Text>
              <LineChart
                points={trend}
                color={trendColor}
                width={TREND_CHART_WIDTH}
                height={145}
                maxValue={100}
                baselineValue={50}
                baselineLabel="Stress threshold"
                colorZones
              />
            </Card>
          )}
          {windows.map(([key, w]) => {
            const color = w.label === 'Stress' ? COLORS.stress : COLORS.normal;
            return (
              <Card key={key}>
                <View style={styles.rowHeader}>
                  <Text style={[styles.windowTitle, { color: text }]}>Window {w.window_idx ?? key}</Text>
                  <Text style={{ color, fontWeight: '800' }}>{w.label}</Text>
                </View>
                <Text style={{ color: muted, fontSize: 12 }}>
                  P(stress) {((w.prob_stress ?? 0) * 100).toFixed(1)}% · P(normal) {((w.prob_normal ?? 0) * 100).toFixed(1)}%
                  {w.trending_toward_stress ? ' · trending' : ''}
                </Text>
                {w.timestamp && (
                  <Text style={{ color: muted, fontSize: 11, marginTop: 4 }}>
                    {new Date(w.timestamp).toLocaleString()}
                  </Text>
                )}
                {w.features && (
                  <View style={{ marginTop: 8 }}>
                    {Object.entries(w.features).map(([k, v]) => (
                      <Text key={k} style={{ color: muted, fontSize: 10 }}>
                        {k}: {typeof v === 'number' ? v.toFixed(3) : String(v)}
                      </Text>
                    ))}
                  </View>
                )}
              </Card>
            );
          })}
        </ScrollView>
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '900' },
  subtitle: { fontSize: 12, marginTop: 2 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  windowTitle: { fontSize: 14, fontWeight: '800' },
});
