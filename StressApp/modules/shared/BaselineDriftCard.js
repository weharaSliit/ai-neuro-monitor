// ============================================================
// BaselineDriftCard.js — "Has your baseline changed?"
// App twin of web/src/components/BaselineDriftCard.jsx.
//
// Uses only what the backend already returns:
//   GET /baseline/{uid}              -> drift: { checked, original_resting_mean,
//                                       recent_mean, drift, drift_detected,
//                                       n_recent_samples }
//   GET /baseline/{uid}/drift-history -> weekly averages
//   GET /history/{uid}[/{sid}]        -> per-session averages (so the chart
//                                       works from the first few sessions,
//                                       not only after two full weeks)
// "Shifted" = recent average more than DRIFT_BAND points away from the
// calm level (same 0.15 rule as firebase_service.compute_baseline_drift).
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Card from './Card';
import LineChart from './LineChart';
import { COLORS } from '../physiological/config/theme';
import { TYPE, SPACE, RADIUS } from './theme/tokens';
import api from '../physiological/api/client';

const DRIFT_BAND = 15; // percentage points (backend DRIFT_THRESHOLD = 0.15)
const MIN_RECENT = 10; // backend DRIFT_MIN_SAMPLES
const SESSIONS_FOR_CHART = 8;

function ComparisonScale({ calm, recent }) {
  const lo = Math.max(0, calm - DRIFT_BAND);
  const hi = Math.min(100, calm + DRIFT_BAND);
  const inside = recent >= lo && recent <= hi;
  return (
    <View style={{ marginTop: SPACE.lg }}>
      <View style={styles.scale}>
        <View style={[styles.band, { left: `${lo}%`, width: `${hi - lo}%` }]} />
        <View style={[styles.marker, { left: `${calm}%`, backgroundColor: COLORS.normal }]} />
        <View style={[styles.marker, styles.markerBig, { left: `${recent}%`, backgroundColor: inside ? COLORS.brand : COLORS.warning }]} />
      </View>
      <View style={styles.scaleTicks}>
        <Text style={styles.tick}>0%</Text>
        <Text style={styles.tick}>50%</Text>
        <Text style={styles.tick}>100%</Text>
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.normal }]} />
          <Text style={styles.legendText}>Your calm level</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: inside ? COLORS.brand : COLORS.warning }]} />
          <Text style={styles.legendText}>Your last week</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch]} />
          <Text style={styles.legendText}>Normal range</Text>
        </View>
      </View>
    </View>
  );
}

export default function BaselineDriftCard({ userId, ring, style }) {
  const [weeks, setWeeks] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [view, setView] = useState('session');

  useEffect(() => {
    if (!userId || !ring?.exists) return undefined;
    let cancelled = false;
    api.get(`/baseline/${userId}/drift-history`)
      .then((r) => { if (!cancelled) setWeeks(r.data?.weeks || []); })
      .catch(() => { if (!cancelled) setWeeks([]); });
    (async () => {
      try {
        const h = await api.get(`/history/${userId}`);
        const ids = Object.keys(h.data?.sessions || {}).sort().slice(-SESSIONS_FOR_CHART);
        const results = await Promise.all(ids.map((sid) => api.get(`/history/${userId}/${sid}`).then((r) => r.data).catch(() => null)));
        const pts = results.map((d) => {
          const preds = Object.values(d?.predictions || {}).filter((p) => p?.prob_stress != null && p.timestamp);
          if (!preds.length) return null;
          const mean = preds.reduce((s, p) => s + p.prob_stress, 0) / preds.length;
          const first = preds.map((p) => new Date(p.timestamp).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b)[0];
          return first ? { value: Math.round(mean * 100), date: new Date(first), windowCount: preds.length } : null;
        }).filter(Boolean).sort((a, b) => a.date - b.date);
        if (!cancelled) setSessions(pts);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, ring?.exists]);

  const weekPoints = useMemo(() => (weeks || [])
    .filter((w) => w.mean_prob_stress != null)
    .map((w) => ({ value: Math.round(w.mean_prob_stress * 100), date: w.week_start, windowCount: w.n_samples })), [weeks]);

  if (!ring?.exists) return null;
  const d = ring?.drift || {};
  const checked = !!d.checked;
  const calm = d.original_resting_mean != null ? Math.round(d.original_resting_mean * 100) : null;
  const recent = d.recent_mean != null ? Math.round(d.recent_mean * 100) : null;
  const diff = calm != null && recent != null ? recent - calm : null;
  const drifted = !!d.drift_detected;

  const badge = !checked
    ? { text: 'Too early', bg: COLORS.light.pillBg, fg: COLORS.light.textMuted }
    : drifted ? { text: 'Changed', bg: COLORS.warningSoft, fg: COLORS.warningDark }
      : { text: 'All good', bg: COLORS.normalSoft, fg: COLORS.normalDark };

  // Plain words only -- no numbers or +/- jargon.
  let sentence;
  if (!checked) {
    sentence = 'Keep wearing your ring — after a few more readings we can compare your last week with your calm level.';
  } else if (!drifted) {
    sentence = 'Your last week looks like your calm level — all good.';
  } else if (diff > 0) {
    sentence = 'Your last week has been more stressed than your calm level. Recalibrating will keep your readings accurate.';
  } else {
    sentence = 'Your last week has been calmer than when you calibrated. Recalibrating will keep your readings accurate.';
  }

  const weekOk = weekPoints.length >= 2;
  const showWeek = view === 'week' && weekOk;
  const chartPoints = showWeek ? weekPoints : (sessions || []);
  const lines = calm != null
    ? { baseline2Value: calm, baseline2Label: 'Your calm', baseline2Color: COLORS.normal,
      baselineValue: Math.min(100, calm + DRIFT_BAND), baselineLabel: 'Too high', baselineColor: COLORS.warning }
    : {};

  return (
    <Card style={style}>
      <View style={styles.head}>
        <Text style={styles.title}>Has your baseline changed?</Text>
        <View style={[styles.pill, { backgroundColor: badge.bg }]}>
          <Text style={[styles.pillText, { color: badge.fg }]}>{badge.text}</Text>
        </View>
      </View>
      <Text style={styles.sub}>{sentence}</Text>

      <View style={styles.toggleRow}>
        <Text style={styles.chartTitle}>{showWeek ? 'Week by week' : 'Session by session'}</Text>
        <View style={styles.seg}>
          {[['session', 'Each session'], ['week', 'Each week']].map(([k, label]) => {
            const on = (k === 'week') === showWeek;
            const disabled = k === 'week' && !weekOk;
            return (
              <TouchableOpacity key={k} disabled={disabled} onPress={() => setView(k)}
                style={[styles.segItem, on && styles.segOn, disabled && { opacity: 0.4 }]}>
                <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {chartPoints.length >= 2 ? (
        <LineChart key={showWeek ? 'week' : 'session'} points={chartPoints} color={COLORS.brand} height={190}
          maxValue={100} suffix="%" {...lines} />
      ) : (
        <Text style={styles.sub}>
          {sessions === null ? 'Loading…' : 'Your chart appears after two sessions with the ring.'}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, flexWrap: 'wrap' },
  title: { ...TYPE.title, color: COLORS.light.text, flexShrink: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 11, fontWeight: '800' },
  sub: { fontSize: 12.5, color: COLORS.light.textSub, marginTop: 6, lineHeight: 18, fontWeight: '500' },
  scale: { height: 14, borderRadius: 7, backgroundColor: COLORS.light.borderSoft, justifyContent: 'center' },
  band: { position: 'absolute', top: 0, bottom: 0, borderRadius: 7, backgroundColor: COLORS.normal + '40' },
  marker: { position: 'absolute', width: 4, height: 22, marginLeft: -2, borderRadius: 2 },
  markerBig: { width: 16, height: 16, marginLeft: -8, borderRadius: 8, borderWidth: 3, borderColor: '#FFFFFF' },
  scaleTicks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  tick: { fontSize: 10, fontWeight: '700', color: COLORS.light.textMuted },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendSwatch: { width: 16, height: 10, borderRadius: 5, backgroundColor: COLORS.normal + '40' },
  legendText: { fontSize: 11, fontWeight: '600', color: COLORS.light.textSub },
  legendVal: { fontWeight: '900', color: COLORS.light.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: SPACE.lg, marginBottom: SPACE.sm },
  chartTitle: { fontSize: 13, fontWeight: '800', color: COLORS.light.text },
  seg: { flexDirection: 'row', backgroundColor: COLORS.light.pillBg, borderRadius: RADIUS.pill, padding: 3 },
  segItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill },
  segOn: { backgroundColor: COLORS.light.card },
  segText: { fontSize: 11, fontWeight: '700', color: COLORS.light.textSub },
  segTextOn: { color: COLORS.brandDark, fontWeight: '800' },
});
