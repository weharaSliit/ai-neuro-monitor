import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText, G } from 'react-native-svg';
import Card from '../../shared/Card';
import { COLORS } from '../../physiological/config/theme';
import { SPACE, RADIUS } from '../../shared/theme/tokens';
import { QUADRANTS } from './condition';
import { EW_LABEL, EW_PARAMS, trendOf } from './ewSeries';

// "Early warning" on the Fusion hub: three boxes (mind, body, overall) with the
// early-warning state of each and the 2x2 "your state" grid, then the stress
// timeline they come from -- the same set as the website's dashboard and psy_web.
// The timeline scrolls sideways like the other charts (swipe it; the value axis
// stays pinned), opens on the newest readings, and every reading is a point
// coloured by its state.
const MIND = COLORS.eeg;
const BODY = COLORS.hrv;
const OVERALL = COLORS.brand;
const PILL = {
  ok: { bg: COLORS.normalSoft, fg: COLORS.normalDark }, warn: { bg: COLORS.warning, fg: '#231A05' },
  high: { bg: COLORS.stress, fg: '#FFFFFF' }, rec: { bg: COLORS.brandSoft, fg: COLORS.brandDark },
  off: { bg: '#F0ECE4', fg: '#544E50' },
};
const LANE_FILL = {
  normal: 'rgba(94,147,90,0.45)', early_warning: COLORS.warning, high: COLORS.stress,
  recovering: 'rgba(110,104,178,0.7)', limited: '#CFC9BC', calibrating: '#DDD8CC',
};
const STATE_DOT = { early_warning: COLORS.warning, high: COLORS.stress, recovering: COLORS.brand };
const GAP_MS = 6 * 60000;
const GUTTER = 40; const RIGHT = 14; const PAD = { t: 16, b: 26 };
const LANE_H = 22;
const H = 210;

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const clockS = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function timeTicks(x0, x1, count) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720].map((m) => m * 60000);
  const step = steps.find((s) => (x1 - x0) / s <= count) || steps[steps.length - 1];
  const out = [];
  for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) out.push(t);
  return out;
}

function StateBox({ title, color, row, rows, old }) {
  const st = row?.state || 'calibrating';
  const trend = st === 'calibrating' || old ? null : trendOf(rows);
  const [cls, label] = EW_LABEL[st] || EW_LABEL.calibrating;
  const pill = PILL[cls] || PILL.off;
  const glyph = cls === 'ok' ? '✓ ' : cls === 'warn' ? '▲ ' : cls === 'high' ? '▼ ' : cls === 'rec' ? '↘ ' : '';
  return (
    <View style={[styles.box, { borderTopColor: color }]}>
      <Text style={styles.boxTitle}>{title}</Text>
      <Text style={styles.boxValue}>{row?.value == null ? '—' : row.value.toFixed(2)}</Text>
      <Text style={[styles.boxTrend, trend === 'rising' && { color: COLORS.warningDark }, trend === 'falling' && { color: COLORS.brand }]}>
        {old || (trend === 'rising' ? '↗ rising' : trend === 'falling' ? '↘ falling' : trend === 'steady' ? '→ steady' : ' ')}
      </Text>
      <View style={[styles.pill, { backgroundColor: pill.bg }]}>
        <Text style={[styles.pillText, { color: pill.fg }]} numberOfLines={2}>{glyph}{label}</Text>
      </View>
    </View>
  );
}

function StateGrid({ q, mind, body }) {
  const [w, setW] = useState(0);
  const x = mind == null ? null : Math.max(0.05, Math.min(0.95, mind));
  const y = body == null ? null : Math.max(0.05, Math.min(0.95, body));
  const cellColor = { relaxed: COLORS.normalSoft, mental: '#E4EDFB', arousal: '#FDEBDD', stress: COLORS.stressSoft };
  const cellText = { relaxed: COLORS.normalDark, mental: '#2F5FA8', arousal: '#B65B25', stress: COLORS.stressDark };
  return (
    <View>
      <View style={styles.gridWrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {['arousal', 'stress', 'relaxed', 'mental'].map((k) => {
          const on = q?.key === k;
          return (
            <View key={k} style={[styles.cell, on && { backgroundColor: cellColor[k], borderColor: cellText[k] }]}>
              <Text style={[styles.cellText, on && { color: cellText[k] }]}>{QUADRANTS[k].label}</Text>
            </View>
          );
        })}
        {x != null && w > 0 && (
          <View pointerEvents="none" style={[styles.dot, { left: x * w - 8, top: (1 - (y ?? 0.25)) * 132 - 8 }]} />
        )}
      </View>
      <View style={styles.axes}><Text style={styles.axisText}>Mind →</Text><Text style={styles.axisText}>Body ↑</Text></View>
    </View>
  );
}

function Timeline({ series, fusedCal, gate }) {
  const [width, setWidth] = useState(0);
  const [mins, setMins] = useState(30);            // minutes that fit across the screen, or 'all'
  const [sel, setSel] = useState(null);
  const [follow, setFollow] = useState(true);
  const scroller = useRef(null);
  const atEnd = useRef(true);
  const offset = useRef(0);
  const viewW = useRef(0);

  const xs = [...series.mind, ...series.body, ...series.fused].map((r) => r.t);
  const full = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : null;
  const pts = useMemo(() => [
    ...series.mind.map((r) => ({ x: r.t, mind: r.value ?? null, mind_s: r.state })),
    ...series.body.map((r) => ({ x: r.t, body: r.value, body_s: r.state })),
    ...series.fused.map((r) => ({ x: r.t, fused: r.value, fused_s: r.state })),
  ].sort((a, c) => a.x - c.x), [series]);

  if (!full) return <Text style={styles.empty}>No readings yet</Text>;
  const [x0, x1] = full; const span = Math.max(1, x1 - x0);
  const visibleW = Math.max(140, width - GUTTER);
  const innerW = Math.max(100, visibleW - RIGHT);
  const pxPerMs = mins === 'all' ? innerW / span : innerW / (mins * 60000);
  const plotW = Math.max(innerW, span * pxPerMs);
  const svgW = plotW + RIGHT;
  const innerH = H - PAD.t - PAD.b;
  const sx = (x) => (x - x0) * pxPerMs;
  const sy = (y) => PAD.t + (1 - Math.min(1, Math.max(0, y))) * innerH;
  const lineD = (key) => {
    let d = ''; let pen = false; let prev = null;
    for (const p of pts) {
      const v = p[key];
      if (v === undefined) continue;
      if (v == null) { pen = false; continue; }
      if (prev != null && p.x - prev > GAP_MS) pen = false;
      prev = p.x;
      d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(v).toFixed(1)}`; pen = true;
    }
    return d;
  };
  const zone = fusedCal ? [Math.min(0.5, fusedCal.baseline + EW_PARAMS.bufferSpreads * Math.max(0.05, fusedCal.spread)), 0.5] : null;
  const ticks = timeTicks(x0, x1, Math.max(2, Math.floor(plotW / 70)));
  const lanes = [['Mind', series.mind], ['Body', series.body], ['All', series.fused]];
  const blanks = (gate.blank || []).filter(([a, c]) => c > x0 && a < x1);
  const near = (px) => {
    const xv = x0 + px / pxPerMs;
    let best = null; let bd = Infinity;
    for (const p of pts) { const d = Math.abs(p.x - xv); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  const fmtv = (v) => (v == null ? '—' : v.toFixed(2));
  const markers = [];
  [['mind', series.mind], ['body', series.body], ['fused', series.fused]].forEach(([k, rows]) => {
    rows.forEach((r, i) => {
      if (r.state === 'early_warning' && rows[i - 1]?.state !== 'early_warning') markers.push({ x: r.t, y: Math.min(0.93, (r.value ?? 0.5) + 0.08), g: '▲', c: COLORS.warningDark });
      if (r.high && !rows[i - 1]?.high) markers.push({ x: r.t, y: Math.min(0.96, (r.value ?? 0.5) + 0.08), g: '▼', c: COLORS.stress });
    });
  });
  const dotsOn = pts.length < 1500;

  const onScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    offset.current = contentOffset.x; viewW.current = layoutMeasurement.width;
    const end = contentSize.width - contentOffset.x - layoutMeasurement.width < 12;
    atEnd.current = end; setFollow(end);
  };
  const step = (dir) => scroller.current?.scrollTo({ x: Math.max(0, offset.current + dir * viewW.current * 0.6), animated: true });
  const toEnd = () => { atEnd.current = true; scroller.current?.scrollToEnd({ animated: true }); };

  return (
    <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      <View style={styles.legend}>
        {[['Mind', MIND], ['Body', BODY], ['Overall', OVERALL]].map(([l, c]) => (
          <View key={l} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: c }]} /><Text style={styles.legendText}>{l}</Text></View>
        ))}
        <View style={styles.legendItem}><View style={styles.legendDash} /><Text style={styles.legendText}>Limit</Text></View>
        <View style={styles.legendItem}><View style={styles.legendZone} /><Text style={styles.legendText}>Early-warning zone</Text></View>
      </View>
      {width > 0 && (
        <View style={{ flexDirection: 'row' }}>
          {/* pinned value axis */}
          <View style={{ width: GUTTER }}>
            <Svg width={GUTTER} height={H}>
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <SvgText key={t} x={GUTTER - 6} y={sy(t) + 4} fontSize={11} fontWeight="600" fill="#989294" textAnchor="end">{t === 0 ? '0' : t === 1 ? '1' : t.toFixed(2)}</SvgText>
              ))}
            </Svg>
            <Svg width={GUTTER} height={LANE_H * lanes.length + 4}>
              {lanes.map(([label], i) => (
                <SvgText key={label} x={GUTTER - 6} y={i * LANE_H + 15} fontSize={11} fontWeight="600" fill="#989294" textAnchor="end">{label}</SvgText>
              ))}
            </Svg>
          </View>

          <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator onScroll={onScroll} scrollEventThrottle={32}
            onContentSizeChange={() => { if (atEnd.current) scroller.current?.scrollToEnd({ animated: false }); }}
            style={{ flex: 1 }} nestedScrollEnabled>
            <View>
              <Pressable onPress={(e) => setSel((s) => (s ? null : near(e.nativeEvent.locationX)))}>
                <Svg width={svgW} height={H}>
                  {blanks.map(([a, c], i) => (
                    <Rect key={`b${i}`} x={sx(Math.max(a, x0))} y={PAD.t} width={Math.max(0, sx(Math.min(c, x1)) - sx(Math.max(a, x0)))} height={innerH} fill="#EAE5DA" fillOpacity={0.6} />
                  ))}
                  {zone && <Rect x={0} y={sy(zone[1])} width={plotW} height={Math.max(0, sy(zone[0]) - sy(zone[1]))} fill={COLORS.warning} fillOpacity={0.14} />}
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => <Line key={t} x1={0} x2={plotW} y1={sy(t)} y2={sy(t)} stroke="#F2EEE4" strokeWidth={1} />)}
                  {ticks.map((t) => <SvgText key={t} x={sx(t)} y={H - 8} fontSize={11} fontWeight="600" fill="#989294" textAnchor="middle">{clock(t)}</SvgText>)}
                  <Line x1={0} x2={plotW} y1={sy(0.5)} y2={sy(0.5)} stroke="#544E50" strokeWidth={1.2} strokeDasharray="5 4" />
                  <Path d={lineD('mind')} stroke={MIND} strokeOpacity={0.55} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                  <Path d={lineD('body')} stroke={BODY} strokeOpacity={0.55} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                  <Path d={lineD('fused')} stroke={OVERALL} strokeOpacity={0.55} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                  {dotsOn && [['mind', MIND, 3], ['body', BODY, 3], ['fused', OVERALL, 3.6]].map(([k, col, r]) => pts
                    .filter((p) => p[k] != null)
                    .map((p) => <Circle key={`${k}${p.x}`} cx={sx(p.x)} cy={sy(p[k])} r={r} fill={STATE_DOT[p[`${k}_s`]] || col} stroke="#FFFFFF" strokeWidth={1.2} />))}
                  {markers.map((m, i) => (
                    <SvgText key={i} x={sx(m.x)} y={sy(m.y) + 4} fontSize={12} fontWeight="900" fill={m.c} textAnchor="middle">{m.g}</SvgText>
                  ))}
                  {sel && <Line x1={sx(sel.x)} x2={sx(sel.x)} y1={PAD.t} y2={PAD.t + innerH} stroke="#989294" strokeWidth={1} />}
                </Svg>
              </Pressable>
              <Svg width={svgW} height={LANE_H * lanes.length + 4}>
                {lanes.map(([label, rows], i) => (
                  <G key={label}>
                    {rows.map((r, j) => {
                      const t1 = Math.min(rows[j + 1]?.t ?? r.t + 25000, r.t + 60000);
                      return <Rect key={r.t} x={sx(r.t)} y={i * LANE_H + 4} width={Math.max(2.5, sx(t1) - sx(r.t))} height={LANE_H - 8} rx={2} fill={LANE_FILL[r.state] || LANE_FILL.limited} />;
                    })}
                  </G>
                ))}
              </Svg>
            </View>
          </ScrollView>
        </View>
      )}
      {sel && (
        <View style={styles.tip}>
          <Text style={styles.tipTime}>{clockS(sel.x)}</Text>
          <Text style={styles.tipRow}><Text style={{ color: MIND }}>● </Text>Mind {fmtv(sel.mind)}   <Text style={{ color: BODY }}>● </Text>Body {fmtv(sel.body)}   <Text style={{ color: OVERALL }}>● </Text>Overall {fmtv(sel.fused)}</Text>
        </View>
      )}
      <View style={styles.key}>
        {[['normal', 'Normal'], ['early_warning', 'Early warning'], ['high', 'High'], ['recovering', 'Recovering'], ['calibrating', 'Calibrating']].map(([k, l]) => (
          <View key={k} style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: LANE_FILL[k] }]} /><Text style={styles.keyText}>{l}</Text></View>
        ))}
      </View>
      <View style={styles.zoomRow}>
        <Pressable onPress={() => step(-1)} style={styles.chip}><Text style={styles.chipText}>◀</Text></Pressable>
        <Pressable onPress={() => step(1)} disabled={follow} style={[styles.chip, follow && { opacity: 0.4 }]}><Text style={styles.chipText}>▶</Text></Pressable>
        {[10, 30, 60, 'all'].map((v) => (
          <Pressable key={v} onPress={() => { atEnd.current = true; setMins(v); setSel(null); }} style={[styles.chip, mins === v && styles.chipOn]}>
            <Text style={[styles.chipText, mins === v && styles.chipTextOn]}>{v === 'all' ? 'All' : `${v} min`}</Text>
          </Pressable>
        ))}
        {!follow && <Pressable onPress={toEnd} style={[styles.chip, styles.chipOn]}><Text style={[styles.chipText, styles.chipTextOn]}>Latest</Text></Pressable>}
      </View>
    </View>
  );
}

const f2 = (v) => (v == null ? '—' : Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1) : v.toFixed(2));
const clockHM = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function EarlyWarningPanel({ ew, style, children }) {
  const { series, gate, quadrant, deciding, fusedCal, limits } = ew;
  const header = gate.paused ? 'Not calibrated yet' : gate.recalibrating ? 'Recalibrating' : (gate.startMs ? `Calibrated ${clockHM(gate.startMs)}` : null);
  return (
    <>
      <Card style={style}>
        <View style={styles.head}>
          <Text style={styles.title}>Stress statistics</Text>
          {header && <Text style={styles.headNote}>{header}</Text>}
        </View>
        <View style={styles.boxes}>
          <StateBox title="MIND" color={MIND} row={ew.now.mind} rows={series.mind} old={ew.old.mind} />
          <StateBox title="BODY" color={BODY} row={ew.now.body} rows={series.body} old={ew.old.body} />
          <StateBox title="OVERALL" color={OVERALL} row={ew.now.fused} rows={series.fused} old={ew.old.fused} />
        </View>
        <View style={styles.stateRow}>
          <Text style={styles.stateTitle}>Your state</Text>
          <Text style={styles.stateValue}>{quadrant ? quadrant.label : '—'}</Text>
        </View>
        <StateGrid q={quadrant} mind={deciding ? ew.now.mind?.value : null} body={deciding ? ew.now.body?.value : null} />
        <View style={styles.limits}>
          {[['Mind', 'mind', MIND], ['Body', 'body', BODY]].map(([l, k, c]) => (
            <View key={k} style={[styles.limitBox, { borderTopColor: c }]}>
              <Text style={styles.boxTitle}>{l.toUpperCase()}</Text>
              <Text style={styles.limitValue}>{f2(limits?.[k]?.baseline)} <Text style={styles.limitArrow}>→</Text> {f2(limits?.[k]?.limit)}</Text>
              <Text style={styles.limitKind}>{limits?.[k]?.kind || '—'}</Text>
            </View>
          ))}
        </View>
        {children}
      </Card>
      <Card style={style}>
        <Text style={styles.title}>Stress timeline</Text>
        <View style={{ marginTop: SPACE.md }}>
          <Timeline series={series} fusedCal={fusedCal} gate={gate} />
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.md },
  title: { fontSize: 16, fontWeight: '800', color: '#231F20', letterSpacing: -0.2 },
  headNote: { fontSize: 12, fontWeight: '700', color: '#989294' },
  limits: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.lg },
  limitBox: { flex: 1, borderWidth: 1, borderColor: '#EAE5DA', borderTopWidth: 4, borderRadius: RADIUS.md, padding: 10, backgroundColor: '#FFFFFF' },
  limitValue: { fontSize: 18, fontWeight: '900', color: '#231F20', marginTop: 4, fontVariant: ['tabular-nums'] },
  limitArrow: { color: '#989294' },
  limitKind: { fontSize: 11.5, fontWeight: '700', color: '#989294', marginTop: 2 },
  boxes: { flexDirection: 'row', gap: SPACE.sm },
  box: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#EAE5DA', borderTopWidth: 4, borderRadius: RADIUS.md, padding: 10, backgroundColor: '#FFFFFF' },
  boxTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: '#544E50' },
  boxValue: { fontSize: 28, fontWeight: '900', color: '#231F20', marginTop: 4, fontVariant: ['tabular-nums'] },
  boxTrend: { fontSize: 11.5, fontWeight: '700', color: '#989294', marginTop: 2, marginBottom: 8 },
  pill: { borderRadius: RADIUS.sm, paddingVertical: 7, paddingHorizontal: 8, minHeight: 46, justifyContent: 'center' },
  pillText: { fontSize: 12, fontWeight: '800' },
  stateRow: { flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm, marginTop: SPACE.lg, marginBottom: SPACE.sm },
  stateTitle: { fontSize: 15, fontWeight: '800', color: '#231F20' },
  stateValue: { fontSize: 13, fontWeight: '700', color: '#544E50' },
  gridWrap: { position: 'relative', flexDirection: 'row', flexWrap: 'wrap', gap: 6, height: 132 },
  cell: { width: '48.8%', height: 63, borderRadius: RADIUS.sm, backgroundColor: '#F0ECE4', borderWidth: 2, borderColor: 'transparent', justifyContent: 'center', paddingHorizontal: 10 },
  cellText: { fontSize: 13, fontWeight: '800', color: '#544E50' },
  dot: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.brand, borderWidth: 3, borderColor: '#FFFFFF' },
  axes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 12, fontWeight: '700', color: '#989294' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendDash: { width: 16, borderTopWidth: 2, borderTopColor: '#544E50', borderStyle: 'dashed' },
  legendZone: { width: 16, height: 9, borderRadius: 2, backgroundColor: 'rgba(232,162,56,0.35)' },
  legendText: { fontSize: 12.5, fontWeight: '600', color: '#544E50' },
  key: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 8, marginLeft: GUTTER },
  swatch: { width: 12, height: 9, borderRadius: 2 },
  keyText: { fontSize: 11.5, fontWeight: '600', color: '#544E50' },
  zoomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: RADIUS.sm, backgroundColor: '#F0ECE4' },
  chipOn: { backgroundColor: COLORS.brand },
  chipText: { fontSize: 12.5, fontWeight: '800', color: '#544E50' },
  chipTextOn: { color: '#FFFFFF' },
  tip: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAE5DA', borderRadius: RADIUS.sm, padding: 8, marginTop: 6 },
  tipTime: { fontSize: 12.5, fontWeight: '800', color: '#231F20' },
  tipRow: { fontSize: 12, fontWeight: '600', color: '#544E50', marginTop: 2 },
  empty: { textAlign: 'center', paddingVertical: 28, color: '#989294', fontWeight: '600' },
});
