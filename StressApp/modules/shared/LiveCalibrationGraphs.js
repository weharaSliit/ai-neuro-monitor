import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import physiologicalApi from '../physiological/api/client';
import { eegClient } from './eegApiClient';
import { COLORS } from '../physiological/config/theme';

// ============================================================
// LiveCalibrationGraphs -- twin of the website's
// web/src/components/LiveCalibrationGraphs.jsx.
//
// While calibrating (phase 'baseline') or taking the personal-limit test
// (phase 'task'), shows three graphs that fill in block by block:
//   Heart variability (ring SD1), Skin response (ring SCL),
//   Brain activity (headband load score).
// Each shows every block as a point plus a dashed running average.
// Polls the same status routes the calibration screens already poll:
//   baseline -> GET /calibrate/status
//   task     -> GET /calibrate/threshold/status
// ============================================================

const POLL_MS = 2000;
const ACTIVE = ['settling', 'capturing', 'saving'];
const H = 140;
const PAD = { l: 38, r: 10, t: 12, b: 24 };

function runningAverage(values) {
  let sum = 0; let n = 0;
  return values.map((v) => {
    if (v == null) return n ? sum / n : null;
    sum += v; n += 1;
    return sum / n;
  });
}

function useStatus(fetcher, enabled, key) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetcher();
        if (!cancelled) setState(res.data);
      } catch { /* next poll retries */ }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return state;
}

function BlockChart({ title, unit, values, rest = [], color, fmt, refValue, refLabel, t }) {
  const [width, setWidth] = useState(0);
  const avg = runningAverage(values);
  const last = [...values].reverse().find((v) => v != null);
  const all = [...rest, ...values].filter((v) => v != null);
  const nTotal = rest.length + values.length;

  let body = null;
  if (width > 0) {
    if (all.length === 0) {
      body = (
        <Svg width={width} height={H}>
          <SvgText x={width / 2} y={H / 2} textAnchor="middle" fontSize="12" fill={t.textMuted}>—</SvgText>
        </Svg>
      );
    } else {
      let lo = Math.min(...all, refValue ?? Infinity); let hi = Math.max(...all, refValue ?? -Infinity);
      if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
      const pad = (hi - lo) * 0.18; lo -= pad; hi += pad;
      const plotW = width - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
      const x = (i) => PAD.l + (nTotal <= 1 ? plotW / 2 : (i / (nTotal - 1)) * plotW);
      const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
      const path = (vals, offset) => {
        let d = ''; let open = false;
        vals.forEach((v, i) => {
          if (v == null) { open = false; return; }
          d += `${open ? 'L' : 'M'} ${x(i + offset).toFixed(1)} ${y(v).toFixed(1)} `;
          open = true;
        });
        return d;
      };
      body = (
        <Svg width={width} height={H}>
          {[0, 0.5, 1].map((f) => {
            const v = lo + f * (hi - lo);
            return (
              <React.Fragment key={f}>
                <Line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} stroke={t.border} strokeWidth={1} />
                <SvgText x={PAD.l - 5} y={y(v) + 4} textAnchor="end" fontSize="10" fontWeight="700" fill={t.textMuted}>{fmt(v)}</SvgText>
              </React.Fragment>
            );
          })}
          {refValue != null && (
            <>
              <Line x1={PAD.l} x2={width - PAD.r} y1={y(refValue)} y2={y(refValue)} stroke={t.textMuted} strokeDasharray="4 4" strokeWidth={1} />
              <SvgText x={width - PAD.r} y={y(refValue) - 4} textAnchor="end" fontSize="10" fontWeight="800" fill={t.textMuted}>{refLabel} {fmt(refValue)}</SvgText>
            </>
          )}
          <Path d={path(rest, 0)} stroke={t.border} strokeWidth={2} fill="none" />
          {rest.map((v, i) => (v == null ? null
            : <Circle key={`r${i}`} cx={x(i)} cy={y(v)} r={3.5} fill="#fff" stroke={t.textMuted} strokeWidth={1.6} />))}
          <Path d={path(values, rest.length)} stroke={color} strokeWidth={2.4} fill="none" strokeLinejoin="round" />
          <Path d={path(avg, rest.length)} stroke={color} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="6 5" fill="none" />
          {values.map((v, i) => (v == null ? null
            : <Circle key={`v${i}`} cx={x(i + rest.length)} cy={y(v)} r={4.5} fill={color} stroke="#fff" strokeWidth={2} />))}
          {Array.from({ length: nTotal }).map((_, i) => (
            <SvgText key={i} x={x(i)} y={H - 7} textAnchor="middle" fontSize="10" fontWeight="700" fill={t.textMuted}>
              {i < rest.length ? `R${i + 1}` : `${i - rest.length + 1}`}
            </SvgText>
          ))}
        </Svg>
      );
    }
  }

  return (
    <View style={[styles.chartCard, { borderColor: t.border, backgroundColor: t.card }]}>
      <View style={styles.chartHead}>
        <Text style={[styles.chartTitle, { color: t.text }]}>{title}</Text>
        <Text style={[styles.chartValue, { color }]}>{last != null ? `${fmt(last)}${unit}` : '—'}</Text>
      </View>
      <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ width: '100%' }}>
        {body}
      </View>
    </View>
  );
}

export default function LiveCalibrationGraphs({
  phase = 'baseline', ringOnline = true, eegOnline = true, token, collapsible = false, defaultOpen = true, theme,
}) {
  const t = useMemo(() => ({
    text: theme?.text || COLORS.text || '#231F20',
    textMuted: theme?.textMuted || COLORS.textMuted || '#989294',
    border: theme?.border || COLORS.border || '#EAE5DA',
    card: theme?.card || '#FFFFFF',
  }), [theme]);
  const [open, setOpen] = useState(defaultOpen);
  const path = phase === 'task' ? '/calibrate/threshold/status' : '/calibrate/status';
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  const ring = useStatus(() => physiologicalApi.get(path), ringOnline && open, `r${path}`);
  const eeg = useStatus(() => eegClient.get(path, { headers }), eegOnline && open, `e${path}${token}`);

  const ringBlocks = ring?.blocks || [];
  const ringValid = (key) => ringBlocks.map((b) => (b && b.valid && b[key] != null ? b[key] : null));
  const eegScores = (eeg?.scores || []).map((v) => (v == null ? null : v * 100));
  const eegRest = (phase === 'task' ? (eeg?.resting_scores || []) : []).map((v) => v * 100);
  const restAvg = eegRest.length ? runningAverage(eegRest).slice(-1)[0] : undefined;

  return (
    <View style={styles.wrap}>
      {collapsible && (
        <TouchableOpacity activeOpacity={0.7} onPress={() => setOpen((o) => !o)} style={styles.head}>
          <Text style={[styles.title, { color: t.text }]}>Live graphs</Text>
          <Text style={[styles.chev, { color: t.textMuted }]}>{open ? '▾' : '▸'}</Text>
        </TouchableOpacity>
      )}
      {open && (
        <View style={{ gap: 10, marginTop: collapsible ? 10 : 0 }}>
          <BlockChart t={t} title="Heart variability" unit=" ms"
            values={ringValid('hrv')} color={COLORS.hrv} fmt={(v) => v.toFixed(1)} />
          <BlockChart t={t} title="Skin response" unit=" µS"
            values={ringValid('gsr')} color={COLORS.gsr} fmt={(v) => v.toFixed(2)} />
          <BlockChart t={t} title="Brain activity" unit="%"
            values={eegScores} rest={eegRest} color={COLORS.eeg} fmt={(v) => v.toFixed(0)}
            refValue={restAvg} refLabel="Rest" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15, fontWeight: '800' },
  chev: { fontSize: 18, fontWeight: '800' },
  chartCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
  chartHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  chartTitle: { fontSize: 13, fontWeight: '800' },
  chartSub: { fontSize: 11, fontWeight: '600' },
  chartValue: { fontSize: 17, fontWeight: '900' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 10, fontWeight: '700' },
  note: { fontSize: 13, fontWeight: '700' },
});
