import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import Card from './Card';
import { COLORS } from '../physiological/config/theme';
import useEarlyWarning from '../fusion/earlyWarning/useEarlyWarning';

// Calibration trend: rest -> task -> recovery for mind, body and overall on the shared
// scale (each one's own limit = 0.50). Same chart as psy_web's Calibration page and the
// website's Setup page; shown while the calibration steps run.
const LINES = [['mind', 'Mind', COLORS.eeg], ['body', 'Body', COLORS.hrv], ['fused', 'Overall', COLORS.brand]];
const W = 620; const H = 220; const P = { l: 34, r: 38, t: 24, b: 8 };
const iw = W - P.l - P.r; const ih = H - P.t - P.b;
const X = (x) => P.l + (x / 3) * iw;
const Y = (v) => P.t + (1 - Math.max(0, Math.min(1, v))) * ih;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const f2 = (v) => (v == null ? '—' : v.toFixed(2));

export default function CalibrationTrendCard({ userId, sessionId, style }) {
  const [now] = React.useState(() => Date.now());
  const ew = useEarlyWarning(userId, sessionId, {}, now);
  const phases = ew.phases || {};
  const series = useMemo(() => LINES.filter(([k]) => phases[k]).map(([k, label, color]) => {
    const p = phases[k]; const show = p.show || ((v) => v);
    const pts = [];
    [p.rest, p.task, p.recovery].forEach((arr, ph) => (arr || []).forEach((_, i) => {
      pts.push([ph + (i + 0.5) / arr.length, show(mean(arr.slice(Math.max(0, i - 2), i + 1)))]);
    }));
    return { k, label, color, pts, levels: p.levels || {} };
  }), [phases]);
  const any = series.some((s) => s.pts.length);
  return (
    <Card style={style}>
      <Text style={styles.title}>Calibration trend</Text>
      {!any ? <Text style={styles.empty}>Readings appear here as the steps run.</Text> : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {['Rest', 'Task', 'Recovery'].map((l, i) => (
              <React.Fragment key={l}>
                <Rect x={X(i)} y={P.t} width={iw / 3} height={ih} fill={i === 1 ? 'rgba(229,107,78,0.09)' : 'rgba(110,104,178,0.05)'} />
                <SvgText x={X(i + 0.5)} y={P.t - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="#989294">{l.toUpperCase()}</SvgText>
              </React.Fragment>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <React.Fragment key={v}>
                <Line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke={v === 0.5 ? COLORS.stress : 'rgba(120,120,140,0.18)'} strokeDasharray={v === 0.5 ? '5 4' : undefined} />
                <SvgText x={P.l - 5} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="#989294">{v.toFixed(2)}</SvgText>
              </React.Fragment>
            ))}
            <SvgText x={W - P.r + 4} y={Y(0.5) + 3} fontSize="9" fontWeight="700" fill={COLORS.stress}>Limit</SvgText>
            {series.map((s) => (
              <React.Fragment key={s.k}>
                <Polyline fill="none" stroke={s.color} strokeWidth={s.k === 'fused' ? 3 : 2} points={s.pts.map(([x, v]) => `${X(x)},${Y(v)}`).join(' ')} />
                {s.pts.map(([x, v], i) => <Circle key={i} cx={X(x)} cy={Y(v)} r="2.8" fill={s.color} />)}
              </React.Fragment>
            ))}
          </Svg>
          </ScrollView>
          <View style={styles.table}>
            <View style={styles.row}><Text style={[styles.cellH, styles.name]} />{['Rest', 'Task', 'Recovery'].map((h) => <Text key={h} style={styles.cellH}>{h}</Text>)}</View>
            {series.map((s) => (
              <View key={s.k} style={styles.row}>
                <Text style={[styles.cell, styles.name, { color: s.color }]}>{s.label}</Text>
                <Text style={styles.cell}>{f2(s.levels.rest)}</Text><Text style={styles.cell}>{f2(s.levels.task)}</Text><Text style={styles.cell}>{f2(s.levels.recovery)}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: '#231F20', letterSpacing: -0.2, marginBottom: 8 },
  empty: { textAlign: 'center', paddingVertical: 24, color: '#989294', fontWeight: '600' },
  table: { marginTop: 8 },
  row: { flexDirection: 'row', paddingVertical: 4 },
  name: { flex: 1.3, textAlign: 'left' },
  cell: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700', color: '#544E50', fontVariant: ['tabular-nums'] },
  cellH: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '800', color: '#989294' },
});
