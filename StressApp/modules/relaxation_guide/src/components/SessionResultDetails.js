import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// What the backend measured for the finished session: where stress started and ended, how much
// of the improvement is beyond what natural recovery would have given, and the reward parts.
const fmtScore = (v) => (Number.isFinite(v) ? v.toFixed(2) : '--');
const fmtTime = (sec) => {
  if (!Number.isFinite(sec)) return 'Not reached';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const Bar = ({ label, value, color, theme }) => (
  <View style={styles.barRow}>
    <Text style={[styles.barLabel, { color: theme.textSecondary }]}>{label}</Text>
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, backgroundColor: color }]} />
    </View>
  </View>
);

export const SessionResultDetails = ({ result, theme, isDark }) => {
  const comp = result?.reward_components;
  const measured = !!result?.measured && !!comp;

  return (
    <View style={[styles.card, {
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.75)' : 'rgba(255, 255, 255, 0.9)',
      borderColor: theme.border,
    }]}>
      <Text style={styles.header}>📈 How this session went</Text>

      {measured ? (
        <>
          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Stress score</Text>
            <Text style={[styles.value, { color: theme.textPrimary }]}>
              {fmtScore(comp.start_stress)} → {fmtScore(comp.end_stress)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Compared with doing nothing</Text>
            <Text style={[styles.value, { color: comp.uplift_raw >= 0 ? '#10B981' : '#EF4444' }]}>
              {comp.uplift_raw >= 0 ? '+' : ''}{Math.round(comp.uplift_raw * 100)}%
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Time to your baseline</Text>
            <Text style={[styles.value, { color: theme.textPrimary }]}>{fmtTime(comp.time_to_baseline)}</Text>
          </View>

          <View style={styles.divider} />
          <Text style={[styles.sub, { color: theme.textMuted }]}>What the system learned from</Text>
          <Bar label="Extra stress relief" value={comp.uplift} color="#10B981" theme={theme} />
          <Bar label="Speed" value={comp.speed} color="#38BDF8" theme={theme} />
          <Bar label="Your feedback" value={comp.rating} color="#F59E0B" theme={theme} />
          <Bar label="Short session" value={comp.effort} color="#A78BFA" theme={theme} />
        </>
      ) : (
        <Text style={[styles.note, { color: theme.textMuted }]}>
          No live stress signal was recorded during this session, so the result is estimated from your feedback only.
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { padding: 20, borderRadius: 26, borderWidth: 1, gap: 10, elevation: 4 },
  header: { fontSize: 16, fontWeight: '900', color: '#38BDF8', marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, fontWeight: '700', flex: 1 },
  value: { fontSize: 13, fontWeight: '900' },
  divider: { height: 1, backgroundColor: 'rgba(148,163,184,0.2)', marginVertical: 4 },
  sub: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 120, fontSize: 12, fontWeight: '700' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(148,163,184,0.18)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  note: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
});

export default SessionResultDetails;
