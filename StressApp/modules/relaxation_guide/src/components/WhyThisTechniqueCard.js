import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Plain-language view of the context the backend used to pick the technique:
// how far above the user's own baseline, which way stress is moving, and whether the
// body (ring/earbud) and the phone-behaviour stream agree.
const SLOPE_EPS = 0.02;     // stress change per minute that counts as moving
const AGREE_EPS = 0.15;     // difference between the two streams that counts as "differ"

const buildChips = (rec) => {
  const ctx = rec?.context;
  if (!ctx || ctx.ready === false) return [];
  const chips = [];

  if (Number.isFinite(ctx.combined) && Number.isFinite(ctx.baseline)) {
    const diff = ctx.combined - ctx.baseline;
    chips.push({
      key: 'level',
      label: diff > 0.02 ? `Stress +${diff.toFixed(2)} above your baseline` : 'Near your baseline',
      color: diff > 0.2 ? '#EF4444' : diff > 0.02 ? '#F59E0B' : '#10B981',
    });
  }

  if (Number.isFinite(ctx.slope_per_min)) {
    if (ctx.slope_per_min > SLOPE_EPS) chips.push({ key: 'dir', label: '↑ Rising', color: '#EF4444' });
    else if (ctx.slope_per_min < -SLOPE_EPS) chips.push({ key: 'dir', label: '↓ Falling', color: '#10B981' });
    else chips.push({ key: 'dir', label: '→ Steady', color: '#38BDF8' });
  }

  if (ctx.has_both_streams && Number.isFinite(ctx.disagreement)) {
    if (Math.abs(ctx.disagreement) < AGREE_EPS) {
      chips.push({ key: 'streams', label: 'Body & phone agree', color: '#38BDF8' });
    } else {
      chips.push({
        key: 'streams',
        label: ctx.disagreement > 0 ? 'Body higher than phone' : 'Phone higher than body',
        color: '#A78BFA',
      });
    }
  } else {
    const used = rec?.streams_used;
    let label = 'One stream live';
    if (used && used.phenotyping && !used.physiological) label = 'Phone behaviour only';
    else if (used && used.physiological && !used.phenotyping) label = 'Body signals only';
    chips.push({ key: 'streams', label, color: '#94A3B8' });
  }

  if (ctx.rise_alarm) chips.push({ key: 'alarm', label: 'Sustained rise detected', color: '#EF4444' });

  const codes = rec?.reason_codes || [];
  if (codes.includes('learned_from_you')) chips.push({ key: 'learn', label: 'Based on your history', color: '#10B981' });
  else if (codes.includes('still_learning')) chips.push({ key: 'learn', label: 'Still learning you', color: '#F59E0B' });

  return chips;
};

export const WhyThisTechniqueCard = ({ recommendation, theme, style }) => {
  const chips = buildChips(recommendation);
  const reason = recommendation?.reason;
  if (!reason && chips.length === 0) return null;

  return (
    <View style={[styles.card, { borderColor: theme?.border || '#334155' }, style]}>
      <Text style={[styles.title, { color: theme?.textPrimary || '#F8FAFC' }]}>Why this technique</Text>
      {!!reason && <Text style={[styles.reason, { color: theme?.textSecondary || '#CBD5E1' }]}>{reason}</Text>}
      {chips.length > 0 && (
        <View style={styles.chipRow}>
          {chips.map((c) => (
            <View key={c.key} style={[styles.chip, { borderColor: c.color + '66', backgroundColor: c.color + '1F' }]}>
              <Text style={[styles.chipTxt, { color: c.color }]}>{c.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    backgroundColor: 'rgba(148,163,184,0.06)',
  },
  title: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  reason: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  chipTxt: { fontSize: 10.5, fontWeight: '800' },
});

export default WhyThisTechniqueCard;
