import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import api from '../api/client';

// Compact "Continual Learning" summary — shows the most recent EMA
// baseline update at a glance. Used on both Home and Profile instead of
// a dedicated EMA tab. Tapping it pushes the full EmaDetail screen
// (the original EMAScreen content — formula breakdown, research
// significance, manual recompute) for anyone who wants the deep dive.
export default function EmaSummaryCard({ navigation }) {
  const { theme, COLORS } = useTheme();
  const { user } = useAuth();
  const userId = user?.userId;

  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!userId) return;
      try {
        const res = await api.get(`/ema/history/${userId}`);
        const history = res.data?.ema_history || {};
        const entries = Object.values(history).filter(Boolean);
        entries.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
        if (mounted) setLatest(entries[entries.length - 1] || null);
      } catch (e) {
        // no history yet — leave latest null, show empty state
      }
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [userId]);

  const card = theme.card;
  const border = theme.border;
  const text = theme.text;
  const muted = theme.textMuted;

  const topChanges = latest?.changes
    ? Object.entries(latest.changes)
        .filter(([, v]) => v && typeof v.delta === 'number')
        .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))
        .slice(0, 2)
    : [];

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[styles.card, { backgroundColor: card, borderColor: border }]}
      onPress={() => navigation?.navigate('EmaDetail')}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: text }]}>Continual Learning</Text>
        <Text style={[styles.chevron, { color: muted }]}>→</Text>
      </View>

      {loading ? (
        <Text style={[styles.sub, { color: muted }]}>Loading…</Text>
      ) : !latest ? (
        <Text style={[styles.sub, { color: muted }]}>
          No baseline updates yet — happens automatically after sessions.
        </Text>
      ) : (
        <>
          <Text style={[styles.sub, { color: muted }]}>
            α = {latest.alpha} · updated{' '}
            {latest.timestamp ? new Date(latest.timestamp).toLocaleDateString() : 'recently'}
          </Text>
          <View style={styles.rows}>
            {topChanges.map(([feature, v]) => {
              const arrow = v.delta > 0.001 ? '↑' : v.delta < -0.001 ? '↓' : '→';
              const color = v.delta > 0.001 ? COLORS.stress : v.delta < -0.001 ? COLORS.normal : muted;
              return (
                <View key={feature} style={styles.row}>
                  <Text style={[styles.featureName, { color: text }]}>{feature}</Text>
                  <Text style={[styles.featureDelta, { color }]}>
                    {arrow} {Math.abs(v.delta).toFixed(2)}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card:        { marginHorizontal: 20, marginBottom: 16, padding: 18, borderRadius: 20, borderWidth: 1 },
  headerRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:       { fontSize: 16, fontWeight: '800' },
  chevron:     { fontSize: 16, fontWeight: '700' },
  sub:         { fontSize: 12, marginTop: 4 },
  rows:        { marginTop: 10, gap: 6 },
  row:         { flexDirection: 'row', justifyContent: 'space-between' },
  featureName: { fontSize: 13, fontWeight: '600' },
  featureDelta:{ fontSize: 13, fontWeight: '700' },
});
