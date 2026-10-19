import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';
import Card from '../../shared/Card';
import { COLORS } from '../../physiological/config/theme';
import { SPACE, RADIUS } from '../../shared/theme/tokens';

// The website's Body and Mind cards: heart rate and skin response from the ring, the
// headband's contact, and each one's recent score against its own limit (0.50).
const W = 300; const H = 90;
const Y = (v) => 6 + (1 - Math.max(0, Math.min(1, v))) * (H - 12);

function Spark({ rows, color }) {
  const pts = rows.filter((r) => r.value != null).slice(-40);
  if (pts.length < 2) return <Text style={styles.empty}>No readings yet.</Text>;
  const x = (i) => 4 + (i / (pts.length - 1)) * (W - 8);
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Line x1="0" x2={W} y1={Y(0.5)} y2={Y(0.5)} stroke={COLORS.stress} strokeDasharray="5 4" strokeWidth="1" />
      <Polyline fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" points={pts.map((r, i) => `${x(i)},${Y(r.value)}`).join(' ')} />
    </Svg>
  );
}

function Tile({ label, value, unit, color }) {
  return (
    <View style={[styles.tile, { borderTopColor: color }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value == null ? '—' : value}<Text style={styles.tileUnit}> {unit}</Text></Text>
    </View>
  );
}

export default function BodyMindCards({ ew, style }) {
  const { series, body, mind } = ew;
  return (
    <>
      <Card style={style}>
        <Text style={styles.title}>Body</Text>
        <View style={styles.tiles}>
          <Tile label="Heart rate" value={body?.hr != null ? Math.round(body.hr) : null} unit="bpm" color={COLORS.hrv} />
          <Tile label="Skin response" value={body?.scl != null ? body.scl.toFixed(1) : null} unit="µS" color={COLORS.gsr} />
        </View>
        <Spark rows={series.body} color={COLORS.hrv} />
      </Card>
      <Card style={style}>
        <View style={styles.head}>
          <Text style={styles.title}>Mind</Text>
          {mind?.contactOk != null && (
            <Text style={[styles.badge, { color: mind.contactOk ? COLORS.normalDark : COLORS.warning }]}>{mind.contactOk ? 'Good contact' : 'Adjust headband'}</Text>
          )}
        </View>
        <Spark rows={series.mind} color={COLORS.eeg} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '800', color: '#231F20', letterSpacing: -0.2, marginBottom: SPACE.sm },
  badge: { fontSize: 12.5, fontWeight: '800' },
  tiles: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.sm },
  tile: { flex: 1, borderWidth: 1, borderColor: '#EAE5DA', borderTopWidth: 4, borderRadius: RADIUS.md, padding: 10, backgroundColor: '#FFFFFF' },
  tileLabel: { fontSize: 11.5, fontWeight: '700', color: '#989294' },
  tileValue: { fontSize: 24, fontWeight: '900', color: '#231F20', marginTop: 2, fontVariant: ['tabular-nums'] },
  tileUnit: { fontSize: 12, fontWeight: '700', color: '#989294' },
  empty: { textAlign: 'center', paddingVertical: 24, color: '#989294', fontWeight: '600' },
});
